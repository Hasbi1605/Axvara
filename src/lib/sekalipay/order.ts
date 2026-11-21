// src/lib/sekalipay/order.ts — Auto-order SK: Axvara lunas → order ke Sekalipay.
//
// Mesin exactly-once cermin WR (migrasi 0029 / order.ts):
//   pending → claimed → submitted → processing → completed
//                                              → failed (terminal)
//   blocked_balance: saldo habis — tidak makan retry, pulih via reconcile.
//
// Perbedaan kontrak upstream yang penting:
//  - SK MENDUKUNG ref_id idempoten (422 REF_ID_ALREADY_EXIST): ref_id stabil
//    `sk:<order_code>:<sk_variant_id>:<qty>` membuat retry POST aman —
//    duplikat mengembalikan detail order yang sama, bukan order ganda.
//  - Validasi required_fields SK 422 SEBELUM potong saldo: varian auto tidak
//    butuh note/zone_id/provider_qty, jadi fase 1 tidak pernah mengirim note.
//  - 503 PRODUCT_TEMPORARILY_UNAVAILABLE = ditolak di depan, saldo tidak
//    terpotong → status retry (bukan failed), jangan void manual dulu.
//
// Fase 1: HANYA varian auto (order_process=auto). Varian manual/h2h/smm
// tidak dibuatkan link — sync tidak memberi pasangan katalog untuknya.

import { createDatabaseAccess, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { alertSupplierAdminOnce } from "@/lib/fulfillment/supplier-escalation";
import {
  claimFreshPurchase,
  claimStalePurchase,
  fencePurchaseSend,
  isPaidForSupplierPurchase,
  nextPurchaseAttemptIso,
  PURCHASE_PAID_SQL,
  PURCHASE_PAID_SQL_ALIASED,
} from "@/lib/suppliers/purchase-state";
import { escapeHtml } from "@/lib/telegram/messages/format";
import {
  createSkTransaction,
  fetchSkBalance,
  fetchSkItemDetail,
  fetchSkTransaction,
  isSkAutoOrderEnabled,
  isSkEnabled,
  SkTemporarilyUnavailableError,
  SkApiError,
  type SkTrxDetail,
} from "./client";

export type SkOrderItemLike = {
  product_id?: number;
  variant_id?: number | null;
  qty?: number;
  price?: number;
  name?: string;
  [key: string]: unknown;
};

export type SkProcessResult = {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
  blocked: number;
  reconciled: number;
};

export const SK_RETRY_DELAYS_MINUTES = [1, 5, 15];
export const SK_MAX_ATTEMPTS = 3;
const SK_FINAL_REJECTION = "PRODUCT_TEMPORARILY_UNAVAILABLE:final_rejection";
export const SK_CLAIM_LEASE_SECONDS = 120;
export const SK_SUBMITTED_STALE_MINUTES = 10;
/** Umur maksimum link blocked_balance yang boleh auto-revive (jam). */
export const SK_BLOCKED_MAX_AGE_HOURS = 24;

type Row = Record<string, unknown>;

export const SK_TERMINAL_STATUSES = ["completed", "failed"] as const;
export const SK_AMBIGUOUS_STATUSES = ["submitted", "ordering"] as const;
export const SK_LINK_STATUSES = [
  "pending",
  "claimed",
  "submitted",
  "ordering",
  "processing",
  "completed",
  "failed",
  "retry",
  "blocked_balance",
] as const;

export function isSkLinkStatus(status: unknown): status is (typeof SK_LINK_STATUSES)[number] {
  return (SK_LINK_STATUSES as readonly string[]).includes(String(status));
}

/** Correlation key stabil per kebutuhan pembelian canonical. */
export function skIdempotencyKey(orderCode: string, skVariantId: string, qty: number): string {
  return `sk:${orderCode}:${skVariantId}:${Math.max(1, Math.floor(Number(qty) || 1))}`;
}

/** ref_id upstream SK (idempoten di sisi SK — duplikat = ambil detail). */
export function skRefId(orderCode: string, skVariantId: string, qty: number): string {
  return skIdempotencyKey(orderCode, skVariantId, qty).slice(0, 191);
}

/** A signed webhook can arrive before POST /trx returns its invoice. */
export async function bindSkInvoiceByRef(
  refId: string,
  invoice: string,
  database?: DatabaseAccess,
): Promise<boolean> {
  if (!refId || !invoice) return false;
  const db = database ?? createDatabaseAccess();
  const link = await db.queryFirst(
    `SELECT id, order_code, sk_variant_id, quantity FROM sk_order_links
     WHERE idempotency_key=? OR
       (idempotency_key IS NULL AND 'sk:' || order_code || ':' || sk_variant_id || ':' || quantity=?)
     LIMIT 1`,
    refId, refId,
  );
  if (!link || skRefId(String(link.order_code), String(link.sk_variant_id), Number(link.quantity)) !== refId) return false;
  const bound = await db.execRun(
    `UPDATE sk_order_links SET sk_invoice=?, updated_at=datetime('now')
     WHERE id=? AND (COALESCE(sk_invoice,'')='' OR sk_invoice=?)`,
    invoice, Number(link.id), invoice,
  );
  return Number(bound.changes ?? 0) > 0;
}

/** Ambil sk_variant_id untuk varian Axvara (null bila bukan produk SK auto). */
export async function resolveSkVariantId(
  axvaraVariantId: number,
  db: DatabaseAccess,
): Promise<{ skVariantId: number; skCost: number; orderProcess: string } | null> {
  const row = await db
    .queryFirst(
      `SELECT pv.sk_variant_id, sp.sk_price, sp.sk_order_process
       FROM product_variants pv
       LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
       WHERE pv.id=? AND pv.sk_variant_id IS NOT NULL`,
      axvaraVariantId,
    )
    .catch(() => null);
  if (!row || !row.sk_variant_id) return null;
  return {
    skVariantId: Number(row.sk_variant_id),
    skCost: Number(row.sk_price || 0),
    orderProcess: String(row.sk_order_process || "auto"),
  };
}

export async function createSkOrderLink(
  orderCode: string,
  items: SkOrderItemLike[],
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) return 0;
  const need = new Map<number, { qty: number; skCost: number }>();
  for (const item of items) {
    const variantId = Number(item.variant_id || 0);
    if (!variantId) continue;
    const resolved = await resolveSkVariantId(variantId, db);
    // Fase 1: hanya auto. Varian SK non-auto tidak punya pasangan katalog
    // dari sync, tapi guard di sini menutup celah mapping manual yang salah.
    if (!resolved || resolved.orderProcess !== "auto") continue;
    const qty = Math.max(1, Math.floor(Number(item.qty || 1)));
    const prev = need.get(resolved.skVariantId);
    if (prev) {
      prev.qty += qty;
    } else {
      need.set(resolved.skVariantId, { qty, skCost: resolved.skCost });
    }
  }
  let created = 0;
  const createdLinkIds: number[] = [];
  for (const [skVariantId, { qty, skCost }] of need) {
    const key = skIdempotencyKey(orderCode, String(skVariantId), qty);
    try {
      const res = await db.execRun(
        `INSERT OR IGNORE INTO sk_order_links
          (order_code, sk_variant_id, quantity, sk_cost, status, attempt_count,
           max_attempts, next_attempt_at, idempotency_key)
          SELECT code, ?,?,?, 'pending', 0, ?, datetime('now'), ?
          FROM orders
          WHERE code=? AND ${PURCHASE_PAID_SQL}`,
        String(skVariantId),
        qty,
        skCost * qty,
        SK_MAX_ATTEMPTS,
        key,
        orderCode,
      );
      if (Number(res.changes ?? 0) > 0) {
        created++;
        const newId = Number((res as { lastInsertRowid?: number }).lastInsertRowid ?? 0);
        if (newId > 0) createdLinkIds.push(newId);
      }
    } catch {
      const existing = await db
        .queryFirst(
          `SELECT id FROM sk_order_links WHERE order_code=? AND sk_variant_id=?`,
          orderCode,
          String(skVariantId),
        )
        .catch(() => null);
      if (existing) continue;
      try {
        const res = await db.execRun(
          `INSERT INTO sk_order_links
            (order_code, sk_variant_id, quantity, sk_cost, status, attempt_count,
             max_attempts, next_attempt_at)
            SELECT code, ?,?,?, 'pending', 0, ?, datetime('now')
            FROM orders
            WHERE code=? AND ${PURCHASE_PAID_SQL}`,
          String(skVariantId),
          qty,
          skCost * qty,
          SK_MAX_ATTEMPTS,
          orderCode,
        );
        if (Number(res.changes ?? 0) > 0) {
          created++;
          const newId = Number((res as { lastInsertRowid?: number }).lastInsertRowid ?? 0);
          if (newId > 0) createdLinkIds.push(newId);
        }
      } catch {
        /* concurrent loser */
      }
    }
  }
  // Bind SAAT link dibuat (cermin WR): item fulfillment yang sudah
  // termaterialisasi langsung ditandai sk_link_id agar pipeline generik
  // melewatinya sejak detik pertama — akar balapan "manual_required" palsu
  // yang sempat tampil sebagai "Stok otomatis habis" di halaman pembeli.
  if (createdLinkIds.length) {
    try {
      const { bindSkLinkToFulfillmentItem } = await import("./deliver");
      for (const linkId of createdLinkIds) {
        await bindSkLinkToFulfillmentItem(linkId, db).catch(() => 0);
      }
    } catch { /* bind menyusul di penyelesaian; link tetap sah */ }
  }
  return created;
}

