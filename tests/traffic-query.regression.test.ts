import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { checkRateLimit, clearRateLimitBucketsForTest, clientIp, RATE_LIMITS, rateLimit } from "@/lib/rateLimit";
import { NextRequest } from "next/server";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

function reqWithIp(ipHeaders: Record<string, string>): NextRequest {
  return {
    headers: { get: (k: string) => ipHeaders[k.toLowerCase()] ?? null },
  } as unknown as NextRequest;
}

describe("Issue #14 — proteksi trafik aktual, bukan klaim", () => {
  it("WAF Free TERSEDIA (1 rule): arsitektur tidak lagi mengklaim WAF tidak tersedia", () => {
    const arch = read("docs/ARCHITECTURE.md");
    // Klaim lama yang salah ("WAF tidak tersedia") hanya boleh muncul sebagai
    // koreksi historis bertanda "klaim lama ... salah", bukan sebagai fakta.
    const hits = arch.match(/WAF[^.\n]*tidak tersedia/gi) ?? [];
    expect(hits.length).toBeGreaterThan(0); // koreksi terdokumentasi di bawah
    expect(hits.every((h) => arch.includes("Klaim lama"))).toBe(true);
    expect(arch).toMatch(/WAF Free TERSEDIA/i);
  });

  it("rate-limit terpusat: quote/order/upload/login memakai helper yang sama", () => {
    expect(read("src/app/api/checkout/quote/route.ts")).toContain("checkRateLimit");
    expect(read("src/app/api/orders/route.ts")).toContain("checkRateLimit");
    expect(read("src/app/api/proof/upload/route.ts")).toContain("checkRateLimit");
    expect(read("src/app/api/upload/route.ts")).toContain("checkRateLimit");
    expect(read("src/app/api/auth/login/route.ts")).toContain("checkRateLimit");
    expect(read("src/app/api/orders/[code]/route.ts")).toContain("checkRateLimit");
    // Tidak ada lagi salinan Map lokal per-route untuk 4 endpoint yang dimigrasi.
    for (const f of [
      "src/app/api/orders/route.ts",
      "src/app/api/proof/upload/route.ts",
      "src/app/api/auth/login/route.ts",
      "src/app/api/orders/[code]/route.ts",
    ]) {
      expect(read(f)).not.toContain("const hits = new Map");
    }
  });

  it("batas login tetap 5/mnt (bug BUG-07 tidak regresi) dan quote/order sesuai spek", () => {
    expect(RATE_LIMITS["auth:login"]).toBe(5);
    expect(RATE_LIMITS["checkout:orders"]).toBe(10);
    expect(RATE_LIMITS["checkout:quote"]).toBe(20);
    expect(RATE_LIMITS["proof:upload"]).toBe(5);
    // Security test lama memakai rateLimit mentah — perilaku dipertahankan.
    const ip = `10.9.0.${Math.floor(Math.random() * 200) + 10}`;
    for (let i = 0; i < 20; i++) expect(rateLimit(`lookup:${ip}`, 20)).toBe(true);
    expect(rateLimit(`lookup:${ip}`, 20)).toBe(false);
  });

  it("checkRateLimit menegakkan batas per scope dan mengisolasi scope lain", () => {
    clearRateLimitBucketsForTest();
    const req = reqWithIp({ "cf-connecting-ip": "203.0.113.77" });
    for (let i = 0; i < 5; i++) expect(checkRateLimit(req, "auth:login")).toBe(true);
    expect(checkRateLimit(req, "auth:login")).toBe(false);
    // Scope lain dengan IP sama tidak ikut terkunci.
    expect(checkRateLimit(req, "orders:lookup")).toBe(true);
    clearRateLimitBucketsForTest();
  });

  it("clientIp anti-spoof: x-forwarded-for diabaikan total", () => {
    // cf-connecting-ip menang; x-forwarded-for palsu tidak dipakai.
    expect(
      clientIp(reqWithIp({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" })),
    ).toBe("1.1.1.1");
    // Tanpa header CF: x-forwarded-for TIDAK dipakai (sebelumnya dipakai dan
    // bisa di-spoof untuk ganti identitas limit). Hanya x-real-ip.
    expect(clientIp(reqWithIp({ "x-forwarded-for": "9.9.9.9" }))).toBe("0.0.0.0");
    expect(clientIp(reqWithIp({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "9.9.9.9" }))).toBe("2.2.2.2");
  });
});

describe("Issue #14 — efisiensi query sesuai batas D1 aktual", () => {
  it("cron operations: batch 8 agar satu run < 50 query/invocation (D1 Free)", () => {
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(cron).toContain("const EXPIRY_PER_RUN = 4");
    expect(cron).not.toContain("BATCH_LIMIT * 4");
  });

  it("helper cron selaras ke batch kecil yang sama", () => {
    expect(read("src/lib/fulfillment/deliver.ts")).toContain("reconcileMissingFulfillmentJobs(limit = 8)");
    expect(read("src/lib/fulfillment/deliver.ts")).toContain("backfillMissingFulfillmentItems(limit = 8)");
    expect(read("src/lib/fulfillment/deliver.ts")).toContain("getDueJobs(limit = 8)");
    // RR3-09: retry notifikasi mendukung filter per jenis agar cron hanya
    // membayar daftar yang antreannya > 0 (hemat query baca kosong).
    expect(read("src/lib/telegram/order-notifications.ts")).toContain("retryPendingTelegramNotifications(limit = 8");
    expect(read("src/lib/telegram/order-notifications.ts")).toContain("sendPendingOrderReminders(limit = 8)");
    expect(read("src/lib/whatsapp/outbox.ts")).toContain("getDueWhatsAppOutbox(limit = 8)");
    expect(read("src/lib/whatsapp/outbox.ts")).toContain("processDueWhatsAppOutbox(limit = 8)");
  });

  it("quote memakai 2 query IN (produk+varian), bukan N+1 per item", () => {
    const quote = read("src/app/api/checkout/quote/route.ts");
    expect(quote).toContain("WHERE p.id IN (");
    expect(quote).toContain("WHERE p.slug IN (");
    expect(quote).toContain("FROM product_variants WHERE id IN (");
    expect(quote).toContain("variantById.get(item.variant_id)");
  });

  it("cron expiry memakai JOIN order (tanpa query order per transaksi)", () => {
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(cron).toContain("JOIN orders o ON o.code=pt.order_code");
  });

  it("keranjang Telegram memakai 1 JOIN varian (tanpa getActiveVariant per baris)", () => {
    const cart = read("src/lib/telegram/cart.ts");
    expect(cart).toContain("LEFT JOIN product_variants pv ON pv.id=c.variant_id");
    const summary = cart.slice(cart.indexOf("export async function getCartSummary"));
    expect(summary).not.toContain("getActiveVariant(");
  });

  it("PDP/checkout tidak lagi fetch seluruh katalog untuk 1 produk", () => {
    const pdp = read("src/app/produk/[slug]/product-detail-client.tsx");
    expect(pdp).not.toContain('fetch("/api/products?active=1")');
    expect(pdp).toContain("slug=${encodeURIComponent(slug)}");
    const checkout = read("src/app/checkout/page.tsx");
    expect(checkout).toContain("active=1&slug=");
    const api = read("src/app/api/products/route.ts");
    expect(api).toContain("p.slug=?");
  });

  it("pola LIKE dipotong 40 char agar tidak menabrak batas 50 byte D1", () => {
    expect(read("src/app/api/products/route.ts")).toContain("q.slice(0, 40)");
  });
});
