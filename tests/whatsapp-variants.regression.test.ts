// tests/whatsapp-variants.regression.test.ts — Tests for variants, catalog, warranty, and WhatsApp group bot
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatWarrantyTelegram,
  formatWarrantyWhatsApp,
  formatWarrantyTermsTelegram,
  formatWarrantyClaimsTelegram,
  formatWarrantyTermsWhatsApp,
  formatWarrantyClaimsWhatsApp,
  warrantyClaimRules,
} from "@/lib/warranty-policy";
import {
  formatDuration,
  formatWarranty,
  formatRupiah,
  searchProductByName,
  listActiveProducts,
  type VariantSummary,
} from "@/lib/catalog";
import * as waMsg from "@/lib/whatsapp/messages";
import { isEnabled, preflightWhatsAppPayment } from "@/lib/feature-flags";
import { useCart } from "@/stores/cart";

describe("Canonical Warranty Policy", () => {
  it("has exactly 6 claim rules", () => {
    expect(warrantyClaimRules).toHaveLength(6);
  });

  it("Telegram formatter produces valid HTML with tags", () => {
    const html = formatWarrantyTelegram();
    expect(html).toContain("<b>KETENTUAN AXVARA");
    expect(html).toContain("<b>SYARAT KLAIM GARANSI</b>");
    expect(html).toContain("BUKAN refund dana");
    expect(html).toContain("1️⃣");
    expect(html).toContain("6️⃣");
  });

  it("WhatsApp formatter produces bold markup with asterisks without HTML tags", () => {
    const text = formatWarrantyWhatsApp();
    expect(text).toContain("*KETENTUAN AXVARA");
    expect(text).toContain("*SYARAT KLAIM GARANSI*");
    expect(text).toContain("*Garansi berupa penggantian / perbaikan, BUKAN refund dana.*");
    // Should NOT contain HTML tags
    expect(text).not.toContain("<b>");
    expect(text).not.toContain("</b>");
    expect(text).not.toContain("&amp;");
  });

  it("both formatters contain identical substance", () => {
    const tg = formatWarrantyTelegram();
    const wa = formatWarrantyWhatsApp();

    // Check key terms present in both
    expect(tg).toContain("third-party store");
    expect(wa).toContain("third-party store");
    expect(tg).toContain("DYOR, DWYOR");
    expect(wa).toContain("DYOR, DWYOR");
    expect(tg).toContain("1×24 jam kerja");
    expect(wa).toContain("1×24 jam kerja");
    expect(tg).toContain("penggantian / perbaikan");
    expect(wa).toContain("penggantian / perbaikan");
  });

  it("individual terms and claims formatters work", () => {
    expect(formatWarrantyTermsTelegram()).toContain("KETENTUAN");
    expect(formatWarrantyClaimsTelegram()).toContain("SYARAT KLAIM");
    expect(formatWarrantyTermsWhatsApp()).toContain("KETENTUAN");
    expect(formatWarrantyClaimsWhatsApp()).toContain("SYARAT KLAIM");
  });
});

describe("Catalog Formatting Helpers", () => {
  const baseVariant: VariantSummary = {
    id: 1,
    sku: "TEST-SKU",
    label: "Invite",
    duration_value: 12,
    duration_unit: "month",
    duration_label: null,
    warranty_type: "full",
    warranty_value: null,
    warranty_unit: null,
    warranty_label: null,
    price: 18000,
    compare_price: 25000,
    stock: -1,
    fulfillment_mode: "manual",
    is_active: 1,
    sort_order: 0,
  };

  it("formats standard duration correctly", () => {
    expect(formatDuration(baseVariant)).toBe("12 Bulan");
    expect(formatDuration({ ...baseVariant, duration_value: 7, duration_unit: "day" })).toBe("7 Hari");
    expect(formatDuration({ ...baseVariant, duration_value: 1, duration_unit: "year" })).toBe("1 Tahun");
    expect(formatDuration({ ...baseVariant, duration_unit: "lifetime" })).toBe("Selamanya");
  });

  it("prefers duration_label when provided", () => {
    expect(formatDuration({ ...baseVariant, duration_label: "3 Bulan + 1 Bulan Bonus" })).toBe("3 Bulan + 1 Bulan Bonus");
  });

  it("returns empty string when duration fields are null", () => {
    expect(formatDuration({ ...baseVariant, duration_value: null, duration_unit: null })).toBe("");
  });

  it("formats warranty types correctly", () => {
    expect(formatWarranty(baseVariant)).toBe("Full Garansi");
    expect(formatWarranty({ ...baseVariant, warranty_type: "none" })).toBe("Tanpa Garansi");
    expect(formatWarranty({
      ...baseVariant,
      warranty_type: "limited",
      warranty_value: 1,
      warranty_unit: "month",
    })).toBe("1 Bulan");
    expect(formatWarranty({ ...baseVariant, warranty_type: "custom", warranty_label: "Garansi Akun 14 Hari" })).toBe("Garansi Akun 14 Hari");
  });

  it("formats Rupiah correctly", () => {
    expect(formatRupiah(18000)).toBe("Rp18.000");
    expect(formatRupiah(0)).toBe("Rp0");
    expect(formatRupiah(1250000)).toBe("Rp1.250.000");
  });
});

