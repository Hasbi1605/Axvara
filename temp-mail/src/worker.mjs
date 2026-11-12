import PostalMime from "postal-mime";

export const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/;
// Mailboxes that must never become public temp inboxes (private forwarding rules etc.).
export const RESERVED_MAILBOXES = ["aws-root", "aws-billing", "aws-security", "kiro", "admin", "postmaster", "abuse", "security", "billing", "support", "root"];
const MAX_RAW_BYTES = 1024 * 1024;
const MAX_API_BODY_BYTES = 4096;
const MAX_BODY_CHARS = 100_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGES_PER_MAILBOX = 100;
// ponytail: show the newest 50; add cursor pagination if older retained mail needs browsing.
const LIST_LIMIT = 50;
const CLEANUP_BATCH = 500;
const WORDS = ["nova", "orbit", "pixel", "comet", "lunar", "solar", "astro", "vega", "lyra", "orion", "zenith", "nebula", "quasar", "cosmos", "aurora", "meteor"];

export function mailDomain(env) {
  return String(env?.MAIL_DOMAIN || "isturaiky.page").trim().toLowerCase().replace(/^@+/, "");
}
export function reservedSet(env) {
  const extra = String(env?.RESERVED_MAILBOXES || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...RESERVED_MAILBOXES, ...extra]);
}
export function isReserved(local, env) { return reservedSet(env).has(String(local || "").toLowerCase()); }

// API input: local part OR full address on the configured domain.
export function normalizeAddress(input, env) {
  if (typeof input !== "string") return null;
  const domain = mailDomain(env);
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("@")) {
    const parts = value.split("@");
    if (parts.length !== 2 || parts[1] !== domain) return null;
    value = parts[0];
  }
  return validLocal(value, env) ? `${value}@${domain}` : null;
}
function validLocal(value, env) {
  return value.length >= 3 && value.length <= 32 && LOCAL_PART_RE.test(value)
    && !value.includes("..") && !value.includes("+") && !isReserved(value, env);
}
// Envelope path: require a FULL recipient on the configured domain (no bare local).
export function normalizeEnvelopeRecipient(input, env) {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  const parts = value.split("@");
  if (parts.length !== 2 || parts[1] !== mailDomain(env)) return null;
  return validLocal(parts[0], env) ? value : null;
}
export function randomAddress(env) {
  // word + "-" + 12 hex chars (48 random bits): reserved names cannot collide
  // because every generated local part carries the suffix; collisions are
  // cryptographically negligible, not impossible.
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const word = WORDS[crypto.getRandomValues(new Uint8Array(1))[0] % WORDS.length];
  return `${word}-${hex}@${mailDomain(env)}`;
}

