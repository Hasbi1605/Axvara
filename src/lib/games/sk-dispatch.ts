// src/lib/games/sk-dispatch.ts — pengirim + parser transaksi Sekalipay H2H
// untuk AXVARA Games. Terpisah dari pipeline lisensi premium (`sk_order_links`).
//
// Invarian:
//  * `ref_id` stabil per pesanan (bentuk kompak `AXG…`, ≤50 karakter).
//  * Sent-fence ditulis SEBELUM POST; setelah itu tidak pernah ada POST kedua —
//    timeout/5xx/404/ref sudah ada → GET ref yang sama.
//  * Sukses HANYA dari GET authoritative: transaksi `completed`, tepat satu
//    item cart qty1 yang cocok varian/target, tepat satu hasil H2H dengan
//    variant_id cocok (diwarisi item untuk hasil nested), dispatch `completed`, SN nyata, unit konsisten,
//    dan biaya tertagih terverifikasi <= batas quote.
//  * Biaya tertagih = `amount` terdokumentasi bila valid, jika tidak
//    `price + fees`; disimpan di attempts.price. Pemeriksaan ini DETEKSI
//    pasca-tagih untuk manual review, bukan pencegahan debit (SK tidak punya
//    parameter max_price).
//  * Partial/SN palsu/mismatch/biaya tak terverifikasi → needs_check.
//  * Legacy Digiflazz tidak disentuh modul ini.

import type { DatabaseAccess } from "@/lib/db-access";
import {
  createSkTransaction,
  fetchSkTransaction,
  type SkCart,
  type SkCreateTrxResult,
  type SkTrxDetail,
} from "@/lib/sekalipay/client";
import { parseGamesSkTargetSnapshot, type GamesSkTarget } from "./registry";

type Db = DatabaseAccess;
type Row = Record<string, unknown>;

export type SkApplyOutcome = "success" | "pending" | "needs_check" | "ignored" | "unknown_ref";

export type SkH2hOutcome =
  | { kind: "success"; sn: string; message: string; dispatchStatus: string; unitsJson: string | null; actualCost: number | null; costReason: string | null }
  | { kind: "failed"; message: string; dispatchStatus: string | null; unitsJson: string | null }
  | { kind: "partial"; message: string; dispatchStatus: string; unitsJson: string | null }
  | { kind: "pending"; message: string; dispatchStatus: string | null; unitsJson: string | null }
  | { kind: "mismatch"; message: string };

const clip = (value: unknown, max = 300): string => String(value ?? "").slice(0, max);
const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const lower = (value: unknown): string => str(value).trim().toLowerCase();
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value && typeof value === "object" ? [value] : []);

/** Ref SK Games: kompak dari order code, stabil, ≤50 karakter. */
export function skGamesRef(orderCode: string): string {
  const compact = String(orderCode ?? "").replace(/[^A-Za-z0-9]/g, "");
  return (compact || "AXG").slice(0, 50);
}

export function skGamesPayload(refId: string, variantId: number, target: GamesSkTarget): Record<string, unknown> {
  const cart: SkCart = {
    item_id: variantId,
    quantity: 1,
    note: target.note,
    ...(target.zone_id ? { zone_id: target.zone_id } : {}),
  };
  return { ref_id: refId, carts: [cart] };
}

/** POST /v1/trx H2H. Tidak pernah dipanggil setelah fence tersimpan. */
export function sendSkGamesTransaction(refId: string, variantId: number, target: GamesSkTarget): Promise<SkCreateTrxResult> {
  return createSkTransaction({ refId, carts: [{ item_id: variantId, quantity: 1, note: target.note, ...(target.zone_id ? { zone_id: target.zone_id } : {}) }] });
}

export function fetchSkGamesStatus(refOrInvoice: string): Promise<SkTrxDetail> {
  return fetchSkTransaction(refOrInvoice);
}

export interface SkParserExpectation {
  variantId: number;
  refId: string;
  invoice?: string | null;
  target?: GamesSkTarget | null;
}

/**
 * Biaya tertagih terdokumentasi: `amount` total bila valid, jika tidak
 * `price + fees`. Tidak pernah mencampur amount dengan fees lagi.
 * Nilai rusak/negatif/kontradiktif → null + alasan (tidak boleh sukses).
 */
