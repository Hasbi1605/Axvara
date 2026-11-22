import { describe, expect, it, vi } from "vitest";
import { QueryBudgetExceeded } from "@/lib/db-access";
import { replayWrFinalSettlement, WR_FINAL_FLOOR } from "@/lib/warung-rebahan/final-settlement";
import { settleExhaustedSkRetries } from "@/lib/sekalipay/order";
import { reconcileJaspayAmbiguous, reconcileStuckWrOrders } from "@/lib/warung-rebahan/order";
import { afterRead, cleanupFixtures, due, families, setup, skPreflight, skReject, wire, wrReject } from "./wr-sk-harness-ext";

cleanupFixtures();

const telegramReply = { "POST /botfixture/sendMessage": () => Response.json({ ok: true, result: { message_id: 1 } }) };
function finalNoticeFixture(f: ReturnType<typeof setup>) {
  f.bind();
  f.fx.sql.exec("UPDATE orders SET customer_email='buyer@fixture.test'");
  vi.stubEnv("RESEND_API_KEY", "fixture");
  vi.stubEnv("FORWARD_FROM_EMAIL", "sender@fixture.test");
  if (f.buy === "POST /api/v1/order") {
    f.fx.sql.exec("UPDATE wr_variants SET wr_type='Invite'");
    return [f.buy, "POST /emails"];
  }
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture");
  f.sibling();
  f.fx.sql.exec(`UPDATE orders SET sales_channel='telegram',telegram_user_id='22',items='[]';
    INSERT INTO telegram_users(user_id,chat_id) VALUES('22','22');
    INSERT INTO products(id,name,slug,price,stock,require_email) VALUES(2,'Email','email-fixture',10000,1,1);
    UPDATE fulfillment_items SET status='delivered',product_id=2,variant_id=NULL WHERE item_index=1`);
  return [f.buy, "POST /botfixture/sendMessage", "POST /emails"];
}

