import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as retryWr } from "@/app/api/admin/warung/orders/[id]/retry/route";
import { POST as retrySk } from "@/app/api/admin/sekalipay/orders/[id]/retry/route";
import { POST as wrTick } from "@/app/api/cron/lite/route";
import { POST as skWebhook } from "@/app/api/webhook/sekalipay/route";
import { createDatabaseAccess } from "@/lib/db-access";
import { notifyBuyerDeliveryFailed } from "@/lib/notify-buyer";
import { replayWrFinalSettlement, settleWrFinalAggregate, settleWrFinalLink } from "@/lib/warung-rebahan/final-settlement";
import { parseExpiry } from "@/lib/expiry";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { computeSkSignature } from "@/lib/sekalipay/client";
import { advanceSkLinkMonotonic, skStatusRank } from "@/lib/sekalipay/deliver";
import { bindSkInvoiceByRef } from "@/lib/sekalipay/order";
import { advanceWrLinkMonotonic, handleJaspayTerminal, handleWrOrderCompleted, wrStatusRank } from "@/lib/warung-rebahan/deliver";
import { reconcileJaspayAmbiguous, reconcileStuckWrOrders } from "@/lib/warung-rebahan/order";
import { afterRead, cleanupFixtures, due, jaspayDetail, setup, skPreflight, skReject, wire, wrReject } from "./wr-sk-harness-ext";
import { seedWrOrder } from "../warung-rebahan/helpers";

vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ email: "admin@fixture.test" }) }));
cleanupFixtures();
afterEach(clearRateLimitBucketsForTest);

const invoice = "FIXTURE-INVOICE";
const lease = "lease_owner='peer', lease_expires_at=datetime('now','+10 minutes')";
const sent = "request_sent_at=datetime('now','-10 minutes'), attempt_count=1";
const expired = "lease_owner='old', lease_expires_at=datetime('now','-2 minutes')";
const retry = (family: "premium" | "sk") => (family === "sk" ? retrySk : retryWr)(
  new NextRequest(`https://fixture.test/api/admin/${family === "sk" ? "sekalipay" : "warung"}/orders/1/retry`, { method: "POST" }),
  { params: Promise.resolve({ id: "1" }) },
);

