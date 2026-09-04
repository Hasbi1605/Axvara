// tests/telegram-bot.regression.test.ts — Telegram bot contract tests
import { describe, it, expect } from "vitest";
import { escapeHtml, welcomeMessage, productDetailMessage, invoiceMessage, helpMessage, deliveryMessage, warrantyTermsMessage, warrantyClaimMessage, warrantyFullMessage, confirmBuyMessage, manualFulfillmentBuyerMessage, orderPaidMessage } from "@/lib/telegram/messages";
import { cb, parseCallback, homeKeyboard, warrantyKeyboard, categoriesKeyboard, productsKeyboard, orderPaidKeyboard } from "@/lib/telegram/keyboards";

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
      description: "normal desc",
    });
    expect(msg).not.toContain("<img");
    expect(msg).toContain("&lt;img");
  });
});

describe("Telegram callback data", () => {
  it("all callback_data <= 64 bytes", () => {
    const datas = [
      cb.home(),
      cb.categories(99),
      cb.category(99999, 99),
      cb.product(99999),
      cb.buy(99999),
      cb.confirm(99999),
      cb.order("AXV-20260903-ABCD1234"),
      cb.cancel("AXV-20260903-ABCD1234"),
      cb.refresh("AXV-20260903-ABCD1234"),
    ];
    for (const d of datas) {
      const bytes = new TextEncoder().encode(d).length;
      expect(bytes).toBeLessThanOrEqual(64);
    }
  });

  it("parses callback data correctly", () => {
    expect(parseCallback("home")).toEqual({ action: "home", params: [] });
    expect(parseCallback("cats:2")).toEqual({ action: "cats", params: ["2"] });
    expect(parseCallback("cat:5:1")).toEqual({ action: "cat", params: ["5", "1"] });
    expect(parseCallback("prd:42")).toEqual({ action: "prd", params: ["42"] });
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
    expect(allData.some(d => d.startsWith("cats"))).toBe(true);
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

  it("paid-order keyboard links directly to Telegram support", () => {
    const kb = orderPaidKeyboard("AXV-20260904-AB12CD34");
    const buttons = kb.inline_keyboard.flat();
    expect(buttons.some((button) => button.text.includes("@axvara_support"))).toBe(true);
    expect(buttons.some((button) => button.url === "https://t.me/axvara_support")).toBe(true);
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

  it("delivery message has tap-to-copy hint", () => {
    const msg = deliveryMessage("acc@email.com:pass123");
    expect(msg).toContain("<code>");
    expect(msg).toContain("Tap untuk copy");
  });

  it("paid and manual fulfillment messages point buyers to support", () => {
    expect(orderPaidMessage("AXV-20260904-AB12CD34", "Produk")).toContain("@axvara_support");
    expect(manualFulfillmentBuyerMessage("AXV-20260904-AB12CD34")).toContain("@axvara_support");
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

  it("product detail points warranty to description + /garansi", () => {
    const msg = productDetailMessage({ name: "Test", price: 50000, stock: 5 });
    expect(msg).toContain("Garansi ikut deskripsi produk");
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
