// tests/cron-lite.integration.test.ts
//
// 2026-10-05: langkah cron INTI dipisah ke route ramping `/api/cron/lite`
// (route besar /api/cron/operations makan ±7–10 ms CPU hanya untuk menyala →
// 10–20% request per jam dibunuh `exceededResources` di Workers Free).
// Dikunci: auth konstan-waktu, job tak dikenal 400, expiry DANA lewat
// deadline → kadaluarsa + stok kembali, dan route tidak mengimpor statis
// modul berat (Telegram/WhatsApp/fulfillment) di tingkat atas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";

afterEach(() => vi.unstubAllEnvs());

async function call(job: string | null, secret = "s") {
  const { POST } = await import("@/app/api/cron/lite/route");
  const { NextRequest } = await import("next/server");
  const url = `http://localhost/api/cron/lite${job ? `?job=${job}` : ""}`;
  const res = await POST(new NextRequest(url, { method: "POST", headers: { authorization: `Bearer ${secret}` } }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe("/api/cron/lite", () => {
  it("auth + validasi job", async () => {
    vi.stubEnv("CRON_SECRET", "s");
    expect((await call("expiry", "salah")).status).toBe(401);
    expect((await call("apa")).status).toBe(400);
    expect((await call(null)).status).toBe(400);
  });

  it("expiry: invoice DANA lewat deadline order → kadaluarsa, stok dikembalikan, penanda tertulis", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      await insertTestProduct(fx.sql, "manual", 1);
      insertTestOrder(fx.sql, "AXV-20261005-LITE0001", { channel: "web", qty: 2 });
      fx.sql.prepare("UPDATE product_variants SET stock=98 WHERE id=1").run();
      fx.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run("AXV-20261005-LITE0001");
      fx.sql.prepare(`INSERT INTO payment_transactions (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at)
        VALUES (?,'dana','dynamic','po-lite','m',10000,10000,'pending',datetime('now','-1 minute'))`).run("AXV-20261005-LITE0001");

      const res = await call("expiry");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, job: "expiry", expired_payments: 1 });
      const order = fx.sql.prepare("SELECT status FROM orders WHERE code=?").get("AXV-20261005-LITE0001") as { status: string };
      expect(order.status).toBe("kadaluarsa");
      const stock = fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get() as { stock: number };
      expect(stock.stock).toBe(100);
      const mark = fx.sql.prepare("SELECT value FROM store_settings WHERE key='cron_lite_expiry_ok_at'").get();
      expect(mark).toBeTruthy();

      // Idempoten: run kedua tidak mengubah apa pun.
      expect((await call("expiry")).body).toMatchObject({ expired_payments: 0 });
    } finally {
      fx.close();
    }
  });

  it("WR/SK dimatikan → job orders no-op aman", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "false");
      vi.stubEnv("SEKALIPAY_ENABLED", "false");
      expect((await call("wr_orders")).body).toMatchObject({ ok: true, skipped: "disabled" });
      expect((await call("sk_orders")).body).toMatchObject({ ok: true, skipped: "disabled" });
    } finally {
      fx.close();
    }
  });

  it("pedia_orders: tanpa item → no-op + penanda tertulis", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      const { body } = await call("pedia_orders");
      expect(body).toMatchObject({ ok: true, job: "pedia_orders" });
      const mark = fx.sql.prepare("SELECT value FROM store_settings WHERE key='cron_lite_pedia_orders_ok_at'").get();
      expect(mark).toBeTruthy();
    } finally {
      fx.close();
    }
  });

  // 2026-10-05: digest promo ikut lite agar slot 09.00/17.00 tidak bergantung
  // pada route besar yang sering dibunuh limit CPU. Ledger dipakai bersama
  // fase notify → tidak pernah terkirim ganda.
  it("promo: slot sudah terkirim lengkap → skip tanpa kirim ulang", async () => {
    const fx = createD1Fixture();
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-05T02:10:00Z")); // 09.10 WIB, slot pagi
      for (const [k, v] of [["CRON_SECRET", "s"], ["TELEGRAM_PROMO_DIGEST_ENABLED", "true"], ["TELEGRAM_BOT_ENABLED", "true"], ["TELEGRAM_BOT_TOKEN", "t"], ["TELEGRAM_ADMIN_CHAT_ID", "-1"]]) vi.stubEnv(k, v);
      fx.sql.prepare(
        `INSERT INTO telegram_promo_digests (business_date, slot, product_ids, full_message_id, short_message_id)
         VALUES ('2026-10-05','morning','[]','330','331')`,
      ).run();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { body } = await call("promo");
      expect(body).toMatchObject({ ok: true, job: "promo", promo_due: true, promo_skipped: "already_sent" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      fx.close();
    }
  });

  it("notify & cleanup: aman dijalankan tanpa antrean; cleanup menghapus event DANA >30 hari", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      const n = await call("notify");
      expect(n.status).toBe(200);
      expect(n.body).toMatchObject({ ok: true, job: "notify" });
      // 2026-10-09: notify dipecah a/b — gabungan tetap 200 dengan kunci yang
      // sama, sub-job mandiri 200 + penanda masing-masing.
      const a = await call("notify_a");
      expect(a.status).toBe(200);
      expect(a.body).toMatchObject({ ok: true, job: "notify_a" });
      expect(a.body).toHaveProperty("telegram_retry");
      expect(a.body).toHaveProperty("invoice_retry");
      const b = await call("notify_b");
      expect(b.status).toBe(200);
      expect(b.body).toMatchObject({ ok: true, job: "notify_b" });
      expect(b.body).toHaveProperty("qris_expiry_notices");
      expect(b.body).toHaveProperty("pending_reminders");
      expect(b.body).toHaveProperty("whatsapp_outbox");
      expect(n.body).toHaveProperty("telegram_retry");
      expect(n.body).toHaveProperty("whatsapp_outbox");
      for (const key of ["cron_lite_notify_ok_at", "cron_lite_notify_a_ok_at", "cron_lite_notify_b_ok_at"]) {
        expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(key)).toBeTruthy();
      }
      fx.sql.exec("INSERT INTO dana_webhook_events (id, event_key, payload_hash, amount, status, created_at) VALUES (1,'old','h',1000,'matched',datetime('now','-40 days'))");
      const c = await call("cleanup");
      expect(c.status).toBe(200);
      expect(Number(c.body.rows_cleaned)).toBeGreaterThanOrEqual(1);
    } finally {
      fx.close();
    }
  });

  it("tidak ada impor statis modul berat di tingkat atas", () => {
    const src = readFileSync("src/app/api/cron/lite/route.ts", "utf8");
    const staticImports = src.split("\n").filter((l) => /^import /.test(l)).join("\n");
    expect(staticImports).not.toMatch(/telegram|whatsapp|fulfillment|warung-rebahan|sekalipay|payments/);
  });

  // 2026-10-09 (kasus AXV-20261009-DA1ACF56): order lunas yang link WR/SK-nya
  // gagal dibuat webhook + COUNT due = 0 → yatim selamanya karena gate due>0
  // menutup reconciler. Probe yatim WAJIB jalan tanpa gate due (lite selalu
  // jadi penjamin; route besar ikut pola yang sama via kunci respons).
  it("wr_orders: order lunas yatim tanpa link disembuhkan walau COUNT due = 0", async () => {
    const fx = createD1Fixture();
    try {
      stubWrYatim(fx);
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      // POST /order diblokir: tick ini hanya boleh MENYEMBUHKAN (buat link
      // pending), bukan memproses — link due dibuat jam ini juga tetap
      // diproses karena next_attempt_at=now.
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
      const { body } = await call("wr_orders");
      expect(body).toMatchObject({ ok: true, job: "wr_orders", orphan_links_healed: 1 });
      // Link yatim dibuat pending lalu langsung diproses tick yang sama
      // (retryFailedWrOrders hanya menyentuh status retry; processWrPending
      // mencoba POST → network down = timeout ambigu → submitted). Yang
      // dikunci: link ADA (tidak yatim lagi) — status akhir tergantung hasil
      // POST, bukan link yang hilang.
      const link = fx.sql.prepare("SELECT status FROM wr_order_links WHERE order_code='AXV-YATIM-WR'").get() as { status: string };
      expect(["pending", "retry", "submitted"]).toContain(link.status);
    } finally {
      fx.close();
    }
  });

  it("sk_orders: order lunas yatim tanpa link disembuhkan walau COUNT due = 0", async () => {
    const fx = createD1Fixture();
    try {
      stubSkYatim(fx);
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "true");
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
      const { body } = await call("sk_orders");
      expect(body).toMatchObject({ ok: true, job: "sk_orders", orphan_links_healed: 1 });
      // Cermin WR: link dibuat lalu langsung diproses tick yang sama
      // (network down → retry). Yang dikunci: link ADA, tidak yatim lagi.
      const link = fx.sql.prepare("SELECT status FROM sk_order_links WHERE order_code='AXV-YATIM-SK'").get() as { status: string };
      expect(["pending", "retry"]).toContain(link.status);
    } finally {
      fx.close();
    }
  });
});