export function parseSkActualCost(detail: SkTrxDetail): { value: number | null; reason: string | null } {
  const amountRaw = (detail as Row)?.amount;
  const priceRaw = (detail as Row)?.price;
  const feesRaw = (detail as Row)?.fees;
  const amount = amountRaw === null || amountRaw === undefined ? null : num(amountRaw);
  const price = priceRaw === null || priceRaw === undefined ? null : num(priceRaw);
  const fees = feesRaw === null || feesRaw === undefined ? null : num(feesRaw);
  if (amountRaw !== null && amountRaw !== undefined && amount === null) return { value: null, reason: "amount_malformed" };
  if (priceRaw !== null && priceRaw !== undefined && price === null) return { value: null, reason: "price_malformed" };
  if (feesRaw !== null && feesRaw !== undefined && fees === null) return { value: null, reason: "fees_malformed" };
  if (amount !== null && amount < 0) return { value: null, reason: "amount_negative" };
  if (price !== null && price < 0) return { value: null, reason: "price_negative" };
  if (fees !== null && fees < 0) return { value: null, reason: "fees_negative" };
  let actual: number | null = null;
  if (amount !== null) {
    // amount = total (price + fees). Kontradiksi amount < price menandakan
    // respons tidak dapat dipercaya; jangan menambahkan fees dua kali.
    if (price !== null && amount + 0.01 < price) return { value: null, reason: "amount_price_contradiction" };
    actual = amount;
  } else if (price !== null) {
    actual = price + (fees ?? 0);
  }
  if (actual === null) return { value: null, reason: "cost_missing" };
  if (!(actual > 0) || !Number.isFinite(actual)) return { value: null, reason: "cost_invalid" };
  const rounded = Math.ceil(actual);
  if (!Number.isSafeInteger(rounded) || rounded <= 0) return { value: null, reason: "cost_invalid" };
  return { value: rounded, reason: null };
}

const targetDisplay = (target: GamesSkTarget): string => target.zone_id ? `${target.note}|${target.zone_id}` : target.note;

/**
 * Parser murni hasil GET detail (webhook object H2H diterima lewat `asArray`).
 * Games selalu satu cart qty1, sehingga item/hasil ganda atau varian berbeda
 * adalah mismatch — bukan sukses.
 */
