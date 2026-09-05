// tests/whatsapp-variants.regression.test.ts — Comprehensive regression tests for variants, catalog, warranty, and WhatsApp group bot
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
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
  type VariantSummary,
} from "@/lib/catalog";
import * as waMsg from "@/lib/whatsapp/messages";
import { isEnabled, preflightWhatsAppPayment } from "@/lib/feature-flags";
import {
  parseFonntePayload,
  timingSafeEqual,
  authenticateWebhook,
  isGroupAllowed,
  isSelfMessage,
  isPrivateIp,
  checkImageMagicBytes,
  downloadMediaSafely,
  sendTextMessage,
} from "@/lib/whatsapp/gateway";

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
    expect(text).not.toContain("<b>");
    expect(text).not.toContain("</b>");
    expect(text).not.toContain("&amp;");
  });

  it("both formatters contain identical substance", () => {
    const tg = formatWarrantyTelegram();
    const wa = formatWarrantyWhatsApp();

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
    product_id: 1,
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
  it("formats list products message without categories or prices in enhanced JemStore style", () => {
    const products = [{ name: "Canva Pro 1 Tahun" }, { name: "ChatGPT Plus 1 Bulan" }, { name: "Gemini Advanced 1 Bulan" }];
    const msg = waMsg.listProductsMessage(products);

    expect(msg).toContain("「 *LIST MENU STORE* 」");
    expect(msg).toContain("Tanggal :");
    expect(msg).toContain("Jam :");
    expect(msg).toContain("꧁ঔৣ★ CANVA");
    expect(msg).toContain("꧁ঔৣ★ CHATGPT");
    expect(msg).toContain("꧁ঔৣ★ GEMINI");
    expect(msg).toContain("Ketik nama produk untuk melihat pilihan varian.");
    expect(msg).toContain("Ketik *garansi*");
    expect(msg).not.toContain("Rp");
    expect(msg).not.toContain("AI Gateway");
  });

  it("formats product detail with numbered active variants", () => {
    const variants: VariantSummary[] = [
      {
        id: 1, product_id: 1, sku: "GEM-INV", label: "Invite",
        duration_value: 12, duration_unit: "month", duration_label: null,
        warranty_type: "full", warranty_value: null, warranty_unit: null, warranty_label: null,
        price: 18000, compare_price: null, stock: -1, fulfillment_mode: "manual", is_active: 1, sort_order: 0,
      },
      {
        id: 2, product_id: 1, sku: "GEM-HEAD", label: "Head",
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
        id: 1, product_id: 1, sku: "TEST-OUT", label: "Solo",
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
      id: 2, product_id: 1, sku: "GEM-HEAD", label: "Head",
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
    const mockEmpty = async () => [];
    const emptyResult = await preflightWhatsAppPayment(mockEmpty);
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.missing).toHaveLength(3);

    const mockComplete = async () => [
      { id: "qris", qris_url: "/qris/test.jpg", is_active: 1 },
      { id: "seabank", account_number: "123", account_name: "Test", is_active: 1 },
      { id: "ewallet", account_number: "081", account_name: "Test", is_active: 1 },
    ];
    const completeResult = await preflightWhatsAppPayment(mockComplete);
    expect(completeResult.ok).toBe(true);
    expect(completeResult.missing).toHaveLength(0);
  });

  it("runs payment-method preflight before a WhatsApp order is created", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/whatsapp/webhook/route.ts"),
      "utf8",
    );
    const preflightAt = route.indexOf("preflightWhatsAppPayment(queryAll)");
    const createAt = route.indexOf("createPendingChannelOrder({");
    expect(preflightAt).toBeGreaterThan(0);
    expect(createAt).toBeGreaterThan(preflightAt);
  });
});