describe.each(["premium", "sk"] as const)("T3 %s", family => {
  const sk = family === "sk";
  const advance = sk ? advanceSkLinkMonotonic : advanceWrLinkMonotonic;
  const rank = sk ? skStatusRank : wrStatusRank;

  it.each(["order status", "payment status", "disabled", "void", "invoice", "sent", "exhausted", "claimed", "reset", "retry"] as const)("B1 admin Retry %s", async branch => {
    const f = setup(family);
    vi.stubEnv(sk ? "SEKALIPAY_AUTO_ORDER_ENABLED" : "WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "false");
    const http = wire();
    f.set(branch === "claimed" ? "status='claimed'" : branch === "void" || branch === "invoice" || branch === "sent" || branch === "reset"
      ? "status='failed', attempt_count=3" : `status='retry', attempt_count=${branch === "exhausted" ? 3 : 1}`);
    if (branch === "order status") f.fx.sql.exec("UPDATE orders SET status='pending'");
    if (branch === "payment status") f.fx.sql.exec("UPDATE orders SET payment_status='pending'");
    if (branch === "disabled") f.fx.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
    if (branch === "void") f.set("last_error='cancelled_by_admin:fixture'");
    if (branch === "invoice") f.set(`${f.invoice}='${invoice}'`);
    if (branch === "sent") f.set("request_sent_at=datetime('now')");
    const before = f.row();
    const response = await retry(family);
    if (branch === "reset" || branch === "retry") {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, link: { status: "retry", attempt_count: branch === "reset" ? 0 : 1 } });
      expect(f.row()).toMatchObject({ request_sent_at: null, [f.invoice]: null });
    } else {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: branch === "exhausted" ? "max_attempts_reached"
        : sk && (branch === "invoice" || branch === "sent") ? "reconciliation_required" : "not_retryable" });
      expect(f.row()).toEqual(before);
    }
    expect(http.calls).toEqual([]);
  });

  it.each(["failed", "retry"] as const)("B1 admin CAS rejects order mutation after reading %s", async status => {
    const f = setup(family);
    f.set(`status='${status}', attempt_count=1`);
    const before = f.row();
    // The route consumes the raw globally bound D1. Wrap just the first fulfilled read.
    const prepare = f.fx.db.prepare;
    let raced = false;
    f.fx.db.prepare = q => {
      const statement = prepare(q);
      const bind = statement.bind;
      statement.bind = (...args) => {
        const bound = bind(...args);
        const first = bound.first;
        bound.first = async () => {
          const row = await first();
          if (!raced) { raced = true; f.fx.sql.exec("UPDATE orders SET supplier_purchase_disabled=1"); }
          return row;
        };
        return bound;
      };
      return statement;
    };
    const http = wire();
    const response = await retry(family);
    expect(raced).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "retry_race_lost", status });
    expect(f.row()).toEqual(before);
    expect(http.calls).toEqual([]);
  });

  it.each([1, 2, 3])("B1 rejection backoff step %i", async step => {
    const f = setup(family);
    if (step === 3) f.set("max_attempts=4");
    f.set(`attempt_count=${step - 1}`);
    const start = Date.now();
    const http = wire({ [f.buy]: sk ? skReject : () => wrReject(false) });
    expect(await f.process(f.db, due)).toMatchObject({ retried: 1 });
    const delayMs = [1, 5, 15][step - 1] * 60_000;
    expect(parseExpiry(String(f.row().next_attempt_at))).toBeGreaterThanOrEqual(start + delayMs - 1000);
    expect(parseExpiry(String(f.row().next_attempt_at))).toBeLessThanOrEqual(Date.now() + delayMs + 1000);
    expect(f.row()).toMatchObject({ status: "retry", attempt_count: step, request_sent_at: null, lease_owner: null });
    expect(http.calls).toEqual(sk ? [...skPreflight, f.buy] : [f.buy]);
  });

  it("B1 rank distinguishes in-flight, processing, terminal and unknown", () => {
    expect(["pending", "claimed", "submitted", "ordering", "processing", "completed", "failed", "invalid"].map(rank))
      .toEqual([0, 1, 2, 2, 3, 4, 4, -1]);
  });

  it("B2 two runners over one snapshot make one fenced purchase", async () => {
    const f = setup(family);
    let n = 0;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const runner = () => {
      const db = createDatabaseAccess(f.fx.db);
      afterRead(db, "queryAll", async () => { if (++n === 2) release(); await ready; });
      return f.process(db, due);
    };
    const atBuy: unknown[] = [];
    const http = wire({ [f.buy]: () => { atBuy.push(f.row().request_sent_at); return f.receipt(); }, [f.lookup]: () => new Response(null, { status: 404 }) });
    const outcomes = await Promise.all([runner(), runner()]);
    expect(outcomes.map(r => r.succeeded).sort()).toEqual([0, 1]);
    expect(atBuy).toEqual([expect.any(String)]);
    expect(http.calls.filter(c => c === f.buy)).toEqual([f.buy]);
    expect(f.row()).toMatchObject({ status: "processing", attempt_count: 1, request_sent_at: atBuy[0] });
  });

  it.each(["expiry", "due", "attempt", "invoice"] as const)("B2 stale selection loses on %s drift", async branch => {
    const f = setup(family);
    let peer: ReturnType<typeof f.row> | undefined;
    afterRead(f.db, "queryAll", () => {
      f.set({ expiry: `status='claimed', attempt_count=1, ${lease}`, due: "next_attempt_at=datetime('now','+2 hours')",
        attempt: "attempt_count=2", invoice: `${f.invoice}='${invoice}'` }[branch]);
      peer = f.row();
    });
    const http = wire();
    expect(await f.process(f.db, due)).toMatchObject({ processed: 1, retried: 1 });
    expect(f.row()).toEqual(peer);
    expect(http.calls).toEqual([]);
  });

  it.each(["old owner", "expired owner", "forward handover", "reverse handover"] as const)("B2 veto after claim: %s", async branch => {
    const f = setup(family);
    const snapshots: unknown[] = [];
    const run = f.db.execRun;
    f.db.execRun = async (...args) => {
      const result = await run(...args);
      if (!snapshots.length && f.row().status === "claimed") {
        if (branch === "old owner") f.set(lease);
        else if (branch === "expired owner") f.set(expired);
        else {
          f.bind(branch === "forward handover" ? "forward" : "reverse");
          f.fx.sql.exec(`UPDATE product_variants SET ${f.prefix}_variant_id=NULL; UPDATE fulfillment_items SET last_error='manual_handover:admin',delivered_message_id='manual'`);
        }
        snapshots.push(f.row());
      }
      return result;
    };
    const http = wire();
    expect(await f.process(f.db, due)).toMatchObject({ retried: 1 });
    expect(snapshots).toHaveLength(1);
    expect(f.row()).toEqual(snapshots[0]);
    expect(http.calls).toEqual(sk ? skPreflight : []);
  });

  it.each(["NULL", "''", "'KNOWN'"])("B3 expired unsent last claim with invoice %s", async value => {
    const f = setup(family);
    f.set(`status='claimed', attempt_count=max_attempts, ${expired}, ${f.invoice}=${value}`);
    const before = f.row();
    const http = wire({ [f.buy]: () => f.receipt() });
    expect(await f.recover(f.db)).toBe(Number(value !== "'KNOWN'"));
    if (value === "'KNOWN'") expect(f.row()).toEqual(before);
    else {
      expect(f.row()).toMatchObject({ status: "pending", attempt_count: 2, lease_owner: null, request_sent_at: null });
      if (sk || value === "NULL") {
        expect(await f.process(f.db, due)).toMatchObject({ succeeded: 1 });
        expect(f.row()).toMatchObject({ status: "processing", attempt_count: 3 });
      }
    }
    expect(http.calls).toEqual(value === "'KNOWN'" || (!sk && value === "''") ? [] : sk ? [...skPreflight, f.buy] : [f.buy]);
  });

  it.each(["unpaid", "disabled"] as const)("B3b R1 does not requeue expired unsent %s work", async branch => {
    const f = setup(family);
    f.set(`status='claimed', attempt_count=2, ${expired}`);
    f.fx.sql.exec(branch === "unpaid" ? "UPDATE orders SET payment_status='pending'" : "UPDATE orders SET supplier_purchase_disabled=1");
    const before = f.row();
    const http = wire();
    const changed = await f.recover(f.db);
    expect(http.calls).toEqual([]);
    expect({ changed, link: f.row() }).toEqual({ changed: 0, link: before });
  });

  it("B4 advances processing then terminal, refuses regression and preserves replay/lost owner", async () => {
    const f = setup(family);
    f.set(`status='claimed', ${f.invoice}='${invoice}', ${sent}, ${lease}`);
    const before = f.row();
    const http = wire();
    expect(await advance(invoice, "processing", null, f.db, "first")).toBe(true);
    expect(f.row()).toMatchObject({ status: "processing", request_sent_at: before.request_sent_at, attempt_count: 1 });
    if (sk) expect(f.row().lease_owner).toBeNull(); // WR winning cleanup is covered by the B4b cases below.
    f.set(lease);
    const replay = f.row();
    expect(await advance(invoice, "processing", null, f.db, "first")).toBe(true);
    expect(await advance(invoice, "processing", null, f.db, "another")).toBe(true);
    expect(f.row()).toEqual(replay);
    let winner: ReturnType<typeof f.row> | undefined;
    afterRead(f.db, "queryFirst", () => { f.set("status='completed', lease_owner='winner'"); winner = f.row(); });
    expect(await advance(invoice, "failed", null, f.db)).toBe(false);
    expect(f.row()).toEqual(winner);
    expect(await advance(invoice, "processing", null, f.db)).toBe(false);
    expect(await advance(invoice, "failed", null, f.db)).toBe(false);
    expect(f.row()).toEqual(winner);
    f.set("status='processing'");
    expect(await advance(invoice, "failed", null, f.db)).toBe(true);
    expect(f.row()).toMatchObject({ status: "failed", request_sent_at: before.request_sent_at, attempt_count: 1 });
    expect(http.calls).toEqual([]);
  });
});

