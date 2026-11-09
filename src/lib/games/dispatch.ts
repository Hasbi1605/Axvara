// src/lib/games/dispatch.ts — dispatch, polling dan penerapan hasil transaksi
// Digiflazz untuk AXVARA Games (docs/GAMES.md §12.3–§12.4).
//
// Invarian (jangan dilonggarkan):
//  * satu `ref_id` = `<order_code>-<attempt_no>`; ambiguitas transport TIDAK
//    pernah membuat ref baru — item `pending` dicek ulang dengan payload sama
//    (Digiflazz mengembalikan status transaksi existing untuk ref yang sama);
//  * klaim `queued → submitting` berpagar `changes===1` SEBELUM jaringan;
//  * hanya satu attempt aktif per pesanan (UNIQUE(order_code, attempt_no) +
//    INSERT OR IGNORE); attempt lama dipakai ulang, tidak digandakan;
//  * SATU fungsi `applyGamesTransactionResult` dipakai dispatch, polling dan
//    webhook: hanya dari `submitting|pending` milik attempt AKTIF; keadaan
//    terminal (`success|needs_check|expired`) tidak pernah berubah.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { isDigiflazzConfigured, sendTransaction, type DigiflazzTransaction, type SendTransactionResult } from "./digiflazz";

type Db = DatabaseAccess;
type Row = Record<string, unknown>;
export type GamesTransactionSender = typeof sendTransaction;

export const GAMES_LEASE_SECONDS = 300;
export const GAMES_PENDING_MAX_SECONDS = 24 * 60 * 60;
const PROMOTE_PER_RUN = 20;
const DISPATCH_PER_RUN = 10;
const POLL_PER_RUN = 10;
const STALE_PENDING_PER_RUN = 3;
/** Statement per dispatch (klaim, insert, select attempt, 2 hasil) + sisa untuk satu polling (select + klaim + 2 hasil). */
const DISPATCH_COST = 5;
const POLL_RESERVE = 4;
/** Setelah ini tidak ada panggilan jaringan baru dalam satu run (route lite ±45 dtk). */
const NETWORK_WINDOW_MS = 30_000;

export type GamesRunSummary = {
  skipped?: "not_configured";
  idle?: boolean;
  promoted: number;
  expired: number;
  recovered: number;
  dispatched: number;
  polled: number;
  backup_queued: number;
  needs_check: number;
  error?: string;
};

export type ApplyOutcome = "success" | "pending" | "backup_queued" | "needs_check" | "ignored" | "unknown_ref";

const changed = (r: { changes?: number }) => Number(r.changes) === 1;
const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v);

async function notifyNeedsCheck(db: Db, orderCode: string, reason: string): Promise<void> {
  try {
    const { notifyGamesNeedsCheck } = await import("@/lib/games/notify");
    await notifyGamesNeedsCheck(db, orderCode, reason);
  } catch { /* notifikasi best-effort; status sudah tersimpan */ }
}

const ACTIVE_ITEM = "status IN ('submitting','pending')";
const OPEN_ATTEMPT = "status IN ('submitting','pending','ambiguous')";