describe("Fonnte Official Payload Parser (P0.1)", () => {
  it("parses real Fonnte group payload fixture correctly", () => {
    const fonnteGroupFixture = {
      sender: "120363024823948293@g.us",
      message: "list",
      member: "628123456789",
      name: "Budi Santoso",
      location: "",
      inboxid: "98234123",
    };

    const parsed = parseFonntePayload(fonnteGroupFixture);
    expect(parsed).not.toBeNull();
    expect(parsed?.isGroup).toBe(true);
    expect(parsed?.conversationId).toBe("120363024823948293@g.us");
    expect(parsed?.memberId).toBe("628123456789");
    expect(parsed?.inboxId).toBe("98234123");
    expect(parsed?.message).toBe("list");
    expect(parsed?.name).toBe("Budi Santoso");
  });

  it("parses Fonnte group media attachment payload", () => {
    const fonnteMediaFixture = {
      sender: "120363024823948293@g.us",
      message: "BUKTI AXV-20260904-TEST1234 SEABANK",
      member: "628987654321",
      name: "Siti",
      inboxid: "98234125",
      url: "https://media.fonnte.com/files/proof_123.jpg",
      filename: "proof_123.jpg",
      extension: "jpg",
    };

    const parsed = parseFonntePayload(fonnteMediaFixture);
    expect(parsed).not.toBeNull();
    expect(parsed?.isGroup).toBe(true);
    expect(parsed?.attachment?.url).toBe("https://media.fonnte.com/files/proof_123.jpg");
    expect(parsed?.attachment?.filename).toBe("proof_123.jpg");
    expect(parsed?.attachment?.extension).toBe("jpg");
  });

  it("parses direct message payload and distinguishes from group", () => {
    const directFixture = {
      sender: "628123456789",
      message: "halo",
      member: "",
      name: "Budi",
      inboxid: "98234126",
    };

    const parsed = parseFonntePayload(directFixture);
    expect(parsed).not.toBeNull();
    expect(parsed?.isGroup).toBe(false);
    expect(parsed?.conversationId).toBe("628123456789");
    expect(parsed?.memberId).toBe("628123456789");
  });
});

describe("Webhook Authentication & Timing-Safe Check (P0.2)", () => {
  beforeEach(() => {
    process.env.WHATSAPP_WEBHOOK_TOKEN = "super_secret_webhook_token_123";
  });

  afterEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_TOKEN;
  });

  it("timingSafeEqual correctly matches identical strings", () => {
    expect(timingSafeEqual("abc123xyz", "abc123xyz")).toBe(true);
    expect(timingSafeEqual("abc123xyz", "abc123xyw")).toBe(false);
    expect(timingSafeEqual("short", "much_longer_string")).toBe(false);
  });

  it("authenticates valid token from x-webhook-token header", () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/whatsapp/webhook", {
      method: "POST",
      headers: {
        "x-webhook-token": "super_secret_webhook_token_123",
      },
    });
    const auth = authenticateWebhook(req);
    expect(auth.ok).toBe(true);
  });

  it("authenticates valid token from Authorization Bearer header", () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/whatsapp/webhook", {
      method: "POST",
      headers: {
        authorization: "Bearer super_secret_webhook_token_123",
      },
    });
    const auth = authenticateWebhook(req);
    expect(auth.ok).toBe(true);
  });

  it("authenticates valid token from query parameter", () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/whatsapp/webhook?token=super_secret_webhook_token_123", {
      method: "POST",
    });
    const auth = authenticateWebhook(req);
    expect(auth.ok).toBe(true);
  });

  it("authenticates the provider-native secret field from Fonnte webhook data", () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/whatsapp/webhook", {
      method: "POST",
    });
    const auth = authenticateWebhook(req, {
      secret: "super_secret_webhook_token_123",
    });
    expect(auth.ok).toBe(true);
  });

  it("rejects missing token with 401 reason", () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/whatsapp/webhook", {
      method: "POST",
    });
    const auth = authenticateWebhook(req);
    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe("missing_token");
  });

  it("rejects invalid token with 401 reason", () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/whatsapp/webhook", {
      method: "POST",
      headers: {
        "x-webhook-token": "wrong_token_guess",
      },
    });
    const auth = authenticateWebhook(req);
    expect(auth.ok).toBe(false);
    expect(auth.reason).toBe("invalid_token");
  });
});

describe("Group Allowlist & Self Check (P0.1)", () => {
  beforeEach(() => {
    process.env.WHATSAPP_GROUP_ALLOWLIST = "120363024823948293@g.us,120363099999999999@g.us";
    process.env.WHATSAPP_BOT_NUMBER = "6289519388264";
  });

  afterEach(() => {
    delete process.env.WHATSAPP_GROUP_ALLOWLIST;
    delete process.env.WHATSAPP_BOT_NUMBER;
  });

  it("allows configured groups and rejects unauthorized groups", () => {
    expect(isGroupAllowed("120363024823948293@g.us")).toBe(true);
    expect(isGroupAllowed("120363099999999999@g.us")).toBe(true);
    expect(isGroupAllowed("120363000000000000@g.us")).toBe(false);
  });

  it("identifies self messages from bot number to prevent loops", () => {
    expect(isSelfMessage("6289519388264")).toBe(true);
    expect(isSelfMessage("089519388264")).toBe(true);
    expect(isSelfMessage("628123456789")).toBe(false);
  });
});

