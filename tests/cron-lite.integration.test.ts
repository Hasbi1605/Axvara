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
  it("tunvn_catalog is authenticated, gated, uses fresh FX and reports upstream failure without a success heartbeat",async () => {
    const fx=createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET","s"); vi.stubEnv("TUNVN_ENABLED","false");
      const fetcher=vi.fn(async()=>Response.json({success:false},{status:502})); vi.stubGlobal("fetch",fetcher);
      expect((await call("tunvn_catalog","wrong")).status).toBe(401);
      expect(await call("tunvn_catalog")).toMatchObject({status:200,body:{skipped:"not_configured"}});
      expect(fetcher).not.toHaveBeenCalled();
      fx.sql.exec("DELETE FROM store_settings WHERE key='cron_lite_tunvn_catalog_ok_at'; DELETE FROM crypto_market_snapshot");
      vi.stubEnv("TUNVN_ENABLED","true"); vi.stubEnv("TUNVN_SYNC_ENABLED","true");
      vi.stubEnv("TUNVN_API_KEY","fixture-only"); vi.stubEnv("TUNVN_BASE_URL","https://supplier.test");
      vi.stubEnv("USD_IDR_RATE","");
      expect(await call("tunvn_catalog")).toMatchObject({status:503,body:{error:"fx_unavailable"}});
      expect(fetcher).not.toHaveBeenCalled();
      fx.sql.prepare("INSERT INTO crypto_market_snapshot(id,fx_rate_text,fx_source,fx_effective_at) VALUES(1,'18086','nowpayments-estimate',?)").run(new Date().toISOString());
      expect(await call("tunvn_catalog")).toMatchObject({status:503,body:{error:"products_ambiguous"}});
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='cron_lite_tunvn_catalog_ok_at'").get()).toBeUndefined();
    } finally {fx.close(); vi.unstubAllGlobals();}
  });
  it("drains dirty product groups immediately after successful aivault_catalog, tunvn_catalog, and jaspay_catalog runs, while skipping on throttled/error and isolating drain failures", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("USD_IDR_RATE", "");
      fx.sql.prepare("INSERT INTO crypto_market_snapshot(id,fx_rate_text,fx_source,fx_effective_at) VALUES(1,'20000','nowpayments-estimate',?)").run(new Date().toISOString());
      fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,source,wr_product_id,wr_auto_managed) VALUES
        (1,'WR Item','wr-item',12000,10,1,'warung_rebahan','wr-1',1),
        (2,'SK Item','sk-item',15000,0,1,'manual','sk-1',1);
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,wr_variant_id,wr_auto_managed) VALUES
        (1,1,'WR-1','1M',12000,10,'manual',1,'wrv-1',1);
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,sk_variant_id,sk_auto_managed) VALUES
        (2,2,'SK-1','1M',15000,0,'manual',1,'skv-1',1);
        INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('wr-1','WR Item',1);
        INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class,wr_delivery_source) VALUES('wrv-1','wr-1','1M',9000,10,1,12000,'restock','api');
        INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price) VALUES('skv-1','sk-1','SK Item','1M',8000,0,'auto',2,2,15000);
        INSERT INTO product_groups(id,name,winner_product_id) VALUES(50,'Group 50',2);
        INSERT INTO product_group_members(group_id,product_id,position) VALUES(50,1,0),(50,2,1);`);

      // 1) aivault_catalog success drains dirty group 50 immediately
      vi.stubEnv("AIVAULT_ENABLED", "true");
      vi.stubEnv("AIVAULT_SYNC_ENABLED", "true");
      vi.stubEnv("AIVAULT_API_KEY", "fixture");
      vi.stubEnv("AIVAULT_BASE_URL", "https://aivault.test");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({
        currency: "USD",
        products: [{ service_id: "service_gemini_plus_6m", name: "Gemini Plus", stock: 5, custom_pricing: false, pricing_tiers: [{ min: 1, max: 100, price: 0.5 }] }],
      })));
      const av1 = await call("aivault_catalog");
      expect(av1.status).toBe(200);
      expect(av1.body).toMatchObject({ ok: true, pairs_decided: 1, pairs_changed: 1 });
      expect(fx.sql.prepare("SELECT winner_product_id AS w FROM product_groups WHERE id=50").get()?.w).toBe(1);

      // Throttled immediate re-run skips drain
      fx.sql.exec("UPDATE product_group_dirty SET pending=1 WHERE group_id=50");
      const avSkipped = await call("aivault_catalog");
      expect(avSkipped.status).toBe(200);
      expect(avSkipped.body).toMatchObject({ ok: true, skipped: "throttled" });
      expect(avSkipped.body.pairs_decided).toBeUndefined();
      expect(fx.sql.prepare("SELECT pending FROM product_group_dirty WHERE group_id=50").get()?.pending).toBe(1);

      // 2) tunvn_catalog success drains dirty group 50
      fx.sql.exec("UPDATE wr_variants SET wr_stock=0 WHERE wr_variant_id='wrv-1'; UPDATE product_variants SET stock=0 WHERE id=1; UPDATE sk_products SET sk_stock=5 WHERE sk_variant_id='skv-1'; UPDATE product_variants SET stock=5 WHERE id=2");
      vi.stubEnv("TUNVN_ENABLED", "true");
      vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
      vi.stubEnv("TUNVN_API_KEY", "fixture");
      vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
      vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).endsWith("/buff/check") ? {
        success: true, gross_cost_vnd: 390, sell_price_vnd: 390, sell_price_usdt: 0.0588, fundable: true,
        orders_breakdown: [{ invite_code: "AXVARA", quantity_b: 1, valid: true }],
      } : {
        success: true,
        products: [{ id: 86, name: "ACC CHAT GPT BUSINESS 1M(W1D)", price_vnd: 119_000, price_usdt: 4.6, discount_threshold: 0, discount_price_vnd: 0, discount_threshold_usdt: 0, discount_price_usdt: 0, stock: 5, description: "d" }],
      })));
      const tv1 = await call("tunvn_catalog");
      expect(tv1.status).toBe(200);
      expect(tv1.body).toMatchObject({ ok: true, pairs_decided: 1, pairs_changed: 1 });
      expect(fx.sql.prepare("SELECT winner_product_id AS w FROM product_groups WHERE id=50").get()?.w).toBe(2);

      // 3) jaspay_catalog: disabled skips drain; successful sync drains dirty group 50
      fx.sql.exec("UPDATE wr_variants SET wr_stock=4 WHERE wr_variant_id='wrv-1'; UPDATE product_variants SET stock=4 WHERE id=1; UPDATE sk_products SET sk_stock=0 WHERE sk_variant_id='skv-1'; UPDATE product_variants SET stock=0 WHERE id=2");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "false");
      vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "false");
      const jpSkipped = await call("jaspay_catalog");
      expect(jpSkipped.status).toBe(200);
      expect(jpSkipped.body.pairs_decided).toBeUndefined();

      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({
        success: true,
        data: [{ product: "zoom", name: "Zoom", description: "d", available: true, max_quantity: 10, packages: [{ id: 1, name: "1M", price: 10000, available: true }] }],
      })));
      const jpOk = await call("jaspay_catalog");
      expect(jpOk.status).toBe(200);
      expect(jpOk.body).toMatchObject({ ok: true, pairs_decided: 1, pairs_changed: 1 });
      expect(fx.sql.prepare("SELECT winner_product_id AS w FROM product_groups WHERE id=50").get()?.w).toBe(1);

      // 4) Non-QueryBudgetExceeded error inside drain does not fail the catalog job
      fx.sql.exec("UPDATE product_group_dirty SET pending=1 WHERE group_id=50");
      fx.sql.exec("DELETE FROM store_settings WHERE key='aivault_catalog_sync_at'");
      fx.control.fail = (q) => q.startsWith("UPDATE product_group_dirty");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({
        currency: "USD",
        products: [{ service_id: "service_gemini_plus_6m", name: "Gemini Plus", stock: 5, custom_pricing: false, pricing_tiers: [{ min: 1, max: 100, price: 0.5 }] }],
      })));
      const avFailDrain = await call("aivault_catalog");
      expect(avFailDrain.status).toBe(200);
      expect(avFailDrain.body).toMatchObject({ ok: true });
      expect(avFailDrain.body.pairs_decided).toBeUndefined();
      expect(fx.sql.prepare("SELECT pending FROM product_group_dirty WHERE group_id=50").get()?.pending).toBe(1);
    } finally {
      fx.control.fail = null;
      vi.unstubAllGlobals();
      fx.close();
    }
  });
  it("cleanup drains WR-only pair changes and retries a failed decision even when housekeeping is throttled", async () => {
    const fx=createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET","s");
      fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'WR','wr',1000,1),(2,'SK','sk',1000,0);
        INSERT INTO product_variants(id,product_id,sku,label,price,stock) VALUES(1,1,'WR','WR',1000,1),(2,2,'SK','SK',1000,0);
        INSERT INTO product_groups(id,name) VALUES(99,'Uji');
        INSERT INTO product_group_members(group_id,product_id,position) VALUES(99,1,0),(99,2,1)`);
      expect((await call("cleanup")).body).toMatchObject({ok:true,pairs_decided:1,pairs_changed:1});
      expect(fx.sql.prepare("SELECT winner_product_id AS winner FROM product_groups WHERE id=99").get()?.winner).toBe(1);
      fx.sql.exec("UPDATE product_variants SET stock=0 WHERE id=1; UPDATE product_variants SET stock=1 WHERE id=2");
      fx.control.fail=q=>q.startsWith("UPDATE product_groups");
      expect((await call("cleanup")).status).toBe(500);
      expect(fx.sql.prepare("SELECT pending FROM product_group_dirty WHERE group_id=99").get()?.pending).toBe(1);
      fx.control.fail=null;
      expect((await call("cleanup")).body).toMatchObject({ok:true,cleanup_skipped:"interval",pairs_decided:1});
      expect(fx.sql.prepare("SELECT winner_product_id AS winner FROM product_groups WHERE id=99").get()?.winner).toBe(2);
      expect((await call("cleanup")).body).toMatchObject({ok:true,pairs_decided:0});
    } finally {fx.close();}
  });
  it("games_orders: no-op 200 tanpa kredensial Digiflazz; kredensial rusak dengan antrean → 503", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("DIGIFLAZZ_USERNAME", "");
      vi.stubEnv("DIGIFLAZZ_API_KEY", "");
      expect(await call("games_orders")).toMatchObject({ status: 200, body: { ok: true, job: "games_orders", skipped: "not_configured" } });
      vi.stubEnv("DIGIFLAZZ_USERNAME", "u");
      vi.stubEnv("DIGIFLAZZ_API_KEY", "k");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.test");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "t");
      const idle = await call("games_orders");
      expect(idle).toMatchObject({ status: 200, body: { ok: true, job: "games_orders", idle: true } });
      expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='cron_lite_games_orders_ok_at'").get()).toBeTruthy();
      await insertTestProduct(fx.sql);
      insertTestOrder(fx.sql, "AXV-G-1", { status: "lunas", channel: "web" });
      fx.sql.exec(`INSERT INTO games_products(id,buyer_sku_code,product_name,cost) VALUES(1,'ml86','ML 86',19000);
        INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,unit_price,total,cost_snapshot,max_price,status)
        VALUES('AXV-G-1',1,'ml86','12345(6789)',20000,20000,19000,19500,'awaiting_payment')`);
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
      const broken = await call("games_orders");
      expect(broken.status).toBe(503);
      expect(broken.body).toMatchObject({ ok: false, job: "games_orders", error: "config:proxy_401" });
      // Config rusak tidak menghitung attempt gagal: item tetap queued, dapat dicoba lagi.
      expect(fx.sql.prepare("SELECT status FROM games_order_items WHERE order_code='AXV-G-1'").get()).toEqual({ status: "queued" });
    } finally { vi.unstubAllGlobals(); fx.close(); }
  });
  it("games_catalog: no-op 200 tanpa konfigurasi Sekalipay; kegagalan fetch → 503", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("SEKALIPAY_ENABLED", "");
      expect(await call("games_catalog")).toMatchObject({ status: 200, body: { ok: true, job: "games_catalog", skipped: "not_configured" } });
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_API_KEY", "k");
      vi.stubEnv("SEKALIPAY_PROXY_URL", "");
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
      const failed = await call("games_catalog");
      expect(failed.status).toBe(503);
      expect(failed.body).toMatchObject({ ok: false, error: "fetch_failed" });
    } finally { vi.unstubAllGlobals(); fx.close(); }
  });
  it("auth + validasi job", async () => {
    vi.stubEnv("CRON_SECRET", "s");
    expect((await call("expiry", "salah")).status).toBe(401);
    expect((await call("apa")).status).toBe(400);
    expect((await call(null)).status).toBe(400);
  });

  it.each(["dana", "klikqris"])("expiry: invoice %s lewat deadline order → kadaluarsa, stok dikembalikan, penanda tertulis", async provider => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      await insertTestProduct(fx.sql, "manual", 1);
      insertTestOrder(fx.sql, "AXV-20261005-LITE0001", { channel: "web", qty: 2 });
      fx.sql.prepare("UPDATE product_variants SET stock=98 WHERE id=1").run();
      fx.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run("AXV-20261005-LITE0001");
      fx.sql.prepare(`INSERT INTO payment_transactions (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at)
        VALUES (?,?,'dynamic','po-lite','m',10000,10000,'pending',datetime('now','-1 minute'))`).run("AXV-20261005-LITE0001", provider);

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

  it("expiry: ledger yatim order dibatalkan ditutup tanpa stok dobel dan tidak menyumbat pesanan hidup", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      await insertTestProduct(fx.sql, "manual", 1);
      // Enam ledger yatim meniru sumbatan produksi (deadline lebih lama dari
      // pesanan hidup): order sudah dibatalkan, stoknya sudah kembali ke 100.
      const orphanCodes: string[] = [];
      for (let i = 1; i <= 6; i++) {
        const code = `AXV-20261018-ORPHAN0${i}`;
        orphanCodes.push(code);
        insertTestOrder(fx.sql, code, { channel: "web", status: "dibatalkan" });
        fx.sql.prepare("UPDATE orders SET expires_at=datetime('now','-3 hours') WHERE code=?").run(code);
        fx.sql.prepare(`INSERT INTO payment_transactions (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at)
          VALUES (?,?,'dynamic',?,'m',10000,?,'pending',datetime('now','-3 hours'))`).run(code, i % 2 ? "gopay" : "klikqris", code, 10000 + i);
      }
      // Pesanan hidup yang terlewat deadline 15 menit (kasus AB4D407F):
      // stok varian sedang tereservasi (98 dari 100, qty 2).
      insertTestOrder(fx.sql, "AXV-20261018-LIVE00001", { channel: "web", qty: 2 });
      fx.sql.prepare("UPDATE product_variants SET stock=98 WHERE id=1").run();
      fx.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run("AXV-20261018-LIVE00001");
      fx.sql.prepare(`INSERT INTO payment_transactions (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at)
        VALUES ('AXV-20261018-LIVE00001','klikqris','dynamic','AXV-20261018-LIVE00001','m',10000,10099,'pending',datetime('now','-1 minute'))`).run();

      const res = await call("expiry");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, job: "expiry", expired_payments: 1, orphan_ledgers_swept: 6 });
      for (const code of orphanCodes) {
        const tx = fx.sql.prepare("SELECT status,last_error FROM payment_transactions WHERE order_code=?").get(code) as { status: string; last_error: string };
        expect(tx).toMatchObject({ status: "expired", last_error: "orphan_terminal_order" });
        expect((fx.sql.prepare("SELECT status FROM orders WHERE code=?").get(code) as { status: string }).status).toBe("dibatalkan");
      }
      const live = fx.sql.prepare("SELECT status FROM orders WHERE code=?").get("AXV-20261018-LIVE00001") as { status: string };
      expect(live.status).toBe("kadaluarsa");
      const liveTx = fx.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get("AXV-20261018-LIVE00001") as { status: string };
      expect(liveTx.status).toBe("expired");
      // 98 + 2 kembali = 100; yatim tidak menambah apa pun (bukan 112).
      const stock = fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get() as { stock: number };
      expect(stock.stock).toBe(100);

      // Idempoten: tick berikut tidak menutup atau melepas apa pun lagi.
      expect((await call("expiry")).body).toMatchObject({ expired_payments: 0, orphan_ledgers_swept: 0 });
      expect((fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get() as { stock: number }).stock).toBe(100);
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
    // Impor dinamis pertama rantai modul Pedia ~4,5 dtk saat dingin; batas
    // default 5 dtk membuat test ini flaky di full suite paralel.
  }, 20_000);

  // 2026-11-13 (owner): IndoSMM satu-satunya supplier — hanya saldo IndoSMM
  // yang dicek dari cron, tanpa panggilan ke supplier lama mana pun.
  it("pedia_orders: hanya memanggil saldo IndoSMM", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
      const fetch = vi.fn(async () => new Response(JSON.stringify({ balance: "250000", currency: "IDR" }), { status: 200, headers: { "content-type": "application/json" } }));
      vi.stubGlobal("fetch", fetch);
      expect((await call("pedia_orders")).status).toBe(200);
      const urls = fetch.mock.calls.map((c) => String((c as unknown[])[0]));
      expect(urls.filter((u) => u.includes("/balance")).every((u) => u.includes("/indosmm/"))).toBe(true);
      expect(urls.some((u) => u.includes("/indosmm/balance"))).toBe(true);
      expect(fx.sql.prepare("SELECT supplier FROM pedia_supplier_balance_log").all()).toEqual([{ supplier: "indosmm" }]);
      expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_indosmm_balance_success_at'").get()).toBeTruthy();
      expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_indosmm_balance_last_error'").get()).toEqual({ value: "" });

      // Failed balance fetch does not advance pedia_indosmm_balance_success_at and records pedia_indosmm_balance_last_error.
      const prevSuccess = fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_indosmm_balance_success_at'").get() as { value: string };
      fx.sql.exec("DELETE FROM store_settings WHERE key='pedia_indosmm_balance_checked_at'");
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
      const failedBal = await call("pedia_orders");
      expect(failedBal.status).toBe(200);
      expect(failedBal.body.indosmm_balance_error).toBe("http");
      expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_indosmm_balance_success_at'").get()).toEqual(prevSuccess);
      const balErr = fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_indosmm_balance_last_error'").get() as { value: string };
      expect(JSON.parse(balErr.value).error).toBe("http");
    } finally { vi.unstubAllGlobals(); fx.close(); }
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
  fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class,wr_delivery_source) VALUES('var-drama','prod-drama','3 Hari',10000,2,1,12000,'made_by_order','api')").run();
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
