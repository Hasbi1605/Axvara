import { describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import {
  calculateSellPrice,
  generateProductSlug,
  mapWrCategory,
  parseWrDuration,
  parseWrWarranty,
  syncProducts,
  upsertWrVariant,
} from "@/lib/warung-rebahan/sync";
import type { WrProduct } from "@/lib/warung-rebahan/client";

vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");

function fixtureProduct(overrides: Partial<WrProduct> = {}): WrProduct {
  return {
    id: "prod-capcut",
    name: "CapCut Pro",
    category: "Productivity",
    description: "Edit video tanpa watermark",
    variants: [
      {
        id: "var-capcut-7h",
        name: "Pro 7 Hari",
        price: 5000,
        duration: "7 Hari",
        type: "Private",
        warranty: "7 Hari",
        stock: 10,
        terms: null,
        delivery_terms: null,
      },
    ],
    ...overrides,
  };
}

describe("Warung Rebahan pricing & parsing", () => {
  it("menghitung markup 50% dengan pembulatan 500 (contoh plan §15)", () => {
    expect(calculateSellPrice(5000, 50, 0)).toBe(7500);
    expect(calculateSellPrice(3200, 50, 0)).toBe(5000);
    expect(calculateSellPrice(35000, 50, 0)).toBe(52500);
    expect(calculateSellPrice(10000, 50, 0)).toBe(15000);
    expect(calculateSellPrice(5000, 50, 1000)).toBe(8500);
  });

  it("parse durasi WR ke format Axvara", () => {
    expect(parseWrDuration("7 Hari")).toMatchObject({ value: 7, unit: "day" });
    expect(parseWrDuration("1 Bulan")).toMatchObject({ value: 1, unit: "month" });
    expect(parseWrDuration("1 Tahun")).toMatchObject({ value: 1, unit: "year" });
    expect(parseWrDuration("Lifetime")).toMatchObject({ unit: "lifetime" });
    expect(parseWrDuration("2 Minggu")).toMatchObject({ value: 14, unit: "day" });
    expect(parseWrDuration("")).toMatchObject({ value: null, unit: null });
  });

  it("parse garansi WR ke format Axvara", () => {
    expect(parseWrWarranty("7 Hari").type).toBe("limited");
    expect(parseWrWarranty("Full 30 Hari").type).toBe("full");
    expect(parseWrWarranty("")).toMatchObject({ type: "none" });
    expect(parseWrWarranty("-")).toMatchObject({ type: "none" });
  });

  it("map kategori WR ke category_id Axvara", () => {
    expect(mapWrCategory("AI")).toBe(1);
    expect(mapWrCategory("Productivity")).toBe(3);
    expect(mapWrCategory("Streaming")).toBe(2);
    expect(mapWrCategory("Gaming")).toBe(2);
    expect(mapWrCategory("VPN")).toBe(3);
    expect(mapWrCategory("Entah")).toBe(2);
  });

  it("generate slug aman dan collision ditangani sync", () => {
    expect(generateProductSlug("CapCut Pro")).toBe("capcut-pro");
    expect(generateProductSlug("ChatGPT+ 1 Bulan!")).toBe("chatgpt-1-bulan");
  });
});

describe("Warung Rebahan product sync", () => {
  it("sync produk baru: registry + katalog + varian + agregat induk", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const result = await syncProducts(db, async () => [fixtureProduct()]);
      expect(result.synced).toBe(1);
      expect(result.newProducts).toBe(1);
      expect(result.newVariants).toBe(1);
      expect(result.errors).toEqual([]);

      const product = fx.sql
        .prepare("SELECT * FROM products WHERE wr_product_id='prod-capcut'")
        .get() as Record<string, unknown>;
      expect(String(product.source)).toBe("warung_rebahan");
      expect(Number(product.price)).toBe(7500);
      expect(Number(product.stock)).toBe(10);

      const variant = fx.sql
        .prepare("SELECT * FROM product_variants WHERE wr_variant_id='var-capcut-7h'")
        .get() as Record<string, unknown>;
      expect(Number(variant.price)).toBe(7500);
      expect(Number(variant.stock)).toBe(10);
      expect(String(variant.duration_unit)).toBe("day");
      expect(String(variant.warranty_type)).toBe("limited");

      const registry = fx.sql
        .prepare("SELECT * FROM wr_variants WHERE wr_variant_id='var-capcut-7h'")
        .get() as Record<string, unknown>;
      expect(Number(registry.wr_price)).toBe(5000);
      expect(Number(registry.axvara_sell_price)).toBe(7500);
    } finally {
      fx.close();
    }
  });

  it("exclusion manual: produk cocok pola hanya masuk registry excluded, tidak ke katalog", async () => {
    const fx = createD1Fixture();
    try {
      // Rule manual (seed 0027 sudah dihapus 0028): uji mekanisme exclusion.
      fx.sql.prepare("INSERT INTO wr_exclusions(pattern,reason) VALUES('%netflix%','uji')").run();
      const db = createDatabaseAccess(fx.db);
      const before = Number(
        (fx.sql.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n,
      );
      const result = await syncProducts(db, async () => [
        fixtureProduct({ id: "prod-netflix", name: "Netflix Premium" }),
      ]);
      expect(result.excluded).toBe(1);
      expect(result.synced).toBe(0);
      const after = Number(
        (fx.sql.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n,
      );
      expect(after).toBe(before);
      const registry = fx.sql
        .prepare("SELECT is_excluded FROM wr_products WHERE wr_product_id='prod-netflix'")
        .get() as { is_excluded: number };
      expect(Number(registry.is_excluded)).toBe(1);
    } finally {
      fx.close();
    }
  });

  it("sync kedua: update harga/stok idempoten tanpa produk ganda", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => [fixtureProduct()]);
      const second = await syncProducts(db, async () => [
        fixtureProduct({
          variants: [
            {
              id: "var-capcut-7h",
              name: "Pro 7 Hari",
              price: 6000,
              duration: "7 Hari",
              type: "Private",
              warranty: "7 Hari",
              stock: 4,
              terms: null,
              delivery_terms: null,
            },
          ],
        }),
      ]);
      expect(second.newProducts).toBe(0);
      expect(second.newVariants).toBe(0);
      expect(second.priceChanges).toBe(1);
      expect(second.stockChanges).toBe(1);
      const count = Number(
        (fx.sql.prepare("SELECT COUNT(*) n FROM products WHERE wr_product_id='prod-capcut'").get() as { n: number }).n,
      );
      expect(count).toBe(1);
      const variant = fx.sql
        .prepare("SELECT price, stock FROM product_variants WHERE wr_variant_id='var-capcut-7h'")
        .get() as { price: number; stock: number };
      expect(Number(variant.price)).toBe(9000);
      expect(Number(variant.stock)).toBe(4);
    } finally {
      fx.close();
    }
  });

  it("varian hilang dari API di-nol-kan stoknya, bukan dihapus", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => [fixtureProduct()]);
      await syncProducts(db, async () => [
        fixtureProduct({ variants: [] }),
      ]);
      const variant = fx.sql
        .prepare("SELECT stock FROM product_variants WHERE wr_variant_id='var-capcut-7h'")
        .get() as { stock: number };
      expect(Number(variant.stock)).toBe(0);
      const registry = fx.sql
        .prepare("SELECT COUNT(*) n FROM wr_variants WHERE wr_variant_id='var-capcut-7h'")
        .get() as { n: number };
      expect(Number(registry.n)).toBe(1);
    } finally {
      fx.close();
    }
  });

  it("slug collision dengan produk manual mendapat suffix -wr + nama (WR)", async () => {
    const fx = createD1Fixture();
    try {
      fx.sql
        .prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(99,'CapCut Pro','capcut-pro',10000,5)")
        .run();
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => [fixtureProduct()]);
      const product = fx.sql
        .prepare("SELECT slug, name FROM products WHERE wr_product_id='prod-capcut'")
        .get() as { slug: string; name: string };
      expect(String(product.slug)).toBe("capcut-pro-wr");
      expect(String(product.name)).toBe("CapCut Pro (WR)");
      // Produk manual tidak tersentuh.
      const manual = fx.sql.prepare("SELECT name, price FROM products WHERE id=99").get() as {
        name: string;
        price: number;
      };
      expect(manual.name).toBe("CapCut Pro");
      expect(Number(manual.price)).toBe(10000);
    } finally {
      fx.close();
    }
  });

  it("produk WR tanpa collision tetap dapat suffix nama (WR)", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => [fixtureProduct()]);
      const product = fx.sql
        .prepare("SELECT slug, name FROM products WHERE wr_product_id='prod-capcut'")
        .get() as { slug: string; name: string };
      expect(String(product.slug)).toBe("capcut-pro");
      expect(String(product.name)).toBe("CapCut Pro (WR)");
    } finally {
      fx.close();
    }
  });

  it("registry excluded yang diurungkan jadi katalog WR tanpa ganggu manual (skenario Canva)", async () => {
    const fx = createD1Fixture();
    try {
      // Produk manual sendiri yang sudah live.
      fx.sql
        .prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Canva Pro / Premium','canva-premium',2000,-1)")
        .run();
      fx.sql
        .prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock) VALUES(1,1,'CANVA-PRO-1','Invite 1 Bulan',2000,-1)")
        .run();
      // Registry WR dari masa excluded (axvara_product_id NULL).
      fx.sql
        .prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,wr_category,axvara_product_id,is_excluded) VALUES('wr-canva-1','Canva Premium','Design',NULL,1)")
        .run();
      const db = createDatabaseAccess(fx.db);
      // Exclusion sudah dihapus → sync membuat pasangan katalog baru.
      fx.sql.prepare("DELETE FROM wr_exclusions WHERE pattern LIKE '%canva%'").run();
      const result = await syncProducts(db, async () => [
        {
          id: "wr-canva-1",
          name: "Canva Premium",
          category: "Design",
          description: "Canva via WR",
          variants: [
            { id: "wr-canva-v1", name: "1 Bulan", price: 8000, duration: "30 Hari", type: "Private", warranty: "30 Hari", stock: 7, terms: null, delivery_terms: null },
          ],
        },
      ]);
      expect(result.newProducts).toBe(1);
      expect(result.excluded).toBe(0);
      const wrProduct = fx.sql
        .prepare("SELECT slug, name, source FROM products WHERE wr_product_id='wr-canva-1'")
        .get() as { slug: string; name: string; source: string };
      // Slug dasar "canva-premium" dipakai manual → WR dapat suffix.
      expect(String(wrProduct.slug)).toBe("canva-premium-wr");
      expect(String(wrProduct.name)).toBe("Canva Premium (WR)");
      expect(String(wrProduct.source)).toBe("warung_rebahan");
      // Manual tetap persis seperti semula.
      const manual = fx.sql.prepare("SELECT name, slug, price FROM products WHERE id=1").get() as {
        name: string;
        slug: string;
        price: number;
      };
      expect(manual).toMatchObject({ name: "Canva Pro / Premium", slug: "canva-premium", price: 2000 });
      const manualVariants = fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE product_id=1").get() as { n: number };
      expect(Number(manualVariants.n)).toBe(1);
      // Varian WR menempel ke produk WR, bukan ke manual.
      const wrVariant = fx.sql
        .prepare("SELECT product_id, price FROM product_variants WHERE wr_variant_id='wr-canva-v1'")
        .get() as { product_id: number; price: number };
      const wrProductId = Number(
        (fx.sql.prepare("SELECT id FROM products WHERE wr_product_id='wr-canva-1'").get() as { id: number }).id,
      );
      expect(Number(wrVariant.product_id)).toBe(wrProductId);
      expect(Number(wrVariant.price)).toBe(12000); // 8000 + 50% markup
    } finally {
      fx.close();
    }
  });

  it("API down: sync gagal jujur tanpa menghapus katalog", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const result = await syncProducts(db, async () => {
        throw new Error("Network disabled in fixture");
      });
      expect(result.synced).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      const log = fx.sql
        .prepare("SELECT status FROM wr_sync_log ORDER BY id DESC LIMIT 1")
        .get() as { status: string };
      expect(String(log.status)).toBe("failed");
    } finally {
      fx.close();
    }
  });

  it("dua varian beda UUID tapi 24-char awal sama tidak tabrakan SKU (kasus Canva/Gemini)", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
    const fx = createD1Fixture();
    try {
      // Pasca-migrasi 0028: Canva/Gemini tidak lagi di-exclude.
      const db = createDatabaseAccess(fx.db);
      // UUID Canva asli: 24 char alnum pertama sama, beda di ekor.
      const result = await syncProducts(db, async () => [
        {
          id: "122f6159-03cd-11f1-bf18-bc241112a182",
          name: "Canva Premium",
          category: "Productivity",
          description: "Canva via WR",
          variants: [
            { id: "24731e47-03cf-11f1-bf18-bc241112a182", name: "Member Pro", price: 5000, duration: "30 Hari", type: "Link", warranty: "30 Hari", stock: 0, terms: null, delivery_terms: null },
            { id: "60218877-9bda-11f1-af43-fa163e9e64f4", name: "Member Pro", price: 7000, duration: "80 Hari", type: "Link", warranty: "No Garansi", stock: 0, terms: null, delivery_terms: null },
            { id: "5c141bf5-0446-11f1-bf18-bc241112a182", name: "Member Edu Lifetime", price: 4000, duration: "365 Hari", type: "Link", warranty: "No Garansi", stock: 4, terms: null, delivery_terms: null },
          ],
        },
      ]);
      expect(result.errors).toEqual([]);
      expect(result.newVariants).toBe(3);
      const skus = fx.sql.prepare("SELECT sku FROM product_variants ORDER BY sku").all() as { sku: string }[];
      expect(new Set(skus.map((s) => s.sku)).size).toBe(3);
      const stocked = fx.sql
        .prepare("SELECT stock FROM product_variants WHERE wr_variant_id='5c141bf5-0446-11f1-bf18-bc241112a182'")
        .get() as { stock: number };
      expect(Number(stocked.stock)).toBe(4);
    } finally {
      fx.close();
    }
  });

    it("registry reset + produk WR yatim tidak membuat baris kedua (skenario prod 09:24)", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
    const fx = createD1Fixture();
    try {
      // Keadaan prod: registry ke-reset NULL padahal produk WR 51/52 masih ada.
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id,wr_auto_managed) VALUES(51,'Canva Premium (WR)','canva-premium-wr-2',0,0,'warung_rebahan','wr-canva-1',1)").run();
      fx.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id,is_excluded) VALUES('wr-canva-1','Canva Premium',NULL,0)").run();
      const db = createDatabaseAccess(fx.db);
      const result = await syncProducts(db, async () => [
        {
          id: "wr-canva-1",
          name: "Canva Premium",
          category: "Design",
          description: "x",
          variants: [
            { id: "wr-canva-v1", name: "Edu", price: 4000, duration: "365 Hari", type: "Link", warranty: "No Garansi", stock: 4, terms: null, delivery_terms: null },
          ],
        },
      ]);
      expect(result.errors).toEqual([]);
      // TIDAK ada baris kedua: registry menaut ulang ke produk yatim 51.
      const rows = fx.sql.prepare("SELECT id FROM products WHERE wr_product_id='wr-canva-1'").all() as { id: number }[];
      expect(rows.map((r) => Number(r.id))).toEqual([51]);
      const reg = fx.sql.prepare("SELECT axvara_product_id FROM wr_products WHERE wr_product_id='wr-canva-1'").get() as { axvara_product_id: number };
      expect(Number(reg.axvara_product_id)).toBe(51);
      // Varian menempel + stok terbaca.
      const variant = fx.sql.prepare("SELECT product_id, stock, price FROM product_variants WHERE wr_variant_id='wr-canva-v1'").get() as { product_id: number; stock: number; price: number };
      expect(Number(variant.product_id)).toBe(51);
      expect(Number(variant.stock)).toBe(4);
      expect(Number(variant.price)).toBe(6000);
      const parent = fx.sql.prepare("SELECT price, stock FROM products WHERE id=51").get() as { price: number; stock: number };
      expect(Number(parent.price)).toBe(6000);
      expect(Number(parent.stock)).toBe(4);
    } finally {
      fx.close();
    }
  });

  it("upsert varian tanpa produk Axvara tidak melempar", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const outcome = await upsertWrVariant(
        fixtureProduct().variants[0],
        "prod-capcut",
        0,
        db,
      );
      expect(outcome.isNew).toBe(false);
    } finally {
      fx.close();
    }
  });

  it("Opsi A: 48 produk tuntas SATU sweep dalam budget cron (tanpa cursor parsial)", async () => {
    const fx = createD1Fixture();
    try {
      // Tiru budget cron prod: 40 query, cadangan 2 → plafon 38.
      const budget = createBudgetedDatabase(40, 2, fx.db);
      const products = Array.from({ length: 48 }, (_, i) =>
        fixtureProduct({
          id: `prod-sweep-${String(i).padStart(2, "0")}`,
          name: `Sweep Product ${i}`,
          variants: [
            { ...fixtureProduct().variants[0], id: `var-sweep-${i}-a`, name: "A" },
            { ...fixtureProduct().variants[0], id: `var-sweep-${i}-b`, name: "B" },
          ],
        }),
      );
      const result = await syncProducts(budget.access, async () => products);
      // Tanpa raiseCeiling: berhenti di ~4 produk (budgetYielded). Dengan
      // Opsi A: seluruh 48 tuntas, cursor reset, snapshot lengkap.
      expect(result.budgetYielded).toBe(false);
      expect(result.synced).toBe(48);
      expect(result.snapshotComplete).toBe(true);
      const cursor = fx.sql.prepare("SELECT value FROM wr_sync_state WHERE key='products_cursor'").get() as Record<string, unknown>;
      expect(String(cursor.value)).toBe("0");
    } finally {
      fx.close();
    }
  });
});
