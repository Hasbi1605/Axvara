import { describe, expect, it } from "vitest";
import {
  deliveryClassFromApiMode,
  deliveryLabelForAdmin,
  deliveryLabelForBuyer,
  isQueuedFulfillment,
  WR_DEFAULT_DELIVERY_CLASS,
} from "@/lib/warung-rebahan/delivery-class";
import {
  buyerDeliveryBadge,
  buyerDeliveryEtaNonWr,
  buyerDeliveryKind,
} from "@/lib/catalog";

// 2026-10-13: kelas pengiriman WR murni dari `delivery_mode` resmi API WR
// (paten ala SK) — mesin tebakan nama/stok/terms + seed screenshot + kunci
// admin DIHAPUS. Pemetaan biner: auto → AUTO (restock), manual/mixed →
// MANUAL (made_by_order), tanpa mode → default aman deterministik.
describe("wr delivery class — hanya dari API (2026-10-13)", () => {
  it("delivery_mode resmi dipetakan paten dua nilai", () => {
    expect(deliveryClassFromApiMode("auto")).toBe("restock");
    expect(deliveryClassFromApiMode(" AUTO ")).toBe("restock");
    expect(deliveryClassFromApiMode("manual")).toBe("made_by_order");
    // mixed dilipat ke MANUAL (bisa manual tergantung ketersediaan).
    expect(deliveryClassFromApiMode("mixed")).toBe("made_by_order");
    expect(deliveryClassFromApiMode("Mixed")).toBe("made_by_order");
  });

  it("tanpa mode dikenal → null; default deterministik MANUAL (bukan tebakan)", () => {
    expect(deliveryClassFromApiMode(null)).toBeNull();
    expect(deliveryClassFromApiMode(undefined)).toBeNull();
    expect(deliveryClassFromApiMode("")).toBeNull();
    expect(deliveryClassFromApiMode("sesuatu-baru")).toBeNull();
    expect(WR_DEFAULT_DELIVERY_CLASS).toBe("made_by_order");
  });

  it("label pembeli singkat (tanpa emoji — styling diurus UI)", () => {
    expect(deliveryLabelForBuyer("restock")).toBe("Kirim otomatis");
    expect(deliveryLabelForBuyer("made_by_order")).toBe("Made By Order");
    expect(deliveryLabelForBuyer(null)).toBe("Made By Order");
  });

  it("label admin hanya AUTO/MANUAL (tanpa embel-embel sumber)", () => {
    expect(deliveryLabelForAdmin("restock")).toBe("AUTO");
    expect(deliveryLabelForAdmin("made_by_order")).toBe("MANUAL");
    expect(deliveryLabelForAdmin(null)).toBe("?");
  });
});

describe("kelas pengiriman pembeli non-WR (2026-09-19)", () => {
  it("WR ikut wr_delivery_class, non-WR ikut fulfillment_mode", () => {
    expect(buyerDeliveryKind({ wr_variant_id: "x", wr_delivery_class: "restock", fulfillment_mode: "manual" })).toBe("instant");
    expect(buyerDeliveryKind({ wr_variant_id: "x", wr_delivery_class: "made_by_order", fulfillment_mode: "unique" })).toBe("queued");
    expect(buyerDeliveryKind({ wr_variant_id: null, fulfillment_mode: "shared" })).toBe("instant");
    expect(buyerDeliveryKind({ wr_variant_id: null, fulfillment_mode: "unique" })).toBe("instant");
    expect(buyerDeliveryKind({ wr_variant_id: null, fulfillment_mode: "manual" })).toBe("queued");
  });

  it("badge: instan = Kirim otomatis, antrean = Made By Order", () => {
    expect(buyerDeliveryBadge({ wr_variant_id: null, fulfillment_mode: "shared" })).toBe("Kirim otomatis");
    expect(buyerDeliveryBadge({ wr_variant_id: null, fulfillment_mode: "manual" })).toBe("Made By Order");
  });

  it("ETA non-WR manual jujur tanpa angka supplier (admin yang kerjakan)", () => {
    const eta = buyerDeliveryEtaNonWr();
    expect(eta).toContain("Made By Order");
    expect(eta).toContain("admin");
    expect(eta).not.toContain("6–12");
    expect(eta).not.toContain("12 jam");
  });
});

describe("isQueuedFulfillment — SK auto tidak pernah antre (regresi 2026-10-02)", () => {
  it("SK auto → instan walau fulfillment_mode lokal manual", () => {
    // Prime Video SK: PDP "Kirim otomatis" benar tapi checkout bilang MBO 12
    // jam — quote hanya melihat fulfillment_mode lokal ('manual' untuk semua SK).
    expect(isQueuedFulfillment({ skVariantId: "101", skOrderProcess: "auto", fulfillmentMode: "manual" })).toBe(false);
    expect(isQueuedFulfillment({ skVariantId: "101", skOrderProcess: "AUTO", fulfillmentMode: "manual" })).toBe(false);
  });

  it("SK non-auto → antrean", () => {
    expect(isQueuedFulfillment({ skVariantId: "102", skOrderProcess: "manual", fulfillmentMode: "manual" })).toBe(true);
    expect(isQueuedFulfillment({ skVariantId: "103", skOrderProcess: "h2h", fulfillmentMode: "shared" })).toBe(true);
    // Registry belum tulis process (NULL) = default aman antrean.
    expect(isQueuedFulfillment({ skVariantId: "104", skOrderProcess: null, fulfillmentMode: "shared" })).toBe(true);
  });

  it("WR + non-supplier tidak berubah", () => {
    expect(isQueuedFulfillment({ wrVariantId: "x", wrClass: "restock", fulfillmentMode: "manual" })).toBe(false);
    expect(isQueuedFulfillment({ wrVariantId: "x", wrClass: "made_by_order", fulfillmentMode: "unique" })).toBe(true);
    expect(isQueuedFulfillment({ fulfillmentMode: "shared" })).toBe(false);
    expect(isQueuedFulfillment({ fulfillmentMode: "manual" })).toBe(true);
  });
});
