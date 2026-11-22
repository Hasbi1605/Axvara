import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";
import { ensureFulfillmentItems } from "@/lib/fulfillment/delivery/inventory-binding";
import { claimLink, isPaidOrder, PAID_ORDER_SQL, PAID_ORDER_SQL_ALIASED } from "@/lib/suppliers/link-lease";
import {
  createPixelverifOrder,
  fetchPixelverifCredits,
  fetchPixelverifPricing,
  findPixelverifOrderByEmail,
  getPixelverifOrder,
  isPixelverifConfigured,
  isPixelverifDispatchEnabled,
  isPixelverifSyncEnabled,
  numeric,
  parsePixelverifOrder,
  record,
  type PixelverifRawResponse,
} from "./client";
import { pixelverifEligibility, type PixelverifEligibility, type PixelverifInput } from "./purchase";
import { purgePixelverifInput } from "./purge";
import { PIXELVERIF_RETRYABLE_ERRORS } from "./retryable";
import { PIXELVERIF_BLOCKING_ERRORS, recordPixelverifEmailBlock } from "./blocklist";
import { safeRedeemLink } from "./admin";

export { pixelverifEligibility, type PixelverifEligibility };

type Row = Record<string, unknown>;
export const PIXELVERIF_ORDERS_PER_RUN = 8;
export const PIXELVERIF_ORPHANS_PER_RUN = 8;

function lines(o: Row): Row[] {
  try {
    const v: unknown = JSON.parse(String(o.items));
    return Array.isArray(v) ? v.map((x) => (record(x) ? x : {})) : [];
  } catch {
    return [];
  }
}

export function eligiblePixelverifLine(value: unknown): Row | null {
  if (!record(value) || !record(value.pixelverif_eligibility) || value.unique_units) return null;
  const e = value.pixelverif_eligibility;
  const flow = e.flow_type;
  const sku = flow === "normal" ? "PV-NORMAL-3" : flow === "full" ? "PV-FULL-3" : null;
  return e.version === 1 &&
    sku !== null &&
    e.sku === sku &&
    e.validity === 3 &&
    e.source_variant_id === value.variant_id &&
    Number(value.qty) === 1 &&
    Number.isSafeInteger(value.variant_id) &&
    Number(value.variant_id) > 0 &&
    Number.isSafeInteger(value.product_id) &&
    Number(value.product_id) > 0 &&
    typeof value.pixelverif_fingerprint === "string" &&
    (value.pixelverif_fingerprint as string).length > 0 &&
    typeof e.cost_usd === "number" &&
    Number.isFinite(e.cost_usd) &&
    e.cost_usd > 0
    ? e
    : null;
}

export { PIXELVERIF_RETRYABLE_ERRORS };

/**
 * Parse a timestamp to epoch ms. The provider sends epoch milliseconds
 * (seconds tolerated); naive "YYYY-MM-DD HH:MM[:SS]" strings are UTC — never
 * host-local, which would shift the recovery window by the host timezone.
 */
function parseUtcTimestamp(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? (value < 1e11 ? value * 1000 : value) : NaN;
  if (typeof value !== "string" || !value.trim()) return NaN;
  const raw = value.trim();
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw);
  return Date.parse(naive ? `${raw.replace(" ", "T")}Z` : raw);
}

/**
 * Client-side poll timeout from the provider guide: 10 minutes for Normal,
 * 15 minutes for Full, measured from this link's first send. Past it the link
 * goes to admin, who may re-poll once (PIXELVERIF_REPOLL_SQL).
 */
export const PIXELVERIF_POLL_TIMEOUT_MS = { normal: 10 * 60_000, full: 15 * 60_000 } as const;
/** Provider polling cadence (README: pending 8–10 s, processing 4–5 s); cron ticks bound it in practice. */
export const PIXELVERIF_POLL_DELAY_SECONDS = { pending: 10, processing: 5 } as const;
function pollBudgetExceeded(link: Row): boolean {
  const sentMs = parseUtcTimestamp(link.request_sent_at);
  const budget = link.flow_type === "full" ? PIXELVERIF_POLL_TIMEOUT_MS.full : PIXELVERIF_POLL_TIMEOUT_MS.normal;
  return Number.isFinite(sentMs) && Date.now() - sentMs > budget;
}

/** Provider codes the guide marks retryable ("Order is refunded; safe to retry"). */
const PIXELVERIF_AUTO_RETRY_CODES = new Set(["OTHER_ERROR"]);
/** Full-mode activation outcomes the provider refunds (README "activation_status"). */
const PIXELVERIF_FAILED_ACTIVATION: Record<string, string> = {
  item_not_available: "ACTIVATION_ITEM_NOT_AVAILABLE",
  failed: "ACTIVATION_FAILED",
  invalid: "ACTIVATION_FAILED",
  error: "ACTIVATION_FAILED",
};
const PIXELVERIF_ACTIVATION_LABEL: Record<string, string> = {
  activated: "Aktivasi: Google AI Pro sudah aktif di akun Anda.",
  already_redeemed: "Aktivasi: penawaran ini sudah pernah ditukarkan di akun Anda.",
};