export function parseSkH2hOutcome(detail: SkTrxDetail, expected: SkParserExpectation): SkH2hOutcome {
  if (str(detail?.ref_id).trim() !== expected.refId) {
    return { kind: "mismatch", message: `ref mismatch: ${clip(detail?.ref_id, 80)}` };
  }
  if (expected.invoice && str(detail?.invoice).trim() && str(detail.invoice).trim() !== expected.invoice) {
    return { kind: "mismatch", message: "invoice mismatch" };
  }
  if (!expected.target) return { kind: "mismatch", message: "target snapshot missing" };

  // Satu cart qty1; items wajib ada dan tepat satu.
  const items = Array.isArray(detail?.items) ? detail.items : [];
  if (items.length !== 1) return { kind: "mismatch", message: `items count ${items.length}` };
  const item = items[0];
  if (Number(item?.variant_id) !== expected.variantId) return { kind: "mismatch", message: "variant mismatch" };
  if (Number(item?.qty ?? item?.quantity) !== 1
    || (item?.qty != null && item?.quantity != null && Number(item.qty) !== Number(item.quantity))) {
    return { kind: "mismatch", message: "quantity mismatch" };
  }
  const expectedDisplay = targetDisplay(expected.target);
  // SK detail hanya mengekspos note/target; bila membawa bentuk "note|zone"
  // bandingkan penuh. Bila hanya note, zone tidak tersedia di respons — bukti
  // zone tetap payload snapshot yang dikirim (didokumentasikan, tidak direka).
  for (const raw of [(item as Row)?.note, (item as Row)?.target, (detail as Row)?.target]) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const value = raw.trim();
    if (value.includes("|")) {
      if (value !== expectedDisplay) return { kind: "mismatch", message: "target mismatch" };
    } else if (value !== expected.target.note) {
      return { kind: "mismatch", message: "target mismatch" };
    }
  }

  const txStatus = lower(detail?.status);
  const nested = item?.h2h_results != null;
  const results = asArray(nested ? item.h2h_results : detail?.h2h_results).filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object");
  if (results.length > 1) return { kind: "mismatch", message: `h2h results ${results.length}` };
  const result = results[0];
  // A per-item result inherits the already-verified cart variant. Legacy
  // top-level results must still declare their own variant.
  if (result && ((!nested && result.variant_id === undefined)
    || (result.variant_id !== undefined && Number(result.variant_id) !== expected.variantId))) {
    return { kind: "mismatch", message: "h2h variant mismatch" };
  }
  const dispatchStatus = result ? lower(result.dispatch_status) : null;
  const message = clip(result ? result.dispatch_message ?? result.log_message : `status ${txStatus}`);
  const units = asArray(result?.units);
  const unitsJson = units.length > 0 ? JSON.stringify(units).slice(0, 4_000) : null;

  // Terminal non-sukses transaksi (refunded/cancelled/expired) ≠ pending: SK sudah
  // mengembalikan saldo, jadi order harus keluar dari polling ke needs_check (18 Nov 2026).
  const txTerminalFailure = /fail|cancel|refund|expire/.test(txStatus);
  if (txTerminalFailure || dispatchStatus === "failed") {
    return { kind: "failed", message, dispatchStatus, unitsJson };
  }
  if (dispatchStatus === "partial") {
    return { kind: "partial", message, dispatchStatus, unitsJson };
  }
  if (!result) {
    if (txStatus === "completed") return { kind: "mismatch", message: "completed tanpa hasil H2H" };
    return { kind: "pending", message, dispatchStatus, unitsJson };
  }
  if (dispatchStatus === "completed") {
    if (txStatus !== "completed") return { kind: "pending", message, dispatchStatus, unitsJson };
    const unitSn = units.map((unit) => str((unit as Row)?.sn)).find((sn) => sn.trim() !== "") ?? "";
    const sn = str(result?.sn).trim() || unitSn.trim();
    if (!sn || /^failed:/i.test(sn)) {
      return { kind: "mismatch", message: `completed tanpa SN sah: ${clip(sn || message, 120)}` };
    }
    if (units.some((unit) => /^failed:/i.test(str((unit as Row)?.sn)))) {
      return { kind: "failed", message: "unit gagal", dispatchStatus, unitsJson };
    }
    const statuses = units.map((unit) => lower((unit as Row)?.dispatch_status ?? (unit as Row)?.status)).filter(Boolean);
    if (statuses.some((status) => status !== "completed")) {
      return { kind: "partial", message: "unit status tidak konsisten", dispatchStatus, unitsJson };
    }
    const total = num(result?.total_units);
    const delivered = num(result?.delivered_units);
    const failed = num(result?.failed_units);
    if (["total_units", "delivered_units", "failed_units"].some((key) => result[key] != null
      && (num(result[key]) === null || !Number.isInteger(num(result[key]))))) {
      return { kind: "mismatch", message: "unit count invalid" };
    }
    if (units.length > 1 || (total !== null && total !== 1)
      || (delivered !== null && delivered > 1) || (failed !== null && failed < 0)) {
      return { kind: "mismatch", message: "unit count mismatch" };
    }
    if (units.some((unit) => str((unit as Row)?.sn).trim() && str((unit as Row)?.sn).trim() !== sn)) {
      return { kind: "mismatch", message: "unit SN mismatch" };
    }
    if ((failed !== null && failed > 0) || (delivered !== null && delivered !== 1)) {
      return { kind: "partial", message: `unit ${delivered ?? "?"}/${total ?? "?"}`, dispatchStatus, unitsJson };
    }
    const cost = parseSkActualCost(detail);
    return { kind: "success", sn: clip(sn, 120), message, dispatchStatus, unitsJson, actualCost: cost.value, costReason: cost.reason };
  }
  if (txStatus === "completed") {
    return { kind: "mismatch", message: "completed tanpa H2H completed" };
  }
  return { kind: "pending", message, dispatchStatus, unitsJson };
}

async function notifyNeedsCheck(db: Db, orderCode: string, reason: string): Promise<void> {
  try {
    const { notifyGamesNeedsCheck } = await import("@/lib/games/notify");
    await notifyGamesNeedsCheck(db, orderCode, reason);
  } catch { /* best-effort */ }
}

