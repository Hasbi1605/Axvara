// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  welcomeMessage, catalogFlatMessage, categoriesMessage, categoryProductsMessage,
  productDetailMessage, myOrdersMessage, searchPromptMessage, searchResultsMessage,
} from "@/lib/telegram/messages/catalog";
import {
  chooseQtyMessage, confirmVariantBuyMessage, confirmBuyMessage, chooseVariantMessage,
  emailConfirmationMessage, cartMessage, cartAddedMessage, cartCheckoutSummaryMessage,
  invoiceMessage, orderReminderMessage,
} from "@/lib/telegram/messages/purchase";
import {
  orderStatusMessage, orderPaidMessage, qrisRenewRejectedMessage,
  orderExpiredMessage, orderCancelledMessage, outOfStockMessage, errorMessage,
} from "@/lib/telegram/messages/status";
import { helpMessage } from "@/lib/telegram/messages/help";
import { credentialMessages } from "@/lib/telegram/messages/credential";
import { QRIS_PAYMENT_DEADLINE_NOTICE } from "@/lib/payment-maintenance";

const item = { productName: "Produk A", variantLabel: "Bulanan", price: 5000, qty: 2 };
const orderCode = "AXV-20261029-12345678";
const expiresAt = "2026-10-29T12:00:00Z";

function parsed(html: string, limit = 4096): Document {
  expect(html.length).toBeLessThanOrEqual(limit);
  expect(html).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  expect(html).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  expect(document.querySelectorAll("script, img, a")).toHaveLength(0);
  for (const tag of ["b", "code", "pre", "i", "s"]) {
    expect((html.match(new RegExp(`<${tag}>`, "g")) ?? []).length)
      .toBe((html.match(new RegExp(`</${tag}>`, "g")) ?? []).length);
  }
  return document;
}