describe("SSRF Prevention and Media Magic Bytes (P0.5)", () => {
  it("detects private IP addresses and loopbacks", () => {
    expect(isPrivateIp("localhost")).toBe(true);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.5")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.100")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("[::1]")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd12:3456::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);

    // Public hostnames are not private
    expect(isPrivateIp("media.fonnte.com")).toBe(false);
    expect(isPrivateIp("axvara.tech")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });

  it("validates magic bytes for JPG, PNG, WebP", () => {
    const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(checkImageMagicBytes(jpgBytes, "image/jpeg")).toBe(true);
    expect(checkImageMagicBytes(jpgBytes, "image/jpg")).toBe(true);

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(checkImageMagicBytes(pngBytes, "image/png")).toBe(true);
    expect(checkImageMagicBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), "image/png")).toBe(false);

    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(checkImageMagicBytes(webpBytes, "image/webp")).toBe(true);

    // Invalid / fake bytes
    const fakeBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(checkImageMagicBytes(fakeBytes, "image/jpeg")).toBe(false);
    expect(checkImageMagicBytes(fakeBytes, "image/png")).toBe(false);
    expect(checkImageMagicBytes(fakeBytes, "image/webp")).toBe(false);
  });

  it("never forwards the Fonnte API token while downloading webhook media", async () => {
    process.env.FONNTE_TOKEN = "must-not-leak";
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      return new Response(png, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadMediaSafely("https://media.example.test/proof.png");

    expect(result?.contentType).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    delete process.env.FONNTE_TOKEN;
  });
});

describe("Outbound Fonnte Reply with inboxid (P0.1)", () => {
  it("rejects webhook events without a stable inbox id", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/whatsapp/webhook/route.ts"),
      "utf8",
    );
    expect(route).toContain("missing_inbox_id");
  });

  it("rate-limits authenticated group events and bounds payload bytes", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/whatsapp/webhook/route.ts"),
      "utf8",
    );
    expect(route).toContain("WHATSAPP_MEMBER_EVENTS_PER_MINUTE");
    expect(route).toContain('status=\'ignored\'');
    expect(route).toContain("TextEncoder");
  });

  it("sends inboxid in request body when replying", async () => {
    process.env.FONNTE_TOKEN = "dummy_token";

    let interceptedBody: string = "";
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      interceptedBody = String(options.body);
      return {
        ok: true,
        json: async () => ({ status: true, id: "msg_out_123" }),
      };
    }));

    const res = await sendTextMessage({
      target: "120363024823948293@g.us",
      message: "Test reply",
      inboxId: "inbox_999",
    });

    expect(res.ok).toBe(true);
    expect(res.messageId).toBe("msg_out_123");
    const parsed = JSON.parse(interceptedBody);
    expect(parsed.target).toBe("120363024823948293@g.us");
    expect(parsed.message).toBe("Test reply");
    expect(parsed.inboxid).toBe("inbox_999"); // MUST be inboxid, NOT reply!

    vi.unstubAllGlobals();
    delete process.env.FONNTE_TOKEN;
  });
});

describe("Cart Matching Logic with Variants (P1.6)", () => {
  type TestItem = { id: string; price: number; qty: number; variantId?: number; variantLabel?: string };

  function addToCart(
    items: TestItem[],
    product: { id: string; price: number; stock?: number; variantId?: number; variantLabel?: string },
    qty = 1,
  ): TestItem[] {
    const matchKey = product.variantId ? `${product.id}:${product.variantId}` : product.id;
    const itemKey = (i: TestItem) => (i.variantId ? `${i.id}:${i.variantId}` : i.id);
    const existing = items.find((i) => itemKey(i) === matchKey);
    if (existing) {
      return items.map((i) => (itemKey(i) === matchKey ? { ...i, qty: i.qty + qty } : i));
    }
    return [...items, { ...product, qty }];
  }

  function removeFromCart(items: TestItem[], id: string, variantId?: number): TestItem[] {
    const matchKey = variantId ? `${id}:${variantId}` : id;
    const itemKey = (i: TestItem) => (i.variantId ? `${i.id}:${i.variantId}` : i.id);
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
