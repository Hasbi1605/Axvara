// POST /api/pedia/orders/[code]/refill — Ajukan refill (PD-25).
// Capability: kode + kontak (WA/email) cocok (pola lookup). Rate-limit refill.
// Syarat: eligibility sama dengan GET + refill terakhir ≥ 24 jam (atomik).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { parseBuyerContact } from "@/lib/order-contact";
import { constantTimeEqual } from "@/lib/security";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  contact: z.string().trim().min(1).max(254),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "pedia:refill")) {
    return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Kontak wajib diisi." }, { status: 400 });
  const contact = parseBuyerContact(parsed.data.contact);
  if (!contact) return NextResponse.json({ error: "Kontak tidak valid." }, { status: 400 });
  const db = createDatabaseAccess();
  const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, clean).catch(() => null);
  if (!order) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  // Verifikasi kontak (pola lookup — generik agar tak bisa di-oracle).
  const waOk = contact.kind === "wa" && constantTimeEqual(String(order.customer_wa ?? ""), contact.value);
  const emailOk = contact.kind === "email" && constantTimeEqual(String(order.customer_email ?? "").toLowerCase(), contact.value.toLowerCase());
  if (!waOk && !emailOk) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan atau kontak tidak cocok." }, { status: 404 });
  }
  const item = await db.queryFirst(
    `SELECT i.*, t.refill_days FROM pedia_order_items i
       JOIN pedia_tiers t ON t.id=i.tier_id WHERE i.order_code=?`,
    clean,
  ).catch(() => null);
  if (!item) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  const refillDays = Number(item.refill_days) || 0;
  if (refillDays <= 0 || (item.status !== "completed" && item.status !== "partial")) {
    return NextResponse.json({ error: "Produk ini tidak bergaransi refill." }, { status: 409 });
  }
  // Klaim atomik: hanya bila refill terakhir ≥ 24 jam lalu (atau belum pernah).
  const claimed = await db.execRun(
    `UPDATE pedia_order_items SET refill_last_at=datetime('now'), refill_status='requested',
       updated_at=datetime('now')
     WHERE order_code=? AND (refill_last_at IS NULL OR datetime(refill_last_at) <= datetime('now', '-24 hours'))`,
    clean,
  ).catch(() => null);
  if (Number((claimed as { changes?: number })?.changes ?? 0) !== 1) {
    return NextResponse.json({ error: "Refill sudah diajukan dalam 24 jam terakhir." }, { status: 409 });
  }
  // Panggil supplier via proxy (idempoten: refill per order 1×/24 jam sudah diklaim).
  try {
    const { callPsmmProxy } = await import("@/lib/pedia/proxy");
    const res = await callPsmmProxy("refill", { order: String(item.supplier_order_id ?? "") }, 20_000, `${clean}:refill`);
    if (res.ok) {
      const refillId = String((res.data as Record<string, unknown>)?.refill ?? "");
      await db.execRun(
        `UPDATE pedia_order_items SET refill_supplier_id=?, refill_status='submitted' WHERE order_code=?`,
        refillId, clean,
      ).catch(() => null);
    } else {
      await db.execRun(
        `UPDATE pedia_order_items SET refill_status='supplier_rejected' WHERE order_code=?`,
        clean,
      ).catch(() => null);
    }
  } catch { /* status tetap requested; cron/admin menyusul */ }
  return NextResponse.json({ ok: true, message: "Refill diajukan. Biasanya mulai dalam 24 jam." });
}
