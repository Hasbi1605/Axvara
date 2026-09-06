// tests/telegram-bot.regression.test.ts — Telegram bot contract tests
import { describe, it, expect } from "vitest";
import {
  escapeHtml, welcomeMessage, formatWIBTime, catalogFlatMessage,
  productDetailMessage, invoiceMessage, helpMessage, deliveryMessage,
  warrantyTermsMessage, warrantyClaimMessage, warrantyFullMessage,
  confirmBuyMessage, confirmVariantBuyMessage, chooseQtyMessage,
  paymentMethodMessage, manualTransferMessage,
  manualFulfillmentBuyerMessage, orderPaidMessage,
  askWhatsAppMessage, waSavedAfterInvoiceMessage,
} from "@/lib/telegram/messages";
import {
  cb, parseCallback, homeKeyboard, warrantyKeyboard, categoriesKeyboard,
  productsKeyboard, catalogFlatKeyboard, qtyKeyboard, paymentMethodKeyboard,
  askWaAfterInvoiceKeyboard, orderPaidKeyboard,
} from "@/lib/telegram/keyboards";

describe("Telegram HTML escaping", () => {
  it("escapes all HTML special characters", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(escapeHtml("AT&T")).toBe("AT&amp;T");
    expect(escapeHtml("normal text")).toBe("normal text");
  });

  it("escapes product/user data in welcome message", () => {
    const msg = welcomeMessage('<b>hacker</b>');
    expect(msg).not.toContain("<b>hacker</b>");
    expect(msg).toContain("&lt;b&gt;hacker&lt;/b&gt;");
  });

  it("escapes product detail with malicious name", () => {
    const msg = productDetailMessage({
      name: '<img src=x onerror=alert(1)>',
      price: 100000,
    });
    expect(msg).not.toContain("<img");
    expect(msg).toContain("&lt;img");
  });
});

describe("Telegram WIB greeting", () => {
  it("returns a valid greeting, date, and time", () => {
    const { greeting, tanggal, jam } = formatWIBTime();
    expect(greeting).toMatch(/Selamat (Pagi|Siang|Sore|Malam)/);
    expect(tanggal).toMatch(/\d{1,2} \w+ \d{4}/);
    expect(jam).toMatch(/WIB/);
  });

  it("welcome message greets with WIB time like WA", () => {
    const msg = welcomeMessage("nad");
    expect(msg).toContain("━━━");
    expect(msg).toContain("AXVARA");
    expect(msg).toContain("nad");
    expect(msg).toMatch(/Selamat (Pagi|Siang|Sore|Malam)/);
    expect(msg).toContain("WIB");
  });

  it("flat catalog message shows greeting + count without categories", () => {
    const msg = catalogFlatMessage(5);
    expect(msg).toContain("Katalog AXVARA");
    expect(msg).toContain("5 produk tersedia");
    expect(msg).toMatch(/Selamat (Pagi|Siang|Sore|Malam)/);
  });
});

describe("Telegram callback data", () => {
  it("all callback_data <= 64 bytes", () => {
    const datas = [
      cb.home(),
      cb.catalog(99),
      cb.categories(99),
      cb.category(99999, 99),
      cb.product(99999),
      cb.buy(99999),
      cb.confirm(99999),
      cb.confirmVariant(99999, 88888),
      cb.qty(99999, 88888),
      cb.setQty(99999, 88888, 20),
      cb.pay(99999, 88888, 20),
      cb.payMethod(99999, 88888, 20, "seabank"),
      cb.order("AXV-20260903-ABCD1234"),
      cb.cancel("AXV-20260903-ABCD1234"),
      cb.refresh("AXV-20260903-ABCD1234"),
      cb.waSkip("AXV-20260903-ABCD1234"),
    ];
    for (const d of datas) {
      const bytes = new TextEncoder().encode(d).length;
      expect(bytes).toBeLessThanOrEqual(64);
    }
  });

  it("parses callback data correctly", () => {
    expect(parseCallback("home")).toEqual({ action: "home", params: [] });
    expect(parseCallback("catalog:2")).toEqual({ action: "catalog", params: ["2"] });
    expect(parseCallback("cats:2")).toEqual({ action: "cats", params: ["2"] });
    expect(parseCallback("cat:5:1")).toEqual({ action: "cat", params: ["5", "1"] });
    expect(parseCallback("prd:42")).toEqual({ action: "prd", params: ["42"] });
    expect(parseCallback("qty:12:34")).toEqual({ action: "qty", params: ["12", "34"] });
    expect(parseCallback("q:12:34:5")).toEqual({ action: "q", params: ["12", "34", "5"] });
    expect(parseCallback("pm:12:34:5:qris")).toEqual({ action: "pm", params: ["12", "34", "5", "qris"] });
    expect(parseCallback("order:AXV-20260903-AB12CD34")).toEqual({
      action: "order", params: ["AXV-20260903-AB12CD34"],
    });
  });
});

