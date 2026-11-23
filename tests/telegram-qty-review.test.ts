import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { applyButtonStyles } from "@/lib/telegram/button-style";
import {
  cb, qtyKeyboard, reviewKeyboard, paymentMethodOfferKeyboard,
  variantsKeyboard, productDetailKeyboard,
} from "@/lib/telegram/keyboards";
import { chooseQtyMessage, reviewPurchaseMessage } from "@/lib/telegram/messages/purchase";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { handlePendingQtyInput } from "@/lib/telegram/handlers/discovery";
import type { InlineKeyboardButton, SendMessageParams } from "@/lib/telegram/types";

const api = vi.hoisted(() => ({ send: vi.fn(), photo: vi.fn(), edit: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send,
  sendPhoto: api.photo,
  sendChatAction: vi.fn(async () => ({ ok: true })),
  showLoadingBar: vi.fn(async () => {}),
  withLoadingIndicator: vi.fn(async (_c: unknown, _l: unknown, work: (u: () => Promise<void>) => Promise<unknown>) => work(async () => {})),
  safeEditOrSend: api.edit,
}));

const qris = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/payments/qris", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/qris")>()),
  isActiveQrisConfigured: () => true,
  createActiveQrisInvoice: qris.create,
}));

function buttonsOf(msg: Pick<SendMessageParams, "reply_markup"> | undefined): InlineKeyboardButton[] {
  const markup = msg?.reply_markup;
  if (!markup || !("inline_keyboard" in markup)) return [];
  return (applyButtonStyles(markup) as { inline_keyboard: InlineKeyboardButton[][] }).inline_keyboard.flat();
}

