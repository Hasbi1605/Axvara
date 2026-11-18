// src/lib/telegram/payment-quote.ts — TG R1 frozen owned method offer.
// Plain functional module (no classes/factories). Persists ONE frozen offer
// in owned telegram_users.pending_action as tagged JSON `payq1:{...}`.
// R1 ONLY: freeze + offer + selection. No order creation, no consent,
// no status/provider writes. Financials come verbatim from
// buildMethodOptions; this module never reprices or invents fees/FX.
import { execRun, isD1Mode, queryFirst } from "@/lib/db";
import { buildMethodOptions } from "@/lib/payments/method-options";
import { isCanonicalMethodOption } from "@/lib/auth";
import type { Locale } from "@/lib/i18n/locale";
import { trackFunnelEvent } from "@/lib/analytics/funnel";

export const PAYQ1_TTL_SEC = 600;
// Katalog crypto multi-koin (hingga 28 koin, tiap koin membawa blok kurs bertanda) membuat
// snapshot beku jauh lebih besar dari era 1 koin: batas byte dinaikkan; indeks pm: tetap 2 digit (<=99).
export const PAYQ1_MAX_BYTES = 64 * 1024;
export const PAYQ1_MAX_METHODS = 96;
export const PAYQ1_CALLBACK_MAX_BYTES = 64;
export const PAYQ1_GCONSENT_MAX_BYTES = 64;

export type Payq1CartSource =
  | { kind: "single"; productId: number; variantId: number; qty: number }
  | { kind: "cart" };

export type Payq1State = {
  v: 1;
  nonce: string;
  exp: number;
  tag: string;
  locale: Locale;
  idrSubtotal: number;
  source: Payq1CartSource;
  // Exact frozen financial snapshot: verbatim MethodOption objects from
  // buildMethodOptions at freeze time (gateway estimated fee/total + crypto
  // USD snapshot included). Never repriced in place.
  methods: { id: string; kind?: string; label?: string; sublabel?: string | null; currency?: string; amount_text?: string; pay_currency?: string; network?: string; fee_payer?: string; fixed_rate?: boolean; group?: string; base_cents?: number; surcharge_cents?: number; total_cents?: number; surcharge_bps?: number; usd?: Record<string, unknown>; gateway?: { channel: string; estimated_fee: number; estimated_total: number; idr_subtotal: number } }[];
  sel: string | null;
  contact: { email: string | null; phone: string | null };
  st: "quoted" | "contact" | "creating";
  /** Durable creating anchor (only when st === "creating"). */
  orderCode?: string;
  idempotencyKey?: string;
  /** Canonical selected snapshot (only when st === "creating"). */
  selected?: { id: string; kind?: string; channel?: string; payCurrency?: string; network?: string; estimatedFee?: number; estimatedTotal?: number; usd?: Record<string, unknown> };
};

export type Payq1LineIdentity = Payq1CartSource;

export type FreezeInput = {
  fromUserId: string;
  locale: Locale;
  tag: string;
  identity: Payq1LineIdentity;
  idrSubtotal: number;
  contactEmail: string | null;
};

export type Payq1FreezeResult =
  | { ok: true; state: Payq1State; raw: string }
  | { ok: false; reason: "namespace_busy" | "no_methods" | "overflow" | "store_unavailable" };

function identityLabel(identity: Payq1LineIdentity): string {
  return identity.kind === "cart"
    ? "cart"
    : `single:${identity.productId}:${identity.variantId}:${identity.qty}`;
}

export function payq1CartLabel(state: Pick<Payq1State, "source">): string {
  return identityLabel(state.source);
}

function randomNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function payq1Callback(nonce: string, index: number): string {
  return `pm:${nonce}:${index}`;
}

export function payq1GoCallback(nonce: string): string {
  return `pgo:${nonce}`;
}

/** Buka (pmc) / kembali dari (pmb) sub-menu koin crypto; nonce-bound, <=64 byte. */
export function payq1CryptoMenuCallback(nonce: string): string {
  return `pmc:${nonce}`;
}
export function payq1CryptoBackCallback(nonce: string): string {
  return `pmb:${nonce}`;
}
export function parsePayq1CryptoCallback(data: string): { kind: "open" | "back"; nonce: string } | null {
  const match = /^pm([cb]):([0-9a-f]{16})$/.exec(data);
  if (!match) return null;
  if (new TextEncoder().encode(data).length > PAYQ1_CALLBACK_MAX_BYTES) return null;
  return { kind: match[1] === "c" ? "open" : "back", nonce: match[2] };
}

