import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OrderTransitionError, queryFirst, transitionPendingOrder, transitionPendingPaymentToPaid } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";

export const runtime = "edge";
export const dynamic = "force-dynamic";

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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
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
    try {
      await ensureFulfillmentForPaidOrder(code);
    } catch { /* Paid state is durable; cron retries notification/fulfillment. */ }
    try {
      const { createWrOrderLinksForOrder, processWrPendingOrders } = await import("@/lib/warung-rebahan/order");
      const { isWrAutoOrderEnabled } = await import("@/lib/warung-rebahan/client");
      if (isWrAutoOrderEnabled() && (await createWrOrderLinksForOrder(code)) > 0) {
        await processWrPendingOrders().catch(() => undefined);
      }
    } catch { /* Link WR menyusul via cron. */ }
    try {
      const { createSkOrderLinksForOrder, processSkPendingOrders } = await import("@/lib/sekalipay/order");
      const { isSkAutoOrderEnabled } = await import("@/lib/sekalipay/client");
      if (isSkAutoOrderEnabled() && (await createSkOrderLinksForOrder(code)) > 0) {
        await processSkPendingOrders().catch(() => undefined);
      }
    } catch { /* Link SK menyusul via cron. */ }
    // WA: kabar payment_detected + notif admin (cermin webhook dana route).
    try {
      const waRow = await queryFirst(`SELECT sales_channel, channel_conversation_id FROM orders WHERE code=?`, code);
      if (String(waRow?.sales_channel) === "whatsapp" && waRow?.channel_conversation_id) {
        const orderDetail = await queryFirst(`SELECT subtotal, payment_method, variant_snapshot FROM orders WHERE code=?`, code);
        const snap = orderDetail?.variant_snapshot ? JSON.parse(String(orderDetail.variant_snapshot)) : {};
        const { paymentDetectedMessage } = await import("@/lib/whatsapp/messages");
        const { enqueueWhatsAppMessage, waOutboxKey } = await import("@/lib/whatsapp/outbox");
        await enqueueWhatsAppMessage(
          waOutboxKey("payment_detected", code),
          String(waRow.channel_conversation_id),
          paymentDetectedMessage({
            orderCode: code,
            productName: snap.product_name,
            variantLabel: snap.label,
            total: Number(orderDetail?.subtotal || 0),
            method: String(orderDetail?.payment_method || "QRIS").toUpperCase(),
          }),
        ).catch(() => false);
        const { notifyWhatsAppPaidAdmin } = await import("@/lib/telegram/order-notifications");
        await notifyWhatsAppPaidAdmin(code).catch(() => false);
      }
    } catch { /* antrean bertahan; cron memproses yang due */ }
    // Notif admin + buyer mengikuti jalur ensureFulfillmentForPaidOrder
    // (email kredensial web / DM Telegram / WA) — sama persis dengan hook.
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
    try {
      await ensureFulfillmentForPaidOrder(code);
    } catch { /* Paid state is durable; cron retries notification/fulfillment. */ }
    // Produk WR: buat link auto-order (best-effort; cron memprosesnya).
    try {
      const { createWrOrderLinksForOrder, processWrPendingOrders } = await import("@/lib/warung-rebahan/order");
      const { isWrAutoOrderEnabled } = await import("@/lib/warung-rebahan/client");
      if (isWrAutoOrderEnabled() && (await createWrOrderLinksForOrder(code)) > 0) {
        await processWrPendingOrders().catch(() => undefined);
      }
    } catch { /* Link WR menyusul via cron. */ }
    // Produk SK: pola yang sama (best-effort; cron fase sekalipay memprosesnya).
    try {
      const { createSkOrderLinksForOrder, processSkPendingOrders } = await import("@/lib/sekalipay/order");
      const { isSkAutoOrderEnabled } = await import("@/lib/sekalipay/client");
      if (isSkAutoOrderEnabled() && (await createSkOrderLinksForOrder(code)) > 0) {
        await processSkPendingOrders().catch(() => undefined);
      }
    } catch { /* Link SK menyusul via cron. */ }
  }

  return NextResponse.json({ ok: true, code, status: nxt });
}
