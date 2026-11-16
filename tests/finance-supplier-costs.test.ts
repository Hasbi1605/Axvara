import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { createD1Fixture,insertTestOrder } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { readSelectedFinancialReport } from "@/lib/dashboard-report";
import { createTunvnOrderLinks } from "@/lib/tunvn/orders";
import { createAivaultOrderLinks } from "@/lib/aivault/orders";

let f:ReturnType<typeof createD1Fixture>;
const now=new Date("2026-11-16T12:00:00Z");
beforeEach(()=>{f=createD1Fixture();f.sql.exec("INSERT INTO products(id,name,slug,price) VALUES(1,'Product','product',10000); INSERT INTO product_variants(id,product_id,sku,label,price,manual_cost) VALUES(1,1,'MAN','Product',10000,4000)");});
afterEach(()=>{f.close();vi.unstubAllEnvs();});
const paid=(code:string,items?:Record<string,unknown>[])=>{insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items});f.sql.prepare("UPDATE orders SET paid_at='2026-11-16T00:00:00Z' WHERE code=?").run(code);};

it.each(["wr","sk"] as const)("%s final failed cost=0, same-row retry remains estimated, completed retry row wins over newer failures",async supplier=>{
  f.sql.exec(`UPDATE product_variants SET ${supplier}_variant_id='supplier-1'`);
  paid("ORDER");
  const table=`${supplier}_order_links`,cost=`${supplier}_cost`;
  f.sql.exec(`INSERT INTO ${table}(order_code,${supplier}_variant_id,${cost},status) VALUES('ORDER','supplier-1',4000,'failed')`);
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({cost:0,profit:10000,estimated_orders:0});
  f.sql.exec(`UPDATE ${table} SET status='retry'`);
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({cost:4000,estimated_orders:1,estimated_order_codes:["ORDER"]});
  f.sql.exec(`UPDATE ${table} SET status='completed'; INSERT INTO ${table}(order_code,${supplier}_variant_id,${cost},status) VALUES('ORDER','supplier-1',9000,'failed')`);
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({cost:4000,estimated_orders:0});
});

it("TUNVN links freeze account/catalog and Buff/variant FX on creation; reports ignore later FX changes",async()=>{
  vi.stubEnv("TUNVN_ENABLED","true");vi.stubEnv("TUNVN_SYNC_ENABLED","true");vi.stubEnv("TUNVN_API_KEY","fixture");
  f.sql.exec("UPDATE product_variants SET sku='TUNVN-86',tunvn_source_product_id=86; INSERT INTO tunvn_products(supplier_product_id,name,price_usdt,fx_idr_per_usdt) VALUES(86,'Account',2,18000); INSERT INTO crypto_market_snapshot(id,fx_rate_text) VALUES(1,'16000')");
  const item={product_id:1,variant_id:1,price:10000,name:"T",qty:1,tunvn_eligibility:{version:1,kind:"account",source_product_id:86,source_variant_id:1,source_unit_b:null,quantity:1,cost_usdt:2}};
  paid("T",[item]);
  expect(await createTunvnOrderLinks("T",createDatabaseAccess(f.db))).toBe(1);
  expect(f.sql.prepare("SELECT fx_idr_per_usdt fx FROM tunvn_order_links").get()?.fx).toBe(18000);
  f.sql.exec("UPDATE tunvn_order_links SET status='completed'; UPDATE tunvn_products SET fx_idr_per_usdt=30000; UPDATE crypto_market_snapshot SET fx_rate_text='40000'");
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({cost:36000,estimated_orders:0});
  f.sql.exec("UPDATE product_variants SET sku='TUNVN-BUFF-1B',tunvn_fx_idr_per_usdt=17000,tunvn_buff_quantity_b=1,buyer_field_key='muse_invite_code',max_qty=30");
  paid("BUFF",[{...item,buyer_field_key:"muse_invite_code",buyer_fields:{muse_invite_code:"Ab12Cd"},max_qty:30,tunvn_eligibility:{version:1,kind:"buff",source_product_id:null,source_variant_id:1,source_unit_b:1,quantity:1,cost_usdt:2}}]);
  expect(await createTunvnOrderLinks("BUFF",createDatabaseAccess(f.db))).toBe(1);
  expect(f.sql.prepare("SELECT fx_idr_per_usdt fx FROM tunvn_order_links WHERE order_code='BUFF'").get()?.fx).toBe(17000);
});

it.each(["wr","sk"] as const)("%s completed retry does not steal another fulfillment item's cost",async supplier=>{
  f.sql.exec(`UPDATE product_variants SET ${supplier}_variant_id='supplier-1'`);
  const item={product_id:1,variant_id:1,price:10000,name:"Same variant",qty:1}; paid("TWO",[item,item]);
  f.sql.exec("INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id,qty,fulfillment_mode) VALUES(1,'TWO',0,1,1,1,'manual'),(2,'TWO',1,1,1,1,'manual')");
  f.sql.exec(`INSERT INTO ${supplier}_order_links(order_code,${supplier}_variant_id,${supplier}_cost,status,fulfillment_item_id) VALUES('TWO','supplier-1',4000,'completed',1),('TWO','supplier-1',5000,'processing',2)`);
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({cost:9000,estimated_orders:1});
});

it("AIVault links freeze product FX or market fallback, with durable report priority",async()=>{
  vi.stubEnv("AIVAULT_ENABLED","true");vi.stubEnv("AIVAULT_SYNC_ENABLED","true");vi.stubEnv("AIVAULT_API_KEY","fixture");
  f.sql.exec("UPDATE product_variants SET aivault_service_id='service_test'; INSERT INTO aivault_products(service_id,name,unit_price_usd,pricing_tiers_json,fx_idr_per_usd) VALUES('service_test','A',1,'[]',17000); INSERT INTO crypto_market_snapshot(id,fx_rate_text) VALUES(1,'16000')");
  const item={product_id:1,variant_id:1,price:10000,name:"A",qty:1,aivault_eligibility:{version:1,service_id:"service_test",source_variant_id:1,quantity:1,cost_usd:1}};
  paid("A",[item]);
  expect(await createAivaultOrderLinks("A",createDatabaseAccess(f.db))).toBe(1);
  expect(f.sql.prepare("SELECT fx_idr_per_usd fx FROM aivault_order_links").get()?.fx).toBe(17000);
  f.sql.exec("UPDATE aivault_order_links SET status='completed'; UPDATE aivault_products SET fx_idr_per_usd=30000; UPDATE crypto_market_snapshot SET fx_rate_text='40000'");
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({cost:17000,estimated_orders:0});
  f.sql.exec("UPDATE aivault_products SET fx_idr_per_usd=NULL"); paid("FALLBACK",[item]);
  expect(await createAivaultOrderLinks("FALLBACK",createDatabaseAccess(f.db))).toBe(1);
  expect(f.sql.prepare("SELECT fx_idr_per_usd fx FROM aivault_order_links WHERE order_code='FALLBACK'").get()?.fx).toBe(40000);
});
