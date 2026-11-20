// src/lib/supplier/topup.ts — Orkestrasi invoice topup saldo supplier (admin).
//
// AXVARA HANYA membuat invoice deposit + melacak statusnya. Owner membayar
// sendiri (link/QR SK atau transfer USDT BEP20 TUNVN). Tidak ada payout
// otomatis, tidak ada uang yang dikirim AXVARA, dan tidak ada retry buta.
//
// state machine: creating -> pending -> paid | expired | failed
//                                 -> unknown (ambigu; refresh aman, ref_id sama)

import type { DatabaseAccess } from "@/lib/db-access";
import { isSkConfigured, isSkEnabled, isSkSandbox } from "@/lib/sekalipay/client";
import {
  classifySkTopupFailure,
  createSkTopup,
  fetchSkTopupChannels,
  findSkTopupCredit,
  isSkRefIdAlreadyExists,
  numOrNull,
  strOrNull,
  type SkTopupChannel,
  type SkTopupInvoice,
} from "@/lib/sekalipay/topup";
import {
  callTunvnDeposit,
  callTunvnDepositStatus,
  isTunvnConfigured,
  parseTunvnDeposit,
  parseTunvnDepositStatus,
} from "@/lib/tunvn/client";

const SUPPLIER_TOPUP_MAX_PENDING = 3;
const SUPPLIER_TOPUP_REFRESH_MIN_MS = 10_000;
/** Baris creating/unknown tanpa expires_at hanya menahan kuota pending selama ini. */
const SUPPLIER_TOPUP_UNDATED_PENDING_MS = 30 * 60_000;
const ERROR_MAX_CHARS = 200;

export type SupplierTopupSupplier = "sekalipay" | "tunvn";
export type SupplierTopupStatus = "creating" | "pending" | "paid" | "expired" | "failed" | "unknown";

export type SupplierTopupItem = {
  id: number;
  supplier: SupplierTopupSupplier;
  ref_id: string;
  supplier_ref: string | null;
  channel: string | null;
  currency: "IDR" | "USDT";
  requested_amount: number;
  pay_amount: number | null;
  credit_amount: number | null;
  fee_amount: number | null;
  status: SupplierTopupStatus;
  /** Instruksi pembayaran non-secret (link/QR atau address USDT). */
  payment: Record<string, unknown> | null;
  error: string | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
  paid_at: number | null;
};

export class SupplierTopupError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "SupplierTopupError";
  }
}

export function supplierTopupGates(): { sekalipay: boolean; tunvn: boolean } {
  return {
    sekalipay: isSkEnabled() && isSkConfigured() && !isSkSandbox(),
    tunvn: isTunvnConfigured(),
  };
}

function assertSupplierGate(supplier: SupplierTopupSupplier): void {
  if (supplierTopupGates()[supplier]) return;
  throw new SupplierTopupError(503, supplier === "sekalipay" ? "sekalipay_unavailable" : "tunvn_unavailable");
}

/** `AXVTU-YYYYMMDD-<8 hex>`; tidak pernah diawali `GW-` dan tidak dari klien. */
export function createSupplierTopupRefId(now = Date.now()): string {
  const d = new Date(now);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `AXVTU-${ymd}-${hex}`;
}

function sanitizeError(code: string): string {
  return code.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, ERROR_MAX_CHARS);
}

