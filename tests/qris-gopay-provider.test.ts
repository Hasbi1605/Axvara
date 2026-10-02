import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  activeQrisProvider,
  calculateCrc16,
  isGopayQrisConfigured,
  isQrisProvider,
  makeDynamicQris,
  parseQrisWebhook,
} from "@/lib/payments/dana-qris";

const DANA_FIXTURE_BASE = "00020101021153033605802ID5911AXVARA TEST6007JAKARTA6304";
const danaFixture = () => `${DANA_FIXTURE_BASE}${calculateCrc16(DANA_FIXTURE_BASE)}`;
// Payload GoPay Merchant valid (TLV EMVCo benar + CRC benar, MID GoPay di
// tag 26). Payload produksi asli hanya di secret, tidak di repo.
const GOPAY_FIXTURE_BASE = "00020101021126680014COM.GO-JEK.WWW01198936009153111111111021650101111111111110303UMI5204541153033605802ID5914GOPAY MERCHANT6007JAKARTA6304";
const gopayFixture = () => `${GOPAY_FIXTURE_BASE}${calculateCrc16(GOPAY_FIXTURE_BASE)}`;

describe("QRIS multi-provider core (Fase 0, DANA tidak berubah)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("makeDynamicQris valid untuk payload GoPay (CRC + tag 54 + 01=12)", () => {
    const dynamic = makeDynamicQris(gopayFixture(), 15_037);
    expect(dynamic).toContain("010212");
    expect(dynamic).toContain("540515037");
    expect(dynamic).not.toContain("010211");
    expect(dynamic.slice(-4)).toBe(calculateCrc16(dynamic.slice(0, -4)));
  });

  it("makeDynamicQris DANA tetap identik (tidak regresi)", () => {
    const dynamic = makeDynamicQris(danaFixture(), 50_260);
    expect(dynamic).toContain("010212");
    expect(dynamic).toContain("5405502605802ID");
    expect(dynamic.slice(-4)).toBe(calculateCrc16(dynamic.slice(0, -4)));
  });

  it("isQrisProvider hanya terima dana/gopay", () => {
    expect(isQrisProvider("dana")).toBe(true);
    expect(isQrisProvider("gopay")).toBe(true);
    expect(isQrisProvider("shopee")).toBe(false);
    expect(isQrisProvider("")).toBe(false);
  });

  it("activeQrisProvider default dana; gopay hanya bila terkonfigurasi", () => {
    expect(activeQrisProvider()).toBe("dana");
    vi.stubEnv("QRIS_ACTIVE_PROVIDER", "gopay");
    expect(activeQrisProvider()).toBe("dana"); // belum configured
    vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
    vi.stubEnv("GOPAY_STATIC_QRIS", gopayFixture());
    vi.stubEnv("GOPAY_POLLER_SECRET", "s3cret-poller-xyz");
    expect(isGopayQrisConfigured()).toBe(true);
    expect(activeQrisProvider()).toBe("gopay");
  });

  it("parseQrisWebhook baca order_code poller + fallback tanpa order_code", () => {
    expect(parseQrisWebhook({ amount: 15_037, order_code: "axv-20261002-abcdef12" }))
      ?.toMatchObject({ amount: 15_037, orderCode: "AXV-20261002-ABCDEF12" });
    expect(parseQrisWebhook({ amount: 15_037 })?.orderCode).toBeNull();
    expect(parseQrisWebhook({ amount: 15_037, order_code: "!!! " })?.orderCode).toBeNull();
    expect(parseQrisWebhook({ noamount: 1 })).toBeNull();
  });
});