async function markNeedsCheck(
  db: Db,
  args: {
    orderCode: string; attemptNo: number; refId: string; message: string; reason: string;
    invoice: string | null; actualCost: number | null; sn: string | null;
    dispatchStatus: string | null; unitsJson: string | null; notifyReason: string;
  },
): Promise<SkApplyOutcome> {
  const changed = await db.execRun(
    `UPDATE games_order_items SET status='needs_check', sn=COALESCE(?,sn), supplier_message=?, lease_until=NULL,
       last_error=?, sk_invoice=COALESCE(NULLIF(sk_invoice,''),NULLIF(?, '')), updated_at=datetime('now')
      WHERE order_code=? AND attempt_no=? AND supplier='sekalipay' AND status IN ('submitting','pending')`,
    args.sn, args.message, clip(args.reason, 300), args.invoice, args.orderCode, args.attemptNo,
  );
  if (Number(changed.changes) !== 1) return "ignored";
  await db.execRun(
    `UPDATE games_dispatch_attempts SET status='failed', message=?, sn=COALESCE(?,sn), price=COALESCE(?,price),
       sk_invoice=COALESCE(NULLIF(sk_invoice,''),NULLIF(?, '')), dispatch_status=COALESCE(?,dispatch_status),
       units_json=COALESCE(?,units_json), updated_at=datetime('now')
      WHERE ref_id=? AND status IN ('submitting','pending','ambiguous')`,
    clip(args.reason, 300), args.sn, args.actualCost, args.invoice, args.dispatchStatus, args.unitsJson, args.refId,
  );
  await notifyNeedsCheck(db, args.orderCode, clip(args.notifyReason, 300));
  return "needs_check";
}

/**
 * Terapkan detail SK (polling/webhook) ke item SK aktif. Recovery admin hanya
 * membuka needs_check untuk sukses terverifikasi. Invoice tersimpan otoritas; hint
 * webhook tidak pernah ditulis sebelum korelasi GET.
 */
