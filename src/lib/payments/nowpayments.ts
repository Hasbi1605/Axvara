// NOWPayments adapter (W1, LOCAL ONLY — tidak publik sampai appearance ACC).
import { getD1, queryFirst, execRun, transitionPendingPaymentToPaid } from "@/lib/db";
import { constantTimeEqual } from "@/lib/security";
import { assertPaymentsAvailable } from "@/lib/payment-maintenance";
import { compareDecimalText, isSufficientDecimal, parseDecimalParts } from "./decimal";
import { isNowpaymentsConfigured, isNowpaymentsReadable } from "./rails";
import { nowpaymentsOutcomeCurrency } from "./crypto-preflight";
import { readBoundedText } from "@/lib/bounded-body";
import { parseFxTimestamp } from "./fx";
import { getCryptoAsset } from "./crypto-assets";
import { CRYPTO_SURCHARGE_BPS, centsToUsdText, cryptoPricing } from "./crypto-pricing";

type Row = Record<string, unknown>;

export const NOWPAYMENTS_IPN_PATH = "/api/payments/nowpayments/ipn";
export const NOWPAYMENTS_ORDER_TTL_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const BODY_LIMIT_BYTES = 16_000;

function dbTime(value: unknown): number {
  const text = String(value || "");
  return Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text) ? text.replace(" ", "T") + "Z" : text);
}

function intMoney(value: unknown): number {
  if (typeof value === "number" ? !Number.isSafeInteger(value) : !/^[0-9]+$/.test(String(value))) {
    throw new Error("nowpayments_invalid_amount");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 999_999_999) throw new Error("nowpayments_invalid_amount");
  return number;
}

export function nowpaymentsBaseUrl(): string {
  const raw = (process.env.NOWPAYMENTS_API_BASE_URL || "https://api.nowpayments.io/v1").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("nowpayments_invalid_base_url");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("nowpayments_invalid_base_url");
  // SSRF-safe: hanya host resmi + path /v1. Tanpa URL buatan pemanggil —
  // pemanggil tidak pernah memberi URL/redirect; redirect manual + tolak non-2xx.
  if (url.hostname !== "api.nowpayments.io") throw new Error("nowpayments_invalid_base_url");
  return "https://api.nowpayments.io/v1";
}

async function providerFetch(path: string, init?: { method?: string; body?: unknown; adminTest?: boolean }): Promise<Row> {
  const isWrite = (init?.method ?? "GET") !== "GET";
  if (isWrite ? !isNowpaymentsConfigured(init?.adminTest) : !isNowpaymentsReadable()) {
    throw new Error("nowpayments_not_configured");
  }
  const base = nowpaymentsBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      redirect: "manual",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": process.env.NOWPAYMENTS_API_KEY!,
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    } catch {
    throw new Error("nowpayments_network_ambiguous");
  }
  // Manual redirect + non-2xx reject: workerd menolak redirect:"error"
  // sebelum jaringan; manual mempertahankan kebijakan no-redirect. Secret
  // tidak pernah dicatat; response mentah tidak diteruskan ke buyer.
  if (response.status === 301 || response.status === 302 || response.status === 303
    || response.status === 307 || response.status === 308
    || response.headers.get("location")) {
    throw new Error("nowpayments_redirect_rejected");
  }
  if (!response.ok) throw new Error(`nowpayments_http_${response.status}`);
  let json: unknown;
  try { json = parseNowpaymentsWire(await readBoundedText(response as unknown as Request, 64_000)); }
  catch { throw new Error("nowpayments_invalid_response"); }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("nowpayments_invalid_response");
  return json as Row;
}

// Preserve number tokens before JSON.parse rounds them; strings are copied verbatim.
export function parseNowpaymentsWire(raw: string): unknown {
  // Validate original JSON syntax before quoting tokens; never use parsed numbers.
  JSON.parse(raw);
  let out = "", inString = false, escaped = false;
  for (let i = 0; i < raw.length;) {
    const c = raw[i];
    if (inString) {
      out += c; i++;
      if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') inString = false;
    } else if (c === '"') { inString = true; out += c; i++; }
    else if (c === "-" || (c >= "0" && c <= "9")) {
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(i))?.[0];
      if (!token || token.length > 64 || /[eE]/.test(token)) throw new Error("nowpayments_invalid_response");
      out += `"${token}"`; i += token.length;
    } else { out += c; i++; }
  }
  return JSON.parse(out);
}

/**
 * Preflight minimum provider (LOCAL ONLY). Bentuk MENGAMBANG: /min-amount TANPA is_fixed_rate/
 * is_fee_paid_by_user (kebijakan invoice baru 0/0, minimum rendah). Menolak (tanpa POST) bila
 * nominal USD < fiat_equivalent provider atau estimasi koin < min_amount.
 */
export async function checkNowpaymentsMinimum(price: string, from: "usd" | "idr", currency: string, adminTest = false): Promise<void> {
  if (!isNowpaymentsConfigured(adminTest)) throw new Error("nowpayments_not_configured");
  const outcome = nowpaymentsOutcomeCurrency();
  if (!outcome) throw new Error("nowpayments_outcome_unconfigured");
  const estimate = await providerFetch(`/estimate?amount=${encodeURIComponent(price)}&currency_from=${from}&currency_to=${encodeURIComponent(currency)}`);
  const min = await providerFetch(`/min-amount?currency_from=${encodeURIComponent(currency)}&currency_to=${encodeURIComponent(outcome)}&fiat_equivalent=usd`);
  const estimatedAmount = positiveDecimalText(estimate.estimated_amount ?? estimate.estimatedAmount);
  const minAmount = positiveDecimalText(min.min_amount ?? min.minAmount);
  if (!estimatedAmount || !minAmount || asText(estimate.currency_from ?? estimate.currencyFrom)?.toLowerCase() !== from
    || asText(estimate.currency_to ?? estimate.currencyTo)?.toLowerCase() !== currency
    || asText(min.currency_from ?? min.currencyFrom)?.toLowerCase() !== currency
    || asText(min.currency_to ?? min.currencyTo)?.toLowerCase() !== outcome
    || (min.fiat_equivalent != null && !positiveDecimalText(min.fiat_equivalent))
    || (from === "usd" && min.fiat_equivalent != null && !isSufficientDecimal(price, min.fiat_equivalent))
    || !isSufficientDecimal(estimatedAmount, minAmount)) throw new Error("nowpayments_preflight_invalid");
}

