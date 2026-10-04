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

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import {
  createSkTransaction,
  fetchSkTransaction,
  isSkAutoOrderEnabled,
  isSkEnabled,
  SkInsufficientBalanceError,
  SkOutOfStockError,
  SkTemporarilyUnavailableError,
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

function nextAttemptIso(attempt: number): string {
  const minutes =
    SK_RETRY_DELAYS_MINUTES[Math.min(Math.max(attempt - 1, 0), SK_RETRY_DELAYS_MINUTES.length - 1)];
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Correlation key stabil per kebutuhan pembelian canonical. */
export function skIdempotencyKey(orderCode: string, skVariantId: string, qty: number): string {
  return `sk:${orderCode}:${skVariantId}:${Math.max(1, Math.floor(Number(qty) || 1))}`;
}

/** ref_id upstream SK (idempoten di sisi SK — duplikat = ambil detail). */
export function skRefId(orderCode: string, skVariantId: string, qty: number): string {
  return skIdempotencyKey(orderCode, skVariantId, qty).slice(0, 191);
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
  for (const [skVariantId, { qty, skCost }] of need) {
    const key = skIdempotencyKey(orderCode, String(skVariantId), qty);
    try {
      const res = await db.execRun(
        `INSERT OR IGNORE INTO sk_order_links
          (order_code, sk_variant_id, quantity, sk_cost, status, attempt_count,
           max_attempts, next_attempt_at, idempotency_key)
         VALUES (?,?,?,?, 'pending', 0, ?, datetime('now'), ?)`,
        orderCode,
        String(skVariantId),
        qty,
        skCost * qty,
        SK_MAX_ATTEMPTS,
        key,
      );
      if (Number(res.changes ?? 0) > 0) created++;
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
        await db.execRun(
          `INSERT INTO sk_order_links
            (order_code, sk_variant_id, quantity, sk_cost, status, attempt_count,
             max_attempts, next_attempt_at)
           VALUES (?,?,?,?, 'pending', 0, ?, datetime('now'))`,
          orderCode,
          String(skVariantId),
          qty,
          skCost * qty,
          SK_MAX_ATTEMPTS,
        );
        created++;
      } catch {
        /* concurrent loser */
      }
    }
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
  const order = await db.queryFirst(`SELECT items FROM orders WHERE code=?`, orderCode).catch(() => null);
  if (!order) return 0;
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
      `SELECT code, items FROM orders
       WHERE status='lunas' AND payment_status='paid'
         AND datetime(COALESCE(paid_at, created_at)) > datetime('now','-7 days')
       ORDER BY id DESC LIMIT ?`,
      Math.max(1, Math.min(limit * 3, 24)),
    )
    .catch(() => [] as Row[]);
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
    const skVariantIds = new Set<string>();
    for (const item of items) {
      const variantId = Number(item.variant_id || 0);
      if (!variantId) continue;
      const resolved = await resolveSkVariantId(variantId, db).catch(() => null);
      if (resolved && resolved.orderProcess === "auto") skVariantIds.add(String(resolved.skVariantId));
    }
    if (!skVariantIds.size) continue;
    const existing = await db
      .queryAll(`SELECT sk_variant_id FROM sk_order_links WHERE order_code=?`, code)
      .catch(() => [] as Row[]);
    const have = new Set(existing.map((r) => String(r.sk_variant_id || "")));
    const missing = [...skVariantIds].filter((v) => !have.has(v));
    if (!missing.length) continue;
    out.orders++;
    const made = await createSkOrderLink(code, items, db).catch(() => 0);
    out.links += made;
  }
  return out;
}

