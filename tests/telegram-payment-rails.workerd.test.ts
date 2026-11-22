// tests/telegram-payment-rails.workerd.test.ts — R2-B real Miniflare/workerd proof (local only).
// Exercises ACTUAL Telegram new-protocol handlers (pmentry/pm/pgo/refresh)
// + real payq1 quote/claim/dispatch/consent/status + actual core NOW + gateway
// adapters against real D1 inside workerd. Telegram send/photo mocked inside
// the worker; provider HTTP mocked via outboundService. Minimal fixture DDL
// (honestly scoped, not migration coverage). No production hooks/secrets.
import { beforeAll, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { Miniflare } from "miniflare";

const TIERS = JSON.stringify([{ min_qty: 2, unit_price: 9500 }]);

const SETUP_STATEMENTS = [
  "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, price INTEGER NOT NULL, require_email INTEGER NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT -1, is_active INTEGER NOT NULL DEFAULT 1, telegram_enabled INTEGER NOT NULL DEFAULT 1, category_id INTEGER, sort_order INTEGER DEFAULT 0, description TEXT, whatsapp_alias TEXT, aliases TEXT, sold_count INTEGER NOT NULL DEFAULT 0, badge TEXT, compare_price INTEGER, image_url TEXT, images TEXT, source TEXT NOT NULL DEFAULT 'manual', wr_product_id TEXT, wr_auto_managed INTEGER NOT NULL DEFAULT 0, sk_product_id TEXT, sk_auto_managed INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, sku TEXT NOT NULL, label TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT -1, updated_at TEXT, bulk_pricing_enabled INTEGER NOT NULL DEFAULT 0, bulk_pricing_tiers TEXT NOT NULL DEFAULT '[]', min_qty INTEGER NOT NULL DEFAULT 1, fulfillment_mode TEXT NOT NULL DEFAULT 'manual', is_active INTEGER NOT NULL DEFAULT 1, shared_secret_ciphertext TEXT, shared_secret_iv TEXT, wr_variant_id TEXT, telegram_enabled INTEGER NOT NULL DEFAULT 1, duration_value INTEGER, duration_unit TEXT, duration_label TEXT, warranty_type TEXT DEFAULT 'none', warranty_value INTEGER, warranty_unit TEXT, warranty_label TEXT, terms TEXT, delivery_terms TEXT, compare_price INTEGER, manual_cost INTEGER DEFAULT 0, wr_type TEXT, wr_delivery_class TEXT, wr_delivery_terms TEXT, sk_variant_id TEXT, admin_terms TEXT, admin_activation TEXT, admin_copy_fingerprint TEXT, handover_template TEXT, tunvn_source_product_id INTEGER, created_at TEXT)",
  "ALTER TABLE product_variants ADD COLUMN tunvn_cost_usdt REAL",
  "ALTER TABLE product_variants ADD COLUMN buyer_field_key TEXT",
  "ALTER TABLE product_variants ADD COLUMN max_qty INTEGER",
  "ALTER TABLE product_variants ADD COLUMN tunvn_buff_quantity_b INTEGER",
  "CREATE TABLE tunvn_products(supplier_product_id INTEGER PRIMARY KEY,price_usdt REAL)",
  "ALTER TABLE products ADD COLUMN aivault_family TEXT",
  "ALTER TABLE product_variants ADD COLUMN aivault_service_id TEXT",
  "ALTER TABLE products ADD COLUMN storebat_family TEXT",
  "ALTER TABLE product_variants ADD COLUMN storebat_product_id INTEGER",
  "ALTER TABLE product_variants ADD COLUMN storebat_cost_usd REAL",
  "ALTER TABLE product_variants ADD COLUMN storebat_fx_idr_per_usd REAL",
  "ALTER TABLE products ADD COLUMN mirai_family TEXT",
  "ALTER TABLE product_variants ADD COLUMN mirai_package_code TEXT",
  "ALTER TABLE product_variants ADD COLUMN mirai_cost_usdt REAL",
  "ALTER TABLE product_variants ADD COLUMN mirai_fx_idr_per_usdt REAL",
  "CREATE TABLE aivault_products(service_id TEXT PRIMARY KEY,unit_price_usd REAL)",
  "CREATE TABLE payment_methods (id TEXT PRIMARY KEY, label TEXT, account_number TEXT, account_name TEXT, qris_url TEXT, is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, slug TEXT)",
  "CREATE TABLE telegram_users (user_id TEXT PRIMARY KEY, chat_id INTEGER, locale TEXT, display_currency TEXT, buyer_email TEXT, pending_action TEXT, updated_at TEXT)",
  "CREATE TABLE telegram_carts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, product_id INTEGER, variant_id INTEGER, qty INTEGER, updated_at TEXT)",
  "ALTER TABLE telegram_carts ADD COLUMN buyer_fields TEXT NOT NULL DEFAULT '{}'",
  "CREATE TABLE warung_rebahan_variants (id INTEGER PRIMARY KEY, wr_variant_id TEXT, wr_type TEXT)",
  "CREATE TABLE wr_variants (id INTEGER PRIMARY KEY, wr_variant_id TEXT, wr_type TEXT, wr_delivery_class TEXT, wr_max_quantity INTEGER)",
  "CREATE TABLE sk_products (sk_variant_id TEXT PRIMARY KEY, sk_description TEXT)",
  "CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, customer_name TEXT NOT NULL, customer_wa TEXT NOT NULL DEFAULT '', customer_email TEXT, buyer_access_version INTEGER, buyer_access_format TEXT, items TEXT, subtotal INTEGER, payment_method TEXT, payment_account TEXT, proof_url TEXT, status TEXT, admin_note TEXT, quote_id TEXT, expires_at TEXT, sales_channel TEXT DEFAULT 'telegram', telegram_chat_id TEXT, telegram_user_id TEXT, channel_conversation_id TEXT, channel_member_id TEXT, payment_status TEXT, fulfillment_status TEXT, variant_id INTEGER, variant_snapshot TEXT, telegram_order_notified_at TEXT, telegram_paid_notified_at TEXT, telegram_paid_admin_notified_at TEXT, telegram_reminder_count INTEGER DEFAULT 0, telegram_reminder_sent_at TEXT, telegram_invoice_sent_at TEXT, telegram_invoice_attempts INTEGER DEFAULT 0, qris_reissue_count INTEGER DEFAULT 0, paid_at TEXT, order_kind TEXT DEFAULT 'apps', locale TEXT NOT NULL DEFAULT 'id' CHECK(locale IN ('id','en')), created_at TEXT, updated_at TEXT)",
  "CREATE TABLE operation_guards (operation_id TEXT PRIMARY KEY, valid INTEGER CHECK(valid=1))",
  "ALTER TABLE products ADD COLUMN pixelverif_family TEXT",
  "ALTER TABLE product_variants ADD COLUMN pixelverif_flow_type TEXT",
  "CREATE TABLE fulfillment_inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, variant_id INTEGER, status TEXT, order_code TEXT, secret_ciphertext TEXT, secret_iv TEXT, secret_fingerprint TEXT, reserved_at TEXT, sort_order INTEGER)",
  // payment_transactions: REAL DDL from drizzle/schema.sql (loaded below), not hand-copied.
  "CREATE TABLE fulfillment_jobs (order_code TEXT UNIQUE, variant_id INTEGER, inventory_id INTEGER, sales_channel TEXT, status TEXT, attempt_count INTEGER, next_attempt_at TEXT)",
  "CREATE TABLE dana_webhook_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT UNIQUE, payload_hash TEXT, amount INTEGER, raw_text TEXT, provider TEXT, status TEXT, order_code TEXT, last_error TEXT, processed_at TEXT, reviewed_by TEXT, review_note TEXT)",
  "CREATE TABLE store_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)",
];

const SCHEMA_SQL = readFileSync("drizzle/schema.sql", "utf8");
const PT_DDL = [
  /CREATE TABLE IF NOT EXISTS payment_transactions \([\s\S]*?\n\);/,
  /CREATE TABLE IF NOT EXISTS buyer_notice_log \([\s\S]*?\n\);/,
  /CREATE TABLE IF NOT EXISTS crypto_market_snapshot \([\s\S]*?\n\);/,
  /CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_payment\s+ON payment_transactions\(provider, provider_payment_id\)\s+WHERE provider_payment_id IS NOT NULL;/,
].map((re) => (SCHEMA_SQL.match(re)?.[0] ?? "").replace(/--.*$/gm, "").replace(/;\s*$/, ""));
const SETUP = [...SETUP_STATEMENTS, ...PT_DDL];

const SEED = `
INSERT INTO products(id,name,slug,price,require_email,stock,is_active,telegram_enabled,category_id,sort_order) VALUES(1,'Fixture','fixture',10000,0,100,1,1,1,0);
INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active,bulk_pricing_enabled,bulk_pricing_tiers,telegram_enabled) VALUES(1,1,'SKU-1','Paket',10000,100,1,'manual',1,1,'${TIERS.replace(/'/g, "''")}',1);
INSERT INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1);
INSERT INTO categories(id,name,slug) VALUES(1,'Fixture','fixture');
INSERT INTO crypto_market_snapshot(id,coins_json,coins_refreshed_at) VALUES(1,'[{"ticker":"btc","min_usd_text":"1.95"},{"ticker":"usdtbsc","min_usd_text":"0.08"}]','${new Date(Date.now() - 60_000).toISOString()}');
`;

const WORKER_SRC = `import {handleCallback} from './src/lib/telegram/handlers/callback';
import {parsePayq1State} from './src/lib/telegram/payment-quote';
let callbackSeq=0;
export default {async fetch(req,env){
  (globalThis as any).DB=env.DB;
  // Real api.ts runs; Telegram HTTP is intercepted by the host outboundService
  // (captures live in the test process, so they outlive each request).
  const sent=[]; const edited=[];
  try{
    const body=await req.json() as any;
    for(const [k,v] of Object.entries(body.env??{})){ if(v===null) delete process.env[k]; else process.env[k]=String(v); }
    const from={id:Number(body.fromId??777001),first_name:'W'};
    if(body.op==='click'){try{await handleCallback(String(body.data),Number(body.chatId??from.id),21,from,'cb-'+(++callbackSeq));}catch(e){return Response.json({handlerError:String((e as Error)?.message??e),sent,edited},{status:500});}}
    if(body.op==='seed'){const db=env.DB;await db.batch([db.prepare("INSERT OR REPLACE INTO telegram_users(user_id,chat_id,locale,buyer_email) VALUES(?,?,?,?)").bind(String(from.id),from.id,body.locale??'en','buyer@example.test'),db.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").bind(String(from.id),1,1,2)]);return Response.json({ok:true,sent,edited});}
    if(body.op==='cart'){const m=await import('./src/lib/telegram/cart');const s=await (m as any).getCartSummary(String(from.id));return Response.json({summary:s,sent,edited});}
    if(body.op==='email'){const m=await import('./src/lib/telegram/checkout-email');const c=await import('./src/lib/telegram/cart');const s=await (c as any).getCartSummary(String(from.id));try{const r=await (m as any).readCheckoutEmail(String(from.id),s.lines);return Response.json({email:r,sent,edited});}catch(e){return Response.json({emailError:String((e as Error)?.stack??(e as Error)?.message??e),sent,edited});}}
    if(body.op==='offer'){const m=await import('./src/lib/payments/method-options');try{const methods=await (m as any).buildMethodOptions(19000);return Response.json({methods,sent,edited});}catch(e){return Response.json({offerError:String((e as Error)?.message??e),sent,edited});}}
    if(body.op==='validate'){const m=await import('./src/lib/telegram/payment-create');const {readPayq1State}=await import('./src/lib/telegram/payment-quote');const stored=await readPayq1State(String(from.id));try{const r=await (m as any).validateFrozenSelectionLive(stored!.state!);return Response.json({validated:r,sent,edited});}catch(e){return Response.json({validateError:String((e as Error)?.stack??(e as Error)?.message??e),sent,edited});}}
    if(body.op==='lines'){const m=await import('./src/lib/telegram/handlers/payment-lines');const {readPayq1State}=await import('./src/lib/telegram/payment-quote');const stored=await readPayq1State(String(from.id));try{const r=await (m as any).resolveCurrentPayq1Lines(String(from.id),stored!.state!);return Response.json({lines:r,sent,edited});}catch(e){return Response.json({linesError:String((e as Error)?.stack??(e as Error)?.message??e),sent,edited});}}
    if(body.op==='dispatch'){const d=await import('./src/lib/telegram/handlers/payment-dispatch');const {readPayq1State}=await import('./src/lib/telegram/payment-quote');const stored=await readPayq1State(String(from.id));try{await (d as any).dispatchPayq1Creating(Number(body.chatId??from.id),21,from,'en',stored!.state!,stored!.raw,'TEST-ORDER','TEST-KEY');return Response.json({dispatched:true,sent,edited});}catch(e){return Response.json({dispatchError:String((e as Error)?.stack??(e as Error)?.message??e),sent,edited});}}
    if(body.op==='freeze'){const m=await import('./src/lib/telegram/payment-quote');const tag='0123456789ab';try{const r=await (m as any).freezePayq1({fromUserId:String(from.id),locale:'en',tag,identity:{kind:'cart'},idrSubtotal:19000,contactEmail:'buyer@example.test'});return Response.json({frozen:r,sent,edited});}catch(e){return Response.json({freezeError:String((e as Error)?.stack??(e as Error)?.message??e),sent,edited});}}
    if(body.op==='retry3'){const m=await import('./src/lib/telegram/invoice-retry');const r=await Promise.all([1,2,3].map(()=>(m as any).retryTelegramInvoiceDelivery(String(body.code))));return Response.json({retried:r,sent,edited});}
    if(body.op==='terminal3'){const m=await import('./src/lib/payments/qris-expiry-notifications');const r=await Promise.all([1,2,3].map(()=>(m as any).sendQrisExpiryNotifications(2)));return Response.json({ticks:r,sent,edited});}
    if(body.op==='reminder'){const {sendPendingOrderReminders}=await import('./src/lib/telegram/order-notifications');const r=await Promise.all([sendPendingOrderReminders(2),sendPendingOrderReminders(2)]);return Response.json({reminders:r});}
    if(body.op==='phone'){const m=await import('./src/lib/telegram/handlers/payment-contact');const handled=await (m as any).handlePayq1PhoneInput(String(body.text),Number(body.chatId??from.id),from);return Response.json({handled,sent,edited});}
    if(body.op==='seed-email-required'){const db=env.DB;await db.prepare("UPDATE products SET require_email=1 WHERE id=1").run();await db.batch([db.prepare("INSERT OR REPLACE INTO telegram_users(user_id,chat_id,locale) VALUES(?,?,?)").bind(String(from.id),from.id,'en'),db.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").bind(String(from.id),1,1,2)]);}
    if(body.op==='seed-email-ok'){const db=env.DB;await db.batch([db.prepare("UPDATE telegram_users SET buyer_email='buyer@example.test',pending_action=NULL WHERE user_id=?").bind(String(from.id))]);}
    if(body.op==='raw'){const db=env.DB;const row=await db.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").bind(String(from.id)).first();return Response.json({raw:String((row as any)?.pending_action??''),sent,edited});}
    if(body.op==='tx'){const db=env.DB;const tx=await db.prepare("SELECT * FROM payment_transactions WHERE order_code=?").bind(String(body.code)).first();const order=await db.prepare("SELECT code,subtotal,payment_method,locale,payment_status,status FROM orders WHERE code=?").bind(String(body.code)).first();const stock=await db.prepare("SELECT stock FROM product_variants WHERE id=1").first();return Response.json({tx,order,stock,nOrders:(await db.prepare("SELECT COUNT(*) n FROM orders").first() as any)?.n,nTx:(await db.prepare("SELECT COUNT(*) n FROM payment_transactions").first() as any)?.n,sent,edited});}
    if(body.op==='locate'){const db=env.DB;const code=String(body.code??'');const tx=await db.prepare("SELECT * FROM payment_transactions WHERE order_code=? OR provider_payment_id=?").bind(code,code).first();const order=await db.prepare("SELECT code,subtotal,payment_method,locale,payment_status,status FROM orders WHERE code=?").bind(code).first();return Response.json({tx,order,sent,edited});}
    return Response.json({ok:true,sent,edited});
  }catch(e){return Response.json({error:String((e as Error)?.message??e)},{status:500});}
}};`;

// ---------------------------------------------------------------------------
// Host side. Telegram + provider HTTP are intercepted by Miniflare's
// outboundService, which lives in the TEST process: captures here persist for
// the whole case (the earlier per-request arrays inside the worker were
// dropped between probes — that was the harness defect).
// ---------------------------------------------------------------------------
const FIXTURE_ENV: Record<string, string> = {
  NEXT_PUBLIC_PAYMENTS_MAINTENANCE: "false",
  ADMIN_JWT_SECRET: "tg-r2b-workerd",
  BUYER_ORDER_ACCESS_SECRET: "tg-r2b-workerd-secret-0123456789",
  TELEGRAM_BOT_TOKEN: "000000:WORKERD-FIXTURE",
  TELEGRAM_BOT_ENABLED: "true",
  QRIS_ACTIVE_PROVIDER: "klikqris", KLIKQRIS_ENABLED: "true", KLIKQRIS_API_KEY: "fixture", KLIKQRIS_MERCHANT_ID: "123",
  USD_IDR_RATE: "8000", // 19000 IDR -> base 238 + biaya per koin 11 = US$2.49; no AXVARA floor
  NOWPAYMENTS_ENABLED: "true", NOWPAYMENTS_API_KEY: "wk", NOWPAYMENTS_IPN_SECRET: "ws",
  NOWPAYMENTS_OUTCOME_CURRENCY: "usdtbsc",
  SEKALIPAY_GATEWAY_ENABLED: "true", SEKALIPAY_GATEWAY_API_KEY: "wk", SEKALIPAY_GATEWAY_SECRET_KEY: "ws",
};

type Markup = { inline_keyboard?: { text?: string; url?: string; callback_data?: string }[][] };
type View = { method: string; text: string; markup: Markup | undefined; raw: Record<string, unknown> };
type CallResult = {
  ok?: boolean; handled?: boolean; raw?: string; error?: string; handlerError?: string;
  tx?: Record<string, unknown> | null; order?: Record<string, unknown> | null; stock?: Record<string, unknown> | null;
  nOrders?: number; nTx?: number; views: View[]; retried?: boolean[]; ticks?: { sent: number }[]; methods?: { id: string; available?: boolean }[];
};

let bundle = "";
beforeAll(async () => {
  const root = process.cwd();
  const compiled = await build({
    stdin: { contents: WORKER_SRC, resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    plugins: [
      { name: "tg-alias", setup(b) {
        // Resolve @/* and extensionless relatives like Next does (incl. dir
        // index barrels). node:crypto stays native (nodejs_compat).
        const resolveFile = (p: string): string | null => {
          for (const c of [p, `${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`]) {
            try { if (statSync(c).isFile()) return c; } catch { /* next */ }
          }
          return null;
        };
        b.onResolve({ filter: /^@\// }, (a) => { const hit = resolveFile(path.join(root, "src", a.path.slice(2))); return hit ? { path: hit } : null; });
        b.onResolve({ filter: /^\.\.?(\/|$)/ }, (a) => {
          if (!a.importer || a.importer.includes("node_modules")) return null;
          const hit = resolveFile(path.resolve(path.dirname(a.importer), a.path));
          return hit ? { path: hit } : null;
        });
      } },
      { name: "shim", setup(b) {
        b.onResolve({ filter: /^server-only$|^@\/lib\/products$|^@\/lib\/article-seeds$/ }, (a) => ({ path: a.path, namespace: "empty" }));
        b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" }));
      } },
    ],
  });
  bundle = compiled.outputFiles[0].text;
});

const GATEWAY_FEE_ESTIMATE = 500;
const GATEWAY_FEE_ACTUAL = 700;

async function makeHarness() {
  const state = { nowPosts: [] as Record<string, unknown>[], gwPosts: [] as Record<string, unknown>[], gets: [] as string[], estimates: 0, minAmounts: 0, unexpected: [] as string[], views: [] as View[], gwMode: false as boolean, nowStatus: "waiting", invoiceGate: null as Promise<void> | null };
  const env: Record<string, string | null> = {};
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"],
    script: bundle, d1Databases: ["DB"], bindings: { ...FIXTURE_ENV, USD_FX_EFFECTIVE_AT: new Date(Date.now() - 60_000).toISOString() },
    outboundService: async (request: Request) => {
      const url = request.url;
      if (url.startsWith("https://api.telegram.org/")) {
        const method = url.split("/").at(-1)!;
        const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        if (["sendMessage", "editMessageText", "sendPhoto"].includes(method)) {
          state.views.push({ method, text: String(raw.text ?? raw.caption ?? "").replace(/[\u00a0\u202f]/g, " "), markup: raw.reply_markup as Markup | undefined, raw });
          if (String(raw.text ?? "").includes("0xBEEFCAFE") && state.invoiceGate) await state.invoiceGate;
        }
        return Response.json({ ok: true, result: { message_id: 1 } });
      }
      if (url.includes("nowpayments.io") && url.includes("/estimate?")) { state.estimates++; return Response.json({ estimated_amount: "2.42", currency_from: "usd", currency_to: "usdtbsc" }); }
      if (url.includes("nowpayments.io") && url.includes("/min-amount?")) { state.minAmounts++; return Response.json({ min_amount: "0.0005", currency_from: "usdtbsc", currency_to: "usdtbsc" }); }
      if (url.includes("payment-methods")) {
        return Response.json({ status: true, data: [{ payment_code: "GATEVA", payment_name: "Gate VA", payment_type: "va", min_amount: 100, max_amount: 999999999, fee_info: { type: "flat", description: `Rp ${GATEWAY_FEE_ESTIMATE}` } }] });
      }
      if (url.endsWith("/payment") && request.method === "POST" && url.includes("sekalipay")) {
        const body = await request.json() as { merchant_ref_id: string; amount: number; payment_code: string };
        state.gwPosts.push(body);
        return Response.json({ status: true, data: {
          merchant_ref_id: body.merchant_ref_id, invoice: "SPY-r2b-worker", amount: body.amount,
          fee: GATEWAY_FEE_ACTUAL, total: body.amount + GATEWAY_FEE_ACTUAL, payment_code: body.payment_code,
          payment_link: "https://sekalipay.com/payment/SPY-r2b-worker", virtual_account: "888001",
          checkout_url: null, status: "pending", is_sandbox: false,
          expired_at: new Date(Date.now() + 900_000).toISOString(),
        } }, { status: 201 });
      }
      if (url.includes("sekalipay") && url.includes("/payment/")) {
        state.gets.push(url);
        const ref = url.split("/").at(-1)!;
        const db = await runtime.getD1Database("DB");
        const saved = await db.prepare("SELECT provider_payment_id,gateway_channel,requested_amount,gateway_fee,payable_amount,gateway_virtual_account,direct_url FROM payment_transactions WHERE order_code=?").bind(ref).first() as Record<string, unknown> | null;
        return Response.json({ status: true, data: {
          merchant_ref_id: ref, invoice: String(saved?.provider_payment_id ?? "SPY-r2b-worker"),
          amount: Number(saved?.requested_amount ?? 19000), fee: Number(saved?.gateway_fee ?? GATEWAY_FEE_ACTUAL),
          total: Number(saved?.payable_amount ?? 19000 + GATEWAY_FEE_ACTUAL), payment_code: String(saved?.gateway_channel ?? "GATEVA"),
          payment_link: String(saved?.direct_url ?? "https://sekalipay.com/payment/SPY-r2b-worker"),
          checkout_url: null, virtual_account: saved?.gateway_virtual_account ?? "888001",
          status: "pending", paid_at: null, is_sandbox: false, expired_at: new Date(Date.now() + 900_000).toISOString(),
        } });
      }
      if (url === "https://api.nowpayments.io/v1/payment" && request.method === "POST") {
        const body = await request.json() as Record<string, string>;
        state.nowPosts.push(body);
        return Response.json({
          payment_id: "NP-r2b-worker-1", pay_address: "0xBEEFCAFE0123456789abcdef0123456789abc",
          pay_amount: "1.19", price_amount: String(body.price_amount), price_currency: String(body.price_currency),
          pay_currency: String(body.pay_currency), order_id: String(body.order_id),
          is_fixed_rate: false, is_fee_paid_by_user: false,
          valid_until: new Date(Date.now() + 900_000).toISOString(), payment_status: "waiting",
          actually_paid: "0", outcome_amount: "1.19", outcome_currency: "usdtbsc",
        }, { status: 201 });
      }
      if (url.includes("nowpayments.io") && url.includes("/payment/NP-r2b-worker-1")) {
        state.gets.push(url);
        const db = await runtime.getD1Database("DB");
        const saved = await db.prepare("SELECT provider_payment_id,pay_amount_text,price_amount_text,price_currency,pay_currency,pay_address,pay_network,order_code FROM payment_transactions WHERE provider_payment_id='NP-r2b-worker-1'").first() as Record<string, unknown> | null;
        return Response.json({
          payment_id: "NP-r2b-worker-1",
          pay_address: String(saved?.pay_address ?? "0xBEEFCAFE0123456789abcdef0123456789abc"),
          pay_amount: String(saved?.pay_amount_text ?? "1.19"), price_amount: String(saved?.price_amount_text ?? "2.42"),
          price_currency: String(saved?.price_currency ?? "usd"), pay_currency: String(saved?.pay_currency ?? "usdtbsc"),
          network: saved?.pay_network ? String(saved.pay_network) : "bsc", order_id: String(saved?.order_code ?? ""),
          is_fixed_rate: false, is_fee_paid_by_user: false,
          valid_until: new Date(Date.now() + 900_000).toISOString(), payment_status: state.nowStatus,
          actually_paid: "0", outcome_amount: "1.19", outcome_currency: "usdtbsc",
        });
      }
      state.unexpected.push(`${request.method} ${url}`);
      throw new Error(`Unexpected outbound ${request.method} ${url}`);
    },
  });
  const db = await runtime.getD1Database("DB");
  for (const stmt of SETUP) { expect(stmt, "schema DDL extracted").not.toBe(""); await db.prepare(stmt).run(); }
  await db.batch(SEED.split(";").map((x) => x.trim()).filter(Boolean).map((x) => db.prepare(x)));
  const call = async (payload: Record<string, unknown>): Promise<CallResult> => {
    const before = state.views.length;
    const res = await runtime.dispatchFetch("https://axvara.test/tg", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, env }),
    });
    const text = await res.text();
    let parsed: Omit<CallResult, "views">;
    try { parsed = JSON.parse(text); } catch { throw new Error(`workerd call ${JSON.stringify(payload).slice(0, 80)} status=${res.status} body=${text.slice(0, 400)}`); }
    if (parsed.error || parsed.handlerError) throw new Error(`workerd handler error: ${parsed.error ?? parsed.handlerError}`);
    return { ...parsed, views: state.views.slice(before) };
  };
  const allText = (views: View[]) => views.map((v) => v.text).join("\n");
  const buttons = (views: View[]) => views.flatMap((v) => (v.markup?.inline_keyboard ?? []).flat());
  const rows = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all()).results as Record<string, unknown>[];
  return { runtime, db, state, env, call, allText, buttons, rows, dispose: () => runtime.dispose() };
}

