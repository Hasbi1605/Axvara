import { describe, expect, it } from "vitest";
import {
  EMAIL_REQUIRED_MESSAGE,
  needsEmailForVariant,
} from "@/lib/warung-rebahan/delivery-class";

// 2026-09-16 (migrasi 0033): email wajib SEBELUM bayar. Invite/Link WR
// otomatis butuh (tanpa setting); non-WR ikut toggle products.require_email.
// Order lunas tanpa email = macet di WR (422, uji live #1).
describe("email wajib Invite/Link + require_email", () => {
  it("tipe Invite butuh email tanpa toggle", () => {
    expect(needsEmailForVariant({ wrType: "Invite" })).toBe(true);
    expect(needsEmailForVariant({ wrType: "invite" })).toBe(true);
    expect(needsEmailForVariant({ wrType: "Link" })).toBe(true);
    expect(needsEmailForVariant({ wrType: "link" })).toBe(true);
  });

  it("tipe Private/Sharing/Voucher tidak butuh tanpa toggle", () => {
    expect(needsEmailForVariant({ wrType: "Private" })).toBe(false);
    expect(needsEmailForVariant({ wrType: "Private 1P1U" })).toBe(false);
    expect(needsEmailForVariant({ wrType: "Sharing" })).toBe(false);
    expect(needsEmailForVariant({ wrType: "Voucher" })).toBe(false);
    expect(needsEmailForVariant({ wrType: null })).toBe(false);
    expect(needsEmailForVariant({})).toBe(false);
  });

  it("toggle require_email memaksa butuh untuk tipe apa pun", () => {
    expect(needsEmailForVariant({ wrType: "Private", requireEmail: 1 })).toBe(true);
    expect(needsEmailForVariant({ wrType: null, requireEmail: true })).toBe(true);
    expect(needsEmailForVariant({ wrType: "Sharing", requireEmail: 1 })).toBe(true);
  });

  it("toggle mati tidak membatalkan kebutuhan Invite", () => {
    expect(needsEmailForVariant({ wrType: "Invite", requireEmail: 0 })).toBe(true);
  });

  it("pesan penjelasan menyebut email invite", () => {
    expect(EMAIL_REQUIRED_MESSAGE).toContain("email");
  });
});
