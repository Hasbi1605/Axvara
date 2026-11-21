import { afterEach, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { processSkPendingOrders, recoverStaleSkClaims } from "@/lib/sekalipay/order";
import { processWrPendingOrders, recoverStaleClaims } from "@/lib/warung-rebahan/order";
import { createD1Fixture } from "../helpers/d1-fixture";
import { seedWrCatalog, seedWrFulfillmentItem, seedWrOrder } from "../warung-rebahan/helpers";

export const families = ["premium", "jaspay", "sk"] as const;
export type Family = typeof families[number];
export const due = { skipOrphanProbe: true, limit: 1 };
export const skPreflight = ["GET /api/v1/item/1095", "GET /api/v1/balance"];
export const skReject = () => Response.json({ message: "PRODUCT_TEMPORARILY_UNAVAILABLE" }, { status: 503 });
export const wrReject = (stock: boolean) => Response.json({ success: false, message: stock ? "OUT_OF_STOCK" : "INVALID_VARIANT" }, { status: stock ? 409 : 422 });
export const jaspayDetail = { invoice: "FIXTURE-INVOICE", status: "completed" as const, product: "PROD", quantity: 1, success_count: 1,
  accounts: [{ email: "account@fixture.test", password: "fixture" }] };

let active: ReturnType<typeof createD1Fixture> | undefined;
export function cleanupFixtures() {
  afterEach(() => {
    active?.close();
    active = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
}

export function setup(family: Family) {
  const fx = active = createD1Fixture();
  const sk = family === "sk", jaspay = family === "jaspay";
  const prefix = sk ? "sk" : "wr";
  const table = `${prefix}_order_links`;
  const invoice = sk ? "sk_invoice" : "wr_order_id";
  const code = "AXV-WRSK-FIXTURE";
  const ref = `sk:${code}:1095:1`;
  const endpoint = sk ? "/api/v1/trx" : jaspay ? "/api/v1/jaspay/order" : "/api/v1/order";
  const buy = `POST ${endpoint}`;
  const lookup = `GET /api/v1/trx/${encodeURIComponent(ref)}`;
  for (const [key, value] of Object.entries({
    WARUNG_REBAHAN_ENABLED: "true", WARUNG_REBAHAN_AUTO_ORDER_ENABLED: "true", WARUNG_REBAHAN_AUTO_ORDER_MBO: "true",
    WARUNG_REBAHAN_API_KEY: "fixture", WARUNG_REBAHAN_BASE_URL: "", WARUNG_REBAHAN_PROXY_URL: "",
    SEKALIPAY_ENABLED: "true", SEKALIPAY_AUTO_ORDER_ENABLED: "true", SEKALIPAY_API_KEY: "fixture",
    SEKALIPAY_BASE_URL: "", SEKALIPAY_PROXY_URL: "", SEKALIPAY_SANDBOX: "false",
    TELEGRAM_BOT_ENABLED: "false", RESEND_API_KEY: "", FULFILLMENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  })) vi.stubEnv(key, value);
  seedWrCatalog(fx);
  seedWrOrder(fx, code);
  seedWrFulfillmentItem(fx, code);
  if (sk) fx.sql.exec("UPDATE product_variants SET wr_variant_id=NULL,sk_variant_id='1095'");
  if (jaspay) fx.sql.exec(`UPDATE wr_variants SET wr_variant_id='jaspay:PROD:PACK', wr_max_quantity=5;
    UPDATE product_variants SET wr_variant_id='jaspay:PROD:PACK'`);
  const variant = sk ? "1095" : jaspay ? "jaspay:PROD:PACK" : "var-1";
  fx.sql.prepare(`INSERT INTO ${table}(id,order_code,${prefix}_variant_id,${prefix}_cost,quantity,status,idempotency_key)
    VALUES(1,?,?,5000,1,'pending',?)`).run(code, variant, sk ? ref : null);
  const row = () => fx.sql.prepare(`SELECT * FROM ${table} WHERE id=1`).get()!;
  const set = (fields: string) => fx.sql.exec(`UPDATE ${table} SET ${fields} WHERE id=1`);
  const order = () => fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
  const items = () => fx.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code=? ORDER BY item_index").all(code).map(r => r.status);
  const bind = (direction: "both" | "forward" | "reverse" = "both") => {
    if (direction !== "reverse") set("fulfillment_item_id=1");
    if (direction !== "forward") fx.sql.exec(`UPDATE fulfillment_items SET ${prefix}_link_id=1 WHERE id=1`);
  };
  const sibling = () => fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status)
    VALUES(?,1,1,1,1,'manual','web','queued')`).run(code);
  const receipt = (status = sk ? "paid" : "processing") => Response.json(sk
    ? { data: { invoice: "FIXTURE-INVOICE", ref_id: ref, status } }
    : { success: true, data: jaspay ? { ...jaspayDetail, status } : { order_id: "FIXTURE-INVOICE", status } });
  return { fx, code, ref, prefix, table, invoice, buy, lookup, row, set, order, items, bind, sibling, receipt,
    db: createDatabaseAccess(fx.db), budget: (limit = 100) => createBudgetedDatabase(limit, 2, fx.db),
    process: sk ? processSkPendingOrders : processWrPendingOrders,
    recover: sk ? recoverStaleSkClaims : recoverStaleClaims };
}

// Fixture mutation happens after the public read returns, not by matching SQL strings.
export function afterRead(db: DatabaseAccess, method: "queryAll" | "queryFirst", hook: () => void | Promise<void>) {
  const original = db[method];
  Object.assign(db, { [method]: async (query: string, ...params: unknown[]) => {
    const result = await original(query, ...params);
    Object.assign(db, { [method]: original });
    await hook();
    return result;
  } });
}

type ResponseFactory = (body: unknown) => Response | Promise<Response>;
export function wire(routes: Record<string, ResponseFactory> = {}) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const unexpected: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`;
    calls.push(key);
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    bodies.push(body);
    if (routes[key]) return routes[key](body);
    if (key === skPreflight[0]) return Response.json({ data: { id: 1095, price: 5000, stock: 10, order_process: "auto" } });
    if (key === skPreflight[1]) return Response.json({ data: { balance: 100000 } });
    if (key === "POST /emails") return Response.json({ id: "fixture-mail" });
    unexpected.push(key);
    throw new Error(`Unexpected fixture request: ${key}`);
  }));
  return { calls, bodies, unexpected };
}
