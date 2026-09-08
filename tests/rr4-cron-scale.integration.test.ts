import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "dummy-wa" })),
}));

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  const { calculateCrc16 } = await import("@/lib/payments/dana-qris");
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_WEBHOOK_SECRET", "x");
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("CRON_SECRET", "c");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function cronRun(limit: number | null = null) {
  if (limit !== null) fixture.control.limit = limit;
  fixture.control.queries = 0;
  const { POST } = await import("@/app/api/cron/operations/route");
  const { NextRequest } = await import("next/server");
  const before = fixture.control.queries;
  const res = await POST(new NextRequest("http://localhost/api/cron/operations", {
    method: "POST", headers: { authorization: "Bearer c" },
  }));
  const out = {
    attempted: fixture.control.queries - before,
    status: res.status,
    body: await res.json() as Record<string, unknown>,
  };
  fixture.control.limit = Infinity;
  return out;
}

async function seedVariants(n: number, mode = "shared") {
  const has = fixture.sql.prepare("SELECT id FROM products WHERE id=1").get();
  if (!has) {
    await insertTestProduct(fixture.sql, mode, Math.min(n, 1));
  }
  const { encryptSecret } = await import("@/lib/fulfillment/crypto");
  const have = Number(fixture.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE product_id=1").get()?.n ?? 0);
  for (let i = have + 1; i <= n; i++) {
    const secret = await encryptSecret(`RR4-SHARED-${i}`);
    fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv) VALUES(?,1,?,?,10000,100,'shared',?,?)")
      .run(i, `SKU-${i}`, `Variant ${i}`, secret.ciphertext, secret.iv);
  }
  if (mode !== "shared") {
    fixture.sql.prepare("UPDATE product_variants SET fulfillment_mode=?").run(mode);
  }
}

