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
import {
  fetchSkBalance,
  fetchSkItemDetail,
  getSkProxyUrl,
  isSkEnabled,
  SkApiError,
  SkInsufficientBalanceError,
  SkNetworkError,
  SkTemporarilyUnavailableError,
} from "@/lib/sekalipay/client";
import {
  applySkTransactionDetail,
  fetchSkGamesStatus,
  sendSkGamesTransaction,
  skGamesPayload,
  skGamesRef,
} from "./sk-dispatch";
import { normalizeSkGamesContract } from "./sk-catalog-sync";
import {
  parseGamesSkContract,
  parseGamesSkTargetSnapshot,
  validateGamesSkTarget,
  type GamesSkContract,
} from "./registry";

type Db = DatabaseAccess;
type Row = Record<string, unknown>;
export type GamesTransactionSender = typeof sendTransaction;

export const GAMES_LEASE_SECONDS = 300;
export const GAMES_PENDING_MAX_SECONDS = 24 * 60 * 60;
/** Grace 404 invoice setelah fence: propagasi SK, bukan izin POST ulang. */
export const SK_MISSING_INVOICE_GRACE_MS = 10 * 60_000;
const PROMOTE_PER_RUN = 20;
const DISPATCH_PER_RUN = 10;
const POLL_PER_RUN = 10;
const STALE_PENDING_PER_RUN = 3;
/** Statement per dispatch Digiflazz (klaim, insert, select attempt, 2 hasil) + sisa untuk satu polling (select + klaim + 2 hasil). */
const DISPATCH_COST = 5;
/** SK satu dispatch: claim, supplier_ref, insert attempt, select, fence,
 *  simpan invoice, item→pending = 7 statement (+1 headroom). */
const SK_DISPATCH_COST = 8;
const POLL_RESERVE = 4;
/** Promote+expire+4 pemulihan lease = 6 tulisan tetap. */
const FIXED_RECOVERY_WRITES = 6;
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
  budget_deferred?: boolean;
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

