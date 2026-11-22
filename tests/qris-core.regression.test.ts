import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import {
  calculateCrc16,
  constantTimeEqual,
  QRIS_MAX_UNIQUE_CODE,
  qrisMaxUniqueCode,
  makeDynamicQris,
  parseQrisWebhook,
} from "@/lib/payments/qris";
import { renderQrisPng } from "@/lib/payments/qris-png";

function staticFixture(): string {
  const payload = "00020101021153033605802ID5911AXVARA TEST6007JAKARTA6304";
  return `${payload}${calculateCrc16(payload)}`;
}

describe("static merchant dynamic QRIS", () => {
  it("injects an exact amount, changes initiation mode, and recalculates CRC", () => {
    const dynamic = makeDynamicQris(staticFixture(), 50_260);
    expect(dynamic).toContain("010212");
    expect(dynamic).toContain("5405502605802ID");
    expect(dynamic).not.toContain("010211");
    expect(dynamic.slice(-4)).toBe(calculateCrc16(dynamic.slice(0, -4)));
  });

  it("replaces an existing amount instead of creating duplicate tag 54", () => {
    const first = makeDynamicQris(staticFixture(), 1_311);
    const second = makeDynamicQris(first, 2_125);
    expect(second.match(/54\d{2}/g)).toHaveLength(1);
    expect(second).toContain("54042125");
    expect(second.slice(-4)).toBe(calculateCrc16(second.slice(0, -4)));
  });

  it("rejects malformed or checksum-invalid source payloads", () => {
    expect(() => makeDynamicQris("0002010102115802ID63040000", 1_000)).toThrow();
    expect(() => makeDynamicQris(staticFixture().slice(0, -1) + "0", 1_000)).toThrow("invalid_qris_crc");
  });

  it("renders the generated payload as an Edge-compatible PNG", () => {
    const source = staticFixture();
    const png = renderQrisPng(makeDynamicQris(source, 10_123));
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.byteLength).toBeGreaterThan(1_000);
    const width = new DataView(png.buffer, png.byteOffset + 16, 4).getUint32(0);
    expect(width).toBeGreaterThanOrEqual(360);
    const idatLength = new DataView(png.buffer, png.byteOffset + 33, 4).getUint32(0);
    const inflated = inflateSync(png.slice(41, 41 + idatLength));
    expect(inflated.byteLength).toBe(width * (width + 1));
  });
  it("tiers the GoPay unique code by order size (owner 22 Nov 2026)", async () => {
    // <Rp10rb tetap maks +299 (keputusan 6 Sep 2026: jangan memberatkan order kecil).
    expect(qrisMaxUniqueCode(1)).toBe(299);
    expect(qrisMaxUniqueCode(9_999)).toBe(299);
    expect(qrisMaxUniqueCode(10_000)).toBe(499);
    expect(qrisMaxUniqueCode(49_999)).toBe(499);
    expect(qrisMaxUniqueCode(50_000)).toBe(999);
    expect(qrisMaxUniqueCode(5_000_000)).toBe(999);
    expect(QRIS_MAX_UNIQUE_CODE).toBe(999);
    const fs = await import("node:fs");
    const qris = fs.readFileSync("src/lib/payments/qris.ts", "utf8");
    expect(qris).toContain("bytes[0] % maxCode");
    expect(qris).toContain("MAX_AMOUNT - QRIS_MAX_UNIQUE_CODE");
    // Alokasi baru dan reissue sama-sama memakai batas bertingkat.
    expect(qris.match(/const maxCode = qrisMaxUniqueCode\(requestedAmount\)/g)).toHaveLength(2);
    expect(qris).not.toContain("length: QRIS_MAX_UNIQUE_CODE");
  });
});

describe("QRIS webhook parser and authentication", () => {
  it("parses structured QRIS webhook payload", () => {
    expect(parseQrisWebhook({
      event_id: "evt-1",
      payment: { amount: 50_260, sender_name: "BUDI" },
      notification: { text: "Pembayaran diterima" },
    })).toEqual({ amount: 50_260, senderName: "BUDI", rawText: "Pembayaran diterima", sourceEventId: "evt-1", orderCode: null });
  });

  it("parses Indonesian Rupiah from raw notification without taking unrelated digits", () => {
    expect(parseQrisWebhook({ text: "05/09 pembayaran sebesar Rp 50.260 dari pelanggan berhasil" })?.amount).toBe(50_260);
    expect(parseQrisWebhook({ text: "05/09 notifikasi tanpa nominal rupiah" })).toBeNull();
  });

  it("compares webhook secrets without early length return", () => {
    expect(constantTimeEqual("rahasia-sama", "rahasia-sama")).toBe(true);
    expect(constantTimeEqual("rahasia-sama", "rahasia-beda")).toBe(false);
    expect(constantTimeEqual("pendek", "jauh-lebih-panjang")).toBe(false);
  });
});

describe("QRIS provider routing", () => {
  it("uses the shared QRIS entry point in all three channel handlers", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
    for (const file of [
      "src/app/api/orders/route.ts",
      // Refactor 2026-09-10: penerbitan QRIS Telegram dipindah dari
      // route.ts ke handler invoice (varian tunggal) dan cart-invoice (checkout gabungan).
      // Jalur WhatsApp dihapus 13 November 2026 (alur pembeli dipensiunkan).
      "src/lib/telegram/handlers/invoice.ts",
      "src/lib/telegram/handlers/cart-invoice.ts",
    ]) {
      expect(read(file)).toMatch(/createActiveQrisInvoice/);
      expect(read(file)).not.toMatch(/getPaymentProvider|KLIKQRIS/);
    }
    // 3B-5b: web issuance moved to checkout/invoice.ts — it must own the
    // awaited shared entry point (route only awaits issueCheckoutInvoice).
    const webInvoice = read("src/lib/orders/checkout/invoice.ts");
    expect(webInvoice).toContain("await createActiveQrisInvoice(");
    expect(webInvoice).not.toMatch(/getPaymentProvider|KLIKQRIS/);
    expect(read("src/app/api/orders/route.ts")).toContain("await issueCheckoutInvoice(");
    expect(fs.existsSync(path.join(process.cwd(), "src/lib/payments/klikqris.ts"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "src/app/api/payments/klikqris/callback/route.ts"))).toBe(true);
  });

  it("removes Android setup and keeps GoPay server guidance", async () => {
    const fs = await import("node:fs");
    const panel = fs.readFileSync("src/components/admin/PaymentReconciliation.tsx", "utf8");
    const health = fs.readFileSync("src/app/api/admin/payments/events/route.ts", "utf8");
    expect(panel).not.toContain("Setup aplikasi QRIS Hook");
    expect(panel).toContain('provider === "dana"');
    expect(panel).toContain("Poller GoBiz server (GoPay)");
    expect(panel).toContain("Rekonsiliasi QRIS</h3>");
    const orders = fs.readFileSync("src/components/admin/OrdersManager.tsx", "utf8");
    expect(orders).not.toContain("mutasi DANA");
    expect(orders).toContain("mutasi merchant sesuai invoice");
    expect(health).not.toContain("/api/webhook/dana");
    expect(health).toContain("X-Poller-Secret");
  });
});
