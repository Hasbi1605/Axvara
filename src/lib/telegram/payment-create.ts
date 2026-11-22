// src/lib/telegram/payment-create.ts — R2 durable quoted->creating->dispatch.
// Narrow module (no framework): CAS-claim the frozen payq1 into creating with
// a pre-generated orderCode + deterministic idempotency key, then dispatch
// ONCE via the actual core adapters. Never clears intent before a known
// recoverable invoice/order is terminal. Replays resume the SAME code/rail.
import { execRun, queryFirst, isD1Mode } from "@/lib/db";
import { isValidWaNumber } from "@/lib/order-contact";
import type { Payq1State } from "./payment-quote";

export type Payq1CreateEligibility =
  | { ok: true; methodId: string; kind: "gateway" | "crypto"; channel?: string; payCurrency?: string }
  | { ok: false; reason: string };

export function sanitizeCustomerName(firstName: string): string {
  const name = String(firstName ?? "").trim().slice(0, 100);
  return name || "Telegram buyer";
}

export function payq1IdempotencyKey(ownerUserId: string, nonce: string): string {
  return `tg:payq1:${ownerUserId}:${nonce}`;
}

export async function selectedSnapshotOf(state: Payq1State): Promise<Payq1CreateEligibility> {
  const sel = state.sel;
  if (!sel || typeof sel !== "string") return { ok: false, reason: "no_selection" };
  if (state.st !== "quoted" && state.st !== "contact" && state.st !== "creating") return { ok: false, reason: "bad_state" };
  const method = state.methods.find((m) => m.id === sel);
  if (!method) return { ok: false, reason: "unknown_selection" };
  // Telegram create NEVER accepts the gateway rail (owner 7 Nov 2026: bot =
  // QRIS + Crypto; Sekalipay gateway stays web-only). Frozen offers no longer
  // contain it; this is the fail-closed guard for tampered/legacy state.
  if (method.kind === "gateway" || method.id.startsWith("sekalipay_gateway:")) return { ok: false, reason: "method_unavailable" };
  if (method.kind === "crypto") {
    // Koin dikunci dari id beku `nowpayments:<ticker>`; pay_currency harus sama (bukan tebakan).
    const { cryptoTickerOfMethodId } = await import("@/lib/payments/crypto-preflight");
    const ticker = cryptoTickerOfMethodId(method.id);
    if (!ticker || method.pay_currency !== ticker) return { ok: false, reason: "unknown_selection" };
    return { ok: true, methodId: method.id, kind: "crypto", payCurrency: ticker };
  }
  return { ok: false, reason: "legacy_rail" };
}

/** Validate the FROZEN selected method is still configured/supported and
 * amount-eligible against CURRENT live options (never reinterpret index,
 * never recompute FX/fees). Gateway tariff drift => explicit requote.
 * NOTE: gateway methods carry the amount in their frozen snapshot
 * (channel+estimated fee/total for the CURRENT idrSubtotal); live
 * availability is checked by channel presence only when the amount differs
 * (listSekalipayMethods is amount-filtered). A live refetch happens ONLY on
 * tariff drift suspicion — same-tariff pgo taps never hit the provider. */