/** Terapkan hasil transaksi (dispatch / polling / webhook). Idempoten. */
export async function applyGamesTransactionResult(db: Db, refId: string, tx: DigiflazzTransaction): Promise<ApplyOutcome> {
  const cur = await db.queryFirst(
    `SELECT a.attempt_no AS a_no, i.order_code, i.status AS i_status, i.attempt_no AS i_no, i.max_price,
            p.backup_sku_code, p.backup_cost, p.backup_seller_active
       FROM games_dispatch_attempts a
       JOIN games_order_items i ON i.order_code=a.order_code
       LEFT JOIN games_products p ON p.id=i.product_id
      WHERE a.ref_id=?`,
    refId,
  );
  if (!cur) return "unknown_ref";
  const orderCode = String(cur.order_code);
  const attemptNo = Number(cur.a_no);
  // Stale/duplikat: bukan attempt aktif, atau item sudah terminal/belum dikirim.
  if (attemptNo !== Number(cur.i_no) || (cur.i_status !== "submitting" && cur.i_status !== "pending")) return "ignored";
  const guard = `order_code=? AND attempt_no=? AND ${ACTIVE_ITEM}`;
  const message = clip(tx.message, 300);

  if (tx.status === "Sukses") {
    const r = await db.execRun(
      `UPDATE games_order_items SET status='success', sn=?, supplier_message=?, completed_at=datetime('now'),
         lease_until=NULL, last_error=NULL, updated_at=datetime('now') WHERE ${guard}`,
      tx.sn, message, orderCode, attemptNo,
    );
    if (!changed(r)) return "ignored";
    await db.execRun(
      `UPDATE games_dispatch_attempts SET status='success', rc=?, message=?, sn=?, price=?, updated_at=datetime('now') WHERE ref_id=? AND ${OPEN_ATTEMPT}`,
      tx.rc, message, tx.sn, tx.price, refId,
    );
    return "success";
  }

  if (tx.status === "Pending") {
    const r = await db.execRun(
      `UPDATE games_order_items SET status='pending', supplier_message=?, lease_until=NULL, last_polled_at=datetime('now'),
         updated_at=datetime('now') WHERE ${guard}`,
      message, orderCode, attemptNo,
    );
    if (!changed(r)) return "ignored";
    await db.execRun(
      `UPDATE games_dispatch_attempts SET status='pending', rc=?, message=?, updated_at=datetime('now') WHERE ref_id=? AND ${OPEN_ATTEMPT}`,
      tx.rc, message, refId,
    );
    return "pending";
  }

  // Gagal (final): seller cadangan hanya setelah attempt 1, aktif dan tidak melewati max_price.
  const backupOk = attemptNo === 1 && Boolean(cur.backup_sku_code) && Number(cur.backup_seller_active) === 1
    && cur.backup_cost != null && Number(cur.backup_cost) <= Number(cur.max_price);
  const detail = clip(`Gagal rc=${tx.rc} ${tx.message}`.trim(), 300);
  if (backupOk) {
    const r = await db.execRun(
      `UPDATE games_order_items SET status='queued', attempt_no=2, lease_until=NULL, last_polled_at=NULL,
         supplier_message=?, last_error=?, updated_at=datetime('now') WHERE ${guard}`,
      message, clip(`attempt1 ${detail}; backup`, 300), orderCode, attemptNo,
    );
    if (!changed(r)) return "ignored";
    await db.execRun(
      `UPDATE games_dispatch_attempts SET status='failed', rc=?, message=?, price=?, updated_at=datetime('now') WHERE ref_id=? AND ${OPEN_ATTEMPT}`,
      tx.rc, message, tx.price, refId,
    );
    return "backup_queued";
  }
  const r = await db.execRun(
    `UPDATE games_order_items SET status='needs_check', supplier_message=?, lease_until=NULL, last_error=?,
       updated_at=datetime('now') WHERE ${guard}`,
    message, detail, orderCode, attemptNo,
  );
  if (!changed(r)) return "ignored";
  await db.execRun(
    `UPDATE games_dispatch_attempts SET status='failed', rc=?, message=?, price=?, updated_at=datetime('now') WHERE ref_id=? AND ${OPEN_ATTEMPT}`,
    tx.rc, message, tx.price, refId,
  );
  await notifyNeedsCheck(db, orderCode, detail);
  return "needs_check";
}

/** Item → needs_check (berpagar), attempt → failed, lalu notifikasi admin. */
async function failToNeedsCheck(db: Db, orderCode: string, attemptNo: number, refId: string | null, reason: string): Promise<boolean> {
  const r = await db.execRun(
    `UPDATE games_order_items SET status='needs_check', lease_until=NULL, last_error=?, updated_at=datetime('now')
      WHERE order_code=? AND attempt_no=? AND ${ACTIVE_ITEM}`,
    clip(reason, 300), orderCode, attemptNo,
  );
  if (!changed(r)) return false;
  if (refId) {
    await db.execRun(
      `UPDATE games_dispatch_attempts SET status='failed', message=?, updated_at=datetime('now') WHERE ref_id=? AND ${OPEN_ATTEMPT}`,
      clip(reason, 300), refId,
    );
  }
  await notifyNeedsCheck(db, orderCode, reason);
  return true;
}

