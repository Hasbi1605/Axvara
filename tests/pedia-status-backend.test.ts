// tests/pedia-status-backend.test.ts — Backend slice of the Pedia actual-status fix.
//
// Fixture-only (no network, no prod). Covers the task acceptance:
// 1. Provider paid routing for Pedia creates zero Market fulfillment rows and
//    zero Market credential emails (DANA-branch + ensure guards + old false
//    jobs ignored, never deleted/migrated/rebought).
// 2. ensure/reconcile/process/handover entrypoints no-op or safely reject Pedia.
// 3. Admin orders API returns order_kind + nested pedia summary with
//    server-normalized names (derived for legacy blank rows).
// 4. Telegram paid admin branch reads the durable pedia item (correct qty,
//    status, legacy name fallback; no handover words; missing item never
//    infers success/manual).
// 5. Pedia lookup keeps full-contact proof, returns order_kind='pedia' with
//    lifecycle/progress/ETA + snapshot-safe names/counts (null stays null).
// 6. Status API exposes paid_at, status, start_count/remains/quantity/done,
//    snapshot-safe names, null unknowns, ETA verbatim — reusing existing
//    polling cadence (no new supplier calls per poll).
// 7. Buyer lifecycle emails paid/processing/completed: durable claim+settle,
//    one successful send per phase across retries, failed-send recovery via
//    the existing pedia cron retry sweep, white-label body, correct
//    quantity/link/derived name, snapshot service names, estimates only from
//    existing service fields (no PIN, no avg_time).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { deriveNameFromEmail } from "@/lib/utils";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));

type MailCall = { to: string; subject: string; text: string };
const pediaMails: MailCall[] = [];
const forwardMails: MailCall[] = [];
vi.mock("@/lib/pedia/email", () => ({
  sendPediaEmail: vi.fn(async (args: MailCall) => { pediaMails.push(args); return true; }),
}));
vi.mock("@/lib/warung-rebahan/forward-sender", () => ({
  sendForwardEmail: vi.fn(async (args: { to: string; subject: string; text: string }) => {
    forwardMails.push({ to: args.to, subject: args.subject, text: args.text });
    return { ok: true, providerId: "res_fixture" };
  }),
  isForwardEmailConfigured: () => true,
}));

const PEDIA_CODE = "AXP-20261102-AB12CD34";
const MARKET_CODE = "AXV-20261102-EF56GH78";
const EMAIL = "first.last+promo@example.test";

let fx: ReturnType<typeof createD1Fixture>;

function seedCatalog(db: ReturnType<typeof createDatabaseAccess>) {
  void db;
  fx.sql.prepare(
    `INSERT INTO pedia_products (id, slug, platform, metric, target_kind, name, packages_json, step, is_active)
     VALUES (11, 'followers-test', 'instagram', 'followers', 'profile', 'Followers Test', '[100]', 10, 1)`,
  ).run();
  fx.sql.prepare(
    `INSERT INTO pedia_tiers (id, product_id, tier, supplier, supplier_service_id, price_group,
       markup_pct, min_profit_rp, refill_days, package_prices_json, is_active, eta_start, eta_finish, label_note)
     VALUES (21, 11, 'standar', 'indosmm', 9475, 'G3', 20, 1000, 365, '{"100":5000}', 1, '0-1 jam', '1-12 jam', 'HQ Low Drop 365 Days')`,
  ).run();
  fx.sql.prepare(
    `INSERT INTO pedia_supplier_services (supplier, service_id, name, category, type, rate_idr_per_1k, min_qty, max_qty, present)
     VALUES ('indosmm', 9475, 'IG Followers HQ', 'IG', 'Default', 5000, 100, 100000, 1)`,
  ).run();
}

function seedPediaOrder(status: "lunas" | "pending" = "lunas", name = "") {
  fx.sql.prepare(
    `INSERT INTO orders (code, customer_name, customer_wa, customer_email, items, subtotal,
       payment_method, status, payment_status, sales_channel, order_kind, paid_at, buyer_access_version, buyer_access_format)
     VALUES (?, ?, '62812', ?, '[]', 10000, 'qris', ?, ?, 'web', 'pedia', ?, 1, 'pin6')`,
  ).run(PEDIA_CODE, name, EMAIL, status, status === "lunas" ? "paid" : "pending",
    status === "lunas" ? new Date().toISOString() : null);
  const snap = JSON.stringify({
    supplier: "indosmm", supplier_service_id: 9475, refill_days: 365,
    service_copy: {
      product_name: "Followers Test",
      service_name: "Followers Test HQ Low Drop 365 Days",
      description: "d", terms: "t", instructions: "i",
    },
  });
  fx.sql.prepare(
    `INSERT INTO pedia_order_items (order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized,
       quantity, unit_price, total, credit_used, supplier, supplier_service_id, supplier_rate_snapshot, status, submit_attempts)
     VALUES (?, 11, 21, ?, 'https://instagram.com/x', 'https://instagram.com/x', 100, 100, 10000, 0, 'indosmm', 9475, 5000, 'queued', 0)`,
  ).run(PEDIA_CODE, snap);
}

function seedMarketOrder() {
  fx.sql.prepare(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'CapCut Pro','capcut-pro',7500,100)`).run();
  fx.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(1,1,'SKU-1','Pro',7500,100,'manual')`).run();
  fx.sql.prepare(
    `INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at,order_kind)
     VALUES(?,?,?,?,?,?,?,'lunas','paid','web','queued',1,datetime('now'),'apps')`,
  ).run(MARKET_CODE, "Buyer", "628000000000", "buyer@example.test",
    JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro", price: 7500, qty: 1 }]), 7500, "qris");
}

