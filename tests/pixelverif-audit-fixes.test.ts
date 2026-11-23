import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAdmin: vi.fn(async () => ({ email: "admin@axvara.test", role: "admin" })),
}));

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 99 } })),
  deleteMessage: vi.fn(async () => ({ ok: true })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(async () => ({ ok: true })),
  editMessageText: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 100 } })),
}));

import { createDatabaseAccess } from "@/lib/db-access";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { recordManualHandoverDetailed } from "@/lib/fulfillment/delivery/handover";
import { readFinancialReport } from "@/lib/dashboard-report";
import { reportTables } from "@/lib/reports/export";
import { BALANCE_CARDS } from "@/components/admin/supplier-topup/model";
import { hasActiveSupplierLink } from "@/components/admin/SupplierLinkActions";
import { supplierOrderError } from "@/components/admin/SupplierOrderQueue";
import { sanitizePixelverifReceiptSummary } from "@/lib/pixelverif/admin";
import { projectPixelverifCatalog } from "@/lib/pixelverif/catalog";
import { processPixelverifOrders, retryPixelverifOrder } from "@/lib/pixelverif/orders";
import { purgeExpiredPixelverifInputs } from "@/lib/pixelverif/purge";
import { PIXELVERIF_RETRYABLE_ERRORS } from "@/lib/pixelverif/retryable";
import { refreshSupplierOrderNow } from "@/lib/orders/supplier-refresh";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleBuyerInput, loadCompletedPixelverifStash, purgeExpiredTelegramPixelverifStashes, requestBuyerInput } from "@/lib/telegram/handlers/buyer-input";
import { resolveCurrentPayq1Lines } from "@/lib/telegram/handlers/payment-lines";
import { parsePayq1State } from "@/lib/telegram/payment-quote";
import { runMaintenanceCleanup } from "@/lib/maintenance-cleanup";
import { POST as bulkMarkupPost } from "@/app/api/admin/pixelverif/markup/bulk/route";
import { GET as pixelProductsGet } from "@/app/api/admin/pixelverif/products/route";
import { GET as pixelOrdersGet } from "@/app/api/admin/pixelverif/orders/route";
import { GET as adminOrdersGet } from "@/app/api/admin/orders/route";
import { POST as queueFulfillPost } from "@/app/api/internal/queue/fulfill/route";
import { POST as variantsPost, PUT as variantsPut } from "@/app/api/admin/variants/route";
import { POST as quotePost } from "@/app/api/checkout/quote/route";

let fx: ReturnType<typeof createD1Fixture>;

const pvCreds = {
  pv_email: "buyer.audit@gmail.com",
  pv_password: "  /LeadSpacePass 42!  ",
  pv_totp_secret: "JBSWY3DPEHPK3PXP",
};

function seedPixelCatalog() {
  fx.sql.exec(`
    INSERT INTO pixelverif_services(service_key, flow_type, validity, credit_cost, available, pricing_version, synced_at)
    VALUES
      ('normal_3', 'normal', 3, 1.0, 1, 25, datetime('now')),
      ('full_3', 'full', 3, 1.5, 1, 25, datetime('now'));
    INSERT INTO products(id, name, slug, category_id, price, stock, is_active, telegram_enabled, pixelverif_family, source, fulfillment_mode)
    VALUES (1, 'Google AI Pro 3 Bulan', 'google-ai-pro-3-bulan', 1, 21600, -1, 1, 1, 'google_ai_pro_3m', 'manual', 'manual');
    INSERT INTO product_variants(id, product_id, sku, label, price, stock, min_qty, max_qty, fulfillment_mode, is_active, sort_order,
      pixelverif_flow_type, pixelverif_validity, pixelverif_cost_usd, pixelverif_fx_idr_per_usd, pixelverif_markup_percent)
    VALUES
      (1, 1, 'PV-NORMAL-3', 'Link Redeem', 21600, -1, 1, 1, 'manual', 1, 1, 'normal', 3, 1.0, 16000, 35),
      (2, 1, 'PV-FULL-3', 'Aktivasi Langsung', 32400, -1, 1, 1, 'manual', 1, 2, 'full', 3, 1.5, 16000, 35);
    INSERT INTO telegram_users(user_id, chat_id, first_name) VALUES ('901', '901', 'AuditUser');
  `);
}

