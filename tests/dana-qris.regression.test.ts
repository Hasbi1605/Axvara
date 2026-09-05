import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import {
  calculateCrc16,
  constantTimeEqual,
  makeDynamicQris,
  parseDanaWebhook,
} from "@/lib/payments/dana-qris";
import { renderQrisPng } from "@/lib/payments/qris-png";

function staticFixture(): string {
  const payload = "00020101021153033605802ID5911AXVARA TEST6007JAKARTA6304";
  return `${payload}${calculateCrc16(payload)}`;
}

describe("DANA Business dynamic QRIS", () => {
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

  it("accepts the configured production merchant payload when supplied", () => {
    const source = process.env.DANA_STATIC_QRIS?.trim();
    if (!source) return;
    const dynamic = makeDynamicQris(source, 12_345);
    expect(dynamic).toContain("5405123455802ID");
    expect(dynamic.slice(-4)).toBe(calculateCrc16(dynamic.slice(0, -4)));
  });

  it("renders the generated payload as an Edge-compatible PNG", () => {
    const source = process.env.DANA_STATIC_QRIS?.trim() || staticFixture();
    const png = renderQrisPng(makeDynamicQris(source, 10_123));
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.byteLength).toBeGreaterThan(1_000);
    const width = new DataView(png.buffer, png.byteOffset + 16, 4).getUint32(0);
    expect(width).toBeGreaterThanOrEqual(360);
    const idatLength = new DataView(png.buffer, png.byteOffset + 33, 4).getUint32(0);
    const inflated = inflateSync(png.slice(41, 41 + idatLength));
    expect(inflated.byteLength).toBe(width * (width + 1));
  });
});

describe("QRIS Hook parser and authentication", () => {
  it("parses structured QRIS Hook payload", () => {
    expect(parseDanaWebhook({
      event_id: "evt-1",
      payment: { amount: 50_260, sender_name: "BUDI" },
      notification: { text: "Pembayaran diterima" },
    })).toEqual({ amount: 50_260, senderName: "BUDI", rawText: "Pembayaran diterima", sourceEventId: "evt-1" });
  });

  it("parses Indonesian Rupiah from raw notification without taking unrelated digits", () => {
    expect(parseDanaWebhook({ text: "05/09 pembayaran sebesar Rp 50.260 dari pelanggan berhasil" })?.amount).toBe(50_260);
    expect(parseDanaWebhook({ text: "05/09 notifikasi tanpa nominal rupiah" })).toBeNull();
  });

  it("compares webhook secrets without early length return", () => {
    expect(constantTimeEqual("rahasia-sama", "rahasia-sama")).toBe(true);
    expect(constantTimeEqual("rahasia-sama", "rahasia-beda")).toBe(false);
    expect(constantTimeEqual("pendek", "jauh-lebih-panjang")).toBe(false);
  });
});

describe("legacy QRIS rails removed", () => {
  it("uses DANA QRIS in all three channel handlers", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
    for (const file of [
      "src/app/api/orders/route.ts",
      "src/app/api/telegram/webhook/route.ts",
      "src/app/api/whatsapp/webhook/route.ts",
    ]) {
      expect(read(file)).toContain("createDanaQrisInvoice");
      expect(read(file)).not.toMatch(/getPaymentProvider|KLIKQRIS/);
    }
    expect(fs.existsSync(path.join(process.cwd(), "src/lib/payments/klikqris.ts"))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), "src/app/api/payments/klikqris/callback/route.ts"))).toBe(false);
  });
});
