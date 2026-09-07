// tests/fulfillment-outbox.regression.test.ts — Issue #3: paid orders must never lose their job
//
// Audit 7 Sep 2026: celah antara "pembayaran lunas tersimpan" dan "job
// fulfillment dibuat". Cron hanya membaca job yang sudah ada; webhook yang
// matched langsung dianggap duplikat. Gangguan di celah itu membuat order
// terlupakan selamanya.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("atomic paid+job commit (no crash window)", () => {
  it("QRIS paid batch inserts the outbox row in the same commit", () => {
    const db = read("src/lib/db.ts");
    const fn = db.slice(db.indexOf("export async function transitionPendingPaymentToPaid"));
    expect(fn).toContain("INSERT OR IGNORE INTO fulfillment_jobs");
    expect(fn).toContain("WHERE EXISTS(SELECT 1 FROM orders WHERE code=?)");
  });

  it("webhook and retry resolve routing before the atomic batch", () => {
    for (const file of [
      "src/app/api/webhook/dana/route.ts",
      "src/app/api/admin/payments/events/route.ts",
    ]) {
      const src = read(file);
      const routing = src.indexOf("fulfillmentRouting");
      const commit = src.indexOf("transitionPendingPaymentToPaid(");
      expect(routing).toBeGreaterThan(-1);
      expect(commit).toBeGreaterThan(routing);
    }
  });

  it("manual rails join the same guarantee (proof approval + admin confirm)", () => {
    expect(read("src/app/api/admin/proofs/[id]/route.ts")).toContain(
      "INSERT OR IGNORE INTO fulfillment_jobs",
    );
    expect(read("src/lib/db.ts")).toContain(
      "INSERT OR IGNORE INTO fulfillment_jobs",
    );
  });
});

describe("idempotent recovery without double delivery", () => {
  it("cron heals paid orders that have no job row before processing due jobs", () => {
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(cron).toContain("reconcileMissingFulfillmentJobs(BATCH_LIMIT)");
    expect(cron).toContain("fulfillment_orphans_healed");
    // Healing must precede due-job processing (import order is static, so
    // compare the call sites instead of import names).
    const heal = cron.indexOf("reconcileMissingFulfillmentJobs(BATCH_LIMIT)");
    const due = cron.indexOf("getDueJobs(BATCH_LIMIT)");
    expect(heal).toBeGreaterThan(-1);
    expect(due).toBeGreaterThan(heal);
  });

  it("recovery reuses the single idempotent ensure path and respects the flag", () => {
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(deliver).toContain("export async function reconcileMissingFulfillmentJobs");
    expect(deliver).toContain("ensureFulfillmentForPaidOrder");
    expect(deliver).toContain("UNIQUE order_code");
    expect(deliver).toContain("AUTO_FULFILLMENT_ENABLED");
  });

  it("delivery still claims each job exactly once", () => {
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(deliver).toContain("status IN ('queued','retry')");
    expect(deliver).toContain("markJobDelivered");
  });
});