it.each([
  ["premium", "''"], ["premium", "NULL"], ["jaspay", "''"], ["jaspay", "NULL"],
] as const)("T3 B2b %s attaches the accepted receipt after sweep with invoice %s", async (family, value) => {
  const f = setup(family);
  f.set(`status='claimed', attempt_count=max_attempts, ${expired}, wr_order_id=${value}`);
  expect(await f.recover(f.db)).toBe(1);
  expect(f.row()).toMatchObject({ status: "pending", attempt_count: 2, request_sent_at: null });
  const budget = f.budget();
  const http = wire({ [f.buy]: () => {
    expect(f.row()).toMatchObject({ status: "claimed", attempt_count: 3, request_sent_at: expect.any(String) });
    return f.receipt(family === "jaspay" ? "queued" : "processing");
  } });
  const result = await f.process(budget.access, due);
  expect(http.calls).toEqual([f.buy]);
  expect(f.row()).toMatchObject({ status: "processing", wr_order_id: invoice, request_sent_at: expect.any(String), attempt_count: 3 });
  expect(result).toMatchObject({ processed: 1, succeeded: 1, retried: 0 });
  expect(budget.used).toBe(6);
  expect(await f.process(f.db, due)).toMatchObject({ processed: 0 });
  expect(http.calls).toEqual([f.buy]);
});

describe("T3 B2 recovery wire", () => {
  describe.each(["premium", "jaspay"] as const)("%s H1", family => {
    it.each(["arbitrary transport error", "timed out", "unreadable success"] as const)("%s keeps the fence and never retries dispatch", async kind => {
      const f = setup(family);
      const http = wire({ [f.buy]: () => {
        if (kind === "unreadable success") return new Response("not-json", { status: 200 });
        if (kind === "timed out") throw new DOMException("fixture timeout", "AbortError");
        throw new Error("fixture transport interrupted");
      } });
      expect(await f.process(f.db, due)).toMatchObject({ retried: 1 });
      const before = f.row();
      expect(before).toMatchObject({ status: "submitted", request_sent_at: expect.any(String), attempt_count: 1, wr_order_id: null });
      for (let tick = 0; tick < 3; tick++) {
        f.set("next_attempt_at=datetime('now','-1 minute')");
        expect(await f.process(f.db, due)).toMatchObject({ processed: 0 });
        expect(f.row()).toMatchObject({ status: before.status, request_sent_at: before.request_sent_at, attempt_count: before.attempt_count, wr_order_id: null });
      }
      if (family === "premium") {
        f.set("request_sent_at=datetime('now','-20 minutes')");
        expect(await reconcileStuckWrOrders(f.db, { minAgeMinutes: 2 })).toBe(0);
        expect(f.row().wr_order_id).toBeNull();
      }
      expect(http.calls).toEqual([f.buy]);
    });

    it.each([
      ["bad host", { WARUNG_REBAHAN_BASE_URL: "https://disallowed.fixture.test/api/v1" }, "wr_host_not_allowed"],
      ["missing key", { WARUNG_REBAHAN_API_KEY: "" }, "WARUNG_REBAHAN_API_KEY not configured"],
      ["missing proxy token", { WARUNG_REBAHAN_PROXY_URL: "https://proxy.fixture.test", WARUNG_REBAHAN_PROXY_TOKEN: "" }, "WARUNG_REBAHAN_PROXY_TOKEN not configured"],
    ] as const)("%s is provably pre-send and remains retryable", async (_label, env, reason) => {
      const f = setup(family);
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      const http = wire();
      expect(await f.process(f.db, due)).toMatchObject({ retried: 1 });
      expect(f.row()).toMatchObject({ status: "retry", request_sent_at: null, wr_order_id: null, attempt_count: 1, last_error: reason });
      expect(http.calls).toEqual([]);
    });
  });

  it("Jaspay exact replay preserves body and fence; active lease and age window suppress it", async () => {
    const f = setup("jaspay");
    let upstreamAccepted = false;
    const http = wire({ [f.buy]: () => {
      if (!upstreamAccepted) throw new Error("receipt interrupted");
      return f.receipt();
    } });
    expect(await f.process(f.db, due)).toMatchObject({ retried: 1 });
    upstreamAccepted = true;
    for (const age of ["-1 minute", "-25 hours"]) {
      f.set(`request_sent_at=datetime('now','${age}'), next_attempt_at=datetime('now','-1 minute')`);
      expect(await reconcileJaspayAmbiguous(f.db)).toEqual({ exactRef: 0, polled: 0 });
    }
    f.set(`request_sent_at=datetime('now','-20 minutes'), ${lease}`);
    const before = f.row();
    expect(await reconcileJaspayAmbiguous(f.db)).toEqual({ exactRef: 0, polled: 0 });
    expect(f.row()).toEqual(before);
    expect(http.calls).toEqual([f.buy]);
    f.set(expired);
    expect(await reconcileJaspayAmbiguous(f.db)).toEqual({ exactRef: 1, polled: 0 });
    expect(http.calls).toEqual([f.buy, f.buy]);
    expect(http.bodies[0]).toMatchObject({ product: "PROD", package: "PACK", quantity: 1, ref_id: expect.any(String) });
    expect(http.bodies[1]).toEqual(http.bodies[0]);
    expect(f.row()).toMatchObject({ status: "processing", attempt_count: 1, wr_order_id: invoice, request_sent_at: before.request_sent_at });
  });

  it("SK duplicate ref and later 404 are GET-only recovery, even on the final attempt", async () => {
    const f = setup("sk");
    f.set("attempt_count=max_attempts-1");
    const http = wire({ [f.buy]: () => Response.json({ message: "REF_ID_ALREADY_EXIST" }, { status: 409 }),
      [f.lookup]: () => new Response(null, { status: 404 }) });
    expect(await f.process(f.db, due)).toMatchObject({ succeeded: 0, retried: 1 });
    const row = f.row();
    expect(row).toMatchObject({ request_sent_at: expect.any(String), attempt_count: 3, sk_invoice: null });
    expect(http.calls).toEqual([...skPreflight, f.buy, f.lookup]);
    f.set(`status='submitted', next_attempt_at=datetime('now','-1 minute'), ${expired}`);
    expect(await f.recover(f.db)).toBe(0);
    expect(await f.process(f.db, due)).toMatchObject({ processed: 0 });
    expect(f.row()).toMatchObject({ request_sent_at: row.request_sent_at, attempt_count: 3, sk_invoice: null });
    expect(http.calls).toEqual([...skPreflight, f.buy, f.lookup, f.lookup]);
  });
});

