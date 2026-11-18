// tests/pedia-payment-security.integration.test.ts — Fase B (2026-11-07).
// Keamanan rail pembayaran bersama untuk pesanan Pedia (AXP-…):
//  1. consent gateway: kontak salah/tanpa kontak/total stale/format pin6,
//  2. callback Sekalipay: signature valid/invalid + kode tak dikenal,
//  3. IPN NOWPayments: HMAC valid/invalid,
//  4. kode cacat (AXQ-…, AXP-x) ditolak ketiga route.
// Tidak ada panggilan jaringan/produksi: provider di-mock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { gatewayHmac } from "@/lib/payments/sekalipay-gateway";
import { canonicalStringify } from "@/lib/payments/nowpayments";

const fixtures: ReturnType<typeof createD1Fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => { clearRateLimitBucketsForTest(); vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "pedia-security-secret"); vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true"); vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "fixture-gw-key"); vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-secret"); vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "fixture-ipn-secret"); vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture-np-key"); });

const WA = "081234567890", EMAIL = "buyer@example.com";
const GATEWAY_CODE = "AXP-20261107-GW000001";
const CRYPTO_CODE = "AXP-20261107-NP000001";

/** Order Pedia pin6 (seperti yang dibuat route orders) + produk/tier untuk dispatch. */
function seedPediaOrder(f: ReturnType<typeof createD1Fixture>, code: string, paymentMethod: string) {
  f.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active)
    VALUES(1,'followers-instagram','instagram','followers','profile','Followers','[100]',1,1);
    INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active)
    VALUES(1,1,'standar','indosmm',86,'G3',0,1000,0,1);
    INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present,api_refill)
    VALUES('indosmm',86,'IG','IG','Default',46000,100,1000,1,0);`);
  f.sql.prepare(`INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,
      sales_channel,order_kind,payment_status,expires_at,buyer_access_version,buyer_access_format)
    VALUES(?,?, 'Buyer',?,?,'[]',10000,?,?,'pending','web','pedia','pending',datetime('now','+15 minutes'),1,'pin6')`)
    .run(code, `pedia:${code}`, WA, EMAIL, paymentMethod, paymentMethod.startsWith("nowpayments") ? "NOWPayments" : "Sekalipay");
  f.sql.prepare(`INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,credit_used,
      supplier,supplier_service_id,supplier_rate_snapshot,status,submit_attempts)
    VALUES(?,1,1,'{}','https://www.instagram.com/x/','https://www.instagram.com/x/',100,100,10000,0,'indosmm',86,46000,'queued',0)`)
    .run(code);
}

/** Fixture gateway memakai adapter asli (POST create + GET status di-mock). */
async function seedGatewayOrder(f: ReturnType<typeof createD1Fixture>, code = GATEWAY_CODE) {
  seedPediaOrder(f, code, "sekalipay_gateway:TESTVA");
  const invoice = {
    merchant_ref_id: code, invoice: `INV-${code.slice(-6)}`, amount: 10000, fee: 4700, total: 14700,
    payment_code: "TESTVA", payment_link: `https://sekalipay.com/payment/INV-${code.slice(-6)}`,
    virtual_account: "1234567890", checkout_url: null,
    expired_at: new Date(Date.now() + 10 * 60_000).toISOString(), status: "pending", is_sandbox: false,
  };
  const statusInvoice = { ...invoice };
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("payment-methods")) {
      return Response.json({ status: true, data: [{ payment_code: "TESTVA", payment_name: "VA", payment_type: "va", min_amount: 1000, max_amount: 100000, fee_info: { type: "flat", description: "Rp 4.700" } }] });
    }
    return Response.json({ status: true, data: init?.method === "POST" ? invoice : statusInvoice }, { status: init?.method === "POST" ? 201 : 200 });
  }));
  const { createSekalipayGatewayInvoice } = await import("@/lib/payments/sekalipay-gateway");
  const view = await createSekalipayGatewayInvoice(code, 10000, "TESTVA", { name: "Buyer", email: EMAIL, phone: WA }, 4700);
  // Paksa tahap persetujuan biaya (flag consent tanpa consent tercatat).
  f.sql.prepare("UPDATE payment_transactions SET gateway_fee_consent_required=1, gateway_fee_consented_at=NULL WHERE order_code=?").run(code);
  return { invoice, statusInvoice, view };
}

