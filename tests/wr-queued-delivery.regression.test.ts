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
import { insertTestProduct } from "./helpers/d1-fixture";
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
  it("mengirim pemberitahuan + tautan invoice, BUKAN kredensialnya, tanpa footer /garansi", () => {
    const src = read("src/lib/warung-rebahan/deliver.ts");
    expect(src).toContain("notifyWebBuyerCredentialsReady");
    expect(src).toContain("wr-web-ready:");
    expect(src).toContain("/pesanan/${orderCode}");
    // Pemberitahuan web tidak boleh membawa plaintext kredensial.
    const fn = src.slice(src.indexOf("async function notifyWebBuyerCredentialsReady"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).not.toContain("plaintext");
    // Footer /garansi dihapus dari DM (keputusan owner 2026-09-18).
    expect(body).not.toContain("garansi");
    expect(body).toContain("WHATSAPP_ENABLED");
  });
});

describe("Fase B — kredensial 3 jalur (keputusan owner 2026-09-18)", () => {
  it("formatter: key 'akses otp'/URL dinormalisasi, bukan JSON mentah", async () => {
    const { formatWrAccountDetails } = await import("@/lib/warung-rebahan/deliver");
    const out = formatWrAccountDetails([
      { email: "angeloledner5912@gsmail.id", password: "@Masuk123", "akses otp": "https://gomail.id/angeloledner5912@gsmail.id" },
    ]);
    expect(out).toContain("Email: angelolvedner5912@gsmail.id".replace("angelolvedner", "angeloledner"));
    expect(out).toContain("Password: @Masuk123");
    expect(out).toContain("Akses OTP: https://gomail.id/");
    expect(out).not.toContain("{");
    // Key aneh tetap tampil rapi, bukan JSON.
    expect(formatWrAccountDetails([{ "Nama Pengguna": "budi" }])).toContain("Nama Pengguna: budi");
    // Null/aneh tidak meledak.
    expect(formatWrAccountDetails(null)).toBe("");
    expect(formatWrAccountDetails("plain-teks")).toBe("plain-teks");
  });

  it("template Detail Akun Siap: memuat isi + nol jejak supplier", async () => {
    const { buildCredentialReadyTemplate } = await import("@/lib/warung-rebahan/email-forward");
    const t = buildCredentialReadyTemplate({
      axvaraOrderCode: "AXV-20260918-95FC8669",
      buyerName: "hasbi",
      productNames: "Meitu Premium",
      details: "Email: a@b.c · Password: p",
      invoiceUrl: "https://axvara.tech/pesanan/AXV-20260918-95FC8669",
      supportWa: "089519388264",
    });
    expect(t.subject).toContain("sudah siap");
    expect(t.text).toContain("Email: a@b.c");
    expect(t.html).toContain("Email: a@b.c");
    expect(t.html).toContain("Jangan bagikan");
    for (const blob of [t.subject, t.text, t.html]) {
      const low = blob.toLowerCase();
      expect(low).not.toContain("warung");
      expect(low).not.toContain("rebahan");
      expect(low).not.toContain("supplier");
      expect(low).not.toContain("pemasok");
    }
  });

  it("delivery web mengantrekan isi WA (idempoten) + skip email bila tanpa alamat", async () => {
    const fx = createD1Fixture();
    try {
      await insertTestProduct(fx.sql, "manual", 1);
      fx.sql.prepare(
        `INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel)
         VALUES('AXV-20260918-WB0001','Buyer','628000000000',NULL,'[]',10000,'qris','lunas','paid','web')`,
      ).run();
      const { createDatabaseAccess } = await import("@/lib/db-access");
      const db = createDatabaseAccess(fx.db);
      const { deliverWebCredentialViaWhatsApp, deliverWebCredentialViaEmail } =
        await import("@/lib/warung-rebahan/deliver");
      vi.stubEnv("WHATSAPP_ENABLED", "true");
      vi.stubEnv("WHATSAPP_CREDENTIAL_DM_ENABLED", "true");
      const { enqueueWhatsAppMessage } = await import("@/lib/whatsapp/outbox");
      void enqueueWhatsAppMessage;
      await deliverWebCredentialViaWhatsApp("AXV-20260918-WB0001", "Email: a@b.c · Password: p", db);
      await deliverWebCredentialViaWhatsApp("AXV-20260918-WB0001", "Email: a@b.c · Password: p", db);
      const waRows = fx.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE idempotency_key LIKE '%wr-delivery:AXV-20260918-WB0001%'").get() as { n: number };
      expect(waRows.n).toBe(1);
      const body = fx.sql.prepare("SELECT payload FROM whatsapp_outbox WHERE idempotency_key LIKE '%wr-delivery:AXV-20260918-WB0001%'").get() as { payload: string };
      expect(body.payload).toContain("Email: a@b.c");
      // Footer /garansi dihapus dari DM kredensial (keputusan owner 2026-09-18):
      // perintah itu untuk grup (webhook /garansi), bukan DM buyer.
      expect(body.payload).not.toContain("garansi");
      expect(body.payload).toContain("JANGAN bagikan");
      // Tanpa email: skip diam, bukan error.
      await expect(deliverWebCredentialViaEmail("AXV-20260918-WB0001", "Email: a@b.c", db)).resolves.toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it("email kredensial idempoten: kirim 2x hanya 1 email keluar", async () => {
    const fx = createD1Fixture();
    try {
      await insertTestProduct(fx.sql, "manual", 1);
      fx.sql.prepare(
        `INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel)
         VALUES('AXV-20260918-WB0002','Buyer','628000000000','buyer@x.id','[]',10000,'qris','lunas','paid','web')`,
      ).run();
      vi.stubEnv("RESEND_API_KEY", "test-key");
      vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
      let calls = 0;
      vi.stubGlobal("fetch", vi.fn(async () => { calls++; return { ok: true, json: async () => ({ id: "em-1" }) }; }));
      const { createDatabaseAccess } = await import("@/lib/db-access");
      const db = createDatabaseAccess(fx.db);
      const { deliverWebCredentialViaEmail } = await import("@/lib/warung-rebahan/deliver");
      await deliverWebCredentialViaEmail("AXV-20260918-WB0002", "Email: a@b.c", db);
      await deliverWebCredentialViaEmail("AXV-20260918-WB0002", "Email: a@b.c", db);
      expect(calls).toBe(1);
      const log = fx.sql.prepare("SELECT COUNT(*) n FROM wr_email_forward_log WHERE gmail_message_id='wr-cred-email:AXV-20260918-WB0002'").get() as { n: number };
      expect(log.n).toBe(1);
    } finally {
      fx.close();
    }
  });

  it("hasil lacak order lunas + kredensial siap me-render panel (tanpa input WA ulang di server)", async () => {
    const page = read("src/app/lacak-pesanan/lacak-pesanan-client.tsx");
    expect(page).toContain("WrCredentialsPanel");
    expect(page).toContain("prefillWa");
    expect(page).toContain("order.credentialsReady");
    const lookup = read("src/app/api/orders/lookup/route.ts");
    expect(lookup).toContain("credentials_ready");
  });
});

describe("Kill-switch DM kredensial WA 19 Sep 2026 (flag mati = skip, kode utuh)", () => {
  it("flag mati: notify + deliver SKIP tanpa enqueue; delivery web tetap settled via token", async () => {
    const fx = createD1Fixture();
    try {
      await insertTestProduct(fx.sql, "manual", 1);
      fx.sql.prepare(
        `INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel)
         VALUES('AXV-20260919-KS0001','Buyer','628000000001',NULL,'[]',10000,'qris','lunas','paid','web')`,
      ).run();
      // Flag MATI (default): tidak di-stub.
      const { createDatabaseAccess } = await import("@/lib/db-access");
      const db = createDatabaseAccess(fx.db);
      const { deliverWebCredentialViaWhatsApp } = await import("@/lib/warung-rebahan/deliver");
      vi.stubEnv("WHATSAPP_ENABLED", "true");
      await deliverWebCredentialViaWhatsApp("AXV-20260919-KS0001", "Email: a@b.c", db);
      const n = fx.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE idempotency_key LIKE '%KS0001%'").get() as { n: number };
      expect(n.n).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("flag nyala: perilaku DM lama utuh (kode tidak dihapus)", async () => {
    const fx = createD1Fixture();
    try {
      await insertTestProduct(fx.sql, "manual", 1);
      fx.sql.prepare(
        `INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel)
         VALUES('AXV-20260919-KS0002','Buyer','628000000002',NULL,'[]',10000,'qris','lunas','paid','web')`,
      ).run();
      vi.stubEnv("WHATSAPP_CREDENTIAL_DM_ENABLED", "true");
      vi.stubEnv("WHATSAPP_ENABLED", "true");
      const { createDatabaseAccess } = await import("@/lib/db-access");
      const db = createDatabaseAccess(fx.db);
      const { deliverWebCredentialViaWhatsApp } = await import("@/lib/warung-rebahan/deliver");
      await deliverWebCredentialViaWhatsApp("AXV-20260919-KS0002", "Email: a@b.c", db);
      const n = fx.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE idempotency_key LIKE '%KS0002%'").get() as { n: number };
      expect(n.n).toBe(1);
    } finally {
      fx.close();
    }
  });

  it("fungsi DM masih ada di source (gate, bukan hapus)", () => {
    expect(read("src/lib/warung-rebahan/deliver.ts")).toContain("async function notifyWebBuyerCredentialsReady");
    expect(read("src/lib/warung-rebahan/deliver.ts")).toContain("export async function deliverWebCredentialViaWhatsApp");
    expect(read("src/lib/warung-rebahan/deliver.ts")).toContain("WHATSAPP_CREDENTIAL_DM_ENABLED");
  });
});