it("T3 B3/B3b sent SK evidence remains recoverable with purchasing disabled", async () => {
  const f = setup("sk");
  f.bind();
  f.set(`status='claimed', ${sent}, ${expired}, next_attempt_at=datetime('now','-1 minute')`);
  f.fx.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
  const oldFence = f.row().request_sent_at;
  const http = wire({ [f.lookup]: () => f.receipt("canceled") });
  expect(await f.recover(f.db)).toBe(1);
  expect(f.row()).toMatchObject({ status: "failed", sk_invoice: invoice, request_sent_at: oldFence, attempt_count: 1 });
  expect(http.calls).toEqual([f.lookup]);
});

it("T3 B3/B3b sent Premium evidence remains recoverable with purchasing disabled", async () => {
  const f = setup("premium");
  f.bind();
  f.set(`status='claimed', wr_order_id='${invoice}', ${sent}, ${expired}`);
  f.fx.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
  const oldFence = f.row().request_sent_at;
  const read = "POST /api/v1/transactions";
  const http = wire({ [read]: () => Response.json({ success: true, data: [{ order_id: invoice, status: "failed" }] }) });
  expect(await f.recover(f.db)).toBe(0);
  expect(await reconcileStuckWrOrders(f.db, { minAgeMinutes: 2 })).toBe(1);
  expect(f.row()).toMatchObject({ status: "failed", wr_order_id: invoice, request_sent_at: oldFence, attempt_count: 1 });
  expect(http.calls).toEqual([read]);
});

it("T3 B2/B4 signed terminal webhook wins over late SK purchase receipt", async () => {
  const f = setup("sk");
  f.bind();
  const secret = "local-fixture-only";
  vi.stubEnv("SEKALIPAY_WEBHOOK_SECRET", secret);
  let won: ReturnType<typeof f.row> | undefined;
  let reply: number | undefined;
  const http = wire({ [f.buy]: async () => {
    const data = { invoice, ref_id: f.ref, status: "canceled" };
    const signature = await computeSkSignature(f.ref, invoice, data.status, secret);
    const response = await skWebhook(new NextRequest("https://fixture.test/api/webhook/sekalipay", {
      method: "POST", headers: { "content-type": "application/json", "x-signature": signature }, body: JSON.stringify({ event: "order.canceled", data }),
    }));
    reply = response.status;
    won = f.row();
    return f.receipt();
  } });
  expect(await f.process(f.db, due)).toMatchObject({ succeeded: 0, retried: 1 });
  expect(reply).toBe(200);
  expect(won).toMatchObject({ status: "failed", sk_invoice: invoice, lease_owner: null, request_sent_at: expect.any(String) });
  expect(f.row()).toEqual(won);
  expect(http.calls).toEqual([...skPreflight, f.buy]);
});

describe("T3 B4b winning WR completion and advance", () => {
  it.each(["processing", "failed", "premium completion", "jaspay completion"] as const)("releases purchase lease on winning %s only", async branch => {
    const f = setup(branch === "jaspay completion" ? "jaspay" : "premium");
    f.bind();
    f.set(`status='claimed', wr_order_id='${invoice}', ${sent}, ${lease}`);
    const before = f.row();
    const http = wire();
    const ok = branch === "premium completion" ? await handleWrOrderCompleted(invoice, { account_details: "fixture" }, f.db, { deferDelivery: true })
      : branch === "jaspay completion" ? await handleJaspayTerminal(invoice, jaspayDetail, f.db)
      : await advanceWrLinkMonotonic(invoice, branch, null, f.db);
    expect(ok).toBe(true);
    expect(http.calls).toEqual([]);
    expect(f.row()).toMatchObject({ status: branch.includes("completion") ? "completed" : branch, request_sent_at: before.request_sent_at,
      attempt_count: 1, lease_owner: null, lease_expires_at: null });
  });

  it.each(["premium", "jaspay"] as const)("retains a peer lease on %s same-state account refresh/replay", async family => {
    const f = setup(family);
    f.bind();
    f.set(`status='processing', wr_order_id='${invoice}', ${sent}`);
    const http = wire();
    const complete = () => family === "premium"
      ? handleWrOrderCompleted(invoice, { account_details: "fixed fixture data" }, f.db, { accountUpdated: true, deferDelivery: true })
      : handleJaspayTerminal(invoice, jaspayDetail, f.db);
    expect(await complete()).toBe(true);
    f.set(lease);
    const before = f.row();
    await complete();
    expect(f.row()).toMatchObject({ status: "completed", lease_owner: "peer", lease_expires_at: before.lease_expires_at,
      request_sent_at: before.request_sent_at, attempt_count: 1 });
    expect(http.calls).toEqual([]);
  });
});

