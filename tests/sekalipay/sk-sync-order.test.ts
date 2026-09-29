import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  flattenSkItems,
  isSkAutoVariant,
  mapSkCategory,
  calculateSkSellPrice,
  syncSkProducts,
} from "@/lib/sekalipay/sync";
import { createSkOrderLink, skIdempotencyKey, skRefId } from "@/lib/sekalipay/order";
import { formatSkLicenses } from "@/lib/sekalipay/deliver";
import {
  computeSkSignature,
  skStatusForSignature,
  verifySkWebhookSignature,
} from "@/lib/sekalipay/client";
import { createD1Fixture, stubFulfillmentKey } from "../helpers/d1-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function seedSkCatalog(fx: ReturnType<typeof createD1Fixture>) {
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,sk_product_id,sk_auto_managed) VALUES(1,'Netflix Premium (SK)','netflix-premium-sk',15000,10,'sekalipay','9',1)").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id,sk_auto_managed) VALUES(1,1,'SK-101','1 Bulan',15000,10,'manual','101',1)").run();
  fx.sql.prepare("INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price) VALUES('101','9','Netflix','1 Bulan',10000,10,'auto',1,1,15000)").run();
}

function seedSkOrder(fx: ReturnType<typeof createD1Fixture>, code: string) {
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at) VALUES(?,?,?,?,?,?,'lunas','paid','web','queued',1,datetime('now'))`)
    .run(code, "Buyer", "628000000000", JSON.stringify([{ product_id: 1, variant_id: 1, name: "Netflix (SK) — 1 Bulan", price: 15000, qty: 1 }]), 15000, "qris");
}

describe("sekalipay sync helpers", () => {
  it("hanya varian auto yang dibuatkan katalog (fase 1)", () => {
    expect(isSkAutoVariant({ order_process: "auto" })).toBe(true);
    expect(isSkAutoVariant({ order_process: "manual" })).toBe(false);
    expect(isSkAutoVariant({ order_process: "h2h" })).toBe(false);
    expect(isSkAutoVariant({ order_process: "smm" })).toBe(false);
  });

  it("flatten respons item + map kategori premium", () => {
    const flat = flattenSkItems([
      {
        id: 1, name: "Aplikasi Premium", icon: null,
        products: [
          {
            id: 9, name: "Netflix", image: null,
            variants: [
              { id: 101, sku: "N-1", name: "1 Bulan", price: 10000, stock: 5, order_process: "auto", h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
              { id: 102, sku: "N-2", name: "Manual", price: 9000, stock: 3, order_process: "manual", h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
            ],
          },
        ],
      },
    ]);
    expect(flat.map((f) => f.variant.id)).toEqual([101, 102]);
    expect(flat[0].productId).toBe(9);
    expect(mapSkCategory("Aplikasi Premium")).toBe(1);
  });

  it("harga jual kelipatan 500 seperti WR", () => {
    expect(calculateSkSellPrice(10000, 50, 0)).toBe(15000);
    expect(calculateSkSellPrice(3200, 50, 0)).toBe(5000);
  });

  it("sync membuat katalog untuk auto, mencatat registry untuk manual", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      const result = await syncSkProducts(db, async () => ({
        server_time: "2026-09-30T00:00:00+07:00",
        data: [
          {
            id: 1, name: "Aplikasi Premium", icon: null,
            products: [
              {
                id: 9, name: "Netflix", image: null,
                variants: [
                  { id: 101, sku: "N-1", name: "1 Bulan", price: 10000, stock: 5, order_process: "auto", h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                  { id: 102, sku: "N-2", name: " Manual Setup", price: 9000, stock: 3, order_process: "manual", h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                ],
              },
            ],
          },
        ],
      }), { trigger: "manual" });
      expect(result.errors).toEqual([]);
      expect(result.newProducts).toBe(1);
      expect(result.newVariants).toBe(1);
      expect(result.skippedNonAuto).toBe(1);
      const prod = fx.sql.prepare("SELECT name, source FROM products WHERE source='sekalipay'").get() as { name: string; source: string };
      expect(prod.name).toBe("Netflix (SK)");
      // Registry manual tercatat TANPA pasangan katalog.
      const manual = fx.sql.prepare("SELECT axvara_product_id, sk_order_process FROM sk_products WHERE sk_variant_id='102'").get() as { axvara_product_id: number | null; sk_order_process: string };
      expect(manual.axvara_product_id).toBeNull();
      expect(manual.sk_order_process).toBe("manual");
      // Sync TIDAK menyentuh sold_count / admin copy / min_qty.
      const variant = fx.sql.prepare("SELECT min_qty, handover_template FROM product_variants WHERE sk_variant_id='101'").get() as { min_qty: number; handover_template: string | null };
      expect(Number(variant.min_qty)).toBe(1);
      expect(variant.handover_template).toBeNull();
    } finally {
      fx.close();
    }
  });
});

describe("sekalipay order links", () => {
  it("ref_id stabil + idempoten per (order, varian)", async () => {
    expect(skRefId("AXV-X", "101", 1)).toBe(skIdempotencyKey("AXV-X", "101", 1));
    expect(skRefId("AXV-X", "101", 1).length).toBeLessThanOrEqual(191);
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      seedSkCatalog(fx);
      seedSkOrder(fx, "AXV-20260930-SK0002");
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      expect(await createSkOrderLink("AXV-20260930-SK0002", [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(1);
      expect(await createSkOrderLink("AXV-20260930-SK0002", [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("melewati varian non-auto dan non-SK", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      seedSkCatalog(fx);
      fx.sql.prepare("UPDATE sk_products SET sk_order_process='manual' WHERE sk_variant_id='101'").run();
      seedSkOrder(fx, "AXV-20260930-SK0003");
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      expect(await createSkOrderLink("AXV-20260930-SK0003", [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(0);
      vi.stubEnv("SEKALIPAY_ENABLED", "false");
      expect(await createSkOrderLink("AXV-20260930-SK0003", [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(0);
    } finally {
      fx.close();
    }
  });
});

describe("sekalipay webhook signature", () => {
  it("SHA256(ref:invoice:status:secret) + status event-dependent", async () => {
    expect(skStatusForSignature("order.completed", "completed")).toBe("completed");
    expect(skStatusForSignature("order.item.sent", "sent")).toBe("item.sent");
    expect(skStatusForSignature("webhook.test", "x")).toBe("test");
    const sig = await computeSkSignature("R1", "INV-1", "completed", "s3cr3t");
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    vi.stubEnv("SEKALIPAY_WEBHOOK_SECRET", "s3cr3t");
    const payload = {
      event: "order.completed",
      timestamp: "2026-09-30T00:00:00+07:00",
      data: { invoice: "INV-1", ref_id: "R1", status: "completed" },
    } as never;
    expect(await verifySkWebhookSignature(payload, sig)).toBe(true);
    expect(await verifySkWebhookSignature(payload, `0${sig.slice(1)}`)).toBe(false);
  });
});

describe("sekalipay license formatting", () => {
  it("licenses array + seller_note diformat rapi (reuse normalisasi WR)", () => {
    const text = formatSkLicenses({
      id: 1, ref_id: "R1", invoice: "INV-1", payment_method: "saldo", status: "completed",
      price: 10000, fees: 0, amount: 10000,
      items: [
        {
          variant_id: 101, variant_name: "1 Bulan", product_name: "Netflix",
          product_license: null, seller_note: "Login memakai akun yang diberikan.",
          price: 10000, qty: 1, note: null, order_process: "auto",
        },
      ],
      h2h_results: [], smm_results: [],
    });
    // Tanpa licenses: hanya seller_note yang tampil (tidak ada JSON mentah).
    expect(text).toContain("Catatan");
    expect(text).not.toContain("{");
    const withLic = formatSkLicenses({
      id: 1, ref_id: "R1", invoice: "INV-1", payment_method: "saldo", status: "completed",
      price: 10000, fees: 0, amount: 10000,
      items: [
        {
          variant_id: 101, variant_name: "1 Bulan", product_name: "Netflix",
          product_license: "user@mail.com|pass123", seller_note: null,
          price: 10000, qty: 1, note: null, order_process: "auto",
        },
      ],
      h2h_results: [], smm_results: [],
    });
    expect(withLic).toContain("user@mail.com");
  });
});