function orderRef(value: unknown): string {
  const text = String(value ?? "");
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(text)) throw new Error("nowpayments_invalid_payment_id");
  return text;
}

/** Rekursif key-sorted canonical JSON persis dokumentasi resmi IPN. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${canonicalStringify(val)}`).join(",")}}`;
}

export async function verifyNowpaymentsSignature(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signature) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const canonical = canonicalStringify(parsed);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(hex, signature.trim().toLowerCase());
}

export function readNowpaymentsBodyLimit(): number {
  return BODY_LIMIT_BYTES;
}



function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function positiveDecimalText(value: unknown): string | null {
  const text = asText(value);
  const parts = parseDecimalParts(text);
  if (!text || !parts || parts.scaled <= BigInt(0)) return null;
  return text;
}

function equalDecimal(left: unknown, right: unknown): boolean {
  const a = parseDecimalParts(left), b = parseDecimalParts(right);
  return !!a && !!b && compareDecimalText(a, b) === 0;
}

function providerBoolean(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

export type NowpaymentsInvoice = {
  orderCode: string;
  requestedAmount: number;
  payCurrency: string;
  payNetwork: string | null;
  payAmountText: string;
  payAddress: string;
  providerPaymentId: string;
  expiresAt: string;
  isExisting: boolean;
};

function invoiceFromRow(tx: Row, existing: boolean): NowpaymentsInvoice {
  const address = asText(tx.pay_address);
  const payAmount = asText(tx.pay_amount_text);
  const currency = asText(tx.pay_currency);
  const providerId = asText(tx.provider_payment_id);
  if (!address || !payAmount || !currency || !providerId) throw new Error("nowpayments_invoice_incomplete");
  return {
    orderCode: String(tx.order_code),
    requestedAmount: Number(tx.requested_amount),
    payCurrency: currency,
    payNetwork: asText(tx.pay_network),
    payAmountText: payAmount,
    payAddress: address,
    providerPaymentId: providerId,
    expiresAt: String(tx.expires_at),
    isExisting: existing,
  };
}

/**
 * Buat invoice crypto terikat order — W3 USD (LOCAL ONLY). NEW web crypto
 * SELALU USD: caller (quote/orders) WAJIB meneruskan snapshot USD yang sudah
 * divalidasi dari token bertanda (`expectedUsd`: cents exact + rate + pay
 * asset/network + idr subtotal cocok). price_amount='15.63',
 * price_currency='usd' — TIDAK PERNAH relabel IDR sebagai USD.
 * Legacy IDR path tetap untuk kompat tes inti (priceCurrency 'idr'
 * eksplisit); tanpa snapshot USD + tanpa legacy flag => tolak.
 */
