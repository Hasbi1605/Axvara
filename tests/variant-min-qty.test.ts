import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

const read = (file: string) => fs.readFileSync(file, "utf8");

// Migrasi 0034 — minimum pembelian per varian (generik, kasus pertama GSuite).
describe("variant min_qty — migrasi & schema", () => {
  it("0034 menambah min_qty default 1 + CHECK, GSuite dikunci 50", () => {
    const sql = read("drizzle/migrations/0034_variant_min_qty.sql");
    expect(sql).toContain("ADD COLUMN min_qty");
    expect(sql).toContain("DEFAULT 1");
    expect(sql).toContain("CHECK (min_qty >= 1)");
    expect(sql).toContain("min_qty=50");
    expect(sql).toContain("gsuite");
  });

  it("schema.sql bootstrap memuat kolom min_qty", () => {
    expect(read("drizzle/schema.sql")).toContain("min_qty INTEGER NOT NULL DEFAULT 1");
  });

  it("migrasi 0034 jalan di DB + CHECK menolak 0", async () => {
    // Fixture memuat schema.sql (sudah ada min_qty) — simulasikan DB LAMA
    // pra-0034 dengan membuat tabel tanpa kolom, lalu jalankan ALTER migrasi.
    const fx = createD1Fixture();
    try {
      fx.sql.exec("ALTER TABLE product_variants RENAME TO pv_new");
      fx.sql.exec(`CREATE TABLE product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
        sku TEXT NOT NULL UNIQUE, label TEXT NOT NULL, price INTEGER NOT NULL,
        stock INTEGER NOT NULL DEFAULT -1,
        fulfillment_mode TEXT NOT NULL DEFAULT 'manual',
        shared_secret_ciphertext TEXT, shared_secret_iv TEXT,
        is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0)`);
      fx.sql.exec("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv,is_active,sort_order) SELECT id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv,is_active,sort_order FROM pv_new");
      fx.sql.exec("DROP TABLE pv_new");
      fx.sql.exec("ALTER TABLE product_variants ADD COLUMN min_qty INTEGER NOT NULL DEFAULT 1 CHECK (min_qty >= 1)");
      await insertTestProduct(fx.sql, "manual", 1);
      const row = fx.sql.prepare("SELECT min_qty m FROM product_variants WHERE id=1").get() as { m: number };
      expect(Number(row.m)).toBe(1);
      // GSuite: slug cocok → 50 (logika UPDATE yang sama dengan migrasi).
      fx.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(9,'GSuite Basic','gsuite-basic',10000,100)");
      fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(9,9,'GS-1','Basic',10000,100,'manual')").run();
      fx.sql.exec("UPDATE product_variants SET min_qty=50 WHERE min_qty=1 AND product_id IN (SELECT id FROM products WHERE slug LIKE '%gsuite%')");
      const g = fx.sql.prepare("SELECT min_qty m FROM product_variants WHERE id=9").get() as { m: number };
      expect(Number(g.m)).toBe(50);
      expect(() => fx.sql.prepare("UPDATE product_variants SET min_qty=0 WHERE id=1").run()).toThrow();
    } finally {
      fx.close();
    }
  });

  it("min_qty milik admin: tidak masuk WR_OWNED_VARIANT_FIELDS", () => {
    const ownership = read("src/lib/warung-rebahan/ownership.ts");
    expect(ownership).toContain("min_qty");
    const fieldsBlock = ownership.slice(ownership.indexOf("WR_OWNED_VARIANT_FIELDS"));
    const blockEnd = fieldsBlock.indexOf("] as const");
    expect(fieldsBlock.slice(0, blockEnd)).not.toContain("min_qty");
    const sync = read("src/lib/warung-rebahan/sync.ts");
    expect(sync).not.toContain("min_qty");
  });
});

