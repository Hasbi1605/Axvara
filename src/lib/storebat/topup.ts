// src/lib/storebat/topup.ts — Topup saldo reseller StoreBat (USDT BEP20).
//
// AXVARA HANYA membuat invoice deposit idempoten dan melacak statusnya.
// Owner mentransfer USDT BEP20 sendiri ke alamat invoice. Tidak ada payout
// otomatis, tidak ada dana yang dikirim AXVARA, dan tidak ada retry buta.
//
// Kontrak OpenAPI v1.2.0 (https://batman.sarl/api/reseller):
//   GET  /wallet/deposit-methods -> { success:true, methods:[{ network:"BEP20", asset:"USDT", provider_currency:"USDTBSC", available, minimum_deposit_usd, expiry_seconds }] }
//   POST /wallet/deposits { amount_usd, network:"BEP20", idempotency_key, reference } -> HTTP 200|201 { success:true, idempotent, deposit }
//   GET  /wallet/deposits/{deposit_id}?refresh=true -> HTTP 200 { success:true, deposit }

import { isStorebatConfigured, money, record, storebatRequest, validReference } from "./client";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const STOREBAT_DEPOSIT_STATUSES = [
  "CREATING",
  "CREATION_UNKNOWN",
  "WAITING",
  "CONFIRMING",
  "UNDERPAID",
  "CREDITED",
  "EXPIRED",
  "FAILED",
  "REFUNDED",
  "REVIEW_REQUIRED",
] as const;

export type StorebatDepositStatus = (typeof STOREBAT_DEPOSIT_STATUSES)[number];

export type StorebatDepositMethod = {
  network: "BEP20";
  asset: "USDT";
  provider_currency: string;
  available: boolean;
  minimum_deposit_usd: number | null;
  expiry_seconds: number | null;
};

export type StorebatDeposit = {
  deposit_id: string;
  status: StorebatDepositStatus;
  provider_status: string | null;
  wallet_credit_amount: number | null;
  pay_amount: number | null;
  pay_currency: string;
  network: "BEP20";
  address: string | null;
  actually_paid: number | null;
  expires_at: number | null;
};

export type StorebatTopupCall =
  | { kind: "ok"; json: unknown; status: number }
  | { kind: "config"; reason: string }
  | { kind: "auth"; status: number }
  | { kind: "rejected"; status: number; code: string }
  | { kind: "ambiguous"; reason: string };

export type StorebatDepositParse =
  | { ok: true; deposit: StorebatDeposit }
  | { ok: false; error: string; deposit_id?: string };

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Parse timestamp ISO atau format SQLite/FastAPI UTC `YYYY-MM-DD HH:MM:SS`. */
function parseUtcDateMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  const s = strOrNull(v);
  if (!s) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)
    ? `${s.replace(" ", "T")}Z`
    : s;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractSafeErrorCode(rawText: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (record(parsed)) {
      const code = strOrNull(parsed.code) ?? strOrNull(parsed.error);
      if (code && /^[A-Za-z0-9_.-]{2,64}$/.test(code)) {
        const lower = code.toLowerCase();
        if (lower.includes("minimum") || lower.includes("maximum") || lower.includes("amount_out_of_range")) {
          return "amount_out_of_range";
        }
        return `storebat_${lower}`;
      }
    }
  } catch { /* fallback to status code */ }
  return `storebat_http_${status}`;
}

async function callStorebatWallet(path: string, body?: object): Promise<StorebatTopupCall> {
  if (!isStorebatConfigured()) return { kind: "config", reason: "storebat_unavailable" };
  try {
    const res = await storebatRequest(path, body);
    if (res.status === 401 || res.status === 403) return { kind: "auth", status: res.status };
    if (res.status === 429 || res.status >= 500 || (res.status >= 300 && res.status < 400)) {
      return { kind: "ambiguous", reason: `storebat_http_${res.status}` };
    }
    if (res.status < 200 || res.status >= 300) {
      return { kind: "rejected", status: res.status, code: extractSafeErrorCode(res.text, res.status) };
    }
    try {
      return { kind: "ok", json: JSON.parse(res.text) as unknown, status: res.status };
    } catch {
      return { kind: "ambiguous", reason: "storebat_invalid_json" };
    }
  } catch {
    return { kind: "ambiguous", reason: "storebat_network_or_timeout" };
  }
}

export function callStorebatDepositMethods(): Promise<StorebatTopupCall> {
  return callStorebatWallet("/wallet/deposit-methods");
}

export function callStorebatCreateDeposit(params: {
  amountUsd: number;
  idempotencyKey: string;
  reference: string;
}): Promise<StorebatTopupCall> {
  if (!validReference(params.idempotencyKey) || !validReference(params.reference)) {
    return Promise.resolve({ kind: "rejected", status: 400, code: "invalid_reference" });
  }
  return callStorebatWallet("/wallet/deposits", {
    amount_usd: params.amountUsd,
    network: "BEP20",
    idempotency_key: params.idempotencyKey,
    reference: params.reference,
  });
}

