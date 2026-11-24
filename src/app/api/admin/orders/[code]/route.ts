import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OrderTransitionError, queryFirst, transitionPendingOrder, transitionPendingPaymentToPaid } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { readJsonBody } from "@/lib/http-body";
import { schedulePaidFulfillment } from "@/lib/payments/paid-fulfillment";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req:NextRequest,{ params }:{ params:Promise<{ code:string }> }) {
  const headers = { "Cache-Control":"private, no-store" };
  if (!await requireAdmin(req)) return NextResponse.json({ error:"Unauthorized" },{ status:401,headers });
  const { code } = await params;
  if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error:"invalid_code" },{ status:400,headers });
  const row = await queryFirst("SELECT items FROM orders WHERE code=?",code);
  if (!row) return NextResponse.json({ error:"not_found" },{ status:404,headers });
  const items = JSON.parse(String(row.items || "[]")) as {
    variant_id?: number;
    buyer_fields?: { muse_invite_code?: string; invite_email?: string; custom_values?: Record<string, string> };
    custom_buyer_fields_meta?: { key: string; label: string; type: "text" | "email" | "password" | "textarea" }[];
  }[];
  return NextResponse.json({
    buyerInputs: items.flatMap((item, index) => {
      const out: { item_index: number; variant_id?: number; key: string; label?: string; secret?: boolean; value: string }[] = [];
      if (item.buyer_fields?.muse_invite_code) out.push({ item_index: index, variant_id: item.variant_id, key: "muse_invite_code", label: "Kode Invite Muse", value: item.buyer_fields.muse_invite_code });
      if (item.buyer_fields?.invite_email) out.push({ item_index: index, variant_id: item.variant_id, key: "invite_email", label: "Email yang ingin di-invite", value: item.buyer_fields.invite_email });
      if (item.buyer_fields?.custom_values) {
        const metaByKey = new Map((item.custom_buyer_fields_meta ?? []).map((m) => [m.key, m]));
        for (const [k, v] of Object.entries(item.buyer_fields.custom_values)) {
          if (v === "") continue;
          const meta = metaByKey.get(k);
          out.push({
            item_index: index,
            variant_id: item.variant_id,
            key: `custom:${k}`,
            label: meta?.label || k.replace(/_/g, " "),
            ...(meta?.type === "password" ? { secret: true } : {}),
            value: String(v),
          });
        }
      }
      return out;
    }),
  },{ headers });
}

