// tests/telegram-bot.regression.test.ts — Telegram bot contract tests
import { describe, it, expect } from "vitest";
import {
  escapeHtml, welcomeMessage, formatWIBTime, catalogFlatMessage,
  productDetailMessage, invoiceMessage, helpMessage,
  warrantyTermsMessage, warrantyClaimMessage, warrantyFullMessage,
  confirmBuyMessage, confirmVariantBuyMessage, chooseVariantMessage, chooseQtyMessage,
  reviewPurchaseMessage, orderPaidMessage, waSavedAfterPaymentMessage,
  adminTelegramOrderCreatedMessage, myOrdersMessage, searchPromptMessage,
  searchResultsMessage, breadcrumbLine, formatSoldCountLabel,
  orderReminderMessage,
  emailConfirmationMessage,
} from "@/lib/telegram/messages";
import {
  cb, parseCallback, homeKeyboard, warrantyKeyboard, categoriesKeyboard,
  productsKeyboard, catalogFlatKeyboard, qtyKeyboard, reviewKeyboard, qrisInvoiceKeyboard,
  orderPaidKeyboard, mainReplyMenu, myOrdersKeyboard, searchResultsKeyboard, searchNoResultsKeyboard,
  productDetailKeyboard, variantsKeyboard, emailConfirmationKeyboard,
  helpKeyboard, orderStatusKeyboard, paidOrderStatusKeyboard, orderTerminalKeyboard,
  paymentMethodOfferKeyboard, credentialResendOutcomeKeyboard, settingsKeyboard,
  MENU_LABEL_CATALOG, MENU_LABEL_SEARCH, MENU_LABEL_ORDERS, MENU_LABEL_HELP,
  MENU_LABEL_SETTINGS, MENU_LABEL_EN,
} from "@/lib/telegram/keyboards";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
// Refactor 2026-09-10: implementasi handler webhook Telegram dipecah ke
// src/lib/telegram/handlers/* (route.ts kini hanya validasi + routing).
// Gabungkan route + seluruh handler agar assertion menilai implementasi
// SEBENARNYA (pola sama seperti readDelivery pada refactor deliver.ts).
const readWebhook = (): string => {
  const routeSrc = read("src/app/api/telegram/webhook/route.ts");
  const dir = path.join(process.cwd(), "src/lib/telegram/handlers");
  const handlers = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
  return routeSrc + "\n" + handlers;
};

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

  it("welcome greets by name without repeated dates or decoration", () => {
    const msg = welcomeMessage("nad");
    expect(msg).not.toContain("━━━");
    expect(msg).toContain("AXVARA");
    expect(msg).toContain("nad");
    expect(msg).toContain("Halo, nad.");
    expect(msg).not.toContain("WIB");
  });

  it("flat catalog message shows count without repeated greeting/date/time", () => {
    const msg = catalogFlatMessage(5);
    expect(msg).toBe("🛍 <b>Katalog AXVARA</b> · 5 produk");
    expect(msg).not.toMatch(/Selamat (Pagi|Siang|Sore|Malam)/);
    expect(msg).not.toContain("WIB");
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
      cb.setQty(99999, 88888, 100),
      cb.pay(99999, 88888, 100),
      cb.qtyInput(99999, 88888),
      cb.emailPay(99999, 88888, 100),
      cb.emailEdit(99999, 88888, 100),
      cb.order("AXV-20260903-ABCD1234"),
      cb.cancel("AXV-20260903-ABCD1234"),
      cb.refresh("AXV-20260903-ABCD1234"),
      cb.waInput("AXV-20260903-ABCD1234"),
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
  it("home keyboard places categories above View All Catalog and uses flag icons for Language", () => {
    const idEmpty = homeKeyboard("id");
    expect(idEmpty.inline_keyboard).toEqual([
      [{ text: "🛍 Lihat Semua Katalog", callback_data: "catalog:0", style: "success" }],
      [
        { text: "📦 Pesanan Saya", callback_data: "myorders", style: "primary" },
        { text: "💬 Bantuan", url: "https://axvara.tech/wa", style: "primary" },
      ],
      [
        { text: "🇮🇩 Bahasa", callback_data: "settings" },
        { text: "🌐 Web", url: "https://axvara.tech" },
      ],
    ]);

    const enEmpty = homeKeyboard("en");
    expect(enEmpty.inline_keyboard).toEqual([
      [{ text: "🛍 View All Catalog", callback_data: "catalog:0", style: "success" }],
      [
        { text: "📦 My Orders", callback_data: "myorders", style: "primary" },
        { text: "💬 Help", url: "https://axvara.tech/wa", style: "primary" },
      ],
      [
        { text: "🇬🇧 Language", callback_data: "settings" },
        { text: "🌐 Web", url: "https://axvara.tech" },
      ],
    ]);

    const cats = [
      { id: 1, name: "AI & Chatbot", slug: "ai-chatbot" },
      { id: 2, name: "Streaming & Hiburan", slug: "streaming-hiburan" },
      { id: 3, name: "Produktivitas & Office", slug: "produktivitas-office" },
      { id: 5, name: "Desain & Video", slug: "desain-video" },
      { id: 6, name: "Developer & Tools", slug: "developer-tools" },
    ];
    const idWithCats = homeKeyboard("id", cats);
    expect(idWithCats.inline_keyboard).toEqual([
      [
        { text: "⚡ AI & Chatbot", callback_data: "cat:1:0" },
        { text: "🎬 Streaming & Hiburan", callback_data: "cat:2:0" },
      ],
      [
        { text: "💼 Produktivitas & Office", callback_data: "cat:3:0" },
        { text: "🎨 Desain & Video", callback_data: "cat:5:0" },
      ],
      [{ text: "🛠️ Developer & Tools", callback_data: "cat:6:0" }],
      [{ text: "🛍 Lihat Semua Katalog", callback_data: "catalog:0", style: "success" }],
      [
        { text: "📦 Pesanan Saya", callback_data: "myorders", style: "primary" },
        { text: "💬 Bantuan", url: "https://axvara.tech/wa", style: "primary" },
      ],
      [
        { text: "🇮🇩 Bahasa", callback_data: "settings" },
        { text: "🌐 Web", url: "https://axvara.tech" },
      ],
    ]);

    const enWithCats = homeKeyboard("en", [
      ...cats,
      { id: 4, name: "Bundle Hemat", slug: "bundle-hemat" },
      { id: 7, name: "Extra Cat", slug: "extra-cat" },
    ]);
    // Capped at 6 categories (3 rows) + View All Catalog + 2 utility rows = 6 rows total.
    expect(enWithCats.inline_keyboard).toHaveLength(6);
    expect(enWithCats.inline_keyboard.slice(0, 3)).toEqual([
      [
        { text: "⚡ AI & Chatbot", callback_data: "cat:1:0" },
        { text: "🎬 Streaming & Entertainment", callback_data: "cat:2:0" },
      ],
      [
        { text: "💼 Productivity & Office", callback_data: "cat:3:0" },
        { text: "🎨 Design & Video", callback_data: "cat:5:0" },
      ],
      [
        { text: "🛠️ Developer & Tools", callback_data: "cat:6:0" },
        { text: "📦 Value Bundles", callback_data: "cat:4:0" },
      ],
    ]);
    expect(enWithCats.inline_keyboard[3]).toEqual([
      { text: "🛍 View All Catalog", callback_data: "catalog:0", style: "success" },
    ]);

    const snr = searchNoResultsKeyboard({ locale: "id" });
    const helpBtn = snr.inline_keyboard.flat().find((b) => b.text.includes("Bantuan"));
    expect(helpBtn).toEqual({ text: "💬 Bantuan", url: "https://axvara.tech/wa" });
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

    const enKb = categoriesKeyboard(
      [
        { id: 2, name: "Streaming & Hiburan", slug: "streaming-hiburan" },
        { id: 5, name: "Desain & Video", slug: "desain-video" },
      ],
      0,
      { locale: "en" },
    );
    expect(enKb.inline_keyboard[0]).toEqual([
      { text: "🎬 Streaming & Entertainment", callback_data: "cat:2:0" },
      { text: "🎨 Design & Video", callback_data: "cat:5:0" },
    ]);
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
    expect(allTexts.some(t => t.includes("ChatGPT") && t.includes("89.000"))).toBe(true);
    // Bottom row: [Kategori | Menu] only (no search/cart/orders)
    expect(kb.inline_keyboard.at(-1)).toEqual([
      { text: "📂 Kategori", callback_data: "cats:0" },
      { text: "🏠 Menu", callback_data: "home" },
    ]);
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
    expect(allTexts.some(t => t.includes("ChatGPT") && t.includes("89.000"))).toBe(true);
  });

  it("products keyboard has page indicator", () => {
    const products = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, name: `Product ${i}`, price: 50000,
    }));
    const kb = productsKeyboard(products, 1, 0);
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    expect(allTexts.some(t => t.includes("1/2"))).toBe(true); // page indicator
  });

  it("product detail CTA says what happens next", () => {
    expect(productDetailKeyboard(7).inline_keyboard[0][0]).toEqual({
      text: "Pilih Varian",
      callback_data: "buy:7",
    });
  });

  it("variant keyboard hides sold-out choices when available variants exist, omits restock alert button, and falls back to sold-out rows when all are out", () => {
    const kb = variantsKeyboard(7, [
      { id: 1, label: "Legal", price: 36500, stock: 0, duration_label: "28 Hari", warranty_label: "Garansi 25 Hari" },
      { id: 2, label: "Anti Limit", price: 26000, stock: 4, duration_label: "28 Hari", warranty_label: "Garansi 20 Hari" },
    ]);
    const buttons = kb.inline_keyboard.flat();
    expect(buttons[0].text).toBe("Anti Limit · 28 Hari · Rp26.000 · stok 4");
    expect(buttons[0].callback_data).toBe("var:2");
    expect(buttons.some((b) => b.callback_data === "soldout")).toBe(false);
    expect(buttons.some((b) => b.callback_data === "rst:7")).toBe(false);
    expect(buttons.some((b) => String(b.callback_data ?? "").startsWith("terms:"))).toBe(false);
    expect(buttons.some((b) => b.text.includes("Detail & Ketentuan"))).toBe(false);
    expect(kb.inline_keyboard.at(-1)).toEqual([
      { text: "🛍 Katalog", callback_data: "catalog:0" },
      { text: "🏠 Menu", callback_data: "home" },
    ]);
    expect(buttons.some((b) => b.callback_data === "cart")).toBe(false);

    // When ALL variants are sold out, show red ❌ rows without restock button.
    const allOut = variantsKeyboard(7, [
      { id: 1, label: "Legal", price: 36500, stock: 0, duration_label: "28 Hari", warranty_label: "Garansi 25 Hari" },
    ]);
    expect(allOut.inline_keyboard[0][0]).toMatchObject({ text: "❌ Legal · 28 Hari · Habis", callback_data: "soldout", style: "danger" });
    expect(allOut.inline_keyboard.flat().some((b) => b.callback_data === "rst:7")).toBe(false);
  });

  it("qty keyboard uses filtered presets without stepper, direct pay, or cart button", () => {
    const kb = qtyKeyboard({ productId: 1, variantId: 2, stock: 3, qty: 2, price: 5000 });
    const buttons = kb.inline_keyboard.flat();
    const texts = buttons.map(b => b.text);
    const datas = buttons.map(b => b.callback_data ?? "");
    expect(datas).toContain("q:1:2:1");
    expect(datas).not.toContain("q:1:2:5");
    expect(datas).toContain("qinput:1:2");
    expect(datas).toContain("prd:1");
    expect(datas).toContain("home");
    expect(datas.some(d => d.startsWith("pay:"))).toBe(false);
    expect(datas.some(d => d.startsWith("pmentry:"))).toBe(false);
    expect(datas.some(d => d.startsWith("cadd:"))).toBe(false);
    expect(texts).toContain("✍️ Jumlah lain");
    expect(texts).toContain("◀️ Kembali");
    expect(texts).not.toContain("➖");
    expect(texts).not.toContain("➕");
  });

  it("review keyboard exposes Lanjut Bayar (pmentry), Ubah Jumlah, Batalkan, and conditional Baca lengkap", () => {
    const kb = reviewKeyboard({ productId: 1, variantId: 2, qty: 3, approvalTag: "tag3", truncated: true });
    const buttons = kb.inline_keyboard.flat();
    expect(buttons.map(b => [b.text, b.callback_data, b.style])).toEqual([
      ["📋 Baca lengkap", "terms:1:2", "primary"],
      ["✅ Sudah dibaca — Lanjut Bayar", "pmentry:1:2:3:tag3", "success"],
      ["✍️ Ubah Jumlah", "qty:1:2", "primary"],
      ["✖️ Batalkan", "prd:1", "danger"],
    ]);
  });

  it("email confirmation offers pay, edit email, and edit quantity", () => {
    const kb = emailConfirmationKeyboard(1, 2, 3, 15000);
    const callbacks = kb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(callbacks).toContain("epay:1:2:3");
    expect(callbacks).toContain("eedit:1:2:3");
    expect(callbacks).toContain("qty:1:2");
  });

  it("QRIS invoice keyboard exposes manual Cek Pembayaran", () => {
    const kb = qrisInvoiceKeyboard("AXV-20260906-TEST1234");
    const buttons = kb.inline_keyboard.flat();
    const datas = buttons.map(b => b.callback_data ?? "");
    // Tombol cek manual memakai callback refresh:* yang sudah ada (ownerBound
    // + handleOrderRefresh idempoten) — pembeli tidak menunggu buta bila hook telat.
    expect(datas.some(d => d === "refresh:AXV-20260906-TEST1234")).toBe(true);
    expect(buttons).toContainEqual(expect.objectContaining({ text: "🔄 Cek Pembayaran", callback_data: "refresh:AXV-20260906-TEST1234", style: "primary" }));
    expect(datas.some(d => d.startsWith("cancel:"))).toBe(true);
    // Owner 2026-11-20: tiga tombol saja — [Cek Pembayaran | Bantuan] lalu [Batalkan], tanpa Detail Pesanan.
    expect(kb.inline_keyboard.map(row => row.map(b => b.text))).toEqual([["🔄 Cek Pembayaran", "💬 Bantuan"], ["Batalkan Pesanan"]]);
    expect(datas.some(d => d.startsWith("order:"))).toBe(false);
    const en = qrisInvoiceKeyboard("AXV-1", { locale: "en" });
    expect(en.inline_keyboard.map(row => row.map(b => b.text))).toEqual([["🔄 Check Payment", "💬 Help"], ["Cancel Order"]]);
  });

  it("paid-order keyboard has no looping WA button — reply-only, exposes both human support contacts", () => {
    const kb = orderPaidKeyboard("AXV-20260904-AB12CD34");
    const buttons = kb.inline_keyboard.flat();
    const datas = buttons.map((button) => button.callback_data ?? "");
    expect(datas.some((d) => d.startsWith("wainput:"))).toBe(false);
    expect(buttons.some((button) => button.text.includes("Masukkan Nomor WhatsApp"))).toBe(false);
    // 2026-10-10: tombol WA lewat hub /wa (pilih nomor aktif) — bukan wa.me langsung.
    expect(buttons.some((button) => button.url?.includes("/wa?pesan="))).toBe(true);
    expect(buttons.some((button) => button.url?.startsWith("https://wa.me/"))).toBe(false);
    expect(buttons.some((button) => button.text.includes("@axvara_support"))).toBe(true);
    expect(buttons.some((button) => button.url === "https://t.me/axvara_support")).toBe(true);
  });

  it("wainput callback still resolves safely for legacy buttons in old chats", () => {
    const route = readWebhook();
    expect(route).toContain('case "wainput"');
    expect(route).toContain("whatsAppInputPromptMessage");
  });

  it("routes /batal into pending email handling", () => {
    const route = readWebhook();
    expect(route).toContain('cmd === "/batal"');
    expect(route).toContain("handlePendingEmailInput");
  });
});

