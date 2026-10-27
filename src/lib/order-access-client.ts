import { normalizeOrderAccessCode, formatOrderAccessCode } from "@/lib/order-access-format";

const key = (code: string) => `axvara-order-access:${code}`;
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
  return access ? { "x-order-access-code": access } : {};
}

export function orderCheckoutPath(path: string, code: string, raw: unknown): string {
  const access = formatOrderAccessCode(String(raw || ""));
  return !access || rememberOrderAccessCode(code, access) ? path : `${path}#access=${encodeURIComponent(access)}`;
}