async function paidOrder(code: string, n: number, mode = "shared") {
  await seedVariants(n, mode);
  const items = Array.from({ length: n }, (_, i) => ({
    product_id: 1, variant_id: i + 1, name: `Dummy ${i + 1}`, price: 10000, qty: 1,
  }));
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status,variant_id,variant_snapshot)
    VALUES (?,?,?, ?,?,?, 'lunas','paid','telegram','12345','12345','queued',1,?)`)
    .run(code, "R4", "628000000000", JSON.stringify(items), 10000 * n,
      JSON.stringify({ lines: items.map((it) => ({ variant_id: it.variant_id, fulfillment_mode: mode })) }));
  fixture.sql.prepare("INSERT OR IGNORE INTO telegram_users(user_id,chat_id) VALUES('12345','12345')").run();
  return fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
}

const jobStatus = (code: string) =>
  String(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE order_code=?").get(code)?.status ?? "none");
const orderStatus = (code: string) =>
  String(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code=?").get(code)?.fulfillment_status ?? "?");
const deliveredCount = (code: string) =>
  Number(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_items WHERE order_code=? AND status='delivered'").get(code)?.n ?? 0);

// ─── RR4-01: pesanan besar maju per item + checkpoint DB ───
describe("RR4-01 large orders advance item by item with DB checkpoints", () => {
  for (const n of [5, 8, 20]) {
    it(`order ${n} item selesai lintas invocation tanpa mengulang item delivered (batas dijelaskan)`, async () => {
      const code = `RR401-${n}ITEM`;
      const row = await paidOrder(code, n);
      const { ensureFulfillmentItems, createFulfillmentJob } = await import("@/lib/fulfillment/deliver");
      await createFulfillmentJob(code, null, "shared", 1, "telegram");
      await ensureFulfillmentItems(row);
      // Biaya satu item ≈ 5 query kirim; budget 40 → ≥1 item/run selalu
      // muat. Batas run = n (1 item/run terburuk) + 4 overhead fase.
      const BOUND = n + 4;
      let runs = 0;
      let progress: number[] = [];
      for (; runs < BOUND; runs++) {
        const r = await cronRun(50);
        expect(r.status).toBe(200);
        expect(r.body.error).toBeUndefined();
        expect(r.attempted).toBeLessThanOrEqual(50);
        progress.push(deliveredCount(code));
        if (jobStatus(code) === "delivered") break;
      }
      expect(jobStatus(code)).toBe("delivered");
      expect(orderStatus(code)).toBe("delivered");
      expect(deliveredCount(code)).toBe(n);
      // Kemajuan monoton: tidak ada run yang mengurangi delivered.
      for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
      expect(runs).toBeLessThan(BOUND);
    }, 60000);
  }

  it("order kecil di belakang order besar tetap dapat giliran (tanpa break menahan)", async () => {
    await paidOrder("RR401-BIG", 8).then(async (row) => {
      const { ensureFulfillmentItems, createFulfillmentJob } = await import("@/lib/fulfillment/deliver");
      await createFulfillmentJob("RR401-BIG", null, "shared", 1, "telegram");
      await ensureFulfillmentItems(row);
    });
    await paidOrder("RR401-SMALL", 1).then(async (row) => {
      const { ensureFulfillmentItems, createFulfillmentJob } = await import("@/lib/fulfillment/deliver");
      await createFulfillmentJob("RR401-SMALL", null, "shared", 1, "telegram");
      await ensureFulfillmentItems(row);
    });
    const BOUND = 8 + 1 + 6;
    for (let i = 0; i < BOUND; i++) {
      await cronRun(50);
      if (jobStatus("RR401-BIG") === "delivered" && jobStatus("RR401-SMALL") === "delivered") break;
    }
    expect(jobStatus("RR401-SMALL")).toBe("delivered");
    expect(jobStatus("RR401-BIG")).toBe("delivered");
  }, 60000);

  it("kemajuan bertahan lintas pemuatan ulang modul (checkpoint di DB, bukan memori)", async () => {
    const row = await paidOrder("RR401-RELOAD", 8);
    const d1 = await import("@/lib/fulfillment/deliver");
    await d1.createFulfillmentJob("RR401-RELOAD", null, "shared", 1, "telegram");
    await d1.ensureFulfillmentItems(row);
    await cronRun(50);
    const mid = deliveredCount("RR401-RELOAD");
    expect(mid).toBeGreaterThan(0);
    // Simulasi restart worker: modul segar tanpa memori proses lama.
    vi.resetModules();
    const BOUND = 8 + 6;
    for (let i = 0; i < BOUND; i++) {
      await cronRun(50);
      if (jobStatus("RR401-RELOAD") === "delivered") break;
    }
    expect(jobStatus("RR401-RELOAD")).toBe("delivered");
    expect(deliveredCount("RR401-RELOAD")).toBe(8);
  }, 60000);

  it("yield karena budget tidak menghabiskan jatah retry order 20 item", async () => {
    const row = await paidOrder("RR401-YIELD", 20);
    const { ensureFulfillmentItems, createFulfillmentJob } = await import("@/lib/fulfillment/deliver");
    await createFulfillmentJob("RR401-YIELD", null, "shared", 1, "telegram");
    await ensureFulfillmentItems(row);
    const BOUND = 20 + 6;
    for (let i = 0; i < BOUND; i++) {
      await cronRun(50);
      if (jobStatus("RR401-YIELD") === "delivered") break;
    }
    expect(jobStatus("RR401-YIELD")).toBe("delivered");
    // Item tidak pernah failed hanya karena yield budget.
    expect(Number(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_items WHERE order_code='RR401-YIELD' AND status='failed'").get()?.n ?? 0)).toBe(0);
  }, 90000);
});

// ─── RR4-02: orphan tunduk pada budget yang sama ───
describe("RR4-02 orphan recovery stays under the same per-invocation budget", () => {
  it("satu orphan shared 4 item: aktual < 50 dengan margin finalisasi", async () => {
    await paidOrder("RR402-1", 4);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code='RR402-1'").get()?.n).toBe(0);
    const r = await cronRun(50);
    expect(r.status).toBe(200);
    expect(r.body.error).toBeUndefined();
    expect(r.attempted).toBeLessThanOrEqual(50);
    // Lintas invocation tuntas penuh.
    for (let i = 0; i < 8 && jobStatus("RR402-1") !== "delivered"; i++) await cronRun(50);
    expect(jobStatus("RR402-1")).toBe("delivered");
    expect(deliveredCount("RR402-1")).toBe(4);
  }, 60000);

  it("dua orphan shared 4 item: tiap invocation < 50, tuntas lintas run", async () => {
    await paidOrder("RR402-A", 4);
    await paidOrder("RR402-B", 4);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    const BOUND = 12;
    let maxAttempted = 0;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun(50);
      expect(r.status).toBe(200);
      expect(r.body.error).toBeUndefined();
      maxAttempted = Math.max(maxAttempted, r.attempted);
      expect(r.attempted).toBeLessThanOrEqual(50);
      if (jobStatus("RR402-A") === "delivered" && jobStatus("RR402-B") === "delivered") break;
    }
    expect(jobStatus("RR402-A")).toBe("delivered");
    expect(jobStatus("RR402-B")).toBe("delivered");
    expect(maxAttempted).toBeLessThanOrEqual(50);
  }, 90000);

  it("dua orphan manual 3 item: tiap invocation < 50, agregat manual_required", async () => {
    await paidOrder("RR402-M1", 3, "manual");
    await paidOrder("RR402-M2", 3, "manual");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    // Batas: 2 run untuk orphan ringan (fase bergilir memaksa fulfillment
    // hanya tiap run genap pada DB kosong) + 2 run kirim + sla.
    const BOUND = 12;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun(50);
      expect(r.status).toBe(200);
      expect(r.body.error).toBeUndefined();
      expect(r.attempted).toBeLessThanOrEqual(50);
      const done = fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code IN ('RR402-M1','RR402-M2')").get()?.n;
      if (Number(done) === 2
        && orderStatus("RR402-M1") === "manual_required"
        && orderStatus("RR402-M2") === "manual_required") break;
      if (i === BOUND - 1) {
        expect(orderStatus("RR402-M1")).toBe("manual_required");
        expect(orderStatus("RR402-M2")).toBe("manual_required");
      }
    }
    expect(orderStatus("RR402-M1")).toBe("manual_required");
    expect(orderStatus("RR402-M2")).toBe("manual_required");
  }, 90000);
});

// ─── RR4-06: initializing basi pulih tanpa pending lain ───
describe("RR4-06 stale initializing recovers without depending on other pending work", () => {
  it("satu ledger initializing basi dipulihkan operations cron dalam batas run", async () => {
    await seedVariants(1, "manual");
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,expires_at)
      VALUES ('RR406-1','X','6280',?,10000,'qris','pending','pending','telegram',datetime('now','-20 minutes'))`)
      .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "F", price: 10000, qty: 1 }]));
    const { createDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    await createDanaQrisInvoice("RR406-1", 10000);
    fixture.sql.prepare("UPDATE payment_transactions SET status='initializing', created_at=datetime('now','-20 minutes') WHERE order_code='RR406-1'").run();
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n).toBe(0);
    const BOUND = 6;
    let recovered = false;
    for (let i = 0; i < BOUND; i++) {
      const r = await cronRun(50);
      expect(r.status).toBe(200);
      expect(r.attempted).toBeLessThanOrEqual(50);
      const st = String(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code='RR406-1'").get()?.status ?? "");
      if (st !== "initializing") { recovered = true; break; }
    }
    expect(recovered).toBe(true);
    expect(String(fixture.sql.prepare("SELECT status FROM orders WHERE code='RR406-1'").get()?.status ?? "")).not.toBe("pending");
  });

  it("initializing yang masih aktif tidak dibatalkan prematur", async () => {
    await seedVariants(1, "manual");
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,expires_at)
      VALUES ('RR406-FRESH','X','6280',?,10000,'qris','pending','pending','telegram',datetime('now','+10 minutes'))`)
      .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "F", price: 10000, qty: 1 }]));
    const { createDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    await createDanaQrisInvoice("RR406-FRESH", 10000);
    fixture.sql.prepare("UPDATE payment_transactions SET status='initializing', created_at=datetime('now') WHERE order_code='RR406-FRESH'").run();
    await cronRun(50);
    await cronRun(50);
    expect(String(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code='RR406-FRESH'").get()?.status ?? "")).toBe("initializing");
    expect(String(fixture.sql.prepare("SELECT status FROM orders WHERE code='RR406-FRESH'").get()?.status ?? "")).toBe("pending");
  });
});
