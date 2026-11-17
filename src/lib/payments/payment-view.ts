// Buyer-safe non-QRIS payment view (W3, LOCAL ONLY).
// Contract for Sonnet UI packet: GET/lookup return optional `payment` —
// {provider, kind:'crypto', label, sublabel, state, currency:'USD',
// amount_text, crypto_amount_text, pay_amount_text, pay_currency, network,
// pay_address, expires_at, payment_url:null}. No hosted URL fabricated for
// direct /payment (panel shows address + exact amount). Only call AFTER the
// route's own proof/session guard. No secrets/signatures/raw provider data.
// View joins order status+deadline: expired/cancelled order wins over tx
// pending/confirming (panel never promises a payable invoice on a dead
// order); paid order always maps 'paid' (core already-paid no downgrade).
// Cancel guard: durable provider_status_text decides, not ledger 'pending'.

import { createDatabaseAccess, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { queryFirst } from "@/lib/db";
import { isSufficientDecimal, parseDecimalParts } from "./decimal";
import { gatewayDisplayName } from "./sekalipay-gateway";
import { getCryptoAsset } from "./crypto-assets";
import { centsToUsdText } from "./crypto-pricing";

export async function buildSekalipayGatewayPaymentView(orderCode: string, database?: DatabaseAccess) {
  const row = await (database?.queryFirst ?? queryFirst)(`SELECT pt.status,pt.gateway_label,pt.gateway_channel,pt.requested_amount,pt.gateway_estimated_fee,pt.gateway_fee,
    pt.payable_amount,pt.gateway_fee_consent_required,pt.gateway_fee_consented_at,pt.direct_url,pt.gateway_virtual_account,
    pt.gateway_checkout_url,pt.expires_at,pt.last_error,o.status AS order_status,o.payment_status,o.expires_at AS order_expires_at
    FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code WHERE pt.order_code=? AND pt.provider='sekalipay_gateway'`, orderCode);
  if (!row) return null;
  const parseTime = (value: unknown) => Date.parse(String(value ?? "").replace(" ", "T").replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)$/, "$1Z"));
  const deadline = Math.min(parseTime(row.expires_at), parseTime(row.order_expires_at));
  const live = row.order_status === "pending" && ["unpaid", "pending"].includes(String(row.payment_status)) && deadline > Date.now();
  const consent = Number(row.gateway_fee_consent_required) === 1 && !row.gateway_fee_consented_at;
  const nonFatalProbe = /^sekalipay_gateway_finalize_(probe|manual_review)$/.test(String(row.last_error ?? ""));
  const state = row.payment_status === "paid" ? "paid" : !live ? "expired" : row.last_error && !nonFatalProbe ? "manual_review" : row.status === "initializing" ? "initializing" : row.status !== "pending" ? "manual_review" : consent ? "fee_consent_required" : "pending";
  const show = state === "pending";
  return { provider: "sekalipay_gateway", kind: "gateway", label: gatewayDisplayName(String(row.gateway_channel ?? ""), String(row.gateway_label ?? "")), channel: String(row.gateway_channel ?? ""), state, currency: "IDR",
    subtotal: Number(row.requested_amount), estimated_fee: row.gateway_estimated_fee == null ? null : Number(row.gateway_estimated_fee),
    fee: row.gateway_fee == null ? null : Number(row.gateway_fee), total: row.payable_amount == null ? null : Number(row.payable_amount),
    fee_consent_required: consent, expires_at: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null,
    payment_link: show ? row.direct_url : null, virtual_account: show ? row.gateway_virtual_account : null, checkout_url: show ? row.gateway_checkout_url : null };
}

const gatewayPollEligible = "(last_error IS NULL OR last_error IN ('sekalipay_gateway_finalize_probe','sekalipay_gateway_finalize_manual_review'))";

export async function claimSekalipayGatewayPoll(orderCode: string, late = false, db: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  if (!process.env.SEKALIPAY_GATEWAY_API_KEY?.trim() || !process.env.SEKALIPAY_GATEWAY_SECRET_KEY?.trim()) return false;
  const result = await db.execRun(`UPDATE payment_transactions SET last_checked_at=datetime('now') WHERE order_code=? AND provider='sekalipay_gateway'
    AND status IN ('initializing','pending') AND ${gatewayPollEligible}
    AND (last_checked_at IS NULL OR julianday(last_checked_at)<=julianday('now',?))`, orderCode, late ? "-21600 seconds" : "-60 seconds");
  return Number(result.changes) === 1;
}