describe("Telegram buyer messages", () => {
  it("welcome message stays plain", () => {
    const msg = welcomeMessage("nad");
    expect(msg).not.toContain("━━━");
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
    expect(msg).toContain("Batas  : 19:00 WIB");
    expect(msg).toContain("━━━━━━━━━━━━━━━━");
    expect(msg).toContain("Lewat batas? Jangan bayar QR lama; hubungi admin untuk pemeriksaan manual.");
  });

  it("help message stays concise within 6 lines and keeps search, /garansi, and disclaimer", () => {
    const msg = helpMessage();
    expect(msg.split("\n").length).toBeLessThanOrEqual(6);
    expect(msg).toContain("Ketik nama produk untuk mencari");
    expect(msg).toContain("/garansi");
    expect(msg).toContain("pihak ketiga, bukan official");
    expect(msg).not.toContain("1️⃣");
    expect(msg).not.toContain("SeaBank");
    expect(msg).not.toContain("E-Wallet");
    expect(msg).not.toContain("wa.me/6289519388264");
  });

  it("product detail renders a short supplied description", () => {
    const msg = productDetailMessage({
      name: "Canva Pro",
      description: "KEUNGGULAN: Edit sesuka hati tanpa skill desain",
      price: 5000,
      stock: -1,
    });
    expect(msg).toContain("KEUNGGULAN");
    expect(msg).toContain("Edit sesuka hati");
    expect(msg).toContain("Canva Pro");
  });

  it("product detail renders exact minimal card shape with/without sold count and description, omitting variant lists/prices/warranty", () => {
    const full = productDetailMessage({
      name: "Canva Pro",
      sold_count: 412,
      description: "Akun desain siap pakai dengan akses penuh. Cocok untuk kerja tim. Kalimat ketiga tidak ikut.\n\n- Bullet panjang\nLink:\nhttps://example.test",
      price: 5000,
      compare_price: 50000,
      stock: -1,
      variants: [
        { label: "Pro Head 1 Bulan", price: 5000, warranty: "Full Garansi 1 Bulan", duration: "1 Bulan", stock: -1, delivery_badge: "⚡ Kirim otomatis" },
        { label: "Pro Invite 1 Bulan", price: 10000, warranty: "Garansi Terbatas 7 Hari", duration: "1 Bulan", stock: 0 },
      ],
    });
    expect(full).toBe(
      "<b>Canva Pro</b> · Terjual 412+\n" +
      "<blockquote>Akun desain siap pakai dengan akses penuh. Cocok untuk kerja tim.</blockquote>\n" +
      "Pilih varian 👇",
    );
    expect(full).not.toContain("Varian tersedia");
    expect(full).not.toContain("Harga");
    expect(full).not.toContain("Full Garansi");
    expect(full).not.toContain("Kirim otomatis");
    expect(full).not.toContain("Bullet panjang");
    expect(full).not.toContain("https://example.test");

    const minimal = productDetailMessage({ name: "Test Product", price: 50000, stock: 3 });
    expect(minimal).toBe("<b>Test Product</b>\nPilih varian 👇");
    expect(minimal).not.toContain("Terjual");
    expect(minimal).not.toContain("<blockquote>");

    const enCard = productDetailMessage({ name: "Test Product", sold_count: 15, description: "Instant creative suite." }, { locale: "en" });
    expect(enCard).toBe("<b>Test Product</b> · Sold 15+\n<blockquote>Instant creative suite.</blockquote>\nChoose a variant 👇");
  });

  it("product detail truncates long description at word boundary with ellipsis and matches photo/text fallback", () => {
    const longDesc = "Akun streaming berkualitas tinggi untuk menonton film dan serial favorit setiap hari tanpa iklan yang mengganggu pengalaman menonton di berbagai perangkat keluarga anda sepanjang waktu";
    const asPhoto = productDetailMessage({ name: "Prime Video", description: longDesc }, { hasImage: true });
    const asText = productDetailMessage({ name: "Prime Video", description: longDesc }, { hasImage: false });
    expect(asPhoto).toBe(asText);
    expect(asPhoto.length).toBeLessThanOrEqual(1024);
    const quoteMatch = asPhoto.match(/<blockquote>(.*?)<\/blockquote>/);
    expect(quoteMatch).toBeTruthy();
    const quoteText = quoteMatch![1];
    expect(quoteText.endsWith("…")).toBe(true);
    expect(quoteText.length).toBeLessThanOrEqual(180);
    expect(longDesc.startsWith(quoteText.slice(0, -1))).toBe(true);
    expect(longDesc[quoteText.length - 1]).toBe(" ");
  });

  it("confirm variant message leaves quantity selection to the next clear step", () => {
    const msg = confirmVariantBuyMessage({
      productName: "Canva Pro",
      variantLabel: "Pro Head 1 Bulan",
      price: 5000,
    });
    expect(msg).toContain("Harga satuan: Rp5.000");
    expect(msg).toContain("Canva Pro");
    expect(msg).not.toContain("Qty:");
    expect(msg).not.toContain("Total:");
  });

  it("qty message shows variant title, unit price, stock, and conditional min/tiers concisely", () => {
    const msg = chooseQtyMessage({
      productName: "Canva Pro",
      variantLabel: "Pro Head 1 Bulan",
      price: 5000,
      stock: -1,
      qty: 3,
      bulkEnabled: true,
      bulkTiers: [{ min_qty: 5, unit_price: 4500 }],
    });
    expect(msg).toContain("🛒 <b>Pilih jumlah</b>");
    expect(msg).toContain("Produk : <b>Canva Pro</b>");
    expect(msg).toContain("Varian : Pro Head 1 Bulan");
    expect(msg).toMatch(/Harga  : Rp\s?5\.000 \/ pcs/);
    expect(msg).toContain("Stok   : ∞");
    expect(msg).toContain("<blockquote>");
    expect(msg).not.toContain("Minimal pembelian");
    expect(msg).not.toContain("Maks ");
  });

  it("email confirmation masks buyer email", () => {
    const msg = emailConfirmationMessage({ productName: "Canva Pro", variantLabel: "Invite", qty: 3, total: 15000, maskedEmail: "n***a@gmail.com" });
    expect(msg).toContain("n***a@gmail.com");
    expect(msg).toContain("Jumlah: 3");
    expect(msg).toMatch(/Subtotal: Rp\s?15\.000/);
  });

  it("qty supports bulk up to 100 for unlimited and finite stock and review computes effective total", () => {
    const unlimited = qtyKeyboard({ productId: 1, variantId: 2, stock: -1, qty: 99, price: 5000 });
    const unlimitedDatas = unlimited.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(unlimitedDatas).toEqual(["q:1:2:1", "q:1:2:5", "q:1:2:10", "qinput:1:2", "prd:1", "home"]);

    const finite = qtyKeyboard({ productId: 1, variantId: 2, stock: 150, qty: 100, price: 5000, maxQty: 100 });
    const finiteDatas = finite.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(finiteDatas).toEqual(["q:1:2:1", "q:1:2:5", "q:1:2:10", "qinput:1:2", "prd:1", "home"]);

    const reviewMsg = reviewPurchaseMessage({
      productName: "Canva Pro",
      variantLabel: "Pro Head 1 Bulan",
      unitPrice: 5000,
      qty: 100,
    });
    expect(reviewMsg.text).toContain("🧾 <b>Baca sebelum bayar</b>");
    expect(reviewMsg.text).toMatch(/Jumlah 100 × Rp\s?5\.000 = <b>Rp\s?500\.000<\/b>/);
    expect(reviewMsg.truncated).toBe(false);
  });

  it("WA saved message confirms post-payment capture", () => {
    const msg = waSavedAfterPaymentMessage("AXV-20260906-TEST1234");
    expect(msg).toContain("AXV-20260906-TEST1234");
    expect(msg).toContain("tersimpan");
    expect(msg).toContain("Lunas.");
  });

  it("paid message confirms delivery in chat and never asks for a WhatsApp number (FX-16 owner decision)", () => {
    const msg = orderPaidMessage("AXV-20260904-AB12CD34", "Produk", "manual");
    expect(msg).toContain("Pembayaran lunas");
    expect(msg).toContain("Produk akan dikirim admin ke chat pribadi ini");
    expect(msg).not.toContain("cadangan");
    expect(msg).not.toContain("nomor WhatsApp aktif");
    expect(msg).not.toContain("Tetap standby");
    const auto = orderPaidMessage("AXV-20260904-AB12CD34", "Produk", "instant");
    expect(auto).toContain("dikirim otomatis ke chat ini");
    expect(auto).not.toContain("nomor WhatsApp aktif");
  });

  it("admin group notification identifies Telegram order creation", () => {
    const msg = adminTelegramOrderCreatedMessage({
      createdAt: "2026-10-24 00:37:00",
      orderCode: "AXV-20260906-TEST1234",
      productNames: "Canva Pro ×2",
      amount: 10200,
      customerName: "Nadia",
      telegramUser: "nadia",
      customerEmail: "nadia@email.com",
      paymentMethod: "qris",
    });
    expect(msg).toContain("Order Baru — Telegram");
    expect(msg).toContain("Canva Pro ×2");
    expect(msg).toContain("QRIS");
    expect(msg).toContain("Status pembayaran: MENUNGGU PEMBAYARAN");
    expect(msg).toContain("07.37 WIB");
    // 2026-10-10 (permintaan owner): email buyer wajib tampil di notif admin.
    expect(msg).toContain("nadia@email.com");
  });

  it("admin group notification shows buyer email or honest fallback (owner 2026-10-10)", () => {
    const withEmail = adminTelegramOrderCreatedMessage({
      orderCode: "AXV-1", productNames: "Invite", amount: 12000,
      customerName: "Hasan", telegramUser: "hasanrosidi",
      customerEmail: "bobysnow@gmail.com", paymentMethod: "qris",
    });
    expect(withEmail).toContain("bobysnow@gmail.com");
    const withoutEmail = adminTelegramOrderCreatedMessage({
      orderCode: "AXV-1", productNames: "Invite", amount: 12000,
      customerName: "Anon", telegramUser: "123", paymentMethod: "qris",
    });
    expect(withoutEmail).toContain("— tanpa email");
  });
});

