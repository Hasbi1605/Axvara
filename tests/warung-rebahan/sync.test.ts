import { describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  calculateSellPrice,
  generateProductSlug,
  isExcluded,
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

describe("Warung Rebahan exclusion rules", () => {
  it("Canva dan Gemini di-exclude dari seed migrasi 0027", async () => {
    const fx = createD1Fixture();
    try {
      fx.sql.exec(
        (await import("node:fs")).readFileSync(
          "drizzle/migrations/0027_warung_rebahan.sql",
          "utf8",
        ),
      );
      const db = createDatabaseAccess(fx.db);
      expect((await isExcluded("Canva Pro 1 Tahun", db)).excluded).toBe(true);
      expect((await isExcluded("CANVA EDU INVITE", db)).excluded).toBe(true);
      expect((await isExcluded("Gemini Advanced 1 Bulan", db)).excluded).toBe(true);
      expect((await isExcluded("CapCut Pro", db)).excluded).toBe(false);
    } finally {
      fx.close();
    }
  });
});

describe("Warung Rebahan product sync", () => {
  it("sync produk baru: registry + katalog + varian + agregat induk", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
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

  it("produk Canva/Gemini hanya masuk registry excluded, tidak ke katalog", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
      const db = createDatabaseAccess(fx.db);
      const before = Number(
        (fx.sql.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n,
      );
      const result = await syncProducts(db, async () => [
        fixtureProduct({ id: "prod-canva", name: "Canva Pro Invite" }),
      ]);
      expect(result.excluded).toBe(1);
      expect(result.synced).toBe(0);
      const after = Number(
        (fx.sql.prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n,
      );
      expect(after).toBe(before);
      const registry = fx.sql
        .prepare("SELECT is_excluded FROM wr_products WHERE wr_product_id='prod-canva'")
        .get() as { is_excluded: number };
      expect(Number(registry.is_excluded)).toBe(1);
    } finally {
      fx.close();
    }
  });

  it("sync kedua: update harga/stok idempoten tanpa produk ganda", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
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
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
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

  it("slug collision dengan produk manual mendapat suffix -wr", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
      fx.sql
        .prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(99,'CapCut Pro','capcut-pro',10000,5)")
        .run();
      const db = createDatabaseAccess(fx.db);
      await syncProducts(db, async () => [fixtureProduct()]);
      const product = fx.sql
        .prepare("SELECT slug FROM products WHERE wr_product_id='prod-capcut'")
        .get() as { slug: string };
      expect(String(product.slug)).toBe("capcut-pro-wr");
    } finally {
      fx.close();
    }
  });

  it("API down: sync gagal jujur tanpa menghapus katalog", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
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

  it("upsert varian tanpa produk Axvara tidak melempar", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
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
});