/** Deteksi item SK dari DB (dipakai hook payment yang hanya punya orderCode). */
export async function createSkOrderLinksForOrder(
  orderCode: string,
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) return 0;
  const order = await db.queryFirst(`SELECT items, status, payment_status, supplier_purchase_disabled FROM orders WHERE code=?`, orderCode).catch(() => null);
  if (!order || !isPaidForSupplierPurchase(order)) return 0;
  let items: SkOrderItemLike[] = [];
  try {
    const parsed = JSON.parse(String(order.items || "[]"));
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    return 0;
  }
  const enriched: SkOrderItemLike[] = [];
  for (const item of items) {
    const variantId = Number(item.variant_id || 0);
    if (!variantId) continue;
    const resolved = await resolveSkVariantId(variantId, db);
    if (resolved && resolved.orderProcess === "auto") enriched.push(item);
  }
  return createSkOrderLink(orderCode, enriched, db);
}

/** Reconciler: order lunas dengan varian SK tapi link belum lengkap. */
export async function reconcileMissingSkLinks(
  database?: DatabaseAccess,
  limit = 4,
): Promise<{ orders: number; links: number }> {
  const db = database ?? createDatabaseAccess();
  const out = { orders: 0, links: 0 };
  if (!isSkEnabled()) return out;
  const candidates = await db
    .queryAll(
      // Filter actual missing links in SQL, rather than spending one query per
      // item across the latest paid orders. Linked history must not starve buys.
      `SELECT o.code, o.items FROM orders o
       WHERE ${PURCHASE_PAID_SQL_ALIASED}
         AND datetime(COALESCE(o.paid_at, o.created_at)) > datetime('now','-7 days')
         AND EXISTS (
           SELECT 1 FROM json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) je
           JOIN product_variants pv
             ON pv.id = CAST(json_extract(CASE WHEN je.type='object' THEN je.value ELSE '{}' END, '$.variant_id') AS INTEGER)
           LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
           WHERE pv.sk_variant_id IS NOT NULL
             AND COALESCE(sp.sk_order_process, 'auto') = 'auto'
             AND NOT EXISTS (
               SELECT 1 FROM sk_order_links l
               WHERE l.order_code = o.code AND l.sk_variant_id = pv.sk_variant_id))
       ORDER BY o.id DESC LIMIT ?`,
      Math.max(1, Math.min(limit, 8)),
    );
  for (const candidate of candidates) {
    if (out.orders >= limit) break;
    if (!db.canSpend(4)) break;
    const code = String(candidate.code || "");
    if (!code) continue;
    let items: SkOrderItemLike[] = [];
    try {
      const parsed = JSON.parse(String(candidate.items || "[]"));
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      continue;
    }
    out.orders++;
    const made = await createSkOrderLink(code, items, db);
    out.links += made;
  }
  return out;
}

