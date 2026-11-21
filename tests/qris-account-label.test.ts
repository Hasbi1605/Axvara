import { afterEach, expect, it, vi } from "vitest";
import { qrisPaymentAccountLabel } from "@/lib/payments/qris";

afterEach(() => { vi.unstubAllEnvs(); });

it("labels the QRIS payment account from the active provider, not a stored DANA default", () => {
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "gopay");
  expect(qrisPaymentAccountLabel()).toBe("GoPay Merchant");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
  expect(qrisPaymentAccountLabel()).toBe("KlikQRIS");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "");
  expect(qrisPaymentAccountLabel()).toBe("");
  expect(qrisPaymentAccountLabel("gopay")).toBe("GoPay Merchant");
});