const consent = (code: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  import("@/app/api/orders/[code]/payment-consent/route").then(({ POST }) =>
    POST(new NextRequest(`http://localhost/api/orders/${code}/payment-consent`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ code }) }));

const consentRow = (f: ReturnType<typeof createD1Fixture>, code: string) =>
  f.sql.prepare("SELECT gateway_fee_consented_at,payable_amount FROM payment_transactions WHERE order_code=?").get(code) as { gateway_fee_consented_at: string | null; payable_amount: number };

describe("Consent gateway untuk pesanan Pedia (pin6, tanpa PIN)", () => {
  it("kontak salah ditolak seperti Market (404 access_required), consent tidak tercatat", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    await seedGatewayOrder(f);
    const res = await consent(GATEWAY_CODE, { contact: "6289999999999", expected_final_total: 14700 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Pesanan tidak ditemukan atau kode akses/kontak tidak cocok.",
      reason: "access_required",
    });
    expect(consentRow(f, GATEWAY_CODE).gateway_fee_consented_at).toBeNull();
  });

  it("tanpa kontak → 400 (bukan 404), consent tidak tercatat", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    await seedGatewayOrder(f);
    const res = await consent(GATEWAY_CODE, { expected_final_total: 14700 });
    expect(res.status).toBe(400);
    expect(consentRow(f, GATEWAY_CODE).gateway_fee_consented_at).toBeNull();
  });

  it("kontak checkout benar (WA/email) → 200 dengan payment pending + tautan kanonis", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    await seedGatewayOrder(f);
    const res = await consent(GATEWAY_CODE, { contact: WA, expected_final_total: 14700 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payment).toMatchObject({ kind: "gateway", state: "pending", total: 14700 });
    expect(body.payment.payment_link).toMatch(/^https:\/\/sekalipay\.com\//);
    expect(consentRow(f, GATEWAY_CODE).gateway_fee_consented_at).toBeTruthy();
    // Email checkout (case-insensitive) juga diterima — kontak bukan PIN.
    const f2 = createD1Fixture(); fixtures.push(f2);
    await seedGatewayOrder(f2);
    const byEmail = await consent(GATEWAY_CODE, { contact: "BUYER@EXAMPLE.COM", expected_final_total: 14700 });
    expect(byEmail.status).toBe(200);
  });

  it("expected_final_total stale → 409 tanpa menyetujui", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    await seedGatewayOrder(f);
    const res = await consent(GATEWAY_CODE, { contact: WA, expected_final_total: 14000 });
    expect(res.status).toBe(409);
    expect(consentRow(f, GATEWAY_CODE).gateway_fee_consented_at).toBeNull();
  });

  it("pin6 Pedia tetap lewat requiresOrderAccessCode/newOrderAccessFailure: kode order valid tapi tanpa kontak/PIN tetap ditolak", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    await seedGatewayOrder(f);
    const { requiresOrderAccessCode, deriveOrderAccessCode } = await import("@/lib/order-access");
    const row = f.sql.prepare("SELECT code,buyer_access_version,buyer_access_format FROM orders WHERE code=?").get(GATEWAY_CODE) as never;
    expect(requiresOrderAccessCode(row)).toBe(true);
    const pin = await deriveOrderAccessCode(row);
    expect(pin).toMatch(/^[A-Z0-9]{6}$/);
    // PIN 6 char bukan kontak checkout → tidak memberi akses ke rute consent.
    const res = await consent(GATEWAY_CODE, { contact: pin, expected_final_total: 14700 });
    expect(res.status).toBe(404);
    expect(consentRow(f, GATEWAY_CODE).gateway_fee_consented_at).toBeNull();
  });

  it("rate limit consent (orders:lookup, 20/menit) tetap berlaku sebelum menyentuh order", async () => {
    createD1Fixture().close();
    const code = "AXP-20260101-ZZZZZZZZ";
    for (let i = 0; i < 20; i++) {
      const res = await consent(code, { contact: WA, expected_final_total: 14700 });
      expect(res.status).toBe(404);
    }
    const limited = await consent(code, { contact: WA, expected_final_total: 14700 });
    // Perilaku Market dipertahankan: 429 tanpa header Retry-After di rute ini.
    expect(limited.status).toBe(429);
  });

  it("kode tak dikenal / cacat / rate-limit guard tetap: 404 generik untuk AXP-valid tak ada, 400 untuk AXQ & AXP-x tanpa body", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    const unknown = await consent("AXP-20260101-ZZZZZZZZ", { contact: WA, expected_final_total: 14700 });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ reason: "access_required" });
    for (const bad of ["AXQ-20261107-GW000001", "AXP-x"]) {
      const res = await consent(bad, {});
      expect(res.status).toBe(400);
    }
  });
});