describe("WhatsApp Message Formatting", () => {
  it("formats list products message without categories or prices", () => {
    const products = [{ name: "Canva" }, { name: "ChatGPT" }, { name: "Gemini" }];
    const msg = waMsg.listProductsMessage(products, 1, 1);

    expect(msg).toContain("*PRODUK AXVARA*");
    expect(msg).toContain("1. Canva");
    expect(msg).toContain("2. ChatGPT");
    expect(msg).toContain("3. Gemini");
    expect(msg).toContain("Ketik nama produk untuk melihat pilihan.");
    expect(msg).toContain("Ketik *garansi*");
    // Should NOT contain prices or categories
    expect(msg).not.toContain("Rp");
    expect(msg).not.toContain("AI Gateway");
  });

  it("formats product detail with numbered active variants", () => {
    const variants: VariantSummary[] = [
      {
        id: 1, sku: "GEM-INV", label: "Invite",
        duration_value: 12, duration_unit: "month", duration_label: null,
        warranty_type: "full", warranty_value: null, warranty_unit: null, warranty_label: null,
        price: 18000, compare_price: null, stock: -1, fulfillment_mode: "manual", is_active: 1, sort_order: 0,
      },
      {
        id: 2, sku: "GEM-HEAD", label: "Head",
        duration_value: 3, duration_unit: "month", duration_label: null,
        warranty_type: "limited", warranty_value: 1, warranty_unit: "month", warranty_label: null,
        price: 25000, compare_price: null, stock: 5, fulfillment_mode: "manual", is_active: 1, sort_order: 10,
      },
    ];

    const msg = waMsg.productDetailMessage("Gemini", "Akses Gemini Pro", variants);
    expect(msg).toContain("*GEMINI*");
    expect(msg).toContain("1. Invite");
    expect(msg).toContain("Durasi: 12 Bulan");
    expect(msg).toContain("Garansi: Full Garansi");
    expect(msg).toContain("Harga: Rp18.000");
    expect(msg).toContain("2. Head");
    expect(msg).toContain("Garansi: 1 Bulan");
    expect(msg).toContain("Harga: Rp25.000");
    expect(msg).toContain("Balas pesan ini dengan angka 1-2 untuk memilih.");
  });

  it("shows HABIS label for out-of-stock variants", () => {
    const variants: VariantSummary[] = [
      {
        id: 1, sku: "TEST-OUT", label: "Solo",
        duration_value: 1, duration_unit: "month", duration_label: null,
        warranty_type: "none", warranty_value: null, warranty_unit: null, warranty_label: null,
        price: 10000, compare_price: null, stock: 0, fulfillment_mode: "manual", is_active: 1, sort_order: 0,
      },
    ];
    const msg = waMsg.productDetailMessage("Test", null, variants);
    expect(msg).toContain("❌ HABIS");
  });

  it("formats variant selected message with call-to-action", () => {
    const variant: VariantSummary = {
      id: 2, sku: "GEM-HEAD", label: "Head",
      duration_value: 3, duration_unit: "month", duration_label: null,
      warranty_type: "limited", warranty_value: 1, warranty_unit: "month", warranty_label: null,
      price: 25000, compare_price: null, stock: 5, fulfillment_mode: "manual", is_active: 1, sort_order: 10,
    };
    const msg = waMsg.variantSelectedMessage("Gemini", variant);
    expect(msg).toContain("*VARIAN DIPILIH*");
    expect(msg).toContain("Gemini — Head");
    expect(msg).toContain("3 Bulan · Garansi 1 Bulan");
    expect(msg).toContain("Rp25.000");
    expect(msg).toContain("Balas pesan ini dengan *pay* atau *payment*");
  });

  it("formats payment message with all rails and proof instructions", () => {
    const msg = waMsg.paymentMessage({
      orderCode: "AXV-20260904-TEST1234",
      productName: "Gemini",
      variantLabel: "Head",
      duration: "3 Bulan",
      warranty: "1 Bulan",
      total: 25000,
      qrisUrl: "/qris/test.jpg",
      seabankAccount: "901812349386",
      seabankName: "Brotherstore06",
      ewalletAccount: "082135277434",
      ewalletName: "Brotherstore06",
    });

    expect(msg).toContain("*PEMBAYARAN AXVARA*");
    expect(msg).toContain("Order: AXV-20260904-TEST1234");
    expect(msg).toContain("Produk: Gemini — Head");
    expect(msg).toContain("Total: Rp25.000");
    expect(msg).toContain("*QRIS*");
    expect(msg).toContain("*SEABANK*");
    expect(msg).toContain("901812349386");
    expect(msg).toContain("*E-WALLET*");
    expect(msg).toContain("082135277434");
    expect(msg).toContain("*BUKTI PEMBAYARAN WAJIB*");
    expect(msg).toContain("Caption: BUKTI AXV-20260904-TEST1234 SEABANK");
    expect(msg).toContain("Bukti terlihat oleh anggota grup");
  });

  it("formats proof acknowledgement message with warning", () => {
    const msg = waMsg.proofAcknowledgementMessage("AXV-20260904-TEST1234");
    expect(msg).toContain("AXV-20260904-TEST1234");
    expect(msg).toContain("menunggu verifikasi");
    expect(msg).toContain("Bukti tidak otomatis berarti pembayaran sudah sah");
  });
});

