import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { applyGamesTransactionResult, processGamesPaidOrders } from "@/lib/games/dispatch";
import { attemptRows, gamesEnv, itemRow, seedGamesOrder, seedGamesProduct, txReply, type GamesFixture } from "./helpers/games-fixture";
import { createD1Fixture } from "./helpers/d1-fixture";

const notify = vi.hoisted(() => vi.fn(async () => "sent"));
vi.mock("@/lib/games/notify", () => ({ notifyGamesNeedsCheck: notify }));

let fx: GamesFixture;
const run = () => processGamesPaidOrders(undefined, createDatabaseAccess(fx.db));
const bodyOf = (f: ReturnType<typeof vi.fn>, n: number) => JSON.parse(String((f.mock.calls[n] as unknown as [string, RequestInit])[1].body));
const urlOf = (f: ReturnType<typeof vi.fn>, n: number) => String((f.mock.calls[n] as unknown as [string, RequestInit])[0]);
/** Buat item lama dianggap sudah waktunya dipoll lagi. */
const makePollDue = (code: string) => fx.sql.prepare("UPDATE games_order_items SET last_polled_at=datetime('now','-3 minutes') WHERE order_code=?").run(code);
const stubFetch = (...replies: Array<Response | Error | (() => Response)>) => {
  const queue = [...replies];
  const f = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  });
  vi.stubGlobal("fetch", f);
  return f;
};

