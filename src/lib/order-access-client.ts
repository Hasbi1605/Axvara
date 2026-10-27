import { normalizeOrderAccessCode, formatOrderAccessCode } from "@/lib/order-access-format";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

const key = (code: string) => `axvara-order-access:${code}`;
const sessionKey = (code: string) => `axvara-buyer-session:${code}`;
const tabSessions = new Map<string, string>();
function validSessionShape(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^b1\.(\d{10})\.[A-Za-z0-9_-]{43}$/.exec(value);
  return Boolean(match && Number(match[1]) > Math.floor(Date.now() / 1000));
}
export function rememberBuyerAccessSession(code: string, raw: unknown): boolean {
  if (typeof window === "undefined" || !validSessionShape(raw)) return false;
  tabSessions.set(code, raw);
  try { sessionStorage.setItem(sessionKey(code), raw); } catch { /* Current tab still holds its verified session. */ }
  return true;
}
export function forgetBuyerAccessSession(code: string): void {
  tabSessions.delete(code);
  try { sessionStorage.removeItem(sessionKey(code)); } catch { /* Storage is optional. */ }
}
export function readBuyerAccessSession(code: string): string {
  let raw = tabSessions.get(code) || "";
  try { raw ||= sessionStorage.getItem(sessionKey(code)) || ""; } catch { /* Tab memory works without storage. */ }
  if (validSessionShape(raw)) return raw;
  forgetBuyerAccessSession(code);
  return "";
}

export async function ensureBuyerAccessSession(code: string, pin: string): Promise<void> {
  if (normalizeOrderAccessCode(pin).length !== 6 || readBuyerAccessSession(code)) return;
  const response = await fetchWithTimeout("/api/orders/lookup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, access_code: pin }), cache: "no-store",
  }, 20_000);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !rememberBuyerAccessSession(code, body.buyer_access_session)) {
    throw new Error(body.error || "PIN belum dapat diverifikasi. Coba lagi.");
  }
}
export function rememberOrderAccessCode(code: string, raw: unknown): boolean {
  const access = formatOrderAccessCode(String(raw || ""));
  if (!access) return false;
  try { sessionStorage.setItem(key(code), access); return true; } catch { return false; }
}

export function readOrderAccessCode(code: string): string {
  if (typeof window === "undefined") return "";
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const handoff = fragment.get("access");
  if (handoff && normalizeOrderAccessCode(handoff)) {
    const access = formatOrderAccessCode(handoff);
    rememberOrderAccessCode(code, access);
    // Fragment fallback never reaches HTTP logs/Referer and is consumed on the destination page.
    history.replaceState(history.state, "", window.location.pathname + window.location.search);
    return access;
  }
  try { return formatOrderAccessCode(sessionStorage.getItem(key(code)) || ""); } catch { return ""; }
}

export function orderAccessHeaders(code: string, provided = ""): Record<string, string> {
  const access = provided || readOrderAccessCode(code);
  const session = readBuyerAccessSession(code);
  return { ...(access ? { "x-order-access-code": access } : {}), ...(session ? { "x-buyer-access-session": session } : {}) };
}

export function orderCheckoutPath(path: string, code: string, raw: unknown, session?: unknown): string {
  rememberBuyerAccessSession(code, session);
  const access = formatOrderAccessCode(String(raw || ""));
  return !access || rememberOrderAccessCode(code, access) ? path : `${path}#access=${encodeURIComponent(access)}`;
}
