// tests/games-sk-dispatch.test.ts — transaksi Sekalipay H2H Games: fence,
// preflight, parser, polling, webhook, dan bukti "tidak ada POST kedua".
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { createBudgetedDatabase } from "@/lib/db-access";
import { processGamesPaidOrders, SK_MISSING_INVOICE_GRACE_MS } from "@/lib/games/dispatch";
import { applySkTransactionDetail } from "@/lib/games/sk-dispatch";
import { computeSkSignature, createSkTransaction } from "@/lib/sekalipay/client";

const notify = vi.hoisted(() => vi.fn(async () => "sent"));
vi.mock("@/lib/games/notify", () => ({ notifyGamesNeedsCheck: notify }));

const CONTRACT = JSON.stringify({
  version: 1,
  fields: [{ key: "note", label: "User ID", required: true, input: "text", min: 1, max: 50 }],
  requires_zone_id: false,
  validation_available: false,
  open_denom: false,
  supported: true,
  reason: null,
});
const WEBHOOK_SECRET = "sk-whsec";
let fx: ReturnType<typeof createD1Fixture>;

const db = () => createDatabaseAccess(fx.db);
const item = (code: string) => fx.sql.prepare("SELECT * FROM games_order_items WHERE order_code=?").get(code) as Record<string, unknown>;
const attempt = (code: string) => fx.sql.prepare("SELECT * FROM games_dispatch_attempts WHERE order_code=? ORDER BY attempt_no").all(code) as Record<string, unknown>[];
const makePollDue = (code: string) => fx.sql.prepare("UPDATE games_order_items SET last_polled_at=datetime('now','-3 minutes') WHERE order_code=?").run(code);

function seedProduct(over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: 1, buyer_sku_code: "sk:101", supplier: "sekalipay", supplier_active: 1,
    sk_variant_id: 101, sk_product_id: 33, sk_product_name: "Mobile Legends", game_slug: "mobile-legends",
    game_brand: "Mobile Legends", product_name: "86 Diamond", cost: 10000, sell_price: 11000,
    stock: 100, min_order: 1, enabled: 1, required_fields_json: CONTRACT, ...over,
  };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
}

function seedOrder(code: string, over: { itemStatus?: string; paid?: boolean; target?: Record<string, string> } = {}) {
  insertTestOrder(fx.sql, code, {
    channel: "web",
    status: over.paid === false ? "pending" : "lunas",
  });
  fx.sql.prepare(`INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,quantity,unit_price,total,
      cost_snapshot,max_price,status,attempt_no,supplier,sk_variant_id,target_snapshot,fields_snapshot)
    VALUES(?,1,'sk:101','12345',1,11000,11000,10000,10500,?,1,'sekalipay',101,?,?)`)
    .run(code, over.itemStatus ?? "awaiting_payment", JSON.stringify(over.target ?? { note: "12345" }), JSON.stringify(over.target ?? { note: "12345" }));
}

