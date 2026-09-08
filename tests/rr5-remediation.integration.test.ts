import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import * as delivery from "@/lib/fulfillment/deliver";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { sendMessage } from "@/lib/telegram/api";
import { sendTextMessage } from "@/lib/whatsapp/gateway";
import { createBudgetedDatabase, QueryBudgetExceeded } from "@/lib/db-access";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(), safeEditOrSend: vi.fn(), showLoadingBar: vi.fn(), sendChatAction: vi.fn(),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({ sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "dummy" })) }));
let fixture: ReturnType<typeof createD1Fixture>;
const CODE = "AXV-20260908-ROUND501";
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(sendMessage).mockResolvedValue({ ok: true, result: { message_id: 1 } } as Awaited<ReturnType<typeof sendMessage>>);
  fixture = createD1Fixture(); stubFulfillmentKey();
  for (const [key, value] of Object.entries({
    CRON_SECRET: "rr5-cron", AUTO_FULFILLMENT_ENABLED: "true", PRODUCT_VARIANTS_READ: "true",
    TELEGRAM_BOT_ENABLED: "false", TELEGRAM_BOT_TOKEN: "", TELEGRAM_ADMIN_CHAT_ID: "",
    WHATSAPP_FULFILLMENT: "true", WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT: "false",
    ADMIN_EMAIL: "review@example.test", ADMIN_JWT_SECRET: "local-rr5-test-key-0123456789", ADMIN_PASSWORD_SHA256: "f".repeat(64),
  })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function seed(options: { n?: number; products?: boolean; orphan?: boolean; mode?: string; channel?: string; qty?: number; code?: string } = {}) {
  const { n = 1, products = false, orphan = false, mode = "shared", channel = "telegram", qty = 1, code = CODE } = options;
  const lines = [];
  for (let i = 1; i <= n; i++) {
    const pid = products ? i : 1;
    fixture.sql.prepare("INSERT OR IGNORE INTO products(id,name,slug,price,stock) VALUES(?,?,?,10000,100)").run(pid, `Dummy ${pid}`, `dummy-${pid}`);
    const secret = await encryptSecret(`DUMMY-${i}`);
    fixture.sql.prepare(`INSERT OR IGNORE INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv)
      VALUES(?,?,?,?,10000,100,?,?,?)`).run(i, pid, `sku-${i}`, `Variant ${i}`, mode, secret.ciphertext, secret.iv);
    lines.push({ product_id: pid, variant_id: i, name: `Dummy ${i}`, price: 10000, qty });
  }
  fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
    sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status,variant_id,variant_snapshot)
    VALUES(?,?,?, ?,?,'qris','lunas','paid',?,'12345','12345','queued',1,?)`)
    .run(code, "Review", "628000000000", JSON.stringify(lines), n * qty * 10000, channel,
      JSON.stringify({ lines: lines.map((line) => ({ variant_id: line.variant_id, fulfillment_mode: mode })) }));
  const order = fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
  const product = fixture.sql.prepare("SELECT * FROM products WHERE id=1").get()!;
  if (!orphan) {
    await delivery.createFulfillmentJob(code, null, mode, 1, channel);
    await delivery.ensureFulfillmentItems(order);
  }
  return { order, product, jobId: Number(fixture.sql.prepare("SELECT id FROM fulfillment_jobs WHERE order_code=?").get(code)?.id) };
}
const current = (code = CODE) => ({
  order: fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!,
  job: fixture.sql.prepare("SELECT * FROM fulfillment_jobs WHERE order_code=?").get(code),
  items: fixture.sql.prepare("SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index").all(code),
});
async function cron() {
  fixture.control.queries = 0; fixture.control.limit = 50;
  const { POST } = await import("@/app/api/cron/operations/route");
  const response = await POST(new NextRequest("http://localhost/api/cron/operations", { method: "POST", headers: { authorization: "Bearer rr5-cron" } }));
  const queries = fixture.control.queries; fixture.control.limit = Infinity;
  return { status: response.status, queries, body: await response.json() };
}
async function cookie() {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken(process.env.ADMIN_EMAIL!);
  return `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(await createIdleToken(sid))}`;
}
async function handover(auth: string, index = 0) {
  const { POST } = await import("@/app/api/admin/orders/[code]/handover/route");
  return POST(new NextRequest(`http://localhost/api/admin/orders/${CODE}/handover`, {
    method: "POST", headers: { cookie: auth, "content-type": "application/json" }, body: JSON.stringify({ item_index: index }),
  }), { params: Promise.resolve({ code: CODE }) });
}
const signal = () => { let release!: () => void; return { promise: new Promise<void>((resolve) => { release = resolve; }), release: () => release() }; };