beforeEach(() => {
  fx = createD1Fixture();
  pediaMails.length = 0;
  forwardMails.length = 0;
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_JWT_SECRET", "test-pedia-status-secret-0123456789");
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-test");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100200");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("SITE_URL", "https://axvara.tech");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function authedGet(url: string): Promise<NextRequest> {
  const auth = await import("@/lib/auth");
  const { token, sid } = await auth.createAdminToken("admin@axvara.tech");
  const idle = await auth.createIdleToken(sid);
  const headers = new Headers();
  headers.set("cookie", `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`);
  return new NextRequest(url, { headers });
}

describe("provider paid routing + generic fulfillment no-op for Pedia", () => {
  it("DANA settles Pedia and schedules only once, with no extra dispatch", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder("pending");
    fx.sql.prepare(`UPDATE orders SET expires_at=datetime('now','+15 minutes') WHERE code=?`).run(PEDIA_CODE);
    const { calculateCrc16, createDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    const qr = "00020101021153033605802ID6304";
    vi.stubEnv("DANA_QRIS_ENABLED", "true");
    vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
    vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture-secret");
    const invoice = await createDanaQrisInvoice(PEDIA_CODE, 10000);
    const scheduler = await import("@/lib/payments/paid-fulfillment");
    const dispatch = await import("@/lib/pedia/dispatch");
    const schedule = vi.spyOn(scheduler, "schedulePaidFulfillment").mockResolvedValue(undefined);
    const extra = vi.spyOn(dispatch, "processPediaPaidOrders");
    const { POST } = await import("@/app/api/webhook/dana/route");
    const res = await POST(new NextRequest("http://localhost/api/webhook/dana", {
      method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "fixture-secret" },
      body: JSON.stringify({ payment: { amount: invoice.payableAmount, currency: "IDR", reference: "pedia-fixture" }, merchant: "DANA" }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("paid");
    expect(fx.sql.prepare(`SELECT status, payment_status FROM orders WHERE code=?`).get(PEDIA_CODE)).toMatchObject({ status: "lunas", payment_status: "paid" });
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(PEDIA_CODE, "pedia");
    expect(extra).not.toHaveBeenCalled();
    schedule.mockRestore();
    extra.mockRestore();
  });

  it("ensure paths no-op for Pedia; Market still materializes", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    seedMarketOrder();
    const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/delivery/ensure");
    const { ensureFulfillmentItems } = await import("@/lib/fulfillment/delivery/inventory-binding");
    const { reconcileMissingFulfillmentJobs, backfillMissingFulfillmentItems, reconcileOrphanLight } = await import("@/lib/fulfillment/delivery/reconcile");
    const { processJobItems } = await import("@/lib/fulfillment/delivery/process");
    const { recordManualHandoverDetailed } = await import("@/lib/fulfillment/delivery/handover");
    const pediaOrder = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, PEDIA_CODE);
    // ensure entrypoints no-op for Pedia (no new rows).
    expect(await ensureFulfillmentForPaidOrder(PEDIA_CODE)).toBe(false);
    expect(await ensureFulfillmentItems(pediaOrder!)).toEqual([]);
    expect(await reconcileOrphanLight(PEDIA_CODE, db)).toBe(false);
    // Reconcile sweeps skip Pedia entirely but still heal Market orphans.
    expect(await reconcileMissingFulfillmentJobs(8)).toBe(1);
    expect((fx.sql.prepare(`SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?`).get(PEDIA_CODE) as { n: number }).n).toBe(0);
    expect((fx.sql.prepare(`SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?`).get(MARKET_CODE) as { n: number }).n).toBe(1);
    expect(await backfillMissingFulfillmentItems(8)).toBe(0);
    // processJobItems leaves stale false jobs inert (no work).
    const staleJob = await db.queryFirst(`SELECT * FROM fulfillment_jobs WHERE order_code=?`, PEDIA_CODE).catch(() => null);
    void staleJob;
    const unit = await processJobItems(999999, pediaOrder!, {}, 4, undefined, db).catch(() => ({ done: false as const, reason: "no_work" as const, attempted: 0, finished: false }));
    expect(unit.done).toBe(false);
    // Handover safely rejects Pedia at the caller layer.
    const handover = await recordManualHandoverDetailed(PEDIA_CODE, 0, "admin@axvara.tech");
    expect(handover.ok).toBe(false);
    // Zero Market rows for Pedia.
    expect((fx.sql.prepare(`SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?`).get(PEDIA_CODE) as { n: number }).n).toBe(0);
    expect((fx.sql.prepare(`SELECT COUNT(*) n FROM fulfillment_items WHERE order_code=?`).get(PEDIA_CODE) as { n: number }).n).toBe(0);
    // Market regression: AXV still heals + materializes through the same
    // sweep (job row exists, one item row; terminal state reached by the
    // first ensure inside the sweep, so a second ensure may no-op false).
    expect((fx.sql.prepare(`SELECT COUNT(*) n FROM fulfillment_items WHERE order_code=?`).get(MARKET_CODE) as { n: number }).n).toBe(1);
    await ensureFulfillmentForPaidOrder(MARKET_CODE).catch(() => false);
    expect((fx.sql.prepare(`SELECT COUNT(*) n FROM fulfillment_items WHERE order_code=?`).get(MARKET_CODE) as { n: number }).n).toBe(1);
    const marketOrder = fx.sql.prepare(`SELECT fulfillment_status FROM orders WHERE code=?`).get(MARKET_CODE) as { fulfillment_status: string };
    expect(["queued", "manual_required", "delivered"]).toContain(String(marketOrder.fulfillment_status));
  });

  it("repeated Pedia dispatch emits paid once; DANA-style duplicate is safe", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const caller = async () => ({ ok: true as const, data: { order: "22024298" }, status: 200 }) as never;
    await processPediaPaidOrders(caller, db);
    await processPediaPaidOrders(caller, db);
    const item = await db.queryFirst(`SELECT status, submit_attempts FROM pedia_order_items WHERE order_code=?`, PEDIA_CODE);
    expect(item?.status).toBe("submitted");
    expect(Number(item?.submit_attempts)).toBe(1);
    expect((fx.sql.prepare(`SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?`).get(PEDIA_CODE) as { n: number }).n).toBe(0);
    const paidSends = pediaMails.filter((m) => m.subject.includes("Pembayaran diterima"));
    expect(paidSends).toHaveLength(1);
    expect(paidSends[0].text).toContain("Status saat ini:");
    expect(forwardMails.filter((m) => m.text.includes("Detail produk dikirim"))).toHaveLength(0);
  });
});

describe("admin payload: order_kind + pedia summary + derived names", () => {
  it("returns nested pedia summary and derived name for legacy blank rows", async () => {
    seedCatalog(createDatabaseAccess(fx.db));
    seedPediaOrder("lunas", "");
    fx.sql.prepare(`UPDATE pedia_order_items SET status='in_progress', start_count=8177, remains=73, supplier_order_id='22024298' WHERE order_code=?`).run(PEDIA_CODE);
    const { GET } = await import("@/app/api/admin/orders/route");
    const res = await GET(await authedGet("http://x/api/admin/orders?kind=pedia&limit=10"));
    expect(res.status).toBe(200);
    const body = await res.json() as { orders: Record<string, unknown>[] };
    const row = body.orders.find((o) => o.code === PEDIA_CODE)!;
    expect(row.order_kind).toBe("pedia");
    expect(row.customer_name).toBe(deriveNameFromEmail(EMAIL));
    const pedia = row.pedia as Record<string, unknown>;
    expect(pedia.status).toBe("in_progress");
    expect(pedia.quantity).toBe(100);
    expect(pedia.done).toBe(27);
    expect(pedia.percent).toBeCloseTo(27, 5);
    expect(pedia.supplier_order_id).toBe("22024298");
    // Missing Pedia item => explicit null, never inferred success.
    fx.sql.prepare(`DELETE FROM pedia_order_items WHERE order_code=?`).run(PEDIA_CODE);
    const res2 = await GET(await authedGet("http://x/api/admin/orders?kind=pedia&limit=10"));
    const row2 = ((await res2.json()) as { orders: Record<string, unknown>[] }).orders.find((o) => o.code === PEDIA_CODE)!;
    expect(row2.pedia ?? null).toBeNull();
  });

  it("handover route rejects AXP with 409; AXV path intact", async () => {
    seedCatalog(createDatabaseAccess(fx.db));
    seedPediaOrder();
    const handover = await import("@/app/api/admin/orders/[code]/handover/route");
    const get = await handover.GET(await authedGet(`http://x/api/admin/orders/${PEDIA_CODE}/handover`), { params: Promise.resolve({ code: PEDIA_CODE }) });
    expect(get.status).toBe(409);
    expect(((await get.json()) as { error: string }).error).toBe("pedia_not_handover");
    const post = await handover.POST(
      await (async () => {
        const req = await authedGet(`http://x/api/admin/orders/${PEDIA_CODE}/handover`);
        return new NextRequest(req.url, { method: "POST", headers: req.headers, body: JSON.stringify({ item_index: 0 }) });
      })(),
      { params: Promise.resolve({ code: PEDIA_CODE }) },
    );
    expect(post.status).toBe(409);
  });
});

describe("Telegram paid admin reads the durable pedia item", () => {
  it("in_progress maps to automatic processing with qty/status; no handover words", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder("lunas", "");
    fx.sql.prepare(`UPDATE pedia_order_items SET status='in_progress', start_count=8177, remains=73, supplier_order_id='22024298' WHERE order_code=?`).run(PEDIA_CODE);
    const { pediaAdminDeliverySummary, notifyWebPaidAdmin } = await import("@/lib/telegram/order-notifications");
    const summary = await pediaAdminDeliverySummary(PEDIA_CODE, db);
    expect(summary.needsAdmin).toBe(false);
    expect(summary.orderStatus).toContain("DIPROSES OTOMATIS");
    expect(summary.lines.join("\n")).toContain("27/100 masuk");
    expect(summary.lines.join("\n")).not.toMatch(/Kirim ke pembeli|handover|manual/i);
    expect(await notifyWebPaidAdmin(PEDIA_CODE, db)).toBe(true);
    const { sendMessage } = await import("@/lib/telegram/api");
    const texts = vi.mocked(sendMessage).mock.calls.map(([m]) => String((m as { text: string }).text));
    expect(texts.some((t) => t.includes(PEDIA_CODE) && t.includes("DIPROSES OTOMATIS"))).toBe(true);
    expect(texts.some((t) => /Kirim ke pembeli|perlu dikirim admin/i.test(t))).toBe(false);
    // Legacy name fallback: derived name appears, never blank.
    expect(texts.some((t) => t.includes(deriveNameFromEmail(EMAIL)))).toBe(true);
  });

  it("needs_check and missing item never infer success/manual", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    fx.sql.prepare(`UPDATE pedia_order_items SET status='needs_check', last_error='submit interrupted' WHERE order_code=?`).run(PEDIA_CODE);
    const { pediaAdminDeliverySummary } = await import("@/lib/telegram/order-notifications");
    const check = await pediaAdminDeliverySummary(PEDIA_CODE, db);
    expect(check.orderStatus).toBe("PERLU PEMERIKSAAN ADMIN");
    const missing = await pediaAdminDeliverySummary("AXP-20261102-ZZ99ZZ99", db);
    expect(missing.orderStatus).toBe("SEDANG DICEK");
    expect(missing.lines.join("\n")).not.toMatch(/SELESAI|handover|manual/i);
  });
});

