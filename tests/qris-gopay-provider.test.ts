import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  activeQrisProvider,
  calculateCrc16,
  getGopayInvoiceMerchantId,
  isGopayQrisConfigured,
  isQrisProvider,
  makeDynamicQris,
  parseQrisWebhook,
} from "@/lib/payments/dana-qris";

const DANA_FIXTURE_BASE = "00020101021153033605802ID5911AXVARA TEST6007JAKARTA6304";
const danaFixture = () => `${DANA_FIXTURE_BASE}${calculateCrc16(DANA_FIXTURE_BASE)}`;
// Bentuk merchant QRIS pengganti 2026-10-16: tag 26 + NMID tag 51,
// kode pos dan data tambahan. Identitas dianonimkan; payload asli tetap secret.
const GOPAY_FIXTURE_BASE = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI51440014ID.CO.QRIS.WWW0215ID10111111111110303UMI5204899953033605802ID5911AXVARA TEST6006SLEMAN61055558162070703A016304";
const gopayFixture = () => `${GOPAY_FIXTURE_BASE}${calculateCrc16(GOPAY_FIXTURE_BASE)}`;

describe("QRIS multi-provider core (Fase 0, DANA tidak berubah)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([1_137, 15_037, 500_299])("preserves GoPay merchant, NMID and additional data when setting amount %i", (amount) => {
    const dynamic = makeDynamicQris(gopayFixture(), amount);
    expect(dynamic).toContain("010212");
    expect(dynamic).toContain(`54${String(amount).length.toString().padStart(2, "0")}${amount}5802ID`);
    expect(dynamic).toContain("26610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI");
    expect(dynamic).toContain("51440014ID.CO.QRIS.WWW0215ID10111111111110303UMI");
    expect(dynamic).toContain("5911AXVARA TEST6006SLEMAN61055558162070703A01");
    expect(dynamic).not.toContain("010211");
    expect(dynamic.slice(-4)).toBe(calculateCrc16(dynamic.slice(0, -4)));
  });

  it("replaces the amount without changing the merchant or duplicating payment fields", () => {
    const first = makeDynamicQris(gopayFixture(), 15_037);
    const updated = makeDynamicQris(first, 50_299);
    expect(updated).toBe(makeDynamicQris(gopayFixture(), 50_299));
    expect(updated).not.toContain("540515037");
    expect(updated.slice(-4)).toBe(calculateCrc16(updated.slice(0, -4)));
  });

  it("reads merchant ownership from the stored QR before and after amount conversion", () => {
    expect(getGopayInvoiceMerchantId(gopayFixture())).toBe("G111111111");
    expect(getGopayInvoiceMerchantId(makeDynamicQris(gopayFixture(), 15_037))).toBe("G111111111");
    expect(getGopayInvoiceMerchantId(danaFixture())).toBeNull();
    expect(getGopayInvoiceMerchantId(null)).toBeNull();
    expect(getGopayInvoiceMerchantId(gopayFixture().slice(0, -4) + "0000")).toBeNull();
    const malformed = GOPAY_FIXTURE_BASE.replace("0210G111111111", "0210X111111111");
    expect(getGopayInvoiceMerchantId(malformed + calculateCrc16(malformed))).toBeNull();
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
