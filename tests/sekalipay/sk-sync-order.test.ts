import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  flattenSkItems,
  isSkAutoVariant,
  isSkExcluded,
  mapSkCategory,
  calculateSkSellPrice,
  syncSkProducts,
  zeroMissingSkVariants,
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
    expect(isSkAutoVariant({ order_process: "auto" as const })).toBe(true);
    expect(isSkAutoVariant({ order_process: "manual" as const })).toBe(false);
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
              { id: 101, sku: "N-1", name: "1 Bulan", price: 10000, stock: 5, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
              { id: 102, sku: "N-2", name: "Manual", price: 9000, stock: 3, order_process: "manual" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
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
                  { id: 101, sku: "N-1", name: "1 Bulan", price: 10000, stock: 5, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                  { id: 102, sku: "N-2", name: " Manual Setup", price: 9000, stock: 3, order_process: "manual" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
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

  it("sweep tanpa perubahan = baca-saja (cermin WR 2026-09-20: guard IS NOT hemat 97% tulis)", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const payload = () => ({
        server_time: "2026-09-30T00:00:00+07:00",
        data: [
          {
            id: 1, name: "Aplikasi Premium", icon: null,
            products: [
              {
                id: 9, name: "Netflix", image: null,
                variants: [
                  { id: 101, sku: "N-1", name: "1 Bulan", price: 10000, stock: 5, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                ],
              },
            ],
          },
        ],
      });
      const db = createDatabaseAccess(fx.db);
      const first = await syncSkProducts(db, async () => payload(), { trigger: "manual" });
      expect(first.errors).toEqual([]);
      // Sweep kedua dengan data IDENTIK: tidak ada perubahan harga/stok.
      const second = await syncSkProducts(createDatabaseAccess(fx.db), async () => payload(), { trigger: "cron" });
      expect(second.errors).toEqual([]);
      expect(second.priceChanges).toBe(0);
      expect(second.stockChanges).toBe(0);
      expect(second.newProducts).toBe(0);
      expect(second.newVariants).toBe(0);
      // Registry tetap 1 baris (upsert idempoten, bukan insert ganda).
      const n = fx.sql.prepare("SELECT COUNT(*) n FROM sk_products").get() as { n: number };
      expect(Number(n.n)).toBe(1);
    } finally {
      fx.close();
    }
  });

  it("perubahan nyata merambat penuh (cermin WR: ekuivalensi batch vs berurutan)", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const mkPayload = (price: number, stock: number) => ({
        server_time: "2026-09-30T00:00:00+07:00",
        data: [
          {
            id: 1, name: "Aplikasi Premium", icon: null,
            products: [
              {
                id: 9, name: "Netflix", image: null,
                variants: [
                  { id: 101, sku: "N-1", name: "1 Bulan", price, stock, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                ],
              },
            ],
          },
        ],
      });
      const db = createDatabaseAccess(fx.db);
      await syncSkProducts(db, async () => mkPayload(10000, 5), { trigger: "manual" });
      const changed = await syncSkProducts(createDatabaseAccess(fx.db), async () => mkPayload(12000, 7), { trigger: "cron" });
      expect(changed.errors).toEqual([]);
      expect(changed.priceChanges).toBe(1);
      expect(changed.stockChanges).toBe(1);
      // Harga jual katalog ikut modal baru (10000→15000, 12000→18000 @50%).
      const pv = fx.sql.prepare("SELECT price, stock FROM product_variants WHERE sk_variant_id='101'").get() as { price: number; stock: number };
      expect(Number(pv.price)).toBe(18000);
      expect(Number(pv.stock)).toBe(7);
      const reg = fx.sql.prepare("SELECT sk_price, sk_stock, axvara_sell_price FROM sk_products WHERE sk_variant_id='101'").get() as Record<string, unknown>;
      expect(Number(reg.sk_price)).toBe(12000);
      expect(Number(reg.axvara_sell_price)).toBe(18000);
    } finally {
      fx.close();
    }
  });

  it("markup admin tidak ditimpa default tiap sweep (cermin WR ownership)", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const payload = () => ({
        server_time: "2026-09-30T00:00:00+07:00",
        data: [
          {
            id: 1, name: "Aplikasi Premium", icon: null,
            products: [
              {
                id: 9, name: "Netflix", image: null,
                variants: [
                  { id: 101, sku: "N-1", name: "1 Bulan", price: 10000, stock: 5, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                ],
              },
            ],
          },
        ],
      });
      const db = createDatabaseAccess(fx.db);
      await syncSkProducts(db, async () => payload(), { trigger: "manual" });
      // Admin ubah markup jadi 100% via jalur panel (PUT /markup).
      fx.sql.prepare("UPDATE sk_products SET markup_percent=100 WHERE sk_variant_id='101'").run();
      await syncSkProducts(createDatabaseAccess(fx.db), async () => payload(), { trigger: "cron" });
      // 10000 + 100% = 20000 (bukan 15000 default 50%).
      const reg = fx.sql.prepare("SELECT axvara_sell_price FROM sk_products WHERE sk_variant_id='101'").get() as { axvara_sell_price: number };
      expect(Number(reg.axvara_sell_price)).toBe(20000);
      const pv = fx.sql.prepare("SELECT price FROM product_variants WHERE sk_variant_id='101'").get() as { price: number };
      expect(Number(pv.price)).toBe(20000);
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
                      { id: 101, sku: "N-1", name: "1 Bulan", price: 10000, stock: 5, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
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

  it("full Force Sync memakai scope premium TANPA delta (jujur + zero-missing)", async () => {    const fx = createD1Fixture();
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
                    order_process: "auto" as const, h2h_provider: null, provider_meta: null,
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
                  { id: 301, sku: "N-1", name: "1 Bulan", price: 15000, stock: 9, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
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

  it("Bug A: delta bohong TIDAK boleh zero-missing (replika insiden 195 stok 2026-09-30)", async () => {
    // Replika run cron id 24: delta 92 varian (klaim is_delta) padahal full
    // scope 99 — 32 varian hilang termasuk yang BERSTOK. Tanpa validasi,
    // zero-missing me-nol-kan 195 varian berstok (204/211 registry stok 0
    // padahal upstream 51/99 berstok).
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      // Seed registry seolah sweep penuh sebelumnya: 4 varian berstok.
      fx.sql.prepare(
        `INSERT INTO sk_products
          (sk_variant_id, sk_product_id, sk_product_name, sk_category, sk_variant_name,
           sk_price, sk_stock, sk_order_process, axvara_sell_price, last_synced_at)
         VALUES ('1','9','Netflix','Aplikasi Premium','1 Bulan',10000,5,'auto',15000,datetime('now')),
                ('2','9','Netflix','Aplikasi Premium','2 Bulan',10000,9,'auto',15000,datetime('now')),
                ('3','12','Viu','Aplikasi Premium','1 Bulan',5000,3,'auto',7500,datetime('now')),
                ('4','13','Prime','Aplikasi Premium','1 Bulan',8000,7,'auto',12000,datetime('now'))`,
      ).run();
      fx.sql.prepare("INSERT INTO sk_sync_state(key,value) VALUES('products_server_time','2026-09-30T18:40:29+07:00') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
      vi.stubEnv("SEKALIPAY_PROXY_URL", "https://proxy.test");
      vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "tok");
      // Delta BOHONG: hanya 2 dari 4 varian (klaim is_delta, ukuran ~setengah
      // full — di bawah ambang 80% registry sehingga lolos sebagai delta? TIDAK:
      // 2/4 = 50% < 80% → tetap dianggap delta. Test ini memakai 4/4 klaim
      // delta (100% ≥ 80%) agar validasi MENOLAK zero-missing.
      const lyingDelta = {
        message: "OK",
        data: [
          {
            id: 1, name: "Aplikasi Premium", icon: null,
            products: [
              {
                id: 9, name: "Netflix", image: null,
                variants: [
                  { id: 1, sku: "N-1", name: "1 Bulan", price: 10000, stock: 5, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                  { id: 2, sku: "N-2", name: "2 Bulan", price: 10000, stock: 9, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                  { id: 3, sku: "V-1", name: "1 Bulan", price: 5000, stock: 3, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                  { id: 4, sku: "P-1", name: "1 Bulan", price: 8000, stock: 7, order_process: "auto" as const, h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null },
                ],
              },
            ],
          },
        ],
        meta: { total_items: 4, is_delta: true },
        server_time: "2026-09-30T19:00:00+07:00",
      };
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => lyingDelta })));
      const result = await syncSkProducts(createDatabaseAccess(fx.db), undefined, { trigger: "cron" });
      expect(result.errors).toEqual([]);
      // Validasi menolak: zero-missing MATI (delta sebesar full = bohong),
      // server_time TIDAK maju (tetap cursor lama).
      const zeroed = fx.sql.prepare("SELECT COUNT(*) n FROM sk_products WHERE sk_stock=0").get() as { n: number };
      expect(Number(zeroed.n)).toBe(0);
      const st = fx.sql.prepare("SELECT value FROM sk_sync_state WHERE key='products_server_time'").get() as { value: string };
      expect(String(st.value)).toBe("2026-09-30T18:40:29+07:00");
    } finally {
      fx.close();
    }
  });

  it("Bug A2: zero-missing scope-safe — Game/TopUp tidak ikut di-nol-kan sweep premium", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      fx.sql.prepare(
        `INSERT INTO sk_products
          (sk_variant_id, sk_product_id, sk_product_name, sk_category, sk_variant_name,
           sk_price, sk_stock, sk_order_process, axvara_sell_price, last_synced_at)
         VALUES ('g1','100','MLBB','Game','86 Diamonds',5000,100,'h2h',7500,datetime('now')),
                ('p1','9','Netflix','Aplikasi Premium','1 Bulan',10000,5,'auto',15000,datetime('now'))`,
      ).run();
      // Sweep premium yang hanya melihat p1: g1 (Game) TIDAK BOLEH tersentuh.
      const zeroed = await zeroMissingSkVariants(new Set(["p1"]), createDatabaseAccess(fx.db));
      expect(zeroed).toBe(0);
      const g = fx.sql.prepare("SELECT sk_stock FROM sk_products WHERE sk_variant_id='g1'").get() as { sk_stock: number };
      expect(Number(g.sk_stock)).toBe(100);
    } finally {
      fx.close();
    }
  });

  it("Bug B: Sequenz menurunkan klaim delta palsu (is_delta=true tapi isi ~full scope)", async () => {
    vi.stubEnv("SEKALIPAY_PROXY_URL", "https://proxy.test");
    vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "tok");
    const { fetchSkItems } = await import("@/lib/sekalipay/client");
    // Upstream mengklaim delta tapi isinya 95/99 scope penuh.
    const variants = Array.from({ length: 95 }, (_, i) => ({
      id: 1000 + i, sku: `S-${i}`, name: `V${i}`, price: 5000, stock: 1,
      order_process: "auto", h2h_provider: null, provider_meta: null,
      required_fields: null, validation: null, updated_at: null,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        message: "OK",
        data: [{ id: 1, name: "Aplikasi Premium", icon: null, products: [{ id: 9, name: "Netflix", image: null, variants }] }],
        meta: { total_items: 99, is_delta: true },
        server_time: "2026-09-30T19:00:00+07:00",
      }),
    })));
    const res = await fetchSkItems({ perPage: "all", category: "Aplikasi Premium", updatedSince: "2026-09-30T18:40:29+07:00" });
    // Sequenz MENURUNKAN: 95 ≥ 80% × 99 → bukan delta jujur.
    expect(res.is_delta).toBe(false);
    expect(res.total_items).toBe(99);
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
          price: 10000, qty: 1, note: null, order_process: "auto" as const,
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
          price: 10000, qty: 1, note: null, order_process: "auto" as const,
        },
      ],
      h2h_results: [], smm_results: [],
    });
    expect(withLic).toContain("user@mail.com");
  });
});