export async function processSkPendingOrders(
  database?: DatabaseAccess,
  options: { skipOrphanProbe?: boolean; orderCode?: string; limit?: number } = {},
): Promise<SkProcessResult> {
  const db = database ?? createDatabaseAccess();
  const result: SkProcessResult = { processed: 0, succeeded: 0, retried: 0, failed: 0, blocked: 0, reconciled: 0 };
  if (!isSkEnabled() || !isSkAutoOrderEnabled()) return result;
  if (!options.skipOrphanProbe) {
    try {
      const missing = await reconcileMissingSkLinks(db);
      result.reconciled = missing.links;
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      /* reconciler best-effort */
    }
  }
  const due = await db
    .queryAll(
      `SELECT l.* FROM sk_order_links l
       WHERE l.status IN ('pending','retry')
         AND l.attempt_count < l.max_attempts
          AND (l.next_attempt_at IS NULL OR datetime(l.next_attempt_at) <= datetime('now'))
          AND EXISTS (SELECT 1 FROM orders o WHERE o.code=l.order_code AND ${PURCHASE_PAID_SQL_ALIASED})
          AND NOT EXISTS (SELECT 1 FROM fulfillment_items fi LEFT JOIN product_variants pv ON pv.id=fi.variant_id
            WHERE fi.order_code=l.order_code AND (fi.sk_link_id=l.id OR fi.id=l.fulfillment_item_id OR pv.sk_variant_id=l.sk_variant_id)
              AND (COALESCE(fi.last_error,'') LIKE 'manual_handover:%' OR fi.delivered_message_id='manual'))
          ${options.orderCode ? "AND l.order_code=?" : ""}
       ORDER BY l.next_attempt_at ASC, l.id ASC LIMIT ?`,
      ...(options.orderCode ? [options.orderCode] : []),
      Math.max(1, Math.min(20, Math.floor(options.limit ?? 20))),
    )
    .catch((error) => {
      if (error instanceof QueryBudgetExceeded) throw error;
      return [] as Row[];
    });
  for (const link of due) {
    if (!db.canSpend(Number(link.attempt_count) + 1 >= Number(link.max_attempts) ? 14 : 6)) throw new QueryBudgetExceeded();
    result.processed++;
    const outcome = await processOneSkLink(link, db);
    if (outcome === "succeeded") result.succeeded++;
    else if (outcome === "retried") result.retried++;
    else if (outcome === "blocked") result.blocked++;
    else result.failed++;
  }
  return result;
}