export async function htmlToText(html) {
  if (!html) return "";
  if (typeof HTMLRewriter === "undefined") {
    // Fallback outside workerd (Node unit tests only): strip script/style blocks, then tags.
    return String(html).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<a[^>]+href="([^"]+)"[^>]*>/gi, " $1 ").replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, MAX_BODY_CHARS);
  }
  let links = "";
  const rewriter = new HTMLRewriter()
    .on("script,style,noscript,iframe,svg", { element(e) { e.remove(); } })
    .on("img", { element(e) { e.remove(); } })
    .on("a", { element(e) { const h = e.getAttribute("href"); if (h && /^https?:\/\//i.test(h)) links += `\n${h}`; } })
    .on("br", { element(e) { e.after("\n"); } })
    .on("p,div,tr,li,h1,h2,h3,h4", { element(e) { e.after("\n"); } });
  const res = rewriter.transform(new Response(String(html), { headers: { "content-type": "text/html" } }));
  const text = (await res.text()).replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return (links && !text.includes(links.trim()) ? `${text}\n${links}` : text).slice(0, MAX_BODY_CHARS);
}
async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function parseEmail(rawBytes) {
  const parser = new PostalMime();
  const email = await parser.parse(rawBytes);
  let body = (email.text || "").trim();
  if (!body && email.html) body = await htmlToText(email.html);
  return {
    from: [email.from?.name, email.from?.address].filter(Boolean).join(" ").trim() || "Unknown sender",
    subject: (email.subject || "(no subject)").slice(0, 500),
    bodyText: body.slice(0, MAX_BODY_CHARS),
  };
}

function securityHeaders() {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY",
    "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...securityHeaders() } });
}
const fail = (status, error) => json({ error }, status);

// Returns true/false, or throws when the native limiter itself errors (-> 503).
export async function checkRateLimit(env, request) {
  const key = request.headers.get("cf-connecting-ip") || "unknown";
  if (env?.API_RATE_LIMITER?.limit) {
    const { success } = await env.API_RATE_LIMITER.limit({ key });
    return success;
  }
  if (typeof env?.__rateLimitCheck === "function") return env.__rateLimitCheck(key);
  throw new Error("rate_limiter_unavailable");
}

// Read at most `limit` bytes of the request body; {tooLarge:true} past the cap.
export async function readBoundedBody(request, limit) {
  if (!request.body) return { bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); return { tooLarge: true }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0; for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  return { bytes };
}

async function requireDb(env) { if (!env?.DB?.prepare) throw new Error("db_unavailable"); return env.DB; }

async function handleApi(request, env, url) {
  let allowed;
  try { allowed = await checkRateLimit(env, request); } catch { return fail(503, "rate_limiter_unavailable"); }
  if (!allowed) return fail(429, "rate_limited");
  let db;
  try { db = await requireDb(env); } catch { return fail(503, "storage_unavailable"); }

  const routes = [
    { re: /^\/api\/config$/, verb: "GET" },
    { re: /^\/api\/address\/random$/, verb: "POST" },
    { re: /^\/api\/address\/open$/, verb: "POST" },
    { re: /^\/api\/inbox\/([^/]+)\/messages$/, verb: "GET" },
    { re: /^\/api\/inbox\/([^/]+)\/messages\/(\d+)$/, verb: "GET" },
  ];
  const route = routes.find((r) => r.re.test(url.pathname));
  if (!route) return fail(404, "not_found");
  if (request.method !== route.verb) return fail(405, "method_not_allowed");
  const match = url.pathname.match(route.re);
  try {
    if (url.pathname === "/api/config") return json({ domain: mailDomain(env), retentionHours: 24 });
    if (url.pathname === "/api/address/random") return json({ address: randomAddress(env) });
    if (url.pathname === "/api/address/open") {
      if (Number(request.headers.get("content-length") || 0) > MAX_API_BODY_BYTES) return fail(413, "body_too_large");
      const { bytes, tooLarge } = await readBoundedBody(request, MAX_API_BODY_BYTES);
      if (tooLarge) return fail(413, "body_too_large");
      let body;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { return fail(400, "invalid_json"); }
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.address !== "string") return fail(400, "invalid_address");
      const address = normalizeAddress(body.address, env);
      if (!address) return fail(400, "invalid_address");
      return json({ address });
    }
    let addressRaw;
    try { addressRaw = decodeURIComponent(match[1]); } catch { return fail(400, "invalid_address"); }
    const address = normalizeAddress(addressRaw, env);
    if (!address) return fail(400, "invalid_address");
    if (match[2] === undefined) {
      const { results } = await db.prepare(
        "SELECT id, sender, subject, received_at, expires_at, substr(body_text,1,240) AS preview FROM temp_mail_messages WHERE recipient=? AND expires_at>? ORDER BY received_at DESC, id DESC LIMIT ?"
      ).bind(address, Date.now(), LIST_LIMIT).all();
      return json({ address, messages: results || [] });
    }
    const row = await db.prepare(
      "SELECT id, recipient, sender, subject, body_text, received_at, expires_at FROM temp_mail_messages WHERE recipient=? AND id=? AND expires_at>?"
    ).bind(address, Number(match[2]), Date.now()).first();
    if (!row) return fail(404, "not_found");
    return json({ message: row });
  } catch { return fail(503, "storage_unavailable"); }
}

async function cleanup(db, now = Date.now()) {
  await db.prepare(
    "DELETE FROM temp_mail_messages WHERE id IN (SELECT id FROM temp_mail_messages WHERE expires_at<=? ORDER BY expires_at ASC LIMIT ?)"
  ).bind(now, CLEANUP_BATCH).run();
}

// Atomic cap: insert + trim in ONE D1 batch so concurrent inserts cannot be
// acknowledged while the mailbox sits above the cap. Oldest = received_at,id ASC.
function ingestBatch(db, { address, sender, subject, bodyText, now, dedupe }) {
  return db.batch([
    db.prepare("INSERT OR IGNORE INTO temp_mail_messages (recipient, sender, subject, body_text, received_at, expires_at, dedupe_hash) VALUES (?,?,?,?,?,?,?)")
      .bind(address, sender, subject, bodyText, now, now + RETENTION_MS, dedupe),
    db.prepare("DELETE FROM temp_mail_messages WHERE recipient=? AND id NOT IN (SELECT id FROM temp_mail_messages WHERE recipient=? ORDER BY received_at DESC, id DESC LIMIT ?)")
      .bind(address, address, MAX_MESSAGES_PER_MAILBOX),
  ]);
}

// Read the raw stream with a hard cap; never buffers more than MAX_RAW_BYTES.
async function readRawBounded(message) {
  if (typeof message.rawSize === "number" && message.rawSize > MAX_RAW_BYTES) return null;
  const reader = message.raw.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RAW_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0; for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  return bytes;
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "method_not_allowed");
    if (env?.ASSETS?.fetch) {
      const res = await env.ASSETS.fetch(request);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(securityHeaders())) headers.set(k, v);
      headers.set("cache-control", url.pathname === "/" || url.pathname.endsWith(".html") ? "no-store" : "public, max-age=3600");
      return new Response(res.body, { status: res.status, headers });
    }
    return new Response("AXVARA Temp Mail", { headers: { "content-type": "text/plain", ...securityHeaders() } });
  },

  async email(message, env) {
    const address = normalizeEnvelopeRecipient(message.to, env);
    if (!address) { message.setReject("Invalid recipient"); return; }
    // Cheap pre-check BEFORE touching the stream, then a hard streamed bound
    // (rawSize may be missing or wrong, so the stream is always enforced).
    if (typeof message.rawSize === "number" && message.rawSize > MAX_RAW_BYTES) { message.setReject("Message too large"); return; }
    const raw = await readRawBounded(message);
    if (!raw) { message.setReject("Message too large"); return; }
    // Storage/parse failures: throw so the runtime marks delivery as failed.
    // setReject would be a PERMANENT (5xx) rejection — the sender is told the
    // address refused the mail and will NOT retry. Throwing never silently
    // acknowledges: nothing is stored and the handler does not complete OK.
    const db = await requireDb(env);
    const now = Date.now();
    const parsed = await parseEmail(raw);
    const dedupe = await sha256Hex(raw);
    const sender = String(message.from || parsed.from).slice(0, 500) || parsed.from;
    await cleanup(db, now);
    await ingestBatch(db, { address, sender, subject: parsed.subject, bodyText: parsed.bodyText, now, dedupe });
  },

  async scheduled(event, env, ctx) {
    const db = await requireDb(env);
    ctx.waitUntil(cleanup(db, Date.now()));
  },
};
export default worker;