beforeEach(async () => {
  fx = createD1Fixture();
  gamesEnv((n, v) => vi.stubEnv(n, v));
  notify.mockClear();
  await seedGamesProduct(fx);
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("processGamesPaidOrders", () => {
  it("is a no-op without Digiflazz configuration", async () => {
    vi.stubEnv("DIGIFLAZZ_API_KEY", "");
    seedGamesOrder(fx, "AXV-G-1");
    const f = stubFetch();
    expect(await run()).toMatchObject({ skipped: "not_configured" });
    expect(f).not.toHaveBeenCalled();
    expect(itemRow(fx, "AXV-G-1").status).toBe("awaiting_payment");
  });

  it("does nothing (single statement) when there are no active items", async () => {
    const before = fx.control.queries;
    expect(await run()).toMatchObject({ idle: true });
    expect(fx.control.queries - before).toBe(1);
  });

  it("promotes only paid orders, expires cancelled ones, and keeps unpaid awaiting", async () => {
    seedGamesOrder(fx, "AXV-G-PAID");
    seedGamesOrder(fx, "AXV-G-WAIT", { paid: false });
    seedGamesOrder(fx, "AXV-G-DEAD", { paid: false, orderStatus: "kadaluarsa" });
    stubFetch(txReply("AXV-G-PAID-1", "Sukses"));
    const r = await run();
    expect(r).toMatchObject({ promoted: 1, expired: 1, dispatched: 1 });
    expect(itemRow(fx, "AXV-G-PAID").status).toBe("success");
    expect(itemRow(fx, "AXV-G-WAIT").status).toBe("awaiting_payment");
    expect(itemRow(fx, "AXV-G-DEAD").status).toBe("expired");
  });

  it("success path: signed transaction body with max_price, attempt+item marked success with sn", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    const f = stubFetch(txReply("AXV-G-1-1", "Sukses"));
    await run();
    expect(f).toHaveBeenCalledTimes(1);
    expect(urlOf(f, 0)).toBe("https://proxy.test/dgf/v1/transaction");
    expect(bodyOf(f, 0)).toMatchObject({ username: "demouser", buyer_sku_code: "ml86", customer_no: "12345(6789)", ref_id: "AXV-G-1-1", max_price: 21000 });
    expect(bodyOf(f, 0).sign).toMatch(/^[0-9a-f]{32}$/);
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "success", sn: "SN-123", supplier_message: "msg Sukses", submit_attempts: 1, lease_until: null });
    expect(itemRow(fx, "AXV-G-1").completed_at).toBeTruthy();
    expect(attemptRows(fx, "AXV-G-1")).toMatchObject([{ ref_id: "AXV-G-1-1", attempt_no: 1, buyer_sku_code: "ml86", status: "success", rc: "00", sn: "SN-123", price: 19000 }]);
    // Terminal: run berikutnya tidak mengirim apa pun.
    expect(await run()).toMatchObject({ dispatched: 0, polled: 0 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("Pending then poll Sukses re-sends the SAME ref_id/sku/customer/max_price", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    const f = stubFetch(txReply("AXV-G-1-1", "Pending"), txReply("AXV-G-1-1", "Sukses"));
    await run();
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "pending" });
    expect(attemptRows(fx, "AXV-G-1")[0].status).toBe("pending");
    // Backoff 60 dtk: run langsung tidak memanggil Digiflazz lagi.
    expect(await run()).toMatchObject({ polled: 0 });
    expect(f).toHaveBeenCalledTimes(1);
    makePollDue("AXV-G-1");
    expect(await run()).toMatchObject({ polled: 1, dispatched: 0 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1)).toEqual(bodyOf(f, 0));
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "success", sn: "SN-123" });
    expect(attemptRows(fx, "AXV-G-1")).toHaveLength(1);
  });

  it("poll backoff grows with attempt age (120s after 10 min, 300s after 1h)", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    stubFetch(txReply("AXV-G-1-1", "Pending"), txReply("AXV-G-1-1", "Pending"), txReply("AXV-G-1-1", "Pending"));
    await run();
    fx.sql.exec("UPDATE games_dispatch_attempts SET created_at=datetime('now','-20 minutes'); UPDATE games_order_items SET last_polled_at=datetime('now','-90 seconds')");
    expect(await run()).toMatchObject({ polled: 0 });
    fx.sql.exec("UPDATE games_order_items SET last_polled_at=datetime('now','-130 seconds')");
    expect(await run()).toMatchObject({ polled: 1 });
    fx.sql.exec("UPDATE games_dispatch_attempts SET created_at=datetime('now','-2 hours'); UPDATE games_order_items SET last_polled_at=datetime('now','-200 seconds')");
    expect(await run()).toMatchObject({ polled: 0 });
    fx.sql.exec("UPDATE games_order_items SET last_polled_at=datetime('now','-310 seconds')");
    expect(await run()).toMatchObject({ polled: 1 });
  });

  it("Gagal on attempt 1 queues backup attempt 2 (backup sku, ref -2) sent on the next run", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    const f = stubFetch(txReply("AXV-G-1-1", "Gagal"), txReply("AXV-G-1-2", "Sukses", { buyer_sku_code: "ml86b" }));
    expect(await run()).toMatchObject({ backup_queued: 1, needs_check: 0 });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "queued", attempt_no: 2, lease_until: null });
    expect(attemptRows(fx, "AXV-G-1")).toMatchObject([{ attempt_no: 1, status: "failed", rc: "02" }]);
    expect(notify).not.toHaveBeenCalled();
    await run();
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1)).toMatchObject({ buyer_sku_code: "ml86b", ref_id: "AXV-G-1-2", customer_no: "12345(6789)", max_price: 21000 });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "success", attempt_no: 2, submit_attempts: 2 });
    expect(attemptRows(fx, "AXV-G-1")).toMatchObject([{ attempt_no: 1, status: "failed" }, { attempt_no: 2, ref_id: "AXV-G-1-2", buyer_sku_code: "ml86b", status: "success" }]);
  });

  it.each([
    ["no backup sku", "UPDATE games_products SET backup_sku_code=NULL, backup_cost=NULL, backup_seller_active=0"],
    ["backup more expensive than max_price", "UPDATE games_products SET backup_cost=21001"],
    ["backup seller inactive", "UPDATE games_products SET backup_seller_active=0"],
  ])("Gagal on attempt 1 with %s -> needs_check and admin notified", async (_n, sql) => {
    fx.sql.exec(sql);
    seedGamesOrder(fx, "AXV-G-1");
    stubFetch(txReply("AXV-G-1-1", "Gagal"));
    expect(await run()).toMatchObject({ needs_check: 1, backup_queued: 0 });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "needs_check", attempt_no: 1, lease_until: null });
    expect(String(itemRow(fx, "AXV-G-1").last_error)).toContain("Gagal rc=02");
    expect(attemptRows(fx, "AXV-G-1")).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.anything(), "AXV-G-1", expect.stringContaining("Gagal"));
  });

  it("Gagal on attempt 2 -> needs_check (no third attempt)", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    const f = stubFetch(txReply("AXV-G-1-1", "Gagal"), txReply("AXV-G-1-2", "Gagal"));
    await run(); await run();
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "needs_check", attempt_no: 2 });
    expect(notify).toHaveBeenCalledTimes(1);
    await run();
    expect(f).toHaveBeenCalledTimes(2);
    expect(attemptRows(fx, "AXV-G-1")).toHaveLength(2);
  });

  it.each([
    ["proxy 502", () => new Response("", { status: 502 })],
    ["network error", () => new Error("boom")],
    ["unreadable JSON", () => new Response("<html>", { status: 500 })],
  ])("ambiguous transport (%s) -> attempt ambiguous, item pending, re-check with the same ref", async (_n, make) => {
    seedGamesOrder(fx, "AXV-G-1");
    const first = make();
    const f = stubFetch(first as Response, txReply("AXV-G-1-1", "Sukses"));
    await run();
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "pending" });
    expect(attemptRows(fx, "AXV-G-1")).toMatchObject([{ status: "ambiguous", ref_id: "AXV-G-1-1" }]);
    makePollDue("AXV-G-1");
    await run();
    expect(bodyOf(f, 1)).toEqual(bodyOf(f, 0));
    expect(itemRow(fx, "AXV-G-1").status).toBe("success");
    expect(attemptRows(fx, "AXV-G-1")).toMatchObject([{ status: "success" }]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("config failure keeps the item queued without counting a failed attempt and reports an error", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    const f = stubFetch(new Response("", { status: 401 }), txReply("AXV-G-1-1", "Sukses"));
    const r = await run();
    expect(r.error).toBe("config:proxy_401");
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "queued", lease_until: null });
    expect(attemptRows(fx, "AXV-G-1").every((a) => a.status === "submitting")).toBe(true);
    // Pulih: attempt submitting dipakai ulang, tidak ada attempt kedua.
    await run();
    expect(bodyOf(f, 1).ref_id).toBe("AXV-G-1-1");
    expect(attemptRows(fx, "AXV-G-1")).toHaveLength(1);
    expect(itemRow(fx, "AXV-G-1").status).toBe("success");
  });

  it("http 4xx without a transaction status -> needs_check and notify", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    stubFetch(new Response(JSON.stringify({ data: { rc: "40", message: "Payload error" } }), { status: 400 }));
    expect(await run()).toMatchObject({ needs_check: 1 });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "needs_check" });
    expect(String(itemRow(fx, "AXV-G-1").last_error)).toContain("http_400");
    expect(attemptRows(fx, "AXV-G-1")).toMatchObject([{ status: "failed" }]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("stale submitting lease with an attempt -> pending and re-checked with the same ref (no new ref)", async () => {
    seedGamesOrder(fx, "AXV-G-1", { itemStatus: "submitting" });
    fx.sql.exec(`UPDATE games_order_items SET lease_until=datetime('now','-10 seconds'), submit_attempts=1;
      INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status) VALUES('AXV-G-1-1','AXV-G-1',1,'ml86','submitting')`);
    const f = stubFetch(txReply("AXV-G-1-1", "Sukses"));
    const r = await run();
    expect(r).toMatchObject({ recovered: 1, dispatched: 0, polled: 1 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(bodyOf(f, 0).ref_id).toBe("AXV-G-1-1");
    expect(attemptRows(fx, "AXV-G-1")).toMatchObject([{ ref_id: "AXV-G-1-1", status: "success" }]);
    expect(itemRow(fx, "AXV-G-1").status).toBe("success");
  });

  it("stale submitting lease is NOT touched while the lease is still valid", async () => {
    seedGamesOrder(fx, "AXV-G-1", { itemStatus: "submitting" });
    fx.sql.exec(`UPDATE games_order_items SET lease_until=datetime('now','+200 seconds');
      INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status) VALUES('AXV-G-1-1','AXV-G-1',1,'ml86','submitting')`);
    const f = stubFetch();
    expect(await run()).toMatchObject({ recovered: 0, dispatched: 0, polled: 0 });
    expect(itemRow(fx, "AXV-G-1").status).toBe("submitting");
    expect(f).not.toHaveBeenCalled();
  });

  it("stale submitting without any attempt row -> back to queued and dispatched with ref -1", async () => {
    seedGamesOrder(fx, "AXV-G-1", { itemStatus: "submitting" });
    fx.sql.exec("UPDATE games_order_items SET lease_until=datetime('now','-10 seconds'), submit_attempts=1");
    const f = stubFetch(txReply("AXV-G-1-1", "Sukses"));
    await run();
    expect(bodyOf(f, 0).ref_id).toBe("AXV-G-1-1");
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "success", submit_attempts: 2 });
  });

  it("guarded claim: two racing runs dispatch the order exactly once", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    const f = stubFetch(() => txReply("AXV-G-1-1", "Sukses"));
    const [a, b] = await Promise.all([run(), run()]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.dispatched + b.dispatched).toBe(1);
    expect(attemptRows(fx, "AXV-G-1")).toHaveLength(1);
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "success", submit_attempts: 1 });
  });

  it("racing pollers call Digiflazz once per due item", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    stubFetch(txReply("AXV-G-1-1", "Pending"));
    await run();
    makePollDue("AXV-G-1");
    const f = stubFetch(() => txReply("AXV-G-1-1", "Pending"));
    const [a, b] = await Promise.all([run(), run()]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.polled + b.polled).toBe(1);
  });

  it("pending older than 24h since the attempt was created -> needs_check, notify, no more polling", async () => {
    seedGamesOrder(fx, "AXV-G-1");
    stubFetch(txReply("AXV-G-1-1", "Pending"));
    await run();
    fx.sql.exec("UPDATE games_dispatch_attempts SET created_at=datetime('now','-25 hours')");
    makePollDue("AXV-G-1");
    const f = stubFetch();
    expect(await run()).toMatchObject({ needs_check: 1, polled: 0 });
    expect(f).not.toHaveBeenCalled();
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "needs_check" });
    expect(String(itemRow(fx, "AXV-G-1").last_error)).toContain("24 jam");
    expect(attemptRows(fx, "AXV-G-1")[0].status).toBe("failed");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("stays within the cron statement budget with a full queue (no QueryBudgetExceeded)", async () => {
    for (let i = 1; i <= 10; i++) seedGamesOrder(fx, `AXV-G-${i}`, { itemStatus: "queued" });
    const f = vi.fn(async (_u: string, init: RequestInit) => txReply(JSON.parse(String(init.body)).ref_id, "Sukses"));
    vi.stubGlobal("fetch", f);
    const budget = createBudgetedDatabase(40, 2, fx.db);
    const r = await processGamesPaidOrders(undefined, budget.access);
    expect(budget.used).toBeLessThanOrEqual(38);
    expect(r.dispatched).toBeGreaterThan(0);
    // Sisanya tetap queued dan dilanjutkan tick berikutnya.
    const done = fx.sql.prepare("SELECT COUNT(*) c FROM games_order_items WHERE status='success'").get() as { c: number };
    expect(done.c).toBe(r.dispatched);
    for (let i = 0; i < 4; i++) await processGamesPaidOrders(undefined, createBudgetedDatabase(40, 2, fx.db).access);
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM games_order_items WHERE status='success'").get()).toEqual({ c: 10 });
  });
});