const patchSchema = z.object({
  status: z.enum(["pending", "lunas", "dibatalkan", "kadaluarsa"]),
  admin_note: z.string().trim().max(500).optional().nullable(),
  // ACC manual QRIS (2026-10-01): hook DANA gagal/tidak datang padahal dana
  // benar masuk (cek mutasi manual). Hanya untuk order QRIS pending.
  // Memakai transitionPendingPaymentToPaid (sama dengan webhook) agar ledger
  // payment_transactions ikut lunas — bukan transitionPendingOrder biasa.
  action: z.enum(["paid_qris"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  const bounded = await readJsonBody(req, 8_000);
  if (!bounded.ok) return bounded.response;
  const body = bounded.data;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const row = (await queryFirst("SELECT code, status, sales_channel, items, payment_method, payment_status FROM orders WHERE code=?", code)) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });

  // ACC manual QRIS (2026-10-01): admin memastikan dana benar masuk via mutasi
  // DANA (hook gagal). Syarat ketat: order pending + metode QRIS + payment
  // belum paid. Jalur paid SAMA dengan webhook (ledger + job + fulfillment +
  // WR/SK link), hanya sumber kebenarannya admin + catatan wajib.
  if (parsed.data.action === "paid_qris") {
    if (parsed.data.status !== "lunas") return NextResponse.json({ error: "ACC QRIS wajib dengan status lunas" }, { status: 400 });
    if (String(row.status) !== "pending") return NextResponse.json({ error: `Status sudah ${String(row.status)}, tidak bisa ACC` }, { status: 400 });
    if (String(row.payment_method || "").toLowerCase() !== "qris") return NextResponse.json({ error: "ACC QRIS hanya untuk pesanan QRIS" }, { status: 400 });
    if (String(row.payment_status || "") === "paid") return NextResponse.json({ ok: true, code, status: "lunas", unchanged: true });
    const note = (parsed.data.admin_note ?? "").trim();
    if (note.length < 10) return NextResponse.json({ error: "Catatan verifikasi mutasi wajib diisi (min. 10 karakter)" }, { status: 400 });
    const adminNote = `[ACC-QRIS manual ${admin.email}] ${note}`;
    let items: { product_id: number; variant_id?: number; qty: number }[];
    try {
      items = JSON.parse(String(row.items || "[]"));
    } catch {
      return NextResponse.json({ error: "Snapshot item pesanan rusak; status tidak diubah." }, { status: 500 });
    }
    const fulfillmentRouting = await queryFirst(
      `SELECT o.variant_id, o.sales_channel,
              (SELECT fi.id FROM fulfillment_inventory fi
                WHERE fi.order_code=o.code AND fi.status='reserved') AS inventory_id
       FROM orders o WHERE o.code=?`,
      code,
    );
    const transitioned = await transitionPendingPaymentToPaid(
      code,
      new Date().toISOString(),
      fulfillmentRouting
        ? {
            variantId: fulfillmentRouting.variant_id != null ? Number(fulfillmentRouting.variant_id) : null,
            inventoryId: fulfillmentRouting.inventory_id != null ? Number(fulfillmentRouting.inventory_id) : null,
            salesChannel: String(fulfillmentRouting.sales_channel || "telegram"),
          }
        : null,
    );
    if (!transitioned) {
      return NextResponse.json({ error: "Gagal melunaskan: order sudah berubah (hook/cron/expiry menang duluan) atau invoice kedaluwarsa" }, { status: 409 });
    }
    // Catat siapa yang ACC (audit trail) — tanpa mengubah paid_at yang sudah dikunci.
    try {
      const { execRun } = await import("@/lib/db");
      await execRun(`UPDATE orders SET admin_note=? WHERE code=?`, adminNote, code);
    } catch { /* admin_note best-effort */ }
    await schedulePaidFulfillment(code, "apps", "admin_paid_qris");
    if (String(row.sales_channel) === "whatsapp") {
      try {
        const { notifyWhatsAppPaidAdmin } = await import("@/lib/telegram/order-notifications");
        await notifyWhatsAppPaidAdmin(code).catch(() => false);
      } catch { /* Cron retries. */ }
    }
    return NextResponse.json({ ok: true, code, status: "lunas", via: "manual_qris_acc" });
  }

  // Simple state machine: pending -> lunas/dibatalkan/kadaluarsa, lunas/dibatalkan final
  const cur = String(row.status);
  const nxt = parsed.data.status;
  if (cur !== "pending" && nxt !== cur) {
    return NextResponse.json({ error: `Status sudah ${cur}, tidak bisa diubah ke ${nxt}` }, { status: 400 });
  }
  if (nxt === cur || nxt === "pending") {
    return NextResponse.json({ ok: true, code, status: cur, unchanged: true });
  }
  const method = String(row.payment_method || "").toLowerCase();
  if (/^(nowpayments|sekalipay_gateway):/.test(method)) {
    return NextResponse.json({ error: "Pembayaran ini mengikuti rekonsiliasi provider; status tidak dapat diubah melalui aksi manual legacy." }, { status: 409 });
  }
  if (nxt === "lunas" && method === "qris") {
    return NextResponse.json({ error: "Gunakan ACC QRIS dengan catatan verifikasi mutasi." }, { status: 409 });
  }
  if (nxt === "lunas" && String(row.sales_channel) === "whatsapp") {
    return NextResponse.json(
      { error: "review_bukti_whatsapp_required", message: "Tinjau bukti WhatsApp langsung dari tab Pesanan." },
      { status: 409 },
    );
  }

  let items: { product_id: number; variant_id?: number; qty: number }[];
  try {
    items = JSON.parse(String(row.items || "[]"));
  } catch {
    return NextResponse.json({ error: "Snapshot item pesanan rusak; status tidak diubah." }, { status: 500 });
  }
  try {
    await transitionPendingOrder(code, nxt, parsed.data.admin_note ?? null, items);
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("PATCH /api/admin/orders transition failed:", error);
    return NextResponse.json({ error: "Status pesanan gagal diperbarui." }, { status: 500 });
  }

  if (nxt === "lunas") {
    await schedulePaidFulfillment(code, "apps", "admin_paid");
  }

  return NextResponse.json({ ok: true, code, status: nxt });
}
