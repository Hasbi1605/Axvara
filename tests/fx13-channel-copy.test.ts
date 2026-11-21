import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(async (_payload?: unknown) => ({ ok: true })) }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: mocks.send,
  sendPhoto: vi.fn(),
  sendChatAction: vi.fn(),
  showLoadingBar: vi.fn(),
  safeEditOrSend: vi.fn(),
}));

import { isValidContactPhone } from "@/lib/telegram/handlers/payment-contact";
import { isValidWaNumber } from "@/lib/order-contact";
import { orderPaidMessage } from "@/lib/telegram/messages/status";
import { WR_QUEUED_MAX_HOURS } from "@/lib/warung-rebahan/delivery-class";
import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
import { PAYMENT_MANUAL_ORDER_URL } from "@/lib/payment-maintenance";

describe("FX-13 X4-3 — Telegram phone validator shares the web rule", () => {
  it("rejects numbers the web checkout rejects", () => {
    expect(isValidWaNumber("12345678")).toBe(false);
    expect(isValidContactPhone("12345678")).toBe(false);
    expect(isValidContactPhone("12345678901234567890")).toBe(false);
  });

  it("accepts web-format WhatsApp numbers", () => {
    for (const ok of ["081234567890", "+6281234567890", "6281234567890", "0812-3456-7890"]) {
      expect(isValidWaNumber(ok)).toBe(true);
      expect(isValidContactPhone(ok)).toBe(true);
    }
  });
});

describe("FX-13 X4-5 — paid message uses the shared manual-wait ETA", () => {
  it("manual delivery cites the canonical queue ceiling", () => {
    const id = orderPaidMessage("AXV-20260101-ABCDEF12", "Produk", false, "manual");
    expect(id).toContain(`maksimal ${WR_QUEUED_MAX_HOURS} jam`);
    expect(id).toContain("umumnya kurang dari 1 jam");
    const en = orderPaidMessage("AXV-20260101-ABCDEF12", "Produk", false, "manual", { locale: "en" });
    expect(en).toContain(`up to ${WR_QUEUED_MAX_HOURS} hours`);
  });

  it("queued delivery cites the same ceiling", () => {
    const id = orderPaidMessage("AXV-20260101-ABCDEF12", "Produk", false, "queued");
    expect(id).toContain(`${WR_QUEUED_MAX_HOURS} jam`);
  });
});

describe("FX-13 X4-8 — maintenance notice points to admin contact in ID+EN", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "true");
    mocks.send.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("offers a bilingual admin-contact CTA, not 'order manual via WhatsApp'", async () => {
    expect(await notifyPaymentMaintenance(123)).toBe(true);
    const payload = mocks.send.mock.calls[0]?.[0] as { text: string; reply_markup: unknown };
    expect(payload.text).toContain("hubungi admin");
    expect(payload.text).toContain("the admin for help");
    expect(payload.text).toContain("website or Telegram bot");
    expect(payload.text).not.toMatch(/manual order/i);
    expect(payload.text).not.toContain("order manual lewat WhatsApp");
    const kb = JSON.stringify(payload.reply_markup);
    expect(kb).toContain(PAYMENT_MANUAL_ORDER_URL);
    expect(kb).not.toContain("Order manual via WhatsApp");
  });
});
