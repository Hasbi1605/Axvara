import {afterEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {createD1Fixture,insertTestProduct} from "./helpers/d1-fixture";
import {clearRateLimitBucketsForTest} from "@/lib/rateLimit";
let fx:ReturnType<typeof createD1Fixture>;
afterEach(()=>{fx?.close();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();clearRateLimitBucketsForTest();});
it('two concurrent Telegram cart confirmations create one pending order and one invoice call',async()=>{
 fx=createD1Fixture();await insertTestProduct(fx.sql,'manual');fx.sql.exec("INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES('12345','12345','Fixture'); INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('12345',1,1,1)");
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('NETWORK FORBIDDEN BY AUDIT')}));
 const qris=await import('@/lib/payments/dana-qris');const invoice=vi.spyOn(qris,'createActiveQrisInvoice').mockImplementation(async(code,amount)=>({orderCode:code,requestedAmount:amount,payableAmount:amount+1,uniqueCode:1,qrisPayload:'fixture',qrisUrl:'/fixture.png',expiresAt:'2099-01-01',isExisting:false}));
 const api=await import('@/lib/telegram/api');vi.spyOn(api,'sendMessage').mockResolvedValue({ok:true,result:{message_id:1}} as never);vi.spyOn(api,'sendPhoto').mockResolvedValue({ok:true} as never);
 const {handleCallback}=await import('@/lib/telegram/handlers/callback');await Promise.all([handleCallback('cconfirm',12345,1,{id:12345,first_name:'Fixture'}),handleCallback('cconfirm',12345,1,{id:12345,first_name:'Fixture'})]);
 expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders WHERE telegram_chat_id='12345' AND status='pending'").get()?.n).toBe(1);expect(invoice).toHaveBeenCalledTimes(1);expect(fx.sql.prepare('SELECT stock FROM product_variants WHERE id=1').get()?.stock).toBe(99);
});

it.each(['email_for:1:1:1','emailcart:1','search:','qty:1:1','wa:'])('Telegram /batal clears input state %s',async(pending)=>{
 fx=createD1Fixture();fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name,pending_action) VALUES('12345','12345','Fixture',?)").run(pending);
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('NETWORK FORBIDDEN BY AUDIT')}));const api=await import('@/lib/telegram/api');vi.spyOn(api,'sendMessage').mockResolvedValue({ok:true,result:{message_id:1}} as never);
 const {handleCommand}=await import('@/lib/telegram/handlers/command');await handleCommand('/batal',12345,'private',{id:12345,first_name:'Fixture'});expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='12345'").get()?.pending_action).toBeNull();
});
it('Telegram fails closed before callbacks on durable update claim failure',async()=>{
 fx=createD1Fixture();vi.stubEnv('TELEGRAM_WEBHOOK_SECRET','audit-fixture');vi.stubEnv('TELEGRAM_BOT_ENABLED','true');vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('NETWORK FORBIDDEN BY AUDIT')}));fx.control.fail=(q)=>q.includes('INSERT INTO telegram_updates');
 const api=await import('@/lib/telegram/api');const answer=vi.spyOn(api,'answerCallbackQuery').mockResolvedValue({ok:true} as never);
 const {POST}=await import('@/app/api/telegram/webhook/route');const r=await POST(new NextRequest('http://localhost/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'audit-fixture'},body:JSON.stringify({update_id:123456,callback_query:{id:'fixture-callback',from:{id:12345,first_name:'Fixture'},message:{message_id:1,chat:{id:12345}}}})}));expect(r.status).toBe(503);expect(answer).not.toHaveBeenCalled();expect(fx.sql.prepare('SELECT COUNT(*) AS n FROM telegram_updates').get()?.n).toBe(0);
});


it('an expired unswept Telegram order does not block a new live order',async()=>{
 fx=createD1Fixture();await insertTestProduct(fx.sql,'manual');fx.sql.exec("INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES('12345','12345','Fixture'); INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('12345',1,1,1); INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_chat_id,expires_at) VALUES('OLD','','','[]',1000,'qris','pending','pending','telegram','12345','2000-01-01')");
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('No real network in regression')}));
 const qris=await import('@/lib/payments/dana-qris');const invoice=vi.spyOn(qris,'createActiveQrisInvoice').mockImplementation(async(code,amount)=>({orderCode:code,requestedAmount:amount,payableAmount:amount+1,uniqueCode:1,qrisPayload:'fixture',qrisUrl:'/fixture.png',expiresAt:'2099-01-01',isExisting:false}));
 const api=await import('@/lib/telegram/api');vi.spyOn(api,'sendMessage').mockResolvedValue({ok:true,result:{message_id:1}} as never);vi.spyOn(api,'sendPhoto').mockResolvedValue({ok:true} as never);
 const {handleCallback}=await import('@/lib/telegram/handlers/callback');await handleCallback('cconfirm',12345,1,{id:12345,first_name:'Fixture'});
 expect(invoice).toHaveBeenCalledTimes(1);expect(invoice.mock.calls[0][0]).not.toBe('OLD');expect(fx.sql.prepare('SELECT stock FROM product_variants WHERE id=1').get()?.stock).toBe(99);
});