const detail = (ref: string, over: Record<string, unknown> = {}, itemOver: Record<string, unknown> = {}, h2hOver: Record<string, unknown> = {}) => ({
  id: 1, ref_id: ref, invoice: "INV-1", payment_method: "balance", status: "completed",
  price: 10000, fees: 0, amount: 10000,
  items: [{ variant_id: 101, variant_name: "86 Diamond", product_name: "Mobile Legends", product_license: null,
    seller_note: null, price: 10000, qty: 1, note: "12345", order_process: "h2h", ...itemOver }],
  h2h_results: [{ variant_id: 101, sn: "SN-OK", dispatch_status: "completed", log_message: "ok",
    total_units: 1, delivered_units: 1, failed_units: 0, units: [{ sn: "SN-OK" }], ...h2hOver }],
  ...over,
});

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
function stubSk(handlers: {
  detail?: (n: number) => unknown;
  balance?: () => unknown;
  create?: (body: Record<string, unknown>) => { status?: number; body?: unknown };
  transaction?: (ref: string) => { status?: number; body?: unknown };
}) {
  calls = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method ?? "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ url: href, method, body });
    if (href.includes("/v1/item/validate")) {
      return new Response(JSON.stringify({ message: "ok", data: { display_name: "Player", account_name: "Player", region: null, cached: false } }), { status: 200 });
    }
    if (href.includes("/v1/item/") && !href.includes("/validate")) {
      const n = calls.filter((call) => call.url.includes("/v1/item/")).length - 1;
      return new Response(JSON.stringify({ message: "ok", data: handlers.detail ? handlers.detail(n) : {
        id: 101, name: "86 Diamond", price: 10000, stock: 100, order_process: "h2h", provider_meta: null,
        required_fields: [{ key: "note", label: "User ID", required: true }],
        validation: { available: false, requires_zone_id: false, fields: [] }, description: "",
      } }), { status: 200 });
    }
    if (href.includes("/v1/balance")) {
      return new Response(JSON.stringify({ message: "ok", data: handlers.balance ? handlers.balance() : { balance: 50000 } }), { status: 200 });
    }
    if (href.includes("/v1/trx") && method === "POST") {
      const res = handlers.create?.(body!) ?? { status: 200, body: { message: "ok", data: { invoice: "INV-1", ref_id: body!.ref_id, status: "paid", price: 10000, fees: 0, amount: 10000 } } };
      return new Response(JSON.stringify(res.body), { status: res.status ?? 200 });
    }
    if (href.includes("/v1/trx/") && method === "GET") {
      const ref = decodeURIComponent(href.split("/v1/trx/")[1]!);
      const res = handlers.transaction?.(ref) ?? { status: 200, body: { message: "ok", data: detail(ref) } };
      return new Response(JSON.stringify(res.body), { status: res.status ?? 200 });
    }
    throw new Error(`unexpected SK fixture request ${method} ${href}`);
  });
  vi.stubGlobal("fetch", f);
  return f;
}
const postCalls = () => calls.filter((call) => call.method === "POST" && call.url.includes("/v1/trx"));

