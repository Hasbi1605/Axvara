// Optional tab-session convenience. No buyer contact is placed in a URL.
const key = (code: string) => `axp-contact:${code}`;
export function rememberPediaContact(code: string, contact: string) {
  try { sessionStorage.setItem(key(code), JSON.stringify({ contact, until: Date.now() + 86_400_000 })); } catch { /* User can verify again. */ }
}
export function readPediaContact(code: string): string {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(code)) || "null");
    if (value && typeof value.contact === "string" && value.until > Date.now()) return value.contact;
    sessionStorage.removeItem(key(code));
  } catch { /* Storage is optional. */ }
  return "";
}
