import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { createCheckoutQuoteToken, verifyCheckoutQuoteToken } from "@/lib/auth";
import { createOrderWithStock, execRun, queryFirst, transitionPendingOrder } from "@/lib/db";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Checkout quote integrity", () => {
  it("menandatangani payload authoritative dan menolak token yang diubah", async () => {
    const signed = await createCheckoutQuoteToken({
      items: [{ product_id: 1, name: "Produk", price: 89000, qty: 2 }],
      subtotal: 178000,
      payment_methods: [{ id: "seabank", account_number: "901812349386" }],
    });
    const verified = await verifyCheckoutQuoteToken(signed.token);
    expect(verified?.quote_id).toBe(signed.quoteId);
    expect(verified?.subtotal).toBe(178000);
    expect(verified?.items[0].price).toBe(89000);
    const tampered = signed.token.slice(0, -1) + (signed.token.endsWith("a") ? "b" : "a");
    expect(await verifyCheckoutQuoteToken(tampered)).toBeNull();
  });

  it("client mengirim slug+snapshot harga dan order memakai quote token", () => {
    const checkout = read("src/app/checkout/page.tsx");
    const orders = read("src/app/api/orders/route.ts");
    expect(checkout).toContain("expected_price");
    expect(checkout).toContain("quote_token: quoteToken");
    expect(orders).toContain("verifyCheckoutQuoteToken");
    expect(orders).toContain("sameItems");
    expect(orders).toContain("quote.subtotal");
    expect(checkout).toContain("quoteRequestId");
    expect(checkout).toContain("() => isDirect");
  });

  it("stok tidak tersedia menghasilkan issue terstruktur yang dipahami UI", () => {
    const quote = read("src/app/api/checkout/quote/route.ts");
    const checkout = read("src/app/checkout/page.tsx");
    expect(quote).toContain("type: \"out_of_stock\"");
    expect(quote).toContain("status: 409");
    expect(checkout).toContain("r.status === 409");
    expect(checkout).toContain("issue.message");
  });

  it("variant mode tidak dapat dibypass dengan checkout tanpa variant_id", () => {
    const quote = read("src/app/api/checkout/quote/route.ts");
    const products = read("src/app/api/products/route.ts");
    const card = read("src/components/storefront/ProductCard.tsx");
    const detail = read("src/app/produk/[slug]/page.tsx");
    expect(quote).toContain('type: "variant_required"');
    expect(products).toContain("variant_count");
    expect(card).toContain("hasVariants");
    expect(detail).toContain("variant_catalog_unavailable");
  });

  it("pemilihan file baru menghapus bukti lama sebelum validasi", () => {
    const checkout = read("src/app/checkout/page.tsx");
    const clearIndex = checkout.indexOf("setProofUrl(null);", checkout.indexOf("const f = e.target.files"));
    const sizeIndex = checkout.indexOf("f.size > 5 * 1024 * 1024", clearIndex);
    expect(clearIndex).toBeGreaterThan(0);
    expect(clearIndex).toBeLessThan(sizeIndex);
  });
});