export function parsePayq1GoCallback(data: string): { nonce: string } | null {
  const match = /^pgo:([0-9a-f]{16})$/.exec(data);
  if (!match) return null;
  if (new TextEncoder().encode(data).length > PAYQ1_CALLBACK_MAX_BYTES) return null;
  return { nonce: match[1] };
}

export function parsePayq1Callback(data: string): { nonce: string; index: number } | null {
  const match = /^pm:([0-9a-f]{16}):(\d{1,2})$/.exec(data);
  if (!match) return null;
  if (new TextEncoder().encode(data).length > PAYQ1_CALLBACK_MAX_BYTES) return null;
  return { nonce: match[1], index: Number(match[2]) };
}

/** Validate raw pending_action as OUR frozen offer (unknown/corrupt => null).
 * Strict: byte bound BEFORE JSON.parse, method count, entry shape, financial
 * policy via canonical validator, sel membership, cart/source regex, st set.
 * Malformed creating/unknown can never be mistaken for a quoted offer. */
export function parsePayq1State(raw: unknown): Payq1State | null {
  if (typeof raw !== "string" || !raw.startsWith("payq1:")) return null;
  if (new TextEncoder().encode(raw).length > PAYQ1_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice("payq1:".length));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const v = parsed as Record<string, unknown>;
  if (v.v !== 1 || typeof v.nonce !== "string" || !/^[0-9a-f]{16}$/.test(v.nonce)) return null;
  if (typeof v.exp !== "number" || !Number.isSafeInteger(v.exp)) return null;
  if (typeof v.tag !== "string" || !/^[0-9a-f]{12}$/.test(v.tag)) return null;
  if (v.locale !== "id" && v.locale !== "en") return null;
  if (!Number.isSafeInteger(v.idrSubtotal) || (v.idrSubtotal as number) <= 0) return null;
  const source = v.source as { kind?: unknown; productId?: unknown; variantId?: unknown; qty?: unknown } | null;
  if (!source || typeof source !== "object") return null;
  if (source.kind === "single") {
    if (!Number.isSafeInteger(source.productId) || (source.productId as number) <= 0) return null;
    if (!Number.isSafeInteger(source.variantId) || (source.variantId as number) <= 0) return null;
    if (!Number.isSafeInteger(source.qty) || (source.qty as number) <= 0) return null;
  } else if (source.kind !== "cart") {
    return null;
  }
  if (!Array.isArray(v.methods)) return null;
  if (v.methods.length > PAYQ1_MAX_METHODS) return null;
  const idrSubtotal = v.idrSubtotal as number;
  const ids = new Set<string>();
  for (const method of v.methods) {
    if (!method || typeof method !== "object") return null;
    if (!isCanonicalMethodOption(method, idrSubtotal)) return null;
    const id = String((method as { id?: unknown }).id ?? "");
    if (!id || ids.has(id)) return null;
    ids.add(id);
  }
  // Backward compat: legacy R1 rows without locale/subtotal/source are
  // rejected here (strict); callers requote honestly.
  if (typeof v.st !== "string" || !["quoted", "contact", "creating"].includes(v.st)) return null;
  if (v.sel !== null && typeof v.sel !== "string") return null;
  if (v.sel !== null && !ids.has(v.sel)) return null;
  const contact = v.contact as { email?: unknown; phone?: unknown } | null;
  if (!contact || (contact.email !== null && typeof contact.email !== "string")) return null;
  if (contact.phone !== null && typeof contact.phone !== "string") return null;
  if (contact.phone !== null && !/^\+?[0-9]{8,20}$/.test(contact.phone)) return null;
  if (v.st === "creating") {
    if (typeof v.orderCode !== "string" || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(v.orderCode)) return null;
    if (typeof v.idempotencyKey !== "string" || !v.idempotencyKey || (v.idempotencyKey as string).length > 128) return null;
    if (!v.selected || typeof v.selected !== "object") return null;
    if (typeof (v.selected as { id?: unknown }).id !== "string" || !ids.has(String((v.selected as { id?: unknown }).id))) return null;
  }
  return v as unknown as Payq1State;
}

/** Parse gconsent:<CODE>:<total>:<tag16> (<=64B, constant-time verify by caller). */
export function parsePayq1ConsentCallback(data: string): { orderCode: string; total: number; tag: string } | null {
  if (new TextEncoder().encode(data).length > PAYQ1_GCONSENT_MAX_BYTES) return null;
  const match = /^gconsent:([A-Z0-9-]{1,32}):(\d{1,10}):([0-9a-f]{16})$/.exec(data);
  if (!match) return null;
  const total = Number(match[2]);
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  return { orderCode: match[1].toUpperCase(), total, tag: match[3] };
}