async function dispatchOne(db: Db, item: Row, send: GamesTransactionSender, out: Counters, skReady: boolean): Promise<void> {
  const orderCode = String(item.order_code);
  const attemptNo = Number(item.attempt_no);
  const supplier = String(item.supplier ?? "digiflazz");
  if (supplier === "sekalipay" && !skReady) return;
  const claimed = await db.execRun(
    `UPDATE games_order_items SET status='submitting', submit_attempts=submit_attempts+1,
       lease_until=datetime('now', '+${GAMES_LEASE_SECONDS} seconds'), updated_at=datetime('now')
      WHERE order_code=? AND status='queued' AND attempt_no=? AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))
        AND EXISTS(SELECT 1 FROM orders o WHERE o.code=games_order_items.order_code AND o.status='lunas' AND o.payment_status='paid')`,
    orderCode, attemptNo,
  );
  if (!changed(claimed)) return;
  const refId = supplier === "sekalipay"
    ? (String(item.supplier_ref ?? "") || skGamesRef(orderCode))
    : `${orderCode}-${attemptNo}`;
  const sku = attemptNo === 1 ? String(item.buyer_sku_code ?? "") : String(item.p_backup_sku ?? "");
  if (!sku) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, null, `sku attempt ${attemptNo} tidak tersedia`)) out.needs_check++;
    return;
  }
  if (supplier === "sekalipay") {
    // Ref durable di item sejak dispatch pertama (juga untuk baris lama).
    await db.execRun(
      `UPDATE games_order_items SET supplier_ref=COALESCE(NULLIF(supplier_ref,''),?), updated_at=datetime('now')
        WHERE order_code=? AND supplier='sekalipay'`,
      refId, orderCode,
    );
  }
  await db.execRun(
    supplier === "sekalipay"
      ? `INSERT OR IGNORE INTO games_dispatch_attempts(ref_id, order_code, attempt_no, buyer_sku_code, status, supplier) VALUES(?,?,?,?, 'submitting', 'sekalipay')`
      : `INSERT OR IGNORE INTO games_dispatch_attempts(ref_id, order_code, attempt_no, buyer_sku_code, status) VALUES(?,?,?,?, 'submitting')`,
    refId, orderCode, attemptNo, sku,
  );
  const attempt = await db.queryFirst(
    `SELECT ref_id, buyer_sku_code, status, request_sent_at, sk_invoice, supplier FROM games_dispatch_attempts WHERE order_code=? AND attempt_no=?`,
    orderCode, attemptNo,
  );
  if (!attempt || attempt.ref_id !== refId || String(attempt.supplier ?? "digiflazz") !== supplier) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, null, "attempt tidak konsisten")) out.needs_check++;
    return;
  }

  if (supplier === "sekalipay") {
    // Fence sudah ada / attempt pernah dikirim: TIDAK PERNAH POST kedua.
    if (attempt.request_sent_at != null || attempt.status === "pending" || attempt.status === "ambiguous") {
      await skAwaitSameRef(db, orderCode, attemptNo, refId, "existing_attempt");
      return;
    }
    if (attempt.status !== "submitting") {
      if (await failToNeedsCheck(db, orderCode, attemptNo, refId, `attempt ${String(attempt.status)} tidak konsisten`)) out.needs_check++;
      return;
    }
    await dispatchSkAfterClaim(db, item, refId, out);
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

/** SK: belum/tidak terkirim dengan aman → tunda tanpa menghabiskan attempt. */
async function deferSkItem(db: Db, orderCode: string, attemptNo: number, reason: string): Promise<void> {
  await db.execRun(
    `UPDATE games_order_items SET status='queued', lease_until=datetime('now','+120 seconds'), last_error=?, updated_at=datetime('now')
      WHERE order_code=? AND attempt_no=? AND supplier='sekalipay' AND status='submitting'`,
    clip(reason, 300), orderCode, attemptNo,
  );
}

/** Fence sudah tersimpan: item menunggu ref yang sama, tidak ada POST ulang. */
async function skAwaitSameRef(db: Db, orderCode: string, attemptNo: number, refId: string, reason: string): Promise<void> {
  await db.execRun(
    `UPDATE games_order_items SET status='pending', lease_until=NULL, last_polled_at=datetime('now'), last_error=?,
       updated_at=datetime('now') WHERE order_code=? AND attempt_no=? AND supplier='sekalipay' AND status='submitting'`,
    clip(reason, 300), orderCode, attemptNo,
  );
  await db.execRun(
    `UPDATE games_dispatch_attempts SET status='ambiguous', message=COALESCE(message,?), updated_at=datetime('now')
      WHERE ref_id=? AND status IN ('submitting','ambiguous')`,
    clip(reason, 300), refId,
  );
}

async function handleSkPreflightError(db: Db, orderCode: string, attemptNo: number, refId: string, stage: string, error: unknown, out: Counters): Promise<void> {
  const message = error instanceof Error ? error.message : "unknown";
  if (error instanceof SkNetworkError || (error instanceof SkApiError && (error.status >= 500 || error.status === 429))) {
    await deferSkItem(db, orderCode, attemptNo, `preflight_${stage}:${message}`);
    return;
  }
  if (await failToNeedsCheck(db, orderCode, attemptNo, refId, `preflight_${stage}:${message}`)) out.needs_check++;
}

async function dispatchSkAfterClaim(db: Db, item: Row, refId: string, out: Counters): Promise<void> {
  const orderCode = String(item.order_code);
  const attemptNo = Number(item.attempt_no);
  const variantId = Number(item.sk_variant_id);
  if (attemptNo !== 1) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, refId, "SK tidak memakai attempt cadangan")) out.needs_check++;
    return;
  }
  if (!Number.isSafeInteger(variantId) || variantId <= 0) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, refId, "sk_variant_id tidak valid")) out.needs_check++;
    return;
  }
  const contract = parseGamesSkContract(item.p_fields);
  const snapshot = parseGamesSkTargetSnapshot(item.target_snapshot);
  const target = contract && snapshot ? validateGamesSkTarget(contract, snapshot) : null;
  const cachedStock = Number(item.p_stock);
  const productReady = contract?.supported === true
    && Number(item.p_active) === 1
    // -1 = stok tak terbatas, konsisten dengan live preflight/quote/order.
    && (cachedStock === -1 || cachedStock > 0)
    && Number(item.p_min_order) === 1;
  if (!productReady || !target?.ok) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, refId, `sku tidak siap: ${contract?.reason ?? (target && !target.ok ? target.reason : "contract")}`)) out.needs_check++;
    return;
  }
  // Preflight sebelum fence: item/status/H2H/kontrak/harga/balance.
  // SK tidak punya parameter `max_price` upstream; batas harga hanya dijaga di
  // sini (live ceilcost <= max_price/unit_price). Race harga setelah preflight
  // tetap mungkin sampai supplier menagih — preflight bukan pencegahan debit.
  // Deteksi biaya aktual pasca-GET (attempts.price) adalah kontrol manual review.
  let detail;
  try {
    detail = await fetchSkItemDetail(variantId);
  } catch (error) {
    return handleSkPreflightError(db, orderCode, attemptNo, refId, "item", error, out);
  }
  if (Number(detail.id) !== variantId || String(detail.order_process) !== "h2h") {
    if (await failToNeedsCheck(db, orderCode, attemptNo, refId, "varian bukan H2H yang didukung")) out.needs_check++;
    return;
  }
  // Status/stock live: off/stock0 → tunda backoff, bukan needs_check.
  const liveStatus = detail.status == null ? null : String(detail.status).trim().toLowerCase();
  if (liveStatus !== null && liveStatus !== "on") {
    await deferSkItem(db, orderCode, attemptNo, `live status ${liveStatus || "kosong"}`);
    return;
  }
  const liveStock = Number(detail.stock);
  if (!Number.isFinite(liveStock) || (liveStock !== -1 && liveStock < 1)) {
    await deferSkItem(db, orderCode, attemptNo, `live stock tidak tersedia (${String(detail.stock)})`);
    return;
  }
  if (detail.min_order !== null && detail.min_order !== undefined
    && (!Number.isInteger(Number(detail.min_order)) || Number(detail.min_order) !== 1)) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, refId, `live min_order ${String(detail.min_order)}`)) out.needs_check++;
    return;
  }
  // Kontrak live dinormalisasi dan dibandingkan dengan snapshot immutable order.
  const liveContract = normalizeSkGamesContract(detail);
  if (!liveContract.supported || contractShape(liveContract) !== contractShape(contract)) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, refId, `kontrak berubah: ${liveContract.reason ?? "shape"}`)) out.needs_check++;
    return;
  }
  const liveCost = Math.ceil(Number(detail.price));
  if (!Number.isSafeInteger(liveCost) || liveCost <= 0) {
    await deferSkItem(db, orderCode, attemptNo, "harga SK tidak terbaca");
    return;
  }
  if (liveCost > Number(item.max_price) || liveCost > Number(item.unit_price)) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, refId, `harga SK naik ${liveCost}>${Number(item.max_price)}`)) out.needs_check++;
    return;
  }
  let balance;
  try {
    balance = await fetchSkBalance();
  } catch (error) {
    return handleSkPreflightError(db, orderCode, attemptNo, refId, "balance", error, out);
  }
  if (!Number.isFinite(Number(balance.balance)) || Number(balance.balance) < liveCost) {
    await deferSkItem(db, orderCode, attemptNo, `saldo SK kurang (${Number(balance.balance) || 0}<${liveCost})`);
    return;
  }

  // SENT FENCE: payload + request_sent_at durable SEBELUM POST, terikat pada
  // item yang masih submitting/attempt aktif/lease valid/order lunas. Tanpa
  // pemenang fence tidak ada panggilan jaringan tulis.
  const payload = skGamesPayload(refId, variantId, target.target);
  const fenced = await db.execRun(
    `UPDATE games_dispatch_attempts SET request_sent_at=datetime('now'), payload_snapshot=?, buyer_sku_code=?,
       message='preflight_ok', updated_at=datetime('now')
      WHERE ref_id=? AND supplier='sekalipay' AND status='submitting' AND request_sent_at IS NULL
        AND EXISTS(SELECT 1 FROM games_order_items i JOIN orders o ON o.code=i.order_code
          WHERE i.order_code=? AND i.attempt_no=? AND i.supplier='sekalipay' AND i.status='submitting'
            AND (i.lease_until IS NULL OR datetime(i.lease_until)>datetime('now'))
            AND o.status='lunas' AND o.payment_status='paid')`,
    JSON.stringify(payload), String(item.buyer_sku_code), refId, orderCode, attemptNo,
  );
  if (!changed(fenced)) return;

  out.dispatched++;
  let created;
  try {
    created = await sendSkGamesTransaction(refId, variantId, target.target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (error instanceof SkNetworkError || error instanceof SkInsufficientBalanceError
      || error instanceof SkTemporarilyUnavailableError || (error instanceof SkApiError && error.status >= 500)
      || (error instanceof SkApiError && /REF_ID_ALREADY_EXIST/i.test(message))) {
      // Nasib tidak pasti/ref mungkin sudah ada: poll ref yang sama, jangan POST ulang.
      await skAwaitSameRef(db, orderCode, attemptNo, refId, `sk_${error instanceof SkApiError ? error.status : "network"}:${message}`);
      return;
    }
    if (error instanceof SkApiError && error.status === 422 && /REQUIRED_FIELD_MISSING|ITEM_ID_NOT_VALID/i.test(message)) {
      if (await failToNeedsCheck(db, orderCode, attemptNo, refId, `sk_422:${message}`)) out.needs_check++;
      return;
    }
    if (await failToNeedsCheck(db, orderCode, attemptNo, refId, `sk_send:${message}`)) out.needs_check++;
    return;
  }
  const invoice = String(created.invoice || "").trim();
  const status = String(created.status || "pending").slice(0, 40);
  await db.execRun(
    `UPDATE games_dispatch_attempts SET status='pending', sk_invoice=?, message=?, dispatch_status=?, updated_at=datetime('now')
      WHERE ref_id=? AND status='submitting'`,
    invoice || null, `created ${status}`.slice(0, 300), status, refId,
  );
  await db.execRun(
    `UPDATE games_order_items SET status='pending', lease_until=NULL, last_polled_at=datetime('now'), sk_invoice=?,
       supplier_message=?, updated_at=datetime('now')
      WHERE order_code=? AND attempt_no=? AND supplier='sekalipay' AND status='submitting'`,
    invoice || null, `created ${status}`.slice(0, 300), orderCode, attemptNo,
  );
}

