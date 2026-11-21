// src/lib/orders/detail-view.ts — GET status body builder (3B-1, class E:
// pure move, no behavior change).
//
// BEFORE: the order JSON serializer lived inline in
// src/app/api/orders/route.ts GET (≈:864-902) while
// src/app/api/orders/lookup/route.ts built an equivalent-but-not-identical
// body (≈:164-200, e.g. extra payment_status/proof_url keys, different
// expires_at source for klikqris). Each route keeps its own response shape
// byte-identical here: the shared builder takes the POST-REFRESH row plus
// the flags computed by src/lib/orders/status-flags.ts and returns the
// `order` payload verbatim — key names, key order, and values unchanged.
// Leaf module: no NextResponse, no route imports (the routes wrap the
// result in NextResponse.json themselves), so handlers stay thin wrappers
// per roadmap §3.11.

import type { StatusFlags } from "./status-flags";

export type DetailRow = Record<string, unknown>;

export type DetailViewInput = {
  row: DetailRow;
  code: string;
  /** POST-REFRESH row state: callers must pass the row AFTER the wake=1
   * provider reconcile + supplier-refresh mutations (MAP-1 (d) risk). */
  waMasked: string;
  emailMasked: unknown;
  items: unknown[];
  qrisPreparationError: boolean;
  flags: StatusFlags & { fulfillmentStatus?: unknown };
  automaticProgress: unknown[];
  uniqueUnitsProgress: { ready: number; total: number } | undefined;
  qrisBlock: {
    payable_amount: unknown;
    unique_code: unknown;
    image_url: unknown;
    expires_at: unknown;
    status: unknown;
  } | null;
  payment: unknown | null;
  buyerPinRequired: boolean;
  qrisReissueAllowed: boolean;
  maxQrisReissues: number;
};

/** Masking helpers, verbatim from both routes (status route:727-730). */
export function maskBuyerContact(row: DetailRow): { waMasked: string; emailMasked: unknown } {
  const waFull = String(row.customer_wa ?? "");
  const waMasked =
    waFull.length >= 7
      ? waFull.slice(0, 5) + "****" + waFull.slice(-4)
      : waFull
        ? waFull.slice(0, 3) + "****"
        : "";
  const emailFull = String(row.customer_email ?? "");
  const emailMasked = emailFull.includes("@")
    ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`)
    : emailFull
      ? "***"
      : null;
  return { waMasked, emailMasked };
}

/**
 * Build the GET /api/orders?code= `order` payload. Verbatim move of
 * src/app/api/orders/route.ts:865-901: same keys in the same order, same
 * value expressions. Callers supply every derived input post-refresh.
 */
export function buildStatusDetailView(input: DetailViewInput): Record<string, unknown> {
  const { row, code, waMasked, emailMasked, items, qrisPreparationError, flags, automaticProgress, uniqueUnitsProgress, qrisBlock, payment, buyerPinRequired, qrisReissueAllowed } = input;
  void code;
  return {
    code: row.code,
    customer_name: row.customer_name,
    customer_wa: waMasked,
    customer_wa_full: undefined,
    customer_email: emailMasked,
    items,
    subtotal: row.subtotal,
    payment_method: row.payment_method,
    payment_account: row.payment_account,
    status: row.status,
    locale: (row.locale as string) ?? "id",
    created_at: row.created_at,
    // An incomplete KlikQRIS invoice already has its local 15-minute cap.
    expires_at:
      row.payment_provider === "klikqris" && row.payment_expires_at ? row.payment_expires_at : row.expires_at,
    qris_preparation_error: qrisPreparationError,
    credentials_ready: flags.credentialsReady,
    buyer_pin_required: buyerPinRequired,
    queued_delivery: flags.queuedDelivery,
    instant_delivery: flags.instantDelivery,
    supplier_owned: flags.supplierOwned,
    supplier_running: flags.supplierRunning,
    // /pesanan/[code] membutuhkan ini untuk membedakan lunas-terkirim dari
    // lunas-gagal-kirim (audit ronde 4, W-H1); /api/orders/lookup sudah punya.
    fulfillment_status: (flags.fulfillmentStatus ?? row.fulfillment_status) ?? null,
    automatic_progress: automaticProgress,
    unique_units_progress: uniqueUnitsProgress,
    qris_reissue_allowed: qrisReissueAllowed,
    qris: qrisBlock,
    ...(payment ? { payment } : {}),
  };
}