export async function reconcileDueSekalipayGatewayPayments(db: DatabaseAccess) {
  const result = { gateway_checked: 0, gateway_late_checked: 0 };
  if (!process.env.SEKALIPAY_GATEWAY_API_KEY?.trim() || !process.env.SEKALIPAY_GATEWAY_SECRET_KEY?.trim()) return result;
  const { reconcileSekalipayGatewayPayment } = await import("./sekalipay-gateway");
  for (const late of [false, true]) {
    const lateScope = late
      ? `(o.status!='pending' OR julianday(o.expires_at)<=julianday('now'))
         AND o.status NOT IN ('dibatalkan','failed')
         AND ((pt.expires_at IS NULL AND o.expires_at IS NULL)
              OR MIN(COALESCE(julianday(pt.expires_at), 1e18), COALESCE(julianday(o.expires_at), 1e18)) > julianday('now', '-30 minutes'))`
      : "o.status='pending' AND julianday(o.expires_at)>julianday('now')";
    const rows = await db.queryAll(`SELECT pt.order_code FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
      WHERE pt.provider='sekalipay_gateway' AND pt.status IN ('initializing','pending') AND ${gatewayPollEligible.replaceAll("last_error", "pt.last_error")}
      AND ${lateScope}
      AND (pt.last_checked_at IS NULL OR julianday(pt.last_checked_at)<=julianday('now',?)) ORDER BY COALESCE(pt.last_checked_at,pt.created_at),pt.id LIMIT 4`, late ? "-21600 seconds" : "-60 seconds");
    for (const row of rows) {
      if (!await claimSekalipayGatewayPoll(String(row.order_code), late, db)) continue;
      if (late) result.gateway_late_checked++; else result.gateway_checked++;
      try { await reconcileSekalipayGatewayPayment(String(row.order_code), db); } catch (error) { if (error instanceof QueryBudgetExceeded) throw error; }
    }
  }
  return result;
}

export type NonQrisPaymentView = {
  provider: "nowpayments";
  kind: "crypto";
  label: string;
  sublabel: string;
  state: "preparing" | "pending" | "confirming" | "paid" | "expired" | "failed" | "manual_review";
  currency: "USD";
  amount_text: string;
  crypto_amount_text: string;
  pay_amount_text: string;
  pay_currency: string;
  network: string | null;
  /** Label dari katalog kurasi (simbol + jaringan + logo); fallback aman untuk ticker tak dikenal. */
  symbol: string;
  network_label: string | null;
  logo: string | null;
  pay_address: string;
  expires_at: string;
  payment_url: null;
  /** "merchant" = baris baru 0/0 (fee provider ditanggung merchant); "buyer" = baris lama 1/1; null = tak tercatat. */
  fee_payer: "merchant" | "buyer" | null;
  fixed_rate: boolean | null;
  /** Rincian biaya layanan crypto AXVARA (USD, 2dp); null untuk baris tanpa rincian. */
  base_amount_text: string | null;
  surcharge_amount_text: string | null;
  surcharge_bps: number | null;
  sender_gas_extra: boolean;
};

export function mapProviderStatusToViewState(providerStatus: string): NonQrisPaymentView["state"] {
  const s = providerStatus.toLowerCase();
  if (["waiting"].includes(s)) return "pending";
  if (["confirming", "confirmed", "sending"].includes(s)) return "confirming";
  if (s === "finished") return "paid";
  if (s === "expired") return "expired";
  if (s === "failed") return "failed";
  return "manual_review";
}