function parsePayment(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function rowToItem(row: Record<string, unknown>): SupplierTopupItem {
  return {
    id: Number(row.id),
    supplier: row.supplier as SupplierTopupSupplier,
    ref_id: String(row.ref_id),
    supplier_ref: strOrNull(row.supplier_ref),
    channel: strOrNull(row.channel),
    currency: row.currency as "IDR" | "USDT",
    requested_amount: Number(row.requested_amount),
    pay_amount: numOrNull(row.pay_amount),
    credit_amount: numOrNull(row.credit_amount),
    fee_amount: numOrNull(row.fee_amount),
    status: row.status as SupplierTopupStatus,
    payment: parsePayment(row.payment_json),
    error: strOrNull(row.error),
    expires_at: numOrNull(row.expires_at),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    paid_at: numOrNull(row.paid_at),
  };
}

async function loadItem(db: DatabaseAccess, id: number): Promise<SupplierTopupItem | null> {
  const row = await db.queryFirst("SELECT * FROM supplier_topups WHERE id=?", id);
  return row ? rowToItem(row) : null;
}

async function setStatus(
  db: DatabaseAccess,
  id: number,
  status: SupplierTopupStatus,
  error: string | null,
  now: number,
): Promise<void> {
  await db.execRun(
    "UPDATE supplier_topups SET status=?, error=?, updated_at=? WHERE id=? AND status NOT IN ('paid','failed')",
    status,
    error === null ? null : sanitizeError(error),
    now,
    id,
  );
}

/** Gagal MEMERIKSA status bukan bukti invoice gagal/lunas: status tetap,
 *  hanya error terakhir + updated_at yang dicatat (refresh berikutnya aman). */
async function noteCheckError(db: DatabaseAccess, id: number, error: string, now: number): Promise<void> {
  await db.execRun("UPDATE supplier_topups SET error=?, updated_at=? WHERE id=? AND status NOT IN ('paid','failed')", sanitizeError(error), now, id);
}

async function touch(db: DatabaseAccess, id: number, now: number): Promise<void> {
  await db.execRun("UPDATE supplier_topups SET updated_at=? WHERE id=? AND status NOT IN ('paid','failed')", now, id);
}

export type CreateSupplierTopupInput =
  | { supplier: "sekalipay"; code: string; amount: number }
  | { supplier: "tunvn"; amount: number };

/** Validasi input create; melempar 400 invalid_request bila bentuk salah. */
function normalizeCreateInput(input: unknown): CreateSupplierTopupInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SupplierTopupError(400, "invalid_request");
  const raw = input as Record<string, unknown>;
  const supplier = raw.supplier;
  const amount = raw.amount;
  if (supplier !== "sekalipay" && supplier !== "tunvn") throw new SupplierTopupError(400, "invalid_request");
  if (typeof amount !== "number" || !Number.isFinite(amount)) throw new SupplierTopupError(400, "invalid_request");
  if (supplier === "sekalipay") {
    const code = typeof raw.code === "string" ? raw.code.trim() : "";
    if (!code || code.length > 120 || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new SupplierTopupError(400, "invalid_request");
    }
    return { supplier, code, amount };
  }
  if (amount < 1 || amount > 1000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-9) {
    throw new SupplierTopupError(400, "invalid_request");
  }
  return { supplier, amount };
}

export async function createSupplierTopup(
  db: DatabaseAccess,
  input: unknown,
  opts: { now?: number } = {},
): Promise<SupplierTopupItem> {
  const now = opts.now ?? Date.now();
  const normalized = normalizeCreateInput(input);
  assertSupplierGate(normalized.supplier);

  const refId = createSupplierTopupRefId(now);
  const channel = normalized.supplier === "sekalipay" ? normalized.code : "USDT_BEP20";
  const currency = normalized.supplier === "sekalipay" ? "IDR" : "USDT";
  // Reserve a slot atomically before calling the supplier. A read followed by
  // an insert lets concurrent requests all observe the same spare capacity.
  const inserted = await db.queryFirst(
    `INSERT INTO supplier_topups
       (supplier,ref_id,channel,currency,requested_amount,status,created_at,updated_at)
     SELECT ?,?,?,?,?,'creating',?,?
      WHERE (SELECT COUNT(*) FROM supplier_topups
              WHERE supplier=? AND status IN ('creating','pending','unknown')
                AND (expires_at > ? OR (expires_at IS NULL AND created_at > ?))) < ?
     RETURNING id`,
    normalized.supplier,
    refId,
    channel,
    currency,
    normalized.amount,
    now,
    now,
    normalized.supplier,
    now,
    now - SUPPLIER_TOPUP_UNDATED_PENDING_MS,
    SUPPLIER_TOPUP_MAX_PENDING,
  );
  if (!inserted) throw new SupplierTopupError(429, "too_many_pending");
  const id = Number(inserted.id);

  try {
    if (normalized.supplier === "sekalipay") {
      await createSekalipayTopup(db, { id, refId, code: normalized.code, amount: normalized.amount, now });
    } else {
      await createTunvnTopup(db, { id, amount: normalized.amount, now });
    }
  } catch (error) {
    if (error instanceof SupplierTopupError) throw error;
    await setStatus(db, id, "unknown", "topup_unexpected", now);
    throw new SupplierTopupError(502, "topup_unexpected");
  }

  const item = await loadItem(db, id);
  if (!item) throw new SupplierTopupError(503, "load_failed");
  return item;
}

