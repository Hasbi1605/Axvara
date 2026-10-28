// Optional tab-session convenience. No buyer contact is placed in a URL.
import { parseBuyerContact } from "@/lib/order-contact";

const key = (code: string) => `axp-contact:${code}`;
export function rememberPediaContact(code: string, contact: string) {
  if (!parseBuyerContact(contact)) {
    try { sessionStorage.removeItem(key(code)); } catch { /* Storage is optional. */ }
    return;
  }
  try { sessionStorage.setItem(key(code), JSON.stringify({ contact, until: Date.now() + 86_400_000 })); } catch { /* User can verify again. */ }
}
export function readPediaContact(code: string): string {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(code)) || "null");
    if (value && typeof value.contact === "string" && parseBuyerContact(value.contact) && value.until > Date.now()) return value.contact;
    sessionStorage.removeItem(key(code));
  } catch { /* Storage is optional. */ }
  return "";
}