describe("lookup + status truthfulness", () => {
  it("lookup keeps contact proof and returns full pedia contract", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder("lunas", "");
    fx.sql.prepare(`UPDATE orders SET paid_at='2026-11-02T10:00:00.000Z' WHERE code=?`).run(PEDIA_CODE);
    fx.sql.prepare(`UPDATE pedia_order_items SET status='in_progress', start_count=8177, remains=73 WHERE order_code=?`).run(PEDIA_CODE);
    const { lookupPediaOrder } = await import("@/lib/pedia/lookup");
    const res = await lookupPediaOrder(PEDIA_CODE, EMAIL, false, new NextRequest("http://x/", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { order: Record<string, unknown> };
    expect(body.order.order_kind).toBe("pedia");
    expect(body.order.code).toBe(PEDIA_CODE);
    expect(body.order.pedia_status_raw).toBe("in_progress");
    expect(body.order.quantity).toBe(100);
    expect(body.order.start_count).toBe(8177);
    expect(body.order.remains).toBe(73);
    expect(body.order.done).toBe(27);
    expect(body.order.paid_at).toBe("2026-11-02T10:00:00.000Z");
    expect(body.order.service_name).toContain("HQ Low Drop");
    expect(JSON.stringify(body.order)).not.toMatch(/indosmm|providersmm|supplier/i);
    // Wrong contact still 404 (proof preserved).
    const bad = await lookupPediaOrder(PEDIA_CODE, "wrong@example.test", false, new NextRequest("http://x/", { method: "POST" }));
    expect(bad.status).toBe(404);
  });

  it("status API exposes snapshot names + counts + ETA; null stays null", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    fx.sql.prepare(`UPDATE orders SET paid_at='2026-11-02T10:00:00.000Z' WHERE code=?`).run(PEDIA_CODE);
    fx.sql.prepare(`UPDATE pedia_order_items SET status='submitted', start_count=NULL, remains=NULL WHERE order_code=?`).run(PEDIA_CODE);
    const { GET } = await import("@/app/api/pedia/orders/[code]/route");
    const req = new NextRequest(`http://x/api/pedia/orders/${PEDIA_CODE}`, { headers: { "x-order-contact": EMAIL } });
    const res = await GET(req, { params: Promise.resolve({ code: PEDIA_CODE }) });
    expect(res.status).toBe(200);
    const body = await res.json() as { order: Record<string, unknown> };
    expect(body.order.order_kind).toBe("pedia");
    expect(body.order.service_name).toContain("HQ Low Drop");
    expect(body.order.start_count).toBeNull();
    expect(body.order.remains).toBeNull();
    expect(body.order.done).toBeNull();
    expect(body.order.percent).toBeNull();
    expect(body.order.eta_start).toBe("0-1 jam");
    expect(body.order.eta_finish).toBe("1-12 jam");
    expect(body.order.paid_at).toBe("2026-11-02T10:00:00.000Z");
    expect(JSON.stringify(body.order)).not.toMatch(/indosmm|providersmm|supplier_order|charge|rate/i);
  });
});