export async function applySkTransactionDetail(
  db: Db,
  detail: SkTrxDetail,
  context: { refId: string; invoiceHint?: string | null; adminRecheck?: boolean },
): Promise<SkApplyOutcome> {
  const cur = await db.queryFirst(
    `SELECT a.attempt_no AS a_no, a.sk_invoice AS a_invoice, i.sk_invoice AS i_invoice, i.order_code, i.status AS i_status, i.attempt_no AS i_no,
            i.supplier AS i_supplier, i.sk_variant_id, i.target_snapshot, i.max_price, i.cost_snapshot, i.unit_price
       FROM games_dispatch_attempts a
       JOIN games_order_items i ON i.order_code=a.order_code
      WHERE a.ref_id=?`,
    context.refId,
  );
  if (!cur) return "unknown_ref";
  const orderCode = String(cur.order_code);
  const attemptNo = Number(cur.a_no);
  if (cur.i_supplier !== "sekalipay" || attemptNo !== Number(cur.i_no)
    || (cur.i_status !== "submitting" && cur.i_status !== "pending"
      && !(context.adminRecheck && cur.i_status === "needs_check"))) return "ignored";
  const variantId = Number(cur.sk_variant_id);
  if (!Number.isInteger(variantId) || variantId <= 0) return "ignored";
  const target = parseGamesSkTargetSnapshot(cur.target_snapshot);
  const invoice = String(cur.a_invoice || cur.i_invoice || "").trim() || null;
  if (cur.a_invoice && cur.i_invoice && cur.a_invoice !== cur.i_invoice) return "ignored";
  const outcome = parseSkH2hOutcome(detail, { variantId, refId: context.refId, invoice, target });
  const recovering = context.adminRecheck && cur.i_status === "needs_check";
  // Admin GET recovery alone can reopen needs_check, and only on verified
  // success. Pending/mismatch never erase the original manual-review state.
  if (recovering && outcome.kind !== "success") return "needs_check";
  const detailInvoice = str(detail?.invoice).trim() || null;
  const cost = parseSkActualCost(detail);
  const guard = `order_code=? AND attempt_no=? AND supplier='sekalipay' AND status IN (${recovering ? "'needs_check'" : "'submitting','pending'"})${recovering ? " AND EXISTS(SELECT 1 FROM orders o WHERE o.code=games_order_items.order_code AND o.order_kind='games' AND o.status='lunas' AND o.payment_status='paid')" : ""}`;
  const attemptGuard = `ref_id=? AND status IN (${recovering ? "'failed','submitting','pending','ambiguous'" : "'submitting','pending','ambiguous'"})`;

  if (outcome.kind === "success") {
    const maxPrice = Number(cur.max_price);
    const revenueCeiling = Number(cur.unit_price);
    let costFailure: string | null = null;
    if (outcome.actualCost === null) costFailure = `cost_unverifiable:${outcome.costReason ?? "unknown"}`;
    else if (!Number.isFinite(maxPrice) || outcome.actualCost > maxPrice) costFailure = `actual_cost_exceeded:${outcome.actualCost}>${Number(cur.max_price)}`;
    else if (!Number.isFinite(revenueCeiling) || outcome.actualCost > revenueCeiling) costFailure = `actual_cost_exceeded:${outcome.actualCost}>${Number(cur.unit_price)}`;
    if (costFailure) {
      if (recovering) return "needs_check";
      return markNeedsCheck(db, {
        orderCode, attemptNo, refId: context.refId, message: `${outcome.message} [${costFailure}]`,
        reason: costFailure, invoice: detailInvoice, actualCost: outcome.actualCost, sn: outcome.sn,
        dispatchStatus: outcome.dispatchStatus, unitsJson: outcome.unitsJson, notifyReason: costFailure,
      });
    }
    const changed = await db.execRun(
      `UPDATE games_order_items SET status='success', sn=?, supplier_message=?, completed_at=datetime('now'),
         lease_until=NULL, last_error=NULL, sk_invoice=COALESCE(NULLIF(sk_invoice,''),NULLIF(?, '')), updated_at=datetime('now')
        WHERE ${guard}`,
      outcome.sn, outcome.message, detailInvoice, orderCode, attemptNo,
    );
    if (Number(changed.changes) !== 1) return "ignored";
    await db.execRun(
      `UPDATE games_dispatch_attempts SET status='success', message=?, sn=?, price=?, sk_invoice=COALESCE(NULLIF(sk_invoice,''),NULLIF(?, '')),
         dispatch_status=?, units_json=?, updated_at=datetime('now') WHERE ${attemptGuard}`,
      outcome.message, outcome.sn, outcome.actualCost, detailInvoice, outcome.dispatchStatus, outcome.unitsJson, context.refId,
    );
    try {
      const { notifyGamesCompleted } = await import("./notify");
      await notifyGamesCompleted(db, orderCode);
    } catch { /* Email never changes fulfillment state. */ }
    return "success";
  }

  if (outcome.kind === "pending") {
    const changed = await db.execRun(
      `UPDATE games_order_items SET status='pending', supplier_message=?, lease_until=NULL, last_polled_at=datetime('now'),
         sk_invoice=COALESCE(NULLIF(sk_invoice,''),NULLIF(?, '')), updated_at=datetime('now') WHERE ${guard}`,
      outcome.message, detailInvoice, orderCode, attemptNo,
    );
    if (Number(changed.changes) !== 1) return "ignored";
    await db.execRun(
      `UPDATE games_dispatch_attempts SET status='pending', message=?, price=COALESCE(?,price),
         sk_invoice=COALESCE(NULLIF(sk_invoice,''),NULLIF(?, '')), dispatch_status=?, units_json=?, updated_at=datetime('now')
        WHERE ${attemptGuard}`,
      outcome.message, cost.value, detailInvoice, outcome.dispatchStatus, outcome.unitsJson, context.refId,
    );
    return "pending";
  }

  // failed / partial / mismatch → needs_check, tanpa seller cadangan.
  const reason = outcome.message || outcome.kind;
  return markNeedsCheck(db, {
    orderCode, attemptNo, refId: context.refId, message: outcome.message,
    reason: `${outcome.kind}: ${reason}`, invoice: detailInvoice, actualCost: cost.value, sn: null,
    dispatchStatus: outcome.kind === "mismatch" ? null : outcome.dispatchStatus,
    unitsJson: outcome.kind === "mismatch" ? null : outcome.unitsJson,
    notifyReason: `${outcome.kind}: ${reason}`,
  });
}