export type NowpaymentsUsdExpected = {
  cents: string; // sen USD BASE (sebelum biaya layanan)
  priceText: string; // TOTAL USD (base + biaya layanan) 2dp = price_amount ke provider
  surchargeBps: number;
  surchargeCents: string;
  totalCents: string;
  rateText: string;
  rateNum: string;
  rateDen: string;
  effectiveAt: string;
  idrSubtotal: number;
  payCurrency: string;
  network: string | null;
};
export async function createNowpaymentsInvoice(
  orderCode: string,
  idrAmount: number,
  payCurrency: string,
  options?: { payNetwork?: string | null; priceCurrency?: string; expectedUsd?: NowpaymentsUsdExpected; feePayer?: "merchant"; fixedRate?: false; adminTest?: boolean },
): Promise<NowpaymentsInvoice> {
  const usd = options?.expectedUsd ?? null;
  assertPaymentsAvailable();
  const amount = intMoney(idrAmount);
  const currency = orderRef(payCurrency).toLowerCase();
  // Mode USD baru: snapshot bertanda dari quote WAJIB cocok dengan argumen;
  // client-supplied price/FX/channel dari body TIDAK PERNAH dibaca di sini —
  // caller (orders route) hanya meneruskan yang sudah terverifikasi.
  if (usd) {
    if (usd.payCurrency.toLowerCase() !== currency) throw new Error("nowpayments_invoice_mismatch");
    if ((usd.network ?? null) !== (options?.payNetwork ?? null)
      && !(!usd.network && !options?.payNetwork)) throw new Error("nowpayments_invoice_mismatch");
    if (usd.idrSubtotal !== amount || !Number.isSafeInteger(usd.idrSubtotal)) throw new Error("nowpayments_invoice_mismatch");
    // Koin WAJIB kurasi dan jaringan sama dengan jaringan kurasi (bukan tebakan pemanggil).
    const asset = getCryptoAsset(currency);
    if (!asset || asset.ticker !== currency || asset.network !== (usd.network ?? null)) throw new Error("nowpayments_invoice_mismatch");
    const { idrToUsdCents } = await import("./fx");
    const recomputed = idrToUsdCents(amount, {
      rateNum: usd.rateNum, rateDen: usd.rateDen, rateText: usd.rateText,
      effectiveAt: usd.effectiveAt, source: "operator-fixed",
    });
    // base = dari kurs bertanda; surcharge = ceil(base x bps / 10000); total = base + surcharge = price_amount.
    if (usd.surchargeBps !== CRYPTO_SURCHARGE_BPS || recomputed <= BigInt(0)) throw new Error("nowpayments_invoice_mismatch");
    const pricing = cryptoPricing(recomputed);
    if (recomputed.toString() !== usd.cents || pricing.surchargeCents.toString() !== usd.surchargeCents
      || pricing.totalCents.toString() !== usd.totalCents || centsToUsdText(pricing.totalCents) !== usd.priceText) {
      throw new Error("nowpayments_invoice_mismatch");
    }
    if (options?.priceCurrency !== undefined && options.priceCurrency !== "usd") {
      throw new Error("nowpayments_price_currency_unsupported");
    }
  } else {
    if (options?.priceCurrency !== "idr") throw new Error("nowpayments_usd_snapshot_required");
  }
  const d1 = getD1();
  if (!d1) throw new Error("nowpayments_requires_d1");

  let tx = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=?", orderCode);
  if (tx && tx.provider !== "nowpayments") throw new Error("nowpayments_provider_conflict");
  if (tx && Number(tx.requested_amount) !== amount) throw new Error("nowpayments_invoice_mismatch");
  // Baris tersimpan terikat koin/jaringan order INI: pemanggil yang meminta koin lain ditolak.
  if (tx && tx.pay_currency && String(tx.pay_currency).toLowerCase() !== currency) throw new Error("nowpayments_invoice_mismatch");
  if (tx && tx.pay_network && options?.payNetwork && String(tx.pay_network).toLowerCase() !== String(options.payNetwork).toLowerCase()) throw new Error("nowpayments_invoice_mismatch");
  if (tx && (tx.last_error && /manual_review/.test(String(tx.last_error)))) throw new Error("nowpayments_invoice_manual_review");
  if (tx && tx.status === "paid") throw new Error("nowpayments_invoice_terminal");
  if (tx && ["pending"].includes(String(tx.status))) {
    if (!(dbTime(tx.expires_at) > Date.now())) throw new Error("nowpayments_invoice_terminal");
    return invoiceFromRow(tx, true);
  }
  if (tx && tx.status !== "initializing") throw new Error("nowpayments_invoice_terminal");
  if (!tx && usd && (options?.feePayer !== "merchant" || options.fixedRate !== false)) throw new Error("nowpayments_policy_required");
  if (!tx && !isNowpaymentsConfigured(options?.adminTest)) throw new Error("nowpayments_not_configured");

  let claimed = false;
  if (!tx) {
    const order = await queryFirst(
      "SELECT status,payment_status,expires_at FROM orders WHERE code=?", orderCode,
    );
    const deadline = Math.min(Date.now() + NOWPAYMENTS_ORDER_TTL_MS, order?.expires_at ? dbTime(order.expires_at) : Infinity);
    if (!order || order.status !== "pending" || !["pending", "unpaid"].includes(String(order.payment_status))
      || !(deadline > Date.now())) throw new Error("nowpayments_order_terminal");
    const guard = `${orderCode}:nowpayments:claim`;
    try {
      await d1.batch([
        d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN EXISTS(
          SELECT 1 FROM orders WHERE code=? AND status='pending' AND payment_status IN ('pending','unpaid')
          AND (expires_at IS NULL OR julianday(expires_at)>julianday('now')))
          AND NOT EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=?) THEN 1 ELSE 0 END`)
          .bind(guard, orderCode, orderCode),
        d1.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,
          currency,pay_currency,pay_network,status,expires_at,fee_paid_by_user,fixed_rate,
          crypto_base_usd_cents,crypto_surcharge_usd_cents,crypto_surcharge_bps)
          VALUES(?,'nowpayments','hosted',?,'nowpayments',?,'IDR',?,?, 'initializing',?,0,0,?,?,?)`)
          .bind(orderCode, orderCode, amount, currency, options?.payNetwork ?? null,
            new Date(deadline).toISOString(),
            usd ? Number(usd.cents) : null, usd ? Number(usd.surchargeCents) : null, usd ? usd.surchargeBps : null),
        d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
      ]);
      claimed = true;
    } catch (error) {
      if (!/UNIQUE|CHECK constraint|operation_guards/i.test(error instanceof Error ? error.message : "")) throw error;
    }
    tx = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=? AND provider='nowpayments'", orderCode);
    if (!tx) throw new Error("nowpayments_order_conflict");
    if (tx.status === "pending") return invoiceFromRow(tx, true);
    if (tx.status === "paid") throw new Error("nowpayments_invoice_terminal");
  }

  if (!(dbTime(tx!.expires_at) > Date.now())) throw new Error("nowpayments_invoice_terminal");
  // price dari snapshot caller (exact; USD 2dp / legacy IDR int). Const di
  // sini agar reachable dari catch finalize di bawah tanpa re-derive.
  const priceText = usd ? usd.priceText : String(amount);
  const priceCurrency = usd ? "usd" : "idr";
  let createdCharge: { paymentId: string; payAddress: string; payAmount: string } | null = null;
  let observedPaymentId: string | null = null;
  try {
    if (!claimed) {
      if (!tx!.provider_payment_id) throw new Error("nowpayments_invoice_initializing");
      return await fetchKnownPayment(orderCode, String(tx!.provider_payment_id));
    }
    // Preflight: USD mode memakai pair USD->pay asset (snapshot exact),
    // legacy IDR memakai pair idr->pay asset. Minimum dibandingkan dengan
    // estimasi yang sama satuannya — tanpa konversi/FX di sini.
    if (usd && !/^[0-9]+\.[0-9]{2}$/.test(priceText)) throw new Error("nowpayments_invoice_mismatch");
    await checkNowpaymentsMinimum(priceText, priceCurrency, currency, options?.adminTest);
    const { SITE } = await import("@/lib/site");
    const created = await providerFetch("/payment", {
      method: "POST",
      adminTest: options?.adminTest,
      body: {
        // price_amount string exact verbatim (IDR int legacy / USD 2dp baru).
        price_amount: priceText,
        price_currency: priceCurrency,
        pay_currency: currency,
        order_id: orderCode,
        ipn_callback_url: `${SITE.webUrl}${NOWPAYMENTS_IPN_PATH}`,
        // Kebijakan invoice baru (keputusan owner 5 Nov 2026): kurs mengambang +
        // fee provider ditanggung merchant. Pembeli menanggung via biaya layanan di price_amount.
        is_fixed_rate: false,
        is_fee_paid_by_user: false,
      },
    });
    const paymentId = asText(created.payment_id ?? created.paymentId);
    if (paymentId && /^[A-Za-z0-9:_-]{1,128}$/.test(paymentId)) observedPaymentId = paymentId;
    const payAddress = asText(created.pay_address ?? created.payAddress);
    const payAmount = positiveDecimalText(created.pay_amount ?? created.payAmount);
    const returnedOrderId = asText(created.order_id ?? created.orderId);
    const returnedPayCurrency = asText(created.pay_currency ?? created.payCurrency)?.toLowerCase();
    const returnedPriceAmount = asText(created.price_amount ?? created.priceAmount);
    const returnedPriceCurrency = asText(created.price_currency ?? created.priceCurrency)?.toLowerCase();
    // Compare price numerically without allowing currency relabeling.
    if (!paymentId || !payAddress || !payAmount
      || returnedOrderId !== orderCode
      || returnedPayCurrency !== currency
      || !equalDecimal(returnedPriceAmount, priceText)
      || (returnedPriceCurrency ?? null) !== priceCurrency) {
      throw new Error("nowpayments_invalid_invoice");
    }
    // Memo / extra id: alamat tanpa memo = dana hilang. Fail closed SEBELUM menyimpan alamat.
    const extraId = created.payin_extra_id ?? created.payinExtraId;
    if (extraId != null && String(extraId).trim() !== "") {
      await execRun(
        `UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),status='failed',
          last_error='nowpayments_extra_id_unsupported',last_reconciled_at=datetime('now'),updated_at=datetime('now')
         WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')`,
        paymentId, orderCode,
      );
      throw new Error("nowpayments_extra_id_unsupported");
    }
    // Baris 0/0: provider melaporkan fixed-rate atau fee-by-user = true berarti kebijakan tidak dipatuhi.
    if (usd && (providerBoolean(created.is_fixed_rate) === true || providerBoolean(created.is_fee_paid_by_user) === true)) throw new Error("nowpayments_policy_unverified");
    // Tanpa valid_until wajib untuk 0/0 (kurs mengambang): TTL order AXVARA + late->manual review yang berlaku.
    const validUntil = created.valid_until == null ? null : typeof created.valid_until === "string" ? parseFxTimestamp(created.valid_until) : null;
    if (usd && created.valid_until != null && !validUntil) throw new Error("nowpayments_deadline_unverified");
    if (created.expiration_estimate_date ?? created.expirationEstimateDate) {
      const estimateDeadline = created.expiration_estimate_date ?? created.expirationEstimateDate;
      if (typeof estimateDeadline !== "string" || !parseFxTimestamp(estimateDeadline) || dbTime(estimateDeadline) <= Date.now()) {
        throw new Error("nowpayments_invalid_invoice");
      }
    }
    if (created.created_at ?? created.createdAt) {
      const createdAt = created.created_at ?? created.createdAt;
      if (typeof createdAt !== "string" || !parseFxTimestamp(createdAt) || dbTime(createdAt) > Date.now()) {
        throw new Error("nowpayments_invalid_invoice");
      }
    }
    // price dari caller-snapshot (didefinisikan sebelum try, dipakai validasi
    // respons di atas): USD exact 2dp dari snapshot, legacy String(IDR int).
    createdCharge = { paymentId, payAddress, payAmount };
    const purchaseDeadline = new Date(Math.min(
      dbTime(tx!.expires_at),
      validUntil ? Date.parse(validUntil) : Infinity,
      dbTime(created.expiration_estimate_date ?? created.expirationEstimateDate) || dbTime(tx!.expires_at),
    )).toISOString();
    if (!(Date.parse(purchaseDeadline) > Date.now())) throw new Error("nowpayments_invoice_terminal");
    const guard = `${orderCode}:nowpayments:finish:${crypto.randomUUID()}`;
    try {
      await d1.batch([
        d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN EXISTS(
          SELECT 1 FROM payment_transactions
          WHERE order_code=? AND provider='nowpayments' AND status='initializing')
          AND NOT EXISTS(SELECT 1 FROM payment_transactions WHERE provider='nowpayments' AND provider_payment_id=?)
          THEN 1 ELSE 0 END`).bind(guard, orderCode, paymentId),
        d1.prepare(`INSERT OR IGNORE INTO payment_transactions
          (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,
           currency,price_amount_text,price_currency,pay_currency,pay_network,
           provider_payment_id,pay_address,pay_amount_text,fx_rate_text,fx_effective_at,status,expires_at,
           invoice_issued_at,last_reconciled_at,last_error,created_at,updated_at)
          VALUES(?,'nowpayments','hosted',?,'nowpayments',?,
           'IDR',?,?,?,?,?,?,?,?,?, 'pending',?,
           COALESCE((SELECT invoice_issued_at FROM payment_transactions WHERE order_code=? AND provider='nowpayments'),datetime('now')),
           datetime('now'),NULL,datetime('now'),datetime('now'))
          ON CONFLICT(order_code) DO UPDATE SET
           provider_payment_id=excluded.provider_payment_id,
           pay_address=excluded.pay_address,
           pay_amount_text=excluded.pay_amount_text,
           price_amount_text=excluded.price_amount_text,
           price_currency=excluded.price_currency,
           pay_currency=excluded.pay_currency,
           pay_network=excluded.pay_network,
           fx_rate_text=excluded.fx_rate_text,
           fx_effective_at=excluded.fx_effective_at,
           expires_at=excluded.expires_at,
           invoice_issued_at=COALESCE(payment_transactions.invoice_issued_at,excluded.invoice_issued_at),
           status=CASE WHEN payment_transactions.status='initializing' THEN 'pending' ELSE payment_transactions.status END,
           last_reconciled_at=datetime('now'),last_error=NULL,updated_at=datetime('now')
          WHERE payment_transactions.status IN ('initializing','pending')`)
          .bind(orderCode, orderCode, amount,
            priceText, priceCurrency, currency, options?.payNetwork ?? null,
            paymentId, payAddress, payAmount,
            usd ? `${usd.rateNum}/${usd.rateDen}@${usd.effectiveAt}` : null,
            usd ? usd.effectiveAt : null,
            purchaseDeadline, orderCode),
        d1.prepare("UPDATE orders SET payment_account='NOWPayments',expires_at=?,updated_at=datetime('now') WHERE code=? AND status='pending' AND payment_status IN ('pending','unpaid')")
          .bind(purchaseDeadline, orderCode),
        d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
      ]);
    } catch (error) {
      await execRun(
        `UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),pay_address=COALESCE(pay_address,?),
          pay_amount_text=COALESCE(pay_amount_text,?),price_amount_text=COALESCE(price_amount_text,?),price_currency=COALESCE(price_currency,?),
          pay_currency=COALESCE(pay_currency,?),pay_network=COALESCE(pay_network,?),fx_rate_text=COALESCE(fx_rate_text,?),fx_effective_at=COALESCE(fx_effective_at,?),
          last_error='nowpayments_finalize_failed_manual_review',last_reconciled_at=datetime('now'),updated_at=datetime('now')
         WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')`,
        paymentId, payAddress, payAmount, priceText, priceCurrency, currency, options?.payNetwork ?? null,
        usd ? `${usd.rateNum}/${usd.rateDen}@${usd.effectiveAt}` : null, usd ? usd.effectiveAt : null, orderCode,
      ).catch(() => {});
      throw error;
    }
    const saved = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=? AND provider='nowpayments'", orderCode);
    if (!saved || !saved.provider_payment_id) throw new Error("nowpayments_invoice_missing");
    if (saved.status === "paid") throw new Error("nowpayments_invoice_terminal");
    if (saved.status !== "pending") {
      await execRun("UPDATE payment_transactions SET last_error='nowpayments_finalize_failed_manual_review',updated_at=datetime('now') WHERE order_code=? AND provider='nowpayments' AND status!='paid'",
        orderCode).catch(() => {});
      throw new Error("nowpayments_finalize_failed_manual_review");
    }
    return invoiceFromRow(saved, false);
  } catch (error) {
    const rawCode = error instanceof Error ? error.message.split(":")[0] : "";
    // Memo/extra id: baris sudah ditandai failed dengan alasan ini; jangan ditimpa manual-review generik.
    if (rawCode === "nowpayments_extra_id_unsupported") throw error;
    let reason = /^nowpayments_[a-z0-9_]+$/.test(rawCode) ? rawCode : "nowpayments_invoice_incomplete";
    if (createdCharge && !/^nowpayments_invoice_(terminal|conflict|mismatch)|_terminal$/.test(reason)) {
      // Finalization threw AFTER provider accepted POST. Durably persist the
      // KNOWN remote id + pay details WITHOUT changing the saved binding, so
      // the charge stays reconcilable (no repeat POST). Mark manual review.
      await execRun(
        `UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),pay_address=COALESCE(pay_address,?),
          pay_amount_text=COALESCE(pay_amount_text,?),price_amount_text=COALESCE(price_amount_text,?),price_currency=COALESCE(price_currency,?),
          pay_currency=COALESCE(pay_currency,?),pay_network=COALESCE(pay_network,?),
          last_error='nowpayments_finalize_failed_manual_review',last_reconciled_at=datetime('now'),updated_at=datetime('now')
         WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')`,
        createdCharge.paymentId, createdCharge.payAddress, createdCharge.payAmount,
        priceText, priceCurrency, currency, options?.payNetwork ?? null, orderCode,
      ).catch(() => {});
      reason = "nowpayments_finalize_failed_manual_review";
    } else if (observedPaymentId) {
      await execRun("UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),last_error='nowpayments_invalid_invoice_manual_review',updated_at=datetime('now') WHERE order_code=? AND provider='nowpayments' AND status='initializing'", observedPaymentId, orderCode);
      reason = "nowpayments_finalize_failed_manual_review";
    } else {
      await execRun("UPDATE payment_transactions SET last_error=COALESCE(last_error,?),updated_at=datetime('now') WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')",
        reason, orderCode).catch(() => {});
    }
    const saved = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=? AND provider='nowpayments'", orderCode)
      .catch(() => null);
    if (saved && saved.status === "pending" && !/manual_review/.test(String(saved.last_error ?? "")) && dbTime(saved.expires_at) > Date.now()) return invoiceFromRow(saved, true);
    throw new Error(reason);
  }
}

