// Real workerd D1 guard/rollback proof with minimal fixture schema, not migration coverage.
import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const TIERS = JSON.stringify([{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }]);

it("runs createChannelOrderAtomic against real Miniflare D1", async () => {
  const root = process.cwd();
  const setup = [
    // Kolom supplier ikut fixture: createChannelOrderAtomic membaca
    // source/wr_product_id/wr_auto_managed/sk_product_id/sk_auto_managed
    // untuk aturan "grosir hanya produk manual" (owner 2026-11-08).
    "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT -1, is_active INTEGER NOT NULL DEFAULT 1, telegram_enabled INTEGER NOT NULL DEFAULT 1, category_id INTEGER, sort_order INTEGER DEFAULT 0, source TEXT NOT NULL DEFAULT 'manual', wr_product_id TEXT, wr_auto_managed INTEGER NOT NULL DEFAULT 0, sk_product_id TEXT, sk_auto_managed INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE wr_variants(wr_variant_id TEXT PRIMARY KEY,wr_delivery_class TEXT,wr_max_quantity INTEGER)",
    "CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, sku TEXT NOT NULL, label TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT -1, updated_at TEXT, bulk_pricing_enabled INTEGER NOT NULL DEFAULT 0, bulk_pricing_tiers TEXT NOT NULL DEFAULT '[]', min_qty INTEGER NOT NULL DEFAULT 1, fulfillment_mode TEXT NOT NULL DEFAULT 'manual', is_active INTEGER NOT NULL DEFAULT 1, shared_secret_ciphertext TEXT, shared_secret_iv TEXT, wr_variant_id TEXT, buyer_field_key TEXT, custom_buyer_field TEXT, custom_buyer_fields_json TEXT, max_qty INTEGER, tunvn_buff_quantity_b INTEGER, tunvn_source_product_id INTEGER)",
    "CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, customer_name TEXT NOT NULL, customer_wa TEXT NOT NULL, customer_email TEXT, items TEXT, subtotal INTEGER, payment_method TEXT, payment_account TEXT, proof_url TEXT, status TEXT, sales_channel TEXT, channel_conversation_id TEXT, channel_member_id TEXT, telegram_chat_id TEXT, telegram_user_id TEXT, payment_status TEXT, fulfillment_status TEXT, variant_id INTEGER, variant_snapshot TEXT, quote_id TEXT, expires_at TEXT, locale TEXT NOT NULL DEFAULT 'id' CHECK(locale IN ('id','en')), buyer_access_version INTEGER, buyer_access_format TEXT)",
    "CREATE TABLE operation_guards (operation_id TEXT PRIMARY KEY, valid INTEGER CHECK(valid=1))",
    "ALTER TABLE products ADD COLUMN pixelverif_family TEXT",
    "ALTER TABLE product_variants ADD COLUMN pixelverif_flow_type TEXT",
    "ALTER TABLE product_variants ADD COLUMN pixelverif_validity INTEGER",
    "ALTER TABLE product_variants ADD COLUMN pixelverif_cost_usd REAL",
    "ALTER TABLE product_variants ADD COLUMN pixelverif_fx_idr_per_usd REAL",
    "ALTER TABLE product_variants ADD COLUMN tunvn_cost_usdt REAL",
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
    "CREATE TABLE fulfillment_inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, variant_id INTEGER, status TEXT, order_code TEXT, secret_ciphertext TEXT, secret_iv TEXT, secret_fingerprint TEXT, reserved_at TEXT, sort_order INTEGER)",
  ].join(";");
  const seed = `
INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,category_id,sort_order) VALUES(1,'Bulk','bulk',10000,-1,1,1,1,0);
INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active,bulk_pricing_enabled,bulk_pricing_tiers) VALUES(1,1,'SKU-1','Paket',10000,20,1,'manual',1,1,'${TIERS.replace(/'/g, "''")}');
INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active,bulk_pricing_enabled,bulk_pricing_tiers) VALUES(3,1,'SKU-3','Unique',10000,10,1,'unique',1,0,'[]');
INSERT INTO fulfillment_inventory(product_id,variant_id,status,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,3,'available','c','v','r-1');
INSERT INTO fulfillment_inventory(product_id,variant_id,status,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,3,'available','c','v','r-2');
INSERT INTO fulfillment_inventory(product_id,variant_id,status,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,3,'available','c','v','r-3');
`;
  const compiled = await build({
    stdin: { contents: `import {createChannelOrderAtomic} from './src/lib/commerce';
      export default {async fetch(req,env){
        const body=await req.json() as any; let entered=0, batchError='';
        const db=env.DB;
        (globalThis as any).DB={prepare:db.prepare.bind(db),batch:async(stmts)=>{
          entered++; if(body.race==='input') await db.prepare("UPDATE product_variants SET max_qty=29 WHERE id=4").run();
          else if(body.race) await db.prepare("UPDATE product_variants SET price=20000 WHERE id=1").run();
          try{return await db.batch(stmts)}catch(e){batchError=String(e);throw e}
        }};
        try {const result=await createChannelOrderAtomic(body.input);return Response.json({ok:true,result,entered,batchError})}
        catch(e){return Response.json({ok:false,error:String(e),entered,batchError})}
      }}`, resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": JSON.stringify({ BUYER_ORDER_ACCESS_SECRET: "tg2b-workerd", PRODUCT_VARIANTS_READ: "true" }) },
    plugins: [{ name: "shim", setup(b) {
      b.onResolve({ filter: /^@\/lib\/products$|^@\/lib\/article-seeds$|^server-only$/ }, (a) => ({ path: a.path, namespace: "empty" }));
      b.onLoad({ filter: /.*/, namespace: "empty" }, (a) => {
        if (a.path === "server-only") return { contents: "" };
        return { contents: "export const products=[];export const articleSeedRows=[];export const resolveCategorySlug=()=>null;" };
      });
    } }],
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"] });
  try {
    const db = await runtime.getD1Database("DB");
    const failed: string[] = [];
    for (const s of setup.split(";").map((x) => x.trim()).filter(Boolean)) {
      try { await db.prepare(s).run(); } catch (e) { failed.push(s.slice(0, 60) + "::" + String((e as Error)?.message ?? e).slice(0, 80)); }
    }
    if (failed.length) throw new Error("workerd setup failed: " + failed.join(" | "));
    await db.batch(seed.split(";").map((x) => x.trim()).filter(Boolean).map((x) => db.prepare(x)));
    const call = async (code: string, lines: unknown[], items: unknown[], subtotal: number, extra: Record<string, unknown> = {}, race: boolean | "input" = false) => {
      const res = await runtime.dispatchFetch("https://axvara.test/atomic", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ race, input: { orderCode: code, lines, items, variantSnapshot: "{}", subtotal, primaryVariantId: 1, customerName: "Bulk", salesChannel: "telegram", telegramChatId: code, telegramUserId: code, paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required", locale: "en", ...extra } }) });
      return res.json() as Promise<{ ok: boolean; result?: { subtotal: number }; error?: string; entered: number; batchError: string }>;
    };
    // Success: EN locale persisted, discounted effective price, finite stock cut.
    const good = await call("TG-WORKER-OK",
      [{ productId: 1, variantId: 1, qty: 10, fulfillmentMode: "manual", stock: 20 }],
      [{ product_id: 1, variant_id: 1, price: 9000, base_price: 10000, applied_tier_min_qty: 10, qty: 10 }], 90000);
    if (!good.ok) throw new Error("workerd atomic failed: " + (good.error ?? "unknown"));
    expect(good.ok).toBe(true);
    expect(await db.prepare("SELECT subtotal,locale FROM orders WHERE code='TG-WORKER-OK'").first()).toMatchObject({ subtotal: 90000, locale: "en" });
    const nonTg = await call("WEB-WORKER-OK", [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 10 }],
      [{ product_id: 1, variant_id: 1, price: 10000, qty: 1 }], 10000, { salesChannel: "web", locale: "en" });
    expect(nonTg.ok).toBe(true);
    expect(await db.prepare("SELECT locale FROM orders WHERE code='WEB-WORKER-OK'").first()).toMatchObject({ locale: "id" });
    const reset = async () => { await db.batch([
      db.prepare("DELETE FROM orders"), db.prepare("UPDATE product_variants SET stock=20,price=10000 WHERE id=1"),
      db.prepare("UPDATE product_variants SET stock=10 WHERE id=3"), db.prepare("UPDATE fulfillment_inventory SET status='available',order_code=NULL,reserved_at=NULL")
    ]); };
    const lines = [{ productId: 1, variantId: 3, qty: 2, fulfillmentMode: "unique", stock: 10 },
      { productId: 1, variantId: 1, qty: 10, fulfillmentMode: "manual", stock: 20 }];
    const items = [{ product_id: 1, variant_id: 3, price: 10000, base_price: 10000, qty: 2 },
      { product_id: 1, variant_id: 1, price: 9000, base_price: 10000, applied_tier_min_qty: 10, qty: 10 }];
    await reset();
    const control = await call("TG-CONTROL", lines, items, 110000);
    expect(control.ok, control.error).toBe(true);
    expect(control.entered).toBe(1);
    await reset();
    const raced = await call("TG-RACE", lines, items, 110000, {}, true);
    expect(raced.ok).toBe(false);
    expect(raced.entered).toBe(1);
    expect(raced.batchError).toMatch(/CHECK constraint failed/i);
    expect(raced.error).toMatch(/stock/i);
    expect(await db.prepare("SELECT stock,price FROM product_variants WHERE id=1").first()).toMatchObject({ stock: 20, price: 20000 });
    expect(await db.prepare("SELECT stock FROM product_variants WHERE id=3").first()).toMatchObject({ stock: 10 });
    expect(await db.prepare("SELECT COUNT(*) n FROM orders").first()).toMatchObject({ n: 0 });
    expect(await db.prepare("SELECT COUNT(*) n FROM operation_guards").first()).toMatchObject({ n: 0 });
    expect(await db.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='available'").first()).toMatchObject({ n: 3 });
    await db.prepare("UPDATE products SET slug='muse-ai-1-miliar-token' WHERE id=1").run();
    await db.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,buyer_field_key,max_qty,tunvn_buff_quantity_b) VALUES(4,1,'TUNVN-BUFF-1B','Buff per1B',1500,'muse_invite_code',30,1)").run();
    const buffLines=[{ productId:1,variantId:4,qty:30,fulfillmentMode:"manual",stock:-1 }];
    const buffItems=[{ product_id:1,variant_id:4,price:1500,qty:30,buyer_field_key:"muse_invite_code",max_qty:30,buyer_fields:{ muse_invite_code:"Ab12cD" } }];
    await db.prepare("CREATE TABLE store_settings(key TEXT PRIMARY KEY,value TEXT)").run();
    await db.prepare("INSERT INTO store_settings(key,value) VALUES('tunvn_catalog_lease',?)").bind(JSON.stringify({until:Date.now()+90000,owner:"fixture"})).run();
    const syncing=await call("TG-BUFF-SYNCING",buffLines,buffItems,45000);
    expect(syncing.ok).toBe(false); expect(syncing.batchError).toMatch(/CHECK constraint failed/i);
    await db.prepare("DELETE FROM store_settings WHERE key='tunvn_catalog_lease'").run();
    const buff=await call("TG-BUFF",buffLines,buffItems,45000);
    expect(buff.ok,buff.error).toBe(true);
    const saved=await db.prepare("SELECT items FROM orders WHERE code='TG-BUFF'").first<{ items:string }>();
    expect(JSON.parse(saved!.items)[0]).toMatchObject({ buyer_fields:{ muse_invite_code:"Ab12cD" },tunvn_eligibility:{ version:1,kind:"buff",source_variant_id:4,source_unit_b:1,quantity:30 } });
    await reset();
    const changed=await call("TG-BUFF-RACE",buffLines,buffItems,45000,{},"input");
    expect(changed.ok).toBe(false);
    expect(changed.batchError).toMatch(/CHECK constraint failed/i);
    expect(await db.prepare("SELECT COUNT(*) n FROM orders").first()).toMatchObject({ n:0 });
  } finally { await runtime.dispose(); }
});
