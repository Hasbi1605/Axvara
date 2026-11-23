import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { decideDirtyWinners } from "@/lib/supplier-pairs";
import { requireAdmin } from "@/lib/auth";
import { DELETE, PATCH, PUT } from "@/app/api/products/[id]/route";
import { GET } from "@/app/api/products/route";
import { POST as saveVariants, PUT as updateVariant } from "@/app/api/admin/variants/route";
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ sid: "fixture", email: "admin@example.test" })) }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: vi.fn(() => true), rateLimit: vi.fn(() => true), rateLimitKey: vi.fn(() => "fixture") }));
let f: ReturnType<typeof createD1Fixture>;
const id=50000;
const params={params:Promise.resolve({id:String(id)})};
function req(method:string, body?:unknown, suffix="") { return new NextRequest(`http://localhost/api/products/${id}${suffix}`,{method,...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})}); }
async function archive() { const r=await DELETE(req("DELETE"),params);expect(r.status).toBe(200);return r; }
function order(items:unknown = [{product_id:id,variant_id:id}]) {
  f.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method) VALUES('ARCHIVE-ORDER','Fixture','000',?,1000,'qris')").run(JSON.stringify(items));
}
beforeEach(()=>{
  f=createD1Fixture();
  vi.stubEnv("PRODUCT_VARIANTS_WRITE","true");
  f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active) VALUES(${id},'Archive fixture','archive-fixture',1000,3,1);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active) VALUES(${id},${id},'ARCHIVE-TEST','Default',1000,3,1)`);
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("External network disabled");}));
});
afterEach(()=>{f.close();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});

it("archives atomically, disappears publicly, restores inactive, then allows explicit activation",async()=>{
  expect(await (await archive()).json()).toEqual({ok:true,action:"archived"});
  expect(f.sql.prepare("SELECT archived_at,is_active FROM products WHERE id=?").get(id)).toMatchObject({archived_at:expect.any(String),is_active:0});
  expect(f.sql.prepare("SELECT is_active FROM product_variants WHERE id=?").get(id)?.is_active).toBe(0);
  const list=await (await GET(new NextRequest("http://localhost/api/products"))).json();
  expect(list.counts).toEqual({all:0,archive:1,live:0,hidden:0,off:0});
  expect(list.products[0]).toMatchObject({archivedAt:expect.any(String),canHardDelete:true,hardDeleteReason:null});
  vi.mocked(requireAdmin).mockResolvedValueOnce(null);
  const publicList=await (await GET(new NextRequest("http://localhost/api/products"))).json();
  expect(publicList.products).toEqual([]);expect(publicList.counts).toBeUndefined();
  expect((await PATCH(req("PATCH",{archived:false}),params)).status).toBe(200);
  expect(f.sql.prepare("SELECT archived_at,is_active FROM products WHERE id=?").get(id)).toEqual({archived_at:null,is_active:0});
  expect(f.sql.prepare("SELECT is_active FROM product_variants WHERE id=?").get(id)?.is_active).toBe(0);
  const response=await PUT(req("PUT",{isActive:true,variants:[{id,sku:"ARCHIVE-TEST",label:"Default",price:1000,stock:3,is_active:1}]}),params);
  expect(response.status).toBe(200);
  expect((await PATCH(req("PATCH",{archived:false}),params)).status).toBe(409);
  expect(f.sql.prepare("SELECT is_active FROM products WHERE id=?").get(id)?.is_active).toBe(1);
});
it("hard-deletes only archived manual rows and variants",async()=>{
  expect((await DELETE(req("DELETE",undefined,"?permanent=1"),params)).status).toBe(409);
  await archive();expect(await (await DELETE(req("DELETE",undefined,"?permanent=1"),params)).json()).toEqual({ok:true,action:"deleted"});
  expect(f.sql.prepare("SELECT id FROM products WHERE id=?").get(id)).toBeUndefined();
  expect(f.sql.prepare("SELECT id FROM product_variants WHERE id=?").get(id)).toBeUndefined();
  expect(f.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
it.each([
  "UPDATE products SET wr_product_id='wr'", "UPDATE products SET sk_product_id='sk'",
  "UPDATE products SET tunvn_family='family'", "UPDATE products SET aivault_family='family'",
  "UPDATE products SET pixelverif_family='google_ai_pro_3m'",
  "UPDATE product_variants SET wr_variant_id='wr'", "UPDATE product_variants SET sk_variant_id='sk'",
  "UPDATE product_variants SET tunvn_source_product_id=123", "UPDATE product_variants SET tunvn_buff_quantity_b=1",
  "UPDATE product_variants SET aivault_service_id='service'",
  "UPDATE product_variants SET pixelverif_flow_type='normal'",
])("rejects supplier ownership even when archived: %s",async(sql)=>{
  f.sql.exec(sql);await archive();
  const r=await DELETE(req("DELETE",undefined,"?permanent=1"),params);expect(r.status).toBe(409);expect((await r.json()).error).toContain("supplier");
  const list=await (await GET(new NextRequest("http://localhost/api/products"))).json();expect(list.products[0].canHardDelete).toBe(false);
});
it.each(["product","variant","invalid","inventory","fulfillment","cost","job","pair","group","session","wr_mirror","wr_variant","sk_mirror","tunvn_mirror","av_mirror","tunvn_order","av_order"])("preserves history/reference: %s",async(kind)=>{
  order(kind==="variant" ? [{variant_id:String(id)}] : kind==="product" ? [{product_id:String(id)}] : []);
  if(kind==="invalid")f.sql.exec("UPDATE orders SET items='invalid'");
  if(kind==="inventory")f.sql.exec(`INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(${id},${id},'fake','fake','fake')`);
  if(kind==="fulfillment")f.sql.exec(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode) VALUES('ARCHIVE-ORDER',0,${id},${id},1,'manual')`);
  if(kind==="cost")f.sql.exec(`INSERT INTO order_item_costs(order_code,item_index,product_id,variant_id,source,unit_cost) VALUES('ARCHIVE-ORDER',0,${id},${id},'manual',1)`);
  if(kind==="job")f.sql.exec(`INSERT INTO fulfillment_jobs(order_code,variant_id) VALUES('ARCHIVE-ORDER',${id})`);
  if(kind==="pair")f.sql.exec(`INSERT INTO supplier_pairs(wr_product_id,sk_product_id) VALUES(${id},99999)`);
  if(kind==="group")f.sql.exec(`INSERT INTO product_groups(id,name) VALUES(900,'Archive');INSERT INTO product_group_members(group_id,product_id,position) VALUES(900,${id},0)`);
  if(kind==="session")f.sql.exec(`INSERT INTO whatsapp_sessions(conversation_id,member_id,expires_at,selected_product_id,selected_variant_id) VALUES('fixture','fixture','2099-01-01',${id},${id})`);
  if(kind==="wr_mirror"||kind==="wr_variant") {f.sql.exec(`INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('wr','WR',${kind==="wr_mirror"?id:'NULL'})`);if(kind==="wr_variant")f.sql.exec(`INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id) VALUES('wv','wr','V',1,1,${id})`);}
  if(kind==="sk_mirror")f.sql.exec(`INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,axvara_variant_id) VALUES('sv','sp','SK','V',1,1,${id})`);
  if(kind==="tunvn_mirror")f.sql.exec(`INSERT INTO tunvn_products(supplier_product_id,name,axvara_product_id) VALUES(123,'T',${id})`);
  if(kind==="av_mirror")f.sql.exec(`INSERT INTO aivault_products(service_id,name,unit_price_usd,pricing_tiers_json,axvara_product_id) VALUES('service','AV',1,'[]',${id})`);
  if(kind==="tunvn_order")f.sql.exec(`INSERT INTO tunvn_order_links(order_code,item_index,product_id,variant_id,kind,quantity,cost_usdt) VALUES('ARCHIVE-ORDER',0,${id},${id},'account',1,1)`);
  if(kind==="av_order")f.sql.exec(`INSERT INTO aivault_order_links(order_code,item_index,product_id,variant_id,service_id,quantity,cost_usd,external_order_id) VALUES('ARCHIVE-ORDER',0,${id},${id},'service',1,1,'external')`);
  await archive();expect((await DELETE(req("DELETE",undefined,"?permanent=1"),params)).status).toBe(409);
});
it("rechecks history inside the batch and rolls back variants on a race",async()=>{
  await archive();const original=f.db.batch;
  f.db.batch=async statements=>{if(statements.some(s=>String((s as unknown as {query:string}).query).includes('DELETE FROM products')))order();return original(statements);};
  expect((await DELETE(req("DELETE",undefined,"?permanent=1"),params)).status).toBe(409);
  expect(f.sql.prepare("SELECT id FROM product_variants WHERE id=?").get(id)).toBeTruthy();
});
it("rejects activation via product or variant editors and enforces a SQL race fence",async()=>{
  await archive();
  for (const body of [{isActive:true},{variants:[{id,sku:"ARCHIVE-TEST",label:"Default",price:1000,is_active:1}]}]) {
    const r=await PUT(req("PUT",body),params);expect(r.status).toBe(409);expect((await r.json()).error).toBe("Pulihkan dari Arsip dulu");
  }
  expect((await saveVariants(new NextRequest('http://localhost/api/admin/variants',{method:'POST',body:JSON.stringify({product_id:id,variants:[{id,product_id:id,sku:'ARCHIVE-TEST',label:'Default',price:1000,is_active:1}]})}))).status).toBe(409);
  expect((await updateVariant(new NextRequest(`http://localhost/api/admin/variants?id=${id}`,{method:'PUT',body:JSON.stringify({id,is_active:1})}))).status).toBe(409);
  expect(()=>f.sql.exec(`UPDATE products SET is_active=1 WHERE id=${id}`)).toThrow('product_archived');
  expect(()=>f.sql.exec(`UPDATE product_variants SET is_active=1 WHERE id=${id}`)).toThrow('product_archived');
  expect(()=>f.sql.exec(`INSERT INTO product_variants(product_id,sku,label,price,is_active) VALUES(${id},'NEW','New',1000,1)`)).toThrow('product_archived');
});
it("group winner moves to the available unarchived member after archive",async()=>{
  f.sql.exec(`INSERT INTO products(id,name,slug,price) VALUES(50001,'Other','other',1000);INSERT INTO product_variants(product_id,sku,label,price,stock) VALUES(50001,'OTHER','Other',1000,5);
    INSERT INTO product_groups(id,name,winner_product_id) VALUES(900,'Archive group',${id});
    INSERT INTO product_group_members(group_id,product_id,position) VALUES(900,${id},0),(900,50001,1)`);
  await archive();await decideDirtyWinners(createDatabaseAccess(f.db));
  expect(f.sql.prepare(`SELECT winner_product_id AS winner FROM product_groups WHERE id=900`).get()?.winner).toBe(50001);
});
it("authorization is required for every lifecycle mutation",async()=>{
  vi.mocked(requireAdmin).mockResolvedValueOnce(null);expect((await DELETE(req('DELETE'),params)).status).toBe(401);
  vi.mocked(requireAdmin).mockResolvedValueOnce(null);expect((await PATCH(req('PATCH',{archived:false}),params)).status).toBe(401);
});