describe("Telegram order and payment flow wiring", () => {
  it("offers only dynamic QRIS and never creates Telegram bank/e-wallet orders", () => {
    const route = readWebhook();
    expect(route).toMatch(/create(Dana|Active)QrisInvoice/);
    expect(route).not.toContain("createManualTransferOrder");
    expect(route).not.toContain("getActivePaymentMethods");
    expect(route).not.toContain("paymentMethodKeyboard");
  });

  it("clamps bulk qty to the Telegram 100/order cap", () => {
    const route = readWebhook();
    const keyboards = read("src/lib/telegram/keyboards.ts");
    expect(keyboards).toContain("TELEGRAM_MAX_QTY = 100");
    expect(route).toContain("TELEGRAM_MAX_QTY");
    expect(route).toContain("1–${TELEGRAM_MAX_QTY}");
  });

  it("hanya notif Lunas yang masuk grup admin — Order Baru Telegram dimatikan (owner 2026-10-10, paritas Web)", () => {
    const invoice = read("src/lib/telegram/handlers/invoice.ts");
    // Komentar penanda "tanpa notify" boleh menyebut nama fungsi; yang
    // dilarang = PEMANGGILAN aktual (await ...(...) / import ... from).
    expect(invoice).not.toMatch(/await notifyTelegramOrderCreated\(/);
    expect(invoice).not.toMatch(/import \{[^}]*notifyTelegramOrderCreated/);
    expect(fs.existsSync(path.join(process.cwd(), "src/lib/telegram/handlers/cart-invoice.ts"))).toBe(false);
    // Blok created di retryPendingTelegramNotifications = no-op: tidak ada
    // SELECT antrean "pending created" tanpa filter lunas.
    const notifications = read("src/lib/telegram/order-notifications.ts");
    const retryFn = notifications.slice(notifications.indexOf("export async function retryPendingTelegramNotifications"));
    expect(retryFn).not.toMatch(/notifyTelegramOrderCreated\(String\(order\.code\)/);
    expect(retryFn).not.toMatch(/notifyWhatsAppOrderCreated\(/);
  });

  it("pushes paid notification before checking the auto-fulfillment flag", () => {
    // deliver.ts kini barrel; ensureFulfillmentForPaidOrder pindah ke
    // delivery/ensure.ts (refactor 2026-09-09). Urutan push-paid sebelum
    // gate flag tetap diverifikasi pada implementasi sebenarnya.
    const delivery = read("src/lib/fulfillment/delivery/ensure.ts");
    const notifyIndex = delivery.indexOf("await notifyTelegramBuyerPaid(orderCode)");
    const autoFlagReturnIndex = delivery.indexOf("if (!autoFulfillmentEnabled) return false", notifyIndex);
    expect(notifyIndex).toBeGreaterThan(0);
    expect(autoFlagReturnIndex).toBeGreaterThan(notifyIndex);
  });

  it("announces paid Telegram orders to the admin group, not just order-created", () => {
    const notifications = read("src/lib/telegram/order-notifications.ts");
    expect(notifications).toContain("notifyTelegramPaidAdmin");
    expect(notifications).toContain("telegram_paid_admin_notified_at IS NULL");
  });

  it("follows every buyer paid push with an admin-group paid update", () => {
    const notifications = read("src/lib/telegram/order-notifications.ts");
    const notifyEnd = notifications.indexOf("await notifyTelegramPaidAdmin(orderCode, database);");
    const sendBuyer = notifications.indexOf("reply_markup: orderPaidKeyboard");
    expect(sendBuyer).toBeGreaterThan(0);
    expect(notifyEnd).toBeGreaterThan(sendBuyer);
  });

  it("uses durable, retryable markers for created, buyer-paid, and admin-paid Telegram notifications", () => {
    const schema = read("drizzle/schema.sql");
    const migration = read("drizzle/migrations/0012_telegram_order_notifications.sql");
    const paidAdminMigration = read("drizzle/migrations/0013_telegram_paid_admin_notification.sql");
    const notifications = read("src/lib/telegram/order-notifications.ts");
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(schema).toContain("telegram_order_notified_at TEXT");
    expect(schema).toContain("telegram_paid_notified_at TEXT");
    expect(schema).toContain("telegram_paid_admin_notified_at TEXT");
    expect(migration).toContain("telegram_order_notified_at");
    expect(migration).toContain("telegram_paid_notified_at");
    expect(paidAdminMigration).toContain("telegram_paid_admin_notified_at");
    expect(notifications).toContain("telegram_paid_notified_at IS NULL");
    expect(notifications).toContain("telegram_paid_admin_notified_at IS NULL");
    // 3C notify: retry call moved to phases/notify.ts; dispatch stays in route.
    expect(read("src/lib/cron/phases/notify.ts")).toContain("retryPendingTelegramNotifications");
    expect(cron).toContain("runNotifyPhase(ctx)");
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
    expect(msg).toContain("Total final");
  });

  it("product detail defers variant terms without duplicating warranty copy", () => {
    const msg = productDetailMessage({ name: "Test", price: 50000, stock: 5 });
    expect(msg).not.toContain("Garansi:");
    expect(msg).not.toContain("/garansi");
  });

  it("warranty terms disclose third-party, no 100% guarantee, DYOR", () => {
    const msg = warrantyTermsMessage();
    expect(msg).toContain("third-party store");
    expect(msg).toContain("tidak ada garansi 100% permanen");
    expect(msg).toContain("1×24 Jam s/d 30 Hari");
    expect(msg).toContain("DYOR");
    expect(msg).toContain("SETUJU");
  });

  it("warranty claims include processing time and conditional refund + per-product terms", () => {
    const msg = warrantyClaimMessage();
    expect(msg).toContain("solusi refund uang");
    expect(msg).not.toContain("BUKAN refund");
    expect(msg).toContain("sesuai deskripsi produk");
    expect(msg).toContain("HANGUS");
    expect(msg).toContain("Proses garansi 1–3 hari");
  });

  it("full warranty combines terms + claims", () => {
    const msg = warrantyFullMessage();
    expect(msg).toContain("WAJIB BACA");
    expect(msg).toContain("SYARAT KLAIM");
  });
});

describe("Telegram Fase 1: navigasi & marketing", () => {
  it("persistent reply menu exposes 2x2 catalog, orders, help, settings in ID and EN", () => {
    const menu = mainReplyMenu();
    expect(menu.keyboard.map((r) => r.map((b) => b.text))).toEqual([
      [MENU_LABEL_CATALOG, MENU_LABEL_ORDERS],
      [MENU_LABEL_HELP, MENU_LABEL_SETTINGS],
    ]);
    expect(menu.is_persistent).toBe(false);
    expect(menu.resize_keyboard).toBe(true);
    expect(menu.input_field_placeholder).toBe("Cari produk atau ketik nama produk…");

    const enMenu = mainReplyMenu("en");
    expect(enMenu.keyboard.map((r) => r.map((b) => b.text))).toEqual([
      [MENU_LABEL_EN.catalog, MENU_LABEL_EN.orders],
      [MENU_LABEL_EN.help, MENU_LABEL_EN.settings],
    ]);
  });

  it("webhook routes new and legacy reply-menu labels and commands", () => {
    const route = readWebhook();
    expect(route).toContain("MENU_LABEL_CATALOG");
    expect(route).toContain("MENU_LABEL_SEARCH");
    expect(route).toContain("MENU_LABEL_ORDERS");
    expect(route).toContain("MENU_LABEL_HELP");
    expect(route).toContain("MENU_LABEL_SETTINGS");
    expect(route).toContain('cmd === "/cari"');
    expect(route).toContain('cmd === "/orders"');
    expect(route).toContain('cmd === "/settings"');
    expect(route).toContain("handleSearchPrompt");
    expect(route).toContain("handleMyOrders");
    expect(route).toContain("handlePendingSearchInput");
  });

  it("registers simplified 5-command list in BotFather menu", () => {
    const api = read("src/lib/telegram/api.ts");
    for (const c of ["start", "katalog", "orders", "bantuan", "bahasa"]) {
      expect(api).toContain(`command: "${c}"`);
    }
    expect(api).not.toContain('command: "settings"');
    expect(api).not.toContain('command: "cari"');
    expect(api).not.toContain('command: "cart"');
    expect(api).not.toContain('command: "garansi"');
  });

  it("welcome landing shows bestsellers with sold counts", () => {
    const msg = welcomeMessage("nad", [
      { productId: 5, name: "Canva Pro 1 Tahun", price: 45000, soldCount: 412 },
      { productId: 1, name: "ChatGPT Plus 1 Bulan", price: 89000, soldCount: 342 },
    ]);
    expect(msg).toContain("Paling laris");
    expect(msg).toContain("Canva Pro 1 Tahun");
    expect(msg).toContain("Terjual 412+");
    expect(msg).toContain("Terjual 342+");
    expect(welcomeMessage("nad")).toContain("/katalog");
  });

  it("formats sold counts compactly at 1000+", () => {
    expect(formatSoldCountLabel(412)).toBe("Terjual 412+");
    expect(formatSoldCountLabel(1500)).toBe("Terjual 1.5rb+");
  });

  it("product detail shows Terjual social proof when sold_count present", () => {
    const msg = productDetailMessage({ name: "Canva Pro", price: 45000, stock: 60, sold_count: 412 });
    expect(msg).toContain("Terjual 412+");
    const clean = productDetailMessage({ name: "Canva Pro", price: 45000, stock: 60 });
    expect(clean).not.toContain("Terjual");
  });

  it("review message shows delivery line (automatic vs admin) while product detail omits delivery lines", () => {
    const card = productDetailMessage({
      name: "Express VPN",
      price: 5500,
      stock: 85,
      variants: [
        { label: "Premium", price: 5500, delivery_badge: "⏳ Made By Order" },
        { label: "Pro", price: 9000, delivery_badge: "⚡ Kirim otomatis" },
      ],
    });
    expect(card).not.toContain("Pengiriman");
    expect(card).not.toContain("Made By Order");
    expect(card).not.toContain("Kirim otomatis");

    const instant = reviewPurchaseMessage({
      productName: "Express VPN",
      variantLabel: "Pro",
      qty: 1,
      unitPrice: 9000,
      deliveryKind: "instant",
    });
    expect(instant.text).toContain("⚡ Kirim otomatis setelah bayar");

    const queued = reviewPurchaseMessage({
      productName: "Express VPN",
      variantLabel: "Premium",
      qty: 1,
      unitPrice: 5500,
      deliveryKind: "queued",
    });
    expect(queued.text).toContain("⏳ Diproses admin setelah bayar");
  });

  it("legacy breadcrumb helper remains available but buyer messages omit it", () => {
    expect(breadcrumbLine(1)).toContain("Langkah 1/4");
    expect(breadcrumbLine(4)).toContain("Langkah 4/4");
    expect(chooseVariantMessage("Canva Pro")).not.toContain("Langkah");
    expect(chooseQtyMessage({
      productName: "Canva Pro", variantLabel: "Pro Head", price: 5000, stock: -1, qty: 1,
    })).not.toContain("Langkah");
    expect(invoiceMessage({
      orderCode: "AXV-1", productName: "Canva Pro", payableAmount: 5000,
      expiresAt: "2026-09-07T00:00:00Z",
    })).not.toContain("Langkah");
    expect(confirmVariantBuyMessage({
      productName: "Canva Pro", variantLabel: "Pro Head", price: 5000,
    })).not.toContain("Langkah");
  });

  it("my-orders message and keyboard support detail + reorder", () => {
    const msg = myOrdersMessage([
      { code: "AXV-1", productName: "Canva Pro", payableAmount: 5000, paymentStatus: "paid", fulfillmentStatus: "delivered" },
    ]);
    expect(msg).toContain("Pesanan saya");
    expect(msg).toContain("AXV-1");
    const empty = myOrdersMessage([]);
    expect(empty).toContain("Belum ada pesanan");
    expect(empty).toContain("/katalog");
    const kb = myOrdersKeyboard([{ code: "AXV-1", productId: 5 }]);
    const datas = kb.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(datas.some((d) => d === "order:AXV-1")).toBe(true);
    expect(datas.some((d) => d === "reorder:5")).toBe(true);
  });

  it("search prompt, results, and keyboard guide discovery", () => {
    expect(searchPromptMessage()).toContain("Ketik nama produk");
    expect(searchResultsMessage("canva", 2)).toContain("Hasil untuk “canva”");
    expect(searchResultsMessage("zzz", 0)).toContain("Tidak ketemu");
    const kb = searchResultsKeyboard([{ id: 5, name: "Canva Pro", price: 45000 }]);
    const datas = kb.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(datas.some((d) => d === "prd:5")).toBe(true);
    expect(datas.some((d) => d === "search")).toBe(false);
    expect(kb.inline_keyboard.at(-1)).toEqual([
      { text: "🛍 Katalog", callback_data: "catalog:0" },
      { text: "🏠 Menu", callback_data: "home" },
    ]);
  });

  it("callback data stays within 64 bytes including new actions", () => {
    for (const d of [cb.reorder(99999), cb.search(), cb.myOrders()]) {
      expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
    }
  });
});

describe("Telegram single-item commerce + reminder (keranjang Telegram dihapus; keranjang hanya di web)", () => {
  it("removes all Telegram cart routes, handlers, files, and schema table", () => {
    const menu = mainReplyMenu();
    const labels = menu.keyboard.flat().map((b) => b.text);
    expect(labels.some((l) => /keranjang|cart/i.test(l))).toBe(false);
    const route = readWebhook();
    expect(route).not.toContain('cmd === "/cart"');
    expect(route).not.toContain("handleShowCart");
    expect(route).not.toContain("handleCartCheckout");
    expect(route).not.toContain("createAndSendCartInvoice");
    expect(route).not.toContain('"cconfirm"');
    expect(fs.existsSync(path.join(process.cwd(), "src/lib/telegram/cart.ts"))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), "src/lib/telegram/handlers/cart.ts"))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), "src/lib/telegram/handlers/cart-invoice.ts"))).toBe(false);
    // /start mengirim satu banner foto welcome + inline keyboard lalu memasang
    // reply keyboard via carrier senyap yang langsung dihapus agar tidak ada
    // pesan bubble sampah tersisa ("Menu Cepat", "—", dsb).
    expect(route).toContain("mainReplyMenu(locale)");
    expect(route).toContain("installReplyMenu");
    expect(route).toContain("deleteMessage");
    expect(route).not.toContain('"Menu Cepat"');
    const api = read("src/lib/telegram/api.ts");
    expect(api).toContain('command: "bahasa"');
    expect(settingsKeyboard("id").inline_keyboard.flat().map((b) => b.callback_data)).toEqual(
      ["lang:id", "lang:en", "home"],
    );
  });

  it("qty step omits direct pay and add-to-cart; review routes to pmentry", () => {
    const kb = qtyKeyboard({ productId: 1, variantId: 2, stock: -1, qty: 2, price: 5000, approvalTag: "tag1" });
    const datas = kb.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(datas).toEqual(["q:1:2:1", "q:1:2:5", "q:1:2:10", "qinput:1:2", "prd:1", "home"]);
    expect(datas.some((d) => d.startsWith("pay:"))).toBe(false);
    expect(datas.some((d) => d.startsWith("pmentry:"))).toBe(false);
    expect(datas.some((d) => d.startsWith("cadd:"))).toBe(false);

    const rev = reviewKeyboard({ productId: 1, variantId: 2, qty: 2, approvalTag: "tag1" });
    const revDatas = rev.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(revDatas).toEqual(["pmentry:1:2:2:tag1", "qty:1:2", "prd:1"]);
  });

  it("single-item checkout keeps one atomic order + one QRIS invoice", () => {
    const route = readWebhook();
    expect(route).toContain("createChannelOrderAtomic({");
    expect(route).toMatch(/create(Dana|Active)QrisInvoice\(orderCode, subtotal\)/);
    expect(route).toContain("variantSnapshot");
  });

  it("migration 0161 drops telegram_carts while keeping reminder markers from 0014", () => {
    const migration0014 = read("drizzle/migrations/0014_telegram_cart_reminders.sql");
    const migration0161 = read("drizzle/migrations/0161_drop_telegram_carts.sql");
    const schema = read("drizzle/schema.sql");
    expect(migration0014).toContain("telegram_reminder_count");
    expect(migration0161).toContain("DROP TABLE IF EXISTS telegram_carts");
    expect(schema).not.toContain("CREATE TABLE IF NOT EXISTS telegram_carts");
    expect(schema).toContain("telegram_reminder_count INTEGER NOT NULL DEFAULT 0");
  });

  it("both cron entry points use the shared reminder worker", () => {
    const lib = read("src/lib/telegram/order-notifications.ts");
    expect(lib).toContain("TELEGRAM_REMINDER_MAX = 2");
    // FX-1: lite passes the phase deadline budget (hasTime) into the worker.
    // 3A-3: notify bodies moved verbatim to jobs/notify.ts; route dispatches
    // via dynamic import. Guard both the moved call and the dispatch.
    const notifyJob = read("src/lib/cron/lite/jobs/notify.ts");
    expect(notifyJob).toContain("sendPendingOrderReminders(50, db, hasTime)");
    const route = read("src/app/api/cron/lite/route.ts");
    expect(route).toContain("@/lib/cron/lite/jobs/notify");
    // 3C notify: phase body moved to phases/notify.ts.
    const cron = read("src/lib/cron/phases/notify.ts");
    expect(cron).toContain("sendPendingOrderReminders");
    expect(cron).toContain("telegram_pending_reminders_sent");
  });

  it("reminder shows the countdown, exact amount, and WIB deadline", () => {
    const expiresMs = Date.parse("2026-11-20T07:05:00Z");
    expect(orderReminderMessage({ orderCode: "AXV-1", payableAmount: 5123, expiresMs, now: expiresMs - 300_000 })).toBe(
      "⏰ <b>5 menit lagi</b>\nKode  : <code>AXV-1</code>\nTotal : <code>Rp5.123</code>\nSelesaikan pembayaran sebelum 14:05 WIB.");
  });

  it("P0-1/3 keyboards stay within 64 bytes and expose expected navigation", () => {
    const maxSingle = cb.payMethodsEntry(9007199254740991, 9007199254740990, 100, "abcdef12");
    expect(new TextEncoder().encode(maxSingle).length).toBeLessThanOrEqual(64);
    expect(maxSingle).toBe("pmentry:9007199254740991:9007199254740990:100:abcdef12");

    const qtyKb = qtyKeyboard({ productId: 12, variantId: 34, stock: 10, qty: 2, price: 5000, approvalTag: "deadbeef" });
    const qtyCbs = qtyKb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(qtyCbs).toEqual(["q:12:34:1", "q:12:34:5", "q:12:34:10", "qinput:12:34", "prd:12", "home"]);

    const revKb = reviewKeyboard({ productId: 12, variantId: 34, qty: 2, approvalTag: "deadbeef" });
    expect(revKb.inline_keyboard.flat().map((b) => b.callback_data)).toContain("pmentry:12:34:2:deadbeef");

    const emailKb = emailConfirmationKeyboard(12, 34, 2, 10000, "deadbeef", "1234abcd");
    const emailCbs = emailKb.inline_keyboard.flat().map((b) => b.callback_data);
    expect(emailCbs).toContain("pmentry:12:34:2:deadbeef");

    const hKb = helpKeyboard({ locale: "id" });
    const hCbs = hKb.inline_keyboard.flat().map((b) => b.callback_data ?? b.url);
    expect(hCbs).toContain("catalog:0");
    expect(hCbs).toContain("myorders");
    expect(hCbs).toContain("home");
    expect(hCbs.some((v) => String(v).includes("/wa"))).toBe(true);
    expect(hCbs.some((v) => String(v).includes("t.me/axvara_support"))).toBe(true);

    const singleOffer = paymentMethodOfferKeyboard({
      nonce: "abcd1234",
      methods: [{ id: "qris", kind: "qris", label: "QRIS" }],
      source: { kind: "single", productId: 12, variantId: 34, qty: 2 },
    });
    expect(singleOffer.inline_keyboard.at(-2)?.map((b) => b.callback_data)).toEqual(["q:12:34:2", "prd:12"]);
    expect(singleOffer.inline_keyboard.at(-1)?.map((b) => b.callback_data)).toEqual(["home"]);

    const fallbackOffer = paymentMethodOfferKeyboard({
      nonce: "abcd1234",
      methods: [{ id: "qris", kind: "qris", label: "QRIS" }],
    });
    expect(fallbackOffer.inline_keyboard.at(-1)?.map((b) => b.callback_data)).toEqual(["catalog:0", "home"]);

    expect(orderStatusKeyboard("AXV-1").inline_keyboard.flat().map((b) => b.callback_data)).toContain("myorders");
    expect(paidOrderStatusKeyboard("AXV-1").inline_keyboard.flat().map((b) => b.callback_data)).toContain("myorders");
    expect(orderTerminalKeyboard().inline_keyboard.flat().map((b) => b.callback_data)).toContain("myorders");

    const perm = credentialResendOutcomeKeyboard("AXV-20991231-00F1701A", "permanent");
    expect(perm.inline_keyboard.flat().map((b) => b.callback_data)).not.toContain("cred:AXV-20991231-00F1701A");
    expect(perm.inline_keyboard.flat().map((b) => b.callback_data)).toContain("order:AXV-20991231-00F1701A");
    expect(perm.inline_keyboard.flat().map((b) => b.url).some((u) => u?.includes("/wa?pesan=Pesanan%20AXV-20991231-00F1701A"))).toBe(true);

    const trans = credentialResendOutcomeKeyboard("AXV-20991231-00F1701A", "transient");
    expect(trans.inline_keyboard.flat().map((b) => b.callback_data)).toContain("cred:AXV-20991231-00F1701A");
    expect(trans.inline_keyboard.flat().map((b) => b.callback_data)).toContain("order:AXV-20991231-00F1701A");
  });
});