describe("T3 B5 invoice ownership invariant", () => {
  function otherLink(f: ReturnType<typeof setup>, bound: boolean) {
    seedWrOrder(f.fx, "AXV-PEER-FIXTURE");
    f.fx.sql.prepare(`INSERT INTO sk_order_links(id,order_code,sk_variant_id,sk_cost,status,idempotency_key,sk_invoice)
      VALUES(2,'AXV-PEER-FIXTURE','1095',5000,'processing','sk:AXV-PEER-FIXTURE:1095:1',?)`).run(bound ? invoice : null);
  }

  it("a purchase receipt cannot claim an invoice that ref recovery just bound to another link", async () => {
    const f = setup("sk");
    otherLink(f, false);
    let peerBound: boolean | undefined;
    let fence: unknown;
    const http = wire({ [f.buy]: async () => {
      fence = f.row().request_sent_at;
      peerBound = await bindSkInvoiceByRef("sk:AXV-PEER-FIXTURE:1095:1", invoice, f.db);
      return f.receipt();
    } });
    const result = await f.process(f.db, due);
    expect(peerBound).toBe(true);
    expect(f.fx.sql.prepare("SELECT sk_invoice FROM sk_order_links WHERE id=2").get()?.sk_invoice).toBe(invoice);
    expect(http.calls).toEqual([...skPreflight, f.buy]);
    expect(f.row().request_sent_at).toBe(fence);
    expect({ succeeded: result.succeeded, retried: result.retried, invoice: f.row().sk_invoice }).toEqual({ succeeded: 0, retried: 1, invoice: null });
  });

  it("ref recovery cannot claim an invoice previously owned by another link", async () => {
    const f = setup("sk");
    otherLink(f, true);
    f.set(`status='submitted', ${sent}`);
    const before = f.row();
    const http = wire();
    const bound = await bindSkInvoiceByRef(f.ref, invoice, f.db);
    expect(http.calls).toEqual([]);
    expect({ bound, row: f.row() }).toEqual({ bound: false, row: before });
  });

  it("processing recovery cannot overwrite a changed invoice after the ref binding step", async () => {
    const f = setup("sk");
    f.set(`status='submitted', ${sent}, next_attempt_at=datetime('now','-1 minute')`);
    const run = f.db.execRun;
    let changed = false;
    f.db.execRun = async (...args) => {
      const result = await run(...args);
      if (!changed && f.row().sk_invoice === invoice) {
        changed = true;
        f.set(`sk_invoice='PEER-INVOICE', ${lease}`);
      }
      return result;
    };
    const before = f.row();
    const http = wire({ [f.lookup]: () => f.receipt("paid") });
    const recovered = await f.recover(f.db);
    expect(changed).toBe(true);
    expect(http.calls).toEqual([f.lookup]);
    expect(f.row()).toMatchObject({ sk_invoice: "PEER-INVOICE", status: before.status, request_sent_at: before.request_sent_at, lease_owner: "peer" });
    expect(recovered).toBe(0);
  });

  it("same-link exact invoice replay remains safe", async () => {
    const f = setup("sk");
    f.set(`status='processing', sk_invoice='${invoice}', ${sent}`);
    const before = f.row();
    expect(await bindSkInvoiceByRef(f.ref, invoice, f.db)).toBe(true);
    expect(f.row()).toMatchObject({ status: before.status, sk_invoice: invoice, request_sent_at: before.request_sent_at, attempt_count: 1 });
  });
});