describe("TG-QTYREVIEW unit layouts, copy, colors, and truncation", () => {
  it("renders simple qty screen without min line when min=1, with tier blockquote when enabled, and hides duplicate variant line", () => {
    const plain = chooseQtyMessage({ productName: "Canva Pro", variantLabel: "1 Bulan", price: 15000, stock: -1 });
    expect(plain).toBe(
      "🛒 <b>Pilih jumlah</b>\nProduk : <b>Canva Pro</b>\nVarian : 1 Bulan\nHarga  : Rp\u00a015.000 / pcs\nStok   : ∞",
    );
    expect(plain).not.toContain("Minimal pembelian");
    expect(plain).not.toContain("<blockquote>");

    const dupVariant = chooseQtyMessage({
      productName: "ChatGPT Go 3 Bulan",
      variantLabel: "chatgpt  go  3  bulan",
      price: 50000,
      stock: 12,
    });
    expect(dupVariant).toBe(
      "🛒 <b>Pilih jumlah</b>\nProduk : <b>ChatGPT Go 3 Bulan</b>\nHarga  : Rp\u00a050.000 / pcs\nStok   : 12",
    );
    expect(dupVariant).not.toContain("Varian :");

    const minAndBulk = chooseQtyMessage({
      productName: "Workspace",
      variantLabel: "1 Bulan",
      price: 10000,
      stock: 50,
      minQty: 5,
      bulkEnabled: true,
      bulkTiers: [{ min_qty: 10, unit_price: 8500 }],
    });
    expect(minAndBulk).toContain("Produk : <b>Workspace</b>");
    expect(minAndBulk).toContain("Varian : 1 Bulan");
    expect(minAndBulk).toContain("Stok   : 50");
    expect(minAndBulk).toContain("<blockquote>");
    expect(minAndBulk).toContain("Harga grosir");
    expect(minAndBulk).toContain("8.500");
    expect(minAndBulk).toContain("Minimal pembelian 5");

    const enMsg = chooseQtyMessage(
      { productName: "Workspace", variantLabel: "1 Month", price: 10000, stock: -1, minQty: 3 },
      { locale: "en", formatPrice: () => "$0.65" },
    );
    expect(enMsg).toBe(
      "🛒 <b>Choose quantity</b>\nProduct : <b>Workspace</b>\nVariant : 1 Month\nPrice   : $0.65 / pcs\nStock   : ∞\n\nMinimum purchase 3",
    );

    const enDup = chooseQtyMessage(
      { productName: "ChatGPT Go 3 Months", variantLabel: "ChatGPT Go 3 Months", price: 10000, stock: 5 },
      { locale: "en", formatPrice: () => "$0.65" },
    );
    expect(enDup).not.toContain("Variant :");
  });

  it("filters qty presets by min/max/stock, sets exact colors, and omits stepper/pay/cart", () => {
    const normal = applyButtonStyles(qtyKeyboard({ productId: 1, variantId: 2, stock: -1 })) as { inline_keyboard: InlineKeyboardButton[][] };
    expect(normal.inline_keyboard[0].map((b) => [b.text, b.callback_data, b.style])).toEqual([
      ["1", "q:1:2:1", "success"],
      ["5", "q:1:2:5", "success"],
      ["10", "q:1:2:10", "success"],
    ]);
    expect(normal.inline_keyboard[1][0]).toMatchObject({ text: "✍️ Jumlah lain", callback_data: "qinput:1:2", style: "primary" });
    expect(normal.inline_keyboard[2].map((b) => [b.text, b.callback_data, b.style])).toEqual([
      ["◀️ Kembali", "prd:1", "primary"],
      ["🏠 Menu", "home", "primary"],
    ]);

    const lowStock = qtyKeyboard({ productId: 1, variantId: 2, stock: 4 });
    expect(lowStock.inline_keyboard[0].map((b) => b.text)).toEqual(["1"]);
    expect(lowStock.inline_keyboard.flat().some((b) => b.callback_data === "qinput:1:2")).toBe(true);

    const exactOne = qtyKeyboard({ productId: 1, variantId: 2, stock: 1 });
    expect(exactOne.inline_keyboard[0].map((b) => b.text)).toEqual(["1"]);
    expect(exactOne.inline_keyboard.flat().some((b) => b.callback_data === "qinput:1:2")).toBe(false);

    const customMin = qtyKeyboard({ productId: 1, variantId: 2, stock: 100, minQty: 5, maxQty: 25 });
    expect(customMin.inline_keyboard[0].map((b) => b.text)).toEqual(["5", "10", "25"]);

    const singleMin = qtyKeyboard({ productId: 1, variantId: 2, stock: 8, minQty: 5 });
    expect(singleMin.inline_keyboard[0].map((b) => b.text)).toEqual(["5"]);

    const enKb = applyButtonStyles(qtyKeyboard({ productId: 1, variantId: 2, stock: 20 }, { locale: "en" })) as { inline_keyboard: InlineKeyboardButton[][] };
    expect(enKb.inline_keyboard.flat().map((b) => b.text)).toEqual(["1", "5", "10", "✍️ Custom quantity", "◀️ Back", "🏠 Menu"]);
  });

  it("removes Keranjang/cadd from product, variant, qty, and review keyboards", () => {
    const kbs = [
      productDetailKeyboard(1),
      variantsKeyboard(1, [{ id: 2, label: "Pro", price: 10000, stock: 5 }]),
      qtyKeyboard({ productId: 1, variantId: 2, stock: 5 }),
      reviewKeyboard({ productId: 1, variantId: 2, qty: 1, approvalTag: "deadbeef" }),
    ];
    for (const kb of kbs) {
      const flat = kb.inline_keyboard.flat();
      expect(flat.some((b) => b.text.includes("Keranjang") || b.text.includes("🛒"))).toBe(false);
      expect(flat.some((b) => String(b.callback_data ?? "").startsWith("cadd:"))).toBe(false);
    }
  });

  it("renders structured review message, omits empty sections, normalizes unicode bold, and truncates safely within 4096", () => {
    const normal = reviewPurchaseMessage({
      productName: "ChatGPT",
      variantLabel: "Plus 1 Bulan",
      qty: 12,
      unitPrice: 9000,
      basePrice: 10000,
      appliedTierMinQty: 10,
      sections: [
        { kind: "package", lines: ["𝐀𝐤𝐮𝐧\u200b privat"] },
        { kind: "activation", lines: [] },
        { kind: "warranty_terms", lines: ["Garansi penuh 25 hari"] },
      ],
    });
    expect(normal.truncated).toBe(false);
    expect(normal.text).toContain("🧾 <b>Baca sebelum bayar</b>");
    expect(normal.text).toMatch(/Jumlah 12 × Rp\s?9\.000 = <b>Rp\s?108\.000<\/b>/);
    expect(normal.text).toContain("grosir 10+");
    expect(normal.text).toContain("<blockquote><b>📦 Detail paket</b>\nAkun privat</blockquote>");
    expect(normal.text).not.toContain("🛠 Cara aktivasi");
    expect(normal.text).toContain("<blockquote><b>🛡 Garansi &amp; ketentuan</b>\nGaransi penuh 25 hari</blockquote>");
    expect(normal.text).toContain("Dengan lanjut, kamu setuju ketentuan ini.");

    const longLines = Array.from({ length: 120 }, (_, i) => `Baris detail ke-${i + 1}: ${"x".repeat(45)}`);
    const longRes = reviewPurchaseMessage({
      productName: "ChatGPT",
      variantLabel: "Plus",
      qty: 1,
      unitPrice: 10000,
      sections: [
        { kind: "package", lines: longLines },
        { kind: "activation", lines: ["Buka aplikasi", "Login email"] },
        { kind: "warranty_terms", lines: ["Garansi aktif 30 hari"] },
      ],
    });
    expect(longRes.truncated).toBe(true);
    expect(longRes.text.length).toBeLessThanOrEqual(4096);
    expect(longRes.text).toContain("🧾 <b>Baca sebelum bayar</b>");
    expect(longRes.text).toContain("Baris detail ke-1:");
    expect(longRes.text).toContain("Buka aplikasi");
    expect(longRes.text).toContain("Garansi aktif 30 hari");
    expect(longRes.text).toContain("…");

    const enRev = applyButtonStyles(reviewKeyboard({
      productId: 1, variantId: 2, qty: 2, approvalTag: "tag1", truncated: true,
    }, { locale: "en" })) as { inline_keyboard: InlineKeyboardButton[][] };
    expect(enRev.inline_keyboard.flat().map((b) => [b.text, b.style])).toEqual([
      ["📋 Read full terms", "primary"],
      ["✅ I have read — Continue to Payment", "success"],
      ["✍️ Change Quantity", "primary"],
      ["✖️ Cancel", "danger"],
    ]);

    const offer = applyButtonStyles(paymentMethodOfferKeyboard({
      nonce: "abc12345",
      methods: [{ id: "qris", kind: "qris", label: "QRIS" }],
      source: { kind: "single", productId: 1, variantId: 2, qty: 3 },
      idrSubtotal: 30000,
    }, { locale: "en" })) as { inline_keyboard: InlineKeyboardButton[][] };
    expect(offer.inline_keyboard.at(-2)?.map((b) => [b.text, b.callback_data, b.style])).toEqual([
      ["◀️ Back", "q:1:2:3", "primary"],
      ["✖️ Cancel", "prd:1", "danger"],
    ]);
  });
});