async function fetchKnownPayment(orderCode: string, providerPaymentId: string): Promise<NowpaymentsInvoice> {
  const tx = await queryFirst(
    "SELECT * FROM payment_transactions WHERE order_code=? AND provider='nowpayments'", orderCode,
  );
  if (!tx || String(tx.provider_payment_id ?? "") !== providerPaymentId) throw new Error("nowpayments_transaction_missing");
  if (tx.status === "pending" && dbTime(tx.expires_at) > Date.now()) return invoiceFromRow(tx, true);
  return reconcileNowpaymentsPayment(orderCode).then((status) => {
    if (status === "pending") {
      const row = tx;
      if (row) return invoiceFromRow(row, true);
    }
    throw new Error(status === "paid" ? "nowpayments_invoice_terminal" : "nowpayments_invoice_incomplete");
  });
}

export const NOWPAYMENTS_POLL_RECONCILE_MS = 60_000;

/** Known-charge latch: initializing WITH a known payment id is a real
 * provider charge interrupted mid-finalize — reconcile it, don't strand.
 * Single vector via claimNowpaymentsPollReconcile (CAS on status+known-id);
 * wrapper ini kept untuk readability call sites read-only. */
export async function claimKnownChargeReconcile(orderCode: string): Promise<boolean> {
  return claimNowpaymentsPollReconcile(orderCode);
}

