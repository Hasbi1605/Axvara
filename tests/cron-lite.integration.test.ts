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

  it("tidak ada impor statis modul berat di tingkat atas", () => {
    const src = readFileSync("src/app/api/cron/lite/route.ts", "utf8");
    const staticImports = src.split("\n").filter((l) => /^import /.test(l)).join("\n");
    expect(staticImports).not.toMatch(/telegram|whatsapp|fulfillment|warung-rebahan|sekalipay|payments/);
  });
});