describe("T1 statement deltas (one due SELECT, no orphan probe; two reserved tail slots)", () => {
  it.each([
    ["premium", "plain", 5], ["premium", "invite", 6], ["jaspay", "receipt", 5],
    ["jaspay", "processing", 9], ["jaspay", "completed", 29], ["sk", "paid", 3],
  ] as const)("%s %s receipt: 1 scan + %i statements", async (family, branch, core) => {
    const f = setup(family);
    const b = f.budget();
    if (branch === "invite") f.fx.sql.exec("UPDATE wr_variants SET wr_type='Invite'; UPDATE orders SET customer_email='buyer@fixture.test'");
    if (branch === "completed") f.bind();
    // A receipt with a non-handled status isolates Jaspay invoice assignment.
    const status = branch === "receipt" ? "queued" : branch === "completed" ? "completed" : undefined;
    const http = wire({ [f.buy]: () => f.receipt(status) });
    expect(await f.process(b.access, due)).toMatchObject({ processed: 1, succeeded: 1 });
    expect(f.row()).toMatchObject({ status: branch === "completed" ? "completed" : "processing", [f.invoice]: "FIXTURE-INVOICE", attempt_count: 1, request_sent_at: expect.any(String) });
    expect(http.calls).toEqual(family === "sk" ? [...skPreflight, f.buy] : [f.buy]);
    if (family === "premium") expect(http.bodies[0]).toEqual({ api_key: "fixture", variant_id: "var-1", quantity: 1, ...(branch === "invite" ? { email_invite: "buyer@fixture.test" } : {}) });
    expect(b.used - 1).toBe(core);
    expect(f.fx.control.queries).toBe(b.used);
  });

  describe.each(families)("%s claim / loss accounting", family => {
    it.each(["inline", "loss", "failed submission then loss"] as const)("%s", async branch => {
      const f = setup(family);
      const b = f.budget();
      const mark = branch === "inline" ? "-2 minutes" : "+2 minutes";
      afterRead(b.access, "queryAll", () => { f.set(`status='claimed', attempt_count=1, lease_owner='peer', lease_expires_at=datetime('now','${mark}')`); });
      let injected = 0;
      if (branch.startsWith("failed")) f.fx.control.fail = () => ++injected === 2;
      const http = wire({ [f.buy]: () => f.receipt(family === "jaspay" ? "queued" : undefined) });
      const won = branch === "inline";
      expect(await f.process(b.access, due)).toMatchObject({ processed: 1, succeeded: Number(won), retried: Number(!won) });
      expect(f.row()).toMatchObject({ attempt_count: 1, lease_owner: won ? null : "peer", request_sent_at: won ? expect.any(String) : null });
      expect(http.calls).toEqual(won ? [...(family === "sk" ? skPreflight : []), f.buy] : []);
      expect(b.used).toBe(1 + (won ? ({ premium: 6, jaspay: 6, sk: 4 })[family] : 3));
      expect(f.fx.control.queries).toBe(b.used);
    });
  });

  describe.each(["premium", "jaspay"] as const)("%s final WR rejection", family => {
    it.each([[false, false], [true, false], [false, true], [true, true]])("stock=%s inline=%s", async (stock, inline) => {
      const f = setup(family);
      const b = f.budget();
      const calls = finalNoticeFixture(f);
      const trace: string[] = [];
      f.fx.control.fail = sql => { trace.push(sql); return false; };
      f.set("attempt_count=max_attempts-1");
      if (inline) afterRead(b.access, "queryAll", () => { f.set("status='claimed', attempt_count=max_attempts, lease_owner='peer', lease_expires_at=datetime('now','-2 minutes')"); });
      let atPost = 0;
      const h = wire({ [f.buy]: () => { atPost = b.used; return wrReject(stock); }, ...telegramReply });
      expect(await f.process(b.access, due)).toMatchObject({ processed: 1, failed: 1 });
      expect(f.row()).toMatchObject({ status: "failed", request_sent_at: null, attempt_count: 3 });
      expect(h.calls).toEqual(calls);
      expect(f.items()[0]).toBe("failed");
      expect(f.order()).toMatchObject({ fulfillment_status: "failed", wr_aggregate_refresh_token: null });
      expect(atPost).toBe(5 + Number(inline));
      // Stock paths add two item/catalog writes and one revision tail after the loop.
      const revisionTail = Number(stock);
      expect(b.used - atPost - revisionTail).toBe(1 + 2 * Number(stock) + 4 + (family === "premium" ? 7 : 14));
      expect(f.fx.control.queries).toBe(b.used);
      if (process.env.C2_TRACE) console.log("C2_TRACE", JSON.stringify({ family, stock, inline, used: b.used, atPost, revisionTail, trace: trace.map(sql => sql.replace(/\s+/g, " ").trim()) }));
    });
  });

  it.each([-1, 0, 1])("WR worst final stock dispatch at floor%+i preserves FIFO and optional revision", async offset => {
    const f = setup("jaspay");
    const calls = finalNoticeFixture(f);
    f.set("attempt_count=max_attempts-1");
    f.fx.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status)
      SELECT 'fifo-next',customer_name,customer_wa,'[]',subtotal,payment_method,status,payment_status FROM orders;
      INSERT INTO wr_order_links(id,order_code,wr_variant_id,quantity,wr_cost,status)
      VALUES(2,'fifo-next','jaspay:PROD:PACK',1,5000,'pending')`);
    const b = f.budget(WR_FINAL_FLOOR + 3 + offset);
    const before = f.row();
    const http = wire({ [f.buy]: () => wrReject(true), ...telegramReply });
    const inline = (access: typeof b.access) => afterRead(access, "queryAll", () => { f.set("status='claimed', attempt_count=max_attempts, lease_owner='peer', lease_expires_at=datetime('now','-2 minutes')"); });
    if (offset >= 0) inline(b.access);
    expect(await f.process(b.access, { ...due, limit: 2 })).toMatchObject(offset < 0 ? { processed: 0, finalDeferred: true } : { processed: 1, failed: 1 });
    expect(f.fx.sql.prepare("SELECT status,attempt_count FROM wr_order_links WHERE id=2").get()).toEqual({ status: "pending", attempt_count: 0 });
    if (offset < 0) {
      expect(b.used).toBe(1);
      expect(f.row()).toEqual(before);
      expect(http.calls).toEqual([]);
      const next = f.budget(WR_FINAL_FLOOR + 3);
      inline(next.access);
      expect(await f.process(next.access, due)).toMatchObject({ failed: 1 });
      expect(next.used).toBe(WR_FINAL_FLOOR + 1);
      expect(http.calls).toEqual(calls);
      return;
    }
    expect(b.used).toBe(WR_FINAL_FLOOR + 1 + offset);
    expect(f.fx.control.queries).toBe(b.used);
    expect(b.remaining).toBe(0);
    expect(http.calls).toEqual(calls);
    for (const remaining of [1, 0]) {
      if (remaining === 1) b.beginTail();
      await b.access.queryFirst("SELECT 1");
      expect(b.remaining).toBe(remaining);
    }
    await expect(b.access.queryFirst("SELECT 1")).rejects.toBeInstanceOf(QueryBudgetExceeded);
    expect(b.used).toBe(WR_FINAL_FLOOR + 3 + offset);
  });

  it.each([-1, 0, 1])("WR aggregate replay at floor%+i includes both lanes, cursor and reserve", async offset => {
    const f = setup("jaspay");
    const calls = finalNoticeFixture(f);
    f.set("attempt_count=max_attempts-1");
    f.fx.control.fail = sql => sql.includes("UPDATE orders AS o SET fulfillment_status='failed'");
    const http = wire({ [f.buy]: () => wrReject(false), ...telegramReply });
    expect(await f.process(f.db, due)).toMatchObject({ failed: 1 });
    expect(f.row().wr_final_settle_token).toBeNull();
    const trace: string[] = [];
    f.fx.control.fail = sql => { trace.push(sql); return false; };
    const b = f.budget(4 + 14 + 2 + offset);
    const result = await replayWrFinalSettlement(b.access);
    expect(result).toMatchObject(offset < 0 ? { deferred: 1, settled: 0 } : { deferred: 0, settled: 1 });
    expect(http.calls).toEqual(offset < 0 ? [f.buy] : calls);
    expect(b.used).toBe(offset < 0 ? 3 : 18);
    if (process.env.C2_TRACE) console.log("C2_TRACE", JSON.stringify({ replay: offset, used: b.used, trace: trace.map(sql => sql.replace(/\s+/g, " ").trim()) }));
  });

  it.each([-1, 0, 1])("WR combined replay at full-body floor%+i never buys again or uses tail", async offset => {
    const f = setup("jaspay");
    const calls = finalNoticeFixture(f);
    f.set("attempt_count=max_attempts-1");
    const http = wire({ [f.buy]: () => wrReject(false), ...telegramReply });
    f.fx.control.fail = sql => sql.includes("UPDATE orders SET wr_aggregate_refresh_token=");
    await expect(f.process(f.db, due)).rejects.toThrow("Injected database interruption");
    expect(f.items()[0]).toBe("failed");
    const trace: string[] = [];
    f.fx.control.fail = sql => { trace.push(sql); return false; };
    const b = f.budget(24 + offset);
    expect(await replayWrFinalSettlement(b.access)).toMatchObject(offset < 0 ? { deferred: 1, settled: 1 } : { deferred: 0, settled: 2 });
    expect(b.used).toBe(offset < 0 ? 7 : 22);
    expect(http.calls).toEqual(offset < 0 ? [f.buy] : calls);
    expect(f.row().wr_final_settle_token).toBeNull();
    expect(f.order().wr_aggregate_refresh_token).toEqual(offset < 0 ? expect.any(String) : null);
    const remaining = b.remaining;
    b.beginTail();
    expect(b.remaining - remaining).toBe(2);
    if (process.env.C2_TRACE) console.log("C2_TRACE", JSON.stringify({ combinedReplay: offset, used: b.used, trace: trace.map(sql => sql.replace(/\s+/g, " ").trim()) }));
  });

  it.each([false, true])("SK final proof at exactly 14 usable after scan; inline=%s", async inline => {
    const f = setup("sk");
    f.bind();
    f.set("attempt_count=max_attempts-1");
    const b = f.budget(17);
    if (inline) afterRead(b.access, "queryAll", () => { f.set("status='claimed', attempt_count=max_attempts, lease_owner='peer', lease_expires_at=datetime('now','-2 minutes')"); });
    const batches: number[] = [];
    f.fx.control.afterBatch = async members => { batches.push(members.length); };
    const http = wire({ [f.buy]: skReject });
    expect(await f.process(b.access, due)).toMatchObject({ processed: 1, failed: Number(!inline), retried: Number(inline) });
    expect(http.calls).toEqual([...skPreflight, f.buy]);
    expect(f.row()).toMatchObject({ attempt_count: 3, request_sent_at: null, status: inline ? "retry" : "failed", last_error: "PRODUCT_TEMPORARILY_UNAVAILABLE:final_rejection" });
    expect(b.used).toBe(inline ? 5 : 9);
    expect(b.fits(11)).toBe(false);
    expect(batches).toEqual(inline ? [] : [3]);
    if (inline) {
      const replay = f.budget(13);
      expect(await settleExhaustedSkRetries(replay.access)).toBe(1);
      expect(replay.used).toBe(5);
      expect(batches).toEqual([3]);
      expect(f.items()).toEqual(["failed"]);
      expect(http.calls).toEqual([...skPreflight, f.buy]);
    }
  });

  it.each([["premium", false, 6], ["sk", false, 6], ["sk", true, 14]] as const)("%s final=%s preserves the %i admission threshold and reserve", async (family, final, threshold) => {
    const f = setup(family);
    const b = f.budget(threshold + 2); // one scan leaves threshold−1 for work
    if (final) f.set("attempt_count=max_attempts-1");
    const before = f.row();
    const http = wire({ [f.buy]: () => f.receipt() });
    if (family === "sk") await expect(f.process(b.access, due)).rejects.toBeInstanceOf(QueryBudgetExceeded);
    else expect(await f.process(b.access, due)).toMatchObject({ processed: 0 });
    expect(b.used).toBe(1);
    expect(b.fits(threshold)).toBe(false);
    expect(f.row()).toEqual(before);
    expect(http.calls).toEqual([]);
    b.beginTail();
    expect(b.remaining).toBe(threshold + 1);
    const exact = f.budget(threshold + 3);
    expect(await f.process(exact.access, due)).toMatchObject({ processed: 1, succeeded: 1 });
    expect(exact.used).toBe(family === "sk" ? 4 : 6);
    expect(http.calls).toEqual(family === "sk" ? [...skPreflight, f.buy] : [f.buy]);
  });

  it("charges the whole submitted failed batch but rejects oversized batches before D1", async () => {
    const f = setup("sk");
    const b = f.budget(5);
    const prepare = () => b.access.d1!.prepare("UPDATE orders SET supplier_purchase_disabled=1 WHERE code=?").bind(f.code);
    f.fx.control.fail = () => true;
    await expect(b.access.d1!.batch([prepare(), prepare()])).rejects.toThrow("Injected database interruption");
    expect(b.used).toBe(2);
    expect(f.fx.control.queries).toBe(1);
    await expect(b.access.d1!.batch([prepare(), prepare()])).rejects.toBeInstanceOf(QueryBudgetExceeded);
    expect(b.used).toBe(2);
    expect(f.fx.control.queries).toBe(1);
    expect(f.order().supplier_purchase_disabled).toBe(0);
  });

  it.each([false, true])("SK ref recovery: terminal=%s (sweep and candidate scan included)", async terminal => {
    const f = setup("sk");
    const b = f.budget();
    f.bind();
    f.set("status='submitted', attempt_count=3, request_sent_at=datetime('now','-10 minutes'), next_attempt_at=datetime('now','-1 minute')");
    const http = wire({ [f.lookup]: () => terminal ? f.receipt("canceled") : new Response(null, { status: 404 }) });
    expect(await f.recover(b.access)).toBe(Number(terminal));
    expect(f.row()).toMatchObject({ status: terminal ? "failed" : "submitted", attempt_count: 3,
      request_sent_at: expect.any(String), sk_invoice: terminal ? "FIXTURE-INVOICE" : null });
    expect(http.calls).toEqual([f.lookup]);
    expect(b.used - 2).toBe(terminal ? 13 : 3);
    expect(f.fx.control.queries).toBe(b.used);
  });

  it("Premium missing invoice recovery does not issue the transactions request", async () => {
    const f = setup("premium");
    const b = f.budget();
    f.set("status='submitted', request_sent_at=datetime('now','-20 minutes'), next_attempt_at=datetime('now','-10 minutes'), updated_at=datetime('now','-20 minutes')");
    const http = wire();
    expect(await reconcileStuckWrOrders(b.access, { minAgeMinutes: 2 })).toBe(0);
    expect(http.calls).toEqual([]);
    expect(b.used).toBe(2);
  });

  it.each(["failed", "completed"])("Premium known invoice terminal recovery: %s with one transactions read", async status => {
    const f = setup("premium");
    const b = f.budget();
    f.bind();
    f.set("status='processing', wr_order_id='FIXTURE-INVOICE', request_sent_at=datetime('now','-20 minutes')");
    const http = wire({ "POST /api/v1/transactions": () => Response.json({ success: true, data: [
      { order_id: "OTHER", status: "processing" }, { order_id: "FIXTURE-INVOICE", status, account_details: ["fixture account"] },
    ] }) });
    expect(await reconcileStuckWrOrders(b.access, { minAgeMinutes: 2 })).toBe(1);
    expect(f.row()).toMatchObject({ status, request_sent_at: expect.any(String), wr_order_id: "FIXTURE-INVOICE" });
    expect(http.calls).toEqual(["POST /api/v1/transactions"]); // This POST is the vendor's read-only list endpoint.
    expect(b.used - 1).toBe(status === "failed" ? 10 : 14);
    expect(f.fx.control.queries).toBe(b.used);
  });

  it("Jaspay exact-ref recovery: selection + read, lease, bind and processing effects", async () => {
    const f = setup("jaspay");
    const b = f.budget();
    f.set("status='submitted', attempt_count=1, request_sent_at=datetime('now','-20 minutes'), next_attempt_at=datetime('now','-10 minutes')");
    const http = wire({ [f.buy]: () => f.receipt() });
    expect(await reconcileJaspayAmbiguous(b.access)).toEqual({ exactRef: 1, polled: 0 });
    expect(f.row()).toMatchObject({ status: "processing", wr_order_id: "FIXTURE-INVOICE", attempt_count: 1 });
    expect(http.calls).toEqual([f.buy]);
    expect(b.used).toBe(8);
  });
});