export async function claimNowpaymentsPollReconcile(orderCode: string): Promise<boolean> {
  const d1 = getD1();
  if (!d1) return false;
  // CAS + check di SATU statement: claim HANYA bila row pending ATAU
  // initializing yang SUDAH punya known payment id (latch real charge).
  // Status lain/no-op => 0 changes (no claim), no check-then-act race.
  const result = await execRun(
    `UPDATE payment_transactions SET last_checked_at=datetime('now'),updated_at=datetime('now')
     WHERE order_code=? AND provider='nowpayments'
       AND (status='pending' OR (status='initializing' AND provider_payment_id IS NOT NULL))
       AND (last_checked_at IS NULL OR julianday(last_checked_at)<=julianday('now',?))`,
    orderCode, `-${NOWPAYMENTS_POLL_RECONCILE_MS / 1000} seconds`,
  );
  return Number(result.changes || 0) > 0;
}

function localStatusOf(providerStatus: string): "pending" | "paid" | "manual_review" | "expired" | "terminal" | "unknown" {
  const state = providerStatus.toLowerCase();
  if (["waiting", "confirming", "confirmed", "sending"].includes(state)) return "pending";
  if (state === "finished") return "paid";
  if (["partially_paid", "failed"].includes(state)) return "manual_review";
  if (state === "expired") return "expired";
  return "unknown";
}