function storeSkInvoice(db: DatabaseAccess, id: number, invoice: SkTopupInvoice, now: number): Promise<unknown> {
  const payment = JSON.stringify({
    payment_link: invoice.payment_link,
    payment_url: invoice.payment_url,
    qr_link: invoice.qr_link,
  });
  return db.execRun(
    `UPDATE supplier_topups
        SET supplier_ref=?, pay_amount=?, credit_amount=?, fee_amount=?,
            status='pending', payment_json=?, error=NULL, expires_at=?, updated_at=?
      WHERE id=? AND status NOT IN ('paid','failed')`,
    invoice.invoice,
    invoice.pay_amount,
    invoice.credit_amount,
    invoice.fee_amount,
    payment,
    invoice.expires_at,
    now,
    id,
  );
}

async function createSekalipayTopup(
  db: DatabaseAccess,
  args: { id: number; refId: string; code: string; amount: number; now: number },
): Promise<void> {
  let channels: SkTopupChannel[];
  try {
    channels = await fetchSkTopupChannels();
  } catch (error) {
    const cls = classifySkTopupFailure(error);
    await setStatus(db, args.id, cls.kind, cls.code, args.now);
    throw new SupplierTopupError(502, cls.code);
  }
  const channel = channels.find((c) => c.service === args.code);
  if (!channel || channel.status !== "on") {
    await setStatus(db, args.id, "failed", "channel_unavailable", args.now);
    throw new SupplierTopupError(409, "channel_unavailable");
  }
  if (args.amount < channel.minimum || args.amount > channel.maximum) {
    await setStatus(db, args.id, "failed", "amount_out_of_range", args.now);
    throw new SupplierTopupError(400, "amount_out_of_range");
  }
  let invoice: SkTopupInvoice;
  try {
    invoice = await createSkTopup({ refId: args.refId, code: args.code, amount: args.amount });
  } catch (error) {
    const cls = classifySkTopupFailure(error);
    await setStatus(db, args.id, cls.kind, cls.code, args.now);
    throw new SupplierTopupError(502, cls.code);
  }
  await storeSkInvoice(db, args.id, invoice, args.now);
}

async function createTunvnTopup(
  db: DatabaseAccess,
  args: { id: number; amount: number; now: number },
): Promise<void> {
  const res = await callTunvnDeposit(args.amount);
  if (res.kind === "config") {
    const code = sanitizeError(res.reason);
    await setStatus(db, args.id, "failed", code, args.now);
    throw new SupplierTopupError(502, code);
  }
  if (res.kind === "ambiguous") {
    const code = sanitizeError(`tunvn_${res.reason}`);
    await setStatus(db, args.id, "unknown", code, args.now);
    throw new SupplierTopupError(502, code);
  }
  if (res.kind === "http_error") {
    const code = `tunvn_http_${res.status}`;
    await setStatus(db, args.id, "failed", code, args.now);
    throw new SupplierTopupError(502, code);
  }
  const parsed = parseTunvnDeposit(res.json, args.amount);
  if (!parsed.ok) {
    await setStatus(db, args.id, "failed", parsed.error, args.now);
    throw new SupplierTopupError(502, parsed.error);
  }
  const deposit = parsed.deposit;
  const expiresAt = deposit.expires_in_minutes !== null && deposit.expires_in_minutes > 0
    ? args.now + Math.round(deposit.expires_in_minutes * 60_000)
    : null;
  const payment = JSON.stringify({
    address: deposit.wallet_transfer.address,
    network: deposit.wallet_transfer.network,
    exact_amount: deposit.wallet_transfer.exact_amount,
    instruction: deposit.wallet_transfer.instruction,
  });
  await db.execRun(
    `UPDATE supplier_topups
        SET supplier_ref=?, channel='USDT_BEP20', pay_amount=?, credit_amount=?,
            status='pending', payment_json=?, error=NULL, expires_at=?, updated_at=?
      WHERE id=? AND status NOT IN ('paid','failed')`,
    deposit.payment_code,
    deposit.wallet_transfer.exact_amount,
    deposit.amount_usdt,
    payment,
    expiresAt,
    args.now,
    args.id,
  );
}