it("workerd D1 applies QRIS reminder age and atomic claim across concurrent ticks", async () => {
  const h = await makeHarness();
  const code = "AXV-20261120-REMINDER";
  try {
    await h.db.batch([
      h.db.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_chat_id,locale)
        VALUES(?,'Buyer','','[]',9000,'qris','pending','pending','telegram','777001','en')`).bind(code),
      h.db.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,invoice_issued_at,expires_at)
        VALUES(?,'klikqris','fixture',?,'merchant',9000,9123,'pending',datetime('now','-1 minute'),datetime('now','+14 minutes'))`).bind(code, code),
    ]);
    expect((await h.call({ op: "reminder" })).views).toHaveLength(0);
    await h.db.prepare("UPDATE payment_transactions SET invoice_issued_at=datetime('now','-11 minutes'), expires_at=datetime('now','+4 minutes') WHERE order_code=?").bind(code).run();
    const due = await h.call({ op: "reminder" });
    expect(due.views).toHaveLength(1);
    expect(due.views[0].text).toContain("4 minutes left");
    expect((await h.rows("SELECT telegram_reminder_count AS n FROM orders WHERE code=?", code))[0].n).toBe(1);
    expect((await h.call({ op: "reminder" })).views).toHaveLength(0);
  } finally { await h.dispose(); }
});

