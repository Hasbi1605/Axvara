import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { gamesSkPaidWebhook, gamesSkCompletedWebhook } from "./fixtures/games-sk-webhooks";
import { applySkTransactionDetail, parseSkH2hOutcome } from "@/lib/games/sk-dispatch";
import { createDatabaseAccess } from "@/lib/db-access";
import type { SkTrxDetail } from "@/lib/sekalipay/client";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { notifyGamesPaid, notifyGamesCompleted, notifyGamesNeedsCheck } from "@/lib/games/notify";
import { notifyBuyerPaymentReceived } from "@/lib/notify-buyer";
import { GET } from "@/app/api/admin/games/orders/[code]/route";
import { POST } from "@/app/api/admin/games/orders/[code]/recheck/route";

const send = vi.hoisted(() => vi.fn());
const telegram = vi.hoisted(() => vi.fn());
vi.mock("@/lib/warung-rebahan/forward-sender", () => ({ sendForwardEmail: send }));
vi.mock("@/lib/telegram/api", () => ({ sendMessage: telegram }));

const CODE = "AXG-20261116-4206447D";
const REF = gamesSkPaidWebhook.data.ref_id;
const INVOICE = gamesSkPaidWebhook.data.invoice;
const SN = "MLBB1611263232621";
const expected = { refId: REF, variantId: 10691, invoice: INVOICE, target: { note: "161586434", zone_id: "5030" } };
const asDetail = (value: unknown) => value as SkTrxDetail;
let fx: ReturnType<typeof createD1Fixture>;
const db = () => createDatabaseAccess(fx.db);
const item = () => fx.sql.prepare("SELECT * FROM games_order_items WHERE order_code=?").get(CODE)!;
const params = { params: Promise.resolve({ code: CODE }) };
const url = `https://axvara.test/api/admin/games/orders/${CODE}`;

