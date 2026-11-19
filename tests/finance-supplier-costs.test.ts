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

it("StoreBat has its own bucket and uses frozen FX instead of later projection FX",async()=>{
  const {createStorebatOrderLinks}=await import("@/lib/storebat/orders");
  vi.stubEnv("STOREBAT_ENABLED","true");vi.stubEnv("STOREBAT_API_KEY","fixture");
  f.sql.exec("UPDATE products SET storebat_family='gemini'; UPDATE product_variants SET sku='SB-121',storebat_product_id=121,storebat_fx_idr_per_usd=30000,storebat_cost_usd=5");
  paid("SB",[{product_id:1,variant_id:1,price:10000,name:"SB",qty:1,storebat_eligibility:{version:1,kind:"product",sku:"SB-121",product_id:121,family:"gemini",source_variant_id:1,quantity:1,cost_usd:0.5,fx_idr_per_usd:18000}}]);
  expect(await createStorebatOrderLinks("SB",createDatabaseAccess(f.db))).toBe(1);
  f.sql.exec("UPDATE storebat_order_links SET status='completed'");
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({cost:9000,estimated_orders:0,suppliers:{storebat:{cost:9000},manual:{cost:0}}});
  // Should-Fix 3: Muse Buff processing link has refunded_usd = 0, so it remains estimated until completed/refunded
  f.sql.exec("UPDATE storebat_order_links SET status='processing', refunded_usd=0");
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({estimated_orders:1});
  f.sql.exec("UPDATE storebat_order_links SET status='needs_admin', refunded_usd=0.5");
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({estimated_orders:0});
});

it("Mirai has its own bucket and uses frozen link FX instead of later projection FX", async () => {
  const { createMiraiOrderLinks } = await import("@/lib/mirai/orders");
  vi.stubEnv("MIRAI_ENABLED", "true");
  vi.stubEnv("MIRAI_SYNC_ENABLED", "true");
  vi.stubEnv("MIRAI_API_KEY", "fixture");
  f.sql.exec("UPDATE products SET mirai_family='gpt'; UPDATE product_variants SET sku='MR-GPT_10M',mirai_package_code='GPT_10M',mirai_fx_idr_per_usdt=30000,mirai_cost_usdt=5; INSERT INTO mirai_packages(package_code,group_key,name,quota_tokens,duration_seconds,reseller_price_vnd,cost_usdt,fx_idr_per_usdt) VALUES('GPT_10M','gpt','GPT 10M',10000000,86400,6650,0.25,18000)");
  paid("MR", [{ product_id: 1, variant_id: 1, price: 10000, name: "MR", qty: 1, mirai_eligibility: { version: 1, package_code: "GPT_10M", mirai_family: "gpt", sku: "MR-GPT_10M", source_variant_id: 1, quantity: 1, cost_usdt: 0.5 } }]);
  expect(await createMiraiOrderLinks("MR", createDatabaseAccess(f.db))).toBe(1);
  f.sql.exec("UPDATE mirai_order_links SET status='completed'; UPDATE mirai_packages SET fx_idr_per_usdt=30000");
  expect(await readSelectedFinancialReport("today", now)).toMatchObject({ cost: 9000, estimated_orders: 0, suppliers: { mirai: { cost: 9000 }, manual: { cost: 0 } } });
});

it("uses verified Jaspay cost during processing and keeps completed catalog prices estimated",async()=>{
  vi.stubEnv("WARUNG_REBAHAN_API_KEY","fixture");
  f.sql.exec("UPDATE product_variants SET wr_variant_id='jaspay:wink:pkg-id'");
  const item={product_id:1,variant_id:1,price:10000,name:"Wink",qty:1};
  paid("JSP",[item,item]);
  f.sql.exec(`INSERT INTO wr_order_links(id,order_code,wr_variant_id,wr_order_id,quantity,wr_cost,status)
    VALUES(1,'JSP','jaspay:wink:pkg-id','JSP-OWN',2,12000,'completed')`);
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({cost:12000,estimated_orders:1,estimated_jaspay_order_codes:["JSP"]});
  f.sql.exec("UPDATE wr_order_links SET status='processing'");
  const { pollKnownJaspayInvoice }=await import("@/lib/warung-rebahan/order");
  const attempt=vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>{
    expect(String(input)).toMatch(/\/jaspay\/status$/);
    expect(JSON.parse(String(init?.body)).invoice).toBe("JSP-OWN");
    return Response.json({success:true,data:{invoice:"JSP-OWN",product:"wink",package:"Display Name",quantity:2,total:11000,refunded:0,status:"processing"}});
  });
  try {
    await pollKnownJaspayInvoice(1,createDatabaseAccess(f.db));
    expect(attempt).toHaveBeenCalledTimes(1);
    const report=await readSelectedFinancialReport("today",now);
    expect(report).toMatchObject({cost:11000,estimated_orders:0,estimated_order_codes:[],estimated_jaspay_order_codes:[],suppliers:{wr:{cost:11000}}});
    expect(f.sql.prepare("SELECT status,wr_cost FROM wr_order_links").get()).toEqual({status:"processing",wr_cost:12000});
  } finally {attempt.mockRestore();}
});