describe("variant min_qty — guard server", () => {
  it("quote menegakkan below_minimum 409 setelah cek stok", () => {
    const quote = read("src/app/api/checkout/quote/route.ts");
    expect(quote).toContain("below_minimum");
    expect(quote).toContain("minimal pembelian");
    expect(quote).toContain("minQtyOf");
    // Batas atas web naik 20 → 100 agar min-besar bisa dibeli dari web.
    expect(quote).toContain(".max(100)");
    expect(quote).not.toContain("Maksimal 20 unit per produk.");
  });

  it("orders menegakkan ulang minimum dari DB (409) + batas 100", () => {
    const orders = read("src/app/api/orders/route.ts");
    expect(orders).toContain("minimal pembelian");
    expect(orders).toContain("min_qty");
    expect(orders).toContain("qtyByVariant");
    expect(orders).toContain("qty: z.coerce.number().int().min(1).max(100)");
  });

  it("guard atomik web + channel memagari min di dalam batch", () => {
    const web = read("src/lib/db/orders-create.ts");
    expect(web).toContain("COALESCE(min_qty,1)");
    const commerce = read("src/lib/commerce.ts");
    expect(commerce.match(/COALESCE\(min_qty,1\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("verifier quote menerima qty sampai 100", () => {
    expect(read("src/lib/auth.ts")).toContain("Number(value.qty) <= 100");
  });
});

describe("variant min_qty — bot & storefront", () => {
  it("Telegram: stepper dibuka di min, tolak ketik/invoice di bawah min", () => {
    expect(read("src/lib/telegram/handlers/catalog.ts")).toContain("variant.min_qty");
    expect(read("src/lib/telegram/handlers/invoice.ts")).toContain("Minimal Pembelian");
    expect(read("src/lib/telegram/handlers/discovery.ts")).toContain("Minimal Pembelian");
    expect(read("src/lib/telegram/keyboards.ts")).toContain("minQty");
    expect(read("src/lib/telegram/messages/purchase.ts")).toContain("Minimal pembelian");
    expect(read("src/lib/telegram/handlers/cart.ts")).toContain("Minimal Pembelian");
  });

  it("WhatsApp: varian min>1 ditolak jelas sejak pilih + saat bayar (qty WA selalu 1)", () => {
    const catalog = read("src/lib/whatsapp/handlers/catalog.ts");
    const payment = read("src/lib/whatsapp/handlers/payment.ts");
    const messages = read("src/lib/whatsapp/messages.ts");
    expect(catalog).toContain("variant.min_qty");
    expect(payment).toContain("minimal pembelian");
    expect(messages).toContain("Minimal pembelian");
  });

  it("web: stepper PDP/modal + Beli Langsung bawa qty, dialog konsisten solid", () => {
    const pdp = read("src/app/produk/[slug]/product-detail-client.tsx");
    // Badge TIDAK di tiap kartu varian (menumpuk) — info min hanya di stepper.
    expect(pdp).not.toContain("Min. {Number");
    expect(pdp).toContain("Jumlah");
    expect(pdp).toContain("Min. pembelian");
    expect(pdp).toContain("qty=${safePdpQty}");
    const modal = read("src/components/storefront/QuickVariantModal.tsx");
    // Panel solid axvara (#0B1025), bukan glass transparan.
    expect(modal).toContain('background: "#0B1025"');
    expect(modal).not.toContain("ax-glass-strong");
    expect(modal).toContain("Min. pembelian");
    expect(modal).toContain("qty=${modalQty}");
    const checkout = read("src/app/checkout/page.tsx");
    expect(checkout).toContain("Sesuaikan ke minimum");
    expect(checkout).toContain("bg-[#0B1025]");
    expect(checkout).not.toContain("isBelowMinimumIssue");
  });

  it("admin: input Min. Beli di VariantEditor + ProductVariantRows + API", () => {
    expect(read("src/components/admin/VariantEditor.tsx")).toContain("Min. beli");
    expect(read("src/components/admin/sections/ProductVariantRows.tsx")).toContain("Min. Beli");
    expect(read("src/app/api/admin/variants/route.ts")).toContain("min_qty");
    expect(read("src/app/api/products/[id]/route.ts")).toContain("min_qty");
    expect(read("src/app/api/products/route.ts")).toContain("min_qty");
  });
});

describe("variant min_qty — perilaku guard atomik (SQLite)", () => {
  it("order di bawah min dibatalkan batch tanpa potong stok", async () => {
    const fx = createD1Fixture();
    try {
      const { createChannelOrderAtomic } = await import("@/lib/commerce");
      await insertTestProduct(fx.sql, "manual", 1);
      fx.sql.prepare("UPDATE product_variants SET min_qty=50 WHERE id=1").run();
      await expect(createChannelOrderAtomic({
        orderCode: "AXV-20260917-MIN00001",
        lines: [{ productId: 1, variantId: 1, qty: 10, fulfillmentMode: "manual", stock: 100 }],
        items: [{ product_id: 1, variant_id: 1, qty: 10, price: 10000, name: "Fixture" }],
        variantSnapshot: "{}",
        subtotal: 100000,
        primaryVariantId: 1,
        customerName: "Min",
        salesChannel: "telegram",
        telegramChatId: "1",
        telegramUserId: "1",
        paymentMethod: "qris",
        paymentAccount: "DANA Business",
        fulfillmentStatus: "not_required",
      })).rejects.toThrow();
      // Stok utuh + order tidak ada.
      const stock = fx.sql.prepare("SELECT stock s FROM product_variants WHERE id=1").get() as { s: number };
      expect(Number(stock.s)).toBe(100);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toMatchObject({ n: 0 });
      // Qty memenuhi min → lolos.
      const ok = await createChannelOrderAtomic({
        orderCode: "AXV-20260917-MIN00002",
        lines: [{ productId: 1, variantId: 1, qty: 50, fulfillmentMode: "manual", stock: 100 }],
        items: [{ product_id: 1, variant_id: 1, qty: 50, price: 10000, name: "Fixture" }],
        variantSnapshot: "{}",
        subtotal: 500000,
        primaryVariantId: 1,
        customerName: "Min",
        salesChannel: "telegram",
        telegramChatId: "1",
        telegramUserId: "1",
        paymentMethod: "qris",
        paymentAccount: "DANA Business",
        fulfillmentStatus: "not_required",
      });
      expect(ok.code).toBe("AXV-20260917-MIN00002");
    } finally {
      fx.close();
    }
  });
});