async function claimSkLink(
  link: Row,
  db: DatabaseAccess,
): Promise<{ outcome: "claimed"; leaseOwner: string } | { outcome: "ambiguous" } | { outcome: "lost" }> {
  const id = Number(link.id);
  const attempt = Number(link.attempt_count || 0) + 1;
  const leaseOwner = `sk-cron-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const leaseUntil = new Date(Date.now() + SK_CLAIM_LEASE_SECONDS * 1000).toISOString();
  const fresh = await claimFreshPurchase(db, "sk", id, attempt, leaseOwner, leaseUntil);
  if (Number(fresh.changes ?? 0) > 0) return { outcome: "claimed", leaseOwner };
  const stale = await claimStalePurchase(db, "sk", id, attempt, leaseOwner, leaseUntil);
  if (Number(stale.changes ?? 0) > 0) return { outcome: "claimed", leaseOwner };
  const current = await db
    .queryFirst(`SELECT status, request_sent_at FROM sk_order_links WHERE id=?`, id)
    .catch(() => null);
  if (current && String(current.request_sent_at || "") !== "") return { outcome: "ambiguous" };
  if (current && (SK_AMBIGUOUS_STATUSES as readonly string[]).includes(String(current.status))) {
    return { outcome: "ambiguous" };
  }
  return { outcome: "lost" };
}

async function processOneSkLink(link: Row, db: DatabaseAccess): Promise<"succeeded" | "retried" | "failed" | "blocked"> {
  const { execRun } = db;
  const id = Number(link.id);
  const attempt = Number(link.attempt_count || 0) + 1;
  const claim = await claimSkLink(link, db);
  if (claim.outcome === "lost") return "retried";
  if (claim.outcome === "ambiguous") {
    await reconcileAmbiguousSkLink(id, db).catch(() => undefined);
    return "retried";
  }
  let reason = "";
  let blocked = false;
  try {
    const variantId = Number(link.sk_variant_id);
    const qty = Number(link.quantity);
    const item = await fetchSkItemDetail(variantId);
    if (!Number.isSafeInteger(variantId) || variantId <= 0 || !Number.isSafeInteger(qty) || qty <= 0
      || !item || item.id !== variantId || item.order_process !== "auto"
      || (item.status != null && item.status !== "on")
      || typeof item.price !== "number" || !Number.isFinite(item.price) || item.price <= 0
      || !Number.isFinite(item.price * qty) || typeof item.stock !== "number" || !Number.isFinite(item.stock)
      || (item.stock !== -1 && item.stock < qty)) {
      reason = "preflight_item_unavailable";
    } else {
      const balance = (await fetchSkBalance())?.balance;
      if (typeof balance !== "number" || !Number.isFinite(balance) || balance < 0) reason = "preflight_balance_unavailable";
      else if (balance < item.price * qty) { reason = "preflight_insufficient_balance"; blocked = true; }
    }
  } catch {
    reason = "preflight_unavailable";
  }
  if (!isSkAutoOrderEnabled()) reason = "preflight_disabled";
  if (reason) {
    const deferred = await execRun(
      `UPDATE sk_order_links SET status=?, last_error=?, attempt_count=MAX(0, attempt_count-1),
         lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=datetime('now','+3 minutes'), updated_at=datetime('now')
       WHERE id=? AND status='claimed' AND lease_owner=? AND request_sent_at IS NULL`,
      blocked && reason === "preflight_insufficient_balance" ? "blocked_balance" : "retry", reason, id, claim.leaseOwner,
    );
    if (blocked && reason === "preflight_insufficient_balance" && Number(deferred.changes ?? 0) > 0) {
      if (link.last_error !== reason && process.env.TELEGRAM_ADMIN_CHAT_ID && process.env.TELEGRAM_BOT_ENABLED === "true") {
        try {
          const { sendMessage } = await import("@/lib/telegram/api");
          const { escapeHtml } = await import("@/lib/telegram/messages/format");
          await sendMessage({ chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
            text: `💰 <b>Saldo Sekalipay habis</b>\nOrder <code>${escapeHtml(String(link.order_code))}</code> diblokir sementara (tidak makan retry). Top up untuk memulihkan otomatis.`, parse_mode: "HTML" });
        } catch { /* best-effort; blok saldo tetap durable */ }
      }
      await notifySkBlockedBuyer(String(link.order_code), db);
      return "blocked";
    }
    return "retried";
  }
  const sent = await fencePurchaseSend(db, "sk", id, claim.leaseOwner);
  if (!Number(sent.changes ?? 0)) return "retried";
  try {
    const skVariantId = Number(String(link.sk_variant_id));
    const qty = Math.max(1, Number(link.quantity || 1));
    const refId = skRefId(String(link.order_code), String(link.sk_variant_id), qty);
    // Varian auto tidak butuh note (required_fields kosong/opsional) — fase 1
    // tidak pernah mengirim note agar tidak kena 422 REQUIRED_FIELD_MISSING.
    const created = await createSkTransaction({
      refId,
      carts: [{ item_id: skVariantId, quantity: qty }],
    });
    const assigned = await execRun(
      `UPDATE sk_order_links SET status='processing', sk_invoice=?,
         last_error=NULL, lease_owner=NULL, lease_expires_at=NULL,
         updated_at=datetime('now') WHERE id=? AND status='claimed'
         AND (COALESCE(sk_invoice,'')='' OR sk_invoice=?)`,
      String(created.invoice),
      id,
      String(created.invoice),
    );
    if (!Number(assigned.changes ?? 0)) return "retried";
    return "succeeded";
  } catch (error) {
    return handleSkOrderError(link, claim.leaseOwner, error, attempt, db);
  }
}

/** Reconcile link ambigu via GET /v1/trx/{ref_id} (SK punya ref_id idempoten). */
async function reconcileAmbiguousSkLink(id: number, db: DatabaseAccess, onLookupFailure?: (error: unknown) => void): Promise<boolean> {
  const link = await db.queryFirst(`SELECT * FROM sk_order_links WHERE id=?`, id);
  if (!link) return false;
  const qty = Math.max(1, Number(link.quantity || 1));
  const refId = skRefId(String(link.order_code), String(link.sk_variant_id), qty);
  let detail: SkTrxDetail;
  try {
    detail = await fetchSkTransaction(refId);
  } catch (error) {
    // Preserve the sent claim and stable ref_id. A 404/timeout is not proof
    // that the purchase can be replayed, but admin must see why it is stuck.
    const reason = error instanceof SkApiError ? `ambiguous_lookup_http_${error.status}` : "ambiguous_lookup_unavailable";
    await db.execRun(`UPDATE sk_order_links SET last_error=?
      WHERE id=? AND status IN ('claimed','submitted','ordering')`, reason, id);
    if (!(error instanceof SkApiError && error.status === 404)) onLookupFailure?.(error);
    return false;
  }
  const status = String(detail.status || "").toLowerCase();
  // Persist the recovered invoice BEFORE completion looks the link up by it.
  // Never POST again: the original purchase may already have consumed stock.
  const invoice = String(detail.invoice || link.sk_invoice || "");
  if (!invoice || (detail.ref_id && detail.ref_id !== refId)) return false;
  if (!(await bindSkInvoiceByRef(refId, invoice, db))) return false;
  const { handleSkOrderCompleted, handleSkOrderFailed } = await import("./deliver");
  if (status.includes("complet") || status.includes("success") || status.includes("done")) {
    return handleSkOrderCompleted(invoice, detail, db);
  }
  if (status.includes("fail") || status.includes("cancel") || status.includes("refund")) {
    return handleSkOrderFailed(invoice, status, db);
  }
  // paid/pending: catat invoice, tetap processing untuk reconcile berikutnya.
  if (String(detail.invoice || "")) {
    await db
      .execRun(
        `UPDATE sk_order_links SET sk_invoice=?, status='processing',
           last_error=NULL, lease_owner=NULL, lease_expires_at=NULL,
           updated_at=datetime('now') WHERE id=?
           AND status IN ('claimed','submitted','ordering','processing')`,
        String(detail.invoice),
        id,
      )
      .catch(() => undefined);
    return true;
  }
  return false;
}

async function handleSkOrderError(
  link: Row,
  owner: string,
  error: unknown,
  attempt: number,
  db: DatabaseAccess,
): Promise<"retried" | "failed" | "blocked"> {
  const { execRun } = db;
  const id = Number(link.id);
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  // REF_ID_ALREADY_EXIST = order sudah ada di SK (retry aman): ambil detail,
  // jangan hitung sebagai gagal.
  if (/REF_ID_ALREADY_EXIST/i.test(message)) {
    await reconcileAmbiguousSkLink(id, db).catch(() => false);
    return "retried";
  }
  // Only this explicit pre-debit rejection may clear the sent fence. All
  // ambiguous errors keep it, even on the last attempt or after GET 404.
  if (error instanceof SkTemporarilyUnavailableError && message === "PRODUCT_TEMPORARILY_UNAVAILABLE") {
    const exhausted = attempt >= Number(link.max_attempts ?? SK_MAX_ATTEMPTS);
    const changed = await execRun(
      `UPDATE sk_order_links SET status='retry', last_error=?, request_sent_at=NULL,
         lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=?, updated_at=datetime('now') WHERE id=? AND status='claimed'
           AND lease_owner=? AND attempt_count=? AND request_sent_at IS NOT NULL AND COALESCE(sk_invoice,'')=''`,
      exhausted ? SK_FINAL_REJECTION : message,
      exhausted ? null : nextPurchaseAttemptIso(attempt, SK_RETRY_DELAYS_MINUTES),
      id, owner, attempt,
    );
    if (exhausted && changed.changes && await settleExhaustedSkRetries(db, id)) return "failed";
    return "retried";
  }
  await execRun(
    `UPDATE sk_order_links SET status='submitted', last_error=?, lease_owner=NULL, lease_expires_at=NULL,
       next_attempt_at=datetime('now','+${SK_SUBMITTED_STALE_MINUTES} minutes'), updated_at=datetime('now')
     WHERE id=? AND status='claimed'`,
    `ambiguous: ${message}`, id,
  );
  return "retried";
}

// Only the explicit final rejection can write the proof above. A legacy
// retry error or last_claim_at can describe an earlier attempt (or a claim
// which never sent). Leave those links to the read-only aging watchdog.
const EXHAUSTED_SK_CAS = `status='retry' AND attempt_count>=max_attempts AND request_sent_at IS NULL
  AND COALESCE(sk_invoice,'')='' AND lease_owner IS NULL AND last_error='${SK_FINAL_REJECTION}'`;

export async function settleExhaustedSkRetries(db: DatabaseAccess, linkId?: number): Promise<number> {
  if (!db.d1 || !db.canSpend(11)) return 0;
  const link = await db.queryFirst(`SELECT l.id, l.order_code, fi.id AS item_id
    FROM (SELECT * FROM sk_order_links WHERE ${EXHAUSTED_SK_CAS} ${linkId === undefined ? "" : "AND id=?"}) l
    JOIN orders o ON o.code=l.order_code AND ${PURCHASE_PAID_SQL_ALIASED}
    JOIN fulfillment_items fi ON fi.order_code=l.order_code
    LEFT JOIN product_variants pv ON pv.id=fi.variant_id
    WHERE (fi.id=l.fulfillment_item_id OR (l.fulfillment_item_id IS NULL AND pv.sk_variant_id=l.sk_variant_id))
      AND (fi.sk_link_id IS NULL OR fi.sk_link_id=l.id) AND fi.status NOT IN ('delivered','sending','failed')
      AND COALESCE(fi.last_error,'') NOT LIKE 'manual_handover:%' AND COALESCE(fi.delivered_message_id,'')!='manual'
    ORDER BY l.id, fi.item_index LIMIT 1`, ...(linkId === undefined ? [] : [linkId]));
  if (!link) return 0;
  const code = String(link.order_code);
  // Repeat the paid, binding and send fences inside one D1 transaction. No
  // item transition means no link failure. The aggregate waits for mixed carts.
  const [item, failed] = await db.d1.batch([
    db.d1.prepare(`UPDATE fulfillment_items AS fi SET sk_link_id=?,status='failed',last_error='sk_attempts_exhausted',
      locked_until=NULL,updated_at=datetime('now')
      WHERE id=? AND order_code=? AND (sk_link_id IS NULL OR sk_link_id=?) AND status NOT IN ('delivered','sending','failed')
        AND COALESCE(last_error,'') NOT LIKE 'manual_handover:%' AND COALESCE(delivered_message_id,'')!='manual'
        AND EXISTS(SELECT 1 FROM sk_order_links WHERE id=? AND order_code=fi.order_code AND ${EXHAUSTED_SK_CAS}
          AND (fulfillment_item_id=fi.id OR (fulfillment_item_id IS NULL
            AND sk_variant_id=(SELECT pv.sk_variant_id FROM product_variants pv WHERE pv.id=fi.variant_id))))
        AND EXISTS(SELECT 1 FROM orders WHERE code=fi.order_code AND status='lunas' AND payment_status='paid'
          AND supplier_purchase_disabled=0)`).bind(link.id, link.item_id, code, link.id, link.id),
    db.d1.prepare(`UPDATE sk_order_links SET status='failed',fulfillment_item_id=?,next_attempt_at=NULL,updated_at=datetime('now')
      WHERE id=? AND ${EXHAUSTED_SK_CAS}
        AND EXISTS(SELECT 1 FROM fulfillment_items WHERE id=? AND order_code=sk_order_links.order_code
          AND sk_link_id=sk_order_links.id AND status='failed' AND last_error='sk_attempts_exhausted')`).bind(link.item_id, link.id, link.item_id),
    db.d1.prepare(`UPDATE orders SET fulfillment_status='failed',updated_at=datetime('now')
      WHERE code=? AND status='lunas' AND payment_status='paid' AND COALESCE(fulfillment_status,'') NOT IN ('delivered','failed')
        AND EXISTS(SELECT 1 FROM sk_order_links l JOIN fulfillment_items fi ON fi.id=l.fulfillment_item_id
          WHERE l.id=? AND l.order_code=orders.code AND l.status='failed' AND l.last_error=?
            AND fi.sk_link_id=l.id AND fi.status='failed' AND fi.last_error='sk_attempts_exhausted')
        AND NOT EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=orders.code AND status NOT IN ('delivered','manual_required','failed'))`).bind(code, link.id, SK_FINAL_REJECTION),
  ]);
  if (!item.meta?.changes || !failed.meta?.changes) return 0;
  await alertSupplierAdminOnce(db, code, `sk-exhausted:${code}`,
    `⚠️ <b>Order Sekalipay gagal</b> <code>${escapeHtml(code)}</code>\nPercobaan habis. Cek antrean untuk penyelesaian manual.`).catch(() => false);
  const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
  await notifyBuyerDeliveryFailed(code, db);
  return 1;
}

/** Page once for unresolved premium links, without touching status or fences. */
export async function alertAgingSkOrders(db: DatabaseAccess): Promise<number> {
  if (!process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_BOT_ENABLED !== "true" || !db.canSpend(3)) return 0;
  const rows = await db.queryAll(`SELECT l.id,l.order_code,l.status FROM sk_order_links l JOIN orders o ON o.code=l.order_code
    WHERE (l.status IN ('submitted','ordering','processing') OR (l.status IN ('pending','retry') AND l.attempt_count>=l.max_attempts))
      AND o.status='lunas' AND o.payment_status='paid'
      AND datetime(COALESCE(l.request_sent_at,l.created_at)) <= datetime('now','-13 hours')
      AND NOT EXISTS(SELECT 1 FROM buyer_notice_log b WHERE b.idempotency_key='admin:sk-aging:'||l.id)
    ORDER BY l.id LIMIT 3`);
  let alerted = 0;
  for (const row of rows) {
    if (!db.canSpend(2)) break;
    if (await alertSupplierAdminOnce(db, String(row.order_code), `sk-aging:${row.id}`,
      `⏳ <b>Order Sekalipay tertahan lebih dari 13 jam</b> <code>${escapeHtml(String(row.order_code))}</code>\nCek link #${Number(row.id)} (${escapeHtml(String(row.status))}) tanpa membeli ulang.`)) alerted++;
  }
  return alerted;
}

