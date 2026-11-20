import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import {
  durationFromSupplierText,
  formatVariantLabel,
  getProductDetail,
  type ProductDetail,
  type VariantSummary,
} from "@/lib/catalog";
import { withVariantCopy } from "@/lib/product-copy/resolve";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  editMessageText: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));

const SK_DESC_29 = "AKUN DARI ADMIN\n\n— DURASI 1 BULAN\n— LEGAL DAN BERGARANSI FULL\n— 1 PROFILE 1 USER";
const SK_DESC_31 = "AKUN DARI ADMIN\n\n— DURASI 1 BULAN\n— 1 PROFILE DIGUNAKAN 2 USER\n— GARANSI FULL";
const SK_DESC_704 = "AKUN DARI ADMIN\n\n— DURASI 28-30 HARI\n— PRIVATE ACCOUNT\n— FULL GARANSI";
const SK_DESC_11013 = "AKUN DARI ADMIN\n\n— LEGAL DAN BERGARANSI FULL\n— 1 PROFILE 1 USER";
const SK_DESC_PLAIN = "AKUN DARI ADMIN\n\n— LEGAL DAN BERGARANSI FULL";

const baseVariant: VariantSummary = {
  id: 1,
  product_id: 72,
  sku: "SK-29",
  label: "1 Profile 1 User",
  duration_value: null,
  duration_unit: null,
  duration_label: null,
  warranty_type: "none",
  warranty_value: null,
  warranty_unit: null,
  warranty_label: null,
  terms: null,
  delivery_terms: null,
  wr_delivery_class: null,
  wr_type: null,
  require_email: 0,
  min_qty: 1,
  price: 19500,
  compare_price: null,
  stock: 45,
  fulfillment_mode: "manual",
  is_active: 1,
  sort_order: 0,
};

describe("durationFromSupplierText", () => {
  it("extracts normalized Indonesian duration from production SK samples", () => {
    expect(durationFromSupplierText(SK_DESC_29)).toBe("1 Bulan");
    expect(durationFromSupplierText("AKUN DARI ADMIN /  / — DURASI 1 BULAN / — LEGAL DAN BERGARANSI FULL")).toBe("1 Bulan");
    expect(durationFromSupplierText(SK_DESC_31)).toBe("1 Bulan");
    expect(durationFromSupplierText(SK_DESC_704)).toBe("28-30 Hari");
    expect(durationFromSupplierText(SK_DESC_11013)).toBeNull();
    expect(durationFromSupplierText(SK_DESC_PLAIN)).toBeNull();
  });

  it("supports Indonesian & English keywords, separators, extra spaces, and em-dashes", () => {
    expect(durationFromSupplierText("Durasi: 14 hari")).toBe("14 Hari");
    expect(durationFromSupplierText("Masa aktif - 2 minggu")).toBe("2 Minggu");
    expect(durationFromSupplierText("Masa aktif — 1 tahun")).toBe("1 Tahun");
    expect(durationFromSupplierText("Duration: 1 month")).toBe("1 Bulan");
    expect(durationFromSupplierText("Duration : 3 months")).toBe("3 Bulan");
    expect(durationFromSupplierText("Validity — 2 weeks")).toBe("2 Minggu");
    expect(durationFromSupplierText("Validity: 1 week")).toBe("1 Minggu");
    expect(durationFromSupplierText("Duration: 7 days")).toBe("7 Hari");
    expect(durationFromSupplierText("Validity - 1 day")).toBe("1 Hari");
    expect(durationFromSupplierText("Duration: 1 year")).toBe("1 Tahun");
    expect(durationFromSupplierText("Validity: 2 years")).toBe("2 Tahun");
    expect(durationFromSupplierText("DURASI  :  —  28 — 30  HARI")).toBe("28-30 Hari");
  });

  it("returns null on negatives and never guesses from random numbers", () => {
    expect(durationFromSupplierText(null)).toBeNull();
    expect(durationFromSupplierText(undefined)).toBeNull();
    expect(durationFromSupplierText("")).toBeNull();
    expect(durationFromSupplierText("   ")).toBeNull();
    expect(durationFromSupplierText("7 Hari 1 Profile 1 User")).toBeNull();
    expect(durationFromSupplierText("1 Profile 2 User\nMaksimal 1 device\nGaransi 7 hari")).toBeNull();
    expect(durationFromSupplierText("Durasi garansi 7 hari")).toBeNull();
    expect(durationFromSupplierText("Duration\n1 month")).toBeNull();
    expect(durationFromSupplierText("DURASI 0 HARI")).toBeNull();
  });
});

