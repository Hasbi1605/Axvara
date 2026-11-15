import {readFileSync} from "node:fs";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createD1Fixture} from "./helpers/d1-fixture";
import {createBudgetedDatabase,createDatabaseAccess} from "@/lib/db-access";
import {publishAivaultCatalog,projectAivaultCatalog} from "@/lib/aivault/catalog";
let f:ReturnType<typeof createD1Fixture>;
const upstream=(id="service_gemini_plus_6m")=>({service_id:id,name:"Gemini Plus",stock:5,custom_pricing:false,pricing_tiers:[{min:1,max:100,price:0.5}]});
beforeEach(()=>{f=createD1Fixture();vi.stubEnv("AIVAULT_ENABLED","true");vi.stubEnv("AIVAULT_SYNC_ENABLED","true");vi.stubEnv("AIVAULT_API_KEY","fixture");vi.stubEnv("AIVAULT_BASE_URL","https://supplier.test");vi.stubGlobal("fetch",vi.fn(async()=>Response.json({currency:"USD",products:[upstream()]})));});
afterEach(()=>{f.close();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("creates separate inactive products/variants and copies a similar existing image once",async()=>{
  f.sql.exec("INSERT INTO products(name,slug,price,image_url,is_active) VALUES('WR Gemini','google-ai-pro-antigravity',10000,'/r2/gemini.webp',0)");
  const budget=createBudgetedDatabase(40,2,f.db);expect(await publishAivaultCatalog(budget.access,20000,{force:true})).toMatchObject({ok:true});expect(budget.used).toBeLessThanOrEqual(38);
  expect(f.sql.prepare("SELECT name,image_url,is_active,source,fulfillment_mode,telegram_enabled FROM products WHERE aivault_family='gemini'").get()).toEqual({name:"Google AI / Gemini Plus",image_url:"/r2/gemini.webp",is_active:0,source:"manual",fulfillment_mode:"manual",telegram_enabled:1});
  expect(f.sql.prepare("SELECT is_active,price,stock FROM product_variants WHERE aivault_service_id IS NOT NULL").get()).toEqual({is_active:0,price:13500,stock:5});
  f.sql.exec("UPDATE products SET name='Admin name',description='Admin copy',is_active=1,image_url='/r2/admin.webp' WHERE aivault_family='gemini'; UPDATE product_variants SET label='Admin label',is_active=1,aivault_admin_price_idr=7777 WHERE aivault_service_id IS NOT NULL");
  await publishAivaultCatalog(createDatabaseAccess(f.db),25000,{force:true});
  expect(f.sql.prepare("SELECT name,description,image_url,is_active,price,stock FROM products WHERE aivault_family='gemini'").get()).toEqual({name:"Admin name",description:"Admin copy",image_url:"/r2/admin.webp",is_active:1,price:7777,stock:5});
  expect(f.sql.prepare("SELECT label,is_active,price FROM product_variants WHERE aivault_service_id IS NOT NULL").get()).toEqual({label:"Admin label",is_active:1,price:7777});
});
it("uses a constant statement count for many families",async()=>{
  const used:number[]=[];
  for (const n of [1,40]) {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({currency:"USD",products:Array.from({length:n},(_,i)=>upstream(`service_${n}_${i}`))}));
    const b=createBudgetedDatabase(40,2,f.db);expect(await publishAivaultCatalog(b.access,20000,{force:true})).toMatchObject({ok:true});used.push(b.used);
  }
  expect(used[1]).toBe(used[0]);
});
it.each(["manual","markup"])("does not overwrite concurrent %s edits",async field=>{
  const db=createDatabaseAccess(f.db);await publishAivaultCatalog(db,20000,{force:true});
  let raced=false;
  f.control.beforeRun=async query=>{if (!raced && query.includes("UPDATE product_variants SET price=")){raced=true;f.sql.exec(field==="manual" ? "UPDATE product_variants SET aivault_admin_price_idr=9999,price=9999 WHERE aivault_service_id IS NOT NULL" : "UPDATE aivault_products SET markup_percent=50; UPDATE product_variants SET price=15000 WHERE aivault_service_id IS NOT NULL");}};
  await projectAivaultCatalog(db,30000);expect(f.sql.prepare("SELECT price FROM product_variants WHERE aivault_service_id IS NOT NULL").get()?.price).toBe(field==="manual" ? 9999 : 15000);
});
it("does not appropriate an unrelated slug and fails closed without FX",async()=>{
  f.sql.exec("INSERT INTO products(name,slug,price) VALUES('Owner','gemini-plus-av',500)");
  const db=createDatabaseAccess(f.db);expect(await publishAivaultCatalog(db,0,{force:true})).toEqual({ok:false,error:"fx_unavailable"});expect(fetch).not.toHaveBeenCalled();
  await publishAivaultCatalog(db,20000,{force:true});expect(f.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE aivault_service_id IS NOT NULL").get()?.n).toBe(0);
});
it("adopts the migrated ChatGPT Plus row instead of duplicating it",async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({currency:"USD",products:[{service_id:"service_chatgpt_plus_1m",name:"ChatGPT Plus 1 Month (Apple Pay)",stock:3,custom_pricing:false,pricing_tiers:[{min:1,max:100,price:0.5}]}]}));
  f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,aivault_family) VALUES(174,'ChatGPT Plus','chatgpt-plus-av',0,0,0,'chatgpt-plus');
    INSERT INTO product_variants(product_id,sku,label,price,stock,fulfillment_mode,is_active,aivault_service_id) VALUES(174,'AV-service_chatgpt_plus_1m','Plus 1 Bulan (Apple Pay)',0,0,'manual',0,'service_chatgpt_plus_1m');`);
  await publishAivaultCatalog(createDatabaseAccess(f.db),20000,{force:true});
  expect(f.sql.prepare("SELECT COUNT(*) n FROM products WHERE aivault_family LIKE 'chatgpt-plus%'").get()).toEqual({n:1});
  expect(f.sql.prepare("SELECT id,name,slug,is_active FROM products WHERE aivault_family='chatgpt-plus'").get())
    .toEqual({id:174,name:"ChatGPT Plus",slug:"chatgpt-plus-av",is_active:0});
  expect(f.sql.prepare("SELECT sku,label,price,stock,is_active FROM product_variants WHERE aivault_service_id='service_chatgpt_plus_1m'").get())
    .toEqual({sku:"AV-service_chatgpt_plus_1m",label:"Plus 1 Bulan (Apple Pay)",price:13500,stock:3,is_active:0});
});

const MIGRATION_0125=readFileSync("drizzle/migrations/0125_aivault_chatgpt_plus_family.sql","utf8");
const OLD_DESCRIPTION="ChatGPT Plus 1 Month (Apple Pay). Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.";
const IMAGE="/r2/products/f87f491ee2f9034845db18eb08c9236d.webp";
it("0125 moves only the exact inactive fallback row and is idempotent",()=>{
  f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,aivault_family,description,image_url,images)
    VALUES(174,'ChatGPT Plus 1 Month (Apple Pay)','chatgpt-plus-1-month-apple-pay-736572766963655f636861746770745f706c75735f316d-av',0,0,0,'service:service_chatgpt_plus_1m','${OLD_DESCRIPTION}',NULL,NULL);
    INSERT INTO product_variants(product_id,sku,label,price,stock,fulfillment_mode,is_active,aivault_service_id)
    VALUES(174,'AV-service_chatgpt_plus_1m','ChatGPT Plus 1 Month (Apple Pay)',0,0,'manual',0,'service_chatgpt_plus_1m');`);
  f.sql.exec(MIGRATION_0125); f.sql.exec(MIGRATION_0125);
  expect(f.sql.prepare("SELECT id,aivault_family,slug,name,image_url,images,description FROM products WHERE id=174").get()).toEqual({
    id:174,aivault_family:"chatgpt-plus",slug:"chatgpt-plus-av",name:"ChatGPT Plus",image_url:IMAGE,
    images:`["${IMAGE}"]`,description:`ChatGPT Plus. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.`,
  });
  expect(f.sql.prepare("SELECT label FROM product_variants WHERE aivault_service_id='service_chatgpt_plus_1m'").get()).toEqual({label:"Plus 1 Bulan (Apple Pay)"});
});
it("0125 leaves an active row, admin copy and custom image untouched",()=>{
  f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,aivault_family,description,image_url,images)
    VALUES(175,'Admin ChatGPT','chatgpt-owner-av',5000,4,1,'service:service_chatgpt_plus_1m','Admin copy','/r2/admin.webp','["/r2/admin.webp"]');
    INSERT INTO product_variants(product_id,sku,label,price,stock,fulfillment_mode,is_active,aivault_service_id)
    VALUES(175,'AV-service_chatgpt_plus_1m','Admin label',5000,4,'manual',1,'service_chatgpt_plus_1m');`);
  f.sql.exec(MIGRATION_0125);
  expect(f.sql.prepare("SELECT aivault_family,slug,name,image_url,images FROM products WHERE id=175").get())
    .toEqual({aivault_family:"service:service_chatgpt_plus_1m",slug:"chatgpt-owner-av",name:"Admin ChatGPT",image_url:"/r2/admin.webp",images:'["/r2/admin.webp"]'});
  expect(f.sql.prepare("SELECT label,is_active FROM product_variants WHERE aivault_service_id='service_chatgpt_plus_1m'").get()).toEqual({label:"Admin label",is_active:1});
});

it("throttles repeated cron and rejects malformed catalogs without zeroing stock",async()=>{
  const db=createDatabaseAccess(f.db),now=Date.now();await publishAivaultCatalog(db,20000,{now});vi.mocked(fetch).mockClear();expect(await publishAivaultCatalog(db,20000,{now:now+1000})).toEqual({skipped:"throttled"});expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({currency:"USD",products:[]}));expect(await publishAivaultCatalog(db,20000,{now:now+180000})).toMatchObject({ok:false});expect(f.sql.prepare("SELECT stock FROM aivault_products").get()?.stock).toBe(5);
});
