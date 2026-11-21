import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { readSelectedFinancialReport } from "@/lib/dashboard-report";
import { reportTables } from "@/lib/reports/export";
import { GET as listOrders } from "@/app/api/admin/orders/route";
import { sendMessage } from "@/lib/telegram/api";
import { gamesAdminDeliverySummary, notifyWebPaidAdmin, telegramPaidDeliveryProfile } from "@/lib/telegram/order-notifications";
import { ensureFulfillmentForPaidOrder, ensureFulfillmentItems, processJobItems, reconcileOrphanLight, reconcileSettledJobs, getDueJobs, recordManualHandoverDetailed } from "@/lib/fulfillment/deliver";
import { OVERVIEW_ATTENTION_SQL, OVERVIEW_JOB_QUEUE_SQL } from "@/lib/admin-overview-queries";
import * as overviewQueries from "@/lib/admin-overview-queries";

vi.mock("@/lib/telegram/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/telegram/api")>(), sendMessage: vi.fn(),
}));
let fx: ReturnType<typeof createD1Fixture>;
const CODE = "AXG-20991231-00F17004";
const LABEL = "Mobile Legends — Mobilelegend - 50 Diamond";
const now = new Date("2026-11-17T00:00:00Z");

beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1001234");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "7".repeat(64));
  vi.mocked(sendMessage).mockReset().mockResolvedValue({ ok: true, result: { message_id: 1 } } as never);
  fx.sql.exec(`INSERT INTO games_products(id,buyer_sku_code,product_name,game_brand,sk_product_name,game_slug,supplier)
    VALUES(1,'sk:50','Mobilelegend - 50 Diamond','MOBILE LEGENDS','Mobile Legends','mobile-legends','sekalipay');
    INSERT INTO orders(code,customer_name,customer_email,customer_wa,items,subtotal,payment_method,status,payment_status,order_kind,sales_channel,paid_at,fulfillment_status)
      VALUES('${CODE}','Buyer','buyer@example.com','628123456789','[]',15600,'qris','lunas','paid','games','web','2026-11-16T10:00:00Z','not_required');
    INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,customer_nickname,unit_price,total,cost_snapshot,max_price,status,supplier,sn)
      VALUES('${CODE}',1,'sk:50','123456','Player <One>',15600,15600,14826,15600,'success','sekalipay','SN-123');`);
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); });

