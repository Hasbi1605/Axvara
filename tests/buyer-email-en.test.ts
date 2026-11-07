// Buyer emails follow order.locale: subject + body + buttons EN, ID default.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { seedWrCatalog, seedWrOrder } from "./warung-rebahan/helpers";

type MailArgs = { to: string; subject: string; html: string; text: string };
const { sendForwardEmail } = vi.hoisted(() => ({
  sendForwardEmail: vi.fn(async (_params: MailArgs): Promise<{ ok: boolean; providerId?: string }> => ({ ok: true, providerId: "res_1" })),
}));
vi.mock("@/lib/warung-rebahan/forward-sender", () => ({ sendForwardEmail, isForwardEmailConfigured: () => true }));

import { notifyBuyerDeliveryFailed } from "@/lib/notify-buyer";
import { buildCredentialReadyTemplate, buildOrderReadyTemplate, renderBrandedNotice } from "@/lib/warung-rebahan/email-forward";

const CODE = "AXV-20261107-EMAILEN1";
let fx: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fx = createD1Fixture();
  stubFulfillmentKey();
  vi.clearAllMocks();
  sendForwardEmail.mockImplementation(async () => ({ ok: true, providerId: "res_1" }));
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function webOrder(locale = "en") {
  seedWrCatalog(fx);
  seedWrOrder(fx, CODE, "web");
  fx.sql.prepare("UPDATE orders SET customer_email=?, locale=? WHERE code=?").run("buyer@example.test", locale, CODE);
}

describe("template email pembeli EN/ID", () => {
  it("credential ready: subject + body EN, dan ID tetap default", () => {
    const base = { axvaraOrderCode: "AXV-1", buyerName: "Budi", productNames: "Netflix", details: "email: a\npassword: b", invoiceUrl: "https://axvara.tech/pesanan/AXV-1", supportWa: "628123" };
    const en = buildCredentialReadyTemplate({ ...base, locale: "en" });
    expect(en.subject).toContain("Account details for Netflix are ready");
    expect(en.text).toContain("Keep it safe and do NOT share it");
    expect(en.html).toContain("Account Details Ready");
    expect(en.html).toContain("Contact us on WhatsApp");
    expect(en.html).not.toMatch(/Detail Akun Siap|Simpan baik-baik|Butuh bantuan/);
    const id = buildCredentialReadyTemplate(base);
    expect(id.subject).toContain("Detail akun Netflix sudah siap");
    expect(id.html).toContain("Detail Akun Siap");
  });

  it("order ready: subject + receipt + CTA EN", () => {
    const base = { axvaraOrderCode: "AXV-1", buyerName: "Budi", invoiceUrl: "https://axvara.tech/pesanan/AXV-1", supportWa: "628123", items: [{ label: "Netflix", details: "email: a" }], receipt: { total: 25000, method: "QRIS", lines: ["Netflix"] } };
    const en = buildOrderReadyTemplate({ ...base, locale: "en" });
    expect(en.subject).toContain("Order ready, Netflix");
    expect(en.text).toContain("Payment received");
    expect(en.html).toContain("PAYMENT RECEIVED");
    expect(en.html).toContain("View Order →");
    expect(en.html).not.toMatch(/Pesanan Siap|PEMBAYARAN DITERIMA|Lihat Pesanan/);
    expect(buildOrderReadyTemplate(base).subject).toContain("Pesanan siap");
  });

  it("branded notice: footer/CTA EN dan ID default", () => {
    const ctx = { orderCode: "AXV-1", orderUrl: "https://axvara.tech/pesanan/AXV-1", supportWa: "628123", title: "Payment Received", subtitle: "Your order is being processed.", paragraphs: ["Thanks."] };
    const en = renderBrandedNotice({ ...ctx, locale: "en" });
    expect(en.html).toContain("Need help? Our team is ready:");
    expect(en.html).toContain("View Order →");
    expect(en.html).toContain("Automated email");
    const id = renderBrandedNotice({ ...ctx, title: "Pembayaran Diterima", subtitle: "Pesananmu sedang diproses.", paragraphs: ["Terima kasih."] });
    expect(id.html).toContain("Butuh bantuan? Tim kami siap membantu:");
    expect(id.html).toContain("Lihat Pesanan →");
  });
});

describe("kabar pembeli mengikuti order.locale", () => {
  it("delivery failed EN: subject + body English dikirim, bukan ID", async () => {
    webOrder("en");
    expect(await notifyBuyerDeliveryFailed(CODE, createDatabaseAccess(fx.db))).toBe(true);
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
    const mail = sendForwardEmail.mock.calls[0][0];
    expect(mail.subject).toBe(`Delivery for order ${CODE} has an issue`);
    expect(mail.html).toContain("Delivery Delayed");
    expect(mail.html).toContain("Your payment is safe and received.");
    expect(mail.html).not.toMatch(/Pengiriman Tertunda|Pembayaranmu aman/);
  });

  it("order ID tetap memakai bahasa Indonesia", async () => {
    webOrder("id");
    expect(await notifyBuyerDeliveryFailed(CODE, createDatabaseAccess(fx.db))).toBe(true);
    const mail = sendForwardEmail.mock.calls[0][0];
    expect(mail.subject).toBe(`Pengiriman pesanan ${CODE} bermasalah`);
    expect(mail.html).toContain("Pengiriman Tertunda");
  });
});
