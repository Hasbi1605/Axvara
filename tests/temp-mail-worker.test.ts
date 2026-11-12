import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type WorkerEnv = { MAIL_DOMAIN: string; DB?: D1Stub; __rateLimitCheck?: (key: string) => boolean };
// Parent removed the implicit in-memory fallback: a missing native limiter now
// throws -> 503. Local tests inject the hook explicitly (tests only, fail-closed in prod).
const allowAll = () => true;
interface D1PreparedStub {
  bind(...params: unknown[]): D1PreparedStub;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
interface D1Stub {
  prepare(sql: string): D1PreparedStub;
  batch(stmts: D1PreparedStub[]): Promise<unknown>;
}
interface TempMailWorker {
  fetch(request: Request, env: WorkerEnv, ctx: unknown): Promise<Response>;
  email(message: unknown, env: WorkerEnv, ctx: unknown): Promise<void>;
  scheduled(event: unknown, env: WorkerEnv, ctx: unknown): Promise<void>;
}
const asWorker = (v: unknown): TempMailWorker => v as TempMailWorker;
type MessageRow = { id: number; sender: string; subject: string; body_text: string; received_at: number; expires_at: number };
type ListBody = { address: string; messages: MessageRow[] };
type DetailBody = { message: MessageRow };

let ENV: WorkerEnv = { MAIL_DOMAIN: "isturaiky.page", __rateLimitCheck: allowAll };
let mf: Miniflare; let db: D1Stub;
const enc = (s: string) => new TextEncoder().encode(s);

function mime(fields: { from?: string; to: string; subject?: string; headers?: string; body: string; cte?: string; ctype?: string }) {
  return [
    `From: ${fields.from || "Sender <sender@example.com>"}`, `To: ${fields.to}`,
    `Subject: ${fields.subject || "Hello"}`, "MIME-Version: 1.0",
    `Content-Type: ${fields.ctype || 'text/plain; charset="utf-8"'}`,
    ...(fields.cte ? [`Content-Transfer-Encoding: ${fields.cte}`] : []),
    ...(fields.headers ? [fields.headers] : []), "", fields.body, "",
  ].join("\r\n");
}
class TestEmailMessage {
  raw: ReadableStream; from: string; to: string; rejected = ""; forwarded: string[] = []; rawSize?: number;
  constructor(from: string, to: string, raw: Uint8Array | Uint8Array[], opts: { rawSize?: number } = {}) {
    this.from = from; this.to = to;
    const chunks = Array.isArray(raw) ? raw : [raw];
    this.rawSize = opts.rawSize;
    this.raw = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); } });
  }
  setReject(r: string) { this.rejected = r; }
  async forward(to: string) { this.forwarded.push(to); return { outcome: "forwarded" }; }
  async reply() { throw new Error("not supported in tests"); }
}
let worker: TempMailWorker;
// Ingest through the real workerd runtime (native HTMLRewriter present).
async function dispatchEmailWorkerd(to: string, raw: Uint8Array) {
  const b64 = Buffer.from(raw).toString("base64");
  const r = await mf.dispatchFetch("https://mail.axvara.tech/__email", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, rawB64: b64 }),
  });
  return r.json() as Promise<{ rejected: string; thrown: string; htmlRewriter: string }>;
}
type EmailOutcome = { outcome: "accepted" | "rejected" | "failed"; reason: string; thrown: unknown; message: TestEmailMessage };
async function dispatchEmail(to: string, raw: Uint8Array | Uint8Array[], from = "sender@example.com", opts: { rawSize?: number } = {}): Promise<EmailOutcome> {
  const msg = new TestEmailMessage(from, to, raw, opts);
  let thrown: unknown = null;
  try { await worker.email(msg, ENV, { waitUntil: (p: Promise<unknown>) => p, passThroughOnException() {} }); }
  catch (e) { thrown = e; }
  return { outcome: msg.rejected ? "rejected" : thrown ? "failed" : "accepted", reason: msg.rejected, thrown, message: msg };
}
type FetchJsonResult = { status: number; headers: { get(name: string): string | null }; body: unknown };
async function fetchJson(path: string, init?: RequestInit): Promise<FetchJsonResult> {
  const reqInit = init as Parameters<Miniflare["dispatchFetch"]>[1];
  const r = await mf.dispatchFetch(`https://mail.axvara.tech${path}`, reqInit);
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
}
const listBody = async (path: string): Promise<ListBody> => (await fetchJson(path)).body as ListBody;