describe("Callback Sekalipay untuk pesanan Pedia", () => {
  const callback = async (raw: string, badSignature = false) => {
    const signature = badSignature ? "0".repeat(64) : await gatewayHmac("fixture-secret", raw);
    const { POST } = await import("@/app/api/payments/sekalipay-gateway/callback/route");
    return POST(new NextRequest("https://axvara.test/api/payments/sekalipay-gateway/callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body: raw,
    }));
  };

  it("signature valid → order Pedia lunas + immediate dispatch; incomplete supplier fixture needs review", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    const { invoice, statusInvoice } = await seedGatewayOrder(f);
    Object.assign(statusInvoice, { status: "paid", paid_at: new Date().toISOString() });
    // Consent fee wajib sebelum callback paid (aturan Market): tanpa itu = manual review.
    const { confirmGatewayFee } = await import("@/lib/payments/sekalipay-gateway");
    expect(await confirmGatewayFee(GATEWAY_CODE, 14700)).toBe(true);
    const raw = JSON.stringify({
      merchant_ref_id: invoice.merchant_ref_id, invoice: invoice.invoice, amount: invoice.amount,
      fee: invoice.fee, total: invoice.total, status: "paid", paid_at: "2026-11-07 09:00:00",
    });
    const res = await callback(raw);
    expect(res.status).toBe(200);
    expect(f.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(GATEWAY_CODE))
      .toMatchObject({ status: "lunas", payment_status: "paid" });
    expect(f.sql.prepare("SELECT status,submit_attempts FROM pedia_order_items WHERE order_code=?").get(GATEWAY_CODE)).toMatchObject({ status: "needs_check", submit_attempts: 1 });
  });

  it("signature salah ditolak 401 tanpa mengubah order", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    const { invoice, statusInvoice } = await seedGatewayOrder(f);
    Object.assign(statusInvoice, { status: "paid" });
    const raw = JSON.stringify({
      merchant_ref_id: invoice.merchant_ref_id, invoice: invoice.invoice, amount: invoice.amount,
      fee: invoice.fee, total: invoice.total, status: "paid", paid_at: "2026-11-07 09:00:00",
    });
    expect((await callback(raw, true)).status).toBe(401);
    expect(f.sql.prepare("SELECT status FROM orders WHERE code=?").get(GATEWAY_CODE)).toMatchObject({ status: "pending" });
  });

  it("kode AXP tak dikenal ditangani sama seperti AXV (404 transaction_not_found), kode cacat 400", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    const base = { amount: 10000, fee: 4700, total: 14700, status: "paid", paid_at: "2026-11-07 09:00:00", invoice: "INV-UNKNOWN" };
    const unknown = await callback(JSON.stringify({ ...base, merchant_ref_id: "AXP-20260101-ZZZZZZZZ" }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "transaction_not_found" });
    for (const bad of ["AXQ-20261107-GW000001", "AXP-x"]) {
      const res = await callback(JSON.stringify({ ...base, merchant_ref_id: bad }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_callback" });
    }
  });
});