/** Poll SK: GET ref/invoice yang sama; 404 bukan izin POST ulang. */
async function pollSkAfterClaim(db: Db, row: Row, out: Counters): Promise<void> {
  const orderCode = String(row.order_code);
  const attemptNo = Number(row.attempt_no);
  const refId = String(row.a_ref ?? "");
  if (!refId) {
    if (await failToNeedsCheck(db, orderCode, attemptNo, null, "pending SK tanpa attempt")) out.needs_check++;
    return;
  }
  const invoice = String(row.a_invoice ?? "").trim() || null;
  let detail;
  try {
    // GET memakai ref kanonik (invoice hanya hint webhook); binding invoice
    // diverifikasi parser bila tersimpan.
    detail = await fetchSkGamesStatus(refId);
  } catch (error) {
    if (error instanceof SkApiError && error.status === 404) {
      const sentAt = sqliteUtcMs(row.a_sent);
      const inGrace = Number.isFinite(sentAt) && Date.now() - sentAt < SK_MISSING_INVOICE_GRACE_MS;
      if (!inGrace && await failToNeedsCheck(db, orderCode, attemptNo, refId, "invoice SK tidak ditemukan setelah grace; cek dashboard")) out.needs_check++;
    }
    // Error transien: tetap pending, backoff tick berikut.
    return;
  }
  out.polled++;
  const outcome = await applySkTransactionDetail(db, detail, { refId, invoiceHint: invoice });
  if (outcome === "needs_check") out.needs_check++;
}

