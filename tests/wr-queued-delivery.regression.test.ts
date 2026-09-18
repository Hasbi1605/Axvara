// tests/wr-queued-delivery.regression.test.ts
//
// Keputusan owner 2026-09-18 (setelah konfirmasi estimasi upstream 6–12 jam):
// 1. Kelas antrean (made_by_order / belum dikunci) IKUT auto-order — sebelumnya
//    link-nya diam 'pending' selamanya dan pembeli menunggu tanpa ada yang
//    mengerjakan (lihat tests/warung-rebahan/order.test.ts untuk gate-nya).
// 2. Ekspektasi waktu ke pembeli TIDAK boleh "5–15 menit" untuk kelas antrean:
//    plafon publik 12 jam, disebut SEBELUM bayar (PDP/modal/checkout), bukan
//    hanya di halaman pesanan.
// 3. Nama pemasok tidak pernah muncul di copy pembeli, TAPI keterangan
//    "third-party independen" pada halaman ketentuan dipertahankan (dasar klaim
//    garansi + posisi hukum saat sengketa).
// 4. Ada peringatan internal bila satu order melewati ambang (13 jam) — plafon
//    pembeli 12 jam, ambang alert sengaja di atasnya agar tidak alert fatigue.

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  deliveryEtaForBuyer,
  deliveryLabelForBuyer,
  isQueuedFulfillment,
  WR_QUEUED_ALERT_HOURS,
  WR_QUEUED_MAX_HOURS,
} from "@/lib/warung-rebahan/delivery-class";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf-8");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("aturan kelas pengiriman (satu sumber)", () => {
  it("plafon publik 12 jam, ambang alert internal di atasnya", () => {
    expect(WR_QUEUED_MAX_HOURS).toBe(12);
    expect(WR_QUEUED_ALERT_HOURS).toBeGreaterThan(WR_QUEUED_MAX_HOURS);
  });

  it("kalimat ETA membedakan instan dan antrean, tanpa menyebut pemasok", () => {
    const instant = deliveryEtaForBuyer("restock");
    const queued = deliveryEtaForBuyer("made_by_order");
    expect(instant).toContain("otomatis");
    expect(queued).toContain("antrean");
    expect(queued).toContain(`${WR_QUEUED_MAX_HOURS} jam`);
    // Kelas antrean TIDAK boleh membawa janji menit.
    expect(queued).not.toMatch(/menit/i);
    for (const text of [instant, queued, deliveryLabelForBuyer("made_by_order")]) {
      expect(text.toLowerCase()).not.toContain("warung");
      expect(text.toLowerCase()).not.toContain("rebahan");
      expect(text.toLowerCase()).not.toContain("supplier");
      expect(text.toLowerCase()).not.toContain("pemasok");
    }
  });

  it("varian non-WR: shared/unique instan, manual ikut antrean", () => {
    expect(isQueuedFulfillment({ fulfillmentMode: "shared" })).toBe(false);
    expect(isQueuedFulfillment({ fulfillmentMode: "unique" })).toBe(false);
    expect(isQueuedFulfillment({ fulfillmentMode: "manual" })).toBe(true);
    // Varian WR: hanya restock yang instan, kelas kosong = antrean.
    expect(isQueuedFulfillment({ wrVariantId: "var-1", wrClass: "restock" })).toBe(false);
    expect(isQueuedFulfillment({ wrVariantId: "var-1", wrClass: "made_by_order" })).toBe(true);
    expect(isQueuedFulfillment({ wrVariantId: "var-1", wrClass: null })).toBe(true);
  });
});