export function callStorebatDepositStatus(depositId: string): Promise<StorebatTopupCall> {
  if (!validReference(depositId)) {
    return Promise.resolve({ kind: "rejected", status: 400, code: "invalid_deposit_id" });
  }
  return callStorebatWallet(`/wallet/deposits/${depositId}?refresh=true`);
}

export function parseStorebatDepositMethod(raw: unknown): { ok: true; method: StorebatDepositMethod | null } | { ok: false; error: string } {
  if (!record(raw) || raw.success !== true || !Array.isArray(raw.methods)) {
    return { ok: false, error: "storebat_methods_shape" };
  }
  for (const row of raw.methods) {
    if (!record(row)) continue;
    const network = strOrNull(row.network)?.toUpperCase();
    const asset = strOrNull(row.asset)?.toUpperCase();
    const providerCurrency = strOrNull(row.provider_currency)?.toUpperCase() ?? "USDTBSC";
    if (network !== "BEP20" || asset !== "USDT") continue;
    if (typeof row.available !== "boolean") return { ok: false, error: "storebat_methods_shape" };
    const min = row.minimum_deposit_usd == null ? null : money(row.minimum_deposit_usd);
    const expiry = row.expiry_seconds == null ? null : money(row.expiry_seconds);
    return {
      ok: true,
      method: {
        network: "BEP20",
        asset: "USDT",
        provider_currency: providerCurrency,
        available: row.available,
        minimum_deposit_usd: min,
        expiry_seconds: expiry !== null && expiry > 0 ? Math.round(expiry) : null,
      },
    };
  }
  return { ok: true, method: null };
}

function isDepositStatus(value: unknown): value is StorebatDepositStatus {
  return typeof value === "string" && (STOREBAT_DEPOSIT_STATUSES as readonly string[]).includes(value);
}

/**
 * Parse payload `POST /wallet/deposits` atau `GET /wallet/deposits/{id}`.
 * Memvalidasi jaringan wajib BEP20, mata uang USDT/USDTBSC, alamat EVM 20-byte
 * saat tersedia, dan batas kewajaran `pay_amount` terhadap nominal yang diminta.
 */
export function parseStorebatDeposit(raw: unknown, requestedAmount: number): StorebatDepositParse {
  if (!record(raw) || raw.success !== true || !record(raw.deposit)) {
    return { ok: false, error: "deposit_shape" };
  }
  const d = raw.deposit;
  const depositId = strOrNull(d.deposit_id);
  if (!depositId || !validReference(depositId)) return { ok: false, error: "deposit_shape" };
  const rawStatus = strOrNull(d.status)?.toUpperCase();
  if (!isDepositStatus(rawStatus)) return { ok: false, error: "deposit_shape", deposit_id: depositId };

  const network = strOrNull(d.network)?.toUpperCase();
  if (network !== "BEP20") return { ok: false, error: "unexpected_network", deposit_id: depositId };

  const payCurrency = (strOrNull(d.pay_currency) ?? "USDTBSC").toUpperCase();
  if (payCurrency !== "USDTBSC" && payCurrency !== "USDT") {
    return { ok: false, error: "unexpected_currency", deposit_id: depositId };
  }

  const address = strOrNull(d.address);
  if (address !== null && !EVM_ADDRESS.test(address)) {
    return { ok: false, error: "invalid_address", deposit_id: depositId };
  }

  const payAmount = d.pay_amount == null ? null : money(d.pay_amount);
  if (d.pay_amount != null && (payAmount === null || payAmount <= 0)) {
    return { ok: false, error: "invalid_pay_amount", deposit_id: depositId };
  }
  if (payAmount !== null && requestedAmount > 0 && payAmount > requestedAmount * 2 + 5) {
    return { ok: false, error: "invalid_pay_amount", deposit_id: depositId };
  }

  const creditAmount = d.wallet_credit_amount == null ? null : money(d.wallet_credit_amount);
  const actuallyPaid = d.actually_paid == null ? null : money(d.actually_paid);
  const expiresAt = parseUtcDateMs(d.expires_at);

  // Status siap bayar (WAITING) wajib membawa alamat EVM dan nominal bayar valid.
  if (rawStatus === "WAITING" && (address === null || payAmount === null)) {
    return { ok: false, error: address === null ? "invalid_address" : "invalid_pay_amount", deposit_id: depositId };
  }

  return {
    ok: true,
    deposit: {
      deposit_id: depositId,
      status: rawStatus,
      provider_status: strOrNull(d.provider_status),
      wallet_credit_amount: creditAmount,
      pay_amount: payAmount,
      pay_currency: payCurrency,
      network: "BEP20",
      address,
      actually_paid: actuallyPaid,
      expires_at: expiresAt,
    },
  };
}