it("workerd fences first crypto invoice HTTP against concurrent retry", async () => {
  const h = await makeHarness();
  let release!: () => void;
  try {
    const frozen = await enterOffer(h);
    const idx = frozen.methods.findIndex((m) => m.id === "nowpayments:usdtbsc");
    expect(idx).toBeGreaterThanOrEqual(0);
    await h.call({ op: "click", data: `pm:${frozen.nonce}:${idx}` });
    h.state.invoiceGate = new Promise<void>((resolve) => { release = resolve; });
    const first = h.call({ op: "click", data: `pgo:${frozen.nonce}` });
    await vi.waitFor(() => expect(h.state.views.filter((v) => v.text.includes("0xBEEFCAFE"))).toHaveLength(1));
    const code = String((await h.rows("SELECT code FROM orders"))[0].code);
    expect((await h.rows("SELECT telegram_invoice_attempts,telegram_invoice_sent_at FROM orders WHERE code=?", code))[0]).toMatchObject({ telegram_invoice_attempts: 1, telegram_invoice_sent_at: null });
    const retry = await h.call({ op: "retry3", code });
    expect(retry.retried).toEqual([false, false, false]);
    expect(h.state.views.filter((v) => v.text.includes("0xBEEFCAFE"))).toHaveLength(1);
    release(); await first;
    expect((await h.rows("SELECT telegram_invoice_attempts,telegram_invoice_sent_at FROM orders WHERE code=?", code))[0]).toMatchObject({ telegram_invoice_attempts: 1, telegram_invoice_sent_at: expect.any(String) });
    expect(h.state.nowPosts).toHaveLength(1);
    expect((await h.rows("SELECT stock FROM product_variants WHERE id=1"))[0].stock).toBe(98);
  } finally { release?.(); await h.dispose(); }
}, 20_000);

