import { queryFirst, execRun } from "@/lib/db";

export const AGENT_SCOPES = ["context:read", "articles:read", "articles:write", "articles:submit", "articles:schedule", "articles:publish", "media:write", "audit:read"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((v) => v.toString(16).padStart(2, "0")).join("");
}
export async function makeAgentToken() {
  const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
  const raw = `axv_${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return { raw, prefix: raw.slice(0, 12), hash: await sha256(raw) };
}
export async function requireAgent(req: Request, scope: AgentScope) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { error: "Bearer token diperlukan", status: 401 as const };
  const tokenHash = await sha256(auth.slice(7).trim());
  const row = await queryFirst("SELECT * FROM agent_tokens WHERE token_hash=? AND is_active=1", tokenHash);
  if (!row || (row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now())) return { error: "Token tidak aktif atau kedaluwarsa", status: 401 as const };
  let scopes: string[] = [];
  try { scopes = JSON.parse(String(row.scopes ?? "[]")); } catch { return { error: "Scope token tidak valid", status: 403 as const }; }
  if (!scopes.includes(scope)) return { error: `Scope ${scope} diperlukan`, status: 403 as const };
  await execRun("UPDATE agent_tokens SET last_used_at=? WHERE id=?", new Date().toISOString(), row.id);
  return { token: { id: Number(row.id), name: String(row.name), scopes } };
}
export async function audit(articleId: number | null, actorName: string, action: string, metadata: unknown) {
  await execRun("INSERT INTO article_audit_log (article_id,actor_type,actor_name,action,metadata,created_at) VALUES (?,?,?,?,?,?)", articleId, "agent", actorName, action, JSON.stringify(metadata), new Date().toISOString());
}