function attempt(status: string, price: number | null, no = 1, supplier = "sekalipay") {
  fx.sql.prepare(`INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status,price,supplier)
    VALUES(?,?,?,'sk:50',?,?,?)`).run(`${CODE}-${no}`, CODE, no, status, price, supplier);
}
const report = () => readSelectedFinancialReport({ date_from: "2026-11-16", date_to: "2026-11-16" }, now);
async function adminRequest(query: string) {
  const session = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(session.sid);
  return listOrders(new NextRequest(`https://axvara.tech/api/admin/orders?${query}`, {
    headers: { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` },
  }));
}

describe("Games finance facts", () => {
  it("uses actual charge, not catalog/snapshot cost; names and Games bucket reach both exports", async () => {
    attempt("success", 14825);
    const result = await report();
    expect(result).toMatchObject({ orders: 1, revenue: 15600, cost: 14825, profit: 775, estimated_orders: 0, estimated_order_codes: [] });
    expect(result.suppliers.games).toEqual({ orders: 1, revenue: 15600, cost: 14825, profit: 775 });
    expect(result.suppliers.manual.orders).toBe(0);
    expect(result.top_products).toEqual([{ name: LABEL, qty: 1, orders: 0, revenue: 15600, cost: 14825, profit: 775 }]);
    expect(result.series[0]).toMatchObject({ revenue: 15600, cost: 14825 });
    const tables = reportTables(result);
    expect(tables.find(t => t.title === "Supplier")?.rows).toContainEqual(["Games", 1, 15600, 14825, 775]);
    expect(tables.find(t => t.title === "Top Produk")?.rows).toContainEqual([LABEL, 1, 15600, 14825, 775]);
  });

  it.each([
    ["success", "success", null, 14826, 1],
    ["success", "pending", 14825, 14826, 1],
    ["pending", "pending", 14825, 14825, 0],
    ["needs_check", "failed", 14825, 14825, 0],
    ["needs_check", "ambiguous", null, 14826, 1],
    ["pending", "pending", null, 14826, 1],
    ["expired", "failed", null, 0, 0],
    ["needs_check", "failed", null, 0, 0],
    ["needs_check", "failed", 0, 0, 0],
    ["expired", "failed", 14825, 14825, 0],
  ])("%s / %s price=%s -> cost %s, estimated=%s", async (status, dispatch, price, cost, estimated) => {
    fx.sql.prepare("UPDATE games_order_items SET status=? WHERE order_code=?").run(status, CODE);
    attempt(String(dispatch), price as number | null);
    expect(await report()).toMatchObject({ cost, estimated_orders: estimated });
  });

  it("never reuses an old successful attempt or another supplier's price", async () => {
    attempt("success", 10000);
    fx.sql.exec(`UPDATE games_order_items SET attempt_no=2,status='pending' WHERE order_code='${CODE}'`);
    attempt("pending", null, 2);
    expect(await report()).toMatchObject({ cost: 14826, estimated_orders: 1 });
    fx.sql.exec(`UPDATE games_dispatch_attempts SET supplier='digiflazz',status='success',price=1 WHERE attempt_no=2;
      UPDATE games_order_items SET status='success' WHERE order_code='${CODE}'`);
    expect(await report()).toMatchObject({ cost: 14826, estimated_orders: 1 });
  });

  it("uses a metadata name override and gives an expired unsubmitted order zero cost", async () => {
    fx.sql.exec(`INSERT INTO games_meta(slug,display_name) VALUES('mobile-legends','MLBB');
      UPDATE games_order_items SET status='expired' WHERE order_code='${CODE}'`);
    const result = await report();
    expect(result).toMatchObject({ cost: 0, estimated_orders: 0 });
    expect(result.top_products[0].name).toBe("MLBB — Mobilelegend - 50 Diamond");
  });

  it("reads the current successful legacy backup SKU instead of the failed first attempt", async () => {
    fx.sql.exec(`UPDATE games_order_items SET supplier='digiflazz',attempt_no=2 WHERE order_code='${CODE}'`);
    attempt("failed", 0, 1, "digiflazz");
    attempt("success", 14000, 2, "digiflazz");
    fx.sql.exec("UPDATE games_dispatch_attempts SET buyer_sku_code='backup-sku' WHERE attempt_no=2");
    expect(await report()).toMatchObject({ cost: 14000, estimated_orders: 0 });
  });
});

describe("Games admin product display", () => {
  it("returns existing items name/qty/price fields for list and detail; stored empty snapshot is untouched", async () => {
    const response = await adminRequest("kind=games");
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.orders[0].items).toEqual([{ name: LABEL, qty: 1, price: 15600 }]);
    expect(fx.sql.prepare("SELECT items FROM orders WHERE code=?").get(CODE)?.items).toBe("[]");
    expect(JSON.stringify(data.orders[0].items)).not.toMatch(/customer_no|cost|supplier/);
  });

  it.each(["Mobile Legends", "50 Diamond", "missing variant"])("search matches label in list, stats and CSV: %s", async q => {
    const params = `kind=games&q=${encodeURIComponent(q)}`;
    const data = await (await adminRequest(params)).json();
    const count = q === "missing variant" ? 0 : 1;
    expect(data.orders).toHaveLength(count);
    expect(data.stats.total).toBe(count);
    expect(data.pagination.total).toBe(count);
    const csv = await (await adminRequest(`${params}&export=csv`)).text();
    if (count) expect(csv).toContain(`${LABEL} x1`);
    else expect(csv).not.toContain(CODE);
  });
});

describe("Games paid Telegram admin", () => {
  it.each([
    ["queued", "DIPROSES OTOMATIS", false], ["submitting", "DIPROSES OTOMATIS", false],
    ["pending", "DIPROSES OTOMATIS", false], ["success", "SELESAI", false],
    ["needs_check", "PERLU PEMERIKSAAN ADMIN", true], ["expired", "KEDALUWARSA", false],
    ["awaiting_payment", "SEDANG DICEK", false],
  ])("%s uses Games state and never says manual handover", async (status, orderStatus, needsAdmin) => {
    fx.sql.prepare("UPDATE games_order_items SET status=? WHERE order_code=?").run(status, CODE);
    const summary = await gamesAdminDeliverySummary(CODE, createDatabaseAccess(fx.db));
    expect(summary).toMatchObject({ orderStatus, needsAdmin, productName: LABEL });
    expect(summary.lines[0]).toBe(`🎮 ${LABEL} · ID 123456 (Player <One>)`);
    if (status === "success") expect(summary.lines.join("\n")).toContain("SN SN-123");
    if (["queued", "pending", "submitting"].includes(status)) expect(summary.lines).toContain("🤖 Diproses otomatis (Sekalipay)");
    const budget = createBudgetedDatabase(40, 2, fx.db);
    expect(await notifyWebPaidAdmin(CODE, budget.access)).toBe(true);
    expect(budget.used).toBeLessThanOrEqual(7);
    const message = vi.mocked(sendMessage).mock.calls[0][0];
    expect(message.text).toContain(LABEL);
    expect(message.text).toContain("Player &lt;One&gt;");
    expect(message.text).not.toMatch(/perlu dikirim admin|MENUNGGU PENGIRIMAN ADMIN|handover/i);
    const markup = message.reply_markup;
    expect(markup && "inline_keyboard" in markup ? markup.inline_keyboard.flat() : []).toContainEqual({ text: "👁 Lihat pesanan pembeli", url: `https://games.axvara.tech/pesanan/${CODE}` });
  });

  it("missing item remains unknown, not successful or manual; profile cannot request manual delivery", async () => {
    expect(await gamesAdminDeliverySummary("AXG-missing", createDatabaseAccess(fx.db))).toMatchObject({ needsAdmin: false, orderStatus: "SEDANG DICEK" });
    expect(await telegramPaidDeliveryProfile({ order_kind: "games", items: "[]" }, createDatabaseAccess(fx.db))).toEqual({ delivery: "queued", hasLocalManual: false });
  });
});

it("Market fulfillment and handover leave Games rows inert, including stale jobs", async () => {
  const db = createDatabaseAccess(fx.db);
  const order = fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(CODE)!;
  expect(await ensureFulfillmentForPaidOrder(CODE)).toBe(false);
  expect(await reconcileOrphanLight(CODE, db)).toBe(false);
  expect(await ensureFulfillmentItems(order, db)).toEqual([]);
  fx.sql.prepare("INSERT INTO fulfillment_jobs(order_code,status) VALUES(?,'queued')").run(CODE);
  const id = Number(fx.sql.prepare("SELECT id FROM fulfillment_jobs WHERE order_code=?").get(CODE)?.id);
  expect(await processJobItems(id, order, {}, 1, undefined, db)).toMatchObject({ reason: "no_work", attempted: 0 });
  expect(await getDueJobs(8, db)).toEqual([]);
  expect(await recordManualHandoverDetailed(CODE, 0, "admin@axvara.tech", null, db)).toMatchObject({ ok: false, reason: "not_found" });
  expect(fx.sql.prepare(OVERVIEW_ATTENTION_SQL).get()?.count).toBe(0);
  expect(fx.sql.prepare(OVERVIEW_JOB_QUEUE_SQL).all()).toEqual([]);
  fx.sql.exec("UPDATE fulfillment_jobs SET status='delivered'");
  expect(await reconcileSettledJobs(2, db)).toBe(0);
  expect(fx.sql.prepare("SELECT fulfillment_status FROM orders WHERE code=?").get(CODE)?.fulfillment_status).toBe("not_required");
});

it("operations cron's bounded orphan query cannot spend slots on Games", () => {
  const source = fs.readFileSync("src/app/api/cron/operations/route.ts", "utf8");
  const sql = source.match(/`(SELECT o\.code FROM orders o LEFT JOIN fulfillment_jobs fj ON fj\.order_code=o\.code[\s\S]*?ORDER BY o\.created_at ASC LIMIT \?)`/)?.[1];
  expect(sql).toBeTruthy();
  expect(fx.sql.prepare(sql!).all(1)).toEqual([]);
});
it("FX-11: tracks aged paid manual orders and paid Games needs_check independently of Market queues", () => {
  fx.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,paid_at,fulfillment_status) VALUES
    ('AXV-OLD','Buyer','628','[]',10000,'qris','lunas','paid',datetime('now','-25 hours'),'manual_required'),
    ('AXV-FRESH','Buyer','628','[]',10000,'qris','lunas','paid',datetime('now'),'manual_required'),
    ('AXV-UNPAID','Buyer','628','[]',10000,'qris','pending','pending',datetime('now','-25 hours'),'manual_required');
    UPDATE games_order_items SET status='needs_check';`);
  const sql=overviewQueries.OVERVIEW_MANUAL_ATTENTION_SQL;
  expect(sql && fx.sql.prepare(sql).get()).toMatchObject({aged_manual_required:1,games_needs_check:1});
});
