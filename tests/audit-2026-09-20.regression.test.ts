// tests/audit-2026-09-20.regression.test.ts — Audit menyeluruh 20 Sep 2026.
//
// Tiga bug yang dikunci di sini, semuanya diverifikasi lawan data produksi
// (D1 axvara-db + Pages axvara; id akun/database sengaja tidak ditulis di repo):
//
// 1. WIB-SKEW — D1 menulis `datetime('now')` sebagai UTC berformat spasi
//    ("2026-09-19 16:25:13"). `new Date(nilai)` di JS membacanya sebagai waktu
//    LOKAL, sehingga di perangkat WIB seluruh timestamp tampil MUNDUR 7 jam
//    (order 23.25 tampil 16.25) dan tanggalnya ikut salah bila melewati
//    tengah malam. Produksi: 27/27 orders.created_at, 25/25
//    payment_transactions.created_at, 601/601 wr_sync_log.created_at berformat
//    spasi — jadi ini bukan kasus tepi, semua baris terdampak.
// 2. CRON-TIMING — /api/cron/* membandingkan bearer CRON_SECRET dengan `!==`
//    sementara seluruh kanal lain (DANA, Telegram, WhatsApp, WR) sudah memakai
//    `constantTimeEqual`. Satu-satunya pemegang CRON_SECRET adalah Worker
//    axvara-mcp; membocorkan secret ini membuka seluruh endpoint operasi.
// 3. PROOF-LEAK — `GET /api/orders/[code]` (publik, hanya butuh kode order)
//    mengembalikan `proof_url`, yaitu kunci objek R2 PRIVAT milik pembeli.
//    Endpoint kembarannya `GET /api/orders?code=` sudah tidak pernah
//    mengirimnya. Bucket axvara-assets terverifikasi privat (tanpa r2.dev,
//    tanpa custom domain), jadi dampaknya bukan unduhan langsung melainkan
//    bocornya nama berkas bukti bayar milik order orang lain.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatWibDateTime } from "@/lib/utils";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("WIB-SKEW — timestamp D1 tidak boleh dibaca sebagai waktu lokal", () => {
  // Nilai nyata dari produksi: orders.created_at milik AXV-20260919-4E2A0A03.
  const D1_SPACE_UTC = "2026-09-19 16:25:13";

  // CI berjalan di UTC, dan di UTC bug ini TIDAK muncul — `new Date(<spasi>)`
  // kebetulan menghasilkan nilai yang benar. Bug hanya terlihat dari perangkat
  // pembeli/admin Indonesia, jadi test wajib meniru zona itu. Tanpa baris ini
  // seluruh assertion di bawah tetap hijau walau perbaikannya dibatalkan.
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = "Asia/Jakarta"; });
  afterAll(() => { process.env.TZ = originalTz; });

  it("benar-benar berjalan di zona WIB saat menguji", () => {
    expect(new Date("2026-09-19T16:25:13.000Z").getHours()).toBe(23);
  });

  it("membaca format spasi D1 sebagai UTC, bukan waktu lokal", () => {
    // 16:25 UTC = 23.25 WIB. Bug lama menampilkan 16.25.
    expect(formatWibDateTime(D1_SPACE_UTC, { hour: "2-digit", minute: "2-digit" })).toBe("23.25");
  });

  it("memberi hasil identik untuk format spasi dan ISO yang menunjuk saat sama", () => {
    expect(formatWibDateTime(D1_SPACE_UTC)).toBe(formatWibDateTime("2026-09-19T16:25:13.000Z"));
  });

  it("mengunci zona tampilan ke WIB berapa pun zona perangkat", () => {
    // timeZone eksplisit: admin dari luar WIB tetap melihat jam operasional toko.
    expect(formatWibDateTime("2026-09-19T20:00:00.000Z", { dateStyle: "short" })).toBe("20/09/26");
  });

  it("melewati tengah malam WIB dengan tanggal yang benar", () => {
    // 2026-09-19 18:00 UTC = 2026-09-20 01.00 WIB — bug lama menahan tanggal 19.
    expect(formatWibDateTime("2026-09-19 18:00:00", { dateStyle: "short" })).toBe("20/09/26");
  });

  it("mengembalikan null untuk nilai kosong/tak terbaca agar pemanggil memilih fallback", () => {
    expect(formatWibDateTime(null)).toBeNull();
    expect(formatWibDateTime(undefined)).toBeNull();
    expect(formatWibDateTime("bukan-tanggal")).toBeNull();
  });

  it("tidak menyisakan `new Date(...)` mentah di permukaan yang menampilkan timestamp D1", () => {
    const surfaces = [
      "src/components/admin/OrdersManager.tsx",
      "src/components/admin/PaymentReconciliation.tsx",
      "src/components/admin/WarungRebahanManager.tsx",
      "src/components/admin/NewsletterSubscribers.tsx",
      "src/components/admin/AgentIntegration.tsx",
      "src/components/storefront/WrCredentialsPanel.tsx",
      "src/app/lacak-pesanan/lacak-pesanan-client.tsx",
      // Susulan 2026-09-20: halaman /artikel (list + detail) ketinggalan dari
      // audit awal — published_at D1 diformat langsung via new Date(...).
      "src/app/artikel/page.tsx",
      "src/app/artikel/[slug]/page.tsx",
    ];
    for (const file of surfaces) {
      const source = read(file);
      expect(source, `${file} wajib memakai helper kanonis`).toContain("formatWibDateTime");
      // Pola lama yang memicu bug: parsing string timestamp via konstruktor Date
      // lalu di-format. `new Date()` tanpa argumen (jam sekarang) tetap boleh.
      expect(source, `${file} masih memformat hasil new Date(<string>)`)
        .not.toMatch(/new Date\([^)]+\)\.toLocale/);
    }
  });
});