export async function listSupplierTopups(
  db: DatabaseAccess,
  opts: { supplier?: SupplierTopupSupplier | null; limit?: number } = {},
): Promise<SupplierTopupItem[]> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? 20)), 100);
  const rows = opts.supplier
    ? await db.queryAll(
        "SELECT * FROM supplier_topups WHERE supplier=? ORDER BY created_at DESC, id DESC LIMIT ?",
        opts.supplier,
        limit,
      )
    : await db.queryAll(
        "SELECT * FROM supplier_topups ORDER BY created_at DESC, id DESC LIMIT ?",
        limit,
      );
  return rows.map(rowToItem);
}

export async function refreshSupplierTopup(
  db: DatabaseAccess,
  id: number,
  opts: { now?: number } = {},
): Promise<SupplierTopupItem> {
  const now = opts.now ?? Date.now();
  const item = await loadItem(db, id);
  if (!item) throw new SupplierTopupError(404, "not_found");
  // paid/failed terminal on entry. In-flight refreshes may still finish out
  // of order; their writes also guard the current status in SQL.
  if (item.status === "paid" || item.status === "failed") return item;
  if (now - item.updated_at < SUPPLIER_TOPUP_REFRESH_MIN_MS) throw new SupplierTopupError(429, "too_soon");
  assertSupplierGate(item.supplier);
  if (item.supplier === "sekalipay") await refreshSekalipayTopup(db, item, now);
  else await refreshTunvnTopup(db, item, now);
  const refreshed = await loadItem(db, id);
  if (!refreshed) throw new SupplierTopupError(503, "load_failed");
  return refreshed;
}