describe("formatVariantLabel — SK, WR, and manual non-WR", () => {
  it("derives SK duration from sk_description when duration_* are empty", () => {
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "29", label: "1 Profile 1 User", sk_description: SK_DESC_29 })).toBe("1 Profile 1 User - 1 Bulan");
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "29", label: "1 Profile 1 User", sk_description: SK_DESC_29 }, "en")).toBe("1 Profile 1 User - 1 Month");
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "31", label: "1 Profile 2 User", sk_description: SK_DESC_31 })).toBe("1 Profile 2 User - 1 Bulan");
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "704", label: "1 Bulan Private", sk_description: SK_DESC_704 })).toBe("1 Bulan Private");
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "704", label: "1 Bulan Private", sk_description: SK_DESC_704 }, "en")).toBe("1 Month Private");
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "11013", label: "7 Hari 1 Profile 1 User", sk_description: SK_DESC_11013 })).toBe("7 Hari 1 Profile 1 User");
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "3333", label: "Basic Sharing", sk_description: SK_DESC_PLAIN })).toBe("Basic Sharing");
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "3334", label: "Basic Private", sk_description: null })).toBe("Basic Private");
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "5436", label: "1 Profile Random User", sk_description: null })).toBe("1 Profile Random User");
    expect(formatVariantLabel({ ...baseVariant, sk_variant_id: "800", label: "VIP 1 Month", sk_description: SK_DESC_29 })).toBe("VIP 1 Month");
  });

  it("lets admin-set duration_* always win over SK supplier text", () => {
    expect(formatVariantLabel({
      ...baseVariant,
      sk_variant_id: "29",
      label: "1 Profile 1 User",
      duration_label: "3 Bulan",
      sk_description: SK_DESC_29,
    })).toBe("1 Profile 1 User - 3 Bulan");

    expect(formatVariantLabel({
      ...baseVariant,
      sk_variant_id: "29",
      label: "1 Profile 1 User",
      duration_value: 2,
      duration_unit: "year",
      duration_label: null,
      sk_description: SK_DESC_29,
    })).toBe("1 Profile 1 User - 2 Tahun");
  });

  it("preserves derived sk_duration through withVariantCopy without leaking raw sk_description", () => {
    const skVariant: VariantSummary = {
      ...baseVariant,
      sk_variant_id: "29",
      label: "1 Profile 1 User",
      terms: SK_DESC_29,
      sk_description: SK_DESC_29,
    };
    const out = withVariantCopy({ id: 72, variants: [skVariant] } as unknown as ProductDetail);
    const [v] = out.variants;
    expect(v.terms).toBeNull();
    expect(v.sk_description).toBeUndefined();
    expect(v.sk_duration).toBe("1 Bulan");
    expect(formatVariantLabel(v, "id")).toBe("1 Profile 1 User - 1 Bulan");
    expect(formatVariantLabel(v, "en")).toBe("1 Profile 1 User - 1 Month");
  });

  it("keeps WR and manual non-WR labels byte-identical", () => {
    expect(formatVariantLabel({ ...baseVariant, wr_variant_id: "wr-1", label: "Meitu VIP", duration_label: "7 Hari" })).toBe("Meitu VIP - 7 Hari");
    expect(formatVariantLabel({ ...baseVariant, wr_variant_id: "wr-2", label: "Pro Member - 29 Hari", duration_label: "29 Hari" })).toBe("Pro Member - 29 Hari");
    expect(formatVariantLabel({ ...baseVariant, wr_variant_id: null, sk_variant_id: null, label: "Invite Lifetime", duration_value: 6, duration_unit: "month", terms: SK_DESC_29 })).toBe("Invite Lifetime");
    expect(formatVariantLabel({ ...baseVariant, wr_variant_id: null, sk_variant_id: null, label: "Head 1 Bulan", duration_value: 14, duration_unit: "day" })).toBe("Head 1 Bulan");
    expect(formatVariantLabel({ ...baseVariant, wr_variant_id: null, sk_variant_id: null, label: "Pro", duration_label: null, duration_value: null, duration_unit: null })).toBe("Pro");
  });
});