export async function buildNowpaymentsPaymentView(orderCode: string, database?: DatabaseAccess): Promise<NonQrisPaymentView | null> {
  // Joined mapping: order terminal state wins. Expired/cancelled order ->
  // expired view even bila tx pending (never promise payable invoice);
  // lunas order -> paid (core already-paid no downgrade via tx guessing).
  const tx = await (database?.queryFirst ?? queryFirst)(
    `SELECT pt.order_code,pt.provider,pt.status,pt.pay_currency,pt.pay_network,pt.pay_amount_text,pt.pay_address,
      pt.price_amount_text,pt.price_currency,pt.crypto_base_usd_cents,pt.crypto_surcharge_usd_cents,pt.crypto_surcharge_bps,pt.actually_paid_text,pt.provider_status_text,pt.provider_payment_id,pt.expires_at,pt.last_error,pt.fee_paid_by_user,pt.fixed_rate,
      o.status AS order_status,o.payment_status AS order_payment_status,o.expires_at AS order_expires_at
     FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
     WHERE pt.order_code=? AND pt.provider='nowpayments'`,
    orderCode,
  );
  if (!tx) return null;
  if (String(tx.order_payment_status) === "paid" || String(tx.order_status) === "lunas") {
    return baseView(tx, "paid");
  }
  const deadline = String(tx.order_expires_at ?? "");
  const deadlineUtc = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(deadline) ? `${deadline.replace(" ", "T")}Z` : deadline;
  if (String(tx.order_status) !== "pending" || (deadlineUtc && Date.parse(deadlineUtc) <= Date.now())) {
    return baseView(tx, "expired");
  }
  const lastError = String(tx.last_error ?? "");
  const providerStatus = String(tx.provider_status_text ?? "").toLowerCase();
  const persisted = String(tx.status);
  let state: NonQrisPaymentView["state"];
  if (persisted === "failed") state = lastError.includes("expired") || providerStatus === "expired" ? "expired" : "failed";
  else if (persisted === "initializing" && !tx.provider_payment_id) state = "preparing";
  else if (/late|partial|underpaid|unknown|race|manual_review/i.test(lastError)) state = "manual_review";
  else if (["partially_paid", "failed"].includes(providerStatus)) state = "manual_review";
  else if (["confirming", "confirmed", "sending"].includes(providerStatus)) state = "confirming";
  else if (persisted === "pending" || persisted === "initializing") {
    // confirming HANYA dari durable provider status di atas; unknown
    // provider status + sufficient amount tetap pending (fail-closed:
    // jangan klaim confirming untuk partial tak dikenal).
    const paid = String(tx.actually_paid_text ?? "");
    const expect = String(tx.pay_amount_text ?? "");
    state = paid && expect && isSufficientDecimal(paid, expect)
      && ["waiting", "confirming", "confirmed", "sending"].includes(providerStatus)
      ? "confirming" : "pending";
  } else state = "manual_review";
  return baseView(tx, state);
}

function centsColumnText(value: unknown): string | null {
  if (value == null || value === "") return null;
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents >= 0 ? centsToUsdText(BigInt(cents)) : null;
}

function baseView(tx: Record<string, unknown>, state: NonQrisPaymentView["state"]): NonQrisPaymentView {
  const ticker = String(tx.pay_currency ?? "");
  const asset = getCryptoAsset(ticker);
  const bps = tx.crypto_surcharge_bps == null ? NaN : Number(tx.crypto_surcharge_bps);
  return {
    provider: "nowpayments",
    kind: "crypto",
    label: asset?.symbol ?? (ticker.toUpperCase() || "Crypto"),
    sublabel: asset?.networkLabel ?? String(tx.pay_network ?? ""),
    state,
    currency: "USD",
    amount_text: String(tx.price_amount_text ?? ""),
    crypto_amount_text: `${String(tx.pay_amount_text ?? "")} ${asset?.symbol ?? ticker.toUpperCase()}`,
    pay_amount_text: String(tx.pay_amount_text ?? ""),
    pay_currency: ticker,
    network: (tx.pay_network as string | null) ?? null,
    symbol: asset?.symbol ?? ticker.toUpperCase(),
    network_label: asset?.networkLabel ?? null,
    logo: asset?.logo ?? null,
    pay_address: ["pending", "confirming"].includes(state) ? String(tx.pay_address ?? "") : "",
    expires_at: String(tx.expires_at ?? ""),
    payment_url: null,
    fee_payer: tx.fee_paid_by_user == null ? null : Number(tx.fee_paid_by_user) === 1 ? "buyer" : "merchant",
    fixed_rate: tx.fixed_rate == null ? null : Number(tx.fixed_rate) === 1,
    base_amount_text: centsColumnText(tx.crypto_base_usd_cents),
    surcharge_amount_text: centsColumnText(tx.crypto_surcharge_usd_cents),
    surcharge_bps: Number.isSafeInteger(bps) && bps >= 0 ? bps : null,
    sender_gas_extra: true,
  };
}

/** Shared fail-closed cancellation guard (cancel route + tests). Reads the
 * SAME durable row as the view: provider_status_text decides, ledger
 * 'pending' never trusted. Paid order = not blocked here (409 via order
 * status check); confirming/manual_review = blocked with buyer message. */