describe("plain Indonesian Telegram buyer copy", () => {
  it("omits slogans, decoration, breadcrumbs and invented speed claims", () => {
    const messages = [
      welcomeMessage("Nadia"), catalogFlatMessage(12), categoriesMessage(), categoryProductsMessage("AI", 2),
      productDetailMessage({ name: "Produk A", price: 5000 }), searchPromptMessage(), searchResultsMessage("Produk", 4),
      myOrdersMessage([]), helpMessage(), chooseVariantMessage("Produk A"),
      confirmVariantBuyMessage(item), confirmBuyMessage("Produk A", 5000),
      chooseQtyMessage({ ...item, stock: 1, qty: 1 }),
      emailConfirmationMessage({ ...item, total: 10000, maskedEmail: "n***@example.test" }),
      cartMessage([]), cartMessage([item]), cartAddedMessage("Produk A", "Bulanan", 2, 1),
      cartCheckoutSummaryMessage([item], 10000),
      invoiceMessage({ orderCode, productName: "Produk A", payableAmount: 10123, expiresAt }),
      orderReminderMessage({ orderCode, productName: "Produk A", payableAmount: 10123, attempt: 1 }),
      orderPaidMessage(orderCode, "Produk A"), orderPaidMessage(orderCode, "Produk A", false, "instant"),
      orderExpiredMessage(orderCode), orderCancelledMessage(orderCode),
      outOfStockMessage(), errorMessage(), qrisRenewRejectedMessage("amount_unavailable"),
      ...credentialMessages({ plaintext: "account:password" }),
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/\p{Extended_Pictographic}|[━🧭]|Langkah \d|Gerbang semua|favoritmu|1 menit|jauh lebih hemat|SEKALI|SATU QRIS|👇|—/u);
      parsed(message);
    }
  });

  it("uses only a short supplied first paragraph, never infers product policy or stock", () => {
    const html = productDetailMessage({
      name: "Google Family", description: "Akses <produk> & panduan.\n\nParagraf panjang berikutnya.", price: 5000,
    });
    expect(html).toContain("Akses &lt;produk&gt; &amp; panduan.");
    expect(html).not.toContain("Paragraf panjang");
    expect(html).not.toMatch(/Stok|keluarga|12 bulan|garansi/i);
    const long = productDetailMessage({ name: "Produk", price: 5000, description: "x".repeat(1000) });
    expect(long.length).toBeLessThan(400);
    const bounded = productDetailMessage({
      name: '"'.repeat(100), description: '"'.repeat(1000), price: 5000, stock: 3,
      variants: Array.from({ length: 10 }, () => ({ label: '"'.repeat(100), delivery_badge: '<&>"'.repeat(100), price: 5000 })),
    });
    parsed(bounded);
    expect(bounded).toContain("Stok: 3");
  });

  it("uses the real quantity cap without claiming a single remaining item is unique", () => {
    const single = chooseQtyMessage({ ...item, stock: 1, qty: 1 });
    expect(single).toContain("Stok: 1");
    expect(single).toContain("Maksimal 1 per pesanan");
    expect(single).not.toMatch(/unik|bulk/i);
    const limited = chooseQtyMessage({ ...item, stock: 50, qty: 2, minQty: 2, maxQty: 4 });
    expect(limited).toContain("Minimal pembelian: 2");
    expect(limited).toContain("Maksimal 4 per pesanan");
    expect(limited).not.toContain("Maksimal 50");
    expect(limited).toContain("Subtotal: Rp10.000");
  });

  it("does not describe every email-based product as an invitation or subtotal as final payment", () => {
    const html = emailConfirmationMessage({ ...item, total: 10000, maskedEmail: "n***@example.test" });
    expect(html).toContain("Periksa email sebelum membayar.");
    expect(html).toContain("Subtotal: Rp10.000");
    expect(html).not.toMatch(/undangan|invite|Total bayar/i);
  });

  it("keeps all 20 item summaries after the former 100-character cut and separates payment from delivery", () => {
    const summaries = Array.from({ length: 20 }, (_, i) => `Produk ${i + 1} / Bulanan & akses x${i + 1}`);
    const html = orderStatusMessage({ orderCode, productName: summaries.join("\n"), paymentStatus: "paid", fulfillmentStatus: "queued", payableAmount: 10123 });
    const text = parsed(html).body.textContent ?? "";
    for (const summary of summaries) expect(text).toContain(summary);
    expect(text).toContain("Pembayaran: Lunas");
    expect(text).toContain("Pengiriman: Dalam antrean");
    expect(text).toContain("Total bayar: Rp10.123");
  });

  it("bounds escaped HTML without dropping item rows or splitting entities and Unicode", () => {
    const names = Array.from({ length: 20 }, (_, i) => `Item-${i + 1}: ` + '<&>"😀'.repeat(100) + ` x${i + 1}`);
    const status = orderStatusMessage({ orderCode, productName: names.join("\n"), paymentStatus: "paid", fulfillmentStatus: "delivered" });
    const text = parsed(status).body.textContent ?? "";
    for (let i = 1; i <= 20; i++) {
      expect(text).toContain(`Item-${i}:`);
      expect(text).toMatch(new RegExp(`Item-${i}:[^\\n]* x${i}(?:\\n|$)`));
    }
    const invoice = invoiceMessage({ orderCode, productName: names.join("\n"), payableAmount: 10123, expiresAt });
    const invoiceText = parsed(invoice, 1024).body.textContent ?? "";
    for (let i = 1; i <= 20; i++) {
      expect(invoiceText).toContain(`Item-${i}:`);
      expect(invoiceText).toMatch(new RegExp(`Item-${i}:[^\\n]* x${i}(?:\\n|$)`));
    }
    expect(invoiceText).toContain(QRIS_PAYMENT_DEADLINE_NOTICE);
  });

  it("keeps all invoice item summaries and the final amount, deadline and late-payment notice", () => {
    const summaries = Array.from({ length: 20 }, (_, i) => `P${i + 1} / A x1`);
    const html = invoiceMessage({ orderCode, productName: summaries.join("\n"), payableAmount: 10123, expiresAt });
    const text = parsed(html, 1024).body.textContent ?? "";
    for (const summary of summaries) expect(text).toContain(summary);
    expect(text).toContain("Total bayar: Rp10.123");
    expect(text).toContain("Batas bayar:");
    expect(text).toContain("29/10/2026");
    expect(text).toContain("19.00.00 WIB");
    expect(text).toContain(QRIS_PAYMENT_DEADLINE_NOTICE);
    expect(text).not.toContain("Subtotal");
  });

  it("shows paid fulfillment states in order history and accepts multi-item summaries", () => {
    const html = myOrdersMessage([
      { code: "AXV-1", productName: "Produk A x2\nProduk B x1", paymentStatus: "paid", fulfillmentStatus: "queued" },
      { code: "AXV-2", productName: "Produk C x1", paymentStatus: "paid", fulfillmentStatus: "delivered" },
      { code: "AXV-3", productName: "Produk D x1", paymentStatus: "pending", fulfillmentStatus: "reserved" },
    ]);
    const text = parsed(html).body.textContent ?? "";
    expect(text).toContain("Produk A x2\nProduk B x1");
    expect(text).toContain("Pengiriman: Dalam antrean");
    expect(text).toContain("Pengiriman: Terkirim");
    expect(text).toContain("Pembayaran: Menunggu pembayaran");
    expect(text.match(/Pengiriman:/g)).toHaveLength(2);
    parsed(myOrdersMessage(Array.from({ length: 10 }, (_, i) => ({
      code: `AXV-${i}`, productName: '<&>"😀'.repeat(500), paymentStatus: "paid", fulfillmentStatus: "queued", payableAmount: 10000,
    }))));
  });

  it("keeps all cart rows and variants instead of hiding everything after five items", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ ...item, productName: `Produk ${i + 1}`, variantLabel: `Varian ${i + 1}` }));
    for (const html of [cartMessage(items), cartCheckoutSummaryMessage(items, 200000)]) {
      const text = parsed(html).body.textContent ?? "";
      for (const line of items) expect(text).toContain(`${line.productName} / ${line.variantLabel} x2`);
      expect(text).toContain("Subtotal: Rp200.000");
    }
  });

  it("preserves the original search signature while reporting full and visible counts", () => {
    expect(searchResultsMessage("Produk", 26)).toContain("26 produk cocok");
    expect(searchResultsMessage("Produk", 0, 3)).toContain("sedang habis");
    expect(searchResultsMessage("Produk", 26, 3, 8)).toContain("26 produk cocok. Menampilkan 8 produk.");
    expect(searchResultsMessage("<b>&", 1, 0, 1)).toContain("&lt;b&gt;&amp;");
  });
});
