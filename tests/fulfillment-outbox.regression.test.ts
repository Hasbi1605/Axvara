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
// deliver.ts kini barrel; implementasi outbox pindah ke delivery/*. Gabungkan
// seluruh modul delivery agar assertion menilai implementasi sebenarnya
// (refactor 2026-09-09).
const readDelivery = (): string => {
  const dir = path.join(process.cwd(), "src/lib/fulfillment/delivery");
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
};

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
  it("cron heals paid orders that have no job row before processing due jobs", async () => {
    // RR5-02: orphan creates the durable job first; materialization
    // and delivery share the bounded due-job processor.
    // (processJobItems per-item). Estimasi lama COST_PER_ORPHAN_ORDER sudah
    // tidak dipakai di route.
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(cron).toContain("fulfillment_orphans_healed");
    expect(cron).toContain("reconcileOrphanLight(String(orphan.code), database)");
    expect(cron).toContain("COST_PER_ORPHAN_LIGHT");
    // Healing (orphan scan) tetap mendahului pemrosesan due jobs.
    const heal = cron.indexOf("fulfillment_orphans_healed");
    const due = cron.indexOf("getDueJobs(FULFILLMENT_PER_RUN, database)");
    expect(heal).toBeGreaterThan(-1);
    expect(due).toBeGreaterThan(heal);
    // Perilaku dibuktikan integration test RR3 (bukan pencarian string):
    // orphan paid order sembuh menjadi queued/delivered via entrypoint cron.
    // Cron butuh: fase fulfillment aktif, AUTO_FULFILLMENT, dan Telegram
    // notify yang tidak menelan budget (matikan agar fokus ke orphan).
    const { createD1Fixture, insertTestProduct, stubFulfillmentKey } = await import("./helpers/d1-fixture");
    const fx = createD1Fixture();
    const prevAuto = process.env.AUTO_FULFILLMENT_ENABLED;
    const prevBot = process.env.TELEGRAM_BOT_ENABLED;
    const prevToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.AUTO_FULFILLMENT_ENABLED = "true";
    process.env.TELEGRAM_BOT_ENABLED = "false";
    process.env.TELEGRAM_BOT_TOKEN = "";
    stubFulfillmentKey();
    try {
      await insertTestProduct(fx.sql, "manual", 1);
      fx.sql.prepare(`INSERT INTO orders
        (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
         sales_channel,fulfillment_status,variant_id,variant_snapshot)
        VALUES ('AXV-20260908-ORPH01','Buyer','628',?,10000,'qris','lunas','paid','web','queued',1,?)`)
        .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "M", price: 10000, qty: 1 }]),
          JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "manual" }] }));
      // Paksa fase fulfillment aktif pada run ini agar orphan scan jalan.
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('cron_phase','fulfillment') ON CONFLICT(key) DO UPDATE SET value='fulfillment'").run();
      const { POST } = await import("@/app/api/cron/operations/route");
      const { NextRequest } = await import("next/server");
      process.env.CRON_SECRET = "c";
      const res = await POST(new NextRequest("http://localhost/api/cron/operations", {
        method: "POST", headers: { authorization: "Bearer c" },
      }));
      expect(res.status).toBe(200);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code='AXV-20260908-ORPH01'").get()?.n).toBe(1);
    } finally {
      if (prevAuto === undefined) delete process.env.AUTO_FULFILLMENT_ENABLED; else process.env.AUTO_FULFILLMENT_ENABLED = prevAuto;
      if (prevBot === undefined) delete process.env.TELEGRAM_BOT_ENABLED; else process.env.TELEGRAM_BOT_ENABLED = prevBot;
      if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = prevToken;
      fx.close();
    }
  });

  it("recovery reuses the single idempotent ensure path and respects the flag", () => {
    const deliver = readDelivery();
    expect(deliver).toContain("export async function reconcileMissingFulfillmentJobs");
    expect(deliver).toContain("ensureFulfillmentForPaidOrder");
    expect(deliver).toContain("UNIQUE order_code");
    expect(deliver).toContain("AUTO_FULFILLMENT_ENABLED");
  });

  it("delivery still claims each job exactly once", () => {
    const deliver = readDelivery();
    expect(deliver).toContain("status IN ('queued','retry')");
    expect(deliver).toContain("markJobDelivered");
  });
});