export const PIXELVERIF_RETRYABLE_SQL = `status='needs_admin' AND attempt_count<3 AND request_sent_at IS NULL AND provider_order_id IS NULL
  AND receipt_ciphertext IS NULL AND receipt_iv IS NULL AND completed_at IS NULL
  AND last_error IN (${[...PIXELVERIF_RETRYABLE_ERRORS].map((code) => `'${code}'`).join(",")})
  AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))
  AND EXISTS(SELECT 1 FROM orders o WHERE o.code=pixelverif_order_links.order_code AND ${PAID_ORDER_SQL_ALIASED})
  AND EXISTS(SELECT 1 FROM fulfillment_items f WHERE f.pixelverif_link_id=pixelverif_order_links.id AND f.order_code=pixelverif_order_links.order_code AND f.item_index=pixelverif_order_links.item_index
    AND f.status IN ('queued','retry','failed','manual_required') AND f.fulfillment_mode='manual' AND f.delivered_ciphertext IS NULL AND f.delivered_iv IS NULL
    AND f.wr_link_id IS NULL AND f.sk_link_id IS NULL AND f.tunvn_link_id IS NULL AND f.aivault_link_id IS NULL AND f.storebat_link_id IS NULL AND f.mirai_link_id IS NULL AND f.inventory_id IS NULL)`;

/** Admin may re-poll a provider order that only exceeded the client-side poll timeout. */
export const PIXELVERIF_REPOLL_SQL = `status='needs_admin' AND last_error='poll_timeout' AND provider_order_id IS NOT NULL AND completed_at IS NULL
  AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))
  AND EXISTS(SELECT 1 FROM orders o WHERE o.code=pixelverif_order_links.order_code AND ${PAID_ORDER_SQL_ALIASED})`;

export async function createPixelverifOrderLinks(
  code: string,
  db: DatabaseAccess = createDatabaseAccess(),
): Promise<number> {
  if (!db.d1 || !isPixelverifConfigured() || !isPixelverifSyncEnabled() || !db.canSpend(5)) return 0;
  const order = await db.queryFirst("SELECT items,status,payment_status,order_kind,supplier_purchase_disabled,sales_channel FROM orders WHERE code=?", code);
  if (!order || !isPaidOrder(order)) return 0;
  const rows = lines(order).flatMap((item, index) => {
    const e = eligiblePixelverifLine(item);
    return e
      // README: X-Idempotency-Key is a UUID per order; reused only for retries of the same send.
      ? [{ index, variant: item.variant_id, product: item.product_id, flow: e.flow_type, validity: 3, cost: e.cost_usd, key: crypto.randomUUID() }]
      : [];
  });
  if (!rows.length) return 0;
  const r = await db.execRun(
    `INSERT OR IGNORE INTO pixelverif_order_links(order_code,item_index,variant_id,product_id,flow_type,validity,credit_cost,fx_idr_per_usd,idempotency_key)
     SELECT code,j.value->>'index',j.value->>'variant',j.value->>'product',j.value->>'flow',3,j.value->>'cost',
       COALESCE(
         (SELECT pixelverif_fx_idr_per_usd FROM product_variants WHERE id=j.value->>'variant'),
         (SELECT CASE WHEN CAST(fx_rate_text AS REAL)>0 THEN CAST(fx_rate_text AS REAL) END FROM crypto_market_snapshot WHERE id=1)
       ),
       j.value->>'key'
     FROM orders JOIN json_each(?) j
     WHERE code=? AND items=? AND ${PAID_ORDER_SQL}`,
    JSON.stringify(rows),
    code,
    order.items,
  );
  return Number(r.changes ?? 0);
}

async function settle(
  db: DatabaseAccess,
  link: Row,
  status: string,
  error: string | null,
  delaySeconds?: number | null,
) {
  // Polling a known provider order follows the provider cadence; POST retries back off.
  const polling = status === "processing" && link.provider_order_id != null;
  const backoffSec = polling ? 0 : Math.max(60, Number(link.attempt_count) * 120);
  const pendingDelaySec =
    delaySeconds != null && Number.isFinite(delaySeconds) && delaySeconds > 0
      ? Math.max(backoffSec, Math.ceil(delaySeconds))
      : polling ? 30 : backoffSec;
  const offsetExpr = status === "pending" || status === "processing" ? `+${pendingDelaySec} seconds` : "+60 seconds";
  const result = await db.execRun(
    `UPDATE pixelverif_order_links
     SET status=?, last_error=?, lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=datetime('now', ?),
         completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END,
         updated_at=datetime('now')
     WHERE id=? AND lease_owner=? AND status!='completed'`,
    status,
    error,
    offsetExpr,
    status,
    link.id,
    link.lease_owner,
  );
  if (!result.changes) return;
  // Buyer credentials are single-purpose, BUT a pre-send retryable failure
  // (insufficient credits, price increase, provider unavailable) must keep
  // the sealed input: PIXELVERIF_RETRYABLE_SQL only admits links with no send
  // in flight (request_sent_at NULL: never sent, or the last send was
  // definitively rejected/refunded), and that retry needs the input. Purge on
  // completion, on any post-send needs_admin, and on non-retryable errors.
  const keepForRetry = status === "needs_admin"
    && Number(link.attempt_count) < 3
    && link.request_sent_at == null
    && link.provider_order_id == null
    && error != null && PIXELVERIF_RETRYABLE_ERRORS.has(error);
  if ((status === "completed" || status === "needs_admin") && !keepForRetry) {
    await purgePixelverifInput(db, String(link.order_code), Number(link.item_index)).catch(() => undefined);
  }
  if (status === "needs_admin") {
    await db.execRun(
      `UPDATE fulfillment_items
       SET status='manual_required', last_error='supplier_needs_admin', locked_until=NULL
       WHERE pixelverif_link_id=? AND status NOT IN ('delivered','sending')
         AND EXISTS(SELECT 1 FROM pixelverif_order_links WHERE id=? AND status='needs_admin' AND lease_owner IS NULL)`,
      link.id,
      link.id,
    );
    const { escalateSupplierManual } = await import("@/lib/fulfillment/supplier-escalation");
    const { pixelverifBuyerErrorMessage } = await import("./copy");
    await escalateSupplierManual(db, String(link.order_code), "pixelverif", link.id, pixelverifBuyerErrorMessage(error));
  }
}

