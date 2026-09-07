// tests/telegram-bot.regression.test.ts — Telegram bot contract tests
import { describe, it, expect } from "vitest";
import {
  escapeHtml, welcomeMessage, formatWIBTime, catalogFlatMessage,
  productDetailMessage, invoiceMessage, helpMessage, deliveryMessage,
  warrantyTermsMessage, warrantyClaimMessage, warrantyFullMessage,
  confirmBuyMessage, confirmVariantBuyMessage, chooseVariantMessage, chooseQtyMessage,
  orderPaidMessage, waSavedAfterPaymentMessage,
  adminTelegramOrderCreatedMessage, myOrdersMessage, searchPromptMessage,
  searchResultsMessage, breadcrumbLine, formatSoldCountLabel,
  cartMessage, cartAddedMessage, cartCheckoutSummaryMessage, orderReminderMessage,
} from "@/lib/telegram/messages";
import {
  cb, parseCallback, homeKeyboard, warrantyKeyboard, categoriesKeyboard,
  productsKeyboard, catalogFlatKeyboard, qtyKeyboard, qrisInvoiceKeyboard,
  orderPaidKeyboard, mainReplyMenu, myOrdersKeyboard, searchResultsKeyboard,
  cartKeyboard,
  MENU_LABEL_CATALOG, MENU_LABEL_SEARCH, MENU_LABEL_ORDERS, MENU_LABEL_HELP,
  MENU_LABEL_CART,
} from "@/lib/telegram/keyboards";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

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

  it("flat catalog message shows count without repeated greeting/date/time", () => {
    const msg = catalogFlatMessage(5);
    expect(msg).toContain("Katalog AXVARA");
    expect(msg).toContain("5 produk tersedia");
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
  it("home keyboard has katalog, keranjang, pesanan, cari, garansi, bantuan", () => {
    const kb = homeKeyboard();
    const allTexts = kb.inline_keyboard.flat().map(b => b.text);
    const allData = kb.inline_keyboard.flat().map(b => b.callback_data ?? "");
    expect(allTexts.some(t => t.includes("Katalog"))).toBe(true);
    expect(allTexts.some(t => t.includes("Bantuan"))).toBe(true);
    expect(allTexts.some(t => t.includes("Pesanan"))).toBe(true);
    expect(allTexts.some(t => t.includes("Garansi"))).toBe(true);
    expect(allTexts.some(t => t.includes("Keranjang"))).toBe(true);
    expect(allTexts.some(t => t.includes("Cari"))).toBe(true);
    expect(allData).toContain("cart");
    expect(allData).toContain("search");
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

  it("qty keyboard uses one clear stepper and a direct QRIS CTA", () => {
    const kb = qtyKeyboard({ productId: 1, variantId: 2, stock: 3, qty: 2, price: 5000 });
    const buttons = kb.inline_keyboard.flat();
    const texts = buttons.map(b => b.text);
    const datas = buttons.map(b => b.callback_data ?? "");
    expect(datas.some(d => d === "q:1:2:1")).toBe(true);
    expect(datas.some(d => d === "q:1:2:3")).toBe(true);
    expect(datas.some(d => d === "pay:1:2:2")).toBe(true);
    expect(texts).toContain("2 item");
    expect(texts.some(t => t.includes("Bayar QRIS") && t.includes("10.000"))).toBe(true);
    expect(texts.some(t => t.includes("1️⃣") || t.includes("2️⃣") || t.includes("3️⃣"))).toBe(false);
  });

  it("QRIS invoice keyboard has no manual status-check requirement", () => {
    const kb = qrisInvoiceKeyboard("AXV-20260906-TEST1234");
    const buttons = kb.inline_keyboard.flat();
    const datas = buttons.map(b => b.callback_data ?? "");
    expect(datas.some(d => d.startsWith("refresh:"))).toBe(false);
    expect(datas.some(d => d.startsWith("cancel:"))).toBe(true);
  });

  it("paid-order keyboard has no looping WA button — reply-only, exposes both human support contacts", () => {
    const kb = orderPaidKeyboard("AXV-20260904-AB12CD34");
    const buttons = kb.inline_keyboard.flat();
    const datas = buttons.map((button) => button.callback_data ?? "");
    expect(datas.some((d) => d.startsWith("wainput:"))).toBe(false);
    expect(buttons.some((button) => button.text.includes("Masukkan Nomor WhatsApp"))).toBe(false);
    expect(buttons.some((button) => button.url?.startsWith("https://wa.me/6289519388264"))).toBe(true);
    expect(buttons.some((button) => button.text.includes("@axvara_support"))).toBe(true);
    expect(buttons.some((button) => button.url === "https://t.me/axvara_support")).toBe(true);
  });

  it("wainput callback still resolves safely for legacy buttons in old chats", () => {
    const route = read("src/app/api/telegram/webhook/route.ts");
    expect(route).toContain('case "wainput"');
    expect(route).toContain("whatsAppInputPromptMessage");
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
    expect(msg).toContain("otomatis mengabari");
    expect(msg).not.toContain("Tekan 🔄");
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
    expect(msg).toContain("QRIS dinamis");
    expect(msg).not.toContain("SeaBank");
    expect(msg).not.toContain("E-Wallet");
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

  it("confirm variant message leaves quantity selection to the next clear step", () => {
    const msg = confirmVariantBuyMessage({
      productName: "Canva Pro",
      variantLabel: "Pro Head 1 Bulan",
      price: 5000,
    });
    expect(msg).toContain("Harga satuan: Rp5.000");
    expect(msg).toContain("mengatur jumlah pesanan");
    expect(msg).not.toContain("Qty:");
    expect(msg).not.toContain("Total:");
  });

  it("qty message keeps the chosen quantity and total visible", () => {
    const msg = chooseQtyMessage({
      productName: "Canva Pro",
      variantLabel: "Pro Head 1 Bulan",
      price: 5000,
      stock: -1,
      qty: 3,
    });
    expect(msg).toContain("Jumlah dipilih: 3");
    expect(msg).toContain("Total: Rp15.000");
    expect(msg).toContain("1–100");
  });

  it("qty supports bulk up to 100 for unlimited and finite stock", () => {
    const unlimited = qtyKeyboard({ productId: 1, variantId: 2, stock: -1, qty: 99, price: 5000 });
    const unlimitedDatas = unlimited.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(unlimitedDatas.some((d) => d === "pay:1:2:99")).toBe(true);
    expect(unlimitedDatas.some((d) => d === "q:1:2:100")).toBe(true);

    const finite = qtyKeyboard({ productId: 1, variantId: 2, stock: 150, qty: 100, price: 5000 });
    const finiteDatas = finite.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(finiteDatas.some((d) => d === "pay:1:2:100")).toBe(true);

    const finiteMsg = chooseQtyMessage({
      productName: "Canva Pro",
      variantLabel: "Pro Head 1 Bulan",
      price: 5000,
      stock: 150,
      qty: 100,
      maxQty: 100,
    });
    expect(finiteMsg).toContain("maksimal 100 per order");
    expect(finiteMsg).toContain("1–100");
  });

  it("WA saved message confirms post-payment capture", () => {
    const msg = waSavedAfterPaymentMessage("AXV-20260906-TEST1234");
    expect(msg).toContain("AXV-20260906-TEST1234");
    expect(msg).toContain("Tersimpan");
    expect(msg).toContain("Pembayaran sudah lunas");
  });

  it("delivery message has tap-to-copy hint", () => {
    const msg = deliveryMessage("acc@email.com:pass123");
    expect(msg).toContain("<code>");
    expect(msg).toContain("Tap untuk copy");
  });

  it("paid message confirms automatic detection, then asks WA only for manual delivery", () => {
    const msg = orderPaidMessage("AXV-20260904-AB12CD34", "Produk", true);
    expect(msg).toContain("Dana sudah diterima dan terverifikasi otomatis");
    expect(msg).toContain("nomor WhatsApp aktif");
    expect(msg).toContain("@axvara_support");
    expect(msg).toContain("wa.me/6289519388264");
  });

  it("admin group notification identifies Telegram order creation", () => {
    const msg = adminTelegramOrderCreatedMessage({
      orderCode: "AXV-20260906-TEST1234",
      productNames: "Canva Pro ×2",
      amount: 10200,
      customerName: "Nadia",
      telegramUser: "nadia",
      paymentMethod: "qris",
    });
    expect(msg).toContain("Order Baru — Telegram");
    expect(msg).toContain("Canva Pro ×2");
    expect(msg).toContain("QRIS");
  });
});

describe("Telegram order and payment flow wiring", () => {
  it("offers only dynamic QRIS and never creates Telegram bank/e-wallet orders", () => {
    const route = read("src/app/api/telegram/webhook/route.ts");
    expect(route).toContain("createDanaQrisInvoice");
    expect(route).not.toContain("createManualTransferOrder");
    expect(route).not.toContain("getActivePaymentMethods");
    expect(route).not.toContain("paymentMethodKeyboard");
  });

  it("clamps bulk qty to the Telegram 100/order cap", () => {
    const route = read("src/app/api/telegram/webhook/route.ts");
    const keyboards = read("src/lib/telegram/keyboards.ts");
    expect(keyboards).toContain("TELEGRAM_MAX_QTY = 100");
    expect(route).toContain("TELEGRAM_MAX_QTY");
    expect(route).toContain("1–${TELEGRAM_MAX_QTY}");
  });

  it("notifies the admin group when a Telegram order is created", () => {
    const route = read("src/app/api/telegram/webhook/route.ts");
    expect(route).toContain("notifyTelegramOrderCreated(orderCode)");
  });

  it("pushes paid notification before checking the auto-fulfillment flag", () => {
    const delivery = read("src/lib/fulfillment/deliver.ts");
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
    const notifyEnd = notifications.indexOf("await notifyTelegramPaidAdmin(orderCode);");
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
    expect(cron).toContain("retryPendingTelegramNotifications");
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

describe("Telegram Fase 1: navigasi & marketing", () => {
  it("persistent reply menu exposes catalog, search, orders, help", () => {
    const menu = mainReplyMenu();
    const labels = menu.keyboard.flat().map((b) => b.text);
    expect(labels).toContain(MENU_LABEL_CATALOG);
    expect(labels).toContain(MENU_LABEL_SEARCH);
    expect(labels).toContain(MENU_LABEL_ORDERS);
    expect(labels).toContain(MENU_LABEL_HELP);
    expect(menu.is_persistent).toBe(true);
    expect(menu.resize_keyboard).toBe(true);
  });

  it("webhook routes reply-menu labels and new commands", () => {
    const route = read("src/app/api/telegram/webhook/route.ts");
    expect(route).toContain("MENU_LABEL_CATALOG");
    expect(route).toContain("MENU_LABEL_SEARCH");
    expect(route).toContain("MENU_LABEL_ORDERS");
    expect(route).toContain("MENU_LABEL_HELP");
    expect(route).toContain('cmd === "/cari"');
    expect(route).toContain('cmd === "/orders"');
    expect(route).toContain("handleSearchPrompt");
    expect(route).toContain("handleMyOrders");
    expect(route).toContain("handlePendingSearchInput");
  });

  it("registers new slash commands in BotFather menu", () => {
    const api = read("src/lib/telegram/api.ts");
    expect(api).toContain('command: "cari"');
    expect(api).toContain('command: "orders"');
  });

  it("welcome landing shows bestsellers with sold counts", () => {
    const msg = welcomeMessage("nad", [
      { productId: 5, name: "Canva Pro 1 Tahun", price: 45000, soldCount: 412 },
      { productId: 1, name: "ChatGPT Plus 1 Bulan", price: 89000, soldCount: 342 },
    ]);
    expect(msg).toContain("Paling Laris");
    expect(msg).toContain("Canva Pro 1 Tahun");
    expect(msg).toContain("Terjual 412+");
    expect(msg).toContain("Terjual 342+");
    // Backward compat: no bestsellers still renders a CTA
    expect(welcomeMessage("nad")).toContain("Pilih menu di bawah");
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

  it("purchase flow shows breadcrumb Langkah X/4", () => {
    expect(breadcrumbLine(1)).toContain("Langkah 1/4");
    expect(breadcrumbLine(4)).toContain("Langkah 4/4");
    expect(chooseVariantMessage("Canva Pro")).toContain("Langkah 2/4");
    expect(chooseQtyMessage({
      productName: "Canva Pro", variantLabel: "Pro Head", price: 5000, stock: -1, qty: 1,
    })).toContain("Langkah 3/4");
    expect(invoiceMessage({
      orderCode: "AXV-1", productName: "Canva Pro", payableAmount: 5000,
      expiresAt: "2026-09-07T00:00:00Z",
    })).toContain("Langkah 4/4");
    expect(confirmVariantBuyMessage({
      productName: "Canva Pro", variantLabel: "Pro Head", price: 5000,
    })).toContain("Langkah 2/4");
  });

  it("my-orders message and keyboard support detail + reorder", () => {
    const msg = myOrdersMessage([
      { code: "AXV-1", productName: "Canva Pro", payableAmount: 5000, paymentStatus: "paid", fulfillmentStatus: "delivered" },
    ]);
    expect(msg).toContain("Pesanan Saya");
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
    expect(searchResultsMessage("canva", 2)).toContain("2 produk cocok");
    expect(searchResultsMessage("zzz", 0)).toContain("Tidak ada produk yang cocok");
    const kb = searchResultsKeyboard([{ id: 5, name: "Canva Pro", price: 45000 }]);
    const datas = kb.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(datas.some((d) => d === "prd:5")).toBe(true);
    expect(datas.some((d) => d === "search")).toBe(true);
  });

  it("callback data stays within 64 bytes including new actions", () => {
    for (const d of [cb.reorder(99999), cb.search(), cb.myOrders()]) {
      expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
    }
  });
});

describe("Telegram Fase 2: cart + reminder (tanpa review/promo)", () => {
  it("persistent menu includes cart label routed by webhook", () => {
    const menu = mainReplyMenu();
    const labels = menu.keyboard.flat().map((b) => b.text);
    expect(labels).toContain(MENU_LABEL_CART);
    const route = read("src/app/api/telegram/webhook/route.ts");
    expect(route).toContain("MENU_LABEL_CART");
    expect(route).toContain('cmd === "/cart"');
    expect(route).toContain("handleShowCart");
    expect(route).toContain("handleCartCheckout");
    expect(route).toContain("createAndSendCartInvoice");
    expect(route).toContain('"cconfirm"');
    // /start WAJIB mengirim reply keyboard tetap — tanpanya tombol bawah
    // tidak pernah muncul di Telegram user (bug: menu hanya didefinisikan).
    expect(route).toContain("mainReplyMenu()");
    expect(route).toContain("Menu Cepat");
    const api = read("src/lib/telegram/api.ts");
    expect(api).toContain('command: "cart"');
  });

  it("qty step offers add-to-cart alongside direct QRIS checkout", () => {
    const kb = qtyKeyboard({ productId: 1, variantId: 2, stock: -1, qty: 2, price: 5000 });
    const datas = kb.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(datas.some((d) => d === "pay:1:2:2")).toBe(true);
    expect(datas.some((d) => d === "cadd:1:2:2")).toBe(true);
  });

  it("cart keyboard exposes adjust, remove, checkout, and clear", () => {
    const kb = cartKeyboard({
      lines: [
        { variantId: 11, qty: 2, stock: -1, fulfillmentMode: "manual" },
        { variantId: 22, qty: 1, stock: 5, fulfillmentMode: "shared" },
      ],
    });
    const datas = kb.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(datas).toContain("cdec:11");
    expect(datas).toContain("cinc:11");
    expect(datas).toContain("crm:22");
    expect(datas).toContain("ccheckout");
    expect(datas).toContain("cclear");
    const empty = cartKeyboard({ lines: [] });
    const emptyDatas = empty.inline_keyboard.flat().map((b) => b.callback_data ?? "");
    expect(emptyDatas).not.toContain("ccheckout");
  });

  it("cart messages render lines, subtotal, and single-QRIS promise", () => {
    const lines = [
      { productName: "Canva Pro", variantLabel: "Pro Head 1 Bulan", price: 5000, qty: 2 },
      { productName: "ChatGPT Plus", variantLabel: "1 Bulan", price: 89000, qty: 1 },
    ];
    const msg = cartMessage(lines);
    expect(msg).toContain("Keranjang Kamu");
    expect(msg).toContain("Canva Pro");
    expect(msg).toContain("Total: Rp99.000");
    expect(msg).toContain("SATU QRIS");
    expect(cartMessage([])).toContain("Keranjang Kosong");
    const added = cartAddedMessage("Canva Pro", "Pro Head 1 Bulan", 2, 3);
    expect(added).toContain("Masuk Keranjang");
    const summary = cartCheckoutSummaryMessage(lines, 99000);
    expect(summary).toContain("Satu QRIS untuk semua item");
    expect(summary).toContain("Langkah 4/4");
  });

  it("cart checkout keeps one order + one QRIS invoice + per-mode fulfillment job", () => {
    const route = read("src/app/api/telegram/webhook/route.ts");
    expect(route).toContain("INSERT INTO orders (code, customer_name");
    expect(route).toContain("createDanaQrisInvoice(orderCode, subtotal)");
    expect(route).toContain("clearCart(String(from.id))");
    expect(route).toContain("variant_snapshot");
    // Satu job per order (UNIQUE order_code): mode dominan, bukan per item.
    expect(route).toContain("cartFulfillmentMode");
    expect(route).not.toContain("for (const line of lines) {\n      const hasInventory");
  });

  it("cart lib guards unique-conflict, caps, and stale rows", () => {
    const lib = read("src/lib/telegram/cart.ts");
    const migration = read("drizzle/migrations/0014_telegram_cart_reminders.sql");
    expect(lib).toContain("unique_conflict");
    expect(migration).toContain("UNIQUE(user_id, variant_id)");
    expect(lib).toContain("MAX_LINES = 20");
    expect(lib).toContain("DELETE FROM telegram_carts WHERE user_id=? AND variant_id=?");
  });

  it("migration 0014 creates cart table + reminder markers", () => {
    const migration = read("drizzle/migrations/0014_telegram_cart_reminders.sql");
    const schema = read("drizzle/schema.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS telegram_carts");
    expect(migration).toContain("telegram_reminder_count");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS telegram_carts");
    expect(schema).toContain("telegram_reminder_count INTEGER NOT NULL DEFAULT 0");
  });

  it("reminder is capped at 2x with 60-minute interval and active-invoice guard", () => {
    const lib = read("src/lib/telegram/order-notifications.ts");
    expect(lib).toContain("TELEGRAM_REMINDER_MAX = 2");
    expect(lib).toContain("TELEGRAM_REMINDER_INTERVAL_MINUTES = 60");
    expect(lib).toContain("telegram_reminder_count < ?");
    expect(lib).toContain("datetime(pt.expires_at)>datetime('now')");
    expect(lib).toContain("payment_status IN ('unpaid','pending')");
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(cron).toContain("sendPendingOrderReminders");
    expect(cron).toContain("telegram_pending_reminders_sent");
  });

  it("reminder copy escalates on second attempt and reassures paid buyers", () => {
    const first = orderReminderMessage({ orderCode: "AXV-1", productName: "Canva", payableAmount: 5123, attempt: 1 });
    expect(first).toContain("Menunggu Pembayaran");
    expect(first).toContain("AXV-1");
    expect(first).toContain("5.123");
    const second = orderReminderMessage({ orderCode: "AXV-1", productName: "Canva", payableAmount: 5123, attempt: 2 });
    expect(second).toContain("Pengingat Terakhir");
    expect(second).toContain("Abaikan pesan ini jika sudah bayar");
  });

  it("cart callback data stays within 64 bytes", () => {
    for (const d of [cb.cartAdd(99999, 88888, 100), cb.cartDec(88888), cb.cartInc(88888), cb.cartRemove(88888), cb.cartCheckout(), cb.cartClear(), cb.cart()]) {
      expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
    }
  });
});