describe.each(["premium", "jaspay"] as const)("T3 2C H4 %s", family => {
  function prepareH4(mixed = false) {
    const f = setup(family);
    f.bind();
    f.set("attempt_count=max_attempts-1");
    if (mixed) f.sibling();
    f.fx.sql.exec("UPDATE orders SET customer_email='buyer@fixture.test'");
    f.fx.sql.exec("INSERT INTO wr_saldo_log(balance,source) VALUES (100000,'api_check')");
    vi.stubEnv("RESEND_API_KEY", "fixture");
    vi.stubEnv("FORWARD_FROM_EMAIL", "sender@fixture.test");
    vi.stubEnv("CRON_SECRET", "fixture-cron");
    return f;
  }

  const tick = () => {
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "false");
    return wrTick(new NextRequest("https://fixture.test/api/cron/lite?job=wr_orders", {
      method: "POST", headers: { authorization: "Bearer fixture-cron" },
    }));
  };
  const notices = (f: ReturnType<typeof setup>) => f.fx.sql.prepare("SELECT status FROM buyer_notice_log WHERE order_code=?").all(f.code);

  it.each(["final", "interrupted final", "stock", "balance", "ambiguous", "admin failed", "admin retry"] as const)("FX-21a legacy blank invoice: %s", async phase => {
    const f = prepareH4();
    f.set("wr_order_id=''");
    if (phase === "admin failed" || phase === "admin retry") {
      const failed = phase === "admin failed";
      f.set(failed ? "status='failed',attempt_count=max_attempts" : "status='retry',attempt_count=1");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "false");
      const http = wire();
      expect((await retry("premium")).status).toBe(200);
      expect(f.row()).toMatchObject({ status: "retry", attempt_count: failed ? 0 : 1, wr_order_id: "", request_sent_at: null });
      expect(http.calls).toEqual([]);
      return;
    }
    const final = phase === "final" || phase === "interrupted final";
    if (!final) f.set("attempt_count=0");
    if (phase === "interrupted final") f.fx.control.fail = sql => sql.includes("UPDATE fulfillment_items AS i");
    const http = wire({ [f.buy]: () => {
      if (phase === "ambiguous") throw new Error("fixture connection reset after send");
      if (phase === "balance") return Response.json({ success: false, message: "INSUFFICIENT_BALANCE" }, { status: 402 });
      return wrReject(true);
    } });
    if (phase === "interrupted final") {
      await expect(f.process(f.db, due)).rejects.toThrow("Injected database interruption");
      expect(f.row().wr_final_settle_token).toEqual(expect.any(String));
      f.fx.control.fail = null;
      await replayWrFinalSettlement(createDatabaseAccess(f.fx.db));
    } else expect(await f.process(f.db, due)).toMatchObject(final ? { failed: 1 } : phase === "balance" ? { blocked: 1 } : { retried: 1 });
    expect(await f.process(f.db, due)).toMatchObject({ processed: 0 });
    expect(f.row()).toMatchObject({ wr_order_id: "", status: final ? "failed" : phase === "stock" ? "retry" : phase === "balance" ? "blocked_balance" : "submitted",
      request_sent_at: phase === "ambiguous" ? expect.any(String) : null, lease_owner: null, wr_final_settle_token: null });
    expect(f.items()).toEqual([final ? "failed" : "queued"]);
    expect(f.order()).toMatchObject({ fulfillment_status: final ? "failed" : "queued", wr_aggregate_refresh_token: null });
    expect(http.calls).toEqual(final || phase === "balance" ? [f.buy, "POST /emails"] : [f.buy]);
  });

  it("keeps mixed cart active until sibling completes; sends one notice and never buys twice", async () => {
    const f = prepareH4(true);
    const http = wire({ [f.buy]: () => wrReject(true) });
    expect(await f.process(f.db, due)).toMatchObject({ failed: 1 });
    const interim = { items: f.items(), order: f.order().fulfillment_status, notices: notices(f), calls: [...http.calls] };
    f.fx.sql.exec("UPDATE fulfillment_items SET status='delivered' WHERE item_index=1");
    await tick();
    await tick();
    expect({ interim, final: { items: f.items(), order: f.order().fulfillment_status, notices: notices(f), calls: http.calls } }).toEqual({
      interim: { items: ["failed", "queued"], order: "queued", notices: [], calls: [f.buy] },
      final: { items: ["failed", "delivered"], order: "failed", notices: [{ status: "sent" }], calls: [f.buy, "POST /emails"] },
    });
  });

  it("defers below the measured admission boundary and settles one item at the first admitted budget", async () => {
    const f = prepareH4();
    const http = wire({ [f.buy]: () => wrReject(false) });
    const before = f.row();
    const deferred: number[] = [];
    let admitted = 0;
    // 3 is one SELECT plus two reserved statements. Do not bake MAP-3's proposed 24 into T3.
    for (let usable = 6; usable <= 40; usable++) {
      const b = f.budget(usable + 3);
      const result = await f.process(b.access, due);
      if (result.processed === 1) { admitted = usable; break; }
      deferred.push(usable);
      expect(b.used).toBe(1);
      expect(f.row()).toEqual(before);
      expect(http.calls).toEqual([]);
    }
    expect({ previous: deferred.at(-1), floorMinusOne: admitted - 1, items: f.items(), order: f.order().fulfillment_status, calls: http.calls })
      .toEqual({ previous: admitted - 1, floorMinusOne: admitted - 1, items: ["failed"], order: "failed", calls: [f.buy, "POST /emails"] });
  });

  it.each(["link", "item", "handoff", "aggregate", "post-aggregate", "legacy-post-aggregate"] as const)("replays interrupted %s write from the next WR recovery tick without POST", async phase => {
    const f = prepareH4();
    const http = wire({ [f.buy]: () => wrReject(false) });
    const legacy = phase === "legacy-post-aggregate";
    if (legacy) {
      f.set("fulfillment_item_id=NULL");
      f.fx.sql.exec("DELETE FROM fulfillment_items");
    }
    if (phase === "link") {
      f.fx.control.afterRun = async () => { if (f.row().wr_final_settle_token) throw new Error("fixture link interruption"); };
    } else if (phase === "handoff") {
      f.fx.sql.exec(`CREATE TRIGGER interrupt_h4 BEFORE UPDATE OF wr_final_settle_token ON wr_order_links
        WHEN OLD.wr_final_settle_token IS NOT NULL AND NEW.wr_final_settle_token IS NULL
        BEGIN SELECT RAISE(ABORT,'fixture handoff interruption'); END;`);
    } else if (phase === "post-aggregate" || legacy) {
      // On aggregate commit, simulate loss of the rest of this invocation's D1 access.
      f.fx.control.fail = () => f.order().fulfillment_status === "failed";
    } else f.fx.sql.exec(phase === "item" ? `CREATE TRIGGER interrupt_h4 BEFORE UPDATE OF status ON fulfillment_items
      WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'fixture item interruption'); END;` :
      `CREATE TRIGGER interrupt_h4 BEFORE UPDATE OF fulfillment_status ON orders
      WHEN NEW.fulfillment_status='failed' BEGIN SELECT RAISE(ABORT,'fixture aggregate interruption'); END;`);
    try { await f.process(f.db, due); } catch (error) {
      if (!(error instanceof Error) || !/fixture .* interruption|Injected database interruption/.test(error.message)) throw error;
    }
    expect(f.row().status).toBe("failed");
    const interrupted = { items: f.items(), order: f.order().fulfillment_status, calls: [...http.calls] };
    if (phase === "handoff") {
      expect(f.row().wr_final_settle_token).toEqual(expect.any(String));
      expect(f.order().wr_aggregate_refresh_token).toBeNull();
    }
    f.fx.control.fail = null;
    f.fx.control.afterRun = null;
    f.fx.sql.exec("DROP TRIGGER IF EXISTS interrupt_h4");
    await tick();
    await tick();
    expect({ interrupted, recovered: { items: f.items(), order: f.order().fulfillment_status, calls: http.calls } }).toEqual({
      interrupted: { items: legacy ? [] : [phase === "item" || phase === "link" ? "queued" : "failed"], order: phase === "post-aggregate" || legacy ? "failed" : "queued", calls: [f.buy] },
      recovered: { items: legacy ? [] : ["failed"], order: "failed", calls: [f.buy, "POST /emails"] },
    });
  });

  it.each(["delivered", "sending", "manual-error", "manual-message", "conflict", "unpaid", "disabled"] as const)("does not use unbound fallback when the bound item becomes %s in flight", async branch => {
    const f = prepareH4();
    const http = wire({ [f.buy]: () => {
      if (branch === "unpaid") f.fx.sql.exec("UPDATE orders SET payment_status='pending'");
      else if (branch === "disabled") f.fx.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
      else if (branch === "conflict") {
        f.fx.sql.prepare("INSERT INTO wr_order_links(id,order_code,wr_variant_id,wr_cost,status) VALUES(2,?,'other',5000,'processing')").run(f.code);
        f.fx.sql.exec("UPDATE fulfillment_items SET wr_link_id=2 WHERE id=1");
      } else if (branch === "manual-error") f.fx.sql.exec("UPDATE fulfillment_items SET last_error='manual_handover:fixture' WHERE id=1");
      else if (branch === "manual-message") f.fx.sql.exec("UPDATE fulfillment_items SET delivered_message_id='manual' WHERE id=1");
      else f.fx.sql.prepare("UPDATE fulfillment_items SET status=? WHERE id=1").run(branch);
      return wrReject(false);
    } });
    await f.process(f.db, due);
    await tick();
    expect({ item: f.items()[0], order: f.order().fulfillment_status, calls: http.calls }).toEqual({
      item: branch === "delivered" || branch === "sending" ? branch : "queued", order: "queued", calls: [f.buy],
    });
  });

  it("settles the reverse-only bound item after catalog mapping churn", async () => {
    const f = prepareH4();
    f.set("fulfillment_item_id=NULL");
    f.fx.sql.exec("UPDATE product_variants SET wr_variant_id=NULL");
    const http = wire({ [f.buy]: () => wrReject(false) });
    expect(await f.process(f.db, due)).toMatchObject({ failed: 1 });
    expect(http.calls).toEqual([f.buy, "POST /emails"]);
    expect({ items: f.items(), order: f.order().fulfillment_status }).toEqual({ items: ["failed"], order: "failed" });
  });

  it("keeps legacy truly unbound failure behavior", async () => {
    const f = prepareH4();
    f.set("fulfillment_item_id=NULL");
    f.fx.sql.exec("DELETE FROM fulfillment_items");
    const http = wire({ [f.buy]: () => wrReject(false) });
    expect(await f.process(f.db, due)).toMatchObject({ failed: 1 });
    expect(f.items()).toEqual([]);
    expect(f.order().fulfillment_status).toBe("failed");
    expect(http.calls).toEqual([f.buy, "POST /emails"]);
  });

  it.each(["claim", "send", "response"] as const)("cannot promote a low-budget attempt to final during %s", async phase => {
    const f = prepareH4();
    f.set("max_attempts=4,attempt_count=2");
    const b = f.budget(9);
    if (phase === "claim") afterRead(b.access, "queryAll", () => { f.set("max_attempts=3"); });
    if (phase === "send") f.fx.control.afterRun = async () => {
      if (f.row().status === "claimed") { f.fx.control.afterRun = null; f.set("max_attempts=3"); }
    };
    const http = wire({ [f.buy]: () => { f.set("max_attempts=3"); return wrReject(false); } });
    expect(await f.process(b.access, due)).toMatchObject({ retried: 1, failed: 0 });
    expect(f.row().wr_final_settle_token).toBeNull();
    expect(f.items()).toEqual(["queued"]);
    expect(http.calls).toEqual(phase === "response" ? [f.buy] : []);
  });

  it("keeps an interrupted send unknown even when a legacy caller and replay try again", async () => {
    const f = prepareH4();
    const http = wire({ [f.buy]: () => wrReject(false), "POST /emails": () => {
      f.fx.control.fail = sql => sql.includes("UPDATE buyer_notice_log");
      return Response.json({ id: "accepted-fixture" });
    } });
    await expect(f.process(f.db, due)).rejects.toThrow("Injected database interruption");
    f.fx.control.fail = null;
    f.fx.sql.exec("UPDATE buyer_notice_log SET updated_at=datetime('now','-1 day')");
    await notifyBuyerDeliveryFailed(f.code, f.db);
    await tick();
    await tick();
    expect(f.order().wr_aggregate_refresh_token).toEqual(expect.any(String));
    expect(notices(f)).toEqual([{ status: "sending" }]);
    expect(http.calls).toEqual([f.buy, "POST /emails"]);
  });

  it.each(["api envelope", "balance", "config", "ambiguous"] as const)("writes H4 proof only for definitive final rejection: %s", async phase => {
    const f = prepareH4();
    if (phase === "api envelope") f.fx.control.fail = sql => sql.includes("AS eligible") && sql.includes("SELECT i.id");
    const http = wire({ [f.buy]: () => phase === "api envelope" ? Response.json({ success: false, message: "INVALID_VARIANT" })
      : Response.json({ success: false, message: phase === "balance" ? "INSUFFICIENT_BALANCE" : "fixture failure" },
        { status: phase === "balance" ? 402 : phase === "config" ? 401 : 503 }) });
    if (phase === "api envelope") await expect(f.process(f.db, due)).rejects.toThrow("Injected database interruption");
    else await f.process(f.db, due);
    expect(f.row().wr_final_settle_token).toEqual(phase === "api envelope" ? expect.any(String) : null);
    expect(f.items()).toEqual(["queued"]);
    expect(http.calls.filter(call => call === f.buy)).toEqual([f.buy]);
  });
});