export async function processSkPendingOrders(
  database?: DatabaseAccess,
): Promise<SkProcessResult> {
  const db = database ?? createDatabaseAccess();
  const result: SkProcessResult = { processed: 0, succeeded: 0, retried: 0, failed: 0, blocked: 0, reconciled: 0 };
  if (!isSkEnabled() || !isSkAutoOrderEnabled()) return result;
  try {
    const missing = await reconcileMissingSkLinks(db);
    result.reconciled = missing.links;
  } catch {
    /* reconciler best-effort */
  }
  const due = await db
    .queryAll(
      `SELECT l.* FROM sk_order_links l
       WHERE l.status IN ('pending','retry')
         AND l.attempt_count < l.max_attempts
         AND (l.next_attempt_at IS NULL OR datetime(l.next_attempt_at) <= datetime('now'))
       ORDER BY l.next_attempt_at ASC, l.id ASC LIMIT 4`,
    )
    .catch(() => [] as Row[]);
  for (const link of due) {
    if (!db.canSpend(6)) break;
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
): Promise<{ outcome: "claimed" } | { outcome: "ambiguous" } | { outcome: "lost" }> {
  const id = Number(link.id);
  const attempt = Number(link.attempt_count || 0) + 1;
  const leaseOwner = `sk-cron-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const leaseUntil = new Date(Date.now() + SK_CLAIM_LEASE_SECONDS * 1000).toISOString();
  const fresh = await db
    .execRun(
      `UPDATE sk_order_links SET status='claimed', attempt_count=?,
         lease_owner=?, lease_expires_at=?, last_claim_at=datetime('now'),
         updated_at=datetime('now')
       WHERE id=? AND status IN ('pending','retry')`,
      attempt,
      leaseOwner,
      leaseUntil,
      id,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  if (Number(fresh.changes ?? 0) > 0) return { outcome: "claimed" };
  const stale = await db
    .execRun(
      `UPDATE sk_order_links SET status='claimed', attempt_count=?,
         lease_owner=?, lease_expires_at=?, last_claim_at=datetime('now'),
         updated_at=datetime('now')
       WHERE id=? AND status='claimed' AND request_sent_at IS NULL
         AND (lease_expires_at IS NULL OR datetime(lease_expires_at) <= datetime('now'))`,
      attempt,
      leaseOwner,
      leaseUntil,
      id,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  if (Number(stale.changes ?? 0) > 0) return { outcome: "claimed" };
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
  await execRun(
    `UPDATE sk_order_links SET request_sent_at=datetime('now'), updated_at=datetime('now')
     WHERE id=? AND status='claimed'`,
    id,
  ).catch(() => undefined);
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
    await execRun(
      `UPDATE sk_order_links SET status='processing', sk_invoice=?,
         last_error=NULL, lease_owner=NULL, lease_expires_at=NULL,
         updated_at=datetime('now') WHERE id=?`,
      String(created.invoice),
      id,
    );
    return "succeeded";
  } catch (error) {
    return handleSkOrderError(id, link, error, attempt, db);
  }
}

/** Reconcile link ambigu via GET /v1/trx/{ref_id} (SK punya ref_id idempoten). */
async function reconcileAmbiguousSkLink(id: number, db: DatabaseAccess): Promise<boolean> {
  const link = await db.queryFirst(`SELECT * FROM sk_order_links WHERE id=?`, id).catch(() => null);
  if (!link) return false;
  const qty = Math.max(1, Number(link.quantity || 1));
  const refId = skRefId(String(link.order_code), String(link.sk_variant_id), qty);
  let detail: SkTrxDetail;
  try {
    detail = await fetchSkTransaction(refId);
  } catch {
    return false;
  }
  const status = String(detail.status || "").toLowerCase();
  const { handleSkOrderCompleted, handleSkOrderFailed } = await import("./deliver");
  if (status.includes("complet") || status.includes("success") || status.includes("done")) {
    await handleSkOrderCompleted(String(detail.invoice || refId), detail, db);
    return true;
  }
  if (status.includes("fail") || status.includes("cancel") || status.includes("refund")) {
    await handleSkOrderFailed(String(detail.invoice || refId), status, db);
    return true;
  }
  // paid/pending: catat invoice, tetap processing untuk reconcile berikutnya.
  if (String(detail.invoice || "")) {
    await db
      .execRun(
        `UPDATE sk_order_links SET sk_invoice=?, status='processing',
           last_error=NULL, updated_at=datetime('now') WHERE id=?`,
        String(detail.invoice),
        id,
      )
      .catch(() => undefined);
    return true;
  }
  return false;
}

async function handleSkOrderError(
  id: number,
  link: Row,
  error: unknown,
  attempt: number,
  db: DatabaseAccess,
): Promise<"retried" | "failed" | "blocked"> {
  const { execRun } = db;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const isTimeout = /timeout|abort|network|fetch failed|504/i.test(message);
  if (isTimeout) {
    await execRun(
      `UPDATE sk_order_links SET status='submitted',
         last_error=?, lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=datetime('now','+${SK_SUBMITTED_STALE_MINUTES} minutes'),
         updated_at=datetime('now') WHERE id=?`,
      `ambiguous_timeout: ${message}`,
      id,
    );
    return "retried";
  }
  // REF_ID_ALREADY_EXIST = order sudah ada di SK (retry aman): ambil detail,
  // jangan hitung sebagai gagal.
  if (/REF_ID_ALREADY_EXIST/i.test(message)) {
    const reconciled = await reconcileAmbiguousSkLink(id, db).catch(() => false);
    if (reconciled) return "retried";
  }
  if (error instanceof SkInsufficientBalanceError) {
    return handleSkInsufficientBalance(id, link, message, db);
  }
  if (error instanceof SkOutOfStockError) {
    await execRun(
      `UPDATE product_variants SET stock=0, updated_at=datetime('now') WHERE sk_variant_id=?`,
      String(link.sk_variant_id),
    ).catch(() => undefined);
    await execRun(
      `UPDATE sk_products SET sk_stock=0, updated_at=? WHERE sk_variant_id=?`,
      new Date().toISOString(),
      String(link.sk_variant_id),
    ).catch(() => undefined);
  }
  // 503 ditolak di depan (saldo tidak terpotong): retrynormal, bukan failed.
  if (error instanceof SkTemporarilyUnavailableError) {
    await execRun(
      `UPDATE sk_order_links SET status='retry', last_error=?, request_sent_at=NULL,
         lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=?, updated_at=datetime('now') WHERE id=?`,
      message,
      nextAttemptIso(attempt),
      id,
    );
    return "retried";
  }
  if (attempt >= Number(link.max_attempts || SK_MAX_ATTEMPTS)) {
    await execRun(
      `UPDATE sk_order_links SET status='failed', last_error=?, request_sent_at=NULL,
         lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now') WHERE id=?`,
      message,
      id,
    );
    await notifyAdmin(
      `⚠️ <b>Order Sekalipay gagal</b> <code>${String(link.order_code)}</code>\n${escapeHtml(message)}`,
    );
    await execRun(
      `UPDATE orders SET fulfillment_status='failed', updated_at=datetime('now')
       WHERE code=? AND status='lunas'`,
      String(link.order_code),
    ).catch(() => undefined);
    try {
      const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
      await notifyBuyerDeliveryFailed(String(link.order_code), db);
    } catch { /* kabar pembeli best-effort */ }
    return "failed";
  }
  return handleSkOrderErrorTail(id, message, attempt, execRun);
}