beforeEach(async () => {
  fx = createD1Fixture();
  await insertTestProduct(fx.sql);
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "sk-test");
  vi.stubEnv("SEKALIPAY_PROXY_URL", "");
  vi.stubEnv("SEKALIPAY_SANDBOX", "");
  vi.stubEnv("DIGIFLAZZ_USERNAME", "");
  vi.stubEnv("DIGIFLAZZ_API_KEY", "");
  vi.stubEnv("SEKALIPAY_WEBHOOK_SECRET", WEBHOOK_SECRET);
  notify.mockClear();
  seedProduct();
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("SK dispatch", () => {
  it("sends note as a cart field (zone sibling), fences before POST, and only succeeds from a completed H2H GET", async () => {
    seedOrder("AXG-20261112-SK000001", { target: { note: "12345", zone_id: "6789" } });
    fx.sql.prepare(`UPDATE games_products SET required_fields_json=? WHERE id=1`).run(JSON.stringify({
      version: 1,
      fields: [
        { key: "note", label: "User ID", required: true, input: "text", min: 1, max: 50 },
        { key: "zone_id", label: "Zone ID", required: true, input: "text", min: 1, max: 20 },
      ],
      requires_zone_id: true, validation_available: false, open_denom: false, supported: true, reason: null,
    }));
    const f = stubSk({ detail: () => ({
      id: 101, name: "86 Diamond", price: 10000, stock: 100, status: "on", min_order: 1,
      order_process: "h2h", provider_meta: null,
      required_fields: [
        { key: "note", label: "User ID", required: true },
        { key: "zone_id", label: "Zone ID", required: true },
      ],
      validation: { available: false, requires_zone_id: true, fields: [] }, description: "",
    }) });
    const run = await processGamesPaidOrders(undefined, db());
    expect(run).toMatchObject({ promoted: 1, dispatched: 1, polled: 0 });
    const sent = postCalls();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain("/v1/trx");
    expect(sent[0].body).toMatchObject({ ref_id: "AXG20261112SK000001", carts: [{ item_id: 101, quantity: 1, note: "12345", zone_id: "6789" }] });
    const row = item("AXG-20261112-SK000001");
    expect(row).toMatchObject({ status: "pending", supplier: "sekalipay", sk_invoice: "INV-1", supplier_ref: "AXG20261112SK000001" });
    expect(attempt("AXG-20261112-SK000001")[0]).toMatchObject({ ref_id: "AXG20261112SK000001", request_sent_at: expect.any(String), sk_invoice: "INV-1", status: "pending" });
    expect(JSON.parse(String(attempt("AXG-20261112-SK000001")[0].payload_snapshot))).toMatchObject({ ref_id: "AXG20261112SK000001" });
    expect(row.sn).toBeNull();

    makePollDue("AXG-20261112-SK000001");
    await processGamesPaidOrders(undefined, db());
    expect(postCalls()).toHaveLength(1);
    expect(item("AXG-20261112-SK000001")).toMatchObject({ status: "success", sn: "SN-OK" });
    expect(attempt("AXG-20261112-SK000001")[0]).toMatchObject({ status: "success", price: 10000, sn: "SN-OK" });
    expect(f).toHaveBeenCalled();
  });

  it("fulfills a paid item whose cached and live stock are -1 (unlimited) with exactly one POST", async () => {
    fx.sql.prepare("UPDATE games_products SET stock=-1 WHERE id=1").run();
    seedOrder("AXG-20261112-STOCK001");
    stubSk({ detail: () => ({
      id: 101, name: "86 Diamond", price: 10000, stock: -1, status: "on", min_order: 1,
      order_process: "h2h", provider_meta: null,
      required_fields: [{ key: "note", label: "User ID", required: true }],
      validation: { available: false, requires_zone_id: false, fields: [] }, description: "",
    }) });
    expect(await processGamesPaidOrders(undefined, db())).toMatchObject({ dispatched: 1, needs_check: 0 });
    expect(postCalls()).toHaveLength(1);
    makePollDue("AXG-20261112-STOCK001");
    expect(await processGamesPaidOrders(undefined, db())).toMatchObject({ polled: 1 });
    expect(item("AXG-20261112-STOCK001")).toMatchObject({ status: "success", sn: "SN-OK" });
    expect(postCalls()).toHaveLength(1);
  });

  it.each([["zero", 0], ["negative -2", -2]])("rejects cached stock %s before POST", async (_name, stock) => {
    fx.sql.prepare("UPDATE games_products SET stock=? WHERE id=1").run(stock);
    seedOrder(`AXG-20261112-STOCK${String(stock).replace("-", "N")}`);
    stubSk({});
    await processGamesPaidOrders(undefined, db());
    expect(postCalls()).toHaveLength(0);
    expect(item(`AXG-20261112-STOCK${String(stock).replace("-", "N")}`).status).toBe("needs_check");
    expect(attempt(`AXG-20261112-STOCK${String(stock).replace("-", "N")}`)[0].request_sent_at).toBeNull();
  });

  it("never POSTs twice after a timeout; polls the same ref and marks 404-missing after grace", async () => {
    seedOrder("AXG-20261112-SK000002");
    stubSk({ create: () => ({ status: 502, body: { message: "bad gateway" } }) });
    expect(await processGamesPaidOrders(undefined, db())).toMatchObject({ dispatched: 1, needs_check: 0 });
    expect(item("AXG-20261112-SK000002")).toMatchObject({ status: "pending" });
    expect(attempt("AXG-20261112-SK000002")[0]).toMatchObject({ status: "ambiguous", request_sent_at: expect.any(String) });
    makePollDue("AXG-20261112-SK000002");
    stubSk({ transaction: () => ({ status: 404, body: { message: "TRX_NOT_FOUND" } }) });
    await processGamesPaidOrders(undefined, db());
    expect(postCalls()).toHaveLength(0);
    expect(item("AXG-20261112-SK000002")).toMatchObject({ status: "pending" });
    fx.sql.prepare("UPDATE games_dispatch_attempts SET request_sent_at=datetime('now',? ) WHERE order_code=?")
      .run(`-${Math.ceil(SK_MISSING_INVOICE_GRACE_MS / 1000) + 60} seconds`, "AXG-20261112-SK000002");
    makePollDue("AXG-20261112-SK000002");
    await processGamesPaidOrders(undefined, db());
    expect(item("AXG-20261112-SK000002")).toMatchObject({ status: "needs_check" });
    expect(notify).toHaveBeenCalled();
  });

  it("recovers a fenced crash without POST and waits on the same ref", async () => {
    seedOrder("AXG-20261112-SK000003", { itemStatus: "submitting" });
    fx.sql.exec(`UPDATE games_order_items SET lease_until=datetime('now','-10 seconds'), submit_attempts=1 WHERE order_code='AXG-20261112-SK000003';
      INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status,supplier,request_sent_at,payload_snapshot)
      VALUES('AXG20261112SK000003','AXG-20261112-SK000003',1,'sk:101','submitting','sekalipay',datetime('now'),'{}')`);
    stubSk({ transaction: () => ({ status: 404, body: { message: "TRX_NOT_FOUND" } }) });
    const run = await processGamesPaidOrders(undefined, db());
    expect(run.recovered).toBe(1);
    expect(postCalls()).toHaveLength(0);
    expect(item("AXG-20261112-SK000003")).toMatchObject({ status: "pending" });
    expect(attempt("AXG-20261112-SK000003")[0].status).toBe("ambiguous");
  });

  it("releases an unsent claim (fence null) back to queued and reuses it on retry", async () => {
    seedOrder("AXG-20261112-SK000004", { itemStatus: "submitting" });
    fx.sql.exec(`UPDATE games_order_items SET lease_until=datetime('now','-10 seconds'), submit_attempts=1 WHERE order_code='AXG-20261112-SK000004';
      INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status,supplier)
      VALUES('AXG20261112SK000004','AXG-20261112-SK000004',1,'sk:101','submitting','sekalipay')`);
    stubSk({});
    await processGamesPaidOrders(undefined, db());
    expect(postCalls()).toHaveLength(1);
    expect(attempt("AXG-20261112-SK000004")).toHaveLength(1);
    expect(item("AXG-20261112-SK000004").status).toBe("pending");
  });

  it("blocks a moved live price or insufficient balance before the fence and sends nothing", async () => {
    seedOrder("AXG-20261112-SK000005");
    stubSk({ detail: () => ({ id: 101, name: "x", price: 20000, stock: 100, order_process: "h2h", provider_meta: null, required_fields: [{ key: "note", label: "User ID", required: true }], validation: null }) });
    await processGamesPaidOrders(undefined, db());
    expect(postCalls()).toHaveLength(0);
    expect(item("AXG-20261112-SK000005")).toMatchObject({ status: "needs_check" });
    expect(attempt("AXG-20261112-SK000005")[0].request_sent_at).toBeNull();

    seedOrder("AXG-20261112-SK000006");
    stubSk({ balance: () => ({ balance: 100 }) });
    await processGamesPaidOrders(undefined, db());
    expect(postCalls()).toHaveLength(0);
    expect(item("AXG-20261112-SK000006")).toMatchObject({ status: "queued" });
    expect(attempt("AXG-20261112-SK000006")[0].request_sent_at).toBeNull();
    expect(item("AXG-20261112-SK000006").lease_until).toBeTruthy();
  });

  it.each([
    ["failed sn", { h2h: { sn: "failed: item unavailable" } }, "needs_check"],
    ["failed status", { h2h: { dispatch_status: "failed" } }, "needs_check"],
    ["partial units", { h2h: { dispatch_status: "partial", delivered_units: 0 } }, "needs_check"],
    ["wrong ref", { top: { ref_id: "OTHER" } }, "needs_check"],
    ["wrong variant", { item: { variant_id: 999 } }, "needs_check"],
    ["wrong invoice", { top: { invoice: "INV-OTHER" } }, "needs_check"],
    ["completed without h2h", { top: { h2h_results: [] } }, "needs_check"],
    ["refunded without h2h", { top: { status: "refunded", h2h_results: [] } }, "needs_check"],
    ["refunded with completed h2h", { top: { status: "refunded" } }, "needs_check"],
    ["cancelled without h2h", { top: { status: "cancelled", h2h_results: [] } }, "needs_check"],
    ["expired without h2h", { top: { status: "expired", h2h_results: [] } }, "needs_check"],
  ])("never reports success for %s", async (_name, fixture, expected) => {
    seedOrder("AXG-20261112-SK000007");
    stubSk({});
    await processGamesPaidOrders(undefined, db());
    makePollDue("AXG-20261112-SK000007");
    const fxSpec = fixture as { top?: Record<string, unknown>; item?: Record<string, unknown>; h2h?: Record<string, unknown> };
    stubSk({ transaction: (ref) => ({
      status: 200,
      body: { message: "ok", data: detail(ref, fxSpec.top ?? {}, fxSpec.item ?? {}, fxSpec.h2h ?? {}) },
    }) });
    await processGamesPaidOrders(undefined, db());
    expect(item("AXG-20261112-SK000007").status).toBe(expected);
    expect(postCalls()).toHaveLength(0);
  });

  it("marks completed H2H but incomplete transaction as pending, then success once completed", async () => {
    seedOrder("AXG-20261112-SK000008");
    stubSk({});
    await processGamesPaidOrders(undefined, db());
    makePollDue("AXG-20261112-SK000008");
    stubSk({ transaction: (ref) => ({ status: 200, body: { message: "ok", data: detail(ref, { status: "paid" }) } }) });
    await processGamesPaidOrders(undefined, db());
    expect(item("AXG-20261112-SK000008").status).toBe("pending");
    makePollDue("AXG-20261112-SK000008");
    stubSk({});
    await processGamesPaidOrders(undefined, db());
    expect(item("AXG-20261112-SK000008")).toMatchObject({ status: "success", sn: "SN-OK" });
  });

  it("dispatches exactly once under concurrent runs", async () => {
    seedOrder("AXG-20261112-SK000009");
    stubSk({});
    const [a, b] = await Promise.all([
      processGamesPaidOrders(undefined, createDatabaseAccess(fx.db)),
      processGamesPaidOrders(undefined, createDatabaseAccess(fx.db)),
    ]);
    expect(a.dispatched + b.dispatched).toBe(1);
    expect(postCalls()).toHaveLength(1);
    expect(attempt("AXG-20261112-SK000009")).toHaveLength(1);
  });
});

describe("SK Games webhook", () => {
  const sign = async (body: Record<string, unknown>) => {
    const data = body.data as { ref_id: string; invoice: string; status?: string };
    return computeSkSignature(data.ref_id, data.invoice, data.status ?? "", WEBHOOK_SECRET);
  };
  async function hook(body: Record<string, unknown>) {
    const raw = JSON.stringify(body);
    const { POST } = await import("@/app/api/webhook/sekalipay/route");
    return POST(new NextRequest("https://axvara.test/api/webhook/sekalipay", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": await sign(body) },
      body: raw,
    }));
  }
  const paidEvent = (ref: string, invoice = "INV-1", status = "completed") => ({
    event: "order.completed", timestamp: "2026-11-12T00:00:00Z",
    data: { invoice, ref_id: ref, status },
  });

  it("applies a known Games ref via GET and dedupes redelivery", async () => {
    seedOrder("AXG-20261112-SK000010");
    stubSk({});
    await processGamesPaidOrders(undefined, db());
    stubSk({ transaction: () => ({ status: 200, body: { message: "ok", data: detail("AXG20261112SK000010") } }) });
    const res = await hook(paidEvent("AXG20261112SK000010"));
    expect(res.status).toBe(200);
    expect(item("AXG-20261112-SK000010")).toMatchObject({ status: "success", sn: "SN-OK" });
    const again = await hook(paidEvent("AXG20261112SK000010"));
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM dana_webhook_events WHERE provider='sekalipay_games'").get()).toEqual({ n: 1 });
  });

  it("keeps unknown premium refs on the existing retryable path", async () => {
    const res = await hook(paidEvent("PREMIUM-REF-1"));
    expect(res.status).toBe(500);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM dana_webhook_events WHERE provider='sekalipay_games'").get()).toEqual({ n: 0 });
  });

  it("rejects a signed wrong invoice hint without poisoning, then correct poll succeeds", async () => {
    seedOrder("AXG-20261112-SK000012");
    stubSk({});
    await processGamesPaidOrders(undefined, db());
    expect(attempt("AXG-20261112-SK000012")[0].sk_invoice).toBe("INV-1");
    stubSk({ transaction: (ref) => ({ status: 200, body: { message: "ok", data: detail(ref) } }) });
    const bad = await hook(paidEvent("AXG20261112SK000012", "INV-BAD"));
    expect(bad.status).toBe(503);
    expect(item("AXG-20261112-SK000012").status).toBe("pending");
    expect(attempt("AXG-20261112-SK000012")[0].sk_invoice).toBe("INV-1");
    expect(fx.sql.prepare("SELECT status,last_error FROM dana_webhook_events WHERE provider='sekalipay_games'").get())
      .toMatchObject({ status: "failed", last_error: "invoice_hint_mismatch" });
    makePollDue("AXG-20261112-SK000012");
    await processGamesPaidOrders(undefined, db());
    expect(item("AXG-20261112-SK000012")).toMatchObject({ status: "success", sn: "SN-OK" });
  });

  it("applies a webhook that arrives before the POST response persisted its invoice", async () => {
    const ref = "AXG20261112SK000013";
    seedOrder("AXG-20261112-SK000013", { itemStatus: "submitting" });
    fx.sql.exec(`UPDATE games_order_items SET lease_until=datetime('now','+200 seconds'), supplier_ref='${ref}', sk_invoice=NULL
      WHERE order_code='AXG-20261112-SK000013';
      INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status,supplier,request_sent_at,payload_snapshot)
      VALUES('${ref}','AXG-20261112-SK000013',1,'sk:101','submitting','sekalipay',datetime('now'),'{}')`);
    stubSk({ transaction: () => ({ status: 200, body: { message: "ok", data: detail(ref) } }) });
    const res = await hook(paidEvent(ref, "INV-1"));
    expect(res.status).toBe(200);
    expect(item("AXG-20261112-SK000013")).toMatchObject({ status: "success", sn: "SN-OK" });
    expect(attempt("AXG-20261112-SK000013")[0]).toMatchObject({ sk_invoice: "INV-1", price: 10000 });
    expect(postCalls()).toHaveLength(0);
  });

  it("does not ACK before state is persisted; a failed apply is retryable", async () => {
    seedOrder("AXG-20261112-SK000011");
    stubSk({});
    await processGamesPaidOrders(undefined, db());
    stubSk({ transaction: () => ({ status: 200, body: { message: "ok", data: detail("AXG20261112SK000011") } }) });
    fx.control.fail = (q) => q.startsWith("UPDATE games_order_items SET status='success'");
    const failed = await hook(paidEvent("AXG20261112SK000011"));
    expect(failed.status).toBe(503);
    fx.control.fail = null;
    const ok = await hook(paidEvent("AXG20261112SK000011"));
    expect(ok.status).toBe(200);
    expect(item("AXG-20261112-SK000011").status).toBe("success");
  });
});

