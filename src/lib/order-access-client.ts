// Contacts, status sessions and original-checkout proofs persist in this tab.
// PINs stay in component state; purge traces left by older clients.

import { normalizeOrderAccessCode } from "@/lib/order-access-format";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

const WA_RE = /^(\+62|62|0)8\d{8,13}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Kontak checkout valid: email atau WA Indonesia. PIN/kode akses DITOLAK. */
export function isValidOrderContact(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const value = raw.trim();
  if (!value || value.length > 254) return false;
  if (normalizeOrderAccessCode(value)) return false;
  return value.includes("@")
    ? EMAIL_RE.test(value)
    : WA_RE.test(value.replace(/[\s-]/g, ""));
}

function normalizeContact(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  return isValidOrderContact(value) ? value : "";
}

// --- Sesi status p1.<expiry10>.<43sig> (read-only polling, bukan kredensial) ---
const sessionKey = (code: string) => `axvara-buyer-session:${code}`;
const tabSessions = new Map<string, string>();
const tabContacts = new Map<string, string>();
const tabCheckoutGrants = new Map<string, string>();
const checkoutGrantKey = (code: string) => `axvara-checkout-credential:${code}`;
const contactKey = (code: string) => `axvara-order-contact:${code}`;
const LEGACY_PIN_PREFIX = "axvara-order-access:";

/**
 * Privacy sweep: legacy `axvara-order-access:*` entries + old `#access=`
 * fragment dibersihkan di setiap pembacaan status baru (bukan hanya via
 * wrapper deprecated). Nilai PIN tidak pernah dibaca/dipakai form; fragment
 * hanya di-strip tanpa mengonsumsi nilainya.
 */
function purgeLegacyPinTraces(): void {
  if (typeof window === "undefined") return;
  try {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has("access")) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  } catch { /* URL tetap apa adanya. */ }
  try {
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(LEGACY_PIN_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* Storage opsional. */ }
}

purgeLegacyPinTraces();

function validSessionShape(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^p1\.(\d{10})\.[A-Za-z0-9_-]{43}$/.exec(value);
  return Boolean(match && Number(match[1]) > Math.floor(Date.now() / 1000));
}

function validCheckoutGrantShape(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^c1\.(\d{10})\.[A-Za-z0-9_-]{43}$/.exec(value);
  return Boolean(match && Number(match[1]) > Math.floor(Date.now() / 1000));
}

export function rememberCheckoutCredentialGrant(code: string, raw: unknown): boolean {
  if (typeof window === "undefined" || !validCheckoutGrantShape(raw)) return false;
  tabCheckoutGrants.set(code, raw);
  try { sessionStorage.setItem(checkoutGrantKey(code), raw); } catch { /* Keep proof in this tab when storage is blocked. */ }
  return true;
}

export function forgetCheckoutCredentialGrant(code: string): void {
  tabCheckoutGrants.delete(code);
  try { sessionStorage.removeItem(checkoutGrantKey(code)); } catch { /* Storage optional. */ }
}

export function readCheckoutCredentialGrant(code: string): string {
  let raw = tabCheckoutGrants.get(code) || "";
  try { raw ||= sessionStorage.getItem(checkoutGrantKey(code)) || ""; } catch { /* Use this tab's memory. */ }
  if (validCheckoutGrantShape(raw)) return raw;
  if (raw) forgetCheckoutCredentialGrant(code);
  return "";
}

export function rememberBuyerAccessSession(code: string, raw: unknown): boolean {
  if (typeof window === "undefined" || !validSessionShape(raw)) return false;
  tabSessions.set(code, raw);
  try { sessionStorage.setItem(sessionKey(code), raw); } catch { /* Tab memory tetap memegang sesi terverifikasi. */ }
  return true;
}

export function forgetBuyerAccessSession(code: string): void {
  tabSessions.delete(code);
  try { sessionStorage.removeItem(sessionKey(code)); } catch { /* Storage opsional. */ }
}

