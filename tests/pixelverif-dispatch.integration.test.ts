import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";
import { createPixelverifOrderLinks, processPixelverifOrders } from "@/lib/pixelverif/orders";
import { purgeExpiredPixelverifInputs } from "@/lib/pixelverif/purge";
import { processItem } from "@/lib/fulfillment/delivery/send";
import { sendWebDeliveryEmail } from "@/lib/fulfillment/delivery/buyer-email";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";

vi.mock("@/lib/fulfillment/delivery/buyer-email", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fulfillment/delivery/buyer-email")>("@/lib/fulfillment/delivery/buyer-email");
  return { ...actual, sendWebDeliveryEmail: vi.fn(async () => undefined) };
});

const ORDER_CODE = "AXV-20261122-PVDIS001";
const EMAIL = "buyer.fixture@gmail.com";
const PASSWORD = "fixture-password-marker";
const TOTP = "JBSWY3DPEHPK3PXP";

let fx: ReturnType<typeof createD1Fixture>;
let posts: RequestInit[];
let getCount: number;
let postMode: "created" | "ambiguous";
let pollStatus: "success" | "processing";
let creditsRemaining = 10;
let calls: string[];
let pollHttp = 200;
let byEmailOrder: Record<string, unknown>;
let postHttp = 201;
let postBody: unknown = null;
let pollBody: unknown = null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keyOf = (init: RequestInit) => (init.headers as Record<string, string>)["x-idempotency-key"];

const pricing = {
  success: true,
  version: 25,
  updated_at: 1234567890123,
  default_validity: 3,
  allowed_validities: [3],
  pricing: { normal: { "3": 1 }, full: { "3": 1.5 } },
};
const orderByEmail = {
  success: true,
  order: {
    order_id: "pv-order-001",
    email: EMAIL,
    status: "processing",
    flow_type: "normal",
    validity: 3,
    credit_cost: 1,
  },
};
const successfulOrder = {
  success: true,
  order: {
    order_id: "pv-order-001",
    email: EMAIL,
    status: "success",
    flow_type: "normal",
    validity: 3,
    credit_cost: 1,
    result: { link: "https://one.google.com/partner-eft-onboard/fixture" },
  },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function seedPaidOrder() {
  const secret = await encryptSecret(JSON.stringify({ pv_email: EMAIL, pv_password: PASSWORD, pv_totp_secret: TOTP }));
  const items = [{
    product_id: 1,
    variant_id: 1,
    name: "Pixel fixture — Pixel variant",
    price: 21500,
    qty: 1,
    pixelverif_fingerprint: "fixture-fingerprint",
    pixelverif_eligibility: {
      version: 1,
      flow_type: "normal",
      validity: 3,
      sku: "PV-NORMAL-3",
      source_variant_id: 1,
      cost_usd: 1,
    },
  }];
  fx.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel,supplier_purchase_disabled)
    VALUES(?,?,?,?,?,?,?,?,'lunas','paid','web',0)`)
    .run(ORDER_CODE, "Fixture", "628000000000", "buyer@example.test", JSON.stringify(items), 21500, "qris", "-");
  fx.sql.prepare(`INSERT INTO pixelverif_buyer_inputs
    (order_code,item_index,input_ciphertext,input_iv,email_masked,fingerprint)
    VALUES(?,?,?,?,?,?)`).run(ORDER_CODE, 0, secret.ciphertext, secret.iv, "bu***@gmail.com", "fixture-fingerprint");
  const db = createDatabaseAccess(fx.db);
  await expect(createPixelverifOrderLinks(ORDER_CODE, db)).resolves.toBe(1);
}

beforeEach(() => {
  stubFulfillmentKey();
  fx = createD1Fixture();
  posts = [];
  getCount = 0;
  postMode = "created";
  pollStatus = "success";
  creditsRemaining = 10;
  calls = [];
  pollHttp = 200;
  postHttp = 201;
  postBody = null;
  pollBody = null;
  // Provider README: created_at is epoch ms; "now" = created by this test's send.
  byEmailOrder = { ...orderByEmail.order, created_at: Date.now() + 1_000 };
  vi.stubEnv("PIXELVERIF_ENABLED", "true");
  vi.stubEnv("PIXELVERIF_SYNC_ENABLED", "true");
  vi.stubEnv("PIXELVERIF_API_KEY", "pv-fixture-secret");
  vi.stubEnv("PIXELVERIF_API_BASE_URL", "https://pixel.test");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "https://pixel.test/api/pricing") return jsonResponse(pricing);
    if (url === "https://pixel.test/api/credits") return jsonResponse({ success: true, credits_remaining: creditsRemaining });
    if (url === "https://pixel.test/api/order" && init?.method === "POST") {
      posts.push(init);
      if (postMode === "ambiguous") throw new Error("fixture network timeout after provider may have accepted");
      return jsonResponse(postBody ?? { success: true, order_id: "pv-order-001", flow_type: "normal", validity: 3 }, postHttp);
    }
    if (url.startsWith("https://pixel.test/api/order-by-email")) return jsonResponse({ success: true, order: byEmailOrder });
    if (url === "https://pixel.test/api/order/pv-order-001") {
      getCount++;
      if (pollHttp !== 200) return jsonResponse({ success: false }, pollHttp);
      return jsonResponse(pollBody ?? (pollStatus === "success" ? successfulOrder : orderByEmail));
    }
    throw new Error(`Unexpected Pixel fixture URL: ${url}`);
  }));
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,source,fulfillment_mode,pixelverif_family)
    VALUES(1,'Pixel fixture','pixel-fixture',21500,2,1,0,'manual','manual','google_ai_pro_3m');
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,fulfillment_mode,pixelverif_flow_type,pixelverif_validity,pixelverif_cost_usd,max_qty)
    VALUES(1,1,'PV-NORMAL-3','Pixel variant',21500,2,1,'manual','normal',3,1,1);`);
});