/** Kabar best-effort ke PEMBELI saat link SK tertahan saldo (cermin WR). */
export async function notifySkBlockedBuyer(orderCode: string, database?: DatabaseAccess): Promise<void> {
  try {
    const { notifyBuyerSkBlocked } = await import("@/lib/notify-buyer");
    await notifyBuyerSkBlocked(orderCode, database ?? createDatabaseAccess());
  } catch { /* kabar pembeli best-effort; link tetap blocked_balance */ }
}

export async function reconcileBlockedSkBalance(
  database?: DatabaseAccess,
  options: { reportLookupFailure?: boolean } = {},
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkAutoOrderEnabled()) return 0;
  const blocked = await db
    .queryAll(
      `SELECT l.id, l.sk_cost, l.last_error FROM sk_order_links l
       WHERE l.status='blocked_balance' AND l.request_sent_at IS NULL AND COALESCE(l.sk_invoice,'')=''
          AND (CASE WHEN l.last_error='preflight_insufficient_balance' THEN datetime(l.created_at) >= datetime('now','-${SK_BLOCKED_MAX_AGE_HOURS} hours')
            ELSE datetime(l.updated_at) IS NULL OR datetime(l.updated_at) >= datetime('now','-${SK_BLOCKED_MAX_AGE_HOURS} hours') END)
         AND (COALESCE(l.last_error,'')!='preflight_insufficient_balance' OR l.next_attempt_at IS NULL OR datetime(l.next_attempt_at) <= datetime('now'))
         AND EXISTS (SELECT 1 FROM orders o WHERE o.code=l.order_code AND ${PURCHASE_PAID_SQL_ALIASED})
         AND NOT EXISTS (SELECT 1 FROM fulfillment_items fi LEFT JOIN product_variants pv ON pv.id=fi.variant_id
           WHERE fi.order_code=l.order_code AND (fi.sk_link_id=l.id OR fi.id=l.fulfillment_item_id OR pv.sk_variant_id=l.sk_variant_id)
             AND (COALESCE(fi.last_error,'') LIKE 'manual_handover:%' OR fi.delivered_message_id='manual'))
       ORDER BY l.id ASC LIMIT 8`,
    );
  if (!blocked.length) return 0;
  let balance: number;
  try {
    balance = (await fetchSkBalance()).balance;
    if (typeof balance !== "number" || !Number.isFinite(balance) || balance < 0) throw new Error("invalid_sk_balance");
  } catch (error) {
    if (options.reportLookupFailure) throw error;
    return 0;
  }
  let revived = 0;
  for (const row of blocked) {
    if (!isSkAutoOrderEnabled()) break;
    if (row.last_error !== "preflight_insufficient_balance" && balance < Number(row.sk_cost || 0)) continue;
    const res = await db
      .execRun(
        `UPDATE sk_order_links SET status='pending',
           last_error=CASE WHEN last_error='preflight_insufficient_balance' THEN last_error ELSE NULL END,
           next_attempt_at=datetime('now'), updated_at=datetime('now')
         WHERE id=? AND status='blocked_balance' AND request_sent_at IS NULL AND COALESCE(sk_invoice,'')=''
           AND COALESCE(last_error,'')=?
            AND (CASE WHEN last_error='preflight_insufficient_balance' THEN datetime(created_at) >= datetime('now','-${SK_BLOCKED_MAX_AGE_HOURS} hours')
              ELSE datetime(updated_at) IS NULL OR datetime(updated_at) >= datetime('now','-${SK_BLOCKED_MAX_AGE_HOURS} hours') END)
           AND (COALESCE(last_error,'')!='preflight_insufficient_balance' OR next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
           AND EXISTS (SELECT 1 FROM orders o WHERE o.code=sk_order_links.order_code AND ${PURCHASE_PAID_SQL_ALIASED})
           AND NOT EXISTS (SELECT 1 FROM fulfillment_items fi LEFT JOIN product_variants pv ON pv.id=fi.variant_id
             WHERE fi.order_code=sk_order_links.order_code AND (fi.sk_link_id=sk_order_links.id OR fi.id=sk_order_links.fulfillment_item_id OR pv.sk_variant_id=sk_order_links.sk_variant_id)
               AND (COALESCE(fi.last_error,'') LIKE 'manual_handover:%' OR fi.delivered_message_id='manual'))`,
        Number(row.id), String(row.last_error || ""),
      );
    if (Number(res.changes ?? 0) > 0) revived++;
  }
  return revived;
}

