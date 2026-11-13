// tests/pedia-payment-dispatch.integration.test.ts — Fase B (2026-11-07):
// membuktikan transisi PAID bersama (gateway/crypto) berlaku untuk
// order_kind='pedia' dan memicu processPediaPaidOrders; underpaid/late crypto
// TIDAK menjadi paid sehingga dispatch tidak berjalan (manual review).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { transitionPendingPaymentToPaid } from "@/lib/db/orders-transition";

const fixtures: ReturnType<typeof createD1Fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const GATEWAY_CODE = "AXP-20261107-GATEWAY1";
const CRYPTO_CODE = "AXP-20261107-CRYPTO01";
const UNDERPAID_CODE = "AXP-20261107-UNDERPD1";
const LATE_CODE = "AXP-20261107-LATEPAY1";

async function seed() {
  const f = createD1Fixture();
  fixtures.push(f);
  const db = createDatabaseAccess();
  f.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active)
    VALUES(1,'followers-instagram','instagram','followers','profile','Followers Instagram','[100]',1,1);
    INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active)
    VALUES(1,1,'standar','indosmm',86,'G3',0,1000,0,1);
    INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present,api_refill)
    VALUES('indosmm',86,'IG','IG','Default',46000,100,1000,1,0);`);
  await db.execRun(`UPDATE pedia_supplier_services SET present=1 WHERE supplier='indosmm' AND service_id=86`);
  // deskripsi resmi `ok` diperlukan untuk jalur jual baru.
  return f;
}

function seedPediaOrder(f: ReturnType<typeof createD1Fixture>, code: string, paymentMethod: string, expires = "+15 minutes") {
  f.sql.prepare(`INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,
      sales_channel,order_kind,payment_status,expires_at,buyer_access_version,buyer_access_format)
    VALUES(?,?, 'Buyer','6281234567890','buyer@example.com','[]',250000,?,?,'pending','web','pedia','pending',datetime('now',?),1,'pin6')`)
    .run(code, `pedia:${code}`, paymentMethod, paymentMethod.startsWith("nowpayments") ? "NOWPayments" : "Sekalipay", expires);
  f.sql.prepare(`INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,credit_used,
      supplier,supplier_service_id,supplier_rate_snapshot,status,submit_attempts)
    VALUES(?,1,1,'{}','https://www.instagram.com/x/','https://www.instagram.com/x/',100,2500,250000,0,'indosmm',86,46000,'queued',0)`)
    .run(code);
}

function gatewayTx(f: ReturnType<typeof createD1Fixture>, code: string, late = false) {
  const fee = 1500;
  f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,
      gateway_channel,gateway_label,gateway_estimated_fee,gateway_fee,payable_amount,gateway_is_sandbox,gateway_fee_consent_required,
      gateway_fee_consented_at,provider_payment_id,expires_at)
    VALUES(?, 'sekalipay_gateway','merchant',?,'sekalipay_gateway',250000,'pending','SHOPEEPAY','ShopeePay',?,?,?,0,1,datetime('now'),
      ?,datetime('now',?))`)
    .run(code, code, fee, fee, 250000 + fee, `INV-${code}`, late ? "-1 minute" : "+10 minutes");
  f.sql.prepare(`INSERT INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code)
    VALUES(?, 'hash', ?, '{}', 'sekalipay_gateway','received',?)`)
    .run(`sekalipaygw:INV-${code}:paid`, 250000 + fee, code);
  return f.sql.prepare("SELECT id FROM dana_webhook_events WHERE order_code=?").get(code) as { id: number };
}