export function payq1Expired(state: Payq1State, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return nowSec >= state.exp;
}

export async function readPayq1State(userId: string): Promise<{ raw: string; state: Payq1State | null } | null> {
  if (!isD1Mode()) return null;
  const row = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, userId).catch(() => null);
  if (!row || row.pending_action == null) return null;
  const raw = String(row.pending_action);
  return { raw, state: parsePayq1State(raw) };
}

function encodePayq1(state: Payq1State): string {
  return `payq1:${JSON.stringify(state)}`;
}

/**
 * Freeze one owned method offer. Writes ONLY when pending_action is NULL or
 * an existing parseable quoted payq1 (CAS on exact old raw). NEVER overwrites
 * email/qty/search/wa/onboarding/unknown/creating states.
 */
export async function freezePayq1(input: FreezeInput): Promise<Payq1FreezeResult> {
  if (input.locale !== "id" && input.locale !== "en") return { ok: false, reason: "no_methods" };
  if (!Number.isSafeInteger(input.idrSubtotal) || input.idrSubtotal <= 0) return { ok: false, reason: "no_methods" };
  if (input.contactEmail !== null && (typeof input.contactEmail !== "string" || input.contactEmail.length > 100
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail))) return { ok: false, reason: "no_methods" };
  // Owner 7 Nov 2026: bot hanya QRIS + Crypto; gateway Sekalipay tetap di web.
  const methods = await buildMethodOptions(input.idrSubtotal, { includeGateway: false });
  if (!methods.length) return { ok: false, reason: "no_methods" };
  if (methods.length > PAYQ1_MAX_METHODS) return { ok: false, reason: "overflow" };
  const nowSec = Math.floor(Date.now() / 1000);
  const state: Payq1State = {
    v: 1,
    nonce: randomNonce(),
    exp: nowSec + PAYQ1_TTL_SEC,
    tag: input.tag,
    locale: input.locale,
    idrSubtotal: input.idrSubtotal,
    source: input.identity,
    methods,
    sel: null,
    contact: { email: input.contactEmail, phone: null },
    st: "quoted",
  };
  const encoded = encodePayq1(state);
  if (new TextEncoder().encode(encoded).length > PAYQ1_MAX_BYTES) return { ok: false, reason: "overflow" };
  if (!isD1Mode()) return { ok: false, reason: "store_unavailable" };
  const row = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, input.fromUserId).catch(() => null);
  if (!row) return { ok: false, reason: "store_unavailable" };
  const current = row.pending_action == null ? null : String(row.pending_action);
  if (current !== null) {
    const existing = parsePayq1State(current);
    // Namespace guard: own prior quoted payq1 may be replaced; every other
    // namespace (email_for:/email_confirm:/emailcart:/cart_confirm:,
    // qty_for:, search:, wa_after_paid:, onboarding:, creating, unknown) is
    // protected — render must defer, never mutate. Own quoted-invalid rows
    // (unparseable) are NOT overwritten here either: they requote only after
    // an explicit cancel clears them (fail-closed, no silent repair).
    if (!existing || existing.st !== "quoted") return { ok: false, reason: "namespace_busy" };
  }
  const claimed = current === null
    ? await execRun(
      `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action IS NULL`,
      encoded, input.fromUserId,
    ).catch(() => ({ changes: 0 }))
    : await execRun(
      `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
      encoded, input.fromUserId, current,
    ).catch(() => ({ changes: 0 }));
  if ((claimed.changes ?? 0) < 1) return { ok: false, reason: "namespace_busy" };
  trackFunnelEvent({ stage: "quote", channel: "telegram", locale: input.locale, subtotal: input.idrSubtotal,
    ...(input.identity.kind === "single" ? { productId: input.identity.productId, variantId: input.identity.variantId, quantity: input.identity.qty } : {}) });
  return { ok: true, state, raw: encoded };
}

/** Quote the CURRENT live options then freeze; honest fail-closed on empty/overflow/busy. */
export type QuoteStatus =
  | { status: "frozen"; state: Payq1State; raw: string }
  | { status: "deferred"; reason: "namespace_busy" }
  | { status: "failed"; reason: "no_methods" | "overflow" | "store_unavailable" };