/** Order lunas + katalog WR, TANPA baris wr_order_links (simulasi webhook yang gagal di langkah create-link). */
function stubWrYatim(fx: ReturnType<typeof createD1Fixture>) {
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id,wr_auto_managed) VALUES(1,'Drama','drama',12000,1,'warung_rebahan','prod-drama',1)").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id,wr_auto_managed) VALUES(1,1,'WR-D','3 Hari',12000,1,'manual','var-drama',1)").run();
  fx.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('prod-drama','Drama',1)").run();
  fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class,wr_delivery_source) VALUES('var-drama','prod-drama','3 Hari',10000,2,1,12000,'made_by_order','system')").run();
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at) VALUES('AXV-YATIM-WR','B','628',?,12000,'qris','lunas','paid','telegram',datetime('now'))`)
    .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "Drama — 3 Hari", price: 12000, qty: 1 }]));
}

/** Order lunas + katalog SK auto, TANPA baris sk_order_links. */
function stubSkYatim(fx: ReturnType<typeof createD1Fixture>) {
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,sk_product_id,sk_auto_managed) VALUES(1,'Zoom','zoom',4500,10,'manual','9',1)").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id,sk_auto_managed) VALUES(1,1,'SK-2','2 Minggu',4500,10,'manual','2',1)").run();
  fx.sql.prepare("INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price) VALUES('2','9','Zoom','2 Minggu',3000,10,'auto',1,1,4500)").run();
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at) VALUES('AXV-YATIM-SK','B','628',?,4500,'qris','lunas','paid','web',datetime('now'))`)
    .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "Zoom — 2 Minggu", price: 4500, qty: 1 }]));
}
