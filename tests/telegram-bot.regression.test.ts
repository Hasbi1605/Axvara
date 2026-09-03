// tests/telegram-bot.regression.test.ts — Telegram bot contract tests
import { describe, it, expect } from "vitest";
import { escapeHtml, welcomeMessage, productDetailMessage, invoiceMessage, helpMessage } from "@/lib/telegram/messages";
import { cb, parseCallback, homeKeyboard, categoriesKeyboard, productsKeyboard } from "@/lib/telegram/keyboards";

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
  it("home keyboard has expected buttons", () => {
    const kb = homeKeyboard();
    expect(kb.inline_keyboard.length).toBeGreaterThan(0);
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    expect(allTexts.some(t => t.includes("Katalog"))).toBe(true);
    expect(allTexts.some(t => t.includes("Bantuan"))).toBe(true);
  });

  it("categories keyboard paginates", () => {
    const cats = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Cat ${i}` }));
    const page0 = categoriesKeyboard(cats, 0);
    const page1 = categoriesKeyboard(cats, 1);

    // Page 0 should have "Berikutnya" but not "Sebelumnya"
    const page0Texts = page0.inline_keyboard.flat().map(b => b.text);
    expect(page0Texts.some(t => t.includes("Berikutnya"))).toBe(true);

    // Page 1 should have "Sebelumnya"
    const page1Texts = page1.inline_keyboard.flat().map(b => b.text);
    expect(page1Texts.some(t => t.includes("Sebelumnya"))).toBe(true);
  });

  it("products keyboard shows prices", () => {
    const products = [
      { id: 1, name: "ChatGPT Plus", price: 89000 },
      { id: 2, name: "Claude Pro", price: 95000 },
    ];
    const kb = productsKeyboard(products, 1);
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    expect(allTexts.some(t => t.includes("ChatGPT Plus"))).toBe(true);
    expect(allTexts.some(t => t.includes("89"))).toBe(true);
  });
});

describe("Telegram messages content", () => {
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
  });

  it("help message lists all commands", () => {
    const msg = helpMessage();
    expect(msg).toContain("/start");
    expect(msg).toContain("/katalog");
    expect(msg).toContain("/pesanan");
    expect(msg).toContain("/bantuan");
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
    expect(msg).toContain("Tersedia");
  });
});