describe("H4 settlement generations and retry", () => {
  it("runs the final admin notice only for the first winning writer, not recovery", async () => {
    const f = setup("premium");
    f.bind();
    f.set("attempt_count=max_attempts-1");
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture");
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "22");
    const admin = "POST /botfixture/sendMessage";
    const http = wire({ [f.buy]: () => wrReject(false), [admin]: () => Response.json({ ok: true, result: { message_id: 1 } }) });
    f.fx.control.fail = sql => sql.includes("UPDATE fulfillment_items AS i");
    await expect(f.process(f.db, due)).rejects.toThrow("Injected database interruption");
    f.fx.control.fail = null;
    expect(await replayWrFinalSettlement(f.db)).toMatchObject({ settled: 2 });
    expect(await f.process(f.db, due)).toMatchObject({ processed: 0 });
    expect(http.calls).toEqual([f.buy, admin]);
  });

  it.each(["cross-order", "duplicate reverse", "forward competitor", "lost binding", "generic failed"] as const)("retains marker without fallback for %s", async branch => {
    const f = setup("premium");
    f.bind();
    f.set("attempt_count=max_attempts-1");
    const http = wire({ [f.buy]: () => {
      if (branch === "cross-order") {
        seedWrOrder(f.fx, "other-order");
        f.fx.sql.exec("UPDATE fulfillment_items SET order_code='other-order'");
      } else if (branch === "duplicate reverse") {
        f.sibling();
        f.fx.sql.exec("UPDATE fulfillment_items SET wr_link_id=1");
      } else if (branch === "forward competitor") {
        f.fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,wr_cost,status,fulfillment_item_id)
          VALUES(?,'other',5000,'failed',1)`).run(f.code);
      } else if (branch === "lost binding") {
        f.set("fulfillment_item_id=NULL");
        f.fx.sql.exec("UPDATE fulfillment_items SET wr_link_id=NULL");
      } else f.fx.sql.exec("UPDATE fulfillment_items SET status='failed',last_error='unrelated'");
      return wrReject(false);
    } });
    expect(await f.process(f.db, due)).toMatchObject({ failed: 1 });
    expect(await replayWrFinalSettlement(f.db)).toMatchObject({ pending: 1 });
    expect(f.row().wr_final_settle_token).toEqual(expect.any(String));
    expect(f.order()).toMatchObject({ fulfillment_status: "queued", wr_aggregate_refresh_token: null });
    expect(http.calls).toEqual([f.buy]);
  });

  it("orders past an active aggregate and rotates past a conflicting link", async () => {
    const f = setup("premium");
    const marked = crypto.randomUUID();
    f.set(`status='failed',wr_final_settle_token='${marked}:b'`);
    f.fx.sql.exec(`UPDATE orders SET wr_aggregate_refresh_token='${crypto.randomUUID()}';`);
    seedWrOrder(f.fx, "zzz-healthy");
    f.fx.sql.prepare(`INSERT INTO wr_order_links(id,order_code,wr_variant_id,wr_cost,status,wr_final_settle_token)
      VALUES(2,'zzz-healthy','other',5000,'failed',?)`).run(`${crypto.randomUUID()}:u`);
    const http = wire();
    expect(await replayWrFinalSettlement(f.db)).toMatchObject({ pending: 1, settled: 0, reasons: { conflict: 1 } });
    expect(await replayWrFinalSettlement(f.db)).toMatchObject({ pending: 0, settled: 2 });
    expect(f.row().wr_final_settle_token).toBe(`${marked}:b`);
    expect(f.fx.sql.prepare("SELECT fulfillment_status,wr_aggregate_refresh_token FROM orders WHERE code='zzz-healthy'").get())
      .toEqual({ fulfillment_status: "failed", wr_aggregate_refresh_token: null });
    expect(http.calls).toEqual([]);
  });

  it.each(["read", "failed CAS", "retry CAS", "order only"] as const)("Admin Retry fences only link marker: %s", async phase => {
    const f = setup("premium");
    const marker = `${crypto.randomUUID()}:b`;
    f.set(`status='${phase === "retry CAS" ? "retry" : "failed"}',attempt_count=1`);
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "false");
    if (phase === "read") f.set(`wr_final_settle_token='${marker}'`);
    if (phase.endsWith("CAS")) f.fx.control.beforeRun = async sql => {
      if (sql.includes("UPDATE wr_order_links SET status='retry'")) f.set(`wr_final_settle_token='${marker}'`);
    };
    if (phase === "order only") f.fx.sql.exec(`UPDATE orders SET wr_aggregate_refresh_token='${crypto.randomUUID()}'`);
    const http = wire();
    const response = await retry("premium");
    expect(response.status).toBe(phase === "order only" ? 200 : 409);
    expect(f.row().wr_final_settle_token).toBe(phase === "order only" ? null : marker);
    expect(http.calls).toEqual([]);
  });

  it("replays two same-order handoffs without allowing stale ACK; preserves work through Retry", async () => {
    const f = setup("premium");
    f.bind();
    f.sibling();
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    f.set(`status='failed',wr_final_settle_token='${a}:b'`);
    f.fx.sql.prepare(`INSERT INTO wr_order_links(id,order_code,wr_variant_id,wr_cost,status,fulfillment_item_id,wr_final_settle_token)
      VALUES(2,?,'other',5000,'failed',2,?)`).run(f.code, `${b}:b`);
    const work = (id: number, token: string) => settleWrFinalLink(f.db, { id, token, code: f.code });
    const generations = await Promise.all([work(1, a), work(2, b)]);
    const live = String(f.order().wr_aggregate_refresh_token);
    const tokens = generations.map(g => typeof g === "string" ? g : g.orderToken);
    expect(tokens).toContain(live);
    expect(new Set(tokens).size).toBe(2);
    expect(await settleWrFinalAggregate(f.db, f.code, tokens.find(t => t !== live)!)).toBe("race");
    expect(f.order().wr_aggregate_refresh_token).toBe(live);
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "false");
    expect((await retry("premium")).status).toBe(200);
    expect(f.order().wr_aggregate_refresh_token).toBe(live);
    expect(await replayWrFinalSettlement(f.db)).toMatchObject({ settled: 0 });
    f.set("status='completed',wr_order_id='NEW'");
    f.fx.sql.exec("UPDATE fulfillment_items SET status='delivered',last_error=NULL WHERE id=1");
    expect(await replayWrFinalSettlement(f.db)).toMatchObject({ settled: 1 });
    expect(f.order().fulfillment_status).toBe("failed");
    expect(f.order().wr_aggregate_refresh_token).toBeNull();
  });
});