async function markAmbiguous(db: Db, orderCode: string, attemptNo: number, refId: string, reason: string): Promise<void> {
  await db.execRun(
    `UPDATE games_order_items SET status='pending', lease_until=NULL, last_polled_at=datetime('now'), last_error=?,
       updated_at=datetime('now') WHERE order_code=? AND attempt_no=? AND ${ACTIVE_ITEM}`,
    clip(`ambiguous: ${reason}`, 300), orderCode, attemptNo,
  );
  await db.execRun(
    `UPDATE games_dispatch_attempts SET status='ambiguous', message=?, updated_at=datetime('now') WHERE ref_id=? AND ${OPEN_ATTEMPT}`,
    clip(reason, 300), refId,
  );
}

type Counters = GamesRunSummary;

/** Terapkan hasil `sendTransaction` (dispatch & poll). `fromDispatch`: item berstatus submitting. */
async function handleSendResult(
  db: Db, r: SendTransactionResult, orderCode: string, attemptNo: number, refId: string, fromDispatch: boolean, out: Counters,
): Promise<void> {
  if (r.kind === "ok" && r.tx.ref_id === refId) {
    const o = await applyGamesTransactionResult(db, refId, r.tx);
    if (o === "backup_queued") out.backup_queued++;
    else if (o === "needs_check") out.needs_check++;
    return;
  }
  if (r.kind === "ok" || r.kind === "ambiguous") {
    // ref_id respons berbeda = tak terpercaya → perlakukan ambigu, cek ulang ref yang sama.
    if (fromDispatch) await markAmbiguous(db, orderCode, attemptNo, refId, r.kind === "ok" ? "ref_mismatch" : r.reason);
    return;
  }
  if (r.kind === "config") {
    out.error = `config:${r.reason}`;
    if (fromDispatch) {
      // Tidak ada yang terkirim: lepaskan klaim, attempt submitting dipakai ulang.
      await db.execRun(
        `UPDATE games_order_items SET status='queued', lease_until=NULL, updated_at=datetime('now')
          WHERE order_code=? AND attempt_no=? AND status='submitting'`,
        orderCode, attemptNo,
      );
    }
    return;
  }
  // http_error 4xx tanpa status transaksi yang dapat dibaca.
  if (await failToNeedsCheck(db, orderCode, attemptNo, refId, `http_${r.status} tanpa status transaksi`)) out.needs_check++;
}

async function dispatchOne(db: Db, item: Row, send: GamesTransactionSender, out: Counters): Promise<void> {
  const orderCode = String(item.order_code);
  const attemptNo = Number(item.attempt_no);
  const claimed = await db.execRun(
    `UPDATE games_order_items SET status='submitting', submit_attempts=submit_attempts+1,
       lease_until=datetime('now', '+${GAMES_LEASE_SECONDS} seconds'), updated_at=datetime('now')
      WHERE order_code=? AND status='queued' AND attempt_no=? AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))
        AND EXISTS(SELECT 1 FROM orders o WHERE o.code=games_order_items.order_code AND o.status='lunas' AND o.payment_status='paid')`,
    orderCode, attemptNo,
  );
  if (!changed(claimed)) return;
  const refId = `${orderCode}-${attemptNo}`;
  const sku = attemptNo === 1 ? String(item.buyer_sku_code ?? "") : String(item.p_backup_sku ?? "");
  if (!sku) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, null, `sku attempt ${attemptNo} tidak tersedia`)) out.needs_check++;
    return;
  }
  await db.execRun(
    `INSERT OR IGNORE INTO games_dispatch_attempts(ref_id, order_code, attempt_no, buyer_sku_code, status) VALUES(?,?,?,?, 'submitting')`,
    refId, orderCode, attemptNo, sku,
  );
  const attempt = await db.queryFirst(
    `SELECT ref_id, buyer_sku_code, status FROM games_dispatch_attempts WHERE order_code=? AND attempt_no=?`,
    orderCode, attemptNo,
  );
  if (!attempt || attempt.ref_id !== refId) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, null, "attempt tidak konsisten")) out.needs_check++;
    return;
  }
  if (attempt.status === "ambiguous" || attempt.status === "pending") {
    // Attempt sudah pernah dikirim: cek ulang dengan ref SAMA lewat polling, bukan kirim ulang di sini.
    await markAmbiguous(db, orderCode, attemptNo, refId, "existing_attempt");
    return;
  }
  if (attempt.status !== "submitting") {
    if (await failToNeedsCheck(db, orderCode, attemptNo, null, `attempt ${String(attempt.status)} tidak konsisten`)) out.needs_check++;
    return;
  }
  out.dispatched++;
  const r = await send({
    buyer_sku_code: String(attempt.buyer_sku_code),
    customer_no: String(item.customer_no),
    ref_id: refId,
    max_price: Number(item.max_price),
  });
  await handleSendResult(db, r, orderCode, attemptNo, refId, true, out);
}

