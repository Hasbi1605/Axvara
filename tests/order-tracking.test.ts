import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(async () => {
  fixture = createD1Fixture();
  clearRateLimitBucketsForTest();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "false");
  await insertTestProduct(fixture.sql, "manual", 1);
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "AXV-20260917-TRACK001",
    "Budi Santoso",
    "6281212345678",
    "budi@example.com",
    JSON.stringify([{ product_id: 1, name: "Fixture — Variant 1", price: 10000, qty: 1 }]),
    10000,
    "qris",
    "DANA Business",
    "pending",
    "pending",
    "web",
    new Date(Date.now() + 30 * 60_000).toISOString(),
  );
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  clearRateLimitBucketsForTest();
});

function lookupRequest(body: unknown) {
  return new NextRequest("http://localhost/api/orders/lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/orders/lookup — lacak dengan kode + WA", () => {
  it("mengembalikan ringkasan untuk pasangan kode + WA yang cocok", async () => {
    const { POST } = await import("@/app/api/orders/lookup/route");
    const res = await POST(lookupRequest({ code: "AXV-20260917-TRACK001", wa: "081212345678" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.code).toBe("AXV-20260917-TRACK001");
    expect(body.order.status).toBe("pending");
    expect(body.order.customer_wa).toContain("****");
    expect(body.order.customer_wa).not.toContain("6281212345678");
    expect(body.order.customer_email).toContain("***");
  });

  it("menerima variasi format WA 08 / +62 / 62 untuk nomor yang sama", async () => {
    const { POST } = await import("@/app/api/orders/lookup/route");
    for (const wa of ["081212345678", "+6281212345678", "6281212345678"]) {
      const res = await POST(lookupRequest({ code: "axv-20260917-track001", wa }));
      expect(res.status, wa).toBe(200);
    }
  });

  it("WA salah memberi 404 generik yang sama dengan kode tidak ada", async () => {
    const { POST } = await import("@/app/api/orders/lookup/route");
    const wrongWa = await POST(lookupRequest({ code: "AXV-20260917-TRACK001", wa: "0812999888777" }));
    const noCode = await POST(lookupRequest({ code: "AXV-20260917-NOPE0000", wa: "081212345678" }));
    expect(wrongWa.status).toBe(404);
    expect(noCode.status).toBe(404);
    expect((await wrongWa.json()).error).toBe((await noCode.json()).error);
  });

  it("format kode / WA tidak valid ditolak 400 dengan pesan jelas", async () => {
    const { POST } = await import("@/app/api/orders/lookup/route");
    const badCode = await POST(lookupRequest({ code: "SALAH", wa: "081212345678" }));
    expect(badCode.status).toBe(400);
    expect((await badCode.json()).error).toContain("Format kode");
    const badWa = await POST(lookupRequest({ code: "AXV-20260917-TRACK001", wa: "123" }));
    expect(badWa.status).toBe(400);
    expect((await badWa.json()).error).toContain("Nomor WA");
  });

  it("scope rate-limit lookup terdaftar sehingga halaman lacak tidak self-DoS", async () => {
    const { POST } = await import("@/app/api/orders/lookup/route");
    expect(read("src/app/api/orders/lookup/route.ts")).toContain('checkRateLimit(req, "orders:lookup")');
    expect(read("src/lib/rateLimit.ts")).toContain('"orders:lookup"');
    // Burst wajar tidak langsung 429 (bucket 20/mnt per IP).
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await POST(lookupRequest({ code: "AXV-20260917-TRACK001", wa: "081212345678" }))).status);
    }
    expect(statuses).toEqual([200, 200, 200]);
  });
});

describe("Halaman /lacak-pesanan — wiring UX", () => {
  it("form kode + WA memanggil lookup dan memakai pola desain AXVARA", () => {
    const client = read("src/app/lacak-pesanan/lacak-pesanan-client.tsx");
    expect(client).toContain('"/api/orders/lookup"');
    expect(client).toContain("ax-glass-card");
    expect(client).toContain("Lacak Pesanan");
    expect(client).toContain("Terakhir dilacak");
    expect(client).toContain("Alur status pesanan");
    expect(client).toContain("Lacak pesanan lain");
  });

  it("ditautkan dari navigasi utama, footer, bottom-nav, cara-order, dan halaman pesanan", () => {
    expect(read("src/components/storefront/Navbar.tsx")).toContain('href="/lacak-pesanan"');
    expect(read("src/components/storefront/Footer.tsx")).toContain('href="/lacak-pesanan"');
    expect(read("src/components/storefront/MobileBottomNav.tsx")).toContain('href: "/lacak-pesanan"');
    expect(read("src/app/cara-order/page.tsx")).toContain('href="/lacak-pesanan"');
    expect(read("src/app/pesanan/[code]/page.tsx")).toContain('href="/lacak-pesanan"');
  });
});
