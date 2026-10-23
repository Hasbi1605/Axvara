import {afterEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createD1Fixture} from './helpers/d1-fixture';
import {createDatabaseAccess} from '@/lib/db-access';
import {clearRateLimitBucketsForTest} from '@/lib/rateLimit';
let fx:ReturnType<typeof createD1Fixture>;
const code='AXP-20261024-SECURE01';
afterEach(()=>{fx?.close();fx=undefined!;vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();clearRateLimitBucketsForTest();});
function seed(){
 fx=createD1Fixture();
 fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel,order_kind) VALUES(?,'Fixture','6281234567890','buyer@example.test','[]',10000,'qris','lunas','paid','web','pedia')`).run(code);
 fx.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active) VALUES(1,'fixture','instagram','followers','profile','Fixture','[100]',1,1);
 INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,package_prices_json,is_active) VALUES(1,1,'standar','indosmm',86,'G3',20,1000,0,'{"100":10000}',1)`);
 fx.sql.prepare(`INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,credit_used,supplier,supplier_service_id,supplier_rate_snapshot,status,supplier_order_id,submit_attempts) VALUES(?,1,1,'{}','https://instagram.com/fixture/','https://instagram.com/fixture/',100,100,10000,0,'indosmm',86,38750,'submitted','SUP-FIXTURE',1)`).run(code);
 return createDatabaseAccess(fx.db);
}
it('status requires full buyer contact and never returns a historical raw credit code',async()=>{
 seed();fx.sql.exec("UPDATE pedia_order_items SET refund_credit_code='PDK-OLD1-OLD2'");
 const {GET}=await import('@/app/api/pedia/orders/[code]/route');
 const read=(contact?:string)=>GET(new NextRequest('https://fixture/api/pedia/orders/'+code,{headers:contact?{'x-order-contact':contact}:{}}),{params:Promise.resolve({code})});
 expect((await read()).status).toBe(401);expect((await read('567890')).status).toBe(404);expect((await read('other@example.test')).status).toBe(404);
 const r=await read('081234567890');expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');const body=await r.text();expect(body).not.toContain('PDK-');expect(body).not.toContain('refund_credit_code');
});
it.each([null,'',-1,200,'bad'])('partial with invalid or unknown remains %s keeps terminal truth and unknown count',async(remains)=>{
 const db=seed();const {processPediaPaidOrders}=await import('@/lib/pedia/dispatch');
 await processPediaPaidOrders(async()=>({ok:true,data:{status:'Partial',remains},status:200}) as never,db);
 expect(fx.sql.prepare('SELECT status,remains FROM pedia_order_items').get()).toMatchObject({status:'partial',remains:null});
 expect(fx.sql.prepare('SELECT COUNT(*) n FROM pedia_followups').get()?.n).toBe(1);expect(fx.sql.prepare('SELECT COUNT(*) n FROM pedia_credits').get()?.n).toBe(0);
 const {GET}=await import('@/app/api/pedia/orders/[code]/route');const r=await GET(new NextRequest('https://fixture',{headers:{'x-order-contact':'buyer@example.test'}}),{params:Promise.resolve({code})});expect((await r.json()).order).toMatchObject({status:'partial',done:null,percent:null});
});
it('terminal state and manual follow-up roll back together on interruption, then recover once',async()=>{
 const db=seed();const {processPediaPaidOrders}=await import('@/lib/pedia/dispatch');
 fx.control.fail=q=>q.includes('INSERT INTO pedia_followups');
 const supplier=vi.fn(async()=>({ok:true,data:{status:'Partial',remains:40},status:200}) as never);
 await processPediaPaidOrders(supplier,db);
 expect(fx.sql.prepare('SELECT status FROM pedia_order_items').get()?.status).toBe('submitted');expect(fx.sql.prepare('SELECT COUNT(*) n FROM pedia_followups').get()?.n).toBe(0);
 fx.control.fail=null;fx.sql.exec('UPDATE pedia_order_items SET lease_until=NULL');
 await processPediaPaidOrders(supplier,db);await processPediaPaidOrders(supplier,db);
 expect(fx.sql.prepare('SELECT status FROM pedia_order_items').get()?.status).toBe('partial');expect(fx.sql.prepare('SELECT COUNT(*) n FROM pedia_followups').get()?.n).toBe(1);expect(fx.sql.prepare('SELECT COUNT(*) n FROM pedia_credits').get()?.n).toBe(0);expect(supplier).toHaveBeenCalledTimes(2);
});
it('missing production quote secret cannot issue or verify a fallback-signed quote',async()=>{
 vi.stubEnv('NODE_ENV','test');vi.stubEnv('ADMIN_JWT_SECRET','');
 const {createPediaQuoteToken,verifyPediaQuoteToken}=await import('@/lib/pedia/quote');
 const input={product_id:1,tier_id:1,quantity:100,target_raw:'x',target_normalized:'x',unit_price:10,total:1000,credit_used:0,credit_code_hash:null,supplier:'indosmm' as const,supplier_service_id:1,supplier_rate_snapshot:1000};
 const fallback=await createPediaQuoteToken(input);
 vi.stubEnv('NODE_ENV','production');
 await expect(createPediaQuoteToken(input)).rejects.toThrow('pedia_quote_secret_missing');
 expect(await verifyPediaQuoteToken(fallback.token)).toBeNull();
});

