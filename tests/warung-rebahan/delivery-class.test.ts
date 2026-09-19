import { describe, expect, it } from "vitest";
import {
  deliveryLabelForAdmin,
  deliveryLabelForBuyer,
  guessDeliveryClass,
} from "@/lib/warung-rebahan/delivery-class";
import {
  buyerDeliveryBadge,
  buyerDeliveryEtaNonWr,
  buyerDeliveryKind,
} from "@/lib/catalog";

// 2026-09-16: kelas pengiriman WR (restock vs made_by_order). API WR tidak
// memberi penanda auto/manual — tebakan sistem + seed screenshot + kunci
// admin. Default aman = manual (under-promise).
describe("wr delivery class", () => {
  it("seed screenshot: nama RESTOK ditebak restock", () => {
    expect(guessDeliveryClass({ productName: "Netflix Premium", variantName: "Premium Anti Limit" })).toBe("restock");
    expect(guessDeliveryClass({ productName: "Canva Premium", variantName: "Head Pro" })).toBe("restock");
    expect(guessDeliveryClass({ productName: "Loklok", variantName: "Sharing" })).toBe("restock");
  });

  it("seed screenshot: nama MBO ditebak made_by_order", () => {
    expect(guessDeliveryClass({ productName: "Wink Premium", variantName: "7d" })).toBe("made_by_order");
    expect(guessDeliveryClass({ productName: "Zoom Pro", variantName: "28D" })).toBe("made_by_order");
    expect(guessDeliveryClass({ productName: "VPN Express", variantName: "3d" })).toBe("made_by_order");
  });

  it("tipe Invite/Link butuh data pembeli → manual", () => {
    expect(guessDeliveryClass({ productName: "Youtube Premium", variantName: "Premium Invite", type: "Invite" })).toBe("made_by_order");
    expect(guessDeliveryClass({ productName: "Youtube Premium", variantName: "Premium Link", type: "Link" })).toBe("made_by_order");
  });

  it("kata slow/antri → manual walau stok ada", () => {
    expect(guessDeliveryClass({ productName: "Getcontact", variantName: "Premium", stock: 5, terms: "proses slow sesuai antrian" })).toBe("made_by_order");
  });

  it("stok ready + kata langsung → restock", () => {
    expect(guessDeliveryClass({ productName: "Kiro AI", variantName: "Pro", stock: 3, terms: "dikirim langsung otomatis" })).toBe("restock");
  });

  it("ragu-ragu → manual (default aman)", () => {
    expect(guessDeliveryClass({ productName: "Produk Misterius", variantName: "Varian X" })).toBe("made_by_order");
  });

  it("label pembeli singkat (tanpa emoji — styling diurus UI)", () => {
    expect(deliveryLabelForBuyer("restock")).toBe("Kirim otomatis");
    expect(deliveryLabelForBuyer("made_by_order")).toBe("Made By Order");
    expect(deliveryLabelForBuyer(null)).toBe("Made By Order");
  });

  it("label admin menyebut sumber", () => {
    expect(deliveryLabelForAdmin("restock", "screenshot")).toContain("daftar WR");
    expect(deliveryLabelForAdmin("made_by_order", "admin")).toContain("kunci admin");
    expect(deliveryLabelForAdmin(null, null)).toContain("belum dikunci");
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