export async function retryFailedSkOrders(database?: DatabaseAccess): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled() || !isSkAutoOrderEnabled()) return 0;
  const res = await db
    .execRun(
      `UPDATE sk_order_links SET next_attempt_at=datetime('now'), updated_at=datetime('now')
       WHERE status='retry' AND attempt_count < max_attempts
         AND datetime(next_attempt_at) <= datetime('now')
         AND EXISTS (SELECT 1 FROM orders o WHERE o.code=sk_order_links.order_code AND ${PURCHASE_PAID_SQL_ALIASED})`,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  return Number(res.changes ?? 0);
}

/** Webhook order.paid: tandai link processing (monotonik). */
export async function handleSkOrderPaid(
  skInvoice: string,
  database?: DatabaseAccess,
  eventId?: string,
): Promise<boolean> {
  const { advanceSkLinkMonotonic } = await import("./deliver");
  return advanceSkLinkMonotonic(skInvoice, "processing", null, database, eventId);
}

/**
 * Tarik status SATU invoice SK sekarang via GET /v1/trx (read-only,
 * idempoten). Dipakai penyegar bersama (`supplier-refresh`) agar perilaku SK
 * dan WR sama: siapa pun yang bertanya (poll pembeli, cron, admin) mendapat
 * status vendor saat ini, bukan menunggu webhook. Mengembalikan true bila
 * invoice mencapai status terminal pada panggilan ini.
 */