beforeAll(async () => {
  const inner = await build({
    entryPoints: ["temp-mail/src/worker.mjs"], bundle: true, write: false,
    format: "esm", platform: "neutral", target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:*"],
  });
  // Wrapper runs INSIDE workerd: it exposes a test-only /__email endpoint so
  // ingestion executes with the native HTMLRewriter, then delegates to the
  // real Worker's fetch/email/scheduled handlers.
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "js",
      contents: `
        import realWorker from "./temp-mail-entry.mjs";
        class Msg {
          constructor(to, raw, rawSize) { this.to = to; this.from = "sender@example.com"; this.rawSize = rawSize;
            const bytes = new Uint8Array(raw); this.rejected = "";
            this.raw = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }); }
          setReject(r) { this.rejected = r; }
          async forward() {} async reply() { throw new Error("no"); }
        }
        export default {
          async fetch(req, env, ctx) {
            const u = new URL(req.url);
            if (u.pathname === "/__email") {
              const { to, rawB64 } = await req.json();
              const bin = atob(rawB64); const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const msg = new Msg(to, bytes);
              let thrown = "";
              try { await realWorker.email(msg, env, ctx); } catch (e) { thrown = String(e && e.message || e); }
              return Response.json({ rejected: msg.rejected, thrown, htmlRewriter: typeof HTMLRewriter });
            }
            // Test-only hook injection INSIDE workerd (function bindings cannot
            // cross the Miniflare options boundary): prod fails closed without it.
            return realWorker.fetch(req, { ...env, __rateLimitCheck: () => true }, ctx);
          },
          email: (m, e, c) => realWorker.email(m, e, c),
          scheduled: (e2, env, c) => realWorker.scheduled(e2, env, c),
        };`,
    },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:*"],
    plugins: [{ name: "entry", setup(b) {
      b.onResolve({ filter: /temp-mail-entry\.mjs$/ }, () => ({ path: "entry", namespace: "entry" }));
      b.onLoad({ filter: /.*/, namespace: "entry" }, () => ({ contents: inner.outputFiles[0].text, loader: "js" }));
    } }],
  });
  mf = new Miniflare({
    modules: true, compatibilityDate: "2025-09-01", script: compiled.outputFiles[0].text,
    d1Databases: ["DB"], bindings: { MAIL_DOMAIN: ENV.MAIL_DOMAIN },
  });
  db = (await mf.getD1Database("DB")) as unknown as D1Stub;
  for (const stmt of readFileSync("temp-mail/migrations/0001_inbox.sql", "utf8").split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  worker = asWorker((await import("../temp-mail/src/worker.mjs")).default);
  // Email ingestion in these tests talks straight to the same D1 database
  // Miniflare exposes to the fetch Worker (identical bindings, real SQL).
  ENV = { ...ENV, DB: db };
}, 60_000);
afterAll(async () => { await mf?.dispose(); });

