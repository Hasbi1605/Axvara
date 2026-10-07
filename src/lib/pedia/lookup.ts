// src/lib/pedia/lookup.ts — Lookup order Pedia untuk /lacak (PD-13).
// Pola /api/orders/lookup existing: verifikasi kontak + respons generik
// anti-oracle. Mengembalikan status + ringkasan item Pedia.
import { NextResponse } from "next/server";
import { queryFirst } from "@/lib/db";
import { MAX_QRIS_REISSUES } from "@/lib/payments/dana-qris";
import { constantTimeEqual } from "@/lib/security";
import { emailMatches, normalizeWa, parseBuyerContact } from "@/lib/order-contact";
import { pediaStatusLabel } from "@/components/pedia/StatusWidgets";

export async function lookupPediaOrder(code: string, contactRaw: string) {
  const notFound = () =>
    NextResponse.json({ error: "Pesanan tidak ditemukan atau No. WA/email tidak cocok. Periksa kembali kode serta No. WA atau email yang dipakai saat checkout." }, { status: 404 });
  const contact = parseBuyerContact(contactRaw);
  if (!contact) return notFound();
  const row = (await queryFirst(
    `SELECT o.*, pt.payable_amount, pt.unique_code, pt.qris_url AS dynamic_qris_url,
            pt.expires_at AS payment_expires_at, pt.status AS transaction_status
      FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
      WHERE o.code=?`,
    code,
  )) as Record<string, unknown> | undefined;
  if (!row) return notFound();
  if (contact.kind === "email") {
    if (!emailMatches(contact.value, row.customer_email)) return notFound();
  } else {
    const storedWa = normalizeWa(row.customer_wa);
    if (!storedWa || !constantTimeEqual(contact.value, storedWa)) return notFound();
  }
  const item = (await queryFirst(
    `SELECT i.*, p.name AS product_name, t.tier AS tier_name
       FROM pedia_order_items i
       JOIN pedia_products p ON p.id=i.product_id
       JOIN pedia_tiers t ON t.id=i.tier_id
      WHERE i.order_code=?`,
    code,
  ).catch(() => null)) as Record<string, unknown> | null;
  const waFull = String(row.customer_wa ?? "");
  return NextResponse.json({
    order: {
      code: row.code,
      customer_name: row.customer_name,
      customer_wa: waFull.length >= 7 ? `${waFull.slice(0, 5)}****${waFull.slice(-4)}` : "",
      items: item ? [{ name: `${String(item.product_name)} (${String(item.tier_name)})`, price: Number(item.total), qty: 1 }] : [],
      subtotal: row.subtotal,
      payment_method: row.payment_method,
      status: row.status,
      pedia_status: item ? pediaStatusLabel(String(item.status)) : null,
      pedia_code: code,
      created_at: row.created_at,
      expires_at: row.expires_at,
      qris_reissue_allowed: row.status === "pending" && Number(row.qris_reissue_count || 0) < MAX_QRIS_REISSUES,
      qris: row.dynamic_qris_url ? {
        payable_amount: row.payable_amount, unique_code: row.unique_code,
        image_url: row.dynamic_qris_url, expires_at: row.payment_expires_at,
        status: row.transaction_status,
      } : null,
    },
  });
}
