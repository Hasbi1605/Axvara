// tests/supplier-refresh.regression.test.ts — Penyegar status supplier
// bersama (2026-10-13, insiden WR Bstation + SK Prime Video).
//
// Mengunci perilaku baru yang meniru SK untuk WR:
// 1. Formatter WR bentuk {label, value} → "Label: nilai" per baris, TANPA
//    kata mentah "Product:"/"Label:"/"Value:" dan tanpa pemisah " · ".
// 2. Gerbang throttle per-order atomik: klaim pertama menang, klaim kedua
//    (walau bersamaan) tertahan dengan sisa cooldown > 0.
// 3. refreshSupplierOrderNow: link WR processing yang upstream-nya completed
//    langsung settle (item delivered + kredensial), tanpa webhook.
// 4. Bind saat link dibuat: fulfillment_items langsung ber-wr_link_id/sk_link_id.
// 5. Settle SK tidak menimpa item handover manual (manual_handover:%).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  seedWrCatalog,
  seedWrFulfillmentItem,
  seedWrOrder,
  setupWrFixture,
} from "./warung-rebahan/helpers";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearRateLimitBucketsForTest();
});

function stubWrTransactions(accountDetails: unknown) {
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "proxy-secret");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/transactions")) {
      return {
        ok: true,
        json: async () => ({
          success: true, message: "ok",
          data: [{
            order_id: "ORD-REFRESH-1", status: "completed", total_amount: 5000,
            payment_status: "paid", products: [], created_at: new Date().toISOString(),
            account_details: accountDetails,
          }],
        }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }));
}

describe("formatter WR bentuk {label, value} (screenshot Bstation 2026-10-13)", () => {
  it("payload [{product,label,value}...] tampil rapi per baris, nol teks mentah", async () => {
    const { normalizeAccountDetailsForDisplay, formatWrAccountDetails } = await import("@/lib/warung-rebahan/deliver");
    const payload = [
      { product: "Bstation - Premium 1B", label: "Email", value: "Jarwosuryo2504@gmail.com" },
      { product: "Bstation - Premium 1B", label: "Password", value: "permisi!!" },
    ];
    for (const out of [normalizeAccountDetailsForDisplay(payload), formatWrAccountDetails(payload)]) {
      expect(out).toContain("Email: Jarwosuryo2504@gmail.com");
      expect(out).toContain("Password: permisi!!");
      expect(out).not.toContain("Label:");
      expect(out).not.toContain("Value:");
      expect(out).not.toContain("Product:");
      expect(out).not.toContain(" · ");
      expect(out).not.toContain("Bstation - Premium 1B");
    }
    // Objek datar lama tidak regresi: pemisah kini newline, bukan " · ".
    const flat = normalizeAccountDetailsForDisplay({ email: "a@b.c", password: "p" });
    expect(flat).toBe("Email: a@b.c\nPassword: p");
  });
});

describe("supplier refresh bersama", () => {
  it("gerbang: klaim pertama menang, klaim berikutnya tertahan cooldown", async () => {
    const fx = await setupWrFixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const { claimSupplierRefreshGate } = await import("@/lib/orders/supplier-refresh");
      const first = await claimSupplierRefreshGate("AXV-20261013-GATE0001", db, 20);
      expect(first.acquired).toBe(true);
      const second = await claimSupplierRefreshGate("AXV-20261013-GATE0001", db, 20);
      expect(second.acquired).toBe(false);
      expect(second.retryAfterSeconds).toBeGreaterThan(0);
      expect(second.retryAfterSeconds).toBeLessThanOrEqual(20);
      // Order lain tidak ikut tertahan.
      const other = await claimSupplierRefreshGate("AXV-20261013-GATE0002", db, 20);
      expect(other.acquired).toBe(true);
    } finally {
      fx.close();
    }
  });

  it("refreshSupplierOrderNow: WR processing → completed + item delivered tanpa webhook", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20261013-REFRESH1");
      seedWrFulfillmentItem(fx, "AXV-20261013-REFRESH1");
      fx.sql.prepare(
        "INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,request_sent_at) VALUES('AXV-20261013-REFRESH1','ORD-REFRESH-1','var-1',1,5000,'processing',datetime('now'))",
      ).run();
      stubWrTransactions([{ label: "Email", value: "segar@example.com" }, { label: "Password", value: "pw-segar" }]);
      const db = createDatabaseAccess(fx.db);
      const { refreshSupplierOrderNow, maybeRefreshSupplierOrder } = await import("@/lib/orders/supplier-refresh");
      expect(await refreshSupplierOrderNow("AXV-20261013-REFRESH1", db)).toBe(true);
      const link = fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='ORD-REFRESH-1'").get() as { status: string };
      expect(link.status).toBe("completed");
      const item = fx.sql.prepare("SELECT status, delivered_ciphertext IS NOT NULL AS has_cred FROM fulfillment_items WHERE order_code='AXV-20261013-REFRESH1'").get() as { status: string; has_cred: number };
      expect(item.status).toBe("delivered");
      expect(Number(item.has_cred)).toBe(1);
      // Gerbang menahan tarikan beruntun: klaim pertama lewat (link sudah
      // terminal → no-op murah), klaim kedua tertahan cooldown.
      const first = await maybeRefreshSupplierOrder("AXV-20261013-REFRESH1", db);
      expect(first.skipped).toBe(false);
      const gated = await maybeRefreshSupplierOrder("AXV-20261013-REFRESH1", db);
      expect(gated.skipped).toBe(true);
    } finally {
      fx.close();
    }
  });

  it("bind saat dibuat: createWrOrderLink langsung menandai wr_link_id item", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20261013-BINDEARLY");
      seedWrFulfillmentItem(fx, "AXV-20261013-BINDEARLY");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      const { createWrOrderLink } = await import("@/lib/warung-rebahan/order");
      expect(await createWrOrderLink("AXV-20261013-BINDEARLY", [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(1);
      const link = fx.sql.prepare("SELECT id, fulfillment_item_id FROM wr_order_links WHERE order_code='AXV-20261013-BINDEARLY'").get() as { id: number; fulfillment_item_id: number };
      expect(Number(link.fulfillment_item_id)).toBeGreaterThan(0);
      const item = fx.sql.prepare("SELECT wr_link_id FROM fulfillment_items WHERE order_code='AXV-20261013-BINDEARLY'").get() as { wr_link_id: number };
      expect(Number(item.wr_link_id)).toBe(Number(link.id));
    } finally {
      fx.close();
    }
  });
});