function cryptoTx(f: ReturnType<typeof createD1Fixture>, code: string, honestlyPaid = "12.50") {
  f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,currency,
      price_amount_text,price_currency,pay_currency,pay_network,provider_payment_id,pay_address,pay_amount_text,actually_paid_text,
      provider_status_text,fee_paid_by_user,fixed_rate,status,expires_at,fx_rate_text,fx_effective_at)
    VALUES(?, 'nowpayments','hosted',?,'nowpayments',250000,'IDR','15.87','usd','btc','btc',?,'bc1qfixture','12.50',?, 'waiting',0,0,'pending',datetime('now','+10 minutes'),'16000/1',?)`)
    .run(code, code, `np-${code.slice(-4)}`, honestlyPaid, new Date().toISOString());
  f.sql.prepare(`INSERT INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code)
    VALUES(?, 'hash', 250000, '{}', 'nowpayments','received',?)`)
    .run(`nowpayments:np-${code.slice(-4)}:finished`, code);
  return f.sql.prepare("SELECT id FROM dana_webhook_events WHERE order_code=?").get(code) as { id: number };
}

const caller = () => vi.fn(async () => ({ ok: true as const, data: { order: "SUP-1" }, status: 200 } as never));

describe("Pedia paid → dispatch untuk rail gateway/crypto", () => {
  it("gateway paid (transisi bersama) → order lunas, item queued, dispatch berjalan", async () => {
    const f = await seed();
    seedPediaOrder(f, GATEWAY_CODE, "sekalipay_gateway:SHOPEEPAY");
    const event = gatewayTx(f, GATEWAY_CODE);
    const paidAt = new Date().toISOString();
    const changed = await transitionPendingPaymentToPaid(GATEWAY_CODE, paidAt, null, { id: event.id }, { paymentMethod: "sekalipay_gateway", eventMode: "gateway" });
    expect(changed).toBe(true);
    expect(f.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(GATEWAY_CODE)).toMatchObject({ status: "lunas", payment_status: "paid" });

    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const call = caller();
    const out = await processPediaPaidOrders(call as never);
    expect(out.dispatched).toBe(1);
    expect(call).toHaveBeenCalled();
    expect(f.sql.prepare("SELECT status,supplier_order_id FROM pedia_order_items WHERE order_code=?").get(GATEWAY_CODE))
      .toMatchObject({ status: "submitted", supplier_order_id: "SUP-1" });
  });

  it("crypto paid (transisi bersama) → order lunas, item queued, dispatch berjalan", async () => {
    const f = await seed();
    seedPediaOrder(f, CRYPTO_CODE, "nowpayments:btc");
    const event = cryptoTx(f, CRYPTO_CODE, "12.50");
    const changed = await transitionPendingPaymentToPaid(CRYPTO_CODE, new Date().toISOString(), null, { id: event.id }, { paymentMethod: "crypto", eventMode: "received_text" });
    expect(changed).toBe(true);
    expect(f.sql.prepare("SELECT status,payment_status,payment_method FROM orders WHERE code=?").get(CRYPTO_CODE))
      .toMatchObject({ status: "lunas", payment_status: "paid", payment_method: "crypto" });

    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const out = await processPediaPaidOrders(caller() as never);
    expect(out.dispatched).toBe(1);
    expect(f.sql.prepare("SELECT status FROM pedia_order_items WHERE order_code=?").get(CRYPTO_CODE)).toMatchObject({ status: "submitted" });
  });
});

describe("Pedia crypto underpaid/late tidak pernah paid → tanpa dispatch", () => {
  const remote = (code: string, over: Record<string, unknown> = {}) => ({
    payment_id: `np-${code.slice(-4)}`, order_id: code, price_amount: "15.87", price_currency: "usd",
    pay_currency: "btc", network: "btc", payment_status: "finished", pay_amount: "12.50",
    actually_paid: "12.50", updated_at: new Date().toISOString(), ...over,
  });
  const reconcileWith = async (code: string, status: Record<string, unknown>) => {
    vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture-key");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) return Response.json(status);
      throw new Error(`unexpected ${String(url)}`);
    }));
    const { reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    return reconcileNowpaymentsPayment(code);
  };

  it("underpaid: manual review, order tetap pending, dispatch 0", async () => {
    const f = await seed();
    seedPediaOrder(f, UNDERPAID_CODE, "nowpayments:btc");
    cryptoTx(f, UNDERPAID_CODE, "12.50");
    expect(await reconcileWith(UNDERPAID_CODE, remote(UNDERPAID_CODE, { actually_paid: "1.00" }))).toBe("manual_review");
    expect(f.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(UNDERPAID_CODE)).toMatchObject({ status: "pending", payment_status: "pending" });
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const call = caller();
    const out = await processPediaPaidOrders(call as never);
    expect(out.dispatched).toBe(0);
    expect(call).not.toHaveBeenCalled();
    expect(f.sql.prepare("SELECT status FROM pedia_order_items WHERE order_code=?").get(UNDERPAID_CODE)).toMatchObject({ status: "queued" });
  });

  it("late (order sudah kedaluwarsa walau provider finished): manual review tanpa dispatch", async () => {
    const f = await seed();
    seedPediaOrder(f, LATE_CODE, "nowpayments:btc", "-1 minute");
    cryptoTx(f, LATE_CODE, "12.50");
    expect(await reconcileWith(LATE_CODE, remote(LATE_CODE))).toBe("manual_review");
    expect(f.sql.prepare("SELECT status FROM orders WHERE code=?").get(LATE_CODE)).toMatchObject({ status: "pending" });
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const out = await processPediaPaidOrders(caller() as never);
    expect(out.dispatched).toBe(0);
  });
});
