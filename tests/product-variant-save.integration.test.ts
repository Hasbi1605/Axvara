// tests/product-variant-save.integration.test.ts — Regresi bug "Edit Produk Canva
// tidak bisa simpan" (Sep 2026).
//
// Gejala produksi: produk multi-varian (mis. Canva: Invite 1 Bulan, Invite
// Lifetime, Head 1 Bulan) selalu ditolak PUT /api/products/:id dengan 409
// "Harga dan stok dikelola per varian" begitu harga termurah varian berubah,
// walau seluruh field form valid.
//
// Akar masalah: client useProductManager selalu mengirim kolom legacy
// (price=min varian, stock=-1, comparePrice=null) bersama `variants`, dan
// guard server membaca selisih kolom legacy vs master sebagai "edit manual"
// lalu 409 — padahal itu auto-sync client, dan master memang dihitung ulang
// dari varian oleh sync query di route yang sama.
//
// Perilaku yang dikunci test ini:
//  1. Client BARU (tanpa price/stock/comparePrice, hanya variants): 200,
//     varian tersimpan, master = MIN(price) aktif / stock agregat / compare NULL.
//  2. Client LAMA (masih kirim legacy + variants): 200 juga, legacy diabaikan.
//  3. Guard legacy tetap hidup: edit price/stock TANPA variants di produk
//     multi-varian tetap 409.
//  4. Produk single DEFAULT-variant tetap bisa edit via kolom legacy dan
//     diteruskan ke varian default-nya.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  // Produk Canva ala screenshot: master price 5000, 3 varian aktif.
  fixture.sql.prepare(
    `INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order)
     VALUES (1, 2, 'Canva PRO / Premium', 'canva-premium', 'desc', 5000, -1, 1, 1)`,
  ).run();
  fixture.sql.prepare(
    `INSERT INTO product_variants (id, product_id, sku, label, price, compare_price, stock, is_active, sort_order)
     VALUES (1, 1, 'CANVA-PREMIUM-1', 'Invite 1 Bulan', 2000, 20000, -1, 1, 0),
            (2, 1, 'CANVA-PREMIUM-2', 'Invite Lifetime', 5000, 10000, -1, 1, 1),
            (3, 1, 'CANVA-PREMIUM-3', 'Head 1 Bulan', 5000, 13000, 10, 1, 2)`,
  ).run();
  // Produk single DEFAULT-variant untuk skenario #4.
  fixture.sql.prepare(
    `INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order)
     VALUES (2, 2, 'Single', 'single-prod', 'desc', 50000, 10, 1, 2)`,
  ).run();
  fixture.sql.prepare(
    `INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order)
     VALUES (4, 2, 'DEFAULT-2', 'Default', 50000, 10, 1, 0)`,
  ).run();
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function put(id: number, body: unknown) {
  return new NextRequest(`http://localhost/api/products/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

function variantsOf(productId: number) {
  return fixture.sql.prepare(
    `SELECT id, label, price, stock FROM product_variants WHERE product_id=? AND is_active=1 ORDER BY sort_order ASC`,
  ).all(productId) as { id: number; label: string; price: number; stock: number }[];
}
function masterOf(productId: number) {
  return fixture.sql.prepare(`SELECT price, stock, compare_price FROM products WHERE id=?`).get(productId)! as {
    price: number; stock: number; compare_price: number | null;
  };
}

const editedVariants = [
  { id: 1, sku: "CANVA-PREMIUM-1", label: "Invite 1 Bulan", price: 2000, comparePrice: 20000, stock: -1, is_active: 1, sort_order: 0 },
  { id: 2, sku: "CANVA-PREMIUM-2", label: "Invite Lifetime", price: 6000, comparePrice: 12000, stock: -1, is_active: 1, sort_order: 1 },
  { id: 3, sku: "CANVA-PREMIUM-3", label: "Head 1 Bulan", price: 5000, comparePrice: 13000, stock: 10, is_active: 1, sort_order: 2 },
];

describe("PUT /api/products/:id mode multi-varian (regresi Canva 409)", () => {
  it("client baru (hanya variants): 200, varian tersimpan, master dihitung ulang", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const res = await PUT(
      put(1, { name: "Canva PRO / Premium", slug: "canva-premium", variants: editedVariants }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(200);
    expect(variantsOf(1).find((v) => v.id === 2)?.price).toBe(6000);
    const master = masterOf(1);
    expect(master.price).toBe(2000); // MIN varian aktif
    expect(master.stock).toBe(-1); // ada varian unlimited
    expect(master.compare_price).toBeNull(); // multi-varian: master tidak pegang coret
  });

  it("client lama (legacy + variants): tetap 200, legacy diabaikan", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const res = await PUT(
      put(1, { name: "Canva PRO / Premium", slug: "canva-premium", price: 2000, stock: -1, comparePrice: null, variants: editedVariants }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(200);
    expect(variantsOf(1).find((v) => v.id === 2)?.price).toBe(6000);
    expect(masterOf(1).price).toBe(2000);
  });

  it("skenario persis Canva lama: harga termurah berubah (5000 -> 2000) + stok -1 + varian: tidak 409", async () => {
    // Master lama 5000 (harga termurah varian lama); client lama mengirim
    // price=2000 karena varian termurah diubah. Ini yang dulu 409.
    fixture.sql.prepare(`UPDATE products SET price=5000 WHERE id=1`).run();
    const { PUT } = await import("@/app/api/products/[id]/route");
    const res = await PUT(
      put(1, { price: 2000, stock: -1, comparePrice: null, variants: editedVariants }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(200);
  });

  it("guard legacy tetap hidup: edit price tanpa variants di produk multi-varian tetap 409", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const res = await PUT(put(1, { price: 9999 }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Harga dan stok dikelola per varian");
    // Master tidak berubah.
    expect(masterOf(1).price).toBe(5000);
  });

  it("produk single DEFAULT-variant: edit legacy tetap diteruskan ke varian default", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const res = await PUT(put(2, { price: 60000, stock: 7 }), { params: Promise.resolve({ id: "2" }) });
    expect(res.status).toBe(200);
    expect(masterOf(2)).toMatchObject({ price: 60000, stock: 7 });
    const v = fixture.sql.prepare(`SELECT price, stock FROM product_variants WHERE id=4`).get()! as {
      price: number; stock: number;
    };
    expect(v).toMatchObject({ price: 60000, stock: 7 });
  });
});

describe("payload useProductManager mode varian", () => {
  it("tidak menyertakan kolom legacy price/stock/comparePrice", async () => {
    const src = (await import("node:fs")).readFileSync("src/components/admin/useProductManager.ts", "utf8");
    const saveAt = src.indexOf("const payload = {");
    expect(saveAt).toBeGreaterThan(0);
    const saveBlock = src.slice(saveAt, saveAt + 2500);
    expect(saveBlock).toContain("price: hasMultiVariants ? undefined");
    expect(saveBlock).toContain("comparePrice: hasMultiVariants ? undefined");
    expect(saveBlock).toContain("stock: hasMultiVariants ? undefined");
  });
});