describe("temp-mail workerd (real D1)", () => {
  it("normalizes local part and full address, rejects bad domain/format", async () => {
    expect((await fetchJson("/api/address/open", { method: "POST", body: JSON.stringify({ address: " My-Tests_1 " }) })).body)
      .toEqual({ address: "my-tests_1@isturaiky.page" });
    expect((await fetchJson("/api/address/open", { method: "POST", body: JSON.stringify({ address: "Foo@ISTURAIKY.PAGE" }) })).body)
      .toEqual({ address: "foo@isturaiky.page" });
    for (const bad of ["ab", "a..b", "x@other.com", "bad space", "-lead", "trail-", "a".repeat(33), "foo@isturaiky.page@x"]) {
      const r = await fetchJson("/api/address/open", { method: "POST", body: JSON.stringify({ address: bad }) });
      expect(r.status, bad).toBe(400);
    }
    const rnd = await fetchJson("/api/address/random", { method: "POST", body: "{}" });
    const rndAddress = (rnd.body as { address: string }).address;
    expect(rndAddress).toMatch(/^[a-z]+-[0-9a-f]{12}@isturaiky\.page$/);
    // Reopen same normalized address without auth — works repeatedly.
    expect((await fetchJson("/api/address/open", { method: "POST", body: JSON.stringify({ address: rndAddress }) })).body).toEqual(rnd.body);
  });

  it("stores QP + Unicode subject, lists, scopes detail by recipient, expires", async () => {
    const raw = enc(mime({
      to: "alice@isturaiky.page", subject: "=?UTF-8?B?SGVsbG8g4pyT?=",
      cte: "quoted-printable", body: "Kode kamu =33=34=32=31 ya=21",
    }));
    const out = await dispatchEmail("alice@isturaiky.page", raw);
    expect(out.outcome).toBe("accepted");
    const list = await listBody(`/api/inbox/${encodeURIComponent("alice@isturaiky.page")}/messages`);
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0].subject).toContain("Hello");
    const id = list.messages[0].id;
    const detail = (await fetchJson(`/api/inbox/alice%40isturaiky.page/messages/${id}`)).body as DetailBody;
    expect(detail.message.body_text).toContain("3421");
    // Detail constrained to recipient: other inbox cannot read it.
    expect((await fetchJson(`/api/inbox/bob99%40isturaiky.page/messages/${id}`)).status).toBe(404);
    // No enumeration API.
    expect((await fetchJson("/api/inboxes")).status).toBe(404);
    // Expiry: age the row past 24h -> list/detail hide it, scheduled cleanup deletes it.
    await db.prepare("UPDATE messages SET expires_at=? WHERE id=?").bind(Date.now() - 1, id).run();
    expect((await listBody("/api/inbox/alice%40isturaiky.page/messages")).messages).toHaveLength(0);
    expect((await fetchJson(`/api/inbox/alice%40isturaiky.page/messages/${id}`)).status).toBe(404);
  });

  it("decodes base64 multipart; HTML-only converted by NATIVE workerd HTMLRewriter", async () => {
    const boundary = "BOUND42";
    const raw = enc([
      "From: Shop <shop@example.com>", "To: carol@isturaiky.page", "Subject: Order ready", "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
      `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "",
      btoa("Plain part wins."), `--${boundary}`, 'Content-Type: text/html; charset="utf-8"', "",
      "<p>HTML part</p>", `--${boundary}--`, "",
    ].join("\r\n"));
    await dispatchEmail("carol@isturaiky.page", raw);
    // Ingest HTML-only mail INSIDE workerd so the native HTMLRewriter path runs.
    const probe = await dispatchEmailWorkerd("carol@isturaiky.page", enc(mime({
      to: "carol@isturaiky.page", subject: "HTML only", ctype: 'text/html; charset="utf-8"',
      body: `<p>Hi <b>there</b></p><script>alert(1)</script><img src="https://track.example/p.gif"><p><a href="https://example.com/verify">Verify</a></p>`,
    })));
    expect(probe.htmlRewriter).toBe("function"); // proves native path, not Node fallback
    expect(probe.rejected).toBe(""); expect(probe.thrown).toBe("");
    const list = await listBody("/api/inbox/carol%40isturaiky.page/messages");
    expect(list.messages).toHaveLength(2);
    const htmlMsg = list.messages.find((m) => m.subject === "HTML only");
    expect(htmlMsg).toBeDefined();
    const detail = (await fetchJson(`/api/inbox/carol%40isturaiky.page/messages/${htmlMsg!.id}`)).body as DetailBody;
    expect(detail.message.body_text).toContain("Hi");
    expect(detail.message.body_text).toContain("https://example.com/verify");
    expect(detail.message.body_text).not.toContain("alert(1)");
    expect(detail.message.body_text).not.toContain("track.example");
  });

  it("dedupes per-recipient only: same MIME to 2 recipients lands in both, retry same recipient once", async () => {
    const raw = enc(mime({ to: "dave@isturaiky.page", subject: "Once", body: "hello" }));
    await dispatchEmail("dave@isturaiky.page", raw);
    await dispatchEmail("dave@isturaiky.page", raw); // identical retry, same recipient
    await dispatchEmail("erin@isturaiky.page", raw); // identical bytes, different recipient
    expect((await listBody("/api/inbox/dave%40isturaiky.page/messages")).messages).toHaveLength(1);
    expect((await listBody("/api/inbox/erin%40isturaiky.page/messages")).messages).toHaveLength(1);
    const wrong = await dispatchEmail("eve@other.com", enc(mime({ to: "eve@other.com", body: "x" })));
    expect(wrong.outcome).toBe("rejected");
    // Bare local on envelope path rejected too.
    const bare = await dispatchEmail("dave", raw);
    expect(bare.outcome).toBe("rejected");
  });

  it("rejects oversize: rawSize pre-check, lying rawSize, and chunked stream >1MiB (no unbounded read)", async () => {
    const small = enc(mime({ to: "gina@isturaiky.page", body: "ok" }));
    const declared = await dispatchEmail("gina@isturaiky.page", small, "s@x.co", { rawSize: 2 * 1024 * 1024 });
    expect(declared.outcome).toBe("rejected"); // rejected before reading stream
    // rawSize lies (says small); stream is really >1MiB in small chunks.
    const chunk = new Uint8Array(64 * 1024).fill(65);
    const chunks = [enc(mime({ to: "gina@isturaiky.page", body: "" })), ...Array.from({ length: 17 }, () => chunk)];
    const lied = await dispatchEmail("gina@isturaiky.page", chunks, "s@x.co", { rawSize: 100 });
    expect(lied.outcome).toBe("rejected");
    // rawSize missing entirely; single >1MiB body.
    const big = await dispatchEmail("gina@isturaiky.page", enc(mime({ to: "gina@isturaiky.page", body: "A".repeat(1024 * 1024) })));
    expect(big.outcome).toBe("rejected");
    expect((await listBody("/api/inbox/gina%40isturaiky.page/messages")).messages).toHaveLength(0);
  });

  it("enforces 100 cap atomically under concurrent inserts", async () => {
    const now = Date.now();
    const stmts = Array.from({ length: 99 }, (_, i) => db.prepare(
      "INSERT INTO messages (recipient,sender,subject,body_text,received_at,expires_at,dedupe_hash) VALUES (?,?,?,?,?,?,?)"
    ).bind("frank@isturaiky.page", "s@x.co", `seed${i}`, "b", now + i, now + 86_400_000, `seed-hash-${i}`));
    await db.batch(stmts);
    const jobs = Array.from({ length: 6 }, (_, i) =>
      dispatchEmail("frank@isturaiky.page", enc(mime({ to: "frank@isturaiky.page", subject: `burst${i}`, body: `b${i}` }))));
    await Promise.all(jobs);
    const countRows = await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE recipient=?").bind("frank@isturaiky.page").all<{ n: number }>();
    expect(countRows.results[0].n).toBe(100);
    const list = await listBody("/api/inbox/frank%40isturaiky.page/messages");
    expect(list.messages.length).toBeLessThanOrEqual(50);
  });

  it("reserved mailboxes: never openable, listable, readable or stored", async () => {
    for (const name of ["aws-root", "kiro", "admin", "postmaster"]) {
      expect((await fetchJson("/api/address/open", { method: "POST", body: JSON.stringify({ address: name }) })).status, name).toBe(400);
      expect((await fetchJson("/api/address/open", { method: "POST", body: JSON.stringify({ address: `${name}@isturaiky.page` }) })).status).toBe(400);
      expect((await fetchJson(`/api/inbox/${name}%40isturaiky.page/messages`)).status).toBe(400);
      const out = await dispatchEmail(`${name}@isturaiky.page`, enc(mime({ to: `${name}@isturaiky.page`, body: "secret" })));
      expect(out.outcome).toBe("rejected");
    }
    const reservedRows = await db.prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE recipient IN ('aws-root@isturaiky.page','kiro@isturaiky.page','admin@isturaiky.page','postmaster@isturaiky.page')"
    ).all<{ n: number }>();
    expect(reservedRows.results[0].n).toBe(0);
    // '+' subaddress aliases are disallowed everywhere.
    expect((await fetchJson("/api/address/open", { method: "POST", body: JSON.stringify({ address: "alice+tag" }) })).status).toBe(400);
    const plus = await dispatchEmail("alice+tag@isturaiky.page", enc(mime({ to: "alice+tag@isturaiky.page", body: "x" })));
    expect(plus.outcome).toBe("rejected");
  });

  it("API: body limit 413, wrong verb 405, assets carry security headers in workerd", async () => {
    const tooBig = await fetchJson("/api/address/open", {
      method: "POST", headers: { "content-type": "application/json", "content-length": "99999" }, body: " ".repeat(99999),
    });
    expect(tooBig.status).toBe(413);
    const wrongVerb = await mf.dispatchFetch("https://mail.axvara.tech/api/config", { method: "DELETE" });
    expect(wrongVerb.status).toBe(405);
    const arrayBody = await fetchJson("/api/address/open", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(["alice"]),
    });
    expect(arrayBody.status).toBe(400);
    const page = await mf.dispatchFetch("https://mail.axvara.tech/api/config");
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    expect(page.headers.get("cache-control")).toBe("no-store");
  });

  it("storage failure in email handler throws (failed, not rejected, not silent success)", async () => {
    const raw = enc(mime({ to: "henry@isturaiky.page", body: "hi" }));
    const msg = new TestEmailMessage("s@x.co", "henry@isturaiky.page", raw);
    await expect(worker.email(msg, { MAIL_DOMAIN: "isturaiky.page" }, { waitUntil() {} })).rejects.toThrow();
    expect(msg.rejected).toBe("");
    const countRows = await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE recipient=?").bind("henry@isturaiky.page").all<{ n: number }>();
    expect(countRows.results[0].n).toBe(0);
  });

  it("missing native limiter fails closed: 503 rate_limiter_unavailable (no fail-open)", async () => {
    const res = await worker.fetch(new Request("https://mail.axvara.tech/api/config"),
      { MAIL_DOMAIN: "isturaiky.page", DB: db }, { waitUntil() {} });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "rate_limiter_unavailable" });
    // And with the test-only injected hook, the same request succeeds locally.
    const ok = await worker.fetch(new Request("https://mail.axvara.tech/api/config"),
      { MAIL_DOMAIN: "isturaiky.page", DB: db, __rateLimitCheck: allowAll }, { waitUntil() {} });
    expect(ok.status).toBe(200);
  });
});
