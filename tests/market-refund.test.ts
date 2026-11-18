import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { DAY, estimateLine, prorata, termEnd, wibInputSeconds } from "@/lib/refund/calculate";
import { expandDeliveryLines } from "@/lib/fulfillment/units";
import { telegramOrderAdminKeyboard, webPaidAdminKeyboard, webOrderAdminKeyboard } from "@/lib/telegram/keyboards";
import type { D1 } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ requireAdmin: (req: Request) => req.headers.get("x-fixture-admin") === "yes" }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: () => true, clientIp: () => "127.0.0.1" }));
vi.mock("@/lib/db", () => ({ getD1: () => (globalThis as { DB?: D1 }).DB ?? null }));

it("uses the exact unused time and rounds only the rupiah amount", () => {
  expect(prorata(30000, 20 * DAY, 30 * DAY)).toBe(20000);
  expect(prorata(30000, 20 * DAY, 30 * DAY, 7000)).toBe(14000);
  expect(prorata(30000, DAY / 2, 30 * DAY)).toBe(500);
  expect(prorata(1, 1, 2)).toBe(1);
  const jan31 = wibInputSeconds("2026-01-31T11:30")!;
  expect(termEnd(jan31, 1, "month")).toBe(wibInputSeconds("2026-02-28T11:30"));
  expect(termEnd(wibInputSeconds("2024-02-29T18:00")!, 1, "year")).toBe(wibInputSeconds("2025-02-28T18:00"));
  expect(wibInputSeconds("2026-02-31T11:30")).toBeNull();
  expect(wibInputSeconds("2026-01-31T24:00")).toBeNull();
});

it("uses warranty to gate eligibility, never as the denominator", () => {
  const start = 1770000000;
  const row = { started_at: start, duration_value: 30, duration_unit: "day", warranty_type: "limited", warranty_value: 7, warranty_unit: "day", price: 30000, qty: 1, rate_bps: 10000 };
  expect(estimateLine(row, start + 7 * DAY)).toMatchObject({ status: "warranty_ended", amount: null, remaining: 23 * DAY });
  expect(estimateLine({ ...row, claimed_at: start + 5 * DAY }, start + 35 * DAY)).toMatchObject({ status: "ready", amount: 25000, remaining: 25 * DAY });
  expect(estimateLine({ ...row, duration_value: null }, start)).toMatchObject({ status: "review", amount: null });
  expect(estimateLine({ ...row, warranty_type: "none" }, start)).toMatchObject({ status: "no_warranty", amount: null });
});

it("adds only a protected deeplink in the paid Market keyboard", () => {
  const siteUrl = "https://axvara.tech", orderCode = "AXV-20261118-ABCD1234";
  const result = [{ text: "Hitung Refund", url: `${siteUrl}/admin/refund?code=${orderCode}` }];
  expect(telegramOrderAdminKeyboard({ siteUrl, orderCode }).inline_keyboard.flat().some(button => button.text === "Hitung Refund")).toBe(false);
  expect(telegramOrderAdminKeyboard({ siteUrl, orderCode, paidMarket: true }).inline_keyboard.at(-1)).toEqual(result);
  expect(webPaidAdminKeyboard({ siteUrl, orderCode, customerWa: "", orderKind: "apps" }).inline_keyboard.at(-1)).toEqual(result);
  expect(webPaidAdminKeyboard({ siteUrl, orderCode, customerWa: "", orderKind: "pedia" }).inline_keyboard.flat()).not.toContainEqual(result[0]);
  expect(webOrderAdminKeyboard({ siteUrl, orderCode, customerWa: "6281234567890", customerName: "Buyer", paidMarket: true }).inline_keyboard.at(-1)).toEqual(result);
});