describe("SK duration end-to-end queries (Telegram, Cart, Web Catalog, Quote)", () => {
  let fx: ReturnType<typeof createD1Fixture>;

  beforeEach(() => {
    fx = createD1Fixture();
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    fx.sql.exec(`
      INSERT INTO products(id, name, slug, price, stock, is_active, telegram_enabled, sk_product_id)
      VALUES(72, 'Netflix', 'netflix', 19500, 45, 1, 1, '72');
      INSERT INTO telegram_users(user_id, chat_id, first_name) VALUES('42', '42', 'Budi');
    `);
    const insVar = fx.sql.prepare(`
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, sk_variant_id)
      VALUES(?, 72, ?, ?, ?, 45, 'manual', 1, ?, ?)
    `);
    const insSk = fx.sql.prepare(`
      INSERT INTO sk_products(sk_variant_id, sk_product_id, sk_product_name, sk_variant_name, sk_price, sk_stock, sk_order_process, sk_description, axvara_product_id, axvara_variant_id, axvara_sell_price)
      VALUES(?, '72', 'Netflix', ?, 15000, 45, 'auto', ?, 72, ?, ?)
    `);
    const rows: [number, string, number, number, string | null][] = [
      [29, "1 Profile 1 User", 30000, 1, SK_DESC_29],
      [31, "1 Profile 2 User", 19500, 2, SK_DESC_31],
      [704, "1 Bulan Private", 85000, 3, SK_DESC_704],
      [11013, "7 Hari 1 Profile 1 User", 12000, 4, SK_DESC_11013],
      [3333, "Basic Sharing", 18000, 5, SK_DESC_PLAIN],
    ];
    for (const [id, label, price, sort, desc] of rows) {
      insVar.run(id, `SK-${id}`, label, price, sort, String(id));
      insSk.run(String(id), label, desc, id, price);
    }
  });

  afterEach(() => {
    fx.close();
    vi.unstubAllEnvs();
  });

  it("Telegram handleShowProduct shows composed SK labels on variant buttons with simplified product caption", async () => {
    const { handleShowProduct } = await import("@/lib/telegram/handlers/catalog");
    const { safeEditOrSend, sendMessage } = await import("@/lib/telegram/api");

    await handleShowProduct(42, 7, 72, { id: 42 });

    const call = (vi.mocked(safeEditOrSend).mock.calls.at(-1)?.[0] ?? vi.mocked(sendMessage).mock.calls.at(-1)?.[0]) as {
      text?: string;
      reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] };
    };
    expect(call).toBeTruthy();
    const text = String(call.text ?? "").replace(/\u00a0/g, " ");
    const buttons = (call.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);

    expect(text).toBe("<b>Netflix</b>\nPilih varian 👇");
    expect(text).not.toContain("Varian tersedia");

    expect(buttons).toContain("1 Profile 2 User - 1 Bulan · Rp19.500 · stok 45");
    expect(buttons).toContain("1 Profile 1 User - 1 Bulan · Rp30.000 · stok 45");
    expect(buttons).toContain("1 Bulan Private · Rp85.000 · stok 45");
    expect(buttons).not.toContain("1 Bulan Private - 28-30 Hari · Rp85.000 · stok 45");
    expect(buttons).toContain("7 Hari 1 Profile 1 User · Rp12.000 · stok 45");
    expect(buttons).toContain("Basic Sharing · Rp18.000 · stok 45");
  });

  it("Telegram cart summary & Web checkout quote & Web catalog detail carry SK duration without extra queries", async () => {
    const { addToCart, getCartSummary } = await import("@/lib/telegram/cart");
    await addToCart("42", 72, 31, 1);
    fx.control.queries = 0;
    const summary = await getCartSummary("42");
    expect(fx.control.queries).toBe(1);
    expect(summary.lines[0]?.variantLabel).toBe("1 Profile 2 User - 1 Bulan");

    const { POST: quotePost } = await import("@/app/api/checkout/quote/route");
    const quoteRes = await quotePost(new NextRequest("http://localhost/api/checkout/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { product_id: 72, variant_id: 31, qty: 1 },
          { product_id: 72, variant_id: 704, qty: 1 },
        ],
      }),
    }));
    const quoteJson = (await quoteRes.json()) as { items: { name: string }[] };
    expect(quoteRes.status).toBe(200);
    expect(quoteJson.items.map((i) => i.name)).toEqual([
      "Netflix — 1 Profile 2 User - 1 Bulan",
      "Netflix — 1 Bulan Private",
    ]);

    const detail = await getProductDetail("netflix");
    expect(detail).not.toBeNull();
    const storefront = withVariantCopy(detail!);
    const v31 = storefront.variants.find((v) => v.id === 31)!;
    expect(v31.sk_description).toBeUndefined();
    expect(formatVariantLabel(v31, "id")).toBe("1 Profile 2 User - 1 Bulan");
    expect(formatVariantLabel(v31, "en")).toBe("1 Profile 2 User - 1 Month");
  });
});
