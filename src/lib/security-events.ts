import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";

export type SecurityEvent = "login_failed" | "login_succeeded" | "login_limited" | "admin_authorized";
const auditedRequests = new WeakSet<Request>();

export async function securitySubject(domain: string, subject: string): Promise<string> {
  const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("security_hash_unavailable");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret || "dev-only-security-events"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${domain}:v1:${subject}`));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
}

// Only fixed route labels reach storage. No query strings, IDs, contacts or secrets.
export function adminAuditRoute(request: Request): string | null {
  if (auditedRequests.has(request)) return null;
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/")) return null;
  const read = request.method === "GET";
  if (read && !/^\/api\/(products\/\d+$|admin\/(fulfillment|proofs|bukti|warung\/credentials|agent-tokens)(\/|$)|orders\/[^/]+\/credentials$)/.test(path)) return null;
  if (read) {
    auditedRequests.add(request);
    return path.startsWith("/api/products/") ? "/api/products/:id" : "/api/admin/sensitive-read";
  }
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return null;
  // Route family is sufficient for authorization telemetry and cannot include buyer input.
  const family = path.split("/")[2];
  if (!["admin", "products", "articles", "categories", "banners", "payment-methods", "store-settings", "orders"].includes(family)) return null;
  auditedRequests.add(request);
  return `/api/${family}/*`;
}

export async function recordSecurityEvent(event: SecurityEvent, subjectHash: string, route: string,
  method: string, db: DatabaseAccess = createDatabaseAccess()): Promise<void> {
  const entry = { event, subject_hash: subjectHash, route, method };
  if (db.d1) {
    try {
      await db.execRun("INSERT INTO security_events(event,subject_hash,route,method) VALUES(?,?,?,?)", event, subjectHash, route, method);
      return;
    } catch { /* Retain sanitized telemetry when the audit store is unavailable. */ }
  }
  console.info("[security]", JSON.stringify(entry));
}