describe("CRON-TIMING — bearer CRON_SECRET dibandingkan konstan-waktu", () => {
  const routes = [
    "src/app/api/cron/operations/route.ts",
    "src/app/api/cron/publish-scheduled/route.ts",
  ];

  it("memakai constantTimeEqual, bukan perbandingan string biasa", () => {
    for (const file of routes) {
      const source = read(file);
      expect(source, `${file} wajib impor pembanding kanonis`).toContain("constantTimeEqual");
      expect(source, `${file} masih membandingkan bearer dengan !==`)
        .not.toMatch(/!==\s*`Bearer \$\{/);
    }
  });

  it("tetap menolak ketika CRON_SECRET belum dikonfigurasi (fail closed)", () => {
    // Tanpa secret, endpoint tidak boleh jatuh ke mode terbuka.
    expect(read("src/app/api/cron/operations/route.ts")).toContain("!cronSecret ||");
    expect(read("src/app/api/cron/publish-scheduled/route.ts")).toContain("if (!secret) return");
  });
});

describe("PROOF-LEAK — endpoint order publik tidak membocorkan kunci R2 privat", () => {
  it("tidak mengembalikan proof_url pada GET /api/orders/[code]", () => {
    const source = read("src/app/api/orders/[code]/route.ts");
    expect(source).not.toContain("proof_url: row.proof_url");
  });

  it("sepadan dengan endpoint kembarannya GET /api/orders?code=", () => {
    // Keduanya melayani /pesanan/[code]; bila satu memasang pagar PII, yang
    // lain tidak boleh jadi jalan pintas.
    const bySegment = read("src/app/api/orders/[code]/route.ts");
    const byQuery = read("src/app/api/orders/route.ts");
    for (const source of [bySegment, byQuery]) {
      expect(source).toContain("waMasked");
      expect(source).toContain("emailMasked");
    }
    expect(bySegment).not.toMatch(/proof_url:\s*row\./);
    expect(byQuery).not.toMatch(/proof_url:\s*row\./);
  });

  it("menyimpan bukti hanya di balik viewer admin", () => {
    // Satu-satunya pembaca objek bukti adalah route admin yang wajib login.
    const viewer = read("src/app/api/admin/bukti/[...key]/route.ts");
    expect(viewer).toContain("requireAdmin");
    expect(viewer).toContain('key.startsWith("bukti/")');
  });
});
