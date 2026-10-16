import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder } from "./helpers/d1-fixture";
import { readOverviewFinancialReport, readSelectedFinancialReport, selectedReportFromFinancial } from "@/lib/dashboard-report";

let fixture: ReturnType<typeof createD1Fixture>;
const now = new Date("2026-10-16T10:00:00Z");
beforeEach(() => {
  fixture = createD1Fixture();
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Report','report',10000,10);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,manual_cost) VALUES(1,1,'R','Report',10000,10,3000)`);
  for (const [i, at] of ["2026-09-05T01:00:00Z", "2026-10-05T01:00:00Z", "2026-10-13T01:00:00Z", "2026-10-16T01:00:00Z"].entries()) {
    insertTestOrder(fixture.sql, `R${i}`, { status: "lunas", items: [{ product_id: 1, variant_id: 1, name: "Report", qty: 1, price: 10000 }] });
    fixture.sql.prepare("UPDATE orders SET subtotal=10001,paid_at=?,created_at=?,updated_at=? WHERE code=?").run(at, at, at, `R${i}`);
  }
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it.each(["today", "week", "month"] as const)("reuses %s without another SQL pipeline and preserves all report values", async selection => {
  const snapshot = await readOverviewFinancialReport(now);
  const queries = fixture.control.queries;
  const selected = selectedReportFromFinancial(selection, snapshot, now);
  expect(fixture.control.queries).toBe(queries);
  expect(selected).toEqual(await readSelectedFinancialReport(selection, now));
});

it("production private cache coalesces, expires and preserves the actual generation time", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.useFakeTimers(); vi.setSystemTime(now);
  const queries = fixture.control.queries;
  const snapshots = await Promise.all([readOverviewFinancialReport(now), readOverviewFinancialReport(now)]);
  expect(fixture.control.queries - queries).toBe(1);
  expect(snapshots[0]).toBe(snapshots[1]);
  const later = new Date(now.getTime() + 30_000); vi.setSystemTime(later);
  expect(selectedReportFromFinancial("today", await readOverviewFinancialReport(later), later).generated_at).toBe(now.toISOString());
  const expired = new Date(now.getTime() + 61_000); vi.setSystemTime(expired);
  expect((await readOverviewFinancialReport(expired)).generatedAt).toBe(expired.toISOString());
  expect(fixture.control.queries - queries).toBe(2);
});

it("failed reports are not cached", async () => {
  vi.stubEnv("NODE_ENV", "production");
  fixture.control.fail = sql => sql.startsWith("WITH");
  await expect(readOverviewFinancialReport(now)).rejects.toThrow();
  fixture.control.fail = null;
  expect((await readOverviewFinancialReport(now)).reports.total.orders).toBe(4);
});