/** Rekonsiliasi GET /payment/:id: cek identitas + ekspektasi tersimpan; gross cukup baru paid; net outcome bukan harga. */
export async function reconcileNowpaymentsPayment(orderCode: string): Promise<string> {
  const tx = await queryFirst(`SELECT pt.*,o.status AS order_status,o.payment_status,o.expires_at AS order_expires_at,
    o.variant_id,o.sales_channel,o.order_kind,(SELECT id FROM fulfillment_inventory fi WHERE fi.order_code=o.code AND fi.status='reserved' LIMIT 1) AS inventory_id
    FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code WHERE pt.order_code=? AND pt.provider='nowpayments'`, orderCode);
  if (!tx) throw new Error("nowpayments_transaction_missing");
  if (tx.status === "paid") return "already_paid";
  if (!tx.provider_payment_id) throw new Error("nowpayments_invoice_initializing");
  const status = await (async () => {
    try {
      return await providerFetch(`/payment/${encodeURIComponent(String(tx.provider_payment_id))}`);
    } catch (error) {
      // Ambiguous GET gagal: pertahankan pending/alertable, jangan tandai
      // terminal dari kegagalan jaringan.
      const message = error instanceof Error ? error.message : "";
      if (/ambiguous|http_5|network/i.test(message)) throw new Error("nowpayments_provider_unavailable");
      throw error;
    }
  })();
  // Known-charge recovery: an initializing row WITH a persisted payment id is a
  // real provider charge interrupted mid-finalize — reconcile it, don't strand it.
  const recoverable = tx.status === "pending"
    || (tx.status === "initializing" && Boolean(tx.provider_payment_id));
  if (!recoverable) return tx.status === "paid" ? "already_paid" : "manual_review";
  const paymentId = asText(status.payment_id ?? status.paymentId);
  if (!paymentId || paymentId !== String(tx.provider_payment_id)) throw new Error("nowpayments_payment_mismatch");
  if (asText(status.order_id ?? status.orderId) !== orderCode) throw new Error("nowpayments_payment_mismatch");
  const payCurrency = asText(status.pay_currency ?? status.payCurrency)?.toLowerCase();
  if (!payCurrency || payCurrency !== String(tx.pay_currency).toLowerCase()) throw new Error("nowpayments_currency_mismatch");
  const network = asText(status.network);
  if (network && tx.pay_network && network.toLowerCase() !== String(tx.pay_network).toLowerCase()) {
    throw new Error("nowpayments_network_mismatch");
  }
  if (Number(tx.fee_paid_by_user) === 1 && (providerBoolean(status.is_fixed_rate) !== true || providerBoolean(status.is_fee_paid_by_user) !== true)) {
    await execRun("UPDATE payment_transactions SET last_error=CASE WHEN last_error IS NULL OR last_error='nowpayments_finalize_failed_manual_review' THEN 'nowpayments_policy_manual_review' ELSE last_error END,updated_at=datetime('now') WHERE order_code=? AND provider='nowpayments' AND status!='paid'", orderCode);
    return "manual_review";
  }
  if (Number(tx.fee_paid_by_user) !== 1
    && (providerBoolean(status.is_fixed_rate) === true || providerBoolean(status.is_fee_paid_by_user) === true)) {
    // Baris 0/0 (kurs mengambang + fee merchant) tetapi provider melaporkan fixed-rate / fee-by-user:
    // kebijakan tidak dipatuhi => review manual, tidak pernah auto-paid.
    await execRun("UPDATE payment_transactions SET last_error=CASE WHEN last_error IS NULL OR last_error='nowpayments_finalize_failed_manual_review' THEN 'nowpayments_policy_manual_review' ELSE last_error END,updated_at=datetime('now') WHERE order_code=? AND provider='nowpayments' AND status!='paid'", orderCode);
    return "manual_review";
  }
  if (tx.last_error && tx.last_error !== "nowpayments_finalize_failed_manual_review") return "manual_review";
  const savedPriceAmount = asText(tx.price_amount_text);
  const savedPriceCurrency = asText(tx.price_currency)?.toLowerCase();
  const savedRequested = Number(tx.requested_amount);
  // Mode ganda: USD baru ('usd' + teks 2dp + FX snapshot) vs legacy 'idr'.
  // Keduanya exact; gross vs net tetap terpisah seperti W1.
  if (savedPriceCurrency === "usd") {
    if (!savedPriceAmount || !/^[0-9]+\.[0-9]{2}$/.test(savedPriceAmount)
      || !Number.isSafeInteger(savedRequested)) throw new Error("nowpayments_invoice_mismatch");
    if (!asText(tx.fx_rate_text) || !asText(tx.fx_effective_at)) throw new Error("nowpayments_invoice_mismatch");
  } else if (savedPriceCurrency === "idr") {
    if (!savedPriceAmount || !equalDecimal(savedPriceAmount, String(savedRequested))
      || !Number.isSafeInteger(savedRequested)) throw new Error("nowpayments_invoice_mismatch");
  } else {
    throw new Error("nowpayments_invoice_mismatch");
  }
  const statusPriceAmount = asText(status.price_amount ?? status.priceAmount);
  const statusPriceCurrency = asText(status.price_currency ?? status.priceCurrency)?.toLowerCase();
  if (!equalDecimal(statusPriceAmount, savedPriceAmount) || statusPriceCurrency !== savedPriceCurrency) throw new Error("nowpayments_price_mismatch");
  const statusPayAmount = asText(status.pay_amount ?? status.payAmount);
  const expected = asText(tx.pay_amount_text);
  if (!equalDecimal(statusPayAmount, expected)) throw new Error("nowpayments_pay_amount_mismatch");
  if (!expected || !parseDecimalParts(expected) || parseDecimalParts(expected)!.scaled <= BigInt(0)) {
    throw new Error("nowpayments_invoice_mismatch");
  }
  if (Number(tx.fee_paid_by_user) === 1 && (status.valid_until != null || tx.status === "initializing")) {
    const validUntil = typeof status.valid_until === "string" ? parseFxTimestamp(status.valid_until) : null;
    if (!validUntil || Date.parse(validUntil) <= Date.now()) {
      await execRun("UPDATE payment_transactions SET last_error='nowpayments_deadline_manual_review',updated_at=datetime('now') WHERE order_code=? AND provider='nowpayments' AND status!='paid'", orderCode);
      return "manual_review";
    }
    if (Date.parse(validUntil) < dbTime(tx.expires_at)) {
      await execRun("UPDATE payment_transactions SET expires_at=CASE WHEN julianday(expires_at)>julianday(?) THEN ? ELSE expires_at END WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')", validUntil, validUntil, orderCode);
      tx.expires_at = validUntil;
    }
  }
  const actuallyPaid = asText(status.actually_paid ?? status.actuallyPaid);
  const outcome = asText(status.outcome_amount ?? status.outcomeAmount);
  const outcomeCurrency = asText(status.outcome_currency ?? status.outcomeCurrency);
  // Durable provider status: persisted SELALU setelah identitas + price
  // lolos — even bila amount mapping bermasalah. Alat cancel guard + buyer
  // view membaca kolom ini, bukan menebak dari actually_paid.
  const rawProviderStatus = asText(status.payment_status ?? status.paymentStatus)?.toLowerCase() ?? null;
  if (rawProviderStatus && !/^[a-z_]{1,32}$/.test(rawProviderStatus)) throw new Error("nowpayments_status_invalid");
  const mapped = localStatusOf(rawProviderStatus ?? "");
  const persistObserved = async (extraError: string | null, extraStatus?: string) => {
    await execRun(
      `UPDATE payment_transactions SET actually_paid_text=CASE WHEN ? IS NOT NULL THEN ? ELSE actually_paid_text END,
        outcome_amount_text=CASE WHEN ? IS NOT NULL THEN ? ELSE outcome_amount_text END,
        outcome_currency=CASE WHEN ? IS NOT NULL THEN ? ELSE outcome_currency END,
        provider_status_text=CASE WHEN ? IS NOT NULL THEN ? ELSE provider_status_text END,
        last_reconciled_at=datetime('now'),last_checked_at=datetime('now'),
        last_error=CASE WHEN ? IS NOT NULL THEN ? ELSE last_error END,
        status=CASE WHEN ? IS NOT NULL AND status IN ('initializing','pending') THEN ? ELSE status END,
        updated_at=datetime('now')
       WHERE order_code=? AND provider='nowpayments'`,
      actuallyPaid, actuallyPaid, outcome, outcome, outcomeCurrency, outcomeCurrency,
      rawProviderStatus, rawProviderStatus,
      extraError, extraError, extraStatus ?? null, extraStatus ?? null, orderCode,
    );
  };
  if (mapped === "pending") {
    const received = parseDecimalParts(actuallyPaid);
    if (received && received.scaled > BigInt(0) && !isSufficientDecimal(actuallyPaid, expected)) {
      await persistObserved("nowpayments_partial_manual_review");
      await manualReview(tx, "nowpayments_partial_manual_review");
      return "manual_review";
    }
    await persistObserved(null);
    return "pending";
  }
  if (mapped === "expired") {
    await persistObserved("nowpayments_provider_expired_manual_review", "failed");
    return "expired";
  }
  if (mapped === "unknown") {
    // unknown status TETAP persist provider_status_text di atas —
    // last_error hanya tetap kosong bila status mentah kosong (jangan
    // tandai manual dari respons tak berbentuk).
    if (rawProviderStatus) await persistObserved("nowpayments_unknown_status_manual_review");
    else await persistObserved(null);
    if (rawProviderStatus) await manualReview(tx, "nowpayments_unknown_status_manual_review");
    return "manual_review";
  }
  if (mapped === "manual_review") {
    await persistObserved("nowpayments_partial_or_failed_manual_review");
    await manualReview(tx, "nowpayments_partial_or_failed_manual_review");
    return "manual_review";
  }
  if (!actuallyPaid || !parseDecimalParts(actuallyPaid) || parseDecimalParts(actuallyPaid)!.scaled <= BigInt(0)
    || !isSufficientDecimal(actuallyPaid, expected)) {
    await persistObserved("nowpayments_underpaid_manual_review");
    await manualReview(tx, "nowpayments_underpaid_manual_review");
    return "manual_review";
  }
  const deadline = Math.min(dbTime(tx.expires_at), dbTime(tx.order_expires_at));
  if (tx.order_status !== "pending" || !(deadline > Date.now()) || Date.parse(String(status.updated_at ?? status.updatedAt ?? new Date().toISOString())) > deadline) {
    await persistObserved("nowpayments_late_payment_manual_review");
    await manualReview(tx, "nowpayments_late_payment_manual_review");
    return "manual_review";
  }
  const eventKey = `nowpayments:${tx.provider_payment_id}:finished`;
  const inserted = await execRun(`INSERT OR IGNORE INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code)
    VALUES(?,?,?,?, 'nowpayments','received',?)`, eventKey,
    await eventHash(eventKey), Number(tx.requested_amount), JSON.stringify({ payment_id: tx.provider_payment_id, status: "finished" }), orderCode);
  const event = await queryFirst("SELECT id,status FROM dana_webhook_events WHERE event_key=?", eventKey);
  if (!event) throw new Error("nowpayments_event_missing");
  if (event.status === "matched") return "already_paid";
  await persistObserved(null);
  const overpaid = compareDecimalText(parseDecimalParts(actuallyPaid)!, parseDecimalParts(expected)!) > 0;
  const changed = await transitionPendingPaymentToPaid(orderCode,
    String(status.updated_at ?? status.updatedAt ?? new Date().toISOString()),
    tx.order_kind === "pedia" ? null : {
      variantId: tx.variant_id == null ? null : Number(tx.variant_id),
      inventoryId: tx.inventory_id == null ? null : Number(tx.inventory_id),
      salesChannel: String(tx.sales_channel),
    },
    {
      id: Number(event.id),
      reviewNote: overpaid ? `nowpayments_overpaid:${actuallyPaid}` : undefined,
    },
    { paymentMethod: "crypto", eventMode: "received_text" },
  );
  if (!changed) {
    const paidRow = await queryFirst("SELECT status FROM payment_transactions WHERE order_code=?", orderCode);
    if (paidRow?.status === "paid") return "already_paid";
    await manualReview(tx, "nowpayments_payment_race_manual_review");
    return "manual_review";
  }
  const { schedulePaidFulfillment } = await import("./paid-fulfillment");
  await schedulePaidFulfillment(orderCode, tx.order_kind);
  return "paid";
}

