// Katalog Telegram hanya menampilkan produk yang BISA DIBELI (2026-09-24).
//
// Produksi 24 Sep: katalog Telegram menampilkan 48 produk padahal hanya 20
// yang tersedia — 28 tombol berujung "stok habis". Aturan stok kini satu
// dengan web (`purchasableStockSql`), dibaca ulang dari D1 tiap katalog
// dibuka, jadi habis/ready di web langsung berlaku di Telegram.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  editMessageText: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));

import { sendMessage } from "@/lib/telegram/api";
import { handleShowCatalog, handleShowProduct, listTelegramProducts } from "@/lib/telegram/handlers/catalog";
import { handleSearchResults } from "@/lib/telegram/handlers/discovery";
import { getBestsellers } from "@/lib/telegram/handlers/shared";
import { catalogFlatKeyboard } from "@/lib/telegram/keyboards";

let fx: ReturnType<typeof createD1Fixture>;

function product(id: number, name: string, opts: { soldCount?: number; telegram?: number; active?: number; categoryId?: number | null } = {}) {
  fx.sql.prepare(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,sold_count,category_id,sort_order)
    VALUES(?,?,?,1000,0,?,?,?,?,0)`)
    .run(id, name, name.toLowerCase().replace(/\s+/g, "-"), opts.active ?? 1, opts.telegram ?? 1, opts.soldCount ?? 0, opts.categoryId ?? null);
}

let variantId = 100;
function variant(productId: number, price: number, stock: number, opts: { minQty?: number; active?: number } = {}) {
  variantId++;
  fx.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active)
    VALUES(?,?,?,?,?,?,?,'manual',?)`)
    .run(variantId, productId, `SKU-${variantId}`, `Varian ${variantId}`, price, stock, opts.minQty ?? 1, opts.active ?? 1);
  return variantId;
}

beforeEach(() => {
  fx = createD1Fixture();
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  product(1, "Alpha Ready", { soldCount: 5 });
  variant(1, 3000, 0); // varian habis yang lebih murah: harga tampil tidak boleh memakainya
  variant(1, 7500, 4);
  product(2, "Bravo Habis", { soldCount: 99 });
  variant(2, 2000, 0);
  product(3, "Charlie Unlimited");
  variant(3, 5000, -1);
  product(4, "Delta Grosir"); // stok 3 dengan minimum 50: tidak bisa dibeli
  variant(4, 1000, 3, { minQty: 50 });
  product(5, "Echo Nonaktif");
  variant(5, 1000, 10, { active: 0 });
  product(6, "Foxtrot Web Only", { telegram: 0 });
  variant(6, 1000, 10);
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); });

const names = (list: { name: string }[]) => list.map((p) => p.name);
const stockOf = (id: number, stock: number) => fx.sql.prepare("UPDATE product_variants SET stock=? WHERE product_id=?").run(stock, id);

describe("katalog Telegram = produk yang bisa dibeli saja", () => {
  it("habis, di bawah minimum, varian nonaktif, dan non-Telegram tidak tampil", async () => {
    const products = await listTelegramProducts();
    expect(names(products)).toEqual(["Alpha Ready", "Charlie Unlimited"]);
    // Harga = varian TERSEDIA termurah (Rp7.500), bukan varian habis Rp3.000.
    expect(products.find((p) => p.name === "Alpha Ready")?.price).toBe(7500);
  });

  it("jumlah di pesan + tombol sama dengan produk tersedia", async () => {
    await handleShowCatalog(42);
    const params = vi.mocked(sendMessage).mock.calls[0][0];
    expect(params.text).toContain("2 produk tersedia");
    const buttons = (params.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text);
    expect(buttons.some((t) => t.includes("Alpha Ready"))).toBe(true);
    expect(buttons.some((t) => t.includes("Bravo Habis"))).toBe(false);
  });

  it("realtime: stok berubah di D1 langsung berlaku di katalog berikutnya", async () => {
    stockOf(2, 6);
    stockOf(1, 0);
    expect(names(await listTelegramProducts())).toEqual(["Bravo Habis", "Charlie Unlimited"]);
  });

  it("filter kategori memakai aturan yang sama", async () => {
    fx.sql.prepare("UPDATE products SET category_id=1 WHERE id IN (1,2)").run();
    expect(names(await listTelegramProducts(1))).toEqual(["Alpha Ready"]);
  });

  it("sapaan /start tidak mempromosikan produk habis walau terlaris", async () => {
    const best = await getBestsellers(3);
    expect(best.map((b) => b.name)).toEqual(["Alpha Ready"]);
  });
});

describe("pencarian Telegram", () => {
  it("hanya produk tersedia yang muncul", async () => {
    await handleSearchResults(42, "alpha");
    expect(vi.mocked(sendMessage).mock.calls[0][0].text).toContain("1 produk cocok");
  });

  it("kata kunci yang hanya cocok dengan produk habis: dijawab 'sedang habis', bukan 'tidak ada'", async () => {
    await handleSearchResults(42, "bravo");
    const text = String(vi.mocked(sendMessage).mock.calls[0][0].text);
    expect(text).toContain("sedang habis");
    expect(text).not.toContain("Tidak ada produk");
  });
});

describe("tombol dari pesan katalog lama", () => {
  it("halaman melewati jumlah halaman sekarang: tampilkan halaman terakhir, bukan daftar kosong '6/2'", () => {
    const products = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Produk ${i + 1}`, price: 1000 }));
    const texts = catalogFlatKeyboard(products, 5, 8).inline_keyboard.flat().map((b) => b.text);
    expect(texts).toContain("2/2");
    expect(texts.some((t) => t.startsWith("Produk 10"))).toBe(true);
    expect(texts.some((t) => t.includes("/2") && t !== "2/2")).toBe(false);
  });

  it("produk yang sudah nonaktif dijawab, bukan diam", async () => {
    await handleShowProduct(42, 7, 5 + 1000);
    expect(String(vi.mocked(sendMessage).mock.calls.at(-1)?.[0].text)).toContain("tidak tersedia");
  });
});