describe("applyGamesTransactionResult", () => {
  const tx = (ref: string, status: "Sukses" | "Pending" | "Gagal") => ({
    ref_id: ref, status, rc: "00", message: "m", sn: status === "Sukses" ? "SN" : null, price: 19000, buyer_sku_code: "ml86",
  });
  const prime = (code: string, itemStatus: string, attemptNo = 1) => {
    seedGamesOrder(fx, code, { itemStatus, attemptNo });
    for (let n = 1; n <= attemptNo; n++) {
      fx.sql.prepare("INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status) VALUES(?,?,?,?,?)")
        .run(`${code}-${n}`, code, n, n === 1 ? "ml86" : "ml86b", n === attemptNo ? "submitting" : "failed");
    }
  };
  const db = () => createDatabaseAccess(fx.db);

  it("terminal states never change, and duplicates are idempotent", async () => {
    prime("AXV-G-1", "submitting");
    expect(await applyGamesTransactionResult(db(), "AXV-G-1-1", tx("AXV-G-1-1", "Sukses"))).toBe("success");
    expect(await applyGamesTransactionResult(db(), "AXV-G-1-1", tx("AXV-G-1-1", "Sukses"))).toBe("ignored");
    expect(await applyGamesTransactionResult(db(), "AXV-G-1-1", tx("AXV-G-1-1", "Gagal"))).toBe("ignored");
    expect(await applyGamesTransactionResult(db(), "AXV-G-1-1", tx("AXV-G-1-1", "Pending"))).toBe("ignored");
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "success", sn: "SN" });
    expect(attemptRows(fx, "AXV-G-1")[0].status).toBe("success");
    for (const terminal of ["needs_check", "expired", "queued", "awaiting_payment"]) {
      prime(`AXV-G-${terminal}`, terminal);
      expect(await applyGamesTransactionResult(db(), `AXV-G-${terminal}-1`, tx(`AXV-G-${terminal}-1`, "Sukses"))).toBe("ignored");
      expect(itemRow(fx, `AXV-G-${terminal}`).status).toBe(terminal);
    }
  });

  it("ignores updates for a non-current attempt and reports unknown refs", async () => {
    prime("AXV-G-1", "pending", 2);
    expect(await applyGamesTransactionResult(db(), "AXV-G-1-1", tx("AXV-G-1-1", "Sukses"))).toBe("ignored");
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "pending", attempt_no: 2, sn: null });
    expect(await applyGamesTransactionResult(db(), "NOPE-1", tx("NOPE-1", "Sukses"))).toBe("unknown_ref");
    expect(await applyGamesTransactionResult(db(), "AXV-G-1-2", tx("AXV-G-1-2", "Sukses"))).toBe("success");
  });

  it("Pending then Gagal from a webhook-style call goes pending -> backup queue", async () => {
    prime("AXV-G-1", "submitting");
    expect(await applyGamesTransactionResult(db(), "AXV-G-1-1", tx("AXV-G-1-1", "Pending"))).toBe("pending");
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "pending" });
    expect(await applyGamesTransactionResult(db(), "AXV-G-1-1", tx("AXV-G-1-1", "Gagal"))).toBe("backup_queued");
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "queued", attempt_no: 2 });
  });
});