// Umur attempt (dtk) dipakai backoff & batas 24 jam; fallback ke umur item.
const AGE_EXPR = `(CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', COALESCE(a.created_at, i.created_at)) AS INTEGER))`;

async function pollOne(db: Db, row: Row, send: GamesTransactionSender, out: Counters): Promise<void> {
  const orderCode = String(row.order_code);
  const attemptNo = Number(row.attempt_no);
  // CAS pada last_polled_at: dua run bersamaan tidak memanggil Digiflazz dua kali.
  const claimed = await db.execRun(
    `UPDATE games_order_items SET last_polled_at=datetime('now'), updated_at=datetime('now')
      WHERE order_code=? AND attempt_no=? AND status='pending' AND last_polled_at IS ?`,
    orderCode, attemptNo, row.last_polled_at ?? null,
  );
  if (!changed(claimed)) return;
  if (!row.a_ref) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, null, "pending tanpa attempt")) out.needs_check++;
    return;
  }
  const refId = String(row.a_ref);
  out.polled++;
  const r = await send({
    buyer_sku_code: String(row.a_sku),
    customer_no: String(row.customer_no),
    ref_id: refId,
    max_price: Number(row.max_price),
  });
  await handleSendResult(db, r, orderCode, attemptNo, refId, false, out);
}

/** Satu siklus: promosi, kedaluwarsa, pemulihan lease, dispatch, polling.
 * `sender` diinjeksi test (default `sendTransaction`). `sharedDb`: cron lite
 * meneruskan akses ber-budget (40 statement). */