/** Kabar best-effort ke PEMBELI saat link SK tertahan saldo (cermin WR). */
export async function notifySkBlockedBuyer(orderCode: string, database?: DatabaseAccess): Promise<void> {
  try {
    const { notifyBuyerSkBlocked } = await import("@/lib/notify-buyer");
    await notifyBuyerSkBlocked(orderCode, database ?? createDatabaseAccess());
  } catch { /* kabar pembeli best-effort; link tetap blocked_balance */ }
}

async function handleSkOrderErrorTail(
  id: number,
  message: string,
  attempt: number,
  execRun: (query: string, ...params: unknown[]) => Promise<{ changes?: number }>,
): Promise<"retried"> {
  await execRun(
    `UPDATE sk_order_links SET status='retry', last_error=?, request_sent_at=NULL,
       lease_owner=NULL, lease_expires_at=NULL,
       next_attempt_at=?, updated_at=datetime('now') WHERE id=?`,
    message,
    nextAttemptIso(attempt),
    id,
  );
  return "retried";
}

async function handleSkInsufficientBalance(
  id: number,
  link: Row,
  message: string,
  db: DatabaseAccess,
): Promise<"blocked"> {
  const { execRun } = db;
  await execRun(
    `UPDATE sk_order_links SET status='blocked_balance',
       last_error=?, request_sent_at=NULL, lease_owner=NULL, lease_expires_at=NULL,
       attempt_count=attempt_count-1,
       next_attempt_at=datetime('now','+60 minutes'), updated_at=datetime('now')
     WHERE id=?`,
    `saldo_sk_habis: ${message}`,
    id,
  );
  await notifyAdmin(
    `💰 <b>Saldo Sekalipay habis</b>\nOrder <code>${String(link.order_code)}</code> diblokir sementara (tidak makan retry). Top up untuk memulihkan otomatis.`,
  );
  // Kabari PEMBELI juga (cermin notifyBuyerWrBlocked 2026-09-28): order sudah
  // lunas tetapi pembelian ke upstream tertunda — tanpa kabar ini pembeli
  // menunggu buta mengira tokonya menipu.
  await notifySkBlockedBuyer(String(link.order_code), db);
  return "blocked";
}

