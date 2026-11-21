// tests/admin-buyer-mask.test.ts — AU-J2-5: admin order queues render buyer
// WA/email through these maskers. A regression here leaks PII to every admin
// screen, so the masking matrix is pinned directly.
import { describe, expect, it } from "vitest";
import { maskAdminEmail, maskAdminWa, serializeAdminOrderBuyer } from "@/lib/orders/admin-buyer";

describe("maskAdminWa", () => {
  it("returns null for empty values", () => {
    expect(maskAdminWa(null)).toBeNull();
    expect(maskAdminWa(undefined)).toBeNull();
    expect(maskAdminWa("")).toBeNull();
    expect(maskAdminWa("   ")).toBeNull();
  });

  it("masks by length band without exposing the middle digits", () => {
    expect(maskAdminWa("6281234567890")).toBe("62812****7890");
    expect(maskAdminWa(" 08123456789 ")).toBe("08123****6789");
    expect(maskAdminWa("0812345678")).toBe("081****78");
    expect(maskAdminWa("1234567")).toBe("123****67");
    expect(maskAdminWa("123456")).toBe("12****");
    expect(maskAdminWa("1234")).toBe("12****");
    expect(maskAdminWa("123")).toBe("****");
    expect(maskAdminWa("1")).toBe("****");
  });

  it("coerces non-strings and never emits the raw value", () => {
    expect(maskAdminWa(6281234567890)).toBe("62812****7890");
    for (const raw of ["6281234567890", "0812345678", "1234567", "123456", "1234"]) {
      expect(maskAdminWa(raw)).not.toContain(raw);
    }
  });
});

describe("maskAdminEmail", () => {
  it("returns null for empty values", () => {
    expect(maskAdminEmail(null)).toBeNull();
    expect(maskAdminEmail(undefined)).toBeNull();
    expect(maskAdminEmail("")).toBeNull();
    expect(maskAdminEmail("   ")).toBeNull();
  });

  it("keeps only a hint of the local part and the full domain", () => {
    expect(maskAdminEmail("budi@example.com")).toBe("b***i@example.com");
    expect(maskAdminEmail("user@sub.domain.co")).toBe("u***r@sub.domain.co");
    expect(maskAdminEmail("ab@example.com")).toBe("a***@example.com");
    expect(maskAdminEmail("a@example.com")).toBe("***@example.com");
    expect(maskAdminEmail(" budi@example.com ")).toBe("b***i@example.com");
  });

  it("collapses anything malformed to a fixed placeholder", () => {
    for (const bad of ["no-at-sign", "@example.com", "user@", "a@b@c", "user @example.com", "user@exa mple.com"]) {
      expect(maskAdminEmail(bad)).toBe("***");
    }
  });

  it("never includes the full address", () => {
    for (const email of ["budi@example.com", "user@sub.domain.co", "ab@example.com", "a@example.com"]) {
      expect(maskAdminEmail(email)).not.toBe(email);
    }
  });
});

describe("serializeAdminOrderBuyer", () => {
  it("masks WA/email and never infers a name from the email", () => {
    const withoutName = serializeAdminOrderBuyer({
      customer_name: "   ",
      customer_wa: "6281234567890",
      customer_email: "rani@example.com",
      sales_channel: "  telegram  ",
      purchase_disabled: 1,
    });
    expect(withoutName).toEqual({
      customer_name: null,
      customer_wa: "62812****7890",
      customer_email: "r***i@example.com",
      sales_channel: "telegram",
      purchase_disabled: 1,
    });
    expect(JSON.stringify(withoutName)).not.toContain("6281234567890");
    expect(JSON.stringify(withoutName)).not.toContain("rani@example.com");
  });

  it("trims the name/channel and normalises purchase_disabled", () => {
    const full = serializeAdminOrderBuyer({
      customer_name: "  Rani Putri  ",
      customer_wa: "0812345678",
      customer_email: "ab@example.com",
      sales_channel: "web",
      purchase_disabled: "1",
    });
    expect(full.customer_name).toBe("Rani Putri");
    expect(full.customer_wa).toBe("081****78");
    expect(full.customer_email).toBe("a***@example.com");
    expect(full.sales_channel).toBe("web");
    expect(full.purchase_disabled).toBe(1);

    expect(serializeAdminOrderBuyer({ purchase_disabled: 2 }).purchase_disabled).toBe(0);
    expect(serializeAdminOrderBuyer({ purchase_disabled: "yes" }).purchase_disabled).toBe(0);
    expect(serializeAdminOrderBuyer({}).purchase_disabled).toBe(0);
  });

  it("returns nulls for missing fields", () => {
    expect(serializeAdminOrderBuyer({})).toEqual({
      customer_name: null,
      customer_wa: null,
      customer_email: null,
      sales_channel: null,
      purchase_disabled: 0,
    });
  });
});