async function deferRetry(
  db: DatabaseAccess,
  link: Row,
  retryAfterSeconds?: number | null,
  fromPost = false,
) {
  const exhausted = Number(link.attempt_count) >= 3;
  if (!fromPost && link.provider_order_id) {
    // Poll path (provider order exists, never POST again): stay 'processing'
    // and escalate once polling has failed for longer than the poll budget.
    const timedOut = pollBudgetExceeded(link);
    await settle(db, link, timedOut ? "needs_admin" : "processing", timedOut ? "poll_timeout" : "poll_deferred", retryAfterSeconds);
    return;
  }
  if (fromPost) {
    await settle(
      db,
      link,
      exhausted ? "processing" : "pending",
      exhausted ? "lookup_required" : "retry_same_idempotency_key",
      retryAfterSeconds,
    );
    return;
  }
  const expired = link.request_sent_at ? Date.now() - Date.parse(String(link.request_sent_at)) > 86_400_000 : false;
  await settle(
    db,
    link,
    exhausted ? (expired ? "needs_admin" : "processing") : "pending",
    exhausted ? (expired ? "attempts_exhausted" : "lookup_unconfirmed") : "retry_same_idempotency_key",
    retryAfterSeconds,
  );
}

async function saveReceipt(db: DatabaseAccess, link: Row, r: { status: number; text: string }) {
  const sealed = await encryptSecret(r.text);
  return (
    await db.execRun(
      `UPDATE pixelverif_order_links
       SET receipt_ciphertext=?, receipt_iv=?, receipt_http_status=?, updated_at=datetime('now')
       WHERE id=? AND lease_owner=? AND attempt_count=? AND status!='completed' AND datetime(lease_expires_at)>datetime('now')`,
      sealed.ciphertext,
      sealed.iv,
      r.status,
      link.id,
      link.lease_owner,
      link.attempt_count,
    )
  ).changes;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Provider error bodies may echo buyer data; only fixed codes are persisted. */
function providerErrorCode(text: string): string | null {
  const j = parseJson(text);
  if (!record(j)) return null;
  // README: poll bodies nest the failure at order.error.code; tolerate top-level error.code.
  const err = record(j.order) && record(j.order.error) ? j.order.error : record(j.error) ? j.error : null;
  if (err && typeof err.code === "string" && /^[A-Z0-9_]{1,64}$/.test(err.code)) return err.code;
  return null;
}

/**
 * A POST answered 401/402/403 created no provider order (README: auth and
 * credit checks reject before queueing). When this was the link's only send,
 * undo the send fence so the admin retry gate (PIXELVERIF_RETRYABLE_SQL) and
 * the sealed input stay available. Later sends keep the ambiguity guard.
 */
async function revertRejectedFirstSend(db: DatabaseAccess, link: Row): Promise<boolean> {
  if (Number(link.attempt_count) !== 1 || link.provider_order_id != null) return false;
  const r = await db.execRun(
    `UPDATE pixelverif_order_links
     SET attempt_count=0, request_sent_at=NULL, receipt_ciphertext=NULL, receipt_iv=NULL, receipt_http_status=NULL, updated_at=datetime('now')
     WHERE id=? AND lease_owner=? AND attempt_count=1 AND provider_order_id IS NULL AND status!='completed'`,
    link.id,
    link.lease_owner,
  );
  if (!r.changes) return false;
  link.attempt_count = 0;
  link.request_sent_at = null;
  return true;
}

/**
 * README: OTHER_ERROR is refunded and safe to retry. The same
 * X-Idempotency-Key would replay the failed order, so the next POST gets a
 * fresh UUID. The failed provider id is kept in provider_order_code so email
 * recovery never re-binds it. Bounded by attempt_count (max 3 sends).
 */
async function rearmAfterRetryableFailure(db: DatabaseAccess, link: Row): Promise<boolean> {
  if (Number(link.attempt_count) >= 3 || !link.provider_order_id) return false;
  const r = await db.execRun(
    `UPDATE pixelverif_order_links
     SET status='pending', provider_order_code=provider_order_id, provider_order_id=NULL, idempotency_key=?,
         request_sent_at=NULL, receipt_ciphertext=NULL, receipt_iv=NULL, receipt_http_status=NULL,
         last_error='provider_retry', lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=datetime('now','+60 seconds'), updated_at=datetime('now')
     WHERE id=? AND lease_owner=? AND provider_order_id=? AND status!='completed' AND attempt_count<3
       AND EXISTS(SELECT 1 FROM pixelverif_buyer_inputs WHERE order_code=? AND item_index=? AND purged_at IS NULL AND input_ciphertext IS NOT NULL)`,
    crypto.randomUUID(),
    link.id,
    link.lease_owner,
    link.provider_order_id,
    link.order_code,
    link.item_index,
  );
  return Number(r.changes ?? 0) > 0;
}

/**
 * README: a Gmail failed with ACTIVATION_ITEM_NOT_AVAILABLE must not be
 * resubmitted for the same offer. Record its hash BEFORE settle() purges the
 * sealed input; checkout (web + Telegram) rejects it afterwards.
 */
async function blockEmailIfRequired(db: DatabaseAccess, link: Row, code: string): Promise<void> {
  if (!PIXELVERIF_BLOCKING_ERRORS.has(code)) return;
  const input = await loadBuyerInput(db, link).catch(() => null);
  if (!input) return;
  await recordPixelverifEmailBlock(db, input.pv_email, Number(link.validity), code, String(link.order_code)).catch(() => undefined);
}

/**
 * Interpret a GET /api/order/{id} (or replayed receipt) body.
 * Returns true when the response was terminally handled.
 */
async function interpretPoll(
  db: DatabaseAccess,
  link: Row,
  r: Pick<PixelverifRawResponse, "status" | "text">,
): Promise<boolean> {
  if (r.status === 429 || r.status >= 500) return false;
  if (r.status < 200 || r.status >= 300) {
    await settle(db, link, "needs_admin", `http_${r.status}`);
    return true;
  }
  const parsed = parsePixelverifOrder(parseJson(r.text));
  if (!parsed) return false;
  if (
    parsed.order_id !== link.provider_order_id ||
    parsed.flow_type !== link.flow_type ||
    parsed.validity !== Number(link.validity)
  ) {
    await settle(db, link, "needs_admin", "receipt_identity_mismatch");
    return true;
  }
  const status = parsed.status.toLowerCase();

  await db.execRun(
    `UPDATE pixelverif_order_links
     SET receipt_json=?, activation_status=?, queue_position=?, progress_step=?, last_error_code=?
     WHERE id=? AND lease_owner=? AND status!='completed'`,
    JSON.stringify({
      status,
      link_present: typeof parsed.result?.link === "string" && parsed.result.link.length > 0,
      activation_status: parsed.activation_status ?? null,
      credit_refunded: parsed.credit_refunded ?? null,
    }),
    parsed.activation_status ?? null,
    parsed.queue_position ?? null,
    numeric(parsed.progress?.current_step) ?? null,
    providerErrorCode(r.text),
    link.id,
    link.lease_owner,
  );

  if (status === "pending" || status === "processing") {
    // A provider order stuck nonterminal past the poll budget goes to admin
    // (buyer already paid); polling never runs unbounded.
    if (pollBudgetExceeded(link)) await settle(db, link, "needs_admin", "poll_timeout");
    else await settle(db, link, "processing", null, status === "pending" ? PIXELVERIF_POLL_DELAY_SECONDS.pending : PIXELVERIF_POLL_DELAY_SECONDS.processing);
    return true;
  }
  if (status === "failed") {
    const code = providerErrorCode(r.text) ?? "provider_failed";
    if (PIXELVERIF_AUTO_RETRY_CODES.has(code) && (await rearmAfterRetryableFailure(db, link))) return true;
    await blockEmailIfRequired(db, link, code);
    await settle(db, link, "needs_admin", code);
    return true;
  }
  if (status !== "success") {
    await settle(db, link, "needs_admin", "provider_failed");
    return true;
  }
  // Only an https redeem URL may reach the buyer; anything else goes to admin.
  const redeemLink = safeRedeemLink(parsed.result?.link) ?? "";
  if (!redeemLink) {
    await settle(db, link, "needs_admin", "incomplete_receipt");
    return true;
  }
  // Full mode: a refunded activation outcome is a failure, never a delivery.
  const failedActivation = link.flow_type === "full" && parsed.activation_status
    ? PIXELVERIF_FAILED_ACTIVATION[parsed.activation_status]
    : undefined;
  if (failedActivation) {
    await blockEmailIfRequired(db, link, failedActivation);
    await settle(db, link, "needs_admin", failedActivation);
    return true;
  }
  const activationLabel = link.flow_type === "full" && parsed.activation_status
    ? PIXELVERIF_ACTIVATION_LABEL[parsed.activation_status]
    : undefined;
  const deliveredText = activationLabel ? `${redeemLink}\n${activationLabel}` : redeemLink;
  const secret = await encryptSecret(deliveredText);
  const saved = await db.execRun(
    `UPDATE fulfillment_items
     SET delivered_ciphertext=?, delivered_iv=?, status='queued', last_error=NULL, locked_until=NULL
     WHERE pixelverif_link_id=? AND order_code=? AND item_index=?
       AND status NOT IN ('delivered','sending')
       AND wr_link_id IS NULL AND sk_link_id IS NULL AND tunvn_link_id IS NULL AND aivault_link_id IS NULL AND storebat_link_id IS NULL AND mirai_link_id IS NULL AND inventory_id IS NULL
       AND EXISTS(SELECT 1 FROM pixelverif_order_links WHERE id=? AND lease_owner=? AND status!='completed' AND datetime(lease_expires_at)>datetime('now'))`,
    secret.ciphertext,
    secret.iv,
    link.id,
    link.order_code,
    link.item_index,
    link.id,
    link.lease_owner,
  );
  if (!saved.changes) {
    await settle(db, link, "needs_admin", "fulfillment_owned_elsewhere");
    return true;
  }
  await db.execRun(
    `UPDATE fulfillment_jobs
     SET status='queued', attempt_count=0, next_attempt_at=datetime('now'), locked_until=NULL
     WHERE order_code=? AND status IN ('delivered','manual_required','failed')`,
    link.order_code,
  );
  await settle(db, link, "completed", null);
  return true;
}

/** Interpret the POST /api/order 201 body (no nested order object). */
async function interpretCreate(
  db: DatabaseAccess,
  link: Row,
  r: PixelverifRawResponse,
): Promise<boolean> {
  if (r.status === 429 || r.status >= 500) return false;
  if (r.status === 400) {
    await settle(db, link, "needs_admin", providerErrorCode(r.text) ?? "provider_rejected");
    return true;
  }
  if (r.status === 402 || r.status === 401 || r.status === 403) {
    const reverted = await revertRejectedFirstSend(db, link);
    await settle(
      db,
      link,
      "needs_admin",
      r.status === 402 ? "insufficient_credits" : reverted ? "service_unavailable" : `http_${r.status}`,
    );
    return true;
  }
  if (r.status < 200 || r.status >= 300) {
    await settle(db, link, "needs_admin", `http_${r.status}`);
    return true;
  }
  const j = parseJson(r.text);
  if (!record(j) || j.success !== true) {
    await settle(db, link, "needs_admin", "provider_failed");
    return true;
  }
  const providerOrderId = typeof j.order_id === "string" && j.order_id.trim() ? j.order_id.trim() : null;
  if (
    !providerOrderId ||
    (typeof j.flow_type === "string" && j.flow_type !== link.flow_type) ||
    (j.validity != null && numeric(j.validity) !== Number(link.validity))
  ) {
    await settle(db, link, "needs_admin", "receipt_identity_mismatch");
    return true;
  }
  const bound = await db.execRun(
    `UPDATE pixelverif_order_links SET provider_order_id=?, provider_order_code=?, updated_at=datetime('now')
     WHERE id=? AND lease_owner=? AND status!='completed' AND provider_order_id IS NULL`,
    providerOrderId,
    providerOrderId,
    link.id,
    link.lease_owner,
  );
  if (!bound.changes) {
    await settle(db, link, "needs_admin", "receipt_identity_mismatch");
    return true;
  }
  link.provider_order_id = providerOrderId;
  await settle(db, link, "processing", null, PIXELVERIF_POLL_DELAY_SECONDS.pending);
  return true;
}

async function loadBuyerInput(db: DatabaseAccess, link: Row): Promise<PixelverifInput | null> {
  const row = await db.queryFirst(
    "SELECT input_ciphertext, input_iv, purged_at FROM pixelverif_buyer_inputs WHERE order_code=? AND item_index=?",
    link.order_code,
    link.item_index,
  );
  if (!row || row.purged_at != null || !row.input_ciphertext || !row.input_iv) return null;
  try {
    const parsed: unknown = JSON.parse(await decryptSecret(String(row.input_ciphertext), String(row.input_iv)));
    if (!record(parsed)) return null;
    const email = typeof parsed.pv_email === "string" ? parsed.pv_email : "";
    const password = typeof parsed.pv_password === "string" ? parsed.pv_password : "";
    const totp = typeof parsed.pv_totp_secret === "string" ? parsed.pv_totp_secret : "";
    if (!email || !password || !totp) return null;
    return { pv_email: email, pv_password: password, pv_totp_secret: totp };
  } catch {
    return null;
  }
}

async function processLink(db: DatabaseAccess, id: number, deadlineMs = Infinity): Promise<{ claimed: boolean; rateLimited: boolean }> {
  const owner = crypto.randomUUID();
  const claimed = await claimLink(db, "pixelverif", id, owner);
  if (!claimed.changes) return { claimed: false, rateLimited: false };
  const link = await db.queryFirst("SELECT * FROM pixelverif_order_links WHERE id=? AND lease_owner=?", id, owner);
  if (!link) return { claimed: true, rateLimited: false };
  if (Date.now() >= deadlineMs) {
    await settle(db, link, link.request_sent_at ? "processing" : "pending", "dispatch_deferred");
    return { claimed: true, rateLimited: false };
  }

  let sent = false;
  let rateLimited = false;
  try {
    const order = await db.queryFirst("SELECT * FROM orders WHERE code=?", link.order_code);
    const item = order ? lines(order)[Number(link.item_index)] : null;
    const e = eligiblePixelverifLine(item);
    if (
      !order ||
      !isPaidOrder(order) ||
      !item ||
      !e ||
      e.flow_type !== link.flow_type ||
      e.cost_usd !== link.credit_cost ||
      item.variant_id !== link.variant_id ||
      item.product_id !== link.product_id ||
      Number(item.qty) !== 1
    ) {
      await settle(db, link, "needs_admin", "snapshot_mismatch");
      return { claimed: true, rateLimited: false };
    }

    let fulfillment = await db.queryFirst(
      "SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",
      link.order_code,
      link.item_index,
    );
    if (!fulfillment) {
      await ensureFulfillmentItems(order, db);
      fulfillment = await db.queryFirst(
        "SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",
        link.order_code,
        link.item_index,
      );
    }
    if (!fulfillment) {
      await settle(db, link, "pending", "fulfillment_missing");
      return { claimed: true, rateLimited: false };
    }
    if (
      fulfillment.product_id !== link.product_id ||
      fulfillment.variant_id !== link.variant_id ||
      Number(fulfillment.qty) !== 1 ||
      fulfillment.fulfillment_mode !== "manual" ||
      ["delivered", "sending"].includes(String(fulfillment.status)) ||
      fulfillment.inventory_id ||
      fulfillment.wr_link_id ||
      fulfillment.sk_link_id ||
      fulfillment.tunvn_link_id ||
      fulfillment.aivault_link_id ||
      fulfillment.storebat_link_id ||
      fulfillment.mirai_link_id ||
      (fulfillment.pixelverif_link_id && fulfillment.pixelverif_link_id !== id)
    ) {
      await settle(db, link, "needs_admin", "fulfillment_owned_elsewhere");
      return { claimed: true, rateLimited: false };
    }

    const bound = await db.execRun(
      `UPDATE fulfillment_items SET pixelverif_link_id=?
       WHERE id=? AND (pixelverif_link_id IS NULL OR pixelverif_link_id=?)
         AND wr_link_id IS NULL AND sk_link_id IS NULL AND tunvn_link_id IS NULL AND aivault_link_id IS NULL AND storebat_link_id IS NULL AND mirai_link_id IS NULL AND inventory_id IS NULL
         AND status NOT IN ('delivered','sending')`,
      id,
      fulfillment.id,
      id,
    );
    if (!bound.changes) {
      await settle(db, link, "needs_admin", "fulfillment_owned_elsewhere");
      return { claimed: true, rateLimited: false };
    }

    if (link.receipt_ciphertext && link.receipt_iv && link.receipt_http_status) {
      const stored = {
        status: Number(link.receipt_http_status),
        text: await decryptSecret(String(link.receipt_ciphertext), String(link.receipt_iv)),
      };
      if (link.provider_order_id) {
        // Replay may only FINISH work: a cached nonterminal poll body must
        // never suppress a fresh GET, or the link polls itself forever.
        const cached = parsePixelverifOrder(parseJson(stored.text));
        const cachedStatus = cached?.status.toLowerCase() ?? "";
        if (cachedStatus === "success" || cachedStatus === "failed") {
          if (await interpretPoll(db, link, stored)) return { claimed: true, rateLimited: false };
        }
      } else if (await interpretCreate(db, link, { ...stored, retryAfterSeconds: null })) {
        return { claimed: true, rateLimited: false };
      }
    }

    await encryptSecret("pixelverif-encryption-preflight");

    // Poll path: provider order already created — never POST again.
    if (link.provider_order_id) {
      if (Date.now() >= deadlineMs) {
        await settle(db, link, "processing", "poll_deferred");
        return { claimed: true, rateLimited: false };
      }
      const poll = await getPixelverifOrder(String(link.provider_order_id));
      if (poll.status === 429) rateLimited = true;
      if (poll.status === 200) {
        if (!(await saveReceipt(db, link, poll))) return { claimed: true, rateLimited };
        if (!(await interpretPoll(db, link, poll))) await deferRetry(db, link, poll.retryAfterSeconds);
        return { claimed: true, rateLimited };
      }
      if (poll.status === 429 || poll.status >= 500) {
        await deferRetry(db, link, poll.retryAfterSeconds);
        return { claimed: true, rateLimited };
      }
      await settle(db, link, "needs_admin", `http_${poll.status}`);
      return { claimed: true, rateLimited };
    }

    // Ambiguous POST recovery: a previous send may have created the order.
    // Recover by buyer email (10-minute provider window) before any re-POST.
    if (link.request_sent_at) {
      if (Date.now() >= deadlineMs) {
        await settle(db, link, "processing", "lookup_deferred");
        return { claimed: true, rateLimited: false };
      }
      const input = await loadBuyerInput(db, link);
      if (input) {
        const lookup = await findPixelverifOrderByEmail(input.pv_email);
        if (lookup.status === 429) rateLimited = true;
        if (lookup.status === 200) {
          const found = parsePixelverifOrder(parseJson(lookup.text));
          // Bind recovery to THIS send: same buyer email, same flow/validity,
          // and the provider order must not predate this link's first send
          // (2-minute clock-skew tolerance). An older order for the same
          // Gmail belongs to an earlier purchase and must never be attached.
          // Fail closed: an unreadable timestamp is NOT bound; the re-POST
          // below reuses the same X-Idempotency-Key, which the provider
          // answers with the existing order without charging again.
          const sentMs = parseUtcTimestamp(link.request_sent_at);
          const createdMs = parseUtcTimestamp(found?.created_at);
          const boundToThisSend = Boolean(found)
            // Never re-bind the provider order an OTHER_ERROR retry already gave up on.
            && found!.order_id !== link.provider_order_code
            && found!.flow_type === link.flow_type
            && found!.validity === Number(link.validity)
            && found!.email.trim().toLowerCase() === input.pv_email.trim().toLowerCase()
            && Number.isFinite(createdMs) && Number.isFinite(sentMs) && createdMs >= sentMs - 120_000;
          if (found && boundToThisSend) {
            const boundProvider = await db.execRun(
              `UPDATE pixelverif_order_links SET provider_order_id=?, provider_order_code=?, updated_at=datetime('now')
               WHERE id=? AND lease_owner=? AND status!='completed' AND provider_order_id IS NULL
                 AND NOT EXISTS(SELECT 1 FROM pixelverif_order_links other WHERE other.provider_order_id=? AND other.id!=?)`,
              found.order_id,
              found.order_id,
              link.id,
              link.lease_owner,
              // A provider order already owned by another link (an earlier
              // purchase for the same Gmail) is never re-attached; this link
              // falls through to the same-key re-POST instead.
              found.order_id,
              link.id,
            );
            if (boundProvider.changes) {
              link.provider_order_id = found.order_id;
              if (!(await saveReceipt(db, link, lookup))) return { claimed: true, rateLimited };
              if (await interpretPoll(db, link, lookup)) return { claimed: true, rateLimited };
            }
          }
        } else if (lookup.status === 429 || lookup.status >= 500) {
          await deferRetry(db, link, lookup.retryAfterSeconds);
          return { claimed: true, rateLimited };
        }
      }
    }

    // New-POST gates (variants may have been disabled after payment; already
    // submitted orders above are never stranded by these checks).
    const variant = await db.queryFirst(
      `SELECT pv.*, p.source, p.is_active AS product_active, p.archived_at,
         p.pixelverif_family, p.wr_product_id, p.sk_product_id, p.wr_auto_managed, p.sk_auto_managed,
         p.tunvn_family, p.aivault_family, p.storebat_family, p.mirai_family
       FROM product_variants pv JOIN products p ON p.id=pv.product_id
       WHERE pv.id=? AND pv.product_id=?`,
      link.variant_id,
      link.product_id,
    );
    const expectedSku = link.flow_type === "normal" ? "PV-NORMAL-3" : "PV-FULL-3";
    if (
      !variant ||
      variant.sku !== expectedSku ||
      variant.pixelverif_flow_type !== link.flow_type ||
      Number(variant.pixelverif_validity) !== 3 ||
      !variant.pixelverif_family ||
      variant.archived_at != null ||
      variant.fulfillment_mode !== "manual" ||
      variant.source !== "manual" ||
      variant.is_active !== 1 ||
      variant.product_active !== 1 ||
      variant.wr_variant_id ||
      variant.sk_variant_id ||
      variant.tunvn_buff_quantity_b ||
      variant.aivault_service_id ||
      variant.storebat_product_id ||
      variant.mirai_package_code ||
      variant.wr_product_id ||
      variant.sk_product_id ||
      Number(variant.wr_auto_managed) ||
      Number(variant.sk_auto_managed) ||
      variant.tunvn_family ||
      variant.aivault_family ||
      variant.storebat_family ||
      variant.mirai_family
    ) {
      await settle(db, link, "needs_admin", "source_changed");
      return { claimed: true, rateLimited: false };
    }

    if (Number(link.attempt_count) >= 3) {
      await settle(db, link, "needs_admin", "attempts_exhausted");
      return { claimed: true, rateLimited: false };
    }

    if (Date.now() >= deadlineMs) {
      await settle(db, link, "pending", "dispatch_deferred");
      return { claimed: true, rateLimited: false };
    }

    {
      // EVERY POST (first send or re-POST after an ambiguous attempt) runs
      // the sealed-input, live-price, and balance preflight. Skipping it on
      // re-POST would let a stale price/balance state charge the provider.
      const inputRow = await db.queryFirst(
        "SELECT purged_at, input_ciphertext FROM pixelverif_buyer_inputs WHERE order_code=? AND item_index=?",
        link.order_code,
        link.item_index,
      );
      if (!inputRow || inputRow.purged_at != null || !inputRow.input_ciphertext) {
        await settle(db, link, "needs_admin", "input_missing");
        return { claimed: true, rateLimited: false };
      }
      const pricing = await fetchPixelverifPricing();
      if (pricing.kind !== "ok") {
        if (pricing.kind === "ambiguous" && pricing.reason === "http_429") rateLimited = true;
        await settle(db, link, "needs_admin", "service_unavailable");
        return { claimed: true, rateLimited };
      }
      const liveCost = pricing.data.pricing[String(link.flow_type)]?.["3"];
      if (typeof liveCost !== "number" || !Number.isFinite(liveCost) || liveCost <= 0 || !pricing.data.allowed_validities.includes(3)) {
        await settle(db, link, "needs_admin", "service_unavailable");
        return { claimed: true, rateLimited: false };
      }
      if (liveCost > Number(link.credit_cost) + 1e-9) {
        await settle(db, link, "needs_admin", "price_increased");
        return { claimed: true, rateLimited: false };
      }
      const credits = await fetchPixelverifCredits();
      if (credits.kind !== "ok") {
        if (credits.kind === "ambiguous" && credits.reason === "http_429") rateLimited = true;
        await settle(db, link, "needs_admin", "credits_unavailable");
        return { claimed: true, rateLimited };
      }
      if (credits.data.credits_remaining < liveCost) {
        await settle(db, link, "needs_admin", "insufficient_credits");
        return { claimed: true, rateLimited: false };
      }
    }

    if (Date.now() >= deadlineMs || !isPixelverifDispatchEnabled()) {
      await settle(db, link, "pending", "dispatch_deferred");
      return { claimed: true, rateLimited: false };
    }

    const input = await loadBuyerInput(db, link);
    if (!input) {
      await settle(db, link, "needs_admin", "input_missing");
      return { claimed: true, rateLimited: false };
    }

    const fenced = await db.execRun(
      `UPDATE pixelverif_order_links
       SET request_sent_at=COALESCE(request_sent_at,?),
           submit_seq=submit_seq+1,
           attempt_count=attempt_count+1,
           receipt_ciphertext=NULL, receipt_iv=NULL, receipt_http_status=NULL
       WHERE id=? AND lease_owner=? AND status='claimed' AND attempt_count=? AND attempt_count<3
         AND provider_order_id IS NULL
         AND datetime(lease_expires_at)>datetime('now')
         AND EXISTS(SELECT 1 FROM orders WHERE code=? AND items=? AND status='lunas' AND payment_status='paid' AND supplier_purchase_disabled=0)
         AND EXISTS(SELECT 1 FROM pixelverif_buyer_inputs WHERE order_code=? AND item_index=? AND purged_at IS NULL AND input_ciphertext IS NOT NULL)
         AND EXISTS(SELECT 1 FROM fulfillment_items f
           WHERE f.id=? AND f.pixelverif_link_id=? AND f.status NOT IN ('delivered','sending')
             AND f.wr_link_id IS NULL AND f.sk_link_id IS NULL AND f.tunvn_link_id IS NULL AND f.aivault_link_id IS NULL AND f.storebat_link_id IS NULL AND f.mirai_link_id IS NULL AND f.inventory_id IS NULL
             AND f.fulfillment_mode='manual'
             AND f.product_id=pixelverif_order_links.product_id AND f.variant_id=pixelverif_order_links.variant_id AND f.qty=1)
         AND EXISTS(SELECT 1 FROM product_variants v JOIN products p ON p.id=v.product_id
           WHERE v.id=? AND v.product_id=? AND v.pixelverif_flow_type=? AND v.pixelverif_validity=3 AND v.sku=?
             AND v.is_active=1 AND p.is_active=1 AND p.archived_at IS NULL
             AND v.fulfillment_mode='manual' AND p.source='manual' AND p.pixelverif_family IS NOT NULL
             AND v.wr_variant_id IS NULL AND v.sk_variant_id IS NULL AND v.tunvn_buff_quantity_b IS NULL AND v.aivault_service_id IS NULL AND v.storebat_product_id IS NULL AND v.mirai_package_code IS NULL
             AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL AND p.wr_auto_managed=0 AND p.sk_auto_managed=0
             AND p.tunvn_family IS NULL AND p.aivault_family IS NULL AND p.storebat_family IS NULL AND p.mirai_family IS NULL)`,
      new Date().toISOString(),
      id,
      owner,
      link.attempt_count,
      link.order_code,
      order.items,
      link.order_code,
      link.item_index,
      fulfillment.id,
      id,
      link.variant_id,
      link.product_id,
      link.flow_type,
      expectedSku,
    );
    if (!fenced.changes) {
      await settle(db, link, "needs_admin", "send_guard_changed");
      return { claimed: true, rateLimited: false };
    }
    link.attempt_count = Number(link.attempt_count) + 1;
    link.request_sent_at = String(link.request_sent_at ?? new Date().toISOString());
    sent = true;

    const response = await createPixelverifOrder(
      {
        email: input.pv_email,
        password: input.pv_password,
        totp_secret: input.pv_totp_secret,
        flow_type: link.flow_type as "normal" | "full",
        validity: 3,
      },
      String(link.idempotency_key),
    );
    if (response.status === 429) rateLimited = true;
    if (!(await saveReceipt(db, link, response))) return { claimed: true, rateLimited };
    if (!(await interpretCreate(db, link, response))) {
      await deferRetry(db, link, response.retryAfterSeconds, true);
    }
  } catch {
    // Fixed metadata only; credentials/provider bodies never enter logs/errors.
    if (sent || link.request_sent_at) {
      await deferRetry(db, link, undefined, sent).catch(() => {});
    } else {
      await settle(db, link, "needs_admin", "preflight_unavailable").catch(() => {});
    }
  }
  return { claimed: true, rateLimited };
}

export async function retryPixelverifOrder(db: DatabaseAccess, id: number): Promise<boolean> {
  if (!db.d1 || !isPixelverifDispatchEnabled() || !db.canSpend(30)) return false;
  const r = await db.execRun(
    `UPDATE pixelverif_order_links
     SET status='pending', last_error=NULL, next_attempt_at=datetime('now'), lease_owner=NULL, lease_expires_at=NULL
     WHERE id=? AND ${PIXELVERIF_RETRYABLE_SQL}`,
    id,
  );
  if (!r.changes) {
    // Re-poll only (never re-POST): one fresh GET; still nonterminal → back to admin.
    const repoll = await db.execRun(
      `UPDATE pixelverif_order_links
       SET status='processing', last_error=NULL, next_attempt_at=datetime('now'), lease_owner=NULL, lease_expires_at=NULL
       WHERE id=? AND ${PIXELVERIF_REPOLL_SQL}`,
      id,
    );
    if (!repoll.changes) return false;
  }
  await processLink(db, id);
  return true;
}

export async function processPixelverifOrders(
  db: DatabaseAccess = createDatabaseAccess(),
  options: { orderCode?: string; deadlineMs?: number; limit?: number } = {},
): Promise<number> {
  const deadlineMs = options.deadlineMs ?? Infinity;
  if (!db.d1 || !isPixelverifDispatchEnabled() || !db.canSpend(35) || Date.now() >= deadlineMs) return 0;
  const orphans = options.orderCode
    ? [{ code: options.orderCode }]
    : await db.queryAll(
        `SELECT o.code FROM orders o
         WHERE ${PAID_ORDER_SQL_ALIASED}
           AND EXISTS(
             SELECT 1 FROM json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j
             WHERE json_extract(j.value,'$.pixelverif_eligibility.version')=1
               AND json_extract(j.value,'$.pixelverif_eligibility.cost_usd')>0
               AND NOT EXISTS(
                 SELECT 1 FROM pixelverif_order_links l
                 WHERE l.order_code=o.code AND l.item_index=CAST(j.key AS INTEGER)
               )
           )
         ORDER BY o.id LIMIT ?`,
        PIXELVERIF_ORPHANS_PER_RUN,
      );
  for (const orphan of orphans) {
    if (Date.now() >= deadlineMs || !db.canSpend(30)) break;
    await createPixelverifOrderLinks(String(orphan.code), db);
  }
  if (!db.canSpend(25) || Date.now() >= deadlineMs) return 0;
  const maxLinks = Math.max(1, Math.min(PIXELVERIF_ORDERS_PER_RUN, Math.floor(options.limit ?? PIXELVERIF_ORDERS_PER_RUN)));
  const due = await db.queryAll(
    `SELECT id FROM pixelverif_order_links
     WHERE status IN ('pending','claimed','processing')
       AND datetime(next_attempt_at)<=datetime('now')
       AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))
       ${options.orderCode ? "AND order_code=?" : ""}
     ORDER BY next_attempt_at, id LIMIT ?`,
    ...(options.orderCode ? [options.orderCode] : []),
    maxLinks,
  );
  let processed = 0;
  for (const link of due) {
    if (processed > 0 && (Date.now() >= deadlineMs || !db.canSpend(25))) break;
    const res = await processLink(db, Number(link.id), deadlineMs);
    if (res.claimed) processed++;
    if (res.rateLimited) break;
  }
  return processed;
}