describe("SK authoritative apply: cost + strict correlation", () => {
  function prime(code: string, ref: string, target: Record<string, string> = { note: "12345" }) {
    seedOrder(code, { itemStatus: "pending", target });
    fx.sql.prepare(`INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status,supplier,sk_invoice,request_sent_at)
      VALUES(?,?,1,'sk:101','pending','sekalipay','INV-1',datetime('now'))`).run(ref, code);
    fx.sql.prepare("UPDATE games_order_items SET sk_invoice='INV-1', supplier_ref=? WHERE order_code=?").run(ref, code);
    return ref;
  }
  const apply = (ref: string, data: Record<string, unknown>) =>
    applySkTransactionDetail(db(), data as never, { refId: ref });

  it("persists actual charged cost and accepts amount <= max_price", async () => {
    const ref = prime("AXG-20261112-COST0001", "AXGCOST0001");
    expect(await apply(ref, detail(ref))).toBe("success");
    expect(attempt("AXG-20261112-COST0001")[0]).toMatchObject({ status: "success", price: 10000, sn: "SN-OK" });
  });

  it("uses price+fees only when documented amount is absent (no double fee)", async () => {
    const ref = prime("AXG-20261112-COST0002", "AXGCOST0002");
    const payload = detail(ref, { amount: undefined, price: 10000, fees: 20 });
    expect(await apply(ref, payload)).toBe("success");
    expect(attempt("AXG-20261112-COST0002")[0].price).toBe(10020);
  });

  it.each([
    ["inflated amount", { amount: 999999, price: 999999, fees: 0 }, "actual_cost_exceeded"],
    ["malformed amount", { amount: "abc", price: 10000, fees: 0 }, "cost_unverifiable"],
    ["negative fees", { amount: 10000, price: 10000, fees: -5 }, "cost_unverifiable"],
    ["amount/price contradiction", { amount: 5000, price: 10000, fees: 0 }, "cost_unverifiable"],
  ])("flags %s as needs_check but preserves real SN/unit evidence", async (_name, cost, reason) => {
    const ref = prime(`AXG-20261112-COST${String(_name.length).padStart(4, "0")}`, `AXGCOST${_name.length}`);
    expect(await apply(ref, detail(ref, cost))).toBe("needs_check");
    const row = item(`AXG-20261112-COST${String(_name.length).padStart(4, "0")}`);
    expect(row).toMatchObject({ status: "needs_check", sn: "SN-OK" });
    expect(String(row.last_error)).toContain(reason);
    const att = attempt(String(row.order_code))[0];
    expect(att).toMatchObject({ status: "failed", sn: "SN-OK", dispatch_status: "completed" });
    expect(notify).toHaveBeenCalled();
  });

  it.each([
    ["duplicate/mixed cart", (ref: string) => {
      const base = detail(ref);
      return { ...base, items: [...base.items, { ...base.items[0], qty: 5, note: "OTHERTARGET" }] };
    }],
    ["empty items + wrong result", (ref: string) => ({ ...detail(ref), items: [], h2h_results: [{ variant_id: 999, sn: "SN", dispatch_status: "completed" }] })],
    ["duplicate h2h results", (ref: string) => {
      const base = detail(ref);
      return { ...base, h2h_results: [base.h2h_results[0], base.h2h_results[0]] };
    }],
    ["wrong h2h variant only", (ref: string) => ({ ...detail(ref), h2h_results: [{ ...detail(ref).h2h_results[0], variant_id: 999 }] })],
    ["wrong zone target", (ref: string) => detail(ref, {}, { target: "12345|9999" })],
  ])("rejects %s without success", async (_name, build) => {
    const ref = prime(`AXG-20261112-CORR${String(_name.length).padStart(4, "0")}`, `AXGCORR${_name.length}`, { note: "12345", zone_id: "6789" });
    expect(await apply(ref, build(ref))).toBe("needs_check");
    expect(item(`AXG-20261112-CORR${String(_name.length).padStart(4, "0")}`).status).toBe("needs_check");
  });

  it("accepts a full note|zone target when the response exposes it", async () => {
    const ref = prime("AXG-20261112-CORRZONE", "AXGCORRZONE", { note: "12345", zone_id: "6789" });
    expect(await apply(ref, detail(ref, {}, { target: "12345|6789" }))).toBe("success");
  });
});