export async function processGamesPaidOrders(sender?: GamesTransactionSender, sharedDb?: Db): Promise<GamesRunSummary> {
  const out: GamesRunSummary = { promoted: 0, expired: 0, recovered: 0, dispatched: 0, polled: 0, backup_queued: 0, needs_check: 0 };
  if (!isDigiflazzConfigured()) return { ...out, skipped: "not_configured" };
  const db = sharedDb ?? createDatabaseAccess();
  const send = sender ?? sendTransaction;
  const startedAt = Date.now();

  // Gerbang murah: tanpa item aktif tidak ada pekerjaan (1 statement per tick kosong).
  const any = await db.queryFirst(
    `SELECT 1 AS n FROM games_order_items WHERE status IN ('awaiting_payment','queued','submitting','pending') LIMIT 1`,
  );
  if (!any) return { ...out, idle: true };

  // Lunas → queued (terbatas). Hanya order lunas+paid.
  const promoted = await db.execRun(
    `UPDATE games_order_items SET status='queued', updated_at=datetime('now')
      WHERE status='awaiting_payment' AND id IN (
        SELECT i.id FROM games_order_items i JOIN orders o ON o.code=i.order_code
         WHERE i.status='awaiting_payment' AND o.status='lunas' AND o.payment_status='paid' LIMIT ${PROMOTE_PER_RUN})`,
  );
  out.promoted = Number(promoted.changes) || 0;
  // Order dibatalkan/kedaluwarsa tanpa pembayaran → expired.
  const expired = await db.execRun(
    `UPDATE games_order_items SET status='expired', updated_at=datetime('now')
      WHERE status='awaiting_payment' AND id IN (
        SELECT i.id FROM games_order_items i JOIN orders o ON o.code=i.order_code
         WHERE i.status='awaiting_payment' AND o.payment_status<>'paid'
           AND o.status IN ('kadaluarsa','dibatalkan','batal','expired') LIMIT ${PROMOTE_PER_RUN})`,
  );
  out.expired = Number(expired.changes) || 0;

  // Submitting basi: JANGAN kirim ulang dengan ref baru. Tanpa attempt = belum ada
  // yang terkirim → queued; dengan attempt → ambigu → pending (cek ulang ref SAMA).
  const STALE = `status='submitting' AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))`;
  await db.execRun(
    `UPDATE games_order_items SET status='queued', lease_until=NULL, updated_at=datetime('now')
      WHERE ${STALE} AND NOT EXISTS(SELECT 1 FROM games_dispatch_attempts a
        WHERE a.order_code=games_order_items.order_code AND a.attempt_no=games_order_items.attempt_no)`,
  );
  await db.execRun(
    `UPDATE games_dispatch_attempts SET status='ambiguous', message=COALESCE(message,'submit interrupted'), updated_at=datetime('now')
      WHERE status='submitting' AND EXISTS(SELECT 1 FROM games_order_items i
        WHERE i.order_code=games_dispatch_attempts.order_code AND i.attempt_no=games_dispatch_attempts.attempt_no
          AND i.status='submitting' AND (i.lease_until IS NULL OR datetime(i.lease_until)<=datetime('now')))`,
  );
  const recovered = await db.execRun(
    `UPDATE games_order_items SET status='pending', lease_until=NULL, last_polled_at=NULL,
       last_error='submit interrupted; re-check same ref', updated_at=datetime('now') WHERE ${STALE}`,
  );
  out.recovered = Number(recovered.changes) || 0;

  // Pending > 24 jam sejak attempt dibuat → needs_check + notifikasi.
  if (db.canSpend(1 + STALE_PENDING_PER_RUN * 3)) {
    const stale = await db.queryAll(
      `SELECT i.order_code, i.attempt_no, a.ref_id AS a_ref
         FROM games_order_items i LEFT JOIN games_dispatch_attempts a ON a.order_code=i.order_code AND a.attempt_no=i.attempt_no
        WHERE i.status='pending' AND ${AGE_EXPR} >= ${GAMES_PENDING_MAX_SECONDS}
        ORDER BY i.id ASC LIMIT ${STALE_PENDING_PER_RUN}`,
    );
    for (const row of stale) {
      if (!db.canSpend(3)) break;
      if (await failToNeedsCheck(db, String(row.order_code), Number(row.attempt_no), row.a_ref ? String(row.a_ref) : null, "pending lebih dari 24 jam; cek manual di dashboard Digiflazz")) out.needs_check++;
    }
  }

  // Dispatch: queued + lease kedaluwarsa. Sisakan anggaran untuk polling.
  if (db.canSpend(1)) {
    const queued = await db.queryAll(
      `SELECT i.order_code, i.buyer_sku_code, i.customer_no, i.max_price, i.attempt_no, p.backup_sku_code AS p_backup_sku
         FROM games_order_items i LEFT JOIN games_products p ON p.id=i.product_id
        WHERE i.status='queued' AND (i.lease_until IS NULL OR datetime(i.lease_until)<=datetime('now'))
          AND EXISTS(SELECT 1 FROM orders o WHERE o.code=i.order_code AND o.status='lunas' AND o.payment_status='paid')
        ORDER BY i.id ASC LIMIT ${DISPATCH_PER_RUN}`,
    );
    for (const item of queued) {
      if (!db.canSpend(DISPATCH_COST + POLL_RESERVE) || Date.now() - startedAt > NETWORK_WINDOW_MS) break;
      await dispatchOne(db, item, send, out);
      if (out.error) break; // config rusak: sisa antrean akan gagal sama.
    }
  }

  // Polling pending dengan backoff umur attempt: 60 dtk (<10 mnt), 120 dtk (<1 jam), 300 dtk.
  if (!out.error && db.canSpend(1)) {
    const due = await db.queryAll(
      `SELECT i.order_code, i.customer_no, i.max_price, i.attempt_no, i.last_polled_at, a.ref_id AS a_ref, a.buyer_sku_code AS a_sku
         FROM games_order_items i LEFT JOIN games_dispatch_attempts a ON a.order_code=i.order_code AND a.attempt_no=i.attempt_no
        WHERE i.status='pending' AND ${AGE_EXPR} < ${GAMES_PENDING_MAX_SECONDS}
          AND (i.last_polled_at IS NULL OR
               CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', i.last_polled_at) AS INTEGER) >=
               CASE WHEN ${AGE_EXPR} < 600 THEN 60 WHEN ${AGE_EXPR} < 3600 THEN 120 ELSE 300 END)
        ORDER BY COALESCE(i.last_polled_at, '') ASC, i.id ASC LIMIT ${POLL_PER_RUN}`,
    );
    for (const row of due) {
      if (!db.canSpend(3) || Date.now() - startedAt > NETWORK_WINDOW_MS) break;
      await pollOne(db, row, send, out);
    }
  }
  return out;
}