const due = () => fx.sql.exec("UPDATE pixelverif_order_links SET next_attempt_at=datetime('now','-1 minute') WHERE order_code='" + ORDER_CODE + "'");

afterEach(() => {
  vi.mocked(sendWebDeliveryEmail).mockClear();
  fx.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Pixel Verification dispatch", () => {
  it("creates once, polls to completion, seals delivery, and purges buyer credentials", async () => {
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);

    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0].body))).toEqual({
      email: EMAIL,
      password: PASSWORD,
      totp_secret: TOTP,
      flow_type: "normal",
      validity: 3,
    });
    // README: X-Idempotency-Key is a UUID, stored on the link for same-send retries.
    expect(keyOf(posts[0])).toMatch(UUID_RE);
    expect((fx.sql.prepare("SELECT idempotency_key FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as { idempotency_key: string }).idempotency_key).toBe(keyOf(posts[0]));
    let link = fx.sql.prepare("SELECT status,provider_order_id,attempt_count,submit_seq FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "processing", provider_order_id: "pv-order-001", attempt_count: 1, submit_seq: 1 });
    fx.sql.exec("UPDATE pixelverif_order_links SET next_attempt_at=datetime('now','-1 minute') WHERE order_code='" + ORDER_CODE + "'");

    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(1);
    expect(getCount).toBe(1);
    link = fx.sql.prepare("SELECT status,completed_at FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link.status).toBe("completed");
    expect(link.completed_at).toBeTruthy();

    const delivered = fx.sql.prepare("SELECT delivered_ciphertext,delivered_iv,status,pixelverif_link_id FROM fulfillment_items WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(delivered.status).toBe("queued");
    expect(delivered.pixelverif_link_id).toBeTruthy();
    await expect(decryptSecret(String(delivered.delivered_ciphertext), String(delivered.delivered_iv)))
      .resolves.toBe("https://one.google.com/partner-eft-onboard/fixture");
    const purged = fx.sql.prepare("SELECT input_ciphertext,input_iv,purged_at FROM pixelverif_buyer_inputs WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(purged.input_ciphertext).toBeNull();
    expect(purged.input_iv).toBeNull();
    expect(purged.purged_at).toBeTruthy();
  });

  it("recovers an ambiguous POST by email without posting a second order", async () => {
    postMode = "ambiguous";
    pollStatus = "processing";
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);

    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(1);
    let link = fx.sql.prepare("SELECT status,provider_order_id,request_sent_at FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link.provider_order_id).toBeNull();
    expect(link.request_sent_at).toBeTruthy();
    fx.sql.exec("UPDATE pixelverif_order_links SET next_attempt_at=datetime('now','-1 minute') WHERE order_code='" + ORDER_CODE + "'");

    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(1);
    link = fx.sql.prepare("SELECT status,provider_order_id FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "processing", provider_order_id: "pv-order-001" });
  });

  it("keeps polling fresh when a nonterminal receipt is cached (Sol-8)", async () => {
    pollStatus = "processing";
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);

    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(1);
    // First poll returns processing and is cached as a receipt.
    fx.sql.exec("UPDATE pixelverif_order_links SET next_attempt_at=datetime('now','-1 minute') WHERE order_code='" + ORDER_CODE + "'");
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(getCount).toBe(1);
    // Provider now reports success; the cached processing receipt must NOT
    // suppress the next fresh GET.
    pollStatus = "success";
    fx.sql.exec("UPDATE pixelverif_order_links SET next_attempt_at=datetime('now','-1 minute') WHERE order_code='" + ORDER_CODE + "'");
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(getCount).toBe(2);
    const link = fx.sql.prepare("SELECT status FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link.status).toBe("completed");
  });

  it("keeps sealed input for a retryable pre-send failure and admin retry posts once (Opus-B3)", async () => {
    creditsRemaining = 0;
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);

    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(0);
    let link = fx.sql.prepare("SELECT status,last_error,attempt_count FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "needs_admin", last_error: "insufficient_credits", attempt_count: 0 });
    // Input must survive so the admin retry can actually send.
    const input = fx.sql.prepare("SELECT input_ciphertext,purged_at FROM pixelverif_buyer_inputs WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(input.input_ciphertext).toBeTruthy();
    expect(input.purged_at).toBeNull();

    // Admin tops up credits, then retries: exactly one POST, then completion.
    creditsRemaining = 10;
    const { retryPixelverifOrder } = await import("@/lib/pixelverif/orders");
    const linkRow = fx.sql.prepare("SELECT id FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as { id: number };
    await expect(retryPixelverifOrder(db, linkRow.id)).resolves.toBe(true);
    expect(posts).toHaveLength(1);
    link = fx.sql.prepare("SELECT status,provider_order_id FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "processing", provider_order_id: "pv-order-001" });
  });
  it("never attaches an older provider order for the same Gmail and re-POSTs only after a fresh preflight (Sol-6/Sol-7)", async () => {
    postMode = "ambiguous";
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(1);
    // Provider reports an order for this Gmail created an hour BEFORE our send:
    // it belongs to an earlier purchase and must not complete this link.
    byEmailOrder = { ...orderByEmail.order, order_id: "pv-order-older", created_at: new Date(Date.now() - 3_600_000).toISOString() };
    calls = [];
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const link = fx.sql.prepare("SELECT provider_order_id,status FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link.provider_order_id).toBeNull();
    expect(link.status).not.toBe("completed");
    expect(posts).toHaveLength(2);
    // Same idempotency key on the re-POST (provider dedupes a duplicate create).
    expect(keyOf(posts[1])).toBe(keyOf(posts[0]));
    const secondPost = calls.indexOf("POST https://pixel.test/api/order");
    expect(secondPost).toBeGreaterThan(-1);
    expect(calls.slice(0, secondPost)).toEqual(expect.arrayContaining(["GET https://pixel.test/api/pricing", "GET https://pixel.test/api/credits"]));
  });

  it("binds recovery from a naive-UTC provider timestamp created by this send (Sol-7)", async () => {
    postMode = "ambiguous";
    pollStatus = "processing";
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    // "YYYY-MM-DD HH:MM:SS" without offset is UTC; it must not be read as host-local time.
    byEmailOrder = { ...orderByEmail.order, created_at: new Date(Date.now() + 1_000).toISOString().slice(0, 19).replace("T", " ") };
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(1);
    const link = fx.sql.prepare("SELECT provider_order_id FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link.provider_order_id).toBe("pv-order-001");
  });

  it("delivers a completed link through the encrypted supplier branch, not manual fulfillment (Sol-9)", async () => {
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    fx.sql.exec(`UPDATE fulfillment_items SET recipient_channel='web', recipient_target='buyer@example.test' WHERE order_code='${ORDER_CODE}'`);
    const order = fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(ORDER_CODE) as Record<string, unknown>;
    const item = fx.sql.prepare("SELECT * FROM fulfillment_items WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    await expect(processItem(order, item, undefined, db)).resolves.toBe(true);
    expect(sendWebDeliveryEmail).toHaveBeenCalledWith(expect.objectContaining({
      orderCode: ORDER_CODE, plaintext: "https://one.google.com/partner-eft-onboard/fixture",
    }));
    const after = fx.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(after.status).toBe("delivered");
  });

  it("sweeps leftover input of a terminal link but keeps a retryable pre-send needs_admin input (Sol-10)", async () => {
    creditsRemaining = 0;
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    await purgeExpiredPixelverifInputs(db);
    let input = fx.sql.prepare("SELECT input_ciphertext,purged_at FROM pixelverif_buyer_inputs WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(input.input_ciphertext).toBeTruthy();
    expect(input.purged_at).toBeNull();

    // Same link completes, but settle()'s best-effort purge "failed": the sweep must clear it.
    fx.sql.exec(`UPDATE pixelverif_order_links SET status='completed', completed_at=datetime('now'), last_error=NULL WHERE order_code='${ORDER_CODE}'`);
    await purgeExpiredPixelverifInputs(db);
    input = fx.sql.prepare("SELECT input_ciphertext,input_iv,purged_at FROM pixelverif_buyer_inputs WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(input).toMatchObject({ input_ciphertext: null, input_iv: null });
    expect(input.purged_at).toBeTruthy();
  });
  it("fails closed on an unreadable provider timestamp: re-POSTs with the same idempotency key instead of binding (Sol re-review #3)", async () => {
    postMode = "ambiguous";
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    byEmailOrder = { ...orderByEmail.order };
    delete byEmailOrder.created_at;
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(2);
    expect(keyOf(posts[1])).toBe(keyOf(posts[0]));
    const link = fx.sql.prepare("SELECT provider_order_id FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link.provider_order_id).toBeNull();
  });
  it("never re-attaches a provider order already owned by an earlier purchase for the same Gmail (Sol re-review #4)", async () => {
    postMode = "ambiguous";
    await seedPaidOrder();
    // Earlier paid order for the same Gmail already owns pv-order-001.
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel)
      VALUES('AXV-20261122-PVOLD001','Old','628000000000','old@example.test','[]',21500,'qris','-','lunas','paid','web')`).run();
    fx.sql.prepare(`INSERT INTO pixelverif_order_links(order_code,item_index,variant_id,product_id,flow_type,validity,credit_cost,idempotency_key,provider_order_id,status)
      VALUES('AXV-20261122-PVOLD001',0,1,1,'normal',3,1,'AXV-20261122-PVOLD001-0','pv-order-001','completed')`).run();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const link = fx.sql.prepare("SELECT provider_order_id FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link.provider_order_id).toBeNull();
    expect(posts).toHaveLength(2);
  });

  it("escalates to admin instead of polling forever once the poll budget is exceeded (Sol re-review #5)", async () => {
    pollStatus = "processing";
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    // Sent more than 24h ago and the provider still reports processing.
    fx.sql.exec(`UPDATE pixelverif_order_links SET request_sent_at='${new Date(Date.now() - 25 * 3_600_000).toISOString()}' WHERE order_code='${ORDER_CODE}'`);
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const link = fx.sql.prepare("SELECT status,last_error FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "needs_admin", last_error: "poll_timeout" });
    expect(posts).toHaveLength(1);
  });
  it("keeps a provider-owned link 'processing' (never back to POST-pending) when polling hits 5xx (Sol re-review #5)", async () => {
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    pollHttp = 503;
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const link = fx.sql.prepare("SELECT status,last_error,provider_order_id FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "processing", last_error: "poll_deferred", provider_order_id: "pv-order-001" });
    expect(posts).toHaveLength(1);
  });

  it("does not deliver a refunded Full activation and tells the buyer not to resubmit the Gmail (README activation_status)", async () => {
    await seedPaidOrder();
    fx.sql.exec(`UPDATE product_variants SET sku='PV-FULL-3', pixelverif_flow_type='full', pixelverif_cost_usd=1.5 WHERE id=1`);
    const items = JSON.parse(String((fx.sql.prepare("SELECT items FROM orders WHERE code=?").get(ORDER_CODE) as { items: string }).items));
    items[0].pixelverif_eligibility = { ...items[0].pixelverif_eligibility, flow_type: "full", sku: "PV-FULL-3", cost_usd: 1.5 };
    fx.sql.prepare("UPDATE orders SET items=? WHERE code=?").run(JSON.stringify(items), ORDER_CODE);
    fx.sql.exec(`UPDATE pixelverif_order_links SET flow_type='full', credit_cost=1.5 WHERE order_code='${ORDER_CODE}'`);
    postBody = { success: true, order_id: "pv-order-001", flow_type: "full", validity: 3 };
    pollBody = { success: true, order: { ...successfulOrder.order, flow_type: "full", credit_cost: 1.5, activation_status: "item_not_available", credit_refunded: true } };
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const link = fx.sql.prepare("SELECT status,last_error FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "needs_admin", last_error: "ACTIVATION_ITEM_NOT_AVAILABLE" });
    const item = fx.sql.prepare("SELECT delivered_ciphertext,status FROM fulfillment_items WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(item).toMatchObject({ delivered_ciphertext: null, status: "manual_required" });
    const { pixelverifBuyerErrorMessage } = await import("@/lib/pixelverif/copy");
    expect(pixelverifBuyerErrorMessage("ACTIVATION_ITEM_NOT_AVAILABLE")).toMatch(/Jangan kirim ulang Gmail yang sama/);
  });

  it("delivers a Full link with a fixed activation label, never the raw status", async () => {
    await seedPaidOrder();
    fx.sql.exec(`UPDATE product_variants SET sku='PV-FULL-3', pixelverif_flow_type='full', pixelverif_cost_usd=1.5 WHERE id=1`);
    const items = JSON.parse(String((fx.sql.prepare("SELECT items FROM orders WHERE code=?").get(ORDER_CODE) as { items: string }).items));
    items[0].pixelverif_eligibility = { ...items[0].pixelverif_eligibility, flow_type: "full", sku: "PV-FULL-3", cost_usd: 1.5 };
    fx.sql.prepare("UPDATE orders SET items=? WHERE code=?").run(JSON.stringify(items), ORDER_CODE);
    fx.sql.exec(`UPDATE pixelverif_order_links SET flow_type='full', credit_cost=1.5 WHERE order_code='${ORDER_CODE}'`);
    postBody = { success: true, order_id: "pv-order-001", flow_type: "full", validity: 3 };
    pollBody = { success: true, order: { ...successfulOrder.order, flow_type: "full", credit_cost: 1.5, activation_status: "activated" } };
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const item = fx.sql.prepare("SELECT delivered_ciphertext,delivered_iv FROM fulfillment_items WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    await expect(decryptSecret(String(item.delivered_ciphertext), String(item.delivered_iv)))
      .resolves.toBe("https://one.google.com/partner-eft-onboard/fixture\nAktivasi: Google AI Pro sudah aktif di akun Anda.");
  });

  it("auto-retries OTHER_ERROR with a fresh idempotency key and never re-binds the failed order (README error codes)", async () => {
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    pollBody = { success: true, order: { ...orderByEmail.order, status: "failed", error: { code: "OTHER_ERROR", message: "x", step: 2 }, credit_refunded: true } };
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    let link = fx.sql.prepare("SELECT status,provider_order_id,provider_order_code,request_sent_at,idempotency_key,last_error FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "pending", provider_order_id: null, provider_order_code: "pv-order-001", request_sent_at: null, last_error: "provider_retry" });
    expect(link.idempotency_key).toMatch(UUID_RE);
    expect(link.idempotency_key).not.toBe(keyOf(posts[0]));
    const input = fx.sql.prepare("SELECT input_ciphertext FROM pixelverif_buyer_inputs WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(input.input_ciphertext).toBeTruthy();

    postBody = { success: true, order_id: "pv-order-002", flow_type: "normal", validity: 3 };
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    expect(posts).toHaveLength(2);
    expect(keyOf(posts[1])).toBe(link.idempotency_key);
    link = fx.sql.prepare("SELECT status,provider_order_id,attempt_count FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "processing", provider_order_id: "pv-order-002", attempt_count: 2 });
  });

  it("sends a non-retryable provider failure to admin and purges the credentials (WRONG_PASSWORD)", async () => {
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    pollBody = { success: true, order: { ...orderByEmail.order, status: "failed", error: { code: "WRONG_PASSWORD", message: "Wrong password", step: 3, user_message: `check ${EMAIL}` }, credit_refunded: true } };
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const link = fx.sql.prepare("SELECT status,last_error,last_error_code FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "needs_admin", last_error: "WRONG_PASSWORD", last_error_code: "WRONG_PASSWORD" });
    const input = fx.sql.prepare("SELECT input_ciphertext,purged_at FROM pixelverif_buyer_inputs WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(input.input_ciphertext).toBeNull();
    expect(posts).toHaveLength(1);
  });

  it("keeps a 402 first send admin-retryable with the sealed input (no provider order was created)", async () => {
    postHttp = 402;
    postBody = { error: "Insufficient credits", credits_remaining: 0.5, credits_required: 1 };
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const link = fx.sql.prepare("SELECT id,status,last_error,attempt_count,request_sent_at FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "needs_admin", last_error: "insufficient_credits", attempt_count: 0, request_sent_at: null });
    const input = fx.sql.prepare("SELECT input_ciphertext FROM pixelverif_buyer_inputs WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(input.input_ciphertext).toBeTruthy();
    postHttp = 201;
    postBody = null;
    const { retryPixelverifOrder } = await import("@/lib/pixelverif/orders");
    await expect(retryPixelverifOrder(db, Number(link.id))).resolves.toBe(true);
    expect(posts).toHaveLength(2);
  });

  it("times out Normal polling after 10 minutes and lets admin re-poll without a new POST", async () => {
    pollStatus = "processing";
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    fx.sql.exec(`UPDATE pixelverif_order_links SET request_sent_at='${new Date(Date.now() - 11 * 60_000).toISOString()}' WHERE order_code='${ORDER_CODE}'`);
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const link = fx.sql.prepare("SELECT id,status,last_error FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(link).toMatchObject({ status: "needs_admin", last_error: "poll_timeout" });
    pollStatus = "success";
    const { retryPixelverifOrder } = await import("@/lib/pixelverif/orders");
    await expect(retryPixelverifOrder(db, Number(link.id))).resolves.toBe(true);
    expect(posts).toHaveLength(1);
    const after = fx.sql.prepare("SELECT status FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as Record<string, unknown>;
    expect(after.status).toBe("completed");
  });

  it("polls a processing provider order on the provider cadence, not the POST backoff", async () => {
    pollStatus = "processing";
    await seedPaidOrder();
    const db = createDatabaseAccess(fx.db);
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    due();
    await expect(processPixelverifOrders(db, { orderCode: ORDER_CODE })).resolves.toBe(1);
    const row = fx.sql.prepare("SELECT (julianday(next_attempt_at)-julianday('now'))*86400 AS wait FROM pixelverif_order_links WHERE order_code=?").get(ORDER_CODE) as { wait: number };
    expect(row.wait).toBeLessThanOrEqual(15);
  });
});
