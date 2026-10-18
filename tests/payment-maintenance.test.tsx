import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PlatformPageClient } from "@/app/pedia/p/[platform]/platform-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { renderToStaticMarkup } from "react-dom/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { isPaymentMaintenanceEnabled, PAYMENT_MANUAL_ORDER_URL } from "@/lib/payment-maintenance";
import { PaymentMaintenanceNotice, ManualOrderPanel } from "@/components/shared/PaymentMaintenanceNotice";
import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
import { createActiveQrisInvoice, createDanaQrisInvoice, createGopayQrisInvoice, reissueDanaQrisInvoice } from "@/lib/payments/dana-qris";

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => ({ ok: true })),
  wa: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: mocks.send,
  sendPhoto: vi.fn(), sendChatAction: vi.fn(), showLoadingBar: vi.fn(), safeEditOrSend: vi.fn(),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({ sendTextMessage: mocks.wa, sendImageMessage: vi.fn() }));
let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  fixture.control.limit = 0;
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "true");
  mocks.send.mockClear(); mocks.wa.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function expectNoDatabaseAccess() { expect(fixture.control.queries).toBe(0); }
function expectTelegramNotice() {
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
    chat_id: 123,
    text: expect.stringContaining("order manual lewat WhatsApp"),
    reply_markup: expect.objectContaining({ inline_keyboard: expect.arrayContaining([
      [{ text: "Order manual via WhatsApp", url: PAYMENT_MANUAL_ORDER_URL }],
    ]) }),
  }));
  expectNoDatabaseAccess();
}

describe("payment maintenance before financial side effects", () => {
  it.each(["web", "pedia", "renew"])("blocks %s API before parsing, reserving stock or debiting credit", async (channel) => {
    const request = new NextRequest("https://axvara.tech/api/orders", { method: "POST", body: "invalid JSON" });
    const response = channel === "web" ? await (await import("@/app/api/orders/route")).POST(request)
      : channel === "pedia" ? await (await import("@/app/api/pedia/orders/route")).POST(request)
      : await (await import("@/app/api/payments/qris/[code]/reissue/route")).POST(request, { params: Promise.resolve({ code: "AXV-20261018-AAAAAAA1" }) });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ reason: "payment_maintenance", manual_order_url: PAYMENT_MANUAL_ORDER_URL });
    expectNoDatabaseAccess();
  });

  it.each([createActiveQrisInvoice, createDanaQrisInvoice, createGopayQrisInvoice])("guards invoice entry point %s without touching the ledger", async (create) => {
    await expect(create("AXV-20261018-AAAAAAA1", 10000)).rejects.toThrow("payment_maintenance");
    expectNoDatabaseAccess();
  });
  it("guards direct renewal without changing the previous invoice", async () => {
    await expect(reissueDanaQrisInvoice("AXV-20261018-AAAAAAA1")).rejects.toThrow("payment_maintenance");
    expectNoDatabaseAccess();
  });
  it("redirects single-product Telegram payment before clearing state or reserving stock", async () => {
    const { handlePayWithQris } = await import("@/lib/telegram/handlers/invoice");
    await handlePayWithQris(123, 1, 60, 1, 1, { id: 123, first_name: "Test" });
    expectTelegramNotice();
  });
  it("redirects Telegram cart checkout before order creation or clearing the cart", async () => {
    const { createAndSendCartInvoice } = await import("@/lib/telegram/handlers/cart-invoice");
    await createAndSendCartInvoice(123, [], { id: 123, first_name: "Test" });
    expectTelegramNotice();
  });
  it("redirects Telegram renewal with a manual order button", async () => {
    const { handleQrisRenew } = await import("@/lib/telegram/handlers/orders");
    await handleQrisRenew(123, "AXV-20261018-AAAAAAA1");
    expectTelegramNotice();
  });
  it("shows the notice at Telegram start", async () => {
    const { handleCommand } = await import("@/lib/telegram/handlers/command");
    await handleCommand("/start", 123, "private", { id: 123, first_name: "Test" });
    expectTelegramNotice();
  });
  it("shows the notice from an old Telegram home button", async () => {
    const { handleCallback } = await import("@/lib/telegram/handlers/callback");
    await handleCallback("home", 123, 1, { id: 123, first_name: "Test" });
    expectTelegramNotice();
  });
  it("blocks WhatsApp bot payment before accessing the session", async () => {
    const { handlePay } = await import("@/lib/whatsapp/handlers/payment");
    await handlePay("group", "member", "inbox", "QRIS");
    expect(mocks.wa).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(PAYMENT_MANUAL_ORDER_URL) }));
    expectNoDatabaseAccess();
  });
  it("leaves normal handlers available when the build switch is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
    expect(isPaymentMaintenanceEnabled()).toBe(false);
    expect(await notifyPaymentMaintenance(123)).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    const { POST } = await import("@/app/api/orders/route");
    const response = await POST(new NextRequest("https://axvara.tech/api/orders", { method: "POST", body: "invalid JSON" }));
    expect(response.status).toBe(400);
  });
  it("does not continue checkout when Telegram cannot deliver the maintenance notice", async () => {
    mocks.send.mockResolvedValueOnce({ ok: false });
    const { handlePayWithQris } = await import("@/lib/telegram/handlers/invoice");
    await expect(handlePayWithQris(123, 1, 60, 1, 1, { id: 123, first_name: "Test" })).rejects.toThrow("temporarily unavailable");
    expectNoDatabaseAccess();
  });
  it("replaces a selected Pedia checkout with manual ordering while keeping its catalog", () => {
    const product: PediaCatalogProduct = {
      slug: "test-views", platform: "youtube", metric: "views", target_kind: "url", name: "YouTube Views",
      tagline: null, packages: [], step: 1, checklist: [], is_featured: 0, tiers: [], min_price: null, image: null,
    };
    const html = renderToStaticMarkup(<PlatformPageClient platform="youtube" name="YouTube" products={[product]} initialSlug={product.slug} ordersEnabled />);
    expect(html).toContain("Pembayaran sedang maintenance");
    expect(html).toContain("Jenis layanan YouTube");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
  });
  it("renders a plain notice and manual order CTA without a yellow status pill or payment form", () => {
    const html = renderToStaticMarkup(<><PaymentMaintenanceNotice /><ManualOrderPanel /></>);
    expect(html).toContain("Pembayaran sedang maintenance");
    expect(html).toContain("https://axvara.tech/wa?pesan=");
    expect(html).toContain("kode pesananmu");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("07.00");
    expect(html).not.toContain("FFB800");
  });
});