async function request(path = "/recheck", method = "POST") {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken("admin@axvara.test");
  const idle = await createIdleToken(sid);
  return new NextRequest(url + path, { method, headers: {
    cookie: `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`,
  } });
}
function stubStatus(data: unknown = gamesSkCompletedWebhook.data) {
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(init?.method ?? "GET").toBe("GET");
    return new Response(JSON.stringify({ message: "ok", data }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(async () => {
  fx = createD1Fixture();
  await insertTestProduct(fx.sql);
  insertTestOrder(fx.sql, CODE, { channel: "web", status: "lunas", items: [] });
  fx.sql.prepare("UPDATE orders SET order_kind='games',customer_email='buyer@example.test' WHERE code=?").run(CODE);
  fx.sql.exec(`INSERT INTO games_products(id,buyer_sku_code,product_name,game_brand,sk_product_name,cost,sell_price,supplier,sk_variant_id)
    VALUES(1,'sk:10691','Mobilelegend - 50 Diamond','Mobile Legends','Mobile Legends',14825,15600,'sekalipay',10691)`);
  fx.sql.prepare(`INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,customer_nickname,
    unit_price,total,cost_snapshot,max_price,status,supplier,sk_variant_id,target_snapshot,supplier_ref,sk_invoice,last_error)
    VALUES(?,1,'sk:10691','161586434|5030','Player',15600,15600,14825,15568,'needs_check','sekalipay',10691,?,?,?,'mismatch: completed tanpa hasil H2H')`)
    .run(CODE, JSON.stringify(expected.target), REF, INVOICE);
  fx.sql.prepare(`INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status,supplier,sk_invoice,request_sent_at)
    VALUES(?,?,1,'sk:10691','failed','sekalipay',?,datetime('now'))`).run(REF, CODE, INVOICE);
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.test");
  vi.stubEnv("ADMIN_JWT_SECRET", "test-games-recovery-secret-0123456789");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "sk-test");
  vi.stubEnv("SEKALIPAY_PROXY_URL", "");
  vi.stubEnv("SEKALIPAY_SANDBOX", "");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "99");
  clearRateLimitBucketsForTest();
  send.mockReset().mockResolvedValue({ ok: true, providerId: "mail-fixture" });
  telegram.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => { fx.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("recorded Sekalipay Games receipts", () => {
  it("accepts the verbatim paid/completed per-item objects with quantity and dispatch_message", () => {
    expect(parseSkH2hOutcome(asDetail(gamesSkPaidWebhook.data), expected)).toMatchObject({ kind: "pending", message: "Transaksi Sukses" });
    expect(parseSkH2hOutcome(asDetail(gamesSkCompletedWebhook.data), expected)).toMatchObject({
      kind: "success", sn: SN, actualCost: 14825, message: "Transaksi Sukses",
    });
  });
  it("supports a nested array without redundant variant_id, retaining top-level fallback", () => {
    const data = structuredClone(gamesSkCompletedWebhook.data) as unknown as Record<string, unknown>;
    const cart = (data.items as Record<string, unknown>[])[0];
    const result = cart.h2h_results;
    cart.h2h_results = [result];
    expect(parseSkH2hOutcome(asDetail(data), expected).kind).toBe("success");
    delete cart.h2h_results;
    data.h2h_results = [{ ...(result as object), variant_id: 10691 }];
    expect(parseSkH2hOutcome(asDetail(data), expected).kind).toBe("success");
    data.h2h_results = [result];
    expect(parseSkH2hOutcome(asDetail(data), expected).kind).toBe("mismatch");
  });
  it.each([
    ["quantity", 2], ["qty", 2], ["variant_id", 999], ["target", "OTHER|5030"],
  ])("keeps the cart %s guard", (key, value) => {
    const data = structuredClone(gamesSkCompletedWebhook.data);
    Object.assign(data.items[0], { [key]: value });
    expect(parseSkH2hOutcome(asDetail(data), expected).kind).toBe("mismatch");
  });
  it.each([
    { sn: "failed: no stock" }, { variant_id: 999 }, { total_units: 2 }, { delivered_units: 2 },
    { total_units: "invalid" }, { units: [{ dispatch_status: "pending", sn: SN }] },
    { units: [{ dispatch_status: "completed", sn: "DIFFERENT" }] },
    { units: [{ sn: SN }, { sn: SN }] }, { delivered_units: 0 },
  ])("rejects inconsistent nested H2H evidence %j", (override) => {
    const data = structuredClone(gamesSkCompletedWebhook.data);
    Object.assign(data.items[0].h2h_results, override);
    expect(parseSkH2hOutcome(asDetail(data), expected).kind).not.toBe("success");
  });
  it("ordinary webhook/poll application still cannot reopen needs_check", async () => {
    expect(await applySkTransactionDetail(db(), asDetail(gamesSkCompletedWebhook.data), { refId: REF })).toBe("ignored");
    expect(item().status).toBe("needs_check");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("admin Games GET-only recovery", () => {
  it("recovers needs_check to success via the same ref and sends completion once", async () => {
    const fetcher = stubStatus();
    const response = await POST(await request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ ok: true, outcome: "success", item_status: "success", sn: SN });
    expect(fetcher.mock.calls[0][0]).toContain(`/v1/trx/${REF}`);
    expect(item()).toMatchObject({ status: "success", sn: SN, last_error: null });
    expect(fx.sql.prepare("SELECT status,price FROM games_dispatch_attempts WHERE ref_id=?").get(REF)).toEqual({ status: "success", price: 14825 });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await POST(await request(), params)).status).toBe(409);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const audit = fx.sql.prepare("SELECT event,subject_hash,route,method FROM security_events").all();
    expect(audit).toContainEqual({ event: "admin_authorized", subject_hash: expect.stringMatching(/^[0-9a-f]{64}$/), route: "/api/admin/*", method: "POST" });
    expect(JSON.stringify(audit)).not.toContain(CODE);
  });
  it.each(["pending", "submitting"])("can recheck an active %s item", async (status) => {
    fx.sql.prepare("UPDATE games_order_items SET status=? WHERE order_code=?").run(status, CODE);
    fx.sql.prepare("UPDATE games_dispatch_attempts SET status='pending' WHERE ref_id=?").run(REF);
    stubStatus();
    expect(await (await POST(await request(), params)).json()).toMatchObject({ outcome: "success", item_status: "success" });
  });
  it.each(["mismatch", "pending", "cost", "cost-missing"])("leaves needs_check intact on %s", async (kind) => {
    const data = structuredClone(kind === "pending" ? gamesSkPaidWebhook.data : gamesSkCompletedWebhook.data);
    if (kind === "mismatch") data.items[0].variant_id = 999;
    if (kind === "cost") data.amount = 16000;
    if (kind === "cost-missing") Object.assign(data, { amount: undefined, price: undefined, fees: undefined });
    stubStatus(data);
    const before = { ...item() };
    const response = await POST(await request(), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, outcome: kind.startsWith("cost") ? "needs_check" : kind, item_status: "needs_check" });
    expect(item()).toEqual(before);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["unknown", "non-games", "legacy", "unpaid", "missing-attempt"])("rejects %s before any upstream request", async (kind) => {
    const fetcher = stubStatus();
    if (kind === "unknown") fx.sql.prepare("DELETE FROM games_order_items WHERE order_code=?").run(CODE);
    if (kind === "non-games") fx.sql.prepare("UPDATE orders SET order_kind='apps' WHERE code=?").run(CODE);
    if (kind === "legacy") fx.sql.prepare("UPDATE games_order_items SET supplier='digiflazz' WHERE order_code=?").run(CODE);
    if (kind === "unpaid") fx.sql.prepare("UPDATE orders SET payment_status='pending' WHERE code=?").run(CODE);
    if (kind === "missing-attempt") fx.sql.prepare("DELETE FROM games_dispatch_attempts WHERE order_code=?").run(CODE);
    const response = await POST(await request(), params);
    expect(response.status).toBe(["unknown", "non-games"].includes(kind) ? 404 : 409);
    expect(fetcher).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("requires real admin auth, validates code and rate limits repeated checks", async () => {
    const fetcher = stubStatus(gamesSkPaidWebhook.data);
    expect((await POST(new NextRequest(url + "/recheck", { method: "POST" }), params)).status).toBe(401);
    expect((await POST(await request(), { params: Promise.resolve({ code: "bad" }) })).status).toBe(400);
    clearRateLimitBucketsForTest();
    for (let i = 0; i < 10; i++) expect((await POST(await request(), params)).status).toBe(200);
    expect((await POST(await request(), params)).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(10);
  });
  it("exposes admin detail without changing orders.items", async () => {
    const response = await GET(await request("", "GET"), params);
    expect(await response.json()).toEqual({ ok: true, games: {
      order_code: CODE, game_name: "Mobile Legends", product_name: "Mobilelegend - 50 Diamond",
      customer_no: "161586434|5030", nickname: "Player", status: "needs_check", sn: null,
      supplier: "sekalipay", sk_invoice: INVOICE, supplier_ref: REF,
      last_error: "mismatch: completed tanpa hasil H2H", cost: null, cost_snapshot: 14825, max_price: 15568,
    } });
    expect(fx.sql.prepare("SELECT items FROM orders WHERE code=?").get(CODE)?.items).toBe("[]");
  });
});

describe("Games buyer lifecycle email", () => {
  it("poll/webhook application sends completion only on the first active transition", async () => {
    fx.sql.prepare("UPDATE games_order_items SET status='pending' WHERE order_code=?").run(CODE);
    fx.sql.prepare("UPDATE games_dispatch_attempts SET status='pending' WHERE ref_id=?").run(REF);
    expect(await applySkTransactionDetail(db(), asDetail(gamesSkPaidWebhook.data), { refId: REF })).toBe("pending");
    expect(send).not.toHaveBeenCalled();
    expect(await applySkTransactionDetail(db(), asDetail(gamesSkCompletedWebhook.data), { refId: REF })).toBe("success");
    expect(send).toHaveBeenCalledTimes(1);
    expect(await applySkTransactionDetail(db(), asDetail(gamesSkCompletedWebhook.data), { refId: REF })).toBe("ignored");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("active mismatch notifies admin only (no buyer email) without altering the paid state", async () => {
    fx.sql.prepare("UPDATE games_order_items SET status='pending' WHERE order_code=?").run(CODE);
    fx.sql.prepare("UPDATE games_dispatch_attempts SET status='pending' WHERE ref_id=?").run(REF);
    const data = structuredClone(gamesSkCompletedWebhook.data);
    data.items[0].variant_id = 999;
    expect(await applySkTransactionDetail(db(), asDetail(data), { refId: REF })).toBe("needs_check");
    expect(send).not.toHaveBeenCalled();
    expect(telegram).toHaveBeenCalledTimes(1);
    expect(fx.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(CODE)).toEqual({ status: "lunas", payment_status: "paid" });
  });
  it("routes payment received to Games, idempotently, never promises Market credentials", async () => {
    fx.sql.prepare("UPDATE games_order_items SET status='queued' WHERE order_code=?").run(CODE);
    expect(await notifyBuyerPaymentReceived(CODE, db())).toBe(true);
    expect(await notifyGamesPaid(db(), CODE)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.subject).toBe(`Pembayaran Diterima — Top Up Diproses — ${CODE}`);
    expect(mail.text).toContain("diproses otomatis");
    expect(mail.text).toContain(`https://games.axvara.tech/pesanan/${CODE}`);
    expect(mail.html).not.toMatch(/Detail produk dikirim|credentials|Sekalipay|14825/);
    expect(fx.sql.prepare("SELECT idempotency_key,status FROM buyer_notice_log").all()).toEqual([
      { idempotency_key: `email:games-paid:${CODE}`, status: "sent" },
    ]);
  });
  it.each(["id", "en"])("sends localized %s success details and safe plain links once", async (locale) => {
    fx.sql.prepare("UPDATE orders SET locale=? WHERE code=?").run(locale, CODE);
    fx.sql.prepare("UPDATE games_order_items SET status='success',sn=? WHERE order_code=?").run(SN, CODE);
    expect(await notifyGamesCompleted(db(), CODE)).toBe(true);
    expect(await notifyGamesCompleted(db(), CODE)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    for (const text of ["Mobile Legends", "50 Diamond", "161586434|5030", "Player", SN]) expect(mail.text).toContain(text);
    expect(mail.html).toContain(`lang="${locale}"`);
    expect(mail.subject).toContain(locale === "en" ? "Top Up Successful" : "Top Up Berhasil");
    expect(mail.text).not.toMatch(/[?&](?:pin|code|token)=/i);
  });
  it("needs_check never emails the buyer; admin guidance has exact SK invoice/ref", async () => {
    await notifyGamesNeedsCheck(db(), CODE, "mismatch: <bad>");
    await notifyGamesNeedsCheck(db(), CODE, "mismatch: <bad>");
    expect(send).not.toHaveBeenCalled();
    expect(telegram.mock.calls[0][0].text).toContain(`Cek invoice Sekalipay ${INVOICE} (ref ${REF})`);
    expect(telegram.mock.calls[0][0].text).not.toContain("Digiflazz");
    expect(telegram.mock.calls[0][0].text).toContain("&lt;bad&gt;");
  });
  it("uses the store display name (games_meta) for the game in emails", async () => {
    fx.sql.exec("UPDATE games_products SET game_slug='mobile-legends', sk_product_name='MLBB Supplier Name'");
    fx.sql.exec("INSERT OR REPLACE INTO games_meta(slug,display_name) VALUES('mobile-legends','Mobile Legends: Bang Bang')");
    fx.sql.prepare("UPDATE games_order_items SET status='success',sn=? WHERE order_code=?").run(SN, CODE);
    expect(await notifyGamesCompleted(db(), CODE)).toBe(true);
    expect(send.mock.calls[0][0].text).toContain("Mobile Legends: Bang Bang");
    expect(send.mock.calls[0][0].text).not.toContain("MLBB Supplier Name");
    expect(send.mock.calls[0][0].text).toContain("50 Diamond");
    expect(send.mock.calls[0][0].text).not.toContain("Mobilelegend -");
  });
  it("does not send unpaid or premature completion mail", async () => {
    expect(await notifyGamesCompleted(db(), CODE)).toBe(false);
    fx.sql.prepare("UPDATE orders SET payment_status='pending' WHERE code=?").run(CODE);
    expect(await notifyGamesPaid(db(), CODE)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("late paid mail uses the terminal status, not a stale processing promise", async () => {
    fx.sql.prepare("UPDATE games_order_items SET status='success',sn=? WHERE order_code=?").run(SN, CODE);
    expect(await notifyGamesPaid(db(), CODE)).toBe(true);
    expect(send.mock.calls[0][0].text).toContain("Top up kamu berhasil");
    expect(send.mock.calls[0][0].text).not.toContain("sedang diproses");
  });
  it("email failures leave item state intact and failed claims can retry", async () => {
    const before = { ...item() };
    send.mockRejectedValueOnce(new Error("fixture down"));
    expect(await notifyGamesPaid(db(), CODE)).toBe(false);
    expect(item()).toEqual(before);
    expect(fx.sql.prepare("SELECT status FROM buyer_notice_log").get()?.status).toBe("failed");
    expect(await notifyGamesPaid(db(), CODE)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