export async function validateFrozenSelectionLive(state: Payq1State): Promise<Payq1CreateEligibility> {
  const current = await selectedSnapshotOf(state);
  if (!current.ok) return current;
  const frozen = state.methods.find((m) => m.id === current.methodId)!;
  if (current.kind === "gateway" && frozen.gateway) {
    // Fast path: frozen snapshot already binds channel+fee+total for this
    // exact subtotal. Live check only confirms the channel still exists for
    // THIS amount — no tariff recompute.
    try {
      const { listSekalipayMethods } = await import("@/lib/payments/sekalipay-gateway");
      const live = await listSekalipayMethods(state.idrSubtotal);
      const match = live.find((m) => m.code === frozen.gateway!.channel);
      if (!match) return { ok: false, reason: "method_unavailable" };
      if (match.estimatedFee !== frozen.gateway.estimated_fee || match.estimatedTotal !== frozen.gateway.estimated_total) {
        return { ok: false, reason: "tariff_changed" };
      }
      return current;
    } catch {
      // Live provider failure at confirm time: fail closed (honest), never
      // proceed on an unverified rail.
      return { ok: false, reason: "validate_failed" };
    }
  }
  if (current.kind === "crypto") {
    // Crypto: frozen USD snapshot (cents/rational/effectiveAt/net) is
    // authoritative; live rotation never reprices. NAMUN koin yang dipilih harus
    // masih ada di snapshot pasar segar dan total beku masih memenuhi lantai +
    // minimum terbaru x 1,15; selain itu pilihan tidak dapat dibuat (pilih metode lain).
    // Preflight provider (minimum/flag) tetap dicek oleh dispatch.
    try {
      const { getCryptoMarketSnapshot } = await import("@/lib/payments/market-snapshot");
      const { isCryptoTotalStillPayable } = await import("@/lib/payments/crypto-preflight");
      const market = await getCryptoMarketSnapshot();
      const totalCents = Number((frozen as { total_cents?: unknown }).total_cents);
      if (!isCryptoTotalStillPayable(totalCents, current.payCurrency!, market.coins)) return { ok: false, reason: "method_unavailable" };
    } catch {
      return { ok: false, reason: "validate_failed" };
    }
    return current;
  }
  return { ok: false, reason: "legacy_rail" };
}

export type ClaimCreatingResult =
  | { ok: true; state: Payq1State; raw: string; orderCode: string; idempotencyKey: string; fresh: boolean }
  | { ok: false; reason: string; state?: Payq1State | null };

/** CAS-claim quoted/contact -> creating with a pre-generated orderCode +
 * deterministic idempotency key. Concurrent pgo taps: loser reads the SAME
 * creating state (same orderCode). Never clears intent here. */