describe("paritas SK", () => {
  function seedSkFixture() {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock,source,sk_product_id,sk_auto_managed) VALUES(1,'Remini Pro','remini-pro-sk',3500,10,'manual','9',1)`);
    fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id,sk_auto_managed) VALUES(10,1,'SKU-SK-AUTO','7 Hari Sharing',2000,100,'manual','101',1)`).run();
    fixture.sql.exec(`INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price) VALUES('101','9','Remini Pro','7 Hari Sharing',2225,10,'auto',1,10,3500)`);
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel)
      VALUES ('AXV-20261013-SKBIND01','Rani','6281234567890','rani@example.test',?,2000,'qris','DANA Business','lunas','paid','web')`)
      .run(JSON.stringify([{ product_id: 1, variant_id: 10, name: "Remini Pro — 7 Hari Sharing", price: 2000, qty: 1 }]));
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
      VALUES('AXV-20261013-SKBIND01',0,1,10,1,'manual','web','rani@example.test','queued',0,datetime('now'))`).run();
    return fixture;
  }

  it("bind saat dibuat: createSkOrderLink langsung menandai sk_link_id item", async () => {
    const fixture = seedSkFixture();
    try {
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "true");
      const db = createDatabaseAccess(fixture.db);
      const { createSkOrderLinksForOrder } = await import("@/lib/sekalipay/order");
      expect(await createSkOrderLinksForOrder("AXV-20261013-SKBIND01", db)).toBe(1);
      const link = fixture.sql.prepare("SELECT id, fulfillment_item_id FROM sk_order_links WHERE order_code='AXV-20261013-SKBIND01'").get() as { id: number; fulfillment_item_id: number };
      expect(Number(link.fulfillment_item_id)).toBeGreaterThan(0);
      const item = fixture.sql.prepare("SELECT sk_link_id FROM fulfillment_items WHERE order_code='AXV-20261013-SKBIND01'").get() as { sk_link_id: number };
      expect(Number(item.sk_link_id)).toBe(Number(link.id));
    } finally {
      fixture.close();
    }
  });

  it("settle SK TIDAK menimpa item handover manual admin", async () => {
    const fixture = seedSkFixture();
    try {
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      // Item sudah diserahkan admin manual (isi berbeda) SEBELUM supplier selesai.
      fixture.sql.prepare("UPDATE fulfillment_items SET status='delivered', delivered_message_id='manual', last_error='manual_handover:admin', delivered_ciphertext='ct-manual', delivered_iv='iv-manual' WHERE order_code='AXV-20261013-SKBIND01'").run();
      const itemId = Number((fixture.sql.prepare("SELECT id FROM fulfillment_items WHERE order_code='AXV-20261013-SKBIND01'").get() as { id: number }).id);
      fixture.sql.prepare(`INSERT INTO sk_order_links
        (order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,max_attempts,next_attempt_at,fulfillment_item_id,sk_invoice,idempotency_key)
        VALUES('AXV-20261013-SKBIND01','101',1,2225,'processing',1,3,datetime('now'),?,'SPY-HANDOVER-1','sk:handover:1')`).run(itemId);
      const db = createDatabaseAccess(fixture.db);
      const { handleSkOrderCompleted } = await import("@/lib/sekalipay/deliver");
      await handleSkOrderCompleted("SPY-HANDOVER-1", {
        id: 1, ref_id: "sk:AXV-20261013-SKBIND01:101:1", invoice: "SPY-HANDOVER-1", payment_method: "saldo", status: "completed",
        price: 2225, fees: 0, amount: 2225,
        items: [{ variant_id: 101, variant_name: "7 Hari Sharing", product_name: "Remini Pro", product_license: "LIC-SUPPLIER", seller_note: null, price: 2225, qty: 1, note: null, order_process: "auto" }],
        h2h_results: [], smm_results: [],
      } as never, db);
      const item = fixture.sql.prepare("SELECT delivered_ciphertext, delivered_message_id FROM fulfillment_items WHERE id=?").get(itemId) as { delivered_ciphertext: string; delivered_message_id: string };
      // Isi admin dipertahankan — supplier tidak menimpa.
      expect(item.delivered_ciphertext).toBe("ct-manual");
      expect(item.delivered_message_id).toBe("manual");
    } finally {
      fixture.close();
    }
  });
});