describe("Atomic stock lifecycle", () => {
  it("dev transaction mengurangi lalu mengembalikan stok saat batal", async () => {
    const before = await queryFirst("SELECT * FROM products WHERE id=?", 1);
    const initial = Number(before?.stock);
    const suffix = Math.random().toString(16).slice(2, 10).toUpperCase().padEnd(8, "0").slice(0, 8);
    const code = `AXV-20260903-${suffix}`;
    const quoteId = `test-${suffix}`;
    await createOrderWithStock({
      code,
      quoteId,
      customerName: "Test Integritas",
      customerWa: "6281234567890",
      customerEmail: null,
      items: [{ product_id: 1, name: "ChatGPT Plus 1 Bulan", price: 89000, qty: 2 }],
      subtotal: 178000,
      paymentMethod: "qris",
      paymentAccount: "",
      proofUrl: "/r2/bukti/test.webp",
    });
    expect(Number((await queryFirst("SELECT * FROM products WHERE id=?", 1))?.stock)).toBe(initial - 2);
    await expect(createOrderWithStock({
      code: `AXV-20260903-${suffix.split("").reverse().join("")}`,
      quoteId,
      customerName: "Test Integritas",
      customerWa: "6281234567890",
      customerEmail: null,
      items: [{ product_id: 1, name: "ChatGPT Plus 1 Bulan", price: 89000, qty: 2 }],
      subtotal: 178000,
      paymentMethod: "qris",
      paymentAccount: "",
      proofUrl: "/r2/bukti/test.webp",
    })).rejects.toThrow(/UNIQUE/);
    expect(Number((await queryFirst("SELECT * FROM products WHERE id=?", 1))?.stock)).toBe(initial - 2);
    await transitionPendingOrder(code, "dibatalkan", null, [{ product_id: 1, qty: 2 }]);
    expect(Number((await queryFirst("SELECT * FROM products WHERE id=?", 1))?.stock)).toBe(initial);
  });

  it("stok unlimited tetap -1 setelah reservasi", async () => {
    const row = await queryFirst("SELECT * FROM products WHERE id=?", 24);
    const initial = Number(row?.stock);
    await execRun("UPDATE products SET stock=? WHERE id=?", -1, 24);
    const suffix = Math.random().toString(16).slice(2, 10).toUpperCase().padEnd(8, "0").slice(0, 8);
    const code = `AXV-20260903-${suffix}`;
    await createOrderWithStock({
      code,
      quoteId: `unlimited-${suffix}`,
      customerName: "Test Unlimited",
      customerWa: "6281234567890",
      customerEmail: null,
      items: [{ product_id: 24, name: "Grammarly", price: 95000, qty: 3 }],
      subtotal: 285000,
      paymentMethod: "qris",
      paymentAccount: "",
      proofUrl: "/r2/bukti/test.webp",
    });
    expect(Number((await queryFirst("SELECT * FROM products WHERE id=?", 24))?.stock)).toBe(-1);
    await transitionPendingOrder(code, "dibatalkan", null, [{ product_id: 24, qty: 3 }]);
    await execRun("UPDATE products SET stock=? WHERE id=?", initial, 24);
  });

  it("D1 memakai batch+guard, quote id unik, dan expiry 24 jam", () => {
    const db = read("src/lib/db.ts");
    const schema = read("drizzle/schema.sql");
    expect(db).toContain("await d1.batch(statements)");
    expect(db).toContain("CASE WHEN stock=-1 THEN -1");
    expect(db).toContain("operation_guards");
    expect(schema).toContain("orders_quote_id_unique");
    expect(schema).toContain("expires_at TEXT");
  });
});

describe("Authoritative UI and admin state", () => {
  it("homepage/detail/direct checkout tidak menghidupkan seed produk", () => {
    expect(read("src/app/page.tsx")).toContain("useState<Product[]>([])");
    expect(read("src/app/produk/[slug]/page.tsx")).toContain("useState<Product[]>([])");
    expect(read("src/app/checkout/page.tsx")).not.toContain("products.find");
  });

  it("admin tidak memakai order localStorage dan payment methods dapat diedit", () => {
    const admin = read("src/app/admin/page.tsx");
    expect(admin).not.toContain('localStorage.getItem("axvara-orders")');
    expect(admin).not.toContain('localStorage.setItem("axvara-orders")');
    expect(admin).toContain("PaymentMethodsManager");
    const paymentApi = read("src/app/api/payment-methods/route.ts");
    expect(paymentApi).toContain("requireAdmin");
    expect(paymentApi).toContain("UPDATE payment_methods");
    expect(paymentApi).toContain("INSERT INTO payment_methods");
    expect(paymentApi).toContain("export async function POST");
    expect(paymentApi).toContain("Gambar QRIS wajib tersedia");
    expect(read("src/app/checkout/page.tsx")).not.toContain('pmQris.qris_url || "/qris/axvara-qris.jpg"');
  });

  it("drawer mengunci scroll, menangani Escape, dan memulihkan fokus", () => {
    const drawer = read("src/components/storefront/CartDrawer.tsx");
    expect(drawer).toContain('document.body.style.overflow = "hidden"');
    expect(drawer).toContain('event.key === "Escape"');
    expect(drawer).toContain("previousFocus?.focus()");
    expect(drawer).toContain('aria-modal="true"');
  });

  it("halaman status memakai visual per status dan menampilkan kegagalan polling", () => {
    const statusPage = read("src/app/pesanan/[code]/page.tsx");
    expect(statusPage).toContain("statusVisual");
    expect(statusPage).toContain("/icons/ios11/close-96.png");
    expect(statusPage).toContain("Status terbaru gagal dimuat");
  });

  it("URL gambar 404 lama tidak ada di seed dan migrasi memperbarui production", () => {
    const products = read("src/lib/products.ts");
    const migration = read("drizzle/migrations/0003_checkout_integrity.sql");
    for (const dead of ["1639322537224-f012857c7c2e", "1639322537504-fcfecb546b11", "1626785774573-6dd65b279390"]) {
      expect(products).not.toContain(dead);
      expect(migration).toContain(dead);
    }
  });
});
