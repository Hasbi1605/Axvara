import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

it("the NOWPayments create path sends requests in workerd with manual-redirect policy and no secret leakage", async () => {
  const compiled = await build({
    stdin: {
      contents: `import {createNowpaymentsInvoice} from './src/lib/payments/nowpayments';
      import {buildCryptoOffer} from './src/lib/payments/crypto-preflight';
      import {loadFxSnapshot} from './src/lib/payments/fx';
      import {createCheckoutQuoteToken,verifyCheckoutQuoteToken} from './src/lib/auth';
      export default {async fetch(request,env){globalThis.fixtureDb=env.DB;try{
        const url=new URL(request.url);
        const code=url.searchParams.get('code');
        const coin={ticker:'usdtbsc',minUsdText:'0.08'};
        if(url.pathname==='/offer'){return Response.json(buildCryptoOffer(250000,loadFxSnapshot(),coin));}
        if(url.pathname==='/usd'){const offer=buildCryptoOffer(250000,loadFxSnapshot(),coin),signed=await createCheckoutQuoteToken({items:[{product_id:1,name:'fixture',price:250000,qty:1}],subtotal:250000,payment_methods:[{...offer,account_number:''}]}),method=(await verifyCheckoutQuoteToken(signed.token)).payment_methods[0],u=method.usd;return Response.json(await createNowpaymentsInvoice(code,250000,'usdtbsc',{payNetwork:'bsc',priceCurrency:'usd',feePayer:method.fee_payer,fixedRate:method.fixed_rate,expectedUsd:{cents:u.cents,priceText:method.amount_text,surchargeBps:method.surcharge_bps,surchargeCents:String(method.surcharge_cents),totalCents:String(method.total_cents),rateText:u.rate_text,rateNum:u.rate_num,rateDen:u.rate_den,effectiveAt:u.effective_at,idrSubtotal:u.idr_subtotal,payCurrency:u.pay_currency,network:u.network}}));}
        return Response.json(await createNowpaymentsInvoice(code,89000,'usdtbsc',{payNetwork:'bsc',priceCurrency:'idr'}));
      }catch(error){return Response.json({error:String(error&&error.message||error)},{status:503});}}};`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    define: {
      "process.env": JSON.stringify({
        NEXT_PUBLIC_PAYMENTS_MAINTENANCE: "false",
        NOWPAYMENTS_ENABLED: "true",
        NOWPAYMENTS_API_KEY: "fixture-key",
        NOWPAYMENTS_IPN_SECRET: "fixture-secret",
        NOWPAYMENTS_OUTCOME_CURRENCY: "usdtbsc",
        USD_IDR_RATE: "16000",
        USD_FX_EFFECTIVE_AT: new Date().toISOString(),
        ADMIN_JWT_SECRET: "fixture-jwt-secret",
      }),
    },
    plugins: [
      {
        name: "database-boundary",
        setup(builder) {
          builder.onResolve({ filter: /^@\/|^\.\/(paid-fulfillment|rails)$/ }, (args) => {
            if (args.path === "./paid-fulfillment" || args.path === "./rails") {
              return { path: args.path.slice(2), namespace: "fixture" };
            }
            if (args.path === "@/lib/db") return { path: "db", namespace: "fixture" };
            if (args.path === "@/lib/cloudflare-access") return { path: "access", namespace: "fixture" };
            if (["./dana-qris", "@/lib/fulfillment/deliver", "@/lib/warung-rebahan/order", "@/lib/sekalipay/order", "@/lib/pedia/dispatch", "@/lib/telegram/api"].includes(args.path)) {
              return { path: "unused", namespace: "fixture" };
            }
            if (args.path === "@/lib/site") {
              return { path: "site", namespace: "fixture" };
            }
            if (args.path === "@/lib/payment-maintenance" || args.path === "@/lib/security") {
              return { path: "edge", namespace: "fixture" };
            }
            return null;
          });
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
            if (args.path === "paid-fulfillment") {
              return { contents: `export const schedulePaidFulfillment=()=>{throw new Error('settlement not used by this runtime fixture');};` };
            }
            if (args.path === "access") return { contents: `export const checkCloudflareAccess=async()=>false;` };
            if (args.path === "rails") {
              return {
                contents: `export const isNowpaymentsConfigured=()=>typeof process!=='undefined'&&!!process.env&&process.env.NOWPAYMENTS_ENABLED==='true'&&Boolean(process.env.NOWPAYMENTS_API_KEY);export const isNowpaymentsReadable=()=>typeof process!=='undefined'&&!!process.env&&Boolean(process.env.NOWPAYMENTS_API_KEY);`,
              };
            }
            if (args.path === "site") {
              return { contents: `export const SITE={webUrl:'https://axvara.tech'};` };
            }
            if (args.path === "edge") {
              return {
                contents: `export const assertPaymentsAvailable=()=>{if(typeof process!=='undefined'&&process.env&&process.env.NEXT_PUBLIC_PAYMENTS_MAINTENANCE==='true')throw new Error('payment_maintenance');};export const constantTimeEqual=(a,b)=>a===b;`,
              };
            }
            if (args.path === "db") {
              return {
                contents: `
                export const getD1=()=>globalThis.fixtureDb;
                export const queryFirst=(sql,...p)=>getD1().prepare(sql).bind(...p).first();
                export const queryAll=async(sql,...p)=>(await getD1().prepare(sql).bind(...p).all()).results;
                export const execRun=async(sql,...p)=>({changes:(await getD1().prepare(sql).bind(...p).run()).meta.changes});
                export const transitionPendingPaymentToPaid=()=>{throw new Error('settlement not used by this runtime fixture');};
              `,
              };
            }
            return { contents: `export const unused=true;` };
          });
        },
      },
    ],
  });
  const requests: { url: string; method: string; apiKey: string | null }[] = [];
  let redirectPayment = false;
  let legacyMode = true;
  const fixedDeadline = new Date(Date.now() + 600_000).toISOString();
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text,
    d1Databases: ["DB"],
    outboundService: async (request: Request) => {
      requests.push({ url: request.url, method: request.method, apiKey: request.headers.get("x-api-key") });
      if (request.url.includes("/estimate?")) {
        if (legacyMode) {
          if (!request.url.includes("currency_from=idr")) throw new Error("workerd fixture must request idr pair in legacy mode");
          return Response.json({ estimated_amount: "0.011", currency_from: "idr", currency_to: "usdtbsc" });
        }
        if (!request.url.includes("currency_from=usd")) throw new Error("workerd fixture must request usd pair in USD mode");
        if (!request.url.includes("amount=15.87")) throw new Error("workerd fixture must request exact 15.87 USD (15.63 + biaya layanan per koin)");
        return Response.json({ estimated_amount: "15.87", currency_from: "usd", currency_to: "usdtbsc" });
      }
      if (request.url.includes("/min-amount?")) {
        if (!legacyMode && /is_fixed_rate|is_fee_paid_by_user/.test(request.url)) throw new Error("workerd fixture: min-amount must be the floating form");
        return Response.json({ min_amount: "0.0005", currency_from: "usdtbsc", currency_to: "usdtbsc" });
      }
      if (request.url === "https://api.nowpayments.io/v1/payment") {
        if (redirectPayment) {
          return new Response(null, { status: 302, headers: { location: "https://untrusted.example/steal" } });
        }
        const body = (await request.json()) as { order_id: string; price_currency: string; price_amount: string; is_fixed_rate: boolean; is_fee_paid_by_user: boolean };
        expect(body.order_id).toBe(legacyMode ? "AXV-20261103-WORKER01" : "AXV-20261103-WORKER03");
        if (legacyMode) {
          expect(body.price_currency).toBe("idr");
        } else {
          expect(body.price_currency).toBe("usd");
          expect(body.price_amount).toBe("15.87");
          expect(body.is_fixed_rate).toBe(false); expect(body.is_fee_paid_by_user).toBe(false);
          const db = await runtime.getD1Database("DB");
          expect(await db.prepare("SELECT fee_paid_by_user,fixed_rate,crypto_base_usd_cents,crypto_surcharge_usd_cents,crypto_surcharge_bps FROM payment_transactions WHERE order_code=?").bind(body.order_id).first()).toMatchObject({ fee_paid_by_user: 0, fixed_rate: 0, crypto_base_usd_cents: 1563, crypto_surcharge_usd_cents: 24, crypto_surcharge_bps: 100 });
        }
        const payload = JSON.stringify(
          {
            payment_id: legacyMode ? "NUMERIC_ID_FIXTURE" : "np-worker-3",
            pay_address: "TXYZworker",
            pay_amount: 0.011,
            pay_currency: "usdtbsc",
            price_amount: legacyMode ? 89000 : 15.87,
            price_currency: legacyMode ? "idr" : "usd",
            order_id: body.order_id,
            created_at: new Date().toISOString(),
            expiration_estimate_date: new Date(Date.now() + 900_000).toISOString(),
            ...(legacyMode ? {} : { is_fixed_rate: false, is_fee_paid_by_user: false, valid_until: fixedDeadline }),
          },
        ).replace('"NUMERIC_ID_FIXTURE"', "9007199254740993");
        return new Response(payload, { status: 201, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected outbound request ${request.url}`);
    },
  });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch([
      db.prepare(
        "CREATE TABLE orders(code TEXT PRIMARY KEY,status TEXT,payment_status TEXT,expires_at TEXT,payment_method TEXT,payment_account TEXT,updated_at TEXT,customer_wa TEXT)",
      ),
      db.prepare("CREATE TABLE operation_guards(operation_id TEXT PRIMARY KEY,valid INTEGER CHECK(valid=1))"),
      db.prepare(
        "CREATE TABLE payment_transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,order_code TEXT UNIQUE,provider TEXT,provider_mode TEXT,provider_order_id TEXT,merchant_id TEXT,requested_amount INTEGER,payable_amount INTEGER,unique_code INTEGER,status TEXT DEFAULT 'initializing',provider_signature TEXT,provider_qris_url TEXT,invoice_issued_at TEXT,expiry_notice_state TEXT,qris_url TEXT,qris_payload TEXT,direct_url TEXT,expires_at TEXT,paid_at TEXT,last_checked_at TEXT,last_error TEXT,currency TEXT DEFAULT 'IDR',pay_currency TEXT,pay_network TEXT,price_amount_text TEXT,price_currency TEXT,pay_amount_text TEXT,actually_paid_text TEXT,outcome_amount_text TEXT,outcome_currency TEXT,fee_paid_by_user INTEGER,fixed_rate INTEGER,provider_payment_id TEXT,pay_address TEXT,last_reconciled_at TEXT,provider_status_text TEXT,last_admin_alert_at TEXT,fx_rate_text TEXT,fx_effective_at TEXT,crypto_base_usd_cents INTEGER,crypto_surcharge_usd_cents INTEGER,crypto_surcharge_bps INTEGER,created_at TEXT,updated_at TEXT,UNIQUE(provider,provider_order_id))",
      ),
      db.prepare(
        "INSERT INTO orders(code,status,payment_status,expires_at) VALUES('AXV-20261103-WORKER01','pending','unpaid',?),('AXV-20261103-WORKER02','pending','unpaid',?),('AXV-20261103-WORKER03','pending','unpaid',?)",
      ).bind(new Date(Date.now() + 900_000).toISOString(), new Date(Date.now() + 900_000).toISOString(), new Date(Date.now() + 900_000).toISOString()),
    ]);
    const first = await runtime.dispatchFetch("https://axvara.tech/invoice?code=AXV-20261103-WORKER01");
    expect(first.status).toBe(200);
    const created = await first.json();
    expect(created).toMatchObject({ payCurrency: "usdtbsc", payAmountText: "0.011", providerPaymentId: "9007199254740993" });
    expect(JSON.stringify(created)).not.toContain("fixture-key");
    expect(JSON.stringify(created)).not.toContain("fixture-secret");
    expect(requests.filter((entry) => entry.url === "https://api.nowpayments.io/v1/payment")).toHaveLength(1);
    // Second call reuses the saved invoice: no second POST.
    expect((await runtime.dispatchFetch("https://axvara.tech/invoice?code=AXV-20261103-WORKER01")).status).toBe(200);
    expect(requests.filter((entry) => entry.url === "https://api.nowpayments.io/v1/payment")).toHaveLength(1);
    // Redirect on a fresh order is rejected without following upstream.
    redirectPayment = true;
    const redirected = await runtime.dispatchFetch("https://axvara.tech/invoice?code=AXV-20261103-WORKER02");
    expect(redirected.status).toBe(503);
    expect(await redirected.json()).toMatchObject({ error: "nowpayments_redirect_rejected" });
    // USD offer path in the same bundled runtime: no provider fetch,
    // exact 250000@16000 snapshot math (base 1563 cents + biaya per koin 24 cents => "15.87").
    legacyMode = false;
    redirectPayment = false;
    const offer = await runtime.dispatchFetch("https://axvara.tech/offer");
    expect(offer.status).toBe(200);
    expect(await offer.json()).toMatchObject({
      id: "nowpayments:usdtbsc",
      kind: "crypto",
      currency: "USD",
      amount_text: "15.87",
      pay_currency: "usdtbsc",
      network: "bsc",
      base_cents: 1563, surcharge_cents: 24, total_cents: 1587, surcharge_bps: 100, fee_payer: "merchant", fixed_rate: false,
      usd: { cents: "1563", rate_num: "16000", rate_den: "1", idr_subtotal: 250000 },
    });
    const usd = await runtime.dispatchFetch("https://axvara.tech/usd?code=AXV-20261103-WORKER03");
    expect(usd.status).toBe(200);
    expect(await db.prepare("SELECT fee_paid_by_user,fixed_rate,expires_at,price_amount_text FROM payment_transactions WHERE order_code='AXV-20261103-WORKER03'").first()).toMatchObject({ fee_paid_by_user: 0, fixed_rate: 0, expires_at: fixedDeadline, price_amount_text: "15.87" });
    expect(requests.filter((entry) => entry.url === "https://api.nowpayments.io/v1/payment")).toHaveLength(3);
  } finally {
    await runtime.dispose();
  }
});
