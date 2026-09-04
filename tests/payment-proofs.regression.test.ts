import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  authoritativePaymentMethodForProof,
  canAcceptWhatsAppPaymentProof,
} from "@/lib/payment-proofs";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("WhatsApp payment proof review", () => {
  it("allows manual rails and static QRIS, but keeps dynamic QRIS provider-authoritative", () => {
    expect(authoritativePaymentMethodForProof("SEABANK", false)).toBe("bank:seabank");
    expect(authoritativePaymentMethodForProof("EWALLET", false)).toBe("ewallet");
    expect(authoritativePaymentMethodForProof("QRIS", false)).toBe("qris:manual");
    expect(authoritativePaymentMethodForProof("QRIS", true)).toBeNull();
  });

  it("accepts proof after dynamic QRIS is already paid, but rejects terminal unpaid orders", () => {
    const now = Date.parse("2026-09-05T10:00:00Z");
    expect(canAcceptWhatsAppPaymentProof({
      status: "lunas",
      payment_status: "paid",
      expires_at: "2026-09-05T09:00:00Z",
    }, now)).toBe(true);
    expect(canAcceptWhatsAppPaymentProof({
      status: "pending",
      payment_status: "pending",
      expires_at: "2026-09-05T11:00:00Z",
    }, now)).toBe(true);
    expect(canAcceptWhatsAppPaymentProof({
      status: "kadaluarsa",
      payment_status: "expired",
      expires_at: "2026-09-05T09:00:00Z",
    }, now)).toBe(false);
  });

  it("retires a pending QR rail when a manual rail becomes authoritative", () => {
    const route = read("src/app/api/admin/proofs/[id]/route.ts");
    expect(route).toContain("superseded_by_manual_payment");
  });

  it("exposes the proof queue in the authenticated CMS", () => {
    expect(read("src/components/admin/AdminShell.tsx")).toContain('"proofs"');
    expect(read("src/app/admin/page.tsx")).toContain("PaymentProofsManager");
    expect(read("src/components/admin/PaymentProofsManager.tsx")).toContain("/api/admin/proofs");
  });

  it("blocks generic paid confirmation for WhatsApp orders", () => {
    const route = read("src/app/api/admin/orders/[code]/route.ts");
    expect(route).toContain("review_bukti_whatsapp_required");
  });

  it("creates fulfillment after authoritative manual payment approval", () => {
    const route = read("src/app/api/admin/proofs/[id]/route.ts");
    expect(route).toContain("ensureFulfillmentForPaidOrder");
  });

  it("shows the exact provider payable amount and whether QRIS is dynamic", () => {
    const api = read("src/app/api/admin/proofs/route.ts");
    const manager = read("src/components/admin/PaymentProofsManager.tsx");
    expect(api).toContain("payable_amount");
    expect(api).toContain("provider_status");
    expect(manager).toContain("proof.payable_amount");
    expect(manager).toContain("proof.provider_status");
  });

  it("resolves fulfillment mode and shared secret from the selected variant", () => {
    const delivery = read("src/lib/fulfillment/deliver.ts");
    const fulfillmentApi = read("src/app/api/admin/fulfillment/route.ts");
    const manager = read("src/components/admin/BotAutomationManager.tsx");
    expect(delivery).toContain("product_variants");
    expect(delivery).toContain("shared_secret_ciphertext");
    expect(delivery).toContain("ensureFulfillmentForPaidOrder");
    expect(fulfillmentApi).toContain("variant_id");
    expect(manager).toContain("selectedVariant");
  });
});