async function enterOffer(h: Awaited<ReturnType<typeof makeHarness>>, locale = "en") {
  await h.call({ op: "seed", locale });
  await h.call({ op: "click", data: "pmentry" });
  const raw = (await h.call({ op: "raw" })).raw ?? "";
  expect(raw.startsWith("payq1:")).toBe(true);
  return JSON.parse(raw.slice("payq1:".length)) as { nonce: string; idrSubtotal: number; st?: string; methods: { id: string; amount_text?: string; usd?: { cents: string } }[] };
}

it("CRYPTO: frozen payq1 -> one order + one NOWPayments POST; replay/FX rotate/flag-off recovery stay on the saved invoice", async () => {
  const h = await makeHarness();
  try {
    const frozen = await enterOffer(h);
    expect(frozen.idrSubtotal).toBe(19000); // 2 x tier 9500 = discounted IDR 19000 (not 2 x 10000)
    const idx = frozen.methods.findIndex((m) => m.id === "nowpayments:usdtbsc");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(frozen.methods[idx].amount_text).toBe("2.49"); // total = base 238 + biaya layanan per koin 11
    expect(frozen.methods[idx].usd?.cents).toBe("238");
    await h.call({ op: "click", data: `pm:${frozen.nonce}:${idx}` });
    expect((await h.call({ op: "raw" })).raw).toContain('"sel":"nowpayments:usdtbsc"');
    expect(h.state.nowPosts).toHaveLength(0);

    // Rotate FX AFTER the freeze: creation must use the frozen USD snapshot.
    h.env.USD_IDR_RATE = "17000";
    const first = await h.call({ op: "click", data: `pgo:${frozen.nonce}` });
    expect(first.views.length, `pgo views: ${h.allText(first.views)}`).toBeGreaterThan(0);
    const created = await h.rows("SELECT code FROM orders");
    expect(created, `views: ${h.allText(first.views)} posts=${h.state.nowPosts.length}`).toHaveLength(1);
    const code = String(created[0].code);
    expect(h.state.nowPosts).toHaveLength(1);
    expect(h.state.nowPosts[0]).toMatchObject({ price_amount: "2.49", price_currency: "usd", pay_currency: "usdtbsc", order_id: code, is_fixed_rate: false, is_fee_paid_by_user: false });

    // Persisted financial binding + finite stock cut exactly once.
    const order = (await h.rows("SELECT * FROM orders WHERE code=?", code))[0];
    expect(order).toMatchObject({ subtotal: 19000, payment_method: "nowpayments:usdtbsc", locale: "en", status: "pending", telegram_user_id: "777001" });
    const tx = (await h.rows("SELECT * FROM payment_transactions WHERE order_code=?", code))[0];
    expect(tx).toMatchObject({ provider: "nowpayments", requested_amount: 19000, price_currency: "usd", price_amount_text: "2.49", fee_paid_by_user: 0, fixed_rate: 0, crypto_base_usd_cents: 238, crypto_surcharge_usd_cents: 11, crypto_surcharge_bps: 100, provider_payment_id: "NP-r2b-worker-1", pay_amount_text: "1.19" });
    expect(String(tx.pay_currency).toLowerCase()).toBe("usdtbsc");
    expect(String(tx.pay_address)).toBe("0xBEEFCAFE0123456789abcdef0123456789abc");
    expect(String(tx.pay_network)).toBe("bsc");
    expect(String(tx.fx_rate_text ?? "")).toMatch(/^8000\/1@/); // frozen snapshot, not the rotated 17000
    expect(String(tx.fx_rate_text ?? "")).not.toContain("17000");
    expect((await h.rows("SELECT stock FROM product_variants WHERE id=1"))[0].stock).toBe(98);

    // Captured buyer view: exact provider amount/address/currency/network, EN locale, no QRIS.
    const text = h.allText(first.views);
    expect(text).toContain("Send exactly <b>1.19 USDT</b> on the <b>BNB Smart Chain</b> network only.");
    expect(text).toContain("Total  : <code>US$2.49 (incl. crypto service fee US$0.11)</code>");
    expect(text).toContain("0xBEEFCAFE0123456789abcdef0123456789abc");
    expect(text).not.toMatch(/QRIS/i);

    // Duplicate confirmation + status retry: same order/rail, no second POST/reservation.
    await h.call({ op: "click", data: `pgo:${frozen.nonce}` });
    await h.call({ op: "click", data: `refresh:${code}` });
    expect(await h.rows("SELECT code FROM orders")).toHaveLength(1);
    expect(await h.rows("SELECT order_code FROM payment_transactions")).toHaveLength(1);
    expect(h.state.nowPosts).toHaveLength(1);
    expect((await h.rows("SELECT stock FROM product_variants WHERE id=1"))[0].stock).toBe(98);
    expect((await h.rows("SELECT COUNT(*) n FROM fulfillment_inventory"))[0].n).toBe(0);

    // R3 native fence in real workerd D1: the invoice is pending again (delivery
    // marker cleared) and three concurrent retries race -> exactly ONE text send,
    // attempts advanced once, marker set, no POST.
    const claimed1 = (await h.rows("SELECT telegram_invoice_attempts AS a, telegram_invoice_sent_at AS s FROM orders WHERE code=?", code))[0];
    expect(claimed1.a).toBe(1); // dispatch took the durable claim BEFORE its HTTP send
    expect(claimed1.s).not.toBeNull();
    await h.db.prepare("UPDATE orders SET telegram_invoice_sent_at=NULL, telegram_invoice_attempts=1, updated_at=datetime('now','-5 minutes') WHERE code=?").bind(code).run(); // pending again, backoff elapsed (clock aging)
    const raced = await h.call({ op: "retry3", code });
    expect(raced.views.filter((v) => v.text.includes("0xBEEFCAFE0123456789abcdef0123456789abc"))).toHaveLength(1);
    const racedRow = (await h.rows("SELECT telegram_invoice_sent_at AS s, telegram_invoice_attempts AS a FROM orders WHERE code=?", code))[0];
    expect(racedRow.a).toBe(2);
    expect(racedRow.s).not.toBeNull();
    expect(h.state.nowPosts).toHaveLength(1);
    // Invoice exists: disable NEW NOW creation and remove FX/outcome settings.
    h.env.NOWPAYMENTS_ENABLED = "false";
    h.env.USD_IDR_RATE = null; h.env.USD_FX_EFFECTIVE_AT = null;
    h.env.NOWPAYMENTS_OUTCOME_CURRENCY = null;
    // Sanity: the env removal really reached the worker (new NOW offers are gone).
    const offerNow = ((await h.call({ op: "offer" })).methods ?? []).find((m) => m.id.startsWith("nowpayments:"));
    expect(offerNow === undefined || offerNow.available === false).toBe(true);
    // Age the poll throttle (clock only) so the status claim performs the authoritative GET.
    await h.db.prepare("UPDATE payment_transactions SET last_checked_at='2000-01-01 00:00:00' WHERE order_code=?").bind(code).run();
    const getsBefore = h.state.gets.length, estBefore = h.state.estimates, minBefore = h.state.minAmounts;
    const refreshed = await h.call({ op: "click", data: `refresh:${code}` });
    expect(h.state.gets.length).toBe(getsBefore + 1);
    expect(h.state.estimates).toBe(estBefore);
    expect(h.state.minAmounts).toBe(minBefore);
    expect(h.state.nowPosts).toHaveLength(1);
    expect(h.state.unexpected).toEqual([]);
    expect(await h.rows("SELECT code FROM orders")).toHaveLength(1);
    expect(await h.rows("SELECT order_code FROM payment_transactions")).toHaveLength(1);
    const saved = h.allText(refreshed.views);
    expect(saved).toContain("1.19 USDT");
    expect(saved).toContain("0xBEEFCAFE0123456789abcdef0123456789abc");
    expect(saved).not.toMatch(/QRIS/i);
    expect((await h.rows("SELECT stock FROM product_variants WHERE id=1"))[0].stock).toBe(98);
    const after = (await h.rows("SELECT * FROM payment_transactions WHERE order_code=?", code))[0];
    // R3 terminal push in real workerd D1: the order expires; three concurrent cron ticks
    // announce it exactly once (buyer_notice_log claim), with no QRIS copy/renew/details.
    await h.db.prepare("UPDATE orders SET status='kadaluarsa', payment_status='expired' WHERE code=?").bind(code).run();
    await h.db.prepare("UPDATE payment_transactions SET status='expired' WHERE order_code=?").bind(code).run();
    const ticks = await h.call({ op: "terminal3" });
    expect(ticks.ticks?.reduce((n, t) => n + t.sent, 0)).toBe(1);
    const notices = ticks.views.filter((v) => v.text.includes("Payment expired"));
    expect(notices).toHaveLength(1);
    expect(notices[0].text + JSON.stringify(notices[0].markup ?? {})).not.toMatch(/QRIS|qrenew|0xBEEF/i);
    expect((await h.rows("SELECT status FROM buyer_notice_log WHERE idempotency_key=?", `telegram:terminal:${code}`))[0].status).toBe("sent");
    expect(after).toMatchObject({ price_amount_text: "2.49", pay_amount_text: "1.19", fee_paid_by_user: 0, fixed_rate: 0 });
  } finally { await h.dispose(); }
});

