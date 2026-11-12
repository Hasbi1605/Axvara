// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import workerModule, { htmlToText, normalizeAddress, parseEmail, randomAddress } from "../temp-mail/src/worker.mjs";

type WorkerEnv = Record<string, unknown>;
interface TempMailWorker {
  fetch(request: Request, env: WorkerEnv, ctx: unknown): Promise<Response>;
  email(message: unknown, env: WorkerEnv, ctx: unknown): Promise<void>;
}
const worker = workerModule as unknown as TempMailWorker;
type TestEmailMsg = { from: string; to: string; rejected: string; raw: ReadableStream; setReject(r: string): void };

const ENV: WorkerEnv = { MAIL_DOMAIN: "isturaiky.page", RESERVED_MAILBOXES: "aws-root,aws-billing,aws-security,kiro,admin,postmaster,abuse,security,billing,support,root,extra-reserved" };
const enc = (s: string) => new TextEncoder().encode(s);
const ctx = () => ({ waitUntil() {} });

describe("temp-mail pure logic + API guards", () => {
  it("normalization: case, trim, full-address, runtime reserved additions", () => {
    expect(normalizeAddress("  Foo.Bar ", ENV)).toBe("foo.bar@isturaiky.page");
    expect(normalizeAddress("foo@ISTURAIKY.PAGE", ENV)).toBe("foo@isturaiky.page");
    expect(normalizeAddress("foo@axvara.tech", ENV)).toBeNull();
    expect(normalizeAddress("extra-reserved", ENV)).toBeNull();
    expect(normalizeAddress("a+b", ENV)).toBeNull();
    expect(normalizeAddress("ab", ENV)).toBeNull();
    for (let i = 0; i < 50; i++) expect(randomAddress(ENV)).toMatch(/^[a-z]+-[0-9a-f]{12}@isturaiky\.page$/);
  });

  it("parseEmail decodes base64 body and Unicode subject; htmlToText strips script/img", async () => {
    const raw = enc([
      "From: A <a@x.co>", "To: bob@isturaiky.page", "Subject: =?UTF-8?B?SGVsbG8g4pyT?=", "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "",
      btoa("Secret code 9988"), "",
    ].join("\r\n"));
    const parsed = await parseEmail(raw);
    expect(parsed.subject).toContain("Hello");
    expect(parsed.bodyText).toContain("9988");
    const text = await htmlToText(`<p>Hi</p><script>evil()</script><img src="https://t.example/x.gif"><a href="https://e.co/v">V</a>`);
    expect(text).toContain("Hi"); expect(text).not.toContain("evil"); expect(text).not.toContain("t.example");
  });

  it("fetch API: 503 when DB binding missing, no-store + CSP on JSON", async () => {
    const envNoDb: WorkerEnv = { MAIL_DOMAIN: "isturaiky.page", __rateLimitCheck: () => true };
    const res = await worker.fetch(new Request("https://mail.axvara.tech/api/inbox/alice%40isturaiky.page/messages"), envNoDb, ctx());
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    const api = await worker.fetch(new Request("https://mail.axvara.tech/api/config"), envNoDb, ctx());
    expect(api.status).toBe(503); // API fails closed until DB binding exists (parent provisions D1)
    const dbDown = await worker.fetch(new Request("https://mail.axvara.tech/api/inbox/alice%40isturaiky.page/messages"),
      { MAIL_DOMAIN: "isturaiky.page", __rateLimitCheck: () => true, DB: { prepare() { throw new Error("x"); } } }, ctx());
    expect(dbDown.status).toBe(503); // storage error surfaces honestly
  });

  it("email handler THROWS on storage failure (no silent success, no permanent setReject)", async () => {
    const makeMsg = (to: string): TestEmailMsg => ({
      from: "a@x.co", to, rejected: "",
      raw: new ReadableStream({ start(c) { c.enqueue(enc("From: a@x.co\r\n\r\nhi\r\n")); c.close(); } }),
      setReject(r: string) { this.rejected = r; },
    });
    const msg = makeMsg("alice@isturaiky.page");
    await expect(worker.email(msg, { MAIL_DOMAIN: "isturaiky.page" }, ctx())).rejects.toThrow();
    expect(msg.rejected).toBe(""); // storage failure is a thrown runtime failure, NOT a permanent rejection
    // Bare local recipient on the envelope path is rejected (full address required).
    const bare = makeMsg("alice");
    await worker.email(bare, ENV, ctx());
    expect(bare.rejected).toBeTruthy();
  });

  it("API guards: 405 unknown verb, 400 bad payload types/malformed encoding, 503 limiter failure", async () => {
    const dbStub = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => null }) }) };
    const envOk: WorkerEnv = { MAIL_DOMAIN: "isturaiky.page", __rateLimitCheck: () => true, DB: dbStub };
    const url = (p: string) => new Request(`https://mail.axvara.tech${p}`, { method: "DELETE" });
    expect((await worker.fetch(url("/api/config"), envOk, ctx())).status).toBe(405);
    const post = (body: BodyInit, ct = "application/json") => worker.fetch(
      new Request("https://mail.axvara.tech/api/address/open", { method: "POST", headers: { "content-type": ct }, body }), envOk, ctx());
    expect((await post(JSON.stringify({ address: 42 }))).status).toBe(400);
    expect((await post(JSON.stringify(["alice"]))).status).toBe(400);
    expect((await post(JSON.stringify("alice"))).status).toBe(400);
    expect((await post("not json{")).status).toBe(400);
    // Malformed percent-encoding in the path -> 400, not a throw/500.
    const badEnc = await worker.fetch(new Request("https://mail.axvara.tech/api/inbox/%E0%A4%A/messages"), envOk, ctx());
    expect(badEnc.status).toBe(400);
    // Chunked (no content-length) oversize body: actual streamed bytes bounded at 4096.
    const bigStream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(5000)); c.close(); } });
    const chunkedReq = new Request("https://mail.axvara.tech/api/address/open", {
      method: "POST", headers: { "content-type": "application/json" }, body: bigStream, duplex: "half",
    } as RequestInit);
    const chunked = await worker.fetch(chunkedReq, envOk, ctx());
    expect(chunked.status).toBe(413);
    // Native limiter throwing -> 503, never a pass-through.
    const limiterDown = await worker.fetch(new Request("https://mail.axvara.tech/api/config"),
      { MAIL_DOMAIN: "isturaiky.page", DB: dbStub, API_RATE_LIMITER: { limit: async () => { throw new Error("down"); } } }, ctx());
    expect(limiterDown.status).toBe(503);
  });

  it("static UI contract: public/24h warning, no innerHTML, 44px controls, brand tokens", () => {
    const html = readFileSync("temp-mail/public/index.html", "utf8");
    const js = readFileSync("temp-mail/public/app.js", "utf8");
    const css = readFileSync("temp-mail/public/styles.css", "utf8");
    expect(html).toContain('lang="id"');
    expect(html).toContain("Semua inbox bersifat publik");
    expect(html).toContain("24 jam");
    expect(html).toContain("Kotak masuk sementara");
    expect(html).toContain("Alamat acak");
    expect(html).toContain("Buka inbox");
    expect(html).toContain(">Salin<");
    expect(html).toContain("Muat ulang");
    expect(js).not.toContain("innerHTML");
    expect(js).toContain("document.hidden");
    expect(js).toContain("10_000");
    for (const token of ["#080C1E", "#00E5FF", "#FFB800", "SF Pro"]) expect(css + html).toContain(token);
    expect(css).toContain("min-height:44px");
  });

  it("config contract: isolated D1 id, isturaiky.page, reserved var, custom domain — never axvara-db", () => {
    const cfg = readFileSync("temp-mail/wrangler.jsonc", "utf8");
    expect(cfg).toContain("a507b69c-7493-4e76-9d63-68a38d9202de");
    expect(cfg).toContain('"MAIL_DOMAIN": "isturaiky.page"');
    expect(cfg).toContain("aws-root,aws-billing,aws-security,kiro");
    expect(cfg).toContain('"pattern": "mail.axvara.tech", "custom_domain": true');
    expect(cfg).not.toMatch(/"database_name":\s*"axvara-db"/);
    const sql = readFileSync("temp-mail/migrations/0001_inbox.sql", "utf8");
    expect(sql).toContain("UNIQUE (recipient, dedupe_hash)");
    expect(sql).not.toContain("dedupe_hash TEXT NOT NULL UNIQUE");
    expect(sql).toContain("idx_messages_recipient_received");
    expect(cfg).toContain('"run_worker_first": true');
    const wrk = readFileSync("temp-mail/src/worker.mjs", "utf8");
    expect(wrk).not.toContain('"robots":'); // X-Robots-Tag is the real header
    expect(wrk).toContain('"x-robots-tag"');
    expect(wrk).not.toContain("escapeHtml");
    expect(wrk).not.toContain("localPartOk");
  });
});