it("treats manually delivered tunvn/aivault/storebat/mirai links as non-estimated while keeping snapshot cost (AXV-20261119-0FC3511A shape)",async()=>{
  // Exact AXV-20261119-0FC3511A shape: TUNVN needs_admin + unconfirmed_buff_receipt, item delivered manually.
  paid("AXV-20261119-0FC3511A",[{product_id:1,variant_id:1,price:1500,name:"Muse Buff 10B",qty:10}]);
  f.sql.exec(`
    INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,status,delivered_message_id,last_error)
      VALUES('AXV-20261119-0FC3511A',0,1,1,10,'manual','delivered','manual','manual_handover:admin@axvara.tech');
    INSERT INTO tunvn_order_links(order_code,item_index,variant_id,product_id,kind,quantity,cost_usdt,fx_idr_per_usdt,status,last_error)
      VALUES('AXV-20261119-0FC3511A',0,1,1,'buff',10,0.583,18258.44,'needs_admin','unconfirmed_buff_receipt');
  `);
  const expectedCost = Math.round(0.583 * 18258.44);
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({
    cost: expectedCost,
    estimated_orders: 0,
    estimated_order_codes: [],
    suppliers: { tunvn: { orders: 1, cost: expectedCost } },
  });

  // Same link before delivery (manual_required) must stay estimated.
  f.sql.exec("UPDATE fulfillment_items SET status='manual_required' WHERE order_code='AXV-20261119-0FC3511A'");
  expect(await readSelectedFinancialReport("today",now)).toMatchObject({
    cost: expectedCost,
    estimated_orders: 1,
    estimated_order_codes: ["AXV-20261119-0FC3511A"],
  });
  f.sql.exec("UPDATE fulfillment_items SET status='delivered' WHERE order_code='AXV-20261119-0FC3511A'");

  // AIVault, StoreBat, Mirai non-completed links resolved manually by item_index.
  paid("AIV-MAN",[{product_id:1,variant_id:1,price:20000,name:"AV",qty:1}]);
  paid("SB-MAN",[{product_id:1,variant_id:1,price:20000,name:"SB",qty:1}]);
  paid("MR-MAN",[{product_id:1,variant_id:1,price:20000,name:"MR",qty:1}]);
  paid("MULTI-PART",[{product_id:1,variant_id:1,price:10000,name:"Item 0",qty:1},{product_id:1,variant_id:1,price:10000,name:"Item 1",qty:1}]);
  f.sql.exec(`
    INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,status) VALUES
      ('AIV-MAN',0,1,1,1,'manual','delivered'),
      ('SB-MAN',0,1,1,1,'manual','delivered'),
      ('MR-MAN',0,1,1,1,'manual','delivered'),
      ('MULTI-PART',0,1,1,1,'manual','delivered'),
      ('MULTI-PART',1,1,1,1,'manual','manual_required');
    INSERT INTO aivault_order_links(order_code,item_index,variant_id,product_id,service_id,quantity,cost_usd,fx_idr_per_usd,external_order_id,status)
      VALUES('AIV-MAN',0,1,1,'svc',1,0.5,16000,'av-1','needs_admin');
    INSERT INTO storebat_order_links(order_code,item_index,variant_id,product_id,storebat_product_id,kind,quantity,cost_usd,fx_idr_per_usd,idempotency_key,status)
      VALUES('SB-MAN',0,1,1,55,'product',1,0.4,16000,'sb-1','needs_admin');
    INSERT INTO mirai_order_links(order_code,item_index,variant_id,product_id,package_code,quantity,cost_usdt,fx_idr_per_usdt,external_order_id,idempotency_key,status)
      VALUES('MR-MAN',0,1,1,'PKG',1,0.3,17000,'mr-1','mr-k1','needs_admin');
    INSERT INTO tunvn_order_links(order_code,item_index,variant_id,product_id,kind,quantity,cost_usdt,fx_idr_per_usdt,status) VALUES
      ('MULTI-PART',0,1,1,'account',1,1,16000,'needs_admin'),
      ('MULTI-PART',1,1,1,'account',1,1,16000,'needs_admin');
  `);
  const report = await readSelectedFinancialReport("today",now);
  expect(report).toMatchObject({
    estimated_orders: 1,
    estimated_order_codes: ["MULTI-PART"],
    suppliers: {
      tunvn: { cost: expectedCost + 32000 },
      aivault: { cost: 8000 },
      storebat: { cost: 6400 },
      mirai: { cost: 5100 },
    },
  });
});