const consentTag = (code: string, user: string, invoice: string, total: number) =>
  createHmac("sha256", FIXTURE_ENV.BUYER_ORDER_ACCESS_SECRET).update(`gconsent|${code}|${user}|${invoice}|${total}`).digest("hex").slice(0, 16);

it("GATEWAY: legacy saved invoice consent (no VA/link before exact total) + replay/old total/forged/cross-owner safe", async () => {
  const h = await makeHarness();
  try {
    // Telegram no longer offers/creates the gateway rail (owner 7 Nov 2026).
    // Legacy invoices must still read/consent/refresh on the saved binding.
    const offer = await enterOffer(h);
    expect(offer.methods.some((m) => m.id.startsWith("sekalipay_gateway:"))).toBe(false);
    const code = "AXV-20261107-LEGACY01";
    const expires = new Date(Date.now() + 900_000).toISOString();
    await h.db.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_status,status,sales_channel,telegram_chat_id,telegram_user_id,variant_id,variant_snapshot,expires_at,locale)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(code, "Fixture", "6281234567890", "buyer@example.test", "[]", 19000, "sekalipay_gateway:GATEVA", "unpaid", "pending", "telegram", "777001", "777001", 1, "{}", expires, "en").run();
    await h.db.prepare(`INSERT INTO payment_transactions
      (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,provider_payment_id,status,expires_at,gateway_fee,gateway_estimated_fee,gateway_fee_consent_required,gateway_channel,gateway_label,direct_url,gateway_virtual_account,gateway_is_sandbox,last_error)
      VALUES(?,'sekalipay_gateway','merchant',?,'sekalipay_gateway',19000,19700,'SPY-r2b-worker','pending',?,?,?,?,'GATEVA','Gate VA','https://sekalipay.com/payment/SPY-r2b-worker','888001',0,NULL)`)
      .bind(code, code, expires, GATEWAY_FEE_ACTUAL, GATEWAY_FEE_ESTIMATE, 1).run();

    const created = await h.call({ op: "click", data: `refresh:${code}` });
    expect(h.state.gwPosts).toHaveLength(0); // legacy read path never POSTs

    // Changed-fee consent view: fee/total shown, NO VA / payment link.
    const consentView = created.views.at(-1)!;
    expect(consentView.text).toMatch(/Confirm gateway fee/);
    expect(consentView.text).toContain("Total: IDR 19,700");
    expect(consentView.text).toContain("Estimated fee: IDR 500");
    expect(consentView.text).toContain("Actual fee: IDR 700");
    const secretsShown = (v: View[]) => /888001|sekalipay\.com\/payment|SPY-r2b-worker/.test(h.allText(v) + JSON.stringify(h.buttons(v)));
    expect(secretsShown([consentView])).toBe(false);
    const consentBtn = h.buttons([consentView]).find((b) => b.callback_data?.startsWith("gconsent:"));
    expect(consentBtn?.callback_data).toBe(`gconsent:${code}:19700:${consentTag(code, "777001", "SPY-r2b-worker", 19700)}`);
    const goodData = consentBtn!.callback_data!;

    // Negatives: nothing consented, nothing disclosed, no POST/order change.
    const assertUntouched = async (views: View[]) => {
      expect(secretsShown(views)).toBe(false);
      expect((await h.rows("SELECT gateway_fee_consented_at FROM payment_transactions WHERE order_code=?", code))[0].gateway_fee_consented_at).toBeNull();
      expect(h.state.gwPosts).toHaveLength(0);
      expect(await h.rows("SELECT code FROM orders")).toHaveLength(1);
    };
    // old/stale shown total (legitimately keyed for THAT total) -> re-present only
    const stale = await h.call({ op: "click", data: `gconsent:${code}:19500:${consentTag(code, "777001", "SPY-r2b-worker", 19500)}` });
    await assertUntouched(stale.views);
    // old total with the current-total tag (tag does not bind the shown total) -> rejected
    const mixed = await h.call({ op: "click", data: `gconsent:${code}:19500:${goodData.split(":")[3]}` });
    expect(mixed.views).toHaveLength(0);
    await assertUntouched(mixed.views);
    // forged tag
    const forged = await h.call({ op: "click", data: `gconsent:${code}:19700:0000000000000000` });
    expect(forged.views).toHaveLength(0);
    await assertUntouched(forged.views);
    // tag keyed for another owner
    const wrongOwnerTag = await h.call({ op: "click", data: `gconsent:${code}:19700:${consentTag(code, "777002", "SPY-r2b-worker", 19700)}` });
    expect(wrongOwnerTag.views).toHaveLength(0);
    await assertUntouched(wrongOwnerTag.views);
    // cross-owner with the otherwise valid button
    const cross = await h.call({ op: "click", data: goodData, fromId: 777002 });
    expect(cross.views).toHaveLength(0);
    await assertUntouched(cross.views);

    // Valid control AFTER the negatives: exact shown-total consent succeeds.
    const ok = await h.call({ op: "click", data: goodData });
    const okText = h.allText(ok.views);
    expect(okText).toContain("Awaiting payment");
    expect(okText).toContain("Total  : <code>IDR 19,700</code>");
    expect(h.buttons(ok.views).some((b) => b.url === "https://sekalipay.com/payment/SPY-r2b-worker")).toBe(true);
    expect(okText + JSON.stringify(h.buttons(ok.views))).toContain("888001");
    const tx1 = (await h.rows("SELECT * FROM payment_transactions WHERE order_code=?", code))[0];
    expect(tx1.gateway_fee_consented_at).not.toBeNull();
    expect(tx1).toMatchObject({ gateway_fee: GATEWAY_FEE_ACTUAL, payable_amount: 19700, provider_payment_id: "SPY-r2b-worker" });

    // Replay: same details, consent timestamp/fee/total untouched, no extra POST/order.
    const replay = await h.call({ op: "click", data: goodData });
    expect(h.allText(replay.views)).toContain("Awaiting payment");
    const tx2 = (await h.rows("SELECT * FROM payment_transactions WHERE order_code=?", code))[0];
    expect(tx2).toMatchObject({ gateway_fee_consented_at: tx1.gateway_fee_consented_at, gateway_fee: GATEWAY_FEE_ACTUAL, payable_amount: 19700 });
    expect(h.state.gwPosts).toHaveLength(0); // legacy read/consent never creates
    expect(await h.rows("SELECT code FROM orders")).toHaveLength(1);
    expect(await h.rows("SELECT order_code FROM payment_transactions")).toHaveLength(1);
    expect(h.state.unexpected).toEqual([]);
  } finally { await h.dispose(); }
});