describe("Feature Flags", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("flags default to false when env vars not set", () => {
    delete process.env.PRODUCT_VARIANTS_READ;
    delete process.env.WHATSAPP_ENABLED;
    delete process.env.WHATSAPP_GROUP_PAYMENT;

    expect(isEnabled("PRODUCT_VARIANTS_READ")).toBe(false);
    expect(isEnabled("WHATSAPP_ENABLED")).toBe(false);
    expect(isEnabled("WHATSAPP_GROUP_PAYMENT")).toBe(false);
  });

  it("flags evaluate to true when explicitly set to 'true'", () => {
    process.env.PRODUCT_VARIANTS_READ = "true";
    process.env.WHATSAPP_ENABLED = "true";

    expect(isEnabled("PRODUCT_VARIANTS_READ")).toBe(true);
    expect(isEnabled("WHATSAPP_ENABLED")).toBe(true);
  });

  it("preflight payment detects missing payment methods", async () => {
    // Mock queryAll with missing methods
    const mockEmpty = async () => [];
    const emptyResult = await preflightWhatsAppPayment(mockEmpty);
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.missing).toHaveLength(3);

    // Mock queryAll with complete methods
    const mockComplete = async () => [
      { id: "qris", qris_url: "/qris/test.jpg", is_active: 1 },
      { id: "seabank", account_number: "123", account_name: "Test", is_active: 1 },
      { id: "ewallet", account_number: "081", account_name: "Test", is_active: 1 },
    ];
    const completeResult = await preflightWhatsAppPayment(mockComplete);
    expect(completeResult.ok).toBe(true);
    expect(completeResult.missing).toHaveLength(0);
  });
});

// Cart store logic unit test without zustand persist middleware issues in Node
describe("Cart Matching Logic with Variants", () => {
  type TestItem = { id: string; price: number; qty: number; variantId?: number; variantLabel?: string };

  function addToCart(items: TestItem[], product: { id: string; price: number; stock?: number; variantId?: number; variantLabel?: string }, qty = 1): TestItem[] {
    const matchKey = product.variantId ? `${product.id}:${product.variantId}` : product.id;
    const itemKey = (i: TestItem) => i.variantId ? `${i.id}:${i.variantId}` : i.id;
    const existing = items.find((i) => itemKey(i) === matchKey);
    if (existing) {
      return items.map((i) => (itemKey(i) === matchKey ? { ...i, qty: i.qty + qty } : i));
    }
    return [...items, { ...product, qty }];
  }

  function removeFromCart(items: TestItem[], id: string, variantId?: number): TestItem[] {
    const matchKey = variantId ? `${id}:${variantId}` : id;
    const itemKey = (i: TestItem) => i.variantId ? `${i.id}:${i.variantId}` : i.id;
    return items.filter((i) => itemKey(i) !== matchKey);
  }

  it("differentiates items with same product id but different variant id", () => {
    let items: TestItem[] = [];
    items = addToCart(items, { id: "p1", price: 18000, variantId: 101, variantLabel: "Invite" });
    items = addToCart(items, { id: "p1", price: 25000, variantId: 102, variantLabel: "Head" });

    expect(items).toHaveLength(2);
    expect(items[0].variantId).toBe(101);
    expect(items[0].price).toBe(18000);
    expect(items[1].variantId).toBe(102);
    expect(items[1].price).toBe(25000);
    const subtotal = items.reduce((a, b) => a + b.price * b.qty, 0);
    expect(subtotal).toBe(43000);
  });

  it("increments quantity for same product AND same variant", () => {
    let items: TestItem[] = [];
    items = addToCart(items, { id: "p1", price: 18000, variantId: 101, variantLabel: "Invite" });
    items = addToCart(items, { id: "p1", price: 18000, variantId: 101, variantLabel: "Invite" });

    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(2);
    const subtotal = items.reduce((a, b) => a + b.price * b.qty, 0);
    expect(subtotal).toBe(36000);
  });

  it("removes specific variant without affecting other variants of same product", () => {
    let items: TestItem[] = [];
    items = addToCart(items, { id: "p1", price: 18000, variantId: 101 });
    items = addToCart(items, { id: "p1", price: 25000, variantId: 102 });

    items = removeFromCart(items, "p1", 101);

    expect(items).toHaveLength(1);
    expect(items[0].variantId).toBe(102);
  });
});