describe("RR5 handover platform, manifest and audit", () => {
  it("RR5-01 succeeds with the D1 LIKE pattern length restriction", async () => {
    await seed({ mode: "manual", channel: "web" });
    fixture.control.fail = (query, params) => /\bLIKE\b/i.test(query) && params.some((v) => typeof v === "string" && Buffer.byteLength(v) + 2 > 50);
    const response = await handover(await cookie());
    expect(response.status).toBe(200);
    expect(current().order.fulfillment_status).toBe("delivered");
    expect((String(current().order.admin_note).match(/handover item 0/g) || []).length).toBe(1);
  });
  for (const quantity of [0, 1, 3, "invalid"]) {
    it(`RR5-04 rejects quantity ${quantity} against 2 on first handover AND recovery`, async () => {
      await seed({ mode: "manual", channel: "web", qty: 2 });
      fixture.sql.prepare("UPDATE fulfillment_items SET qty=?").run(quantity);
      const auth = await cookie();
      expect((await handover(auth)).status).toBe(409);
      expect((await handover(auth)).status).toBe(409);
      expect(current().order.fulfillment_status).not.toBe("delivered");
      expect(current().items[0].qty).toBe(quantity);
    });
  }
  it("RR5-04 cron cannot settle a quantity mismatch left in delivered rows", async () => {
    await seed({ mode: "manual", channel: "web", qty: 2 });
    fixture.sql.prepare("UPDATE fulfillment_items SET qty=1,status='delivered'").run();
    await cron();
    expect(current().order.fulfillment_status).not.toBe("delivered");
    expect(current().job?.status).not.toBe("delivered");
  });
  it("RR5-07 two overlapping handovers retain one fact from the winning request", async () => {
    await seed({ mode: "manual", channel: "web" });
    const auth = await cookie(); const entered = signal(), release = signal(); let paused = false;
    fixture.control.beforeRun = async (query) => {
      if (!paused && query.includes("UPDATE fulfillment_items") && query.includes("delivered_message_id='manual'")) {
        paused = true; entered.release(); await release.promise;
      }
    };
    const a = handover(auth); await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await handover(auth); const winningFact = current().items[0].last_error;
    release.release(); expect((await a).status).toBe(200); expect(b.status).toBe(200);
    expect((String(current().order.admin_note).match(/handover item 0/g) || []).length).toBe(1);
    expect(current().items[0].last_error).toBe(winningFact);
  });
  it("RR5-07 an audit write outage recovers the original actor/time, not the retry actor/time", async () => {
    await seed({ mode: "manual", channel: "web" });
    fixture.control.fail = (q) => q.includes("UPDATE orders SET admin_note=");
    expect((await delivery.recordManualHandoverDetailed(CODE, 0, "original@example.test")).ok).toBe(false);
    const original = String(current().items[0].last_error);
    fixture.control.fail = null;
    expect((await delivery.recordManualHandoverDetailed(CODE, 0, "recovery@example.test")).ok).toBe(true);
    const note = String(current().order.admin_note);
    expect(note).toContain("original@example.test"); expect(note).not.toContain("recovery@example.test");
    expect(note).toContain(original.match(/\d{4}-\d{2}-\d{2}T[^:]+:\d{2}:\d{2}\.\d{3}Z/)![0]);
  });
});