describe("Telegram keyboards", () => {
  it("home keyboard has katalog, pesanan, garansi, bantuan", () => {
    const kb = homeKeyboard();
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    expect(allTexts.some(t => t.includes("Katalog"))).toBe(true);
    expect(allTexts.some(t => t.includes("Bantuan"))).toBe(true);
    expect(allTexts.some(t => t.includes("Pesanan"))).toBe(true);
    expect(allTexts.some(t => t.includes("Garansi"))).toBe(true);
  });

  it("warranty keyboard routes back to catalog and home", () => {
    const kb = warrantyKeyboard();
    const allData = kb.inline_keyboard.flat().map(b => b.callback_data ?? b.url ?? "");
    expect(allData.some(d => d.startsWith("catalog"))).toBe(true);
    expect(allData.some(d => d === "home")).toBe(true);
  });

  it("categories keyboard uses 2-column grid", () => {
    const cats = [
      { id: 1, name: "AI Gateway" },
      { id: 2, name: "Akun Premium" },
      { id: 3, name: "Tools Pro" },
      { id: 4, name: "Bundle Kucing" },
    ];
    const kb = categoriesKeyboard(cats, 0);
    // Should be 2 per row (2 rows of categories + 1 row home)
    expect(kb.inline_keyboard[0].length).toBe(2);
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    expect(allTexts.some(t => t.includes("⚡"))).toBe(true); // AI Gateway icon
    expect(allTexts.some(t => t.includes("👑"))).toBe(true); // Akun Premium icon
  });

  it("categories keyboard paginates", () => {
    const cats = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Cat ${i}` }));
    const page0 = categoriesKeyboard(cats, 0);
    const page1 = categoriesKeyboard(cats, 1);

    const page0Texts = page0.inline_keyboard.flat().map(b => b.text);
    expect(page0Texts.some(t => t.includes("▶️"))).toBe(true);

    const page1Texts = page1.inline_keyboard.flat().map(b => b.text);
    expect(page1Texts.some(t => t.includes("◀️"))).toBe(true);
  });

  it("flat catalog keyboard lists products without categories", () => {
    const products = [
      { id: 1, name: "Canva Pro", price: 5000 },
      { id: 2, name: "ChatGPT Plus 1 Bulan", price: 89000 },
    ];
    const kb = catalogFlatKeyboard(products, 0);
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    expect(allTexts.some(t => t.includes("Canva Pro"))).toBe(true);
    expect(allTexts.some(t => t.includes("ChatGPT") && t.includes("89rb"))).toBe(true);
    // Categories only as optional filter
    expect(allTexts.some(t => t.includes("Kategori"))).toBe(true);
  });

  it("flat catalog keyboard paginates with page indicator", () => {
    const products = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, name: `Product ${i}`, price: 50000,
    }));
    const kb = catalogFlatKeyboard(products, 0, 8);
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    expect(allTexts.some(t => t.includes("1/3"))).toBe(true);
    expect(allTexts.some(t => t.includes("▶️"))).toBe(true);
  });

  it("products keyboard shows compact price", () => {
    const products = [
      { id: 1, name: "ChatGPT Plus 1 Bulan", price: 89000 },
      { id: 2, name: "Claude Pro 1 Bulan", price: 95000 },
    ];
    const kb = productsKeyboard(products, 1);
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    expect(allTexts.some(t => t.includes("ChatGPT") && t.includes("89rb"))).toBe(true);
  });

  it("products keyboard has page indicator", () => {
    const products = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, name: `Product ${i}`, price: 50000,
    }));
    const kb = productsKeyboard(products, 1, 0);
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    expect(allTexts.some(t => t.includes("1/2"))).toBe(true); // page indicator
  });

  it("qty keyboard offers quick picks capped by stock", () => {
    const kb = qtyKeyboard({ productId: 1, variantId: 2, stock: 3 });
    const buttons = kb.inline_keyboard.flat();
    const datas = buttons.map(b => b.callback_data ?? "");
    expect(datas.some(d => d === "q:1:2:1")).toBe(true);
    expect(datas.some(d => d === "q:1:2:3")).toBe(true);
    expect(datas.some(d => d === "q:1:2:5")).toBe(false);
  });

  it("payment keyboard offers QRIS + SeaBank + E-Wallet", () => {
    const kb = paymentMethodKeyboard(1, 2, 3);
    const buttons = kb.inline_keyboard.flat();
    const datas = buttons.map(b => b.callback_data ?? "");
    expect(datas).toContain("pm:1:2:3:qris");
    expect(datas).toContain("pm:1:2:3:seabank");
    expect(datas).toContain("pm:1:2:3:ewallet");
  });

  it("WA-after-invoice keyboard has status check + skip", () => {
    const kb = askWaAfterInvoiceKeyboard("AXV-20260906-TEST1234");
    const buttons = kb.inline_keyboard.flat();
    const texts = buttons.map(b => b.text);
    const datas = buttons.map(b => b.callback_data ?? "");
    expect(texts.some(t => t.includes("Cek Status"))).toBe(true);
    expect(texts.some(t => t.includes("Lewati"))).toBe(true);
    expect(datas.some(d => d.startsWith("waskip:"))).toBe(true);
  });

  it("paid-order keyboard links directly to Telegram support", () => {
    const kb = orderPaidKeyboard("AXV-20260904-AB12CD34");
    const buttons = kb.inline_keyboard.flat();
    expect(buttons.some((button) => button.text.includes("@Axvara_bot"))).toBe(true);
    expect(buttons.some((button) => button.url === "https://t.me/Axvara_bot")).toBe(true);
  });
});

describe("Telegram messages premium UX", () => {
  it("welcome message has visual separator", () => {
    const msg = welcomeMessage("nad");
    expect(msg).toContain("━━━");
    expect(msg).toContain("AXVARA");
    expect(msg).toContain("nad");
  });

  it("invoice message shows total, code, and expiry", () => {
    const msg = invoiceMessage({
      orderCode: "AXV-20260903-AB12CD34",
      productName: "ChatGPT Plus",
      payableAmount: 89123,
      expiresAt: "2026-09-03T12:00:00Z",
    });
    expect(msg).toContain("AXV-20260903-AB12CD34");
    expect(msg).toContain("89.123");
    expect(msg).toContain("ChatGPT Plus");
    expect(msg).toContain("⏰");
    expect(msg).toContain("━━━");
  });

  it("help message lists all commands with structure", () => {
    const msg = helpMessage();
    expect(msg).toContain("/start");
    expect(msg).toContain("/katalog");
    expect(msg).toContain("/pesanan");
    expect(msg).toContain("/garansi");
    expect(msg).toContain("/bantuan");
    expect(msg).toContain("axvara.tech");
    expect(msg).toContain("1️⃣");
    expect(msg).toContain("SeaBank");
  });

  it("product detail never renders description (WA parity)", () => {
    const msg = productDetailMessage({
      name: "Canva Pro",
      description: "KEUNGGULAN: Edit sesuka hati tanpa skill desain",
      price: 5000,
      stock: -1,
    });
    expect(msg).not.toContain("KEUNGGULAN");
    expect(msg).not.toContain("Edit sesuka hati");
    expect(msg).toContain("Canva Pro");
  });

  it("product detail lists per-variant warranty synced with web/WA", () => {
    const msg = productDetailMessage({
      name: "Canva Pro",
      price: 5000,
      stock: -1,
      variants: [
        { label: "Pro Head 1 Bulan", price: 5000, warranty: "Full Garansi 1 Bulan", duration: "1 Bulan", stock: -1 },
        { label: "Pro Invite 1 Bulan", price: 10000, warranty: "Garansi Terbatas 7 Hari", duration: "1 Bulan", stock: 0 },
      ],
    });
    expect(msg).toContain("Full Garansi 1 Bulan");
    expect(msg).toContain("Garansi Terbatas 7 Hari");
    expect(msg).toContain("HABIS");
    expect(msg).toContain("Garansi mengikuti varian");
  });

  it("product detail shows urgency for low stock", () => {
    const msg = productDetailMessage({
      name: "Test Product",
      price: 50000,
      stock: 3,
    });
    expect(msg).toContain("Sisa 3");
    expect(msg).toContain("segera order");
  });

  it("product detail handles out-of-stock", () => {
    const msg = productDetailMessage({
      name: "Test Product",
      price: 50000,
      stock: 0,
    });
    expect(msg).toContain("Stok habis");
  });

  it("product detail handles unlimited stock", () => {
    const msg = productDetailMessage({
      name: "Test Product",
      price: 50000,
      stock: -1,
    });
    expect(msg).toContain("tersedia");
  });

  it("product detail shows discount percentage", () => {
    const msg = productDetailMessage({
      name: "Canva Pro",
      price: 45000,
      compare_price: 600000,
      stock: 60,
    });
    expect(msg).toContain("Hemat 93%");
    expect(msg).toContain("600.000");
  });

  it("confirm variant message multiplies price by qty", () => {
    const msg = confirmVariantBuyMessage({
      productName: "Canva Pro",
      variantLabel: "Pro Head 1 Bulan",
      price: 5000,
      qty: 3,
    });
    expect(msg).toContain("Qty: 3");
    expect(msg).toContain("Rp15.000");
  });

  it("qty message supports bulk order copy", () => {
    const msg = chooseQtyMessage({
      productName: "Canva Pro",
      variantLabel: "Pro Head 1 Bulan",
      price: 5000,
      stock: -1,
    });
    expect(msg).toContain("bulk order");
    expect(msg).toContain("1–20");
  });

  it("payment method message lists QRIS + SeaBank + E-Wallet", () => {
    const msg = paymentMethodMessage({
      productName: "Canva Pro",
      variantLabel: "Pro Head 1 Bulan",
      qty: 2,
      total: 10000,
    });
    expect(msg).toContain("QRIS");
    expect(msg).toContain("SeaBank");
    expect(msg).toContain("E-Wallet");
    expect(msg).toContain("Rp10.000");
  });

  it("manual transfer message shows account + steps", () => {
    const msg = manualTransferMessage({
      orderCode: "AXV-20260906-TEST1234",
      productName: "Canva Pro — Pro Head",
      total: 5000,
      method: "seabank",
      account: "901812349386",
      accountName: "Brotherstore06",
    });
    expect(msg).toContain("901812349386");
    expect(msg).toContain("Brotherstore06");
    expect(msg).toContain("AXV-20260906-TEST1234");
    expect(msg).toContain("Rp5.000");
  });

  it("WA ask happens after invoice with skip option", () => {
    const msg = askWhatsAppMessage("Canva Pro — Pro Head 1 Bulan");
    expect(msg).toContain("sudah terbit");
    expect(msg).toContain("Lewati");
  });

  it("WA saved message confirms post-invoice capture", () => {
    const msg = waSavedAfterInvoiceMessage("AXV-20260906-TEST1234");
    expect(msg).toContain("AXV-20260906-TEST1234");
    expect(msg).toContain("Tersimpan");
  });

  it("delivery message has tap-to-copy hint", () => {
    const msg = deliveryMessage("acc@email.com:pass123");
    expect(msg).toContain("<code>");
    expect(msg).toContain("Tap untuk copy");
  });

  it("paid and manual fulfillment messages point buyers to support", () => {
    expect(orderPaidMessage("AXV-20260904-AB12CD34", "Produk")).toContain("@Axvara_bot");
    expect(manualFulfillmentBuyerMessage("AXV-20260904-AB12CD34")).toContain("@Axvara_bot");
  });
});

describe("Telegram warranty anti-refund copy", () => {
  it("welcome stays clean, warranty lives behind button + /garansi", () => {
    const msg = welcomeMessage("nad");
    expect(msg).toContain("AXVARA");
    expect(msg).not.toContain("Third-party");
    expect(msg).not.toContain("/garansi");
  });

  it("confirm buy requires understanding before paying", () => {
    const msg = confirmBuyMessage("ChatGPT Plus 1 Bulan", 89000);
    expect(msg).toContain("Third-party");
    expect(msg).toContain("/garansi");
    expect(msg).toContain("setuju");
  });

  it("product detail points warranty to variant + /garansi", () => {
    const msg = productDetailMessage({ name: "Test", price: 50000, stock: 5 });
    expect(msg).toContain("Garansi mengikuti varian");
    expect(msg).toContain("/garansi");
  });

  it("warranty terms disclose third-party, no 100% guarantee, DYOR", () => {
    const msg = warrantyTermsMessage();
    expect(msg).toContain("third-party store");
    expect(msg).toContain("tidak ada garansi 100% permanen");
    expect(msg).toContain("1×24 Jam s/d 30 Hari");
    expect(msg).toContain("DYOR");
    expect(msg).toContain("SETUJU");
  });

  it("warranty claims are replacement not refund + per-product terms", () => {
    const msg = warrantyClaimMessage();
    expect(msg).toContain("BUKAN refund");
    expect(msg).toContain("sesuai deskripsi produk");
    expect(msg).toContain("HANGUS");
    expect(msg).toContain("1×24 jam kerja");
  });

  it("full warranty combines terms + claims", () => {
    const msg = warrantyFullMessage();
    expect(msg).toContain("WAJIB BACA");
    expect(msg).toContain("SYARAT KLAIM");
  });
});