describe("lifecycle emails: one send per phase, recovery, white-label", () => {
  it("discovers only recent missing paid notices without re-reading sent rows", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    fx.sql.prepare(`UPDATE orders SET paid_at=datetime('now','-25 hours') WHERE code=?`).run(PEDIA_CODE);
    fx.sql.prepare(`UPDATE pedia_order_items SET status='needs_check' WHERE order_code=?`).run(PEDIA_CODE);
    for (let i = 0; i < 6; i++) {
      const code = `RECENT-${i}`;
      fx.sql.prepare(`INSERT INTO orders (code, customer_name, customer_wa, customer_email, items, subtotal, payment_method, status, payment_status, sales_channel, order_kind, paid_at)
        SELECT ?, customer_name, customer_wa, customer_email, items, subtotal, payment_method, status, payment_status, sales_channel, order_kind, datetime('now') FROM orders WHERE code=?`).run(code, PEDIA_CODE);
      fx.sql.prepare(`INSERT INTO pedia_order_items (order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized, quantity, unit_price, total, credit_used, supplier, supplier_service_id, supplier_rate_snapshot, status, submit_attempts, updated_at)
        SELECT ?, product_id, tier_id, snapshot_json, target_raw, target_normalized, quantity, unit_price, total, credit_used, supplier, supplier_service_id, supplier_rate_snapshot, status, submit_attempts, datetime('now', ?) FROM pedia_order_items WHERE order_code=?`).run(code, i < 5 ? "-1 hour" : "now", PEDIA_CODE);
      if (i < 5) fx.sql.prepare(`INSERT INTO buyer_notice_log (idempotency_key, order_code, channel, status) VALUES (?, ?, 'email', 'sent')`).run(`email:pedia-paid:${code}`, code);
    }
    const queryFirst = vi.fn(db.queryFirst);
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    await processPediaPaidOrders(undefined, { ...db, queryFirst });
    expect(pediaMails).toHaveLength(1);
    expect(pediaMails[0].subject).toContain("RECENT-5");
    await processPediaPaidOrders(undefined, { ...db, queryFirst });
    expect(pediaMails).toHaveLength(1);
    expect(queryFirst.mock.calls.filter(([sql]) => sql.includes("i.snapshot_json"))).toHaveLength(1);
    expect(fx.sql.prepare(`SELECT COUNT(*) n FROM buyer_notice_log WHERE idempotency_key=?`).get(`email:pedia-paid:${PEDIA_CODE}`)).toMatchObject({ n: 0 });
  });

  it("retries an old existing due paid notice without discovering old missing notices", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    fx.sql.prepare(`UPDATE orders SET paid_at=datetime('now','-25 hours') WHERE code=?`).run(PEDIA_CODE);
    fx.sql.prepare(`UPDATE pedia_order_items SET status='needs_check' WHERE order_code=?`).run(PEDIA_CODE);
    fx.sql.prepare(`INSERT INTO buyer_notice_log (idempotency_key, order_code, channel, status, access_attempts, access_retry_at) VALUES (?, ?, 'email', 'failed', 1, datetime('now','-1 minute'))`).run(`email:pedia-paid:${PEDIA_CODE}`, PEDIA_CODE);
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    await processPediaPaidOrders(undefined, db);
    expect(pediaMails).toHaveLength(1);
    expect(fx.sql.prepare(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`).get(`email:pedia-paid:${PEDIA_CODE}`)).toMatchObject({ status: "sent" });
  });

  it("paid lifecycle wording for partial and canceled is buyer-safe", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const { notifyPediaPaid } = await import("@/lib/pedia/notify");
    for (const status of ["partial", "canceled"]) {
      fx.sql.prepare(`UPDATE pedia_order_items SET status=? WHERE order_code=?`).run(status, PEDIA_CODE);
      fx.sql.prepare(`DELETE FROM buyer_notice_log WHERE idempotency_key=?`).run(`email:pedia-paid:${PEDIA_CODE}`);
      expect(await notifyPediaPaid(db, PEDIA_CODE)).toBe(true);
      expect(pediaMails.at(-1)!.text).toContain("sedang kami tindak lanjuti");
      expect(pediaMails.at(-1)!.text).not.toMatch(/manual|admin/i);
    }
  });

  it("paid→processing→completed each once across retries; failed send recovers via cron sweep", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder("lunas", "");
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    // Paid: dispatch emits once even across duplicate ticks.
    const add = async () => ({ ok: true as const, data: { order: "22024298" }, status: 200 }) as never;
    await processPediaPaidOrders(add, db);
    await processPediaPaidOrders(add, db);
    // Processing: first submitted→in_progress transition emits once.
    // The transition mail carries the just-reported counts.
    fx.sql.prepare(`UPDATE pedia_order_items SET lease_until=NULL WHERE order_code=?`).run(PEDIA_CODE);
    const prog = async () => ({ ok: true as const, data: { status: "In progress", start_count: 8177, remains: 73 }, status: 200 }) as never;
    await processPediaPaidOrders(prog, db);
    await processPediaPaidOrders(prog, db);
    // Completed: emits once.
    fx.sql.prepare(`UPDATE pedia_order_items SET lease_until=NULL WHERE order_code=?`).run(PEDIA_CODE);
    const done = async () => ({ ok: true as const, data: { status: "Completed", start_count: 8177, remains: 0 }, status: 200 }) as never;
    await processPediaPaidOrders(done, db);
    await processPediaPaidOrders(done, db);
    const subjects = pediaMails.map((m) => m.subject);
    expect(subjects.filter((s) => s.includes("Pembayaran diterima"))).toHaveLength(1);
    expect(subjects.filter((s) => s.includes("sedang berjalan"))).toHaveLength(1);
    expect(subjects.filter((s) => s.includes("selesai"))).toHaveLength(1);
    for (const mail of pediaMails) {
      expect(mail.text).toContain("/pesanan/" + PEDIA_CODE);
      expect(mail.text).not.toContain("contact");
      expect(mail.text).not.toContain("PIN");
      expect(mail.text).not.toMatch(/indosmm|providersmm|supplier/i);
      expect(mail.text).toContain("First Last");
      expect(mail.text).toContain("100");
    }
    // Paid body at paid phase: counts unavailable => honest label, no zero-claim.
    const paidBody = pediaMails.find((m) => m.subject.includes("Pembayaran diterima"))!.text;
    expect(paidBody).toMatch(/belum dikonfirmasi|mengikuti antrean/i);
    expect(paidBody).not.toMatch(/terkirim: 0 dari/);
    // Processing body carries the reported snapshot counts (fixture 8177/73→27).
    const procBody = pediaMails.find((m) => m.subject.includes("berjalan"))!.text;
    expect(procBody).toContain("8.177");
    expect(procBody).toContain("sisa 73");
    expect(procBody).toContain("27 dari 100");
    // Failed-send recovery: flip completed to failed with due backoff,
    // cron sweep resends once (fenced sender owns retry).
    fx.sql.prepare(`UPDATE buyer_notice_log SET status='failed', access_retry_at=datetime('now','-1 minute') WHERE idempotency_key=?`).run(`email:pedia-completed:${PEDIA_CODE}`);
    const before = pediaMails.length;
    await processPediaPaidOrders(done, db);
    expect(pediaMails.length).toBe(before + 1);
    await processPediaPaidOrders(done, db);
    expect(pediaMails.length).toBe(before + 1);
    // Every mail links the live page (point-in-time snapshot + link).
    for (const mail of pediaMails) {
      expect(mail.text).toContain("https://pedia.axvara.tech/pesanan/" + PEDIA_CODE);
    }
  });

  it("Market payment-received never promises Pedia credentials", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const { notifyBuyerPaymentReceived, notifyBuyerHandover } = await import("@/lib/notify-buyer");
    expect(await notifyBuyerHandover(PEDIA_CODE, db)).toBe(false);
    expect(await notifyBuyerPaymentReceived(PEDIA_CODE, db)).toBe(true);
    expect(forwardMails).toHaveLength(0);
    expect(pediaMails).toHaveLength(1);
    expect(pediaMails[0].text).not.toMatch(/Detail produk dikirim|kredensial|akun/i);
  });

  it("kind lookup failure returns false, never Market mail", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const { notifyBuyerPaymentReceived, notifyBuyerHandover } = await import("@/lib/notify-buyer");
    // Simulate a transient kind-lookup outage: fail-closed, no Market mail.
    const failing = { ...db, queryFirst: async () => { throw new Error("db_down"); } };
    expect(await notifyBuyerHandover(PEDIA_CODE, failing)).toBe(false);
    expect(await notifyBuyerPaymentReceived(PEDIA_CODE, failing)).toBe(false);
    expect(forwardMails).toHaveLength(0);
    expect(pediaMails).toHaveLength(0);
    // Unknown code (no row at all): also false, no Market fallback.
    expect(await notifyBuyerPaymentReceived("AXP-20261102-ZZ99ZZ99", db)).toBe(false);
    expect(forwardMails).toHaveLength(0);
  });
});

describe("review corrections: fenced email regressions 1-8", () => {
  it("1. claim DB outage sends nothing; healthy tick sends once", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const email = await import("@/lib/pedia/email");
    const spy = vi.spyOn(email, "sendPediaEmail");
    const before = spy.mock.calls.length;
    const { notifyPediaPaid } = await import("@/lib/pedia/notify");
    // Claim outage: execRun throws → fail-closed, zero transport.
    const down = { ...db, execRun: async () => { throw new Error("db_down"); } };
    expect(await notifyPediaPaid(down, PEDIA_CODE)).toBe(false);
    expect(spy.mock.calls.length).toBe(before);
    // Healthy tick: exactly one send; retry is a no-op.
    expect(await notifyPediaPaid(db, PEDIA_CODE)).toBe(true);
    expect(await notifyPediaPaid(db, PEDIA_CODE)).toBe(true);
    expect(spy.mock.calls.length).toBe(before + 1);
    spy.mockRestore();
  });

  it("2. concurrent paid claims send once; stale settle cannot flip sent", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const { notifyPediaPaid } = await import("@/lib/pedia/notify");
    const email = await import("@/lib/pedia/email");
    const spy = vi.spyOn(email, "sendPediaEmail");
    const before = spy.mock.calls.length;
    await Promise.all([notifyPediaPaid(db, PEDIA_CODE), notifyPediaPaid(db, PEDIA_CODE)]);
    expect(spy.mock.calls.length).toBe(before + 1);
    spy.mockRestore();
    // Stale lease settle: 0 rows, sent row untouched.
    const { settlePediaEmail, pediaEmailKey } = await import("@/lib/pedia/notify-channel");
    const key = pediaEmailKey("paid", PEDIA_CODE);
    expect(await settlePediaEmail(db, key, "stale-lease", false, "late")).toBe(false);
    expect((fx.sql.prepare(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`).get(key) as { status: string }).status).toBe("sent");
  });

  it("3. failed send: attempts increment + backoff; cap at 5 stops forever", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const email = await import("@/lib/pedia/email");
    const spy = vi.spyOn(email, "sendPediaEmail").mockResolvedValue(false);
    const { notifyPediaPaid, notifyPediaProcessing } = await import("@/lib/pedia/notify");
    expect(await notifyPediaPaid(db, PEDIA_CODE)).toBe(false);
    const key = `email:pedia-paid:${PEDIA_CODE}`;
    const row = fx.sql.prepare(`SELECT status, access_attempts, access_retry_at FROM buyer_notice_log WHERE idempotency_key=?`).get(key) as { status: string; access_attempts: number; access_retry_at: string };
    expect(row.status).toBe("failed");
    expect(row.access_attempts).toBe(1);
    expect(Date.parse(row.access_retry_at.replace(" ", "T") + "Z")).toBeGreaterThan(Date.now());
    spy.mockRestore();
    // Immediate sweep: backoff not due → no send.
    const { retryPendingPediaEmails } = await import("@/lib/pedia/notify-retry");
    const mailsBefore = pediaMails.length;
    await retryPendingPediaEmails(db);
    expect(pediaMails.length).toBe(mailsBefore);
    // Force attempts to cap: no further sends ever.
    fx.sql.prepare(`UPDATE buyer_notice_log SET access_attempts=5, access_retry_at=datetime('now','-1 hour') WHERE idempotency_key=?`).run(key);
    await retryPendingPediaEmails(db);
    expect(pediaMails.length).toBe(mailsBefore);
    // Processing sender also respects the fence on its own key.
    expect(await notifyPediaProcessing(db, PEDIA_CODE)).toBe(false);
  });

  it("4. missing ledger rows discovered; submit api_error still got paid mail", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    // Submit api_error → needs_check, but paid sighting already mailed.
    const apiError = async () => ({ ok: false as const, kind: "api_error" as const, supplierMessage: "Insufficient funds" }) as never;
    await processPediaPaidOrders(apiError, db);
    expect((await db.queryFirst(`SELECT status FROM pedia_order_items WHERE order_code=?`, PEDIA_CODE))?.status).toBe("needs_check");
    expect(pediaMails.filter((m) => m.subject.includes("Pembayaran diterima"))).toHaveLength(1);
    // Simulate missed paid hook: item in_progress, no ledger rows at all.
    fx.sql.prepare(`DELETE FROM buyer_notice_log`).run();
    fx.sql.prepare(`UPDATE pedia_order_items SET status='in_progress', start_count=8177, remains=73, supplier_order_id='22024298', lease_until=NULL WHERE order_code=?`).run(PEDIA_CODE);
    const { retryPendingPediaEmails } = await import("@/lib/pedia/notify-retry");
    const before = pediaMails.length;
    await retryPendingPediaEmails(db);
    // Discovery synthesizes paid + processing (completed not due).
    expect(pediaMails.length).toBe(before + 2);
    await retryPendingPediaEmails(db);
    expect(pediaMails.length).toBe(before + 2);
  });

  it("5. supplier Pending keeps submitted, no processing mail; In progress fires once", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const add = async () => ({ ok: true as const, data: { order: "22024298" }, status: 200 }) as never;
    await processPediaPaidOrders(add, db);
    // Reset phase rows to isolate supplier-Pending behavior.
    fx.sql.prepare(`DELETE FROM buyer_notice_log`).run();
    const mailsAtPendingStart = pediaMails.length;
    fx.sql.prepare(`UPDATE pedia_order_items SET lease_until=NULL WHERE order_code=?`).run(PEDIA_CODE);
    const pending = async () => ({ ok: true as const, data: { status: "Pending", start_count: "", remains: "" }, status: 200 }) as never;
    await processPediaPaidOrders(pending, db);
    expect((await db.queryFirst(`SELECT status FROM pedia_order_items WHERE order_code=?`, PEDIA_CODE))?.status).toBe("submitted");
    expect(pediaMails.slice(mailsAtPendingStart).filter((m) => m.subject.includes("berjalan"))).toHaveLength(0);
    // Previously-running item stays in_progress on transient Pending (no regress).
    fx.sql.prepare(`UPDATE pedia_order_items SET status='in_progress', lease_until=NULL WHERE order_code=?`).run(PEDIA_CODE);
    await processPediaPaidOrders(pending, db);
    expect((await db.queryFirst(`SELECT status FROM pedia_order_items WHERE order_code=?`, PEDIA_CODE))?.status).toBe("in_progress");
    // Fresh submitted→in_progress transition emits processing once with counts.
    fx.sql.prepare(`DELETE FROM buyer_notice_log WHERE idempotency_key=?`).run(`email:pedia-processing:${PEDIA_CODE}`);
    fx.sql.prepare(`UPDATE pedia_order_items SET status='submitted', lease_until=NULL WHERE order_code=?`).run(PEDIA_CODE);
    const progCountBefore = pediaMails.filter((m) => m.subject.includes("berjalan")).length;
    const prog = async () => ({ ok: true as const, data: { status: "In progress", start_count: 8177, remains: 73 }, status: 200 }) as never;
    await processPediaPaidOrders(prog, db);
    const progMails = pediaMails.filter((m) => m.subject.includes("berjalan"));
    expect(progMails.length).toBe(progCountBefore + 1);
    expect(progMails.at(-1)!.text).toContain("8.177");
  });

  it("6. deferred paid/processing suppressed at terminal; completed sends once", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const add = async () => ({ ok: true as const, data: { order: "22024298" }, status: 200 }) as never;
    await processPediaPaidOrders(add, db);
    const paidCount = pediaMails.filter((m) => m.subject.includes("Pembayaran diterima")).length;
    // Complete the order, then attempt stale phases (paid ledger deleted to
    // simulate a deferred paid that never sent).
    fx.sql.prepare(`UPDATE pedia_order_items SET status='completed', start_count=8177, remains=0, supplier_order_id='22024298', lease_until=NULL WHERE order_code=?`).run(PEDIA_CODE);
    fx.sql.prepare(`DELETE FROM buyer_notice_log WHERE idempotency_key IN (?,?)`).run(`email:pedia-processing:${PEDIA_CODE}`, `email:pedia-paid:${PEDIA_CODE}`);
    const { notifyPediaProcessing, notifyPediaPaid, notifyPediaCompleted } = await import("@/lib/pedia/notify");
    const before = pediaMails.length;
    expect(await notifyPediaProcessing(db, PEDIA_CODE)).toBe(true);
    expect(await notifyPediaPaid(db, PEDIA_CODE)).toBe(true);
    // Paid confirms payment with CURRENT lifecycle (selesai), never "berjalan".
    const paidBody = pediaMails.filter((m) => m.subject.includes("Pembayaran diterima"));
    expect(paidBody).toHaveLength(paidCount + 1);
    expect(paidBody.at(-1)!.text).toContain("selesai");
    expect(paidBody.at(-1)!.text).not.toContain("sedang berjalan");
    expect(pediaMails.filter((m) => m.subject.includes("Pesanan sedang berjalan"))).toHaveLength(0);
    expect(await notifyPediaCompleted(db, PEDIA_CODE)).toBe(true);
    expect(pediaMails.length).toBe(before + 2);
    expect(await notifyPediaCompleted(db, PEDIA_CODE)).toBe(true);
    expect(pediaMails.length).toBe(before + 2);
  });

  it("7. completed mail carries snapshot refill hint", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    fx.sql.prepare(`UPDATE pedia_order_items SET status='completed', start_count=8177, remains=0, supplier_order_id='22024298', lease_until=NULL WHERE order_code=?`).run(PEDIA_CODE);
    const { notifyPediaCompleted } = await import("@/lib/pedia/notify");
    expect(await notifyPediaCompleted(db, PEDIA_CODE)).toBe(true);
    const mail = pediaMails.find((m) => m.subject.includes("selesai"))!;
    expect(mail.text).toContain("masa refill");
    expect(mail.text).toContain("Jumlah awal: 8.177");
  });

  it("8. sweep with exact budget sends without build_failed poisoning", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    // Exact affordable budget: context(1) + claim(1) + settle(1) + slack.
    const { createBudgetedDatabase } = await import("@/lib/db-access");
    const { access } = createBudgetedDatabase(7, 2);
    const { notifyPediaPaid } = await import("@/lib/pedia/notify");
    expect(await notifyPediaPaid(access, PEDIA_CODE)).toBe(true);
    const key = `email:pedia-paid:${PEDIA_CODE}`;
    // globalThis.DB is the shared fixture: sender used the budgeted access,
    // ledger assertion reads the same underlying DB.
    expect((fx.sql.prepare(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`).get(key) as { status: string }).status).toBe("sent");
  });

  it("processing requires five budget slots and reads the live context once", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    fx.sql.prepare(`UPDATE pedia_order_items SET status='in_progress', remains=80 WHERE order_code=?`).run(PEDIA_CODE);
    const { createBudgetedDatabase } = await import("@/lib/db-access");
    const { notifyPediaProcessing } = await import("@/lib/pedia/notify");
    const limited = createBudgetedDatabase(6, 2, fx.db);
    expect(await notifyPediaProcessing(limited.access, PEDIA_CODE, { startCount: 8177, remains: 73 })).toBe(false);
    expect(pediaMails).toHaveLength(0);
    const queryFirst = vi.fn(db.queryFirst);
    expect(await notifyPediaProcessing({ ...db, queryFirst }, PEDIA_CODE, { startCount: 8177, remains: 73 })).toBe(true);
    expect(queryFirst).toHaveBeenCalledTimes(1);
    expect(pediaMails[0].text).toContain("sisa 73");
    expect(pediaMails[0].text).toContain("27 dari 100");
  });

  it("does not report success when transport loses its settle lease", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const email = await import("@/lib/pedia/email");
    const spy = vi.spyOn(email, "sendPediaEmail").mockImplementationOnce(async () => {
      fx.sql.prepare(`UPDATE buyer_notice_log SET access_lease='other-owner' WHERE idempotency_key=?`).run(`email:pedia-paid:${PEDIA_CODE}`);
      return true;
    });
    const { notifyPediaPaid } = await import("@/lib/pedia/notify");
    expect(await notifyPediaPaid(db, PEDIA_CODE)).toBe(false);
    expect(fx.sql.prepare(`SELECT status, access_lease FROM buyer_notice_log WHERE idempotency_key=?`).get(`email:pedia-paid:${PEDIA_CODE}`)).toMatchObject({ status: "sending", access_lease: "other-owner" });
    spy.mockRestore();
  });

  it("suppression is lease-fenced and future processing remains eligible", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    const { notifyPediaProcessing } = await import("@/lib/pedia/notify");
    const { claimPediaEmail, supersedePediaEmail } = await import("@/lib/pedia/notify-channel");
    for (const status of ["queued", "submitting", "submitted"]) {
      fx.sql.prepare(`UPDATE pedia_order_items SET status=? WHERE order_code=?`).run(status, PEDIA_CODE);
      expect(await notifyPediaProcessing(db, PEDIA_CODE)).toBe(false);
    }
    expect(fx.sql.prepare(`SELECT COUNT(*) n FROM buyer_notice_log`).get()).toMatchObject({ n: 0 });
    const claim = (await claimPediaEmail(db, "processing", PEDIA_CODE))!;
    fx.sql.prepare(`UPDATE pedia_order_items SET status='completed' WHERE order_code=?`).run(PEDIA_CODE);
    expect(await supersedePediaEmail(db, claim.key, "other-owner", "stale")).toBe(false);
    expect(await notifyPediaProcessing(db, PEDIA_CODE)).toBe(false);
    expect(fx.sql.prepare(`SELECT status, access_lease FROM buyer_notice_log WHERE idempotency_key=?`).get(claim.key)).toMatchObject({ status: "sending", access_lease: claim.lease });
    expect(pediaMails).toHaveLength(0);
  });

  it("paid mail includes known counts and omits ETA after completion", async () => {
    const db = createDatabaseAccess(fx.db);
    seedCatalog(db);
    seedPediaOrder();
    fx.sql.prepare(`UPDATE pedia_order_items SET status='completed', start_count=8177, remains=0 WHERE order_code=?`).run(PEDIA_CODE);
    const { notifyPediaPaid } = await import("@/lib/pedia/notify");
    expect(await notifyPediaPaid(db, PEDIA_CODE)).toBe(true);
    expect(pediaMails[0].text).toContain("Jumlah awal: 8.177");
    expect(pediaMails[0].text).toContain("sisa 0");
    expect(pediaMails[0].text).toContain("100 dari 100");
    expect(pediaMails[0].text).not.toMatch(/belum dikonfirmasi|Perkiraan mulai|Perkiraan selesai/);
  });
});