describe("RR5 bounded recovery and delivery", () => {
  it("RR5-04 blocks mismatched queued quantities BEFORE contacting a provider", async () => {
    await seed({ qty: 2 });
    fixture.sql.exec("UPDATE fulfillment_items SET qty=1");
    await cron();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(current().order.fulfillment_status).toBe("manual_required");
  });
  it("RR5-08 repairs a historical delivered job with a queued order without resending", async () => {
    await seed();
    fixture.sql.exec("UPDATE fulfillment_items SET status='delivered'; UPDATE fulfillment_jobs SET status='delivered'");
    for (let i = 0; i < 4; i++) await cron();
    expect(current().order.fulfillment_status).toBe("delivered");
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it("RR5-02 disabled auto-delivery still materializes an orphan for the admin", async () => {
    await seed({ n: 4, orphan: true });
    vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
    for (let i = 0; i < 8; i++) await cron();
    expect(current().items).toHaveLength(4);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(current().order.fulfillment_status).not.toBe("delivered");
  });
  it("RR5-02 already materialized jobs do not block later orphans while auto-delivery is disabled", async () => {
    vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
    const codes = Array.from({ length: 6 }, (_, i) => `AXV-20260909-AUTOOFF${i}`);
    for (const code of codes) await seed({ n: 4, orphan: true, code });
    for (let i = 0; i < 24; i++) {
      const r = await cron(); expect(r.queries).toBeLessThanOrEqual(40);
      if (codes.every((c) => current(c).items.length === 4)) break;
    }
    expect(codes.map((c) => current(c).items.length)).toEqual([4, 4, 4, 4, 4, 4]);
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it("RR5-02 unique credentials in a 20-line orphan drain within the real query cap", async () => {
    await seed({ n: 20, mode: "unique", orphan: true });
    for (let i = 1; i <= 20; i++) {
      const secret = await encryptSecret(`UNIQUE-DUMMY-${i}`);
      fixture.sql.prepare(`INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint,status,order_code)
        VALUES(1,?,?,?,?, 'reserved',?)`).run(i, secret.ciphertext, secret.iv, `unique-${i}`, CODE);
    }
    for (let i = 0; i < 40; i++) {
      const r = await cron(); expect(r.status).toBe(200); expect(r.queries).toBeLessThanOrEqual(40);
      expect(r.body.query_budget_used).toBe(r.queries);
      if (current().order.fulfillment_status === "delivered") break;
    }
    expect(current().order.fulfillment_status).toBe("delivered");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='delivered'").get()?.n).toBe(20);
    expect(sendMessage).toHaveBeenCalledTimes(20);
  });
  it("RR5-02 captures each database independently and reserves the checkpoint tail", async () => {
    const a = createBudgetedDatabase(5, 2, fixture.db);
    const other = createD1Fixture();
    try {
      const b = createBudgetedDatabase(5, 2, other.db);
      await Promise.all([a.access.execRun("INSERT INTO store_settings(key,value) VALUES('scope','a')"), b.access.execRun("INSERT INTO store_settings(key,value) VALUES('scope','b')")]);
      expect(fixture.sql.prepare("SELECT value FROM store_settings WHERE key='scope'").get()?.value).toBe("a");
      expect(other.sql.prepare("SELECT value FROM store_settings WHERE key='scope'").get()?.value).toBe("b");
      const oversized = [1, 2, 3].map((i) => a.access.d1!.prepare("INSERT INTO store_settings(key,value) VALUES(?,?)").bind(`batch-${i}`, "x"));
      await expect(a.access.d1!.batch(oversized)).rejects.toBeInstanceOf(QueryBudgetExceeded);
      expect(a.used).toBe(1); expect(b.used).toBe(1);
      expect(fixture.sql.prepare("SELECT COUNT(*) n FROM store_settings WHERE key GLOB 'batch-*'").get()?.n).toBe(0);
      await a.access.queryFirst("SELECT 1"); await a.access.queryFirst("SELECT 1");
      await expect(a.access.queryFirst("SELECT 1")).rejects.toBeInstanceOf(QueryBudgetExceeded);
      a.beginTail(); await a.access.queryFirst("SELECT 1"); await a.access.queryFirst("SELECT 1");
      expect(a.used).toBe(5);
      await expect(a.access.queryFirst("SELECT 1")).rejects.toBeInstanceOf(QueryBudgetExceeded);
    } finally { other.close(); }
  });
  it("RR5-02 ongoing expiry traffic cannot starve fulfillment or notifications", async () => {
    await seed();
    const { enqueueWhatsAppMessage } = await import("@/lib/whatsapp/outbox");
    await enqueueWhatsAppMessage("rr5-busy", "628000000000", "DUMMY NOTICE");
    for (let run = 0; run < 12; run++) {
      for (let i = 0; i < 4; i++) {
        const code = `RR5-EXP-${run}-${i}`;
        fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel)
          VALUES(?,'Dummy','6280',?,10000,'qris','pending','pending','web')`).run(code, JSON.stringify([{ product_id: 1, qty: 1 }]));
        fixture.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,expires_at)
          VALUES(?,'dana','static',?,'dummy',10000,'pending',datetime('now','-1 minute'))`).run(code, code);
      }
      const r = await cron(); expect(r.status).toBe(200); expect(r.queries).toBeLessThanOrEqual(40);
      if (current().order.fulfillment_status === "delivered" && fixture.sql.prepare("SELECT status FROM whatsapp_outbox").get()?.status === "sent") break;
    }
    expect(current().order.fulfillment_status).toBe("delivered");
    expect(fixture.sql.prepare("SELECT status FROM whatsapp_outbox").get()?.status).toBe("sent");
  });
  for (const mode of ["shared", "manual"]) for (const products of [false, true]) {
    it(`RR5-02 two real 20-line ${mode} orphans, products=${products}, drain below budget`, async () => {
      await seed({ n: 20, mode, products, orphan: true });
      await seed({ n: 20, mode, products, orphan: true, code: "AXV-20260908-ROUND502" });
      expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
      let done = false;
      for (let i = 0; i < 60; i++) {
        const r = await cron(); expect(r.status).toBe(200); expect(r.queries).toBeLessThanOrEqual(40);
        expect(r.body.query_budget_used).toBe(r.queries);
        done = [CODE, "AXV-20260908-ROUND502"].every((c) => current(c).order.fulfillment_status === (mode === "manual" ? "manual_required" : "delivered"));
        if (done) break;
      }
      expect(done).toBe(true);
      expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(mode === "shared" ? 40 : 0);
    });
  }
  it("RR5-03 a single timeout after five normal yields still completes all 20 items", async () => {
    const { order, product, jobId } = await seed({ n: 20 });
    for (let i = 0; i < 5; i++) await delivery.processJobItems(jobId, order, product, 3);
    expect(current().job?.attempt_count).toBe(0);
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error("one transient timeout"));
    await delivery.processJobItems(jobId, order, product, 3);
    expect(current().job?.status).toBe("retry"); expect(current().job?.attempt_count).toBe(1);
    for (let i = 0; i < 12; i++) {
      fixture.sql.prepare("UPDATE fulfillment_jobs SET next_attempt_at=datetime('now','-1 minute') WHERE status='retry'").run();
      fixture.sql.prepare("UPDATE fulfillment_items SET next_attempt_at=datetime('now','-1 minute') WHERE status='retry'").run();
      await cron(); if (current().order.fulfillment_status === "delivered") break;
    }
    expect(current().items.filter((x) => x.status === "delivered")).toHaveLength(20);
    expect(current().order.fulfillment_status).toBe("delivered");
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(21);
  });
  it("RR5-06 cron respects the disabled WhatsApp fulfillment flag", async () => {
    await seed({ channel: "whatsapp" }); vi.stubEnv("WHATSAPP_FULFILLMENT", "false");
    await cron();
    expect(sendTextMessage).not.toHaveBeenCalled(); expect(current().order.fulfillment_status).toBe("manual_required");
  });
  it("RR5-06 disabled WhatsApp fulfillment stays manual even with the proof-hold setting", async () => {
    await seed({ channel: "whatsapp" });
    vi.stubEnv("WHATSAPP_FULFILLMENT", "false"); vi.stubEnv("WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT", "true");
    fixture.sql.exec("UPDATE orders SET payment_method='seabank'");
    await cron();
    expect(sendTextMessage).not.toHaveBeenCalled(); expect(current().order.fulfillment_status).toBe("manual_required");
  });
  it("RR5-06 enabled WhatsApp delivery honors proof hold, then sends after proof is present", async () => {
    await seed({ channel: "whatsapp" });
    vi.stubEnv("WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT", "true");
    fixture.sql.exec("UPDATE orders SET payment_method='seabank'");
    await cron(); expect(sendTextMessage).not.toHaveBeenCalled();
    fixture.sql.prepare(`INSERT INTO payment_proofs(order_code,conversation_id,member_id,external_message_id,claimed_method,r2_key,content_type,byte_size,sha256,status)
      VALUES(?,'dummy','6280','dummy','SEABANK','dummy','image/png',1,'dummy','submitted')`).run(CODE);
    for (let i = 0; i < 4; i++) await cron();
    expect(sendTextMessage).toHaveBeenCalledTimes(1); expect(current().order.fulfillment_status).toBe("delivered");
  });
  it("RR5-05 a unique-item worker cannot settle inventory after a newer owner takes the item", async () => {
    const { order, product, jobId } = await seed({ mode: "unique" });
    const secret = await encryptSecret("UNIQUE-DUMMY");
    fixture.sql.prepare(`INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint,status,order_code)
      VALUES(1,1,?,?,'one','reserved',?)`).run(secret.ciphertext, secret.iv, CODE);
    vi.mocked(sendMessage).mockImplementationOnce(async () => {
      fixture.sql.exec("UPDATE fulfillment_items SET locked_until='2099-01-01T00:00:00.000Z', last_error='new owner'");
      return { ok: true, result: { message_id: 1 } } as Awaited<ReturnType<typeof sendMessage>>;
    });
    await delivery.processJobItems(jobId, order, product, 1);
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_inventory").get()?.status).toBe("reserved");
    expect(current().items[0].status).toBe("sending"); expect(current().items[0].last_error).toBe("new owner");
  });
  it("RR5-08 failed order finalization is recoverable and never sends the same item again", async () => {
    await seed(); fixture.control.fail = (q) => q.includes("UPDATE orders SET fulfillment_status=");
    await cron(); fixture.control.fail = null;
    // A rolled-back finalization must be queued/retryable or recoverable after lease expiry.
    fixture.sql.prepare("UPDATE fulfillment_jobs SET locked_until=datetime('now','-2 minutes') WHERE status='sending'").run();
    for (let i = 0; i < 6; i++) await cron();
    expect(current().order.fulfillment_status).toBe("delivered"); expect(current().job?.status).toBe("delivered");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
  it("RR5-05 a worker resumed after releasing its lease cannot overwrite the next owner's failed state", async () => {
    const { order, product, jobId } = await seed();
    fixture.sql.exec("UPDATE fulfillment_jobs SET attempt_count=3;UPDATE fulfillment_items SET attempt_count=3");
    vi.mocked(sendMessage).mockRejectedValue(new Error("provider timeout"));
    const entered = signal(), release = signal(); let paused = false;
    const pause = async (queries: string[]) => {
      if (!paused && queries.some((q) => /UPDATE fulfillment_jobs SET status='retry'/.test(q))) {
        paused = true; entered.release(); await release.promise;
      }
    };
    fixture.control.afterRun = (q) => pause([q]); fixture.control.afterBatch = pause;
    const old = delivery.processJobItems(jobId, order, product, 1); await entered.promise;
    await delivery.processJobItems(jobId, order, product, 1);
    expect(current().order.fulfillment_status).toBe("failed");
    release.release(); await old;
    expect(current().order.fulfillment_status).toBe("failed"); expect(current().job?.status).toBe("failed");
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, result: { message_id: 1 } } as Awaited<ReturnType<typeof sendMessage>>);
  });
});