export async function claimPayq1Creating(
  ownerUserId: string,
  currentRaw: string,
  current: Payq1State,
): Promise<ClaimCreatingResult> {
  if (current.st === "creating") {
    if (!current.orderCode || !current.idempotencyKey) return { ok: false, reason: "bad_creating", state: current };
    return { ok: true, state: current, raw: currentRaw, orderCode: current.orderCode, idempotencyKey: current.idempotencyKey, fresh: false };
  }
  if (!current.sel) return { ok: false, reason: "no_selection", state: current };
  const selected = await selectedSnapshotOf(current);
  if (!selected.ok) return { ok: false, reason: selected.reason, state: current };
  if (selected.kind !== "gateway" && selected.kind !== "crypto") return { ok: false, reason: "legacy_rail", state: current };
  // Quote-expiry at claim (third seam): even a validated quoted/contact row
  // may expire before the CAS fires — never claim a creating anchor on an
  // expired quote. No side effects, fail closed.
  {
    const { payq1Expired } = await import("./payment-quote");
    if (payq1Expired(current)) return { ok: false, reason: "quote_expired", state: current };
  }
  // Phone hard gate (server-side, not fixture-dependent): gateway creating
  // requires a captured phone in the CURRENT state; crypto never requires it.
  if (selected.kind === "gateway" && !current.contact?.phone) {
    return { ok: false, reason: "contact_missing", state: current };
  }
  if (selected.kind === "gateway" && current.contact?.phone && !isValidWaNumber(current.contact.phone)) {
    return { ok: false, reason: "contact_invalid", state: current };
  }
  const orderCode = (await import("@/lib/security")).generateOrderCode();
  const idempotencyKey = payq1IdempotencyKey(ownerUserId, current.nonce);
  const method = current.methods.find((m) => m.id === selected.methodId)!;
  const selectedSnapshot: Payq1State["selected"] = {
    id: method.id,
    kind: method.kind,
    channel: (method as { gateway?: { channel?: string } }).gateway?.channel,
    payCurrency: method.pay_currency,
    network: method.network,
    estimatedFee: (method as { gateway?: { estimated_fee?: number } }).gateway?.estimated_fee,
    estimatedTotal: (method as { gateway?: { estimated_total?: number } }).gateway?.estimated_total,
    usd: method.usd,
  };
  const next: Payq1State = { ...current, st: "creating", orderCode, idempotencyKey, selected: selectedSnapshot };
  const nextRaw = `payq1:${JSON.stringify(next)}`;
  if (!isD1Mode()) return { ok: false, reason: "store_unavailable", state: current };
  const claimed = await execRun(
    `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    nextRaw, ownerUserId, currentRaw,
  ).catch(() => ({ changes: 0 }));
  if ((claimed.changes ?? 0) < 1) {
    // Lost the CAS race: re-read; winner's creating state (if parseable) is
    // the resume anchor — same orderCode, never a second intent.
    const row = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, ownerUserId).catch(() => null);
    const raw = row?.pending_action == null ? null : String(row.pending_action);
    if (!raw) return { ok: false, reason: "race_no_state", state: null };
    const { parsePayq1State } = await import("./payment-quote");
    const winner = parsePayq1State(raw);
    if (!winner || winner.st !== "creating" || !winner.orderCode || !winner.idempotencyKey) {
      return { ok: false, reason: "race_retry", state: winner };
    }
    return { ok: true, state: winner, raw, orderCode: winner.orderCode, idempotencyKey: winner.idempotencyKey, fresh: false };
  }
  return { ok: true, state: next, raw: nextRaw, orderCode, idempotencyKey, fresh: true };
}

export type CartLineLike = {
  buyerFields?: { muse_invite_code?: string; pv_email?: string; pv_password?: string; pv_totp_secret?: string };
  buyerFieldKey?: "muse_invite_code" | null;
  pixelverifInput?: boolean;
  maxQty?: number | null;
  productId: number; variantId: number; qty: number; productName: string; variantLabel: string;
  price: number; basePrice: number; appliedTierMinQty?: number | null; stock: number; fulfillmentMode: string;
};

export type ResumeDecision =
  | { action: "resume_status"; orderCode: string; rail: string }
  | { action: "dispatch"; orderCode: string; idempotencyKey: string }
  | { action: "fail_closed"; reason: string };

/**
 * Definitive vs ambiguous untuk kegagalan create NOWPayments di jalur Telegram —
 * SAMA dengan web/Pedia (`src/app/api/orders/route.ts:553-570`,
 * `src/app/api/pedia/orders/route.ts:291-304`). AMBIGU (jangan pernah cancel /
 * POST ulang / buka order baru): TX klaim `initializing|pending` masih ada,
 * pesan `nowpayments_network_ambiguous`, atau `nowpayments_finalize_failed_manual_review`.
 * Selain itu DEFINITIF: provider tidak memberi charge yang bisa direkonsiliasi.
 * Baca TX gagal => fail-closed (dianggap ambigu).
 */
export async function isDefinitiveNowpaymentsFailure(orderCode: string, message: string): Promise<boolean> {
  const claimed = await queryFirst(
    `SELECT id FROM payment_transactions WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')`,
    orderCode,
  ).catch(() => ({ id: "unknown" }));
  if (claimed) return false;
  return message !== "nowpayments_network_ambiguous" && message !== "nowpayments_finalize_failed_manual_review";
}

/** Decide resume vs fresh dispatch for a durable creating state. Reads the
 * SAME orderCode anchor: order exists + TX exists (any status) => the create
 * path resumes via adapters (GET-only when ambiguous); order terminal =>
 * clear only then. Crash AFTER CAS BEFORE order => retry SAME code/key. */
export async function decideResumeFromCreating(state: Payq1State): Promise<ResumeDecision> {
  if (state.st !== "creating" || !state.orderCode) return { action: "fail_closed", reason: "not_creating" };
  const order = await queryFirst(
    `SELECT code, status, payment_status FROM orders WHERE code=?`, state.orderCode,
  ).catch(() => null);
  if (order) {
    if (order.status === "dibatalkan" || order.status === "kadaluarsa" || order.payment_status === "paid" || order.payment_status === "expired" || order.payment_status === "failed") {
      return { action: "resume_status", orderCode: state.orderCode, rail: String(state.selected?.id ?? "") };
    }
    const tx = await queryFirst(
      `SELECT provider, status FROM payment_transactions WHERE order_code=?`, state.orderCode,
    ).catch(() => null);
    if (tx) return { action: "resume_status", orderCode: state.orderCode, rail: String(state.selected?.id ?? "") };
    // Order exists, no TX yet (crash post-order pre-POST): dispatch once with
    // the SAME code/key — adapter owns claim-first semantics.
    return { action: "dispatch", orderCode: state.orderCode, idempotencyKey: state.idempotencyKey! };
  }
  // No order yet (crash after CAS before order): same code/key dispatch.
  return { action: "dispatch", orderCode: state.orderCode, idempotencyKey: state.idempotencyKey! };
}