describe("SK live preflight guard", () => {
  const baseDetail = (over: Record<string, unknown> = {}) => ({
    id: 101, name: "86 Diamond", price: 10000, stock: 100, order_process: "h2h", provider_meta: null,
    required_fields: [{ key: "note", label: "User ID", required: true }],
    validation: { available: false, requires_zone_id: false, fields: [] }, description: "", ...over,
  });
  it.each([
    ["status off", { status: "off" }, "queued"],
    ["stock 0", { stock: 0 }, "queued"],
    ["stock null", { stock: null }, "queued"],
    ["min_order 2", { min_order: 2 }, "needs_check"],
    ["contract adds zone", { required_fields: [
      { key: "note", label: "User ID", required: true },
      { key: "zone_id", label: "Zone ID", required: true },
    ], validation: { available: false, requires_zone_id: true, fields: [] } }, "needs_check"],
  ])("defers/blocks live %s without POST", async (_name, over, expected) => {
    seedOrder(`AXG-20261112-LIVE${String(_name.length).padStart(4, "0")}`);
    stubSk({ detail: () => baseDetail(over) });
    await processGamesPaidOrders(undefined, db());
    expect(postCalls()).toHaveLength(0);
    expect(item(`AXG-20261112-LIVE${String(_name.length).padStart(4, "0")}`).status).toBe(expected);
    expect(attempt(`AXG-20261112-LIVE${String(_name.length).padStart(4, "0")}`)[0].request_sent_at).toBeNull();
  });

  it("does not POST when the order is cancelled during preflight (fence requires paid)", async () => {
    seedOrder("AXG-20261112-LIVECANCEL");
    stubSk({ detail: () => {
      fx.sql.exec("UPDATE orders SET status='dibatalkan', payment_status='failed' WHERE code='AXG-20261112-LIVECANCEL'");
      return baseDetail();
    } });
    await processGamesPaidOrders(undefined, db());
    expect(postCalls()).toHaveLength(0);
    expect(attempt("AXG-20261112-LIVECANCEL")[0].request_sent_at).toBeNull();
  });
});