it('admin alert retries only conclusive rejection with backoff and a bounded attempt count',async()=>{
 const db=seed();vi.stubEnv('TELEGRAM_ADMIN_CHAT_ID','-123');
 fx.sql.prepare("INSERT INTO pedia_followups(order_code,reason,buyer_notification_claimed_at) VALUES(?,'supplier_partial',datetime('now'))").run(code);
 const api=await import('@/lib/telegram/api');const send=vi.spyOn(api,'sendMessage').mockResolvedValue({ok:false,error_code:429} as never);
 const {notifyPendingPediaFollowups}=await import('@/lib/pedia/followup');
 await notifyPendingPediaFollowups(db);await notifyPendingPediaFollowups(db);expect(send).toHaveBeenCalledTimes(1);
 for(let i=0;i<3;i++){fx.sql.exec("UPDATE pedia_followups SET notification_retry_at=datetime('now','-1 minute')");await notifyPendingPediaFollowups(db)}
 expect(send).toHaveBeenCalledTimes(3);
 expect(fx.sql.prepare('SELECT notification_attempts FROM pedia_followups').get()?.notification_attempts).toBe(3);
});
it('an ambiguous Telegram send is not replayed while the manual queue remains available',async()=>{
 const db=seed();vi.stubEnv('TELEGRAM_ADMIN_CHAT_ID','-123');
 fx.sql.prepare("INSERT INTO pedia_followups(order_code,reason,buyer_notification_claimed_at) VALUES(?,'supplier_partial',datetime('now'))").run(code);
 const api=await import('@/lib/telegram/api');const send=vi.spyOn(api,'sendMessage').mockResolvedValue({ok:false,description:'timeout'} as never);
 const {notifyPendingPediaFollowups}=await import('@/lib/pedia/followup');await notifyPendingPediaFollowups(db);await notifyPendingPediaFollowups(db);
 expect(send).toHaveBeenCalledTimes(1);expect(fx.sql.prepare('SELECT state FROM pedia_followups').get()?.state).toBe('open');
});

it('supplier error text remains literal in HTML Telegram alerts',async()=>{
 const db=seed();vi.stubEnv('TELEGRAM_ADMIN_CHAT_ID','-123');
 const api=await import('@/lib/telegram/api');const send=vi.spyOn(api,'sendMessage').mockResolvedValue({ok:true} as never);
 const {notifyPediaNeedsCheck}=await import('@/lib/pedia/notify');expect(await notifyPediaNeedsCheck(db,code,'<a href="https://example.test">error</a> & retry')).toBe('sent');
 expect(send.mock.calls[0][0].text).toContain('&lt;a');expect(send.mock.calls[0][0].text).not.toContain('<a href');
});