function jsonReq(url: string, body: unknown, method = "POST", headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  vi.stubEnv("PIXELVERIF_ENABLED", "true");
  vi.stubEnv("PIXELVERIF_SYNC_ENABLED", "true");
  vi.stubEnv("PIXELVERIF_DISPATCH_ENABLED", "true");
  vi.stubEnv("PIXELVERIF_API_KEY", "pv-test-key");
  vi.stubEnv("PIXELVERIF_API_BASE_URL", "https://pixel.test");
  fx = createD1Fixture();
});

afterEach(() => {
  fx.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Pixel Verification peer-reviewed audit fixes", () => {
  it("[C1] projects available services as unlimited stock (-1) so concurrent pending orders do not cause STOK HABIS", async () => {
    seedPixelCatalog();
    fx.sql.exec("UPDATE product_variants SET stock=1 WHERE id IN (1,2)");
    const res = await projectPixelverifCatalog(createDatabaseAccess(fx.db), 16000);
    expect(res).toMatchObject({ ok: true });
    expect(fx.sql.prepare("SELECT sku, stock, max_qty FROM product_variants ORDER BY id").all()).toEqual([
      { sku: "PV-NORMAL-3", stock: -1, max_qty: 1 },
      { sku: "PV-FULL-3", stock: -1, max_qty: 1 },
    ]);

    // Simulate two consecutive order decrements (web/Telegram SQL): -1 stays -1.
    for (let i = 0; i < 2; i++) {
      fx.sql.prepare("UPDATE product_variants SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock-1 END WHERE id=1 AND (stock=-1 OR stock>=1)").run();
    }
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()).toEqual({ stock: -1 });

    // Admin products mirror also reports stock=-1 when available=1.
    const adminRes = await pixelProductsGet(new NextRequest("http://localhost/api/admin/pixelverif/products"));
    const adminBody = await adminRes.json() as { items: { service_key: string; stock: number }[] };
    expect(adminBody.items.every((item) => item.stock === -1)).toBe(true);
  });

  it("[C2 + Sol-Bonus-1] persists Telegram 3-step stash encrypted in D1, preserves leading/trailing spaces & slash passwords, and routes directly to single-item payment offer without cart", async () => {
    seedPixelCatalog();
    vi.stubEnv("GOPAY_MERCHANT_QRIS", "00020101021126570011ID.CO.GOPAY01189360091430000000000210G0000000000303UMI5204549953033605802ID5906AXVARA6007JAKARTA6304ABCD");
    const user = { id: 901, first_name: "AuditUser" };
    await requestBuyerInput(user.id, user, 1, 1, 1);

    // Step 1: email -> encrypted stash row in D1 (no plaintext).
    await handleCommand(pvCreds.pv_email, user.id, "private", user, undefined, 101);
    const stash1 = fx.sql.prepare("SELECT * FROM telegram_pixelverif_stashes WHERE user_id='901'").get() as Record<string, unknown>;
    expect(stash1).toBeTruthy();
    expect(String(stash1.ciphertext)).not.toContain(pvCreds.pv_email);

    // Step 2: password with leading/trailing spaces AND leading '/' via handleCommand (untrimmed!).
    await handleCommand(pvCreds.pv_password, user.id, "private", user, undefined, 102);
    const stash2 = fx.sql.prepare("SELECT * FROM telegram_pixelverif_stashes WHERE user_id='901'").get() as Record<string, unknown>;
    expect(String(stash2.ciphertext)).not.toContain(pvCreds.pv_password);
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='901'").get()).toEqual({ pending_action: "pvinput:1:1:totp" });

    // Step 3a: bad TOTP leaves durable D1 stash intact so retry works on another isolate.
    await handleCommand("BAD", user.id, "private", user, undefined, 103);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM telegram_pixelverif_stashes WHERE user_id='901'").get()).toEqual({ n: 1 });

    // Step 3b: valid TOTP persists completed triple in encrypted stash and opens single-item payq1 offer directly (no Telegram cart).
    await handleCommand(pvCreds.pv_totp_secret, user.id, "private", user, undefined, 104);
    const pendingRaw = (fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='901'").get() as { pending_action: string | null })?.pending_action;
    expect(pendingRaw).toBeTruthy();
    expect(pendingRaw).not.toContain(pvCreds.pv_password);
    expect(pendingRaw).not.toContain(pvCreds.pv_totp_secret);
    const parsedOffer = parsePayq1State(pendingRaw);
    expect(parsedOffer?.source).toMatchObject({ kind: "single", productId: 1, variantId: 1, qty: 1, pvFlowId: expect.any(String) });

    // Single-item resolver decrypts exact raw password (including leading/trailing spaces & leading '/').
    const resolved = await resolveCurrentPayq1Lines("901", parsedOffer!);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.cartLines[0].buyerFields).toEqual(pvCreds);
    await expect(loadCompletedPixelverifStash("901", 1, parsedOffer!.source.pvFlowId!)).resolves.toEqual(pvCreds);

    // Expired stash fails closed on resolver and is swept by cleanup.
    fx.sql.exec("UPDATE telegram_pixelverif_stashes SET expires_at=datetime('now','-1 minute') WHERE user_id='901'");
    await expect(resolveCurrentPayq1Lines("901", parsedOffer!)).resolves.toEqual({ ok: false, reason: "variant_changed" });
    await runMaintenanceCleanup(createDatabaseAccess(fx.db));
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM telegram_pixelverif_stashes WHERE user_id='901'").get()).toEqual({ n: 0 });

    const sealed = await encryptSecret(JSON.stringify({ email: "x@gmail.com", variantId: 1, flowId: "f1" }));
    fx.sql.prepare("INSERT INTO telegram_pixelverif_stashes(user_id,variant_id,flow_id,ciphertext,iv,expires_at) VALUES('902',1,'f1',?,?,datetime('now','-1 minute'))")
      .run(sealed.ciphertext, sealed.iv);
    await purgeExpiredTelegramPixelverifStashes(createDatabaseAccess(fx.db));
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM telegram_pixelverif_stashes WHERE user_id='902'").get()).toEqual({ n: 0 });
  });

  it("[C2-QRIS] Telegram Pixel single-item QRIS seals pixelverif_buyer_inputs and clears encrypted stash without cart", async () => {
    seedPixelCatalog();
    const { calculateCrc16 } = await import("@/lib/payments/qris");
    const gopayBase = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI51440014ID.CO.QRIS.WWW0215ID10111111111110303UMI5204899953033605802ID5911AXVARA TEST6006SLEMAN61055558162070703A016304";
    vi.stubEnv("QRIS_ACTIVE_PROVIDER", "gopay");
    vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
    vi.stubEnv("GOPAY_STATIC_QRIS", `${gopayBase}${calculateCrc16(gopayBase)}`);
    vi.stubEnv("GOPAY_POLLER_SECRET", "pixel-qris-poller-secret");
    vi.stubEnv("GOPAY_POLLER_WAKE_URL", "");
    const user = { id: 903, first_name: "PixelQrisBuyer" };
    fx.sql.exec("INSERT INTO telegram_users(user_id,chat_id,first_name,locale) VALUES('903','903','PixelQrisBuyer','id')");
    await requestBuyerInput(user.id, user, 1, 1, 1);
    await handleCommand(pvCreds.pv_email, user.id, "private", user, undefined, 201);
    await handleCommand(pvCreds.pv_password, user.id, "private", user, undefined, 202);
    await handleCommand(pvCreds.pv_totp_secret, user.id, "private", user, undefined, 203);

    const pendingRaw = String((fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='903'").get() as { pending_action: string | null })?.pending_action ?? "");
    const offer = parsePayq1State(pendingRaw)!;
    const qrisIdx = offer.methods.findIndex((m) => m.id === "qris");
    expect(qrisIdx).toBeGreaterThanOrEqual(0);

    const { handleCallback } = await import("@/lib/telegram/handlers/callback");
    await handleCallback(`pm:${offer.nonce}:${qrisIdx}`, user.id, 99, user);

    const order = fx.sql.prepare("SELECT code, items, subtotal FROM orders WHERE telegram_user_id='903'").get() as { code: string; items: string; subtotal: number } | undefined;
    expect(order).toBeTruthy();
    expect(order!.subtotal).toBe(21600);
    expect(order!.items).not.toContain(pvCreds.pv_password);
    expect(order!.items).not.toContain(pvCreds.pv_totp_secret);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM pixelverif_buyer_inputs WHERE order_code=?").get(order!.code)).toEqual({ n: 1 });
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM telegram_pixelverif_stashes WHERE user_id='903'").get()).toEqual({ n: 0 });
  });

  it("[H1] POST /api/admin/pixelverif/markup/bulk updates both variants, reports invalid IDs, and resets manual override", async () => {
    seedPixelCatalog();
    fx.sql.exec("UPDATE product_variants SET pixelverif_admin_price_idr=50000, price=50000 WHERE id=1");
    const res = await bulkMarkupPost(jsonReq("http://localhost/api/admin/pixelverif/markup/bulk", {
      variant_ids: ["normal_3", "full_3", "bogus_id"],
      markup_percent: 50,
      reset_manual: true,
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; updated: number; failed: { id: string; error: string }[] };
    expect(body).toEqual({ ok: true, updated: 2, failed: [{ id: "bogus_id", error: "invalid_id" }] });
    expect(fx.sql.prepare("SELECT sku, price, pixelverif_markup_percent, pixelverif_admin_price_idr FROM product_variants ORDER BY id").all()).toEqual([
      { sku: "PV-NORMAL-3", price: 24000, pixelverif_markup_percent: 50, pixelverif_admin_price_idr: null },
      { sku: "PV-FULL-3", price: 36000, pixelverif_markup_percent: 50, pixelverif_admin_price_idr: null },
    ]);
  });

  it("[H2 + H3 + H4 + Sol-Bonus-3] fences manual handover, surfaces Pixel links in admin orders & Antrean, and preserves receipt flags", async () => {
    seedPixelCatalog();
    fx.sql.exec(`
      INSERT INTO orders(code, customer_name, customer_wa, customer_email, items, subtotal, payment_method, status, payment_status, paid_at)
      VALUES ('AXV-20261123-PV000001', 'Budi', '081234', 'budi@example.test', '[{"product_id":1,"variant_id":1,"name":"Google AI Pro 3 Bulan","qty":1,"price":21600}]', 21600, 'qris', 'lunas', 'paid', datetime('now'));
      INSERT INTO fulfillment_items(id, order_code, item_index, product_id, variant_id, qty, fulfillment_mode, status)
      VALUES (10, 'AXV-20261123-PV000001', 0, 1, 1, 1, 'manual', 'queued');
      INSERT INTO pixelverif_order_links(id, order_code, item_index, variant_id, product_id, flow_type, validity, credit_cost, fx_idr_per_usd, idempotency_key, provider_order_id, status, receipt_json, last_error, last_error_code)
      VALUES (7, 'AXV-20261123-PV000001', 0, 1, 1, 'normal', 3, 1.0, 16000, 'idem-1', 'PV-ORD-1', 'processing', '{"status":"processing","link_present":true,"credit_refunded":true}', NULL, NULL);
    `);

    // H2: manual handover is blocked while link is processing.
    const blocked = await recordManualHandoverDetailed("AXV-20261123-PV000001", 0, "admin@axvara.test", "manual text", createDatabaseAccess(fx.db));
    expect(blocked).toEqual({ ok: false, reason: "bad_state" });

    // H3: admin orders returns sanitized Pixel supplier link.
    const ordersRes = await adminOrdersGet(new NextRequest("http://localhost/api/admin/orders?q=AXV-20261123-PV000001"));
    const ordersBody = await ordersRes.json() as { orders: { supplier_links: { supplier: string; status: string; supplier_order_id: string; item_index: number }[] }[] };
    expect(ordersBody.orders[0].supplier_links).toMatchObject([
      { supplier: "pixelverif", status: "processing", supplier_order_id: "PV-ORD-1", item_index: 0 },
    ]);
    expect(hasActiveSupplierLink(ordersBody.orders[0].supplier_links as never)).toBe(true);

    // H4 + Sol Bonus 3: Pixel orders route returns service_key, quantity=1, cost_usd, and sanitizer keeps link_present + credit_refunded.
    const pvOrdersRes = await pixelOrdersGet(new NextRequest("http://localhost/api/admin/pixelverif/orders"));
    const pvOrdersBody = await pvOrdersRes.json() as { items: Record<string, unknown>[] };
    expect(pvOrdersBody.items[0]).toMatchObject({ service_key: "normal_3", quantity: 1, cost_usd: 1.0 });
    expect(JSON.parse(String(pvOrdersBody.items[0].receipt_json))).toEqual({
      status: "processing",
      link_present: true,
      credit_refunded: true,
    });
    expect(JSON.parse(sanitizePixelverifReceiptSummary('{"status":"failed","link_present":false,"credit_refunded":true}')!)).toEqual({
      status: "failed",
      link_present: false,
      credit_refunded: true,
    });
    expect(supplierOrderError("WRONG_PASSWORD", "pixelverif")).toContain("Password Gmail");
    expect(supplierOrderError(null, "pixelverif", "ACTIVATION_ITEM_NOT_AVAILABLE")).toContain("daftar blokir");

    // Once link transitions to needs_admin, manual handover is allowed.
    fx.sql.exec("UPDATE pixelverif_order_links SET status='needs_admin', last_error='WRONG_PASSWORD' WHERE id=7");
    const allowed = await recordManualHandoverDetailed("AXV-20261123-PV000001", 0, "admin@axvara.test", "manual rescue", createDatabaseAccess(fx.db));
    expect(allowed).toEqual({ ok: true, complete: true });
  });

  it("[H5] queue fulfill settles submitted processing Pixel links as async_polling without 60s retry loops", async () => {
    seedPixelCatalog();
    fx.sql.exec(`
      INSERT INTO store_settings(key, value) VALUES ('queue_fulfillment_mode', 'active');
      INSERT INTO orders(code, customer_name, customer_wa, customer_email, items, subtotal, payment_method, status, payment_status, paid_at)
      VALUES ('AXV-20261123-PV000002', 'Siti', '081234', 'siti@example.test', '[{"product_id":1,"variant_id":1,"name":"Google AI Pro 3 Bulan","qty":1,"price":21600}]', 21600, 'qris', 'lunas', 'paid', datetime('now'));
      INSERT INTO pixelverif_order_links(id, order_code, item_index, variant_id, product_id, flow_type, validity, credit_cost, fx_idr_per_usd, idempotency_key, provider_order_id, request_sent_at, status, next_attempt_at)
      VALUES (8, 'AXV-20261123-PV000002', 0, 1, 1, 'normal', 3, 1.0, 16000, 'idem-2', 'PV-ORD-2', datetime('now'), 'processing', datetime('now','+30 seconds'));
      INSERT INTO fulfillment_items(id, order_code, item_index, product_id, variant_id, qty, fulfillment_mode, status, pixelverif_link_id)
      VALUES (11, 'AXV-20261123-PV000002', 0, 1, 1, 1, 'manual', 'queued', 8);
    `);
    const res = await queueFulfillPost(jsonReq(
      "http://localhost/api/internal/queue/fulfill",
      { v: 1, kind: "order_paid", orderCode: "AXV-20261123-PV000002", orderKind: "apps", source: "klikqris", attempt: 1, dryRun: false },
      "POST",
      { authorization: "Bearer test-cron-secret" },
    ));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, settled: true, state: "async_polling" });
  });

  it("[H6] financial report classifies Pixel orders into suppliers.pixelverif with USD*FX cost and Rp 0 on confirmed refund + Saldo card exists", async () => {
    seedPixelCatalog();
    const now = new Date();
    const paidAt = now.toISOString();
    fx.sql.exec(`
      INSERT INTO orders(code, customer_name, customer_wa, customer_email, items, subtotal, payment_method, status, payment_status, paid_at)
      VALUES
        ('AXV-20261123-PV000003', 'A', '081', 'a@e.test', '[{"product_id":1,"variant_id":1,"name":"Google AI Pro","qty":1,"price":21600,"pixelverif_eligibility":{"version":1,"flow_type":"normal","validity":3,"sku":"PV-NORMAL-3","source_variant_id":1,"cost_usd":1}}]', 21600, 'qris', 'lunas', 'paid', '${paidAt}'),
        ('AXV-20261123-PV000004', 'B', '082', 'b@e.test', '[{"product_id":1,"variant_id":2,"name":"Google AI Pro","qty":1,"price":32400,"pixelverif_eligibility":{"version":1,"flow_type":"full","validity":3,"sku":"PV-FULL-3","source_variant_id":2,"cost_usd":1.5}}]', 32400, 'qris', 'lunas', 'paid', '${paidAt}');
      INSERT INTO pixelverif_order_links(order_code, item_index, variant_id, product_id, flow_type, validity, credit_cost, fx_idr_per_usd, idempotency_key, provider_order_id, request_sent_at, status, receipt_json, completed_at)
      VALUES
        ('AXV-20261123-PV000003', 0, 1, 1, 'normal', 3, 1.0, 16000, 'idem-3', 'PV-3', '${paidAt}', 'completed', '{"status":"success","link_present":true,"credit_refunded":false}', '${paidAt}'),
        ('AXV-20261123-PV000004', 0, 2, 1, 'full', 3, 1.5, 16000, 'idem-4', 'PV-4', '${paidAt}', 'needs_admin', '{"status":"failed","link_present":false,"credit_refunded":true}', NULL);
    `);

    const { reports } = await readFinancialReport(now);
    // Order 3: rev 21600, cost 16000; Order 4 (refunded): rev 32400, cost 0 -> total rev 54000, cost 16000, profit 38000, estimated 0!
    expect(reports.today.suppliers.pixelverif).toEqual({ orders: 2, revenue: 54000, cost: 16000, profit: 38000 });
    expect(reports.today.suppliers.manual.orders).toBe(0);
    expect(reports.today.estimated_orders).toBe(0);

    const tables = reportTables({ ...reports.today, from: "2026-11-23", to: "2026-11-23", timezone: "Asia/Jakarta", generated_at: paidAt });
    expect(tables[2].rows.some((r) => r[0] === "Pixel Verification" && r[1] === 2 && r[3] === 16000)).toBe(true);
    expect(BALANCE_CARDS.some((c) => c.id === "pixelverif" && c.path === "pixelverif/balance" && c.currency === "USD")).toBe(true);
  });

  it("[H7 + Sol-Bonus-2] removes price_increased from retryable, purges sealed inputs >24h, and blocks Gmail when Full activation fails without redeem URL", async () => {
    seedPixelCatalog();
    expect(PIXELVERIF_RETRYABLE_ERRORS.has("price_increased")).toBe(false);

    // 1. 24h ceiling purges even retryable insufficient_credits inputs and blocks retry.
    const sealed = await encryptSecret(JSON.stringify(pvCreds));
    fx.sql.exec(`
      INSERT INTO orders(code, customer_name, customer_wa, customer_email, items, subtotal, payment_method, status, payment_status, paid_at)
      VALUES ('AXV-20261123-PV000005', 'C', '083', 'c@e.test', '[{"product_id":1,"variant_id":1,"name":"Google AI Pro","qty":1,"price":21600,"pixelverif_eligibility":{"version":1,"flow_type":"normal","validity":3,"sku":"PV-NORMAL-3","source_variant_id":1,"cost_usd":1}}]', 21600, 'qris', 'lunas', 'paid', datetime('now','-25 hours'));
      INSERT INTO pixelverif_order_links(id, order_code, item_index, variant_id, product_id, flow_type, validity, credit_cost, fx_idr_per_usd, idempotency_key, status, last_error, attempt_count)
      VALUES (15, 'AXV-20261123-PV000005', 0, 1, 1, 'normal', 3, 1.0, 16000, 'idem-5', 'needs_admin', 'insufficient_credits', 0);
      INSERT INTO fulfillment_items(id, order_code, item_index, product_id, variant_id, qty, fulfillment_mode, status, pixelverif_link_id)
      VALUES (15, 'AXV-20261123-PV000005', 0, 1, 1, 1, 'manual', 'manual_required', 15);
    `);
    fx.sql.prepare(`INSERT INTO pixelverif_buyer_inputs(order_code,item_index,input_ciphertext,input_iv,email_masked,fingerprint,created_at) VALUES('AXV-20261123-PV000005',0,?,?,'bu***@gmail.com','fp5',datetime('now','-25 hours'))`)
      .run(sealed.ciphertext, sealed.iv);

    const db = createDatabaseAccess(fx.db);
    await expect(retryPixelverifOrder(db, 15)).resolves.toBe(false);
    await purgeExpiredPixelverifInputs(db);
    expect(fx.sql.prepare("SELECT input_ciphertext, purged_at FROM pixelverif_buyer_inputs WHERE order_code='AXV-20261123-PV000005'").get()).toMatchObject({
      input_ciphertext: null,
      purged_at: expect.any(String),
    });

    // 2. Sol Bonus 2: Full activation_status=item_not_available with NO redeem link still blocks Gmail & settles ACTIVATION_ITEM_NOT_AVAILABLE.
    fx.sql.exec(`
      INSERT INTO orders(code, customer_name, customer_wa, customer_email, items, subtotal, payment_method, status, payment_status, paid_at)
      VALUES ('AXV-20261123-PV000006', 'D', '084', 'd@e.test', '[{"product_id":1,"variant_id":2,"name":"Google AI Pro","qty":1,"price":32400,"pixelverif_fingerprint":"fp6","pixelverif_eligibility":{"version":1,"flow_type":"full","validity":3,"sku":"PV-FULL-3","source_variant_id":2,"cost_usd":1.5}}]', 32400, 'qris', 'lunas', 'paid', datetime('now'));
      INSERT INTO pixelverif_order_links(id, order_code, item_index, variant_id, product_id, flow_type, validity, credit_cost, fx_idr_per_usd, idempotency_key, provider_order_id, request_sent_at, status, next_attempt_at)
      VALUES (16, 'AXV-20261123-PV000006', 0, 2, 1, 'full', 3, 1.5, 16000, 'idem-6', 'PV-ORD-6', datetime('now'), 'processing', datetime('now','-5 seconds'));
      INSERT INTO fulfillment_items(id, order_code, item_index, product_id, variant_id, qty, fulfillment_mode, status, pixelverif_link_id)
      VALUES (16, 'AXV-20261123-PV000006', 0, 1, 2, 1, 'manual', 'queued', 16);
    `);
    fx.sql.prepare(`INSERT INTO pixelverif_buyer_inputs(order_code,item_index,input_ciphertext,input_iv,email_masked,fingerprint) VALUES('AXV-20261123-PV000006',0,?,?,'bu***@gmail.com','fp6')`)
      .run(sealed.ciphertext, sealed.iv);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      success: true,
      order: {
        order_id: "PV-ORD-6",
        email: pvCreds.pv_email,
        flow_type: "full",
        validity: 3,
        credit_cost: 1.5,
        status: "success",
        activation_status: "item_not_available",
        credit_refunded: true,
        result: {},
      },
    })));
    await expect(processPixelverifOrders(db, { orderCode: "AXV-20261123-PV000006" })).resolves.toBe(1);
    expect(fx.sql.prepare("SELECT status, last_error FROM pixelverif_order_links WHERE id=16").get()).toEqual({
      status: "needs_admin",
      last_error: "ACTIVATION_ITEM_NOT_AVAILABLE",
    });
    const { isPixelverifEmailBlocked } = await import("@/lib/pixelverif/blocklist");
    await expect(isPixelverifEmailBlocked(pvCreds.pv_email, 3)).resolves.toBe(true);
  });

  it("[M1] rejects >1 Pixel Verification variant in web checkout quote", async () => {
    seedPixelCatalog();
    const res = await quotePost(jsonReq("http://localhost/api/checkout/quote", {
      items: [
        { product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvCreds },
        { product_id: 1, variant_id: 2, qty: 1, buyer_fields: pvCreds },
      ],
    }));
    expect(res.status).toBe(409);
    const body = await res.json() as { issues: { message: string }[] };
    expect(body.issues.some((i) => i.message.includes("Hanya 1 varian"))).toBe(true);
  });

  it("[M3] refreshSupplierOrderNow runs GET-only poll for known Pixel provider order and never POSTs pending links", async () => {
    seedPixelCatalog();
    fx.sql.exec(`
      INSERT INTO orders(code, customer_name, customer_wa, customer_email, items, subtotal, payment_method, status, payment_status, paid_at)
      VALUES
        ('AXV-20261123-PV000007', 'E', '085', 'e@e.test', '[{"product_id":1,"variant_id":1,"name":"Google AI Pro","qty":1,"price":21600,"pixelverif_fingerprint":"fp7","pixelverif_eligibility":{"version":1,"flow_type":"normal","validity":3,"sku":"PV-NORMAL-3","source_variant_id":1,"cost_usd":1}}]', 21600, 'qris', 'lunas', 'paid', datetime('now')),
        ('AXV-20261123-PV000008', 'F', '086', 'f@e.test', '[{"product_id":1,"variant_id":1,"name":"Google AI Pro","qty":1,"price":21600,"pixelverif_fingerprint":"fp8","pixelverif_eligibility":{"version":1,"flow_type":"normal","validity":3,"sku":"PV-NORMAL-3","source_variant_id":1,"cost_usd":1}}]', 21600, 'qris', 'lunas', 'paid', datetime('now'));
      INSERT INTO pixelverif_order_links(id, order_code, item_index, variant_id, product_id, flow_type, validity, credit_cost, fx_idr_per_usd, idempotency_key, provider_order_id, request_sent_at, status, next_attempt_at)
      VALUES
        (17, 'AXV-20261123-PV000007', 0, 1, 1, 'normal', 3, 1.0, 16000, 'idem-7', 'PV-ORD-7', datetime('now'), 'processing', datetime('now','-5 seconds')),
        (18, 'AXV-20261123-PV000008', 0, 1, 1, 'normal', 3, 1.0, 16000, 'idem-8', NULL, NULL, 'pending', datetime('now','-5 seconds'));
      INSERT INTO fulfillment_items(id, order_code, item_index, product_id, variant_id, qty, fulfillment_mode, status, pixelverif_link_id)
      VALUES
        (17, 'AXV-20261123-PV000007', 0, 1, 1, 1, 'manual', 'queued', 17),
        (18, 'AXV-20261123-PV000008', 0, 1, 1, 1, 'manual', 'queued', 18);
    `);
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url: String(url) });
      return Response.json({
        success: true,
        order: { order_id: "PV-ORD-7", email: pvCreds.pv_email, flow_type: "normal", validity: 3, credit_cost: 1.0, status: "success", result: { link: "https://one.google.com/redeem/ok7" } },
      });
    }));

    const db = createDatabaseAccess(fx.db);
    // Pending link (no provider_order_id): must NOT POST or touch provider!
    await expect(refreshSupplierOrderNow("AXV-20261123-PV000008", db)).resolves.toBe(false);
    expect(calls).toHaveLength(0);

    // Processing link with known provider_order_id: GET-only poll advances to completed!
    await expect(refreshSupplierOrderNow("AXV-20261123-PV000007", db)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(fx.sql.prepare("SELECT status FROM pixelverif_order_links WHERE id=17").get()).toEqual({ status: "completed" });
  });

  it("[M4] secondary /api/admin/variants guards Pixel identity & bulk pricing and persists pixelverif_admin_price_idr", async () => {
    seedPixelCatalog();
    fx.sql.exec("INSERT INTO store_settings(key, value) VALUES ('variants_enabled', 'true')");
    // Creating a new PV- variant via single POST is rejected.
    const createRes = await variantsPost(jsonReq("http://localhost/api/admin/variants", {
      product_id: 1,
      sku: "PV-EXTRA-3",
      label: "Fake",
      price: 25000,
      stock: -1,
    }));
    expect(createRes.status).toBe(409);
    await expect(createRes.json()).resolves.toMatchObject({ error: "pixelverif_identity_managed" });

    // Enabling bulk pricing via single PUT is rejected.
    const bulkRes = await variantsPut(jsonReq("http://localhost/api/admin/variants?id=1", {
      bulk_pricing: { enabled: true, tiers: [{ min_qty: 2, unit_price: 20000 }] },
    }, "PUT"));
    expect(bulkRes.status).toBe(409);
    await expect(bulkRes.json()).resolves.toMatchObject({ error: "bulk_pricing_pixelverif_forbidden" });

    // Changing price via single PUT persists pixelverif_admin_price_idr.
    const priceRes = await variantsPut(jsonReq("http://localhost/api/admin/variants?id=1", {
      price: 25900,
    }, "PUT"));
    expect(priceRes.status).toBe(200);
    expect(fx.sql.prepare("SELECT price, pixelverif_admin_price_idr FROM product_variants WHERE id=1").get()).toEqual({
      price: 25900,
      pixelverif_admin_price_idr: 25900,
    });
  });
});