/** Release a creating anchor that provably has NO financial effect yet (no
 * order for the saved code/key, no TX): exact-CAS clear so the buyer can
 * requote. Used when the quote window passed or the cart changed before the
 * order was ever created. Never releases once an order or TX exists. */
export async function releasePayq1CreatingIfNoOrder(
  ownerUserId: string, currentRaw: string, orderCode: string, idempotencyKey: string,
): Promise<boolean> {
  const order = await queryFirst(`SELECT code FROM orders WHERE code=? OR quote_id=?`, orderCode, idempotencyKey).catch(() => ({ code: "unknown" }));
  if (order) return false;
  const tx = await queryFirst(`SELECT order_code FROM payment_transactions WHERE order_code=?`, orderCode).catch(() => ({ order_code: "unknown" }));
  if (tx) return false;
  const cleared = await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    ownerUserId, currentRaw,
  ).catch(() => ({ changes: 0 }));
  return (cleared.changes ?? 0) > 0;
}

/** Clear payq1 ONLY after a durable TX exists (any status) or the order is
 * terminal — exact-CAS, never blind. */
export async function clearPayq1AfterDurableTx(ownerUserId: string, currentRaw: string, orderCode: string): Promise<boolean> {
  const tx = await queryFirst(`SELECT order_code FROM payment_transactions WHERE order_code=?`, orderCode).catch(() => null);
  const order = tx ? null : await queryFirst(`SELECT status, payment_status FROM orders WHERE code=?`, orderCode).catch(() => null);
  const terminal = order && (order.status === "dibatalkan" || order.status === "kadaluarsa"
    || order.payment_status === "paid" || order.payment_status === "expired" || order.payment_status === "failed");
  if (!tx && !terminal) return false;
  const cleared = await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    ownerUserId, currentRaw,
  ).catch(() => ({ changes: 0 }));
  return (cleared.changes ?? 0) > 0;
}

export function orderLinesFromSource(
  state: Payq1State,
  cartLines: CartLineLike[],
): { lines: { productId: number; variantId: number; qty: number; fulfillmentMode: string; stock: number }[]; items: unknown[]; variantSnapshot: string; subtotal: number; primaryVariantId: number } | null {
  const frozenTag = state.tag;
  void frozenTag;
  const subtotal = cartLines.reduce((sum, l) => sum + l.price * l.qty, 0);
  if (subtotal !== state.idrSubtotal) return null;
  const lines = cartLines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty, fulfillmentMode: l.fulfillmentMode, stock: l.stock }));
  const items = cartLines.map((l) => ({
    product_id: l.productId, variant_id: l.variantId,
    name: `${l.productName} — ${l.variantLabel}`, price: l.price,
    base_price: l.basePrice,
    ...(l.appliedTierMinQty != null ? { applied_tier_min_qty: l.appliedTierMinQty } : {}),
    buyer_field_key:l.buyerFieldKey ?? null,max_qty:l.maxQty ?? null,buyer_fields:l.buyerFields,
    qty: l.qty,
  }));
  const variantSnapshot = JSON.stringify({
    cart: true,
    product_name: cartLines.length === 1 ? cartLines[0].productName : `${cartLines.length} item keranjang`,
    label: cartLines.map((l) => `${l.variantLabel} ×${l.qty}`).join(", "),
    price: subtotal, qty: cartLines.reduce((s, l) => s + l.qty, 0),
    fulfillment_mode: cartLines.every((l) => l.fulfillmentMode === "manual") ? "manual" : "mixed",
    lines: cartLines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, label: l.variantLabel, price: l.price, base_price: l.basePrice, ...(l.appliedTierMinQty != null ? { applied_tier_min_qty: l.appliedTierMinQty } : {}), qty: l.qty, fulfillment_mode: l.fulfillmentMode })),
  });
  return { lines, items, variantSnapshot, subtotal, primaryVariantId: cartLines[0].variantId };
}