export function readBuyerAccessSession(code: string): string {
  purgeLegacyPinTraces();
  let raw = tabSessions.get(code) || "";
  try { raw ||= sessionStorage.getItem(sessionKey(code)) || ""; } catch { /* Tab memory jalan tanpa storage. */ }
  if (validSessionShape(raw)) return raw;
  if (raw) forgetBuyerAccessSession(code);
  return "";
}

/**
 * Sesi status dari kontak: POST lookup {code, contact} sekali, lalu pakai
 * sesi p1 untuk polling berikutnya tanpa menghabiskan jatah PIN. PIN tidak
 * pernah dipakai di sini; validasi PIN opsional hanya bila pemanggil
 * menyertakan access_code terpisah di body lookup-nya sendiri.
 */
export async function ensureBuyerAccessSession(code: string, contact: string): Promise<string> {
  const clean = normalizeContact(contact);
  const existing = readBuyerAccessSession(code);
  if (existing) return existing;
  if (!clean) throw new Error("Isi No. WA atau email checkout untuk melihat status.");
  const response = await fetchWithTimeout("/api/orders/lookup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, contact: clean }), cache: "no-store",
  }, 20_000);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !rememberBuyerAccessSession(code, body.buyer_access_session)) {
    throw new Error(body.error || "Status belum dapat dimuat. Coba lagi.");
  }
  return String(body.buyer_access_session);
}

// --- Kontak status (sessionStorage + fallback memori tab, tanpa PIN) ---
export function rememberOrderContact(code: string, raw: unknown): boolean {
  const clean = normalizeContact(raw);
  if (typeof window === "undefined" || !clean) return false;
  tabContacts.set(code, clean);
  try { sessionStorage.setItem(contactKey(code), clean); } catch { /* Memori tab tetap berlaku. */ }
  return true;
}

export function readOrderContact(code: string): string {
  purgeLegacyPinTraces();
  let raw = tabContacts.get(code) || "";
  try { raw ||= sessionStorage.getItem(contactKey(code)) || ""; } catch { /* Memori tab jalan tanpa storage. */ }
  return normalizeContact(raw);
}

export function forgetOrderContact(code: string): void {
  tabContacts.delete(code);
  try { sessionStorage.removeItem(contactKey(code)); } catch { /* Storage opsional. */ }
}

/**
 * Header verifikasi: x-order-contact bila kontak valid + header sesi status
 * p1. PIN/kode akses tidak pernah dijadikan kontak dan tidak pernah dikirim
 * sebagai header di sini; PIN hanya masuk body credentials/lookup pemanggil.
 */
export function orderAccessHeaders(code: string, contact = ""): Record<string, string> {
  const clean = normalizeContact(contact) || readOrderContact(code);
  const session = readBuyerAccessSession(code);
  return { ...(clean ? { "x-order-contact": clean } : {}), ...(session ? { "x-buyer-access-session": session } : {}) };
}

/**
 * Handoff checkout → halaman status: simpan sesi p1 privat, tanpa fragment
 * dan tanpa query. Argumen ketiga kompatibel (sesi string atau legacy yang
 * diabaikan); PIN/kode akses tidak pernah ditulis ke URL/storage.
 */
export function orderCheckoutPath(path: string, code: string, sessionOrLegacy?: unknown, maybeSession?: unknown): string {
  purgeLegacyPinTraces();
  const session = validSessionShape(maybeSession) ? maybeSession : validSessionShape(sessionOrLegacy) ? sessionOrLegacy : "";
  if (session) rememberBuyerAccessSession(code, session);
  return path;
}

// --- Wrapper kompatibel legacy: tidak pernah menyimpan/membaca PIN. ---
/** @deprecated PIN tidak disimpan di klien; selalu false (argumen diabaikan). */
export function rememberOrderAccessCode(..._ignored: unknown[]): boolean {
  return false;
}

/** @deprecated PIN hanya React state; selalu string kosong + purge jejak legacy. */
export function readOrderAccessCode(_code?: string): string {
  purgeLegacyPinTraces();
  return "";
}
