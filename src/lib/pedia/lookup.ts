// src/lib/pedia/lookup.ts — Lookup order Pedia untuk /lacak (PD-13).
// Pola /api/orders/lookup existing: verifikasi kontak + respons generik
// anti-oracle. Mengembalikan status + ringkasan item Pedia.
import { NextResponse } from "next/server";
import { queryFirst } from "@/lib/db";
import { MAX_QRIS_REISSUES } from "@/lib/payments/dana-qris";
import { pediaStatusLabel } from "@/components/pedia/StatusWidgets";
import { buyerOrderAccessMatches, createBuyerAccessSession, requiresOrderAccessCode, newOrderAccessFailure, orderAccessDenied } from "@/lib/order-access";
import { deriveNameFromEmail } from "@/lib/utils";
import { readPediaServiceCopy } from "@/lib/pedia/service-copy";
import { whiteLabel } from "@/lib/pedia/terms";

export async function lookupPediaOrder(code: string, contactRaw: string, adminView = false, request?: Request) {
  const notFound = orderAccessDenied;
  const row = (await queryFirst(
    `SELECT o.*, pt.payable_amount, pt.unique_code, pt.qris_url AS dynamic_qris_url,
            pt.expires_at AS payment_expires_at, pt.status AS transaction_status
      FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
      WHERE o.code=?`,
    code,
  )) as Record<string, unknown> | undefined;
  if (!row) return notFound();
  if (!adminView && requiresOrderAccessCode(row) && !request) return NextResponse.json({ error: "Verifikasi PIN belum tersedia." }, { status: 503 });
  if (!adminView && request) {
    const failure = await newOrderAccessFailure(request, row, contactRaw, { allowAdmin: false });
    if (failure) return failure;
  }
  if (!adminView && !requiresOrderAccessCode(row) && !(await buyerOrderAccessMatches(contactRaw, row))) return notFound();
  const item = (await queryFirst(
    `SELECT i.*, p.name AS product_name, t.tier AS tier_name, t.label_note,
            t.eta_start, t.eta_finish
       FROM pedia_order_items i
       JOIN pedia_products p ON p.id=i.product_id
       JOIN pedia_tiers t ON t.id=i.tier_id
      WHERE i.order_code=?`,
    code,
  ).catch(() => null)) as Record<string, unknown> | null;
  const waFull = String(row.customer_wa ?? "");
  // Truthful Pedia contract: order_kind + lifecycle/progress/ETA from the
  // authoritative item row. Snapshot names (never live tier edits); no
  // supplier identity, wholesale cost, or raw supplier IDs. Contact proof is
  // unchanged (full checkout contact); no PIN for Pedia status.
  const storedName = String(row.customer_name ?? "").trim();
  let snap: Record<string, unknown> = {};
  try { snap = JSON.parse(String(item?.snapshot_json ?? "{}")) ?? {}; } catch { /* legacy */ }
  const copy = readPediaServiceCopy(snap.service_copy);
  const productName = (copy?.product_name || String(item?.product_name ?? "")).slice(0, 120);
  const serviceName = (copy?.service_name || String(item?.label_note ?? item?.tier_name ?? "")).slice(0, 200);
  const qty = Number(item?.quantity) || 0;
  const rawRemainsLookup = item?.remains != null ? Number(item.remains) : NaN;
  const rawStartLookup = item?.start_count != null ? Number(item.start_count) : NaN;
  const remains = Number.isSafeInteger(rawRemainsLookup) && rawRemainsLookup >= 0 && rawRemainsLookup <= qty ? rawRemainsLookup : null;
  const startCount = Number.isSafeInteger(rawStartLookup) && rawStartLookup >= 0 ? rawStartLookup : null;
  const pediaStatus = item ? String(item.status) : "unknown";
  const done = item ? (pediaStatus === "completed" ? qty : remains != null ? qty - remains : null) : null;
  return NextResponse.json({
    buyer_access_session: adminView ? undefined : await createBuyerAccessSession(row),
    order: {
      code: row.code,
      order_kind: "pedia",
      customer_name: storedName || deriveNameFromEmail(String(row.customer_email ?? "")),
      customer_wa: waFull.length >= 7 ? `${waFull.slice(0, 5)}****${waFull.slice(-4)}` : "",
      items: item ? [{ name: whiteLabel(`${productName} (${serviceName})`).slice(0, 200), price: Number(item.total), qty: 1 }] : [],
      subtotal: row.subtotal,
      payment_method: row.payment_method,
      payment_status: row.payment_status ?? null,
      paid_at: row.paid_at != null ? String(row.paid_at) : null,
      status: row.status,
      pedia_status: item ? pediaStatusLabel(pediaStatus) : null,
      pedia_status_raw: item ? pediaStatus : null,
      pedia_code: code,
      product_name: whiteLabel(productName),
      service_name: whiteLabel(serviceName),
      quantity: qty,
      start_count: startCount,
      remains,
      done,
      percent: qty > 0 && done !== null ? (done / qty) * 100 : null,
      eta_start: item?.eta_start != null ? String(item.eta_start) : null,
      eta_finish: item?.eta_finish != null ? String(item.eta_finish) : null,
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