describe("TG-QTYREVIEW D1 router flows, guards, and compatibility", () => {
  let fx: ReturnType<typeof createD1Fixture>;
  const buyer = { id: 91001, first_name: "Pembeli" };
  const lastEdited = () => api.edit.mock.calls.at(-1)?.[0] as SendMessageParams | undefined;
  const lastSent = () => api.send.mock.calls.at(-1)?.[0] as SendMessageParams | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "qtyreview-fixture-secret");
    api.send.mockResolvedValue({ ok: true, result: { message_id: 2, date: 0, chat: { id: buyer.id, type: "private" } } });
    api.edit.mockImplementation(async (p: SendMessageParams & { message_id?: number }) => p.message_id ? { ok: true } : api.send(p));
    api.photo.mockResolvedValue({ ok: true });
    fx = createD1Fixture();
    stubFulfillmentKey();
    await insertTestProduct(fx.sql);
    fx.sql.exec(`
      UPDATE products SET name='Canva Pro', name_en='Canva Pro', description='Paket editing cepat', description_en='Fast editing plan', is_active=1, telegram_enabled=1, require_email=0 WHERE id=1;
      UPDATE product_variants SET label='Pro 1 Bulan', price=10000, stock=50, min_qty=1, bulk_pricing_enabled=1, bulk_pricing_tiers='[{"min_qty":10,"unit_price":8000}]', admin_terms='Garansi penuh\nLogin aman', admin_copy_fingerprint='' WHERE id=1;
      INSERT INTO telegram_users(user_id, chat_id, first_name, buyer_email) VALUES('91001', '91001', 'Pembeli', 'p@example.test');
    `);
    qris.create.mockImplementation(async (code: string, amount: number) => {
      const expiresAt = new Date(Date.now() + 600_000).toISOString();
      fx.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at,qris_url) VALUES(?,'gopay','inhouse',?,'fix',?,?,'pending',?,?)`)
        .run(code, code, amount, amount, expiresAt, "https://example.test/qr.png");
      return { orderCode: code, requestedAmount: amount, uniqueCode: 0, qrisPayload: "q", isExisting: false, qrisUrl: "https://example.test/qr.png", payableAmount: amount, expiresAt };
    });
  });

  afterEach(() => {
    fx.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("flows qty -> review (with bulk) -> pmentry picker -> Kembali to review -> Batal to product (0 orders)", async () => {
    await handleCallback("var:1", buyer.id, 10, buyer);
    const qtyMsg = lastEdited();
    expect(qtyMsg?.text).toContain("Produk : <b>Canva Pro</b>");
    expect(qtyMsg?.text).toContain("Varian : Pro 1 Bulan");
    expect(buttonsOf(qtyMsg).map((b) => b.callback_data)).toContain("q:1:1:10");
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='91001'").get()?.pending_action).toBe("qty_for:1:1");

    await handleCallback("q:1:1:10", buyer.id, 10, buyer);
    const revMsg = lastEdited();
    expect(revMsg?.text).toContain("🧾 <b>Baca sebelum bayar</b>");
    expect(revMsg?.text).toMatch(/Jumlah 10 × Rp\s?8\.000 = <b>Rp\s?80\.000<\/b>/);
    expect(revMsg?.text).toContain("grosir 10+");
    expect(revMsg?.text).toContain("Garansi penuh");
    const tag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 10, price: 8000 }]);
    const contBtn = buttonsOf(revMsg).find((b) => b.callback_data === `pmentry:1:1:10:${tag}`);
    expect(contBtn?.style).toBe("success");
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='91001'").get()?.pending_action).toBeNull();

    await handleCallback(contBtn!.callback_data!, buyer.id, 10, buyer);
    const pickerMsg = lastEdited();
    expect(pickerMsg?.text).toContain("💳 <b>Pilih pembayaran</b>");
    expect(pickerMsg?.text).toContain("Produk : Canva Pro · Pro 1 Bulan ×10");
    expect(pickerMsg?.text).toContain("QRIS: semua e-wallet &amp; m-banking.");
    expect(pickerMsg?.text).not.toContain("• QRIS");
    const pickerBtns = buttonsOf(pickerMsg);
    expect(pickerBtns.some((b) => b.text === "📱 QRIS · Rp80.000" && b.style === "success")).toBe(true);
    expect(pickerBtns.some((b) => b.callback_data === "q:1:1:10" && b.style === "primary")).toBe(true);
    expect(pickerBtns.some((b) => b.callback_data === "prd:1" && b.style === "danger")).toBe(true);

    // Kembali returns to review; Batalkan/Batal returns to product without creating an order.
    await handleCallback("q:1:1:10", buyer.id, 10, buyer);
    expect(lastEdited()?.text).toContain("🧾 <b>Baca sebelum bayar</b>");
    await handleCallback("prd:1", buyer.id, 10, buyer);
    expect(lastEdited()?.text).toContain("Canva Pro");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
  });

  it("handles ForceReply custom qty -> review and EN Ubah Jumlah / Baca lengkap / require_email", async () => {
    await handleCallback("qinput:1:1", buyer.id, 10, buyer);
    expect(lastSent()?.reply_markup).toMatchObject({ force_reply: true });
    expect(await handlePendingQtyInput("12", buyer.id, buyer)).toBe(true);
    const revMsg = lastSent();
    expect(revMsg?.text).toMatch(/Jumlah 12 × Rp\s?8\.000 = <b>Rp\s?96\.000<\/b>/);

    // require_email routes Continue -> email confirmation step first.
    fx.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    const pmentry = buttonsOf(revMsg).find((b) => b.callback_data?.startsWith("pmentry:"))?.callback_data;
    await handleCallback(pmentry!, buyer.id, 10, buyer);
    expect(buttonsOf(lastEdited()).some((b) => b.callback_data?.startsWith("epay:1:1:12:"))).toBe(true);

    // Baca lengkap opens terms pagination; Ubah Jumlah in EN returns to EN qty screen.
    await handleCallback("terms:1:1", buyer.id, 10, buyer);
    expect(lastEdited()?.text).toContain("Garansi penuh");
    await handleCallback("lang:en", buyer.id, 10, buyer);
    await handleCallback("qty:1:1", buyer.id, 10, buyer);
    expect(lastEdited()?.text).toContain("Stock   : 50");
  });

  it("enforces guards on review/pmentry, re-renders review on tag mismatch, ignores retired cadd, and keeps direct pay", async () => {
    // Min qty guard on review + pmentry
    fx.sql.exec("UPDATE product_variants SET min_qty=5 WHERE id=1");
    await handleCallback("q:1:1:2", buyer.id, 10, buyer);
    expect(lastSent()?.text).toContain("Minimal pembelian 5");
    expect(lastEdited()?.text).toContain("Minimal pembelian 5");

    // Price change after review render -> pmentry re-renders review with updated tag (no order)
    fx.sql.exec("UPDATE product_variants SET min_qty=1 WHERE id=1");
    await handleCallback("q:1:1:5", buyer.id, 10, buyer);
    const oldCb = buttonsOf(lastEdited()).find((b) => b.callback_data?.startsWith("pmentry:"))!.callback_data!;
    fx.sql.exec("UPDATE product_variants SET price=12000 WHERE id=1");
    await handleCallback(oldCb, buyer.id, 10, buyer);
    const freshTag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 5, price: 12000 }]);
    expect(buttonsOf(lastEdited()).some((b) => b.callback_data === `pmentry:1:1:5:${freshTag}`)).toBe(true);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);

    // Maintenance blocks review & pmentry
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "true");
    vi.clearAllMocks();
    await handleCallback("q:1:1:5", buyer.id, 10, buyer);
    await handleCallback(`pmentry:1:1:5:${freshTag}`, buyer.id, 10, buyer);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");

    // Retired cadd is a no-op; direct single pay: QRIS works
    await handleCallback("cadd:1:1:2", buyer.id, 10, buyer);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    await handleCallback(`pay:1:1:5:${freshTag}`, buyer.id, 10, buyer);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);

    // Pending active order blocks review (q:) and pmentry:
    vi.clearAllMocks();
    await handleCallback("q:1:1:5", buyer.id, 10, buyer);
    expect(lastSent()?.text).toContain("Pesanan aktif");
    await handleCallback(`pmentry:1:1:5:${freshTag}`, buyer.id, 10, buyer);
    expect(lastSent()?.text).toContain("Pesanan aktif");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);

    // Every generated callback <= 64 UTF-8 bytes
    for (const data of [
      cb.setQty(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100),
      cb.payMethodsEntry(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100, freshTag),
      cb.qty(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      cb.terms(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    ]) {
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    }
  });

  it("TG-CARD: review shows delivery line (automatic/manual ID+EN), uses variant copy only without product bullet duplication (Prime Video fixture), and dedupes across sections", async () => {
    // 1. Prime-Video-like fixture: variant detail overlaps product bullets, plus duplicate lines across Detail paket / Cara aktivasi / Garansi.
    fx.sql.exec(`
      UPDATE products
      SET name='Prime Video',
          name_en='Prime Video',
          description='Nonton film dan serial Prime Originals.\n- Masa aktif 25-30 hari\n- Legal dan bergaransi',
          description_en='Watch Prime Originals movies and series.\n- 25-30 days validity\n- Legal and covered by warranty'
      WHERE id=1;
      UPDATE product_variants
      SET label='Private 1 Bulan',
          fulfillment_mode='shared',
          admin_terms='Detail paket:\n- Masa aktif 25-30 hari dihitung 1 bulan\n- Akun legal dan bergaransi\nGaransi:\n- AKUN   LEGAL dan bergaransi',
          admin_activation='1. Buka Prime Video\n2. Akun legal   dan bergaransi\n3. Login dengan email dan password',
          admin_copy_fingerprint=''
      WHERE id=1;
    `);
    await handleCallback("q:1:1:1", buyer.id, 10, buyer);
    const revPrime = String(lastEdited()?.text ?? "");
    expect(revPrime).toContain("⚡ Kirim otomatis setelah bayar");
    expect(revPrime).toContain("• Masa aktif 25-30 hari dihitung 1 bulan");
    expect(revPrime).toContain("• Akun legal dan bergaransi");
    expect(revPrime).toContain("1. Buka Prime Video");
    expect(revPrime).toContain("2. Login dengan email dan password");
    // Must NEVER also include product bullets when variant has detail of its own:
    expect(revPrime).not.toContain("• Masa aktif 25-30 hari\n");
    expect(revPrime).not.toContain("• Legal dan bergaransi");
    // Case/space-insensitive duplicate across Detail paket / Cara aktivasi / Garansi omitted:
    expect(revPrime.toLowerCase().match(/akun\s+legal\s+dan\s+bergaransi/g)).toHaveLength(1);

    // 2. Manual/queued variant + fallback to product bullets ONLY when variant has no detail of its own (EN + ID).
    fx.sql.exec(`
      UPDATE product_variants
      SET fulfillment_mode='manual',
          admin_terms=NULL,
          admin_activation=NULL,
          admin_terms_en=NULL,
          admin_activation_en=NULL
      WHERE id=1;
    `);
    await handleCallback("q:1:1:1", buyer.id, 10, buyer);
    const revFallbackId = String(lastEdited()?.text ?? "");
    expect(revFallbackId).toContain("⏳ Diproses admin setelah bayar");
    expect(revFallbackId).toContain("• Masa aktif 25-30 hari");
    expect(revFallbackId).toContain("• Legal dan bergaransi");
    expect(revFallbackId).not.toContain("Nonton film dan serial Prime Originals.");

    await handleCallback("lang:en", buyer.id, 10, buyer);
    await handleCallback("q:1:1:1", buyer.id, 10, buyer);
    const revFallbackEn = String(lastEdited()?.text ?? "");
    expect(revFallbackEn).toContain("⏳ Processed by admin after payment");
    expect(revFallbackEn).toContain("• 25-30 days validity");

    // EN automatic delivery line
    fx.sql.exec(`UPDATE product_variants SET fulfillment_mode='shared' WHERE id=1`);
    await handleCallback("q:1:1:1", buyer.id, 10, buyer);
    expect(String(lastEdited()?.text ?? "")).toContain("⚡ Instant delivery after payment");

    // Legacy terms:1:0 callback still works for old buttons in chats
    await handleCallback("terms:1:0", buyer.id, 10, buyer);
    expect(String(lastEdited()?.text ?? "")).toContain("Choose a variant to read its terms.");
  });
});