async function eventHash(eventKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventKey));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}

async function manualReview(tx: Row, reason: string) {
  // Dedupe alert admin: 1x per order per 6 jam (bounded, anti-spam scan).
  // DB lama tanpa kolom (pre-0096) = alert tetap jalan (fail-open ping),
  // guard data tetap ditulis.
  const alertRow = await queryFirst(
    "SELECT last_admin_alert_at FROM payment_transactions WHERE order_code=? AND provider='nowpayments'",
    tx.order_code,
  ).catch(() => null);
  const lastAlert = alertRow && "last_admin_alert_at" in (alertRow as object)
    ? Date.parse(String((alertRow as Row).last_admin_alert_at ?? "")) : NaN;
  const shouldAlert = !Number.isFinite(lastAlert) || Date.now() - lastAlert > 6 * 60 * 60_000;
  await execRun("UPDATE dana_webhook_events SET status='failed',last_error=COALESCE(last_error,?),processed_at=datetime('now') WHERE order_code=? AND provider='nowpayments' AND status!='matched'",
    reason, tx.order_code);
  await execRun(`UPDATE payment_transactions SET last_error=COALESCE(last_error,?),updated_at=datetime('now')
    ${shouldAlert ? ",last_admin_alert_at=datetime('now')" : ""} WHERE order_code=? AND status!='paid'`,
    reason, tx.order_code).catch(async () => {
    await execRun("UPDATE payment_transactions SET last_error=COALESCE(last_error,?),updated_at=datetime('now') WHERE order_code=? AND status!='paid'",
      reason, tx.order_code);
  });
  if (!shouldAlert) return;
  if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
    try {
      const { sendMessage } = await import("@/lib/telegram/api");
      await sendMessage({
        chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
        text: `Pembayaran NOWPayments perlu diperiksa manual.\nPesanan: ${tx.order_code}\nAlasan: ${reason}. Produk tidak dikirim otomatis. Periksa Metode & Rekonsiliasi.`,
      });
    } catch { /* The durable reconciliation entry remains visible. */ }
  }
}