// Umur attempt (dtk) dipakai backoff & batas 24 jam; fallback ke umur item.
const AGE_EXPR = `(CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', COALESCE(a.created_at, i.created_at)) AS INTEGER))`;

/** SQLite datetime('now') = UTC tanpa sufiks; Date.parse lokal akan salah 7 jam. */
const sqliteUtcMs = (value: unknown): number => {
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(" ", "T")}Z` : raw);
};

/** Bentuk kontrak yang dibandingkan preflight dengan snapshot order. */
const contractShape = (value: GamesSkContract): string => JSON.stringify({
  supported: value.supported,
  reason: value.reason,
  requires_zone_id: value.requires_zone_id,
  fields: value.fields.map((field) => [field.key, field.required, field.min, field.max]).sort(),
});

async function pollOne(db: Db, row: Row, send: GamesTransactionSender, out: Counters): Promise<void> {
  const orderCode = String(row.order_code);
  const attemptNo = Number(row.attempt_no);
  // CAS pada last_polled_at: dua run bersamaan tidak memanggil supplier dua kali.
  const claimed = await db.execRun(
    `UPDATE games_order_items SET last_polled_at=datetime('now'), updated_at=datetime('now')
      WHERE order_code=? AND attempt_no=? AND status='pending' AND last_polled_at IS ?`,
    orderCode, attemptNo, row.last_polled_at ?? null,
  );
  if (!changed(claimed)) return;
  if (String(row.supplier ?? "digiflazz") === "sekalipay") {
    await pollSkAfterClaim(db, row, out);
    return;
  }
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
  const dgfReady = isDigiflazzConfigured();
  // SK siap bila flag aktif + kredensial/transport. Tidak membaca GAMES_SK_ENABLED
  // agar pesanan SK yang sudah dibayar tetap bisa diselesaikan.
  const skReady = isSkEnabled()
    && (getSkProxyUrl() ? Boolean(process.env.SEKALIPAY_PROXY_TOKEN?.trim()) : Boolean(process.env.SEKALIPAY_API_KEY?.trim()));
  if (!dgfReady && !skReady) return { ...out, skipped: "not_configured" };
  const db = sharedDb ?? createDatabaseAccess();
  const send = sender ?? sendTransaction;
  const startedAt = Date.now();

  // Admission: sisa budget harus cukup untuk statement tetap sebelum menyentuh
  // state. Kurang → ringkasan parsial, tick berikut melanjutkan (tidak throw).
  if (!db.canSpend(1 + FIXED_RECOVERY_WRITES)) return { ...out, budget_deferred: true };
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
  // yang terkirim → queued; SK yang diklaim tetapi belum fence juga aman queued.
  // Dengan fence/attempt → ambigu → pending (cek ulang ref SAMA).
  const STALE = `status='submitting' AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))`;
  await db.execRun(
    `UPDATE games_order_items SET status='queued', lease_until=NULL, updated_at=datetime('now')
      WHERE ${STALE} AND NOT EXISTS(SELECT 1 FROM games_dispatch_attempts a
        WHERE a.order_code=games_order_items.order_code AND a.attempt_no=games_order_items.attempt_no)`,
  );
  await db.execRun(
    `UPDATE games_order_items SET status='queued', lease_until=NULL, updated_at=datetime('now')
      WHERE ${STALE} AND supplier='sekalipay' AND EXISTS(SELECT 1 FROM games_dispatch_attempts a
        WHERE a.order_code=games_order_items.order_code AND a.attempt_no=games_order_items.attempt_no
          AND a.request_sent_at IS NULL)`,
  );
  await db.execRun(
    `UPDATE games_dispatch_attempts SET status='ambiguous', message=COALESCE(message,'submit interrupted'), updated_at=datetime('now')
      WHERE status='submitting' AND EXISTS(SELECT 1 FROM games_order_items i
        WHERE i.order_code=games_dispatch_attempts.order_code AND i.attempt_no=games_dispatch_attempts.attempt_no
          AND i.status='submitting' AND (i.lease_until IS NULL OR datetime(i.lease_until)<=datetime('now'))
          AND (i.supplier<>'sekalipay' OR games_dispatch_attempts.request_sent_at IS NOT NULL))`,
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
      `SELECT i.order_code, i.buyer_sku_code, i.customer_no, i.max_price, i.attempt_no, i.supplier,
              i.sk_variant_id, i.target_snapshot, i.unit_price, i.supplier_ref,
              p.backup_sku_code AS p_backup_sku, p.supplier_active AS p_active, p.stock AS p_stock,
              p.min_order AS p_min_order, p.required_fields_json AS p_fields
         FROM games_order_items i LEFT JOIN games_products p ON p.id=i.product_id
        WHERE i.status='queued' AND (i.lease_until IS NULL OR datetime(i.lease_until)<=datetime('now'))
          AND EXISTS(SELECT 1 FROM orders o WHERE o.code=i.order_code AND o.status='lunas' AND o.payment_status='paid')
        ORDER BY i.id ASC LIMIT ${DISPATCH_PER_RUN}`,
    );
    for (const item of queued) {
      const cost = String(item.supplier ?? "digiflazz") === "sekalipay" ? SK_DISPATCH_COST : DISPATCH_COST;
      if (!db.canSpend(cost + POLL_RESERVE) || Date.now() - startedAt > NETWORK_WINDOW_MS) break;
      await dispatchOne(db, item, send, out, skReady);
      if (out.error) break; // config rusak: sisa antrean akan gagal sama.
    }
  }

  // Polling pending dengan backoff umur attempt: 60 dtk (<10 mnt), 120 dtk (<1 jam), 300 dtk.
  if (!out.error && db.canSpend(1)) {
    const due = await db.queryAll(
      `SELECT i.order_code, i.customer_no, i.max_price, i.attempt_no, i.last_polled_at, i.supplier,
              i.sk_variant_id, i.target_snapshot, i.unit_price, i.cost_snapshot, i.supplier_ref,
              a.ref_id AS a_ref, a.buyer_sku_code AS a_sku, a.sk_invoice AS a_invoice, a.request_sent_at AS a_sent
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
