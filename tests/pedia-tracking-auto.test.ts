// tests/pedia-tracking-auto.test.ts — PEDIA-IMPL-ORDER Outcome3 fixture reproduction.
// Supplier -> DB -> API -> UI chain (no network/prod): poll Completed8278
// writes DB, status API stays DB-only/no-store, UI helpers auto-advance
// in_progress -> completed without manual refresh, failure keeps terminal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { pediaPollMs, pediaProgress, knownCount } from "@/components/pedia/status-view";

const CODE = "AXP-20261103-35D31DA7";
const EMAIL = "buyer@example.test";

let fx: ReturnType<typeof createD1Fixture>;

function seed() {
  fx.sql.prepare(
    `INSERT INTO pedia_products (id, slug, platform, metric, target_kind, name, packages_json, step, is_active)
     VALUES (31, 'followers-test','instagram','followers','profile','Followers Test','[50]',10,1)`,
  ).run();
  fx.sql.prepare(
    `INSERT INTO pedia_tiers (id, product_id, tier, supplier, supplier_service_id, price_group,
       markup_pct, min_profit_rp, refill_days, package_prices_json, is_active, eta_start, eta_finish)
     VALUES (41, 31, 'standar', 'indosmm', 9475, 'G3', 20, 1000, 365, '{"50":5000}', 1, '0-1 jam', '1-12 jam')`,
  ).run();
  fx.sql.prepare(
    `INSERT INTO pedia_supplier_services (supplier, service_id, name, category, type, rate_idr_per_1k, min_qty, max_qty, present)
     VALUES ('indosmm', 9475, 'IG Followers HQ', 'IG', 'Default', 5000, 10, 100000, 1)`,
  ).run();
  fx.sql.prepare(
    `INSERT INTO orders (code, customer_name, customer_wa, customer_email, items, subtotal,
       payment_method, status, payment_status, sales_channel, order_kind, paid_at)
     VALUES (?, '', '62812', ?, '[]', 5000, 'qris', 'lunas', 'paid', 'web', 'pedia', datetime('now'))`,
  ).run(CODE, EMAIL);
  fx.sql.prepare(
    `INSERT INTO pedia_order_items (order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized,
       quantity, unit_price, total, credit_used, supplier, supplier_service_id, supplier_rate_snapshot,
       supplier_order_id, start_count, status, submit_attempts, lease_until)
     VALUES (?, 31, 41, '{}', 'https://instagram.com/x', 'https://instagram.com/x',
       50, 100, 5000, 0, 'indosmm', 9475, 5000, '22042392', 0, 'in_progress', 1, NULL)`,
  ).run(CODE);
}

beforeEach(() => {
  fx = createD1Fixture();
  seed();
  vi.stubEnv("ADMIN_JWT_SECRET", "test-secret-0123456789abcdef");
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("supplier->DB->API->UI auto-update (fixture, no prod)", () => {
  it("in_progress start 0 -> supplier Completed 8278 lands in DB, API, UI terminal", async () => {
    const db = createDatabaseAccess(fx.db);
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    await processPediaPaidOrders(async () => ({
      ok: true as const, data: { status: "Completed", start_count: 8278, remains: 0 }, status: 200,
    }) as never, db);
    const row = await db.queryFirst(`SELECT status, start_count FROM pedia_order_items WHERE order_code=?`, CODE);
    expect(row?.status).toBe("completed");
    expect(row?.start_count).toBe(8278);
    // DB -> API: GET stays DB-only (no supplier fetch), no-store, contact-gated no PIN.
    const { GET } = await import("@/app/api/pedia/orders/[code]/route");
    const req = new NextRequest(`http://x/api/pedia/orders/${CODE}`, { headers: { "x-order-contact": EMAIL } });
    const res = await GET(req, { params: Promise.resolve({ code: CODE }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json() as { order: Record<string, unknown> };
    expect(body.order.status).toBe("completed");
    expect(body.order.start_count).toBe(8278);
    expect(JSON.stringify(body.order)).not.toMatch(/indosmm|supplier_order|charge|rate/i);
    // API -> UI: helpers auto-advance without manual refresh; terminal stops timer.
    expect(pediaPollMs("in_progress")).toBe(10_000);
    expect(pediaPollMs("completed")).toBeNull();
    expect(pediaProgress({ status: "completed", quantity: 50, done: null, percent: null })).toEqual({ done: 50, percent: 100 });
    expect(knownCount(8278)).toBe(8278);
    expect(knownCount(null)).toBeNull();
  });

  it("terminal awaiting count correction stays terminal on failed recount (no regress)", async () => {
    const db = createDatabaseAccess(fx.db);
    fx.sql.prepare(`UPDATE pedia_order_items SET status='completed', start_count=NULL, lease_until=NULL WHERE order_code=?`).run(CODE);
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    // No perpetual terminal recount in cron: failure/supplier call never
    // re-reads terminal rows; correction is operator-script only.
    const caller = vi.fn(async () => ({ ok: false as const, kind: "timeout" }) as never);
    await processPediaPaidOrders(caller, db);
    const row = await db.queryFirst(`SELECT status, start_count FROM pedia_order_items WHERE order_code=?`, CODE);
    expect(row?.status).toBe("completed");
    expect(row?.start_count).toBeNull();
    expect(caller).not.toHaveBeenCalled();
    expect(pediaPollMs(String(row?.status))).toBeNull();
  });

  it("initial fetch failure (unknown status) self-retries instead of stopping", async () => {
    expect(pediaPollMs(undefined)).toBe(10_000);
    expect(pediaPollMs("completed")).toBeNull();
  });
});