export async function reconcileSkInvoiceNow(
  skInvoice: string,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) return false;
  const invoice = String(skInvoice || "").trim();
  if (!invoice) return false;
  let detail: SkTrxDetail;
  try {
    detail = await fetchSkTransaction(invoice);
  } catch {
    return false;
  }
  // Polling can also start from ref_id when dispatch lost its invoice.
  const resolvedInvoice = String(detail.invoice || invoice);
  if (resolvedInvoice !== invoice) {
    if (detail.ref_id !== invoice || !(await bindSkInvoiceByRef(invoice, resolvedInvoice, db))) return false;
  }
  const status = String(detail.status || "").toLowerCase();
  const { handleSkOrderCompleted, handleSkOrderFailed } = await import("./deliver");
  if (status.includes("complet") || status.includes("success") || status.includes("done")) {
    return handleSkOrderCompleted(resolvedInvoice, detail, db);
  }
  if (status.includes("fail") || status.includes("cancel") || status.includes("refund")) {
    return handleSkOrderFailed(resolvedInvoice, status, db);
  }
  if (resolvedInvoice !== invoice) await handleSkOrderPaid(resolvedInvoice, db);
  return false;
}

/** Sinkronisasi status processing/ambigu menggantung via GET /v1/trx. */
export async function reconcileStuckSkOrders(database?: DatabaseAccess, options: { reportLookupFailure?: boolean } = {}): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) return 0;
  const stuck = await db
    .queryAll(
      `SELECT sk_invoice, order_code, id FROM sk_order_links
       WHERE status IN ('processing','submitted','ordering')
         AND datetime(COALESCE(request_sent_at, updated_at)) <= datetime('now','-1 hour')
       ORDER BY RANDOM() LIMIT 8`,
    );
  if (!stuck.length) return 0;
  const { handleSkOrderCompleted, handleSkOrderFailed } = await import("./deliver");
  let reconciled = 0;
  let lookupFailure: unknown;
  for (const row of stuck) {
    const invoice = String(row.sk_invoice || "");
    if (!invoice) continue;
    let detail: SkTrxDetail;
    try {
      detail = await fetchSkTransaction(invoice);
    } catch (error) {
      if (!(error instanceof SkApiError && error.status === 404)) lookupFailure = error;
      continue;
    }
    const status = String(detail.status || "").toLowerCase();
    if (status.includes("complet") || status.includes("success") || status.includes("done")) {
      await handleSkOrderCompleted(invoice, detail, db);
      reconciled++;
    } else if (status.includes("fail") || status.includes("cancel") || status.includes("refund")) {
      await handleSkOrderFailed(invoice, status, db);
      reconciled++;
    }
  }
  if (options.reportLookupFailure && lookupFailure) throw lookupFailure;
  return reconciled;
}

