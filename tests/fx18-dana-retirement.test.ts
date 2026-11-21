import { existsSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { activeQrisProvider, createActiveQrisInvoice, isActiveQrisConfigured } from "@/lib/payments/qris";

afterEach(() => vi.unstubAllEnvs());

it("fails closed with the retired selector even if its old credentials are present", async () => {
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "dana");
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_STATIC_QRIS", "legacy-qr");
  vi.stubEnv("DANA_WEBHOOK_SECRET", "legacy-secret");
  vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
  vi.stubEnv("GOPAY_STATIC_QRIS", "fixture-qr");
  vi.stubEnv("GOPAY_POLLER_SECRET", "fixture-secret");
  expect(activeQrisProvider()).toBeNull();
  expect(isActiveQrisConfigured()).toBe(false);
  await expect(createActiveQrisInvoice("AXV-20261121-3131AAAA", 10000)).rejects.toThrow("qris_not_configured");
});

it("does not leave an Android DANA webhook route", () => {
  expect(existsSync("src/app/api/webhook/dana/route.ts")).toBe(false);
});
