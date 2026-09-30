import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  flattenSkItems,
  isSkAutoVariant,
  isSkExcluded,
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
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,sk_product_id,sk_auto_managed) VALUES(1,'Netflix Premium (SK)','netflix-premium-sk',15000,10,'manual','9',1)").run();
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
      // Regresi bug 2026-09-30: logSkSync salah urutan kolom (status tak
      // terkirim) sehingga sk_sync_log KOSONG di prod walau sync jalan —
      // panel buta "Belum pernah". Baris log WAJIB ada per sweep.
      const log = fx.sql.prepare(
        "SELECT sync_type, status, products_total, products_synced, trigger FROM sk_sync_log ORDER BY id DESC LIMIT 1",
      ).get() as Record<string, unknown>;
      expect(log.sync_type).toBe("products");
      expect(log.status).toBe("success");
      expect(Number(log.products_total)).toBe(2);
      // products_synced = PRODUK unik (cermin WR), bukan baris varian.
      expect(Number(log.products_synced)).toBe(1);
      expect(log.trigger).toBe("manual");
      const prod = fx.sql.prepare("SELECT name, source, sk_product_id FROM products WHERE sk_product_id IS NOT NULL").get() as { name: string; source: string; sk_product_id: string };
      // Nama storefront bersih tanpa suffix (keputusan owner 2026-09-30);
      // pembeda WR vs SK hanya di admin + slug -sk.
      expect(prod.name).toBe("Netflix");
      // D1 prod memakai CHECK lama: source=manual + sk_product_id penanda.
      expect(prod.source).toBe("manual");
      expect(prod.sk_product_id).toBe("9");
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

  it("scope premium-only: fetch kronis memakai category + delta (hemat 4,3MB→95KB)", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      // Seed server_time agar jalur kronis (tanpa fetchFn) memilih delta.
      fx.sql.prepare("INSERT INTO sk_sync_state(key,value) VALUES('products_server_time','2026-09-30T17:07:08+07:00') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        calls.push(String(url));
        return {
          ok: true,
          json: async () => ({
            message: "OK",
            data: [
              {
                id: 1, name: "Aplikasi Premium", icon: null,
                products: [
                  {
                    id: 9, name: "Netflix", image: null,
                    variants: [
                      { id: 101, sku: "N-1", name: "1 Bulan", price: 10000, stock: 5, order_process: "auto", h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                    ],
                  },
                ],
              },
            ],
            meta: { total_items: 1, is_delta: true },
            server_time: "2026-09-30T17:36:14+07:00",
          }),
        };
      }));
      vi.stubEnv("SEKALIPAY_PROXY_URL", "https://proxy.test");
      vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "tok");
      const result = await syncSkProducts(db, undefined, { trigger: "cron" });
      expect(result.errors).toEqual([]);
      expect(Number(result.synced)).toBe(1);
      expect(Number(result.variantsSynced)).toBe(1);
      const url = calls[0] ?? "";
      // Scope premium WAJIB ada + delta WAJIB ada (keduanya, bukan salah satu).
      expect(url).toContain("category=Aplikasi+Premium");
      expect(url).toContain("updated_since=");
    } finally {
      fx.close();
    }
  });

  it("full Force Sync memakai scope premium TANPA delta (jujur + zero-missing)", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_PROXY_URL", "https://proxy.test");
      vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "tok");
      fx.sql.prepare("INSERT INTO sk_sync_state(key,value) VALUES('products_server_time','2026-09-30T17:07:08+07:00') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        calls.push(String(url));
        return {
          ok: true,
          json: async () => ({
            message: "OK", data: [], meta: { total_items: 0, is_delta: false },
            server_time: "2026-09-30T17:36:14+07:00",
          }),
        };
      }));
      const db = createDatabaseAccess(fx.db);
      await syncSkProducts(db, undefined, { trigger: "manual", full: true });
      const url = calls[0] ?? "";
      expect(url).toContain("category=Aplikasi+Premium");
      expect(url).not.toContain("updated_since=");
    } finally {
      fx.close();
    }
  });

  it("field khas SK tersimpan di registry (min_order, description, required, validasi)", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      await syncSkProducts(db, async () => ({
        server_time: "2026-09-30T00:00:00+07:00",
        data: [
          {
            id: 1, name: "Aplikasi Premium", icon: null,
            products: [
              {
                id: 10, name: "Gemini AI", image: null,
                variants: [
                  {
                    id: 201, sku: "GA-1", name: "Link 12 Bulan", price: 17700, stock: 3,
                    order_process: "auto", h2h_provider: null, provider_meta: null,
                    required_fields: [{ key: "note", label: "Catatan", required: false }],
                    validation: { available: false, endpoint: null, requires_zone_id: false, fields: [] },
                    updated_at: null, min_order: 2, status: "on", description: "LINK REDEEM",
                  },
                ],
              },
            ],
          },
        ],
      }), { trigger: "manual" });
      const row = fx.sql.prepare(
        "SELECT sk_min_order, sk_status, sk_description, sk_required_fields, sk_validation FROM sk_products WHERE sk_variant_id='201'",
      ).get() as Record<string, unknown>;
      expect(Number(row.sk_min_order)).toBe(2);
      expect(String(row.sk_status)).toBe("on");
      expect(String(row.sk_description)).toContain("LINK REDEEM");
      expect(String(row.sk_required_fields)).toContain("note");
      expect(String(row.sk_validation)).toContain("available");
    } finally {
      fx.close();
    }
  });

  it("exclusion menahan katalog tapi registry tetap tercatat", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      fx.sql.prepare("INSERT INTO sk_exclusions(pattern,reason) VALUES('%netflix%','bandingkan dulu')").run();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      expect((await isSkExcluded("Netflix Premium", db)).excluded).toBe(true);
      expect((await isSkExcluded("Spotify Premium", db)).excluded).toBe(false);
      const result = await syncSkProducts(db, async () => ({
        server_time: "2026-09-30T00:00:00+07:00",
        data: [
          {
            id: 1, name: "Aplikasi Premium", icon: null,
            products: [
              {
                id: 14, name: "Netflix", image: null,
                variants: [
                  { id: 301, sku: "N-1", name: "1 Bulan", price: 15000, stock: 9, order_process: "auto", h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                ],
              },
            ],
          },
        ],
      }), { trigger: "manual" });
      expect(result.errors).toEqual([]);
      expect(result.newProducts).toBe(0);
      // Registry tercatat TANPA pasangan katalog.
      const reg = fx.sql.prepare("SELECT axvara_product_id FROM sk_products WHERE sk_variant_id='301'").get() as { axvara_product_id: number | null };
      expect(reg.axvara_product_id).toBeNull();
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM products WHERE sk_product_id IS NOT NULL").get() as { n: number }).toMatchObject({ n: 0 });
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

describe("sekalipay fitur khas (validasi, lock, mutasi, trx)", () => {
  function stubSkFetch(handler: (url: string, init?: RequestInit) => unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => ({
        ok: true,
        json: async () => handler(url, init),
      })),
    );
  }

  it("validate + lock + release memakai endpoint SK yang benar", async () => {
    vi.stubEnv("SEKALIPAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_PROXY_URL", "https://proxy.test");
    vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "tok");
    const calls: string[] = [];
    stubSkFetch((url, init) => {
      calls.push(`${init?.method || "GET"} ${String(url).split("proxy.test")[1]}`);
      if (String(url).includes("/v1/item/validate")) {
        return { message: "OK", data: { display_name: "Aqaa.", account_name: "Aqaa.", region: null, cached: false } };
      }
      if (String(url).includes("/v1/item/lock/") && (init?.method || "GET") === "DELETE") {
        return { message: "OK" };
      }
      if (String(url).includes("/v1/item/lock")) {
        return { success: true, data: { lock_token: "LCK-1", item_id: 101, quantity: 1, locked_at: "2026-09-30T00:00:00Z", expires_at: "2026-09-30T00:10:00Z" } };
      }
      return { message: "OK", data: [] };
    });
    const { validateSkAccount, lockSkStock, releaseSkStockLock, listSkStockLocks } = await import(
      "@/lib/sekalipay/client"
    );
    const v = await validateSkAccount({ itemId: 101, customerId: "256632355", zoneId: "9402" });
    expect(v.account_name).toBe("Aqaa.");
    const lock = await lockSkStock({ itemId: 101, quantity: 1 });
    expect(lock.lock_token).toBe("LCK-1");
    expect(await releaseSkStockLock("LCK-1")).toBe(true);
    await listSkStockLocks();
    expect(calls.some((c) => c.includes("POST /sk/v1/item/validate"))).toBe(true);
    expect(calls.some((c) => c.includes("POST /sk/v1/item/lock"))).toBe(true);
    expect(calls.some((c) => c.includes("DELETE /sk/v1/item/lock/LCK-1"))).toBe(true);
  });

  it("mutasi + transaksi memakai query yang benar", async () => {
    vi.stubEnv("SEKALIPAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_PROXY_URL", "https://proxy.test");
    vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "tok");
    const calls: string[] = [];
    stubSkFetch((url) => {
      calls.push(String(url).split("proxy.test")[1]);
      if (String(url).includes("/v1/balance/mutations")) {
        return { message: "OK", data: [{ invoice: "INV-1", direction: "debit", type: "payment", amount: 50000, balance_before: 125000, balance_after: 75000 }], meta: {} };
      }
      return { message: "OK", data: { transactions: [], pagination: {} } };
    });
    const { getSkBalanceMutations } = await import("@/lib/sekalipay/saldo");
    const { fetchSkTransactions } = await import("@/lib/sekalipay/client");
    const m = await getSkBalanceMutations({ perPage: 10, direction: "debit" });
    expect(m.mutations[0]?.invoice).toBe("INV-1");
    await fetchSkTransactions({ page: 1, perPage: 10 });
    expect(calls.some((c) => c.includes("/sk/v1/balance/mutations") && c.includes("direction=debit"))).toBe(true);
    expect(calls.some((c) => c.includes("/sk/v1/trx"))).toBe(true);
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