export async function reconcileBlockedSkBalance(
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) return 0;
  const blocked = await db
    .queryAll(
      `SELECT l.id, l.sk_cost, l.order_code, l.updated_at,
              (SELECT o.status FROM orders o WHERE o.code = l.order_code) AS order_status
       FROM sk_order_links l WHERE l.status='blocked_balance'
       ORDER BY l.id ASC LIMIT 8`,
    )
    .catch(() => [] as Row[]);
  if (!blocked.length) return 0;
  const { fetchSkBalance } = await import("./client");
  let balance = 0;
  try {
    balance = Math.floor(Number((await fetchSkBalance()).balance) || 0);
  } catch {
    return 0;
  }
  const cutoffMs = Date.now() - SK_BLOCKED_MAX_AGE_HOURS * 60 * 60 * 1000;
  let revived = 0;
  for (const row of blocked) {
    if (balance < Number(row.sk_cost || 0)) continue;
    const updatedRaw = String(row.updated_at || "");
    const updatedMs = Date.parse(
      /(Z|[+-]\d{2}:?\d{2})$/.test(updatedRaw) ? updatedRaw : `${updatedRaw.replace(" ", "T")}Z`,
    );
    if (Number.isFinite(updatedMs) && updatedMs < cutoffMs) continue;
    if (String(row.order_status || "") !== "lunas") continue;
    const res = await db
      .execRun(
        `UPDATE sk_order_links SET status='pending', last_error=NULL,
           next_attempt_at=datetime('now'), updated_at=datetime('now')
         WHERE id=? AND status='blocked_balance'`,
        Number(row.id),
      )
      .catch(() => ({ changes: 0 as number | undefined }));
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
         AND datetime(next_attempt_at) <= datetime('now')`,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  return Number(res.changes ?? 0);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 300);
}

async function notifyAdmin(html: string): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return;
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    await sendMessage({ chat_id: adminChatId, text: html, parse_mode: "HTML" });
  } catch {
    /* best-effort */
  }
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

/** Sinkronisasi status processing/ambigu menggantung via GET /v1/trx. */
export async function reconcileStuckSkOrders(database?: DatabaseAccess): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) return 0;
  const stuck = await db
    .queryAll(
      `SELECT sk_invoice, order_code, id FROM sk_order_links
       WHERE status IN ('processing','submitted','ordering')
         AND datetime(COALESCE(request_sent_at, updated_at)) <= datetime('now','-1 hour')
       ORDER BY RANDOM() LIMIT 8`,
    )
    .catch(() => [] as Row[]);
  if (!stuck.length) return 0;
  const { handleSkOrderCompleted, handleSkOrderFailed } = await import("./deliver");
  let reconciled = 0;
  for (const row of stuck) {
    const invoice = String(row.sk_invoice || "");
    if (!invoice) continue;
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

export async function recoverStaleSkClaims(database?: DatabaseAccess): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) return 0;
  const res = await db
    .execRun(
      `UPDATE sk_order_links SET status='pending', lease_owner=NULL,
         lease_expires_at=NULL, last_error='stale_claim_recovered',
         updated_at=datetime('now')
       WHERE status='claimed' AND request_sent_at IS NULL
         AND lease_expires_at IS NOT NULL
         AND datetime(lease_expires_at) <= datetime('now')`,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  return Number(res.changes ?? 0);
}

export type { SkOrderLinkRow } from "./deliver";
export { handleSkOrderCompleted, handleSkOrderFailed } from "./deliver";