describe("IPN NOWPayments untuk pesanan Pedia", () => {
  const sign = async (body: Record<string, unknown>) => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture-ipn-secret"), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalStringify(body)));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  };
  const ipn = async (body: Record<string, unknown>, signature?: string) =>
    import("@/app/api/payments/nowpayments/ipn/route").then(({ POST }) =>
      POST(new NextRequest("https://axvara.test/api/payments/nowpayments/ipn", {
        method: "POST", headers: { "content-type": "application/json", "x-nowpayments-sig": signature ?? "" },
        body: JSON.stringify(body),
      })));

  function cryptoTx(f: ReturnType<typeof createD1Fixture>, code: string) {
    const paymentId = `np-${code.slice(-4)}`;
    f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,currency,
        price_amount_text,price_currency,pay_currency,pay_network,provider_payment_id,pay_address,pay_amount_text,
        fee_paid_by_user,fixed_rate,status,expires_at,fx_rate_text,fx_effective_at)
      VALUES(?, 'nowpayments','hosted',?,'nowpayments',10000,'IDR','12.50','usd','btc','btc',?,'bc1qfixture','0.00021',0,0,'pending',datetime('now','+10 minutes'),'16000/1',?)`)
      .run(code, code, paymentId, new Date().toISOString());
    return paymentId;
  }

  it("HMAC valid → reconcile paid (finished + gross cukup) dan order Pedia lunas", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    seedPediaOrder(f, CRYPTO_CODE, "nowpayments:btc");
    const paymentId = cryptoTx(f, CRYPTO_CODE);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) {
        return Response.json({
          payment_id: paymentId, order_id: CRYPTO_CODE, price_amount: "12.50", price_currency: "usd",
          pay_currency: "btc", network: "btc", payment_status: "finished", pay_amount: "0.00021",
          actually_paid: "0.00021", updated_at: new Date().toISOString(),
        });
      }
      throw new Error(`unexpected ${String(url)}`);
    }));
    const body = { order_id: CRYPTO_CODE, payment_id: paymentId, payment_status: "finished" };
    const res = await ipn(body, await sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "received" });
    expect(f.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(CRYPTO_CODE))
      .toMatchObject({ status: "lunas", payment_status: "paid" });
    // Paid memicu dispatch (paid-fulfillment). Proxy tidak dikonfigurasi di test,
    // jadi item keluar dari 'queued' (needs_check) — bukti dispatch benar-benar berjalan.
    const item = f.sql.prepare("SELECT status FROM pedia_order_items WHERE order_code=?").get(CRYPTO_CODE) as { status: string };
    expect(item.status).not.toBe("queued");
  });

  it("HMAC salah ditolak 401 tanpa side effect; kode cacat 400", async () => {
    const f = createD1Fixture(); fixtures.push(f);
    seedPediaOrder(f, CRYPTO_CODE, "nowpayments:btc");
    const paymentId = cryptoTx(f, CRYPTO_CODE);
    const body = { order_id: CRYPTO_CODE, payment_id: paymentId, payment_status: "finished" };
    expect((await ipn(body, "0".repeat(128))).status).toBe(401);
    expect(f.sql.prepare("SELECT status FROM orders WHERE code=?").get(CRYPTO_CODE)).toMatchObject({ status: "pending" });
    for (const bad of ["AXQ-20261107-NP000001", "AXP-x"]) {
      const malformed = { order_id: bad, payment_id: paymentId, payment_status: "finished" };
      const res = await ipn(malformed, await sign(malformed));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_callback" });
    }
    const unknown = { order_id: "AXP-20260101-ZZZZZZZZ", payment_id: paymentId, payment_status: "finished" };
    const unknownRes = await ipn(unknown, await sign(unknown));
    expect([400, 404]).toContain(unknownRes.status);
  });
});