describe("SK cron budget runtime", () => {
  it("fits real 40-statement budget with stale needs_check, deep queue, and due poll", async () => {
    seedOrder("AXG-20261112-STALE001", { itemStatus: "pending" });
    fx.sql.exec(`INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status,supplier,sk_invoice,request_sent_at,created_at)
      VALUES('AXGSTALE001','AXG-20261112-STALE001',1,'sk:101','pending','sekalipay','INV-1',datetime('now','-25 hours'),datetime('now','-25 hours'))`);
    for (let i = 1; i <= 3; i++) seedOrder(`AXG-20261112-QUEUE00${i}`);
    seedOrder("AXG-20261112-POLL0001", { itemStatus: "pending" });
    fx.sql.exec(`INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status,supplier,sk_invoice,request_sent_at)
      VALUES('AXGPOLL0001','AXG-20261112-POLL0001',1,'sk:101','pending','sekalipay','INV-1',datetime('now'));
      UPDATE games_order_items SET last_polled_at=datetime('now','-3 minutes'), sk_invoice='INV-1' WHERE order_code='AXG-20261112-POLL0001'`);
    stubSk({});
    const budget = createBudgetedDatabase(40, 2, fx.db);
    await budget.access.queryFirst("SELECT 1 AS n");
    await budget.access.queryFirst("SELECT 2 AS n");
    const result = await processGamesPaidOrders(undefined, budget.access);
    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    expect(result.polled).toBeGreaterThanOrEqual(1);
    expect(result.needs_check).toBeGreaterThanOrEqual(1);
    expect(budget.used).toBeLessThanOrEqual(38);
    expect(result.budget_deferred).toBeUndefined();
  });
});

describe("SK client cart passthrough", () => {
  it("serializes note and sibling zone_id with validated ids", async () => {
    stubSk({});
    const created = await createSkTransaction({ refId: "AXG-REF", carts: [{ item_id: 101, quantity: 1, note: "Riot#Tag", zone_id: "SG" }] });
    expect(created.invoice).toBe("INV-1");
    const body = postCalls()[0].body!;
    expect(body).toMatchObject({ ref_id: "AXG-REF", carts: [{ item_id: 101, quantity: 1, note: "Riot#Tag", zone_id: "SG" }] });
    await expect(createSkTransaction({ refId: "AXG-REF", carts: [{ item_id: 0, quantity: 1 }] })).rejects.toThrow(/item_id/);
    await expect(createSkTransaction({ refId: "AXG-REF", carts: [{ item_id: 101, quantity: 1.5 }] })).rejects.toThrow(/quantity/);
  });
});
