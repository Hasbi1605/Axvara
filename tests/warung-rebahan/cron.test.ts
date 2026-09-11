import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wr-cron-wa" })),
}));

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  const fs = await import("node:fs");
  fixture = createD1Fixture();
  fixture.sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
  vi.stubEnv("CRON_SECRET", "c");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Network disabled in fixture");
  }));
});
afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function runCron() {
  const { POST } = await import("@/app/api/cron/operations/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(
    new NextRequest("http://localhost/api/cron/operations", {
      method: "POST",
      headers: { authorization: "Bearer c" },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("cron fase warung_rebahan", () => {
  it("no-op aman saat master switch mati (tanpa bakar budget/deferred palsu)", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "false");
    const { status, body } = await runCron();
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.wr_orders_processed ?? 0).toBe(0);
    expect(body.wr_products_synced ?? 0).toBe(0);
  });

  it("memproses link WR due menjadi processing via API mock", async () => {
    fixture.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id,wr_auto_managed) VALUES(1,'CapCut Pro','capcut-pro',7500,10,'warung_rebahan','prod-capcut',1)").run();
    fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id,wr_auto_managed) VALUES(1,1,'WR-V1','Pro 7 Hari',7500,10,'manual','var-1',1)").run();
    fixture.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('prod-capcut','CapCut Pro',1)").run();
    fixture.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price) VALUES('var-1','prod-capcut','Pro 7 Hari',5000,10,1,7500)").run();
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id) VALUES('AXV-20260911-WR0001','B','6280',?,7500,'qris','lunas','paid','web','queued',1)`)
      .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut", price: 7500, qty: 1 }]));
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,next_attempt_at) VALUES('AXV-20260911-WR0001','var-1',1,5000,'pending',0,3,datetime('now','-1 minute'))").run();
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          message: "ok",
          data: { order_id: "ORD-CRON-1", status: "processing", payment_status: "paid", total_amount: 5000, current_balance: 100000 },
        }),
      })),
    );
    // Paksa fase WR aktif agar deterministik.
    fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES('cron_phase','warung_rebahan') ON CONFLICT(key) DO UPDATE SET value='warung_rebahan'").run();
    const { status, body } = await runCron();
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(Number(body.wr_orders_processed ?? 0)).toBe(1);
    expect(Number(body.wr_orders_succeeded ?? 0)).toBe(1);
    const link = fixture.sql.prepare("SELECT status, wr_order_id FROM wr_order_links").get() as { status: string; wr_order_id: string };
    expect(link.status).toBe("processing");
    expect(link.wr_order_id).toBe("ORD-CRON-1");
  });

  it("sync produk via cron mencatat wr_sync_log", async () => {
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "false");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          message: "ok",
          data: [
            {
              id: "prod-cron",
              name: "Cron Product",
              category: "Streaming",
              description: "dari cron",
              variants: [
                { id: "var-cron-1", name: "1 Bulan", price: 10000, duration: "30 Hari", type: "Private", warranty: "30 Hari", stock: 5, terms: null, delivery_terms: null },
              ],
            },
          ],
        }),
      })),
    );
    fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES('cron_phase','warung_rebahan') ON CONFLICT(key) DO UPDATE SET value='warung_rebahan'").run();
    const { status, body } = await runCron();
    expect(status).toBe(200);
    expect(Number(body.wr_products_synced ?? 0)).toBe(1);
    const log = fixture.sql.prepare("SELECT status, products_synced FROM wr_sync_log WHERE sync_type='products' ORDER BY id DESC LIMIT 1").get() as { status: string; products_synced: number };
    expect(log.status).toBe("success");
    expect(Number(log.products_synced)).toBe(1);
  });

  it("DB lama tanpa tabel WR: cron tetap hijau (fase WR no-op)", async () => {
    const fx2 = createD1Fixture(); // tanpa migrasi 0027
    const prevFixture = fixture;
    (fixture as unknown) = fx2;
    try {
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      const { POST } = await import("@/app/api/cron/operations/route");
      const { NextRequest } = await import("next/server");
      const res = await POST(
        new NextRequest("http://localhost/api/cron/operations", {
          method: "POST",
          headers: { authorization: "Bearer c" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBeUndefined();
    } finally {
      fx2.close();
      (fixture as unknown) = prevFixture;
    }
  });
});