async function refreshSekalipayTopup(db: DatabaseAccess, item: SupplierTopupItem, now: number): Promise<void> {
  const payment = item.payment ?? {};
  const hasLink = Boolean(payment.payment_link || payment.payment_url || payment.qr_link);
  const invoice = item.supplier_ref;
  // An invoice is enough to reconcile credit; a missing link must not block
  // payment/expiry checks, even when the same ref_id cannot be posted again.
  if (invoice) {
    let credit;
    try {
      credit = await findSkTopupCredit(invoice);
    } catch (error) {
      const cls = classifySkTopupFailure(error);
      await noteCheckError(db, item.id, cls.code, now);
      throw new SupplierTopupError(502, cls.code);
    }
    if (credit) {
      await db.execRun(
        "UPDATE supplier_topups SET status='paid', paid_at=?, credit_amount=?, error=NULL, updated_at=? WHERE id=? AND status<>'paid'",
        now,
        credit.amount ?? item.credit_amount,
        now,
        item.id,
      );
      return;
    }
    if (item.expires_at !== null && now > item.expires_at) {
      if (item.status !== "expired") await setStatus(db, item.id, "expired", item.error, now);
      else await touch(db, item.id, now);
      return;
    }
  }

  if (!invoice || !hasLink) {
    // A link recovery failure is not proof a known invoice cannot be paid.
    const noteRepostFailure = (status: SupplierTopupStatus, error: string) => invoice
      ? noteCheckError(db, item.id, error, now)
      : setStatus(db, item.id, status, error, now);
    const code = item.channel ?? "";
    const amount = Math.trunc(item.requested_amount);
    if (!code) {
      await noteRepostFailure("unknown", "missing_channel");
      return;
    }
    // A create that failed its channel read leaves no local status/range proof;
    // re-validate channels here so a repost never bypasses a disabled/out-of-range channel.
    let channels: SkTopupChannel[];
    try {
      channels = await fetchSkTopupChannels();
    } catch (error) {
      const cls = classifySkTopupFailure(error);
      await noteRepostFailure(cls.kind, cls.code);
      throw new SupplierTopupError(502, cls.code);
    }
    const repostChannel = channels.find((c) => c.service === code);
    if (!repostChannel || repostChannel.status !== "on") {
      await noteRepostFailure("failed", "channel_unavailable");
      return;
    }
    if (amount < repostChannel.minimum || amount > repostChannel.maximum) {
      await noteRepostFailure("failed", "amount_out_of_range");
      return;
    }
    try {
      const recovered = await createSkTopup({ refId: item.ref_id, code, amount });
      await storeSkInvoice(db, item.id, recovered, now);
      return;
    } catch (error) {
      if (isSkRefIdAlreadyExists(error)) {
        // Ref sudah dipakai: pertahankan data tersimpan, JANGAN ganti ref_id.
        if (!invoice && !hasLink) {
          await setStatus(db, item.id, "unknown", "ref_exists_no_data", now);
        } else {
          await touch(db, item.id, now);
        }
        return;
      }
      const cls = classifySkTopupFailure(error);
      await noteRepostFailure(cls.kind, cls.code);
      if (cls.kind === "failed") throw new SupplierTopupError(502, cls.code);
      return;
    }
  }

  await touch(db, item.id, now);
}

async function refreshTunvnTopup(db: DatabaseAccess, item: SupplierTopupItem, now: number): Promise<void> {
  const code = item.supplier_ref;
  if (!code) {
    await setStatus(db, item.id, "unknown", "missing_payment_code", now);
    return;
  }
  const res = await callTunvnDepositStatus(code);
  if (res.kind !== "ok") {
    const err = sanitizeError(
      res.kind === "http_error" ? `tunvn_http_${res.status}` : res.kind === "ambiguous" ? `tunvn_${res.reason}` : res.reason,
    );
    await noteCheckError(db, item.id, err, now);
    throw new SupplierTopupError(502, err);
  }
  const parsed = parseTunvnDepositStatus(res.json);
  if (!parsed.ok) {
    await noteCheckError(db, item.id, parsed.error, now);
    throw new SupplierTopupError(502, parsed.error);
  }
  if (parsed.paid) {
    await db.execRun(
      "UPDATE supplier_topups SET status='paid', paid_at=?, error=NULL, updated_at=? WHERE id=? AND status<>'paid'",
      now,
      now,
      item.id,
    );
    return;
  }
  // Upstream can expire an undated invoice (no expires_in_minutes) without a
  // local deadline; honour that status instead of leaving it pending forever.
  if (parsed.status.toLowerCase() === "expired") {
    if (item.status !== "expired") await setStatus(db, item.id, "expired", item.error, now);
    else await touch(db, item.id, now);
    return;
  }
  if (item.expires_at !== null && now > item.expires_at) {
    if (item.status !== "expired") await setStatus(db, item.id, "expired", item.error, now);
    else await touch(db, item.id, now);
    return;
  }
  await touch(db, item.id, now);
}

/** Saluran topup SK (dipakai route channels). */
export async function listSekalipayTopupChannels(): Promise<SkTopupChannel[]> {
  if (!supplierTopupGates().sekalipay) throw new SupplierTopupError(503, "sekalipay_unavailable");
  try {
    return await fetchSkTopupChannels();
  } catch (error) {
    const cls = classifySkTopupFailure(error);
    throw new SupplierTopupError(502, cls.code);
  }
}
