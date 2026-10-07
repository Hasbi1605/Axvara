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
});
