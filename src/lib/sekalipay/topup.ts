// src/lib/sekalipay/topup.ts — Topup saldo reseller Sekalipay (READ-ONLY ke saldo
// AXVARA; hanya membuat invoice deposit). Owner membayar sendiri lewat link/QR.
//
// Kontrak reseller (docs 2026-11-20):
//   GET  v1/balance/channels → {data:[{service,name,type,status,minimum,maximum,
//        fee_flat,fee_percentage,sort_order,updated_at}]}
//   POST v1/balance {ref_id,code,amount} → {data:{invoice,ref_id,amount,price,
//        fees,payment_code,status,payment_link,payment_url,qr_link,expired_at}}
//        `amount` = TOTAL bayar (termasuk fee), `price` = nominal yang dikreditkan.
//   GET  v1/balance/mutations?type=topup&direction=credit&per_page=50
//        → {data:[{invoice,direction,type,amount,balance_before,balance_after}]}
//        Satu-satunya cara memastikan invoice topup sudah dibayar.
//
// Key tetap disuntik proxy server-side; modul ini TIDAK menyentuh kredensial.

import { SkApiError, SkNetworkError, skFetch } from "./client";

export type SkTopupChannel = {
  service: string;
  name: string;
  type: string | null;
  status: "on" | "off";
  minimum: number;
  maximum: number;
  fee_flat: number;
  fee_percentage: string | null;
  sort_order: number;
  updated_at: string | null;
};

export type SkTopupInvoice = {
  invoice: string;
  pay_amount: number | null;
  credit_amount: number | null;
  fee_amount: number | null;
  payment_link: string | null;
  payment_url: string | null;
  qr_link: string | null;
  expires_at: number | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

export function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Epoch ms dari `expired_at` / `expires_at` (ISO string atau epoch). */
function parseDateMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Upstream bisa mengirim detik atau milidetik; detik < 1e12.
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const parsed = Date.parse(v.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function fetchSkTopupChannels(): Promise<SkTopupChannel[]> {
  const res = await skFetch<{ data?: unknown }>("v1/balance/channels");
  if (!isRecord(res) || !Array.isArray((res as { data?: unknown }).data)) {
    throw new SkNetworkError("sk_topup_channels_unreadable", "GET v1/balance/channels");
  }
  const channels: SkTopupChannel[] = [];
  for (const row of (res as { data: unknown[] }).data) {
    if (!isRecord(row)) continue;
    const service = strOrNull(row.service);
    const name = strOrNull(row.name);
    const status = strOrNull(row.status);
    const minimum = numOrNull(row.minimum);
    const maximum = numOrNull(row.maximum);
    if (!service || !name || (status !== "on" && status !== "off") || minimum === null || maximum === null) continue;
    channels.push({
      service,
      name,
      type: strOrNull(row.type),
      status,
      minimum,
      maximum,
      fee_flat: numOrNull(row.fee_flat) ?? 0,
      fee_percentage: row.fee_percentage === null || row.fee_percentage === undefined
        ? null
        : String(row.fee_percentage),
      sort_order: numOrNull(row.sort_order) ?? 0,
      updated_at: strOrNull(row.updated_at),
    });
  }
  return channels;
}

export async function createSkTopup(params: {
  refId: string;
  code: string;
  amount: number;
}): Promise<SkTopupInvoice> {
  const res = await skFetch<{ data?: unknown }>("v1/balance", {
    method: "POST",
    body: { ref_id: params.refId, code: params.code, amount: params.amount },
  });
  const data = isRecord(res) ? res.data : null;
  if (!isRecord(data) || typeof data.invoice !== "string" || data.invoice.trim() === "") {
    throw new SkNetworkError("sk_network_response_unreadable", "POST v1/balance");
  }
  return {
    invoice: data.invoice.trim(),
    pay_amount: numOrNull(data.amount),
    credit_amount: numOrNull(data.price),
    fee_amount: numOrNull(data.fees),
    payment_link: strOrNull(data.payment_link),
    payment_url: strOrNull(data.payment_url),
    qr_link: strOrNull(data.qr_link),
    expires_at: parseDateMs(data.expired_at) ?? parseDateMs(data.expires_at),
  };
}

/** Nominal kredit mutasi topup untuk `invoice`, atau null bila belum masuk. */
export async function findSkTopupCredit(invoice: string): Promise<{ amount: number | null } | null> {
  const res = await skFetch<{ data?: unknown }>("v1/balance/mutations", {
    query: { type: "topup", direction: "credit", per_page: 50 },
  });
  if (!isRecord(res) || !Array.isArray((res as { data?: unknown }).data)) {
    throw new SkNetworkError("sk_network_response_unreadable", "GET v1/balance/mutations");
  }
  for (const row of (res as { data: unknown[] }).data) {
    if (!isRecord(row)) continue;
    if (String(row.invoice ?? "") !== invoice) continue;
    return { amount: numOrNull(row.amount) };
  }
  return null;
}

/** Kode error SK tersanitasi untuk kolom `error` (tanpa body/kredensial). */
function sanitizeSkTopupError(raw: string, status: number): string {
  const message = String(raw ?? "");
  if (/REF_ID_ALREADY_EXIST/i.test(message)) return "ref_id_already_exist";
  if (/CODE_NOT_FOUND_OR_INACTIVE/i.test(message)) return "code_not_found_or_inactive";
  if (/AMOUNT_MINIMUM_IS/i.test(message)) return "amount_minimum";
  if (/AMOUNT_MAXIMUM_IS/i.test(message)) return "amount_maximum";
  if (/TOPUP_DAILY_LIMIT/i.test(message)) return "topup_daily_limit";
  if (/TRX_DAILY_LIMIT/i.test(message)) return "trx_daily_limit";
  const token = message.trim().split(/[\s:]+/)[0]?.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 80) ?? "";
  if (/^[A-Z0-9_-]{3,}$/.test(token)) return token.toLowerCase();
  return `sk_http_${status}`;
}

/** Definitif 4xx = penolakan (jangan auto-retry). Timeout/network/5xx/readable
 *  issue = ambigu (retry aman dengan ref_id yang SAMA). */
export function classifySkTopupFailure(error: unknown): { kind: "failed" | "unknown"; code: string } {
  if (error instanceof SkNetworkError) {
    return { kind: "unknown", code: sanitizeSkTopupError(error.message, 0) };
  }
  if (error instanceof SkApiError) {
    if (error.status >= 500) return { kind: "unknown", code: sanitizeSkTopupError(error.message, error.status) };
    return { kind: "failed", code: sanitizeSkTopupError(error.message, error.status) };
  }
  return { kind: "unknown", code: "sk_topup_unknown" };
}

export function isSkRefIdAlreadyExists(error: unknown): boolean {
  return /REF_ID_ALREADY_EXIST/i.test(error instanceof Error ? error.message : String(error ?? ""));
}