/**
 * Reconcile link SK FRESH (umur 2 menit–1 jam) via GET /v1/trx — cermin
 * `reconcileFreshWrLinks` (2026-10-04). SK auto selesai hitungan detik; bila
 * webhook `order.completed` tidak sampai, dulu pembeli menunggu ambang 1 jam
 * `reconcileStuckSkOrders`. Read-only upstream + idempoten (tidak beli ulang).
 * Dibatasi `limit` per run; yang tertua lebih dulu.
 */
export async function reconcileFreshSkOrders(database?: DatabaseAccess, limit = 3): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) return 0;
  const fresh = await db
    .queryAll(
      `SELECT sk_invoice FROM sk_order_links
       WHERE status='processing' AND COALESCE(sk_invoice,'')!=''
         AND datetime(COALESCE(request_sent_at, updated_at)) <= datetime('now','-2 minutes')
         AND datetime(COALESCE(request_sent_at, updated_at)) > datetime('now','-1 hour')
       ORDER BY COALESCE(request_sent_at, updated_at) ASC, id ASC LIMIT ?`,
      Math.max(1, Math.min(limit, 6)),
    )
    .catch(() => [] as Row[]);
  if (!fresh.length) return 0;
  const { handleSkOrderCompleted, handleSkOrderFailed } = await import("./deliver");
  let reconciled = 0;
  for (const row of fresh) {
    const invoice = String(row.sk_invoice || "");
    let detail: SkTrxDetail;
    try {
      detail = await fetchSkTransaction(invoice);
    } catch {
      continue;
    }
    const status = String(detail.status || "").toLowerCase();
    if (status.includes("complet") || status.includes("success") || status.includes("done")) {
      await handleSkOrderCompleted(invoice, detail, db);
      reconciled++;
    } else if (status.includes("fail") || status.includes("cancel") || status.includes("refund")) {
      await handleSkOrderFailed(invoice, status, db);
      reconciled++;
    }
  }
  return reconciled;
}

export async function recoverStaleSkClaims(database?: DatabaseAccess, options: { reportLookupFailure?: boolean } = {}): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) return 0;
  const res = await db
    .execRun(
      `UPDATE sk_order_links SET status='pending', lease_owner=NULL,
         attempt_count=MAX(0, attempt_count-1),
         lease_expires_at=NULL, last_error='stale_claim_recovered',
         updated_at=datetime('now')
       WHERE status='claimed' AND request_sent_at IS NULL AND COALESCE(sk_invoice,'')=''
         AND lease_expires_at IS NOT NULL
         AND datetime(lease_expires_at) <= datetime('now')`,
    );
  // A Worker can die AFTER request_sent_at but BEFORE storing the invoice.
  // Those claims must be read back by stable ref_id, never requeued to buy.
  const ambiguous = await db.queryAll(
    `SELECT id FROM sk_order_links
     WHERE ((status='claimed' AND request_sent_at IS NOT NULL
       AND (lease_expires_at IS NULL OR datetime(lease_expires_at) <= datetime('now')))
       OR status IN ('submitted','ordering'))
       AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
     ORDER BY COALESCE(next_attempt_at, request_sent_at, created_at) ASC, id ASC LIMIT 12`,
  );
  let recovered = Number(res.changes ?? 0);
  let lookupFailure: unknown;
  for (const row of ambiguous) {
    if (!db.canSpend(17)) throw new QueryBudgetExceeded();
    // Fence concurrent cron runs and rotate failed lookups behind other due
    // links; an upstream 404/timeout must not occupy the first three forever.
    const claimed = await db.execRun(
      `UPDATE sk_order_links SET next_attempt_at=datetime('now','+1 minute')
       WHERE id=? AND status IN ('claimed','submitted','ordering')
         AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`,
      Number(row.id),
    );
    if (Number(claimed.changes ?? 0) === 0) continue;
    if (await reconcileAmbiguousSkLink(Number(row.id), db, error => { lookupFailure = error; })) recovered++;
  }
  if (options.reportLookupFailure && lookupFailure) throw lookupFailure;
  return recovered;
}

export type { SkOrderLinkRow } from "./deliver";
export { handleSkOrderCompleted, handleSkOrderFailed } from "./deliver";