describe("copy pembeli", () => {
  it("checkout memperingatkan waktu antrean SEBELUM bayar", () => {
    const checkout = read("src/app/checkout/page.tsx");
    expect(checkout).toContain("queuedNames");
    expect(checkout).toContain("Waktu pengerjaan pesanan ini");
    expect(checkout).toContain("WR_QUEUED_MAX_HOURS");
    expect(checkout).toContain("Bukan pengiriman instan");
    // Flag berasal dari quote server, bukan tebakan client.
    expect(checkout).toContain("qi.queued_delivery === true");
  });

  it("PDP + modal varian memakai label antrean, bukan 'Dikirim admin' yang samar", () => {
    for (const file of [
      "src/app/produk/[slug]/product-detail-client.tsx",
      "src/components/storefront/QuickVariantModal.tsx",
    ]) {
      const src = read(file);
      expect(src, file).not.toContain("Dikirim admin");
      expect(src, file).toContain("WR_QUEUED_MAX_HOURS");
    }
    // Modal menampilkan kalimat ETA persis di atas CTA beli.
    expect(read("src/components/storefront/QuickVariantModal.tsx")).toContain("deliveryEtaForBuyer(selected.wr_delivery_class)");
  });

  it("halaman ketentuan MEMPERTAHANKAN status third-party + garansi mulai saat diserahkan", () => {
    const page = read("src/app/garansi-replace/page.tsx");
    expect(page).toContain("third-party");
    expect(page).toContain("dikerjakan sesuai antrean");
    expect(page).toContain("bukan");
    expect(page.toLowerCase()).not.toContain("warung rebahan");
  });

  it("copy pembeli tidak pernah menyebut nama pemasok", () => {
    // Komentar/impor internal BOLEH menyebut pemasok (dokumentasi arsitektur);
    // yang dilarang adalah teks yang sampai ke pembeli. Jadi komentar dibuang
    // dulu sebelum diperiksa.
    const stripComments = (src: string) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
    for (const file of [
      "src/app/checkout/page.tsx",
      "src/app/pesanan/[code]/page.tsx",
      "src/app/produk/[slug]/product-detail-client.tsx",
      "src/components/storefront/QuickVariantModal.tsx",
      "src/lib/warung-rebahan/email-forward.ts",
    ]) {
      const lower = stripComments(read(file)).toLowerCase();
      expect(lower, file).not.toContain("warung rebahan");
      expect(lower, file).not.toContain("warungrebahan");
    }
  });
});

describe("peringatan umur antrean", () => {
  function seed(fx: ReturnType<typeof createD1Fixture>, code: string, hoursAgo: number) {
    fx.sql.prepare(
      `INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel)
       VALUES(?,'Buyer','628000000000','[]',10000,'qris','lunas','paid','web')`,
    ).run(code);
    fx.sql.prepare(
      `INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,request_sent_at)
       VALUES(?,?,'var-1',1,8000,'processing',datetime('now','-${hoursAgo} hours'))`,
    ).run(code, `RBHN-${code.slice(-4)}`);
  }

  it("order yang melewati ambang ditandai sekali (idempoten), yang masih normal tidak", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      seed(fx, "AXV-20260918-AGING001", WR_QUEUED_ALERT_HOURS + 2);
      seed(fx, "AXV-20260918-FRESH001", 3);
      const { alertAgingWrOrders } = await import("@/lib/warung-rebahan/order");
      const db = createDatabaseAccess(fx.db);
      expect(await alertAgingWrOrders(db)).toBe(1);
      // Jalan kedua tidak mengulang ping untuk baris yang sama.
      expect(await alertAgingWrOrders(db)).toBe(0);
      const rows = fx.sql
        .prepare("SELECT order_code, aging_alerted_at FROM wr_order_links ORDER BY id")
        .all() as { order_code: string; aging_alerted_at: string | null }[];
      const aged = rows.find((r) => r.order_code.endsWith("AGING001"));
      const fresh = rows.find((r) => r.order_code.endsWith("FRESH001"));
      expect(aged?.aging_alerted_at).toBeTruthy();
      expect(fresh?.aging_alerted_at).toBeNull();
    } finally {
      fx.close();
    }
  });

  it("order yang sudah selesai tidak pernah dialerti", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      seed(fx, "AXV-20260918-DONE0001", WR_QUEUED_ALERT_HOURS + 5);
      fx.sql.prepare("UPDATE wr_order_links SET status='completed'").run();
      const { alertAgingWrOrders } = await import("@/lib/warung-rebahan/order");
      expect(await alertAgingWrOrders(createDatabaseAccess(fx.db))).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("migrasi 0037 menambah penanda dan aman dijalankan pada skema final", () => {
    const migration = read("drizzle/migrations/0037_wr_aging_alert.sql");
    expect(migration).toContain("aging_alerted_at");
    // Skema bootstrap sudah memuat kolomnya (database baru tidak perlu migrasi).
    expect(read("drizzle/schema.sql")).toContain("aging_alerted_at");
  });
});

describe("kabar WA pembeli web saat akun siap", () => {
  it("mengirim pemberitahuan + tautan invoice, BUKAN kredensialnya", () => {
    const src = read("src/lib/warung-rebahan/deliver.ts");
    expect(src).toContain("notifyWebBuyerCredentialsReady");
    expect(src).toContain("wr-web-ready:");
    expect(src).toContain("/pesanan/${orderCode}");
    // Pemberitahuan web tidak boleh membawa plaintext kredensial.
    const fn = src.slice(src.indexOf("async function notifyWebBuyerCredentialsReady"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).not.toContain("plaintext");
    expect(body).toContain("WHATSAPP_ENABLED");
  });
});
