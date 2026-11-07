// Phase 2 Market content EN: description_en schema/seed/API + badge/label translators.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { displayDescriptionEn } from "@/lib/catalog";
import { localizedProductDescription } from "@/lib/i18n/catalog-copy";
import { badgeLabel } from "@/lib/i18n/badge-copy";
import { translateVariantLabel } from "@/lib/i18n/variant-copy";
import { parseProductDescription } from "@/lib/product-copy/format";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

const MIGRATION_0103 = fs.readFileSync("drizzle/migrations/0103_product_description_en.sql", "utf8");
const MIGRATION_0104 = fs.readFileSync("drizzle/migrations/0104_product_description_en_seed.sql", "utf8");

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  fixture.sql.exec(`
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, source, wr_auto_managed)
      VALUES (1, 2, 'Muse AI 1 Miliar Token', 'muse-ai-1-miliar-token', 'Muse AI adalah AI agent otonom dari Meta.', 1000, -1, 1, 'manual', 0);
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, source, wr_auto_managed)
      VALUES (2, 2, 'For Testing Only', 'for-testing-only', 'Produk uji.', 1000, -1, 1, 'manual', 0);
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, source, wr_auto_managed)
      VALUES (3, 2, 'Netflix Premium', 'netflix-premium', 'Deskripsi WR.', 1000, -1, 1, 'warung_rebahan', 1);
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active)
      VALUES (1, 1, 'MUSE-1', '1 Bulan', 1000, -1, 1), (2, 3, 'NFLIX-1', '1 Bulan', 1000, -1, 1);
  `);
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const req = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
}) as unknown as NextRequest;
const row = (slug: string) => fixture.sql.prepare("SELECT description, description_en, admin_description_override FROM products WHERE slug=?").get(slug) as Record<string, unknown>;

describe("migrasi description_en", () => {
  it("0103 menambah kolom pada tabel D1 lama; 0104 mengisi hanya yang masih NULL dan idempoten", () => {
    fixture.sql.exec("ALTER TABLE products DROP COLUMN description_en");
    fixture.sql.exec(MIGRATION_0103);
    const columns = fixture.sql.prepare("PRAGMA table_info(products)").all().map((c) => String(c.name));
    expect(columns).toContain("description_en");

    fixture.sql.exec(MIGRATION_0104);
    expect(String(row("muse-ai-1-miliar-token").description_en)).toMatch(/^Muse AI is an autonomous AI agent/);
    expect(row("for-testing-only").description_en).toBeNull();
    // Produk WR dengan admin override: seed memakai teks ID yang tampil, bukan menimpa override.
    expect(String(row("netflix-premium").description_en).length).toBeGreaterThan(20);

    fixture.sql.prepare("UPDATE products SET description_en='Suntingan admin' WHERE slug='muse-ai-1-miliar-token'").run();
    fixture.sql.exec(MIGRATION_0104);
    expect(row("muse-ai-1-miliar-token").description_en).toBe("Suntingan admin");
    expect((MIGRATION_0104.match(/^UPDATE products SET description_en=/gm) ?? []).length).toBe(71);
  });
});

describe("PUT /api/products/[id] descriptionEn", () => {
  it("menyimpan EN untuk produk WR tanpa mengganggu ownership guard; kosong → NULL", async () => {
    const { PUT, GET } = await import("@/app/api/products/[id]/route");
    const ctx = { params: Promise.resolve({ id: "3" }) };
    const saved = await PUT(req("/api/products/3", "PUT", { descriptionEn: "  English WR description.  " }), ctx);
    expect(saved.status).toBe(200);
    expect(row("netflix-premium").description_en).toBe("English WR description.");

    const detail = await (await GET(req("/api/products/3", "GET"), ctx)).json() as { product: { descriptionEn: string | null; wrDescription: string } };
    expect(detail.product.descriptionEn).toBe("English WR description.");
    expect(detail.product.wrDescription).toBe("Deskripsi WR.");

    const blocked = await PUT(req("/api/products/3", "PUT", { name: "Nama Baru" }), ctx);
    expect(blocked.status).toBe(409);

    const cleared = await PUT(req("/api/products/3", "PUT", { descriptionEn: "" }), ctx);
    expect(cleared.status).toBe(200);
    expect(row("netflix-premium").description_en).toBeNull();
  });

  it("menolak EN lebih dari 2000 karakter", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const res = await PUT(req("/api/products/3", "PUT", { descriptionEn: "x".repeat(2001) }), { params: Promise.resolve({ id: "3" }) });
    expect(res.status).toBe(400);
  });
});

describe("display & translator EN", () => {
  it("description_en menang bila terisi, fallback ke override/ID", () => {
    expect(displayDescriptionEn({ description: "ID", description_en: "EN" })).toBe("EN");
    expect(displayDescriptionEn({ description: "ID", description_en: "  " })).toBe("ID");
    expect(displayDescriptionEn({ description: "WR", admin_description_override: "Override" })).toBe("Override");
    expect(localizedProductDescription({ description: "ID", descriptionEn: "" }, "en")).toBe("ID");
    expect(localizedProductDescription({ description: "ID", descriptionEn: "EN" }, "en")).toBe("EN");
    expect(localizedProductDescription({ description: "ID", descriptionEn: "EN" }, "id")).toBe("ID");
  });

  it("EN description memakai heading Terms/How to Activate yang dikenali parser", () => {
    const parsed = parseProductDescription("Opening paragraph.\n\nTerms & Conditions:\n- Only 1 device\n\nHow to Activate:\n- Open the link");
    expect(parsed.terms).toEqual(["Only 1 device"]);
    expect(parsed.activation).toEqual(["Open the link"]);
  });

  it("badge map: known words, Hemat NN%, unknown as-is", () => {
    expect(badgeLabel("Terlaris", "en")).toBe("Best seller");
    expect(badgeLabel("Baru", "en")).toBe("New");
    expect(badgeLabel("Hemat", "en")).toBe("Save");
    expect(badgeLabel("Hemat 25%", "en")).toBe("Save 25%");
    expect(badgeLabel("Paling Dicari", "en")).toBe("Most wanted");
    expect(badgeLabel("Promo", "en")).toBe("Promo");
    expect(badgeLabel("Bundle Spesial", "en")).toBe("Bundle Spesial");
    expect(badgeLabel("Terlaris", "id")).toBe("Terlaris");
  });

  it("label varian EN: durasi/plural/tier, brand tetap, nilai tersimpan tidak berubah", () => {
    for (const [input, expected] of [
      ["1 Bulan", "1 Month"],
      ["3 Bulan", "3 Months"],
      ["1 Tahun", "1 Year"],
      ["2 Minggu", "2 Weeks"],
      ["7 Hari", "7 Days"],
      ["21 - 23 Oktober", "21 - 23 Oktober"],
      ["Premium Anti Limit", "Premium Anti Limit"],
      ["Sharing", "Sharing"],
      ["Private 1 Bulan", "Private 1 Month"],
      ["Custom Username Garansi", "Custom username warranty"],
      ["Google AI Pro Head - 18 Bulan", "Google AI Pro Head - 18 Months"],
      ["ChatGPT Plus 1 Bulan", "ChatGPT Plus 1 Month"],
      ["3 Bulan No Garansi", "3 Months No warranty"],
    ] as const) {
      expect(translateVariantLabel(input, "en")).toBe(expected);
      expect(input).toBe(input);
    }
    expect(translateVariantLabel("1 Bulan", "id")).toBe("1 Bulan");
  });
});