export function cancelGuardForNowpaymentsRow(row: {
  provider?: unknown; provider_status_text?: unknown; actually_paid_text?: unknown;
  pay_amount_text?: unknown; last_error?: unknown;
}): { cancelBlocked: boolean; reason: string | null } {
  if (row.provider !== "nowpayments") return { cancelBlocked: false, reason: null };
  const providerStatus = String(row.provider_status_text ?? "").toLowerCase();
  const paid = String(row.actually_paid_text ?? "");
  const amount = paid ? parseDecimalParts(paid) : null;
  const verifiedPaid = !!paid && (!amount || amount.scaled > BigInt(0));
  const confirming = ["confirming", "sending", "confirmed"].includes(providerStatus)
    || !!verifiedPaid;
  const review = /manual_review|partial|underpaid|late|unknown|race/i.test(String(row.last_error ?? ""))
    || (providerStatus !== "" && providerStatus !== "waiting" && providerStatus !== "expired");
  if (confirming || review) {
    return {
      cancelBlocked: true,
      reason: "Pembayaran crypto sedang diproses/diperiksa manual. Pembatalan mandiri tidak tersedia — hubungi admin bila dana belum terkirim.",
    };
  }
  return { cancelBlocked: false, reason: null };
}

/** Bounded job=payments NOWPayments pass: shared budget/CAS, incl. known-id
 * initializing. Runs flag-off (key only). Late/manual expired-order recovery
 * lives in reconcileLateKnownPayments below, same limits/guard. */
export const NOWPAYMENTS_BACKGROUND_LIMIT = 4;
/** Late known-id recovery: expired order + saved tx WITH provider id, checked
 * at most once per 6h (bounded, anti endless-scan). Recovery NEVER revives:
 * no stock touch, no fulfillment (reconcile returns manual_review for late).
 * Even NOWPAYMENTS_ENABLED=false stays safe: claim key-only readable. */
export const NOWPAYMENTS_LATE_LIMIT = 4;
export const NOWPAYMENTS_LATE_RECHECK_MS = 6 * 60 * 60_000;
export async function reconcileLateKnownNowpaymentsPayments(db: DatabaseAccess) {
  const out = { late_checked: 0, late_manual_review: 0 };
  let due: Record<string, unknown>[];
  try {
    due = await db.queryAll(
      `SELECT pt.order_code FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
       WHERE pt.provider='nowpayments' AND pt.status IN ('initializing','pending') AND pt.provider_payment_id IS NOT NULL
         AND (o.status!='pending' OR (o.expires_at IS NOT NULL AND julianday(o.expires_at)<=julianday('now')))
         AND COALESCE(pt.last_error,'') NOT LIKE '%manual_review%'
         AND (pt.last_checked_at IS NULL OR julianday(pt.last_checked_at)<=julianday('now','-21600 seconds'))
       ORDER BY COALESCE(pt.last_checked_at,pt.created_at) ASC,pt.id ASC LIMIT ?`,
      NOWPAYMENTS_LATE_LIMIT,
    );
  } catch {
    // DB lama tanpa kolom 0096 (last_admin_alert_at) — late pass skip aman.
    return out;
  }
  const { claimNowpaymentsPollReconcile, reconcileNowpaymentsPayment } = await import("./nowpayments");
  for (const row of due) {
    const code = String(row.order_code);
    if (!await claimNowpaymentsPollReconcile(code)) continue;
    out.late_checked++;
    try {
      const status = await reconcileNowpaymentsPayment(code);
      if (status === "manual_review") out.late_manual_review++;
    } catch { /* ambiguous stays reconcilable; next slow tick retries */ }
  }
  return out;
}
export async function reconcileDueNowpaymentsPayments(db: DatabaseAccess) {
  const out = { payments_checked: 0, payments_confirmed: 0, payments_failed: 0, manual_review: 0 };
  const due = await db.queryAll(
    `SELECT pt.order_code FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider='nowpayments' AND pt.status IN ('initializing','pending') AND o.status='pending'
       AND o.payment_status IN ('pending','unpaid') AND pt.provider_payment_id IS NOT NULL
       AND (o.expires_at IS NULL OR julianday(o.expires_at)>julianday('now'))
       AND (pt.last_checked_at IS NULL OR julianday(pt.last_checked_at)<=julianday('now','-60 seconds'))
     ORDER BY COALESCE(pt.last_checked_at,pt.created_at) ASC,pt.id ASC LIMIT ?`,
    NOWPAYMENTS_BACKGROUND_LIMIT,
  );
  const { claimNowpaymentsPollReconcile, reconcileNowpaymentsPayment } = await import("./nowpayments");
  for (const row of due) {
    const code = String(row.order_code);
    if (!await claimNowpaymentsPollReconcile(code)) continue;
    out.payments_checked++;
    try {
      const status = await reconcileNowpaymentsPayment(code);
      if (status === "paid" || status === "already_paid") out.payments_confirmed++;
      else if (status === "manual_review") out.manual_review++;
    } catch {
      out.payments_failed++;
    }
  }
  return out;
}