it("uses real D1 for snapshots, handover, scoped reads, report lock, share rotation and revocation", async () => {
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ["DB"] });
  const globals = globalThis as { DB?: D1 };
  try {
    const db = await runtime.getD1Database("DB");
    globals.DB = db as unknown as D1;
    const old = "AXV-20261117-OLDTE123", code = "AXV-20261118-NEWT1234";
    const items = [{ variant_id: 1, product_id: 1, name: "Paket A", qty: 2, price: 30000, fulfillment_mode: "unique", unique_units: true }, { variant_id: 2, product_id: 2, name: "Paket B", qty: 1, price: 5000 }];
    const order = (code: string, kind = "apps") => db.prepare(`INSERT INTO orders VALUES(?,?,'lunas','paid','id',65000,1,'pin6','fixture-quote','081234567890','private@example.org',?)`).bind(code,kind,JSON.stringify(items));
    await db.batch([
      db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY,order_kind TEXT,status TEXT,payment_status TEXT,locale TEXT,subtotal INTEGER,buyer_access_version INTEGER,buyer_access_format TEXT,quote_id TEXT,customer_wa TEXT,customer_email TEXT,items TEXT)"),
      db.prepare("CREATE TABLE product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,duration_value INTEGER,duration_unit TEXT,warranty_type TEXT,warranty_value INTEGER,warranty_unit TEXT)"),
      db.prepare("CREATE TABLE order_contact_attempts(order_code TEXT,client_hash TEXT,window_id INTEGER,failures INTEGER,PRIMARY KEY(order_code,client_hash))"),
      db.prepare("CREATE TABLE fulfillment_items(order_code TEXT,item_index INTEGER,status TEXT,PRIMARY KEY(order_code,item_index))"),
      db.prepare("INSERT INTO product_variants VALUES(1,1,30,'day','limited',7,'day'),(2,2,1,'month','none',NULL,NULL)"), order(old),
    ]);
    const migration = readFileSync("drizzle/migrations/0137_market_refund_estimates.sql", "utf8");
    const triggers = migration.match(/CREATE TRIGGER[\s\S]*?\nEND;/g) ?? [];
    const tables = migration.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g, "").replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch([...tables, ...triggers].map(sql => db.prepare(sql)));
    await db.batch([order(code), order("AXP-20261118-PEDIA123", "pedia"), db.prepare("UPDATE product_variants SET duration_value=1 WHERE id=1"),
      db.prepare("INSERT INTO fulfillment_items VALUES(?,0,'queued'),(?,1,'delivered')").bind(code,code),
      db.prepare("UPDATE fulfillment_items SET status='delivered' WHERE order_code=? AND item_index=0").bind(code),
    ]);
    const stored = (await db.prepare("SELECT * FROM market_refund_items ORDER BY item_index").all()).results as Record<string, unknown>[];
    expect(stored.map(row => [row.name, row.qty, row.unit_number])).toEqual(expandDeliveryLines(items).map(row => [row.name, row.qty, row.unit_number ?? null]));
    expect(stored.map(row => row.duration_value)).toEqual([30,1,30]);
    expect(stored.map(row => row.started_at != null)).toEqual([true,true,false]);
    const { POST: buyer } = await import("@/app/api/refund/route");
    const { POST: admin } = await import("@/app/api/admin/refund/route");
    const { createBuyerAccessSession } = await import("@/lib/order-access");
    const p1 = await createBuyerAccessSession((await db.prepare("SELECT * FROM orders WHERE code=?").bind(code).first())!);
    const post = (data: object, head: Record<string, string> = {}) => new NextRequest("http://localhost/api/refund", { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json", ...head } });
    const adminPost = (action: string, extra: object = {}, invoice = code) => admin(post({ code: invoice, action, ...extra }, { "x-fixture-admin": "yes" }));
    expect((await buyer(post({ code }))).status).toBe(404);
    expect((await admin(post({ code, action: "lookup" }))).status).toBe(401);
    expect((await buyer(post({ code: old }, { "x-buyer-access-session": p1! }))).status).toBe(404);
    const valid = await buyer(post({ code }, { "x-buyer-access-session": p1! }));
    expect(valid.status).toBe(200);
    expect(valid.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await valid.json()).toMatchObject({ estimate: { lines: [{ status: "ready" }, { status: "no_warranty" }, { status: "waiting" }] } });
    expect(await (await adminPost("lookup", {}, old)).json()).toMatchObject({ estimate: { state: "review" } });
    expect((await adminPost("share")).status).toBe(422);
    expect((await adminPost("share", { items: [1] })).status).toBe(422);
    expect((await adminPost("share", { items: [0] })).status).toBe(200);
    const start = Number(stored[0].started_at);
    expect((await adminPost("claim", { item: 0, claim: start - 1 })).status).toBe(422);
    expect((await adminPost("claim", { item: 0, claim: start })).status).toBe(200);
    expect((await adminPost("claim", { item: 0, claim: start })).status).toBe(409);
    const first = await (await adminPost("share", { items: [0] })).json() as { token: string };
    const shared = await buyer(post({ token: first.token }));
    const payload = await shared.text();
    expect(shared.status).toBe(200);
    expect(payload).toContain('"amount":30000');
    expect(payload).not.toMatch(/private@example|081234|fixture-quote|Paket B|AXV-/);
    expect((await buyer(post({ code, token: first.token.replace(/.$/, first.token.endsWith("0") ? "1" : "0") }))).status).toBe(404);
    const latest = await (await adminPost("share", { items: [0] })).json() as { token: string };
    expect((await buyer(post({ token: first.token }))).status).toBe(404);
    await db.prepare("UPDATE market_refund_shares SET expires_at=0 WHERE order_code=?").bind(code).run();
    expect((await buyer(post({ token: latest.token }))).status).toBe(404);
    const again = await (await adminPost("share", { items: [0] })).json() as { token: string };
    expect((await adminPost("revoke")).status).toBe(200);
    expect((await buyer(post({ token: again.token }))).status).toBe(404);
    await db.batch([db.prepare("UPDATE fulfillment_items SET status='delivered' WHERE order_code=?").bind(code), db.prepare("UPDATE orders SET payment_status='refunded' WHERE code=?").bind(code)]);
    expect((await db.prepare("SELECT started_at FROM market_refund_items WHERE order_code=? AND item_index=0").bind(code).first())?.started_at).toBe(start);
    expect(await (await adminPost("lookup")).json()).toMatchObject({ estimate: { state: "refunded", lines: [] } });
  } finally { delete globals.DB; await runtime.dispose(); }
}, 30_000);
