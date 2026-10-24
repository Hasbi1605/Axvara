import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createD1Fixture } from './helpers/d1-fixture';
import { POST,GET } from '@/app/api/admin/broadcasts/route';
import { processBroadcasts } from '@/lib/broadcasts/worker';
import { createDatabaseAccess,createBudgetedDatabase } from '@/lib/db-access';
vi.mock('@/lib/whatsapp/gateway',async original=>({...await original<object>(),salesGatewayControl:vi.fn(),sendTextMessage:vi.fn()}));
vi.mock('@/lib/broadcasts/sender',()=>({sendBroadcast:vi.fn()}));
vi.mock('@/lib/telegram/api',()=>({sendMessage:vi.fn(async()=>({ok:true,result:{message_id:1}}))}));
const TEMPLATE='11111111-1111-4111-8111-111111111111',CAMPAIGN='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
const GROUP='120363123456789012@g.us',identity={botNumber:'6283181632507',botRevision:'initial',groupId:GROUP};
const content={name:'Promo mingguan',title:'Promo <AXVARA>',body:'Baris pertama\nBaris kedua',cta_label:'Buka toko',cta_url:'https://axvara.tech/'};
let f:ReturnType<typeof createD1Fixture>,cookie:string;
const req=(body:unknown,auth=true)=>new NextRequest('http://localhost/api/admin/broadcasts',{method:'POST',headers:{cookie:auth?cookie:''},body:JSON.stringify(body)});
const post=(body:unknown,auth=true)=>POST(req(body,auth));
const launch=(id=CAMPAIGN,channels=['email','telegram','whatsapp'])=>post({action:'send',id,templateId:TEMPLATE,revision:1,channels,waIdentity:identity});
beforeEach(async()=>{
 f=createD1Fixture();
 vi.stubEnv('ADMIN_EMAIL','admin@axvara.tech');vi.stubEnv('ADMIN_PASSWORD_SHA256','c'.repeat(64));vi.stubEnv('ADMIN_JWT_SECRET','broadcast-test-secret-1234567890');
 vi.stubEnv('TELEGRAM_BOT_ENABLED','true');vi.stubEnv('TELEGRAM_BOT_TOKEN','fixture');vi.stubEnv('RESEND_API_KEY','fixture');vi.stubEnv('FORWARD_FROM_EMAIL','noreply@axvara.tech');
 const {createAdminToken,createIdleToken}=await import('@/lib/auth');const {token,sid}=await createAdminToken('admin@axvara.tech');cookie=`axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(await createIdleToken(sid))}`;
 f.sql.prepare('INSERT INTO broadcast_templates(id,name,title,body,cta_label,cta_url) VALUES(?,?,?,?,?,?)').run(TEMPLATE,...Object.values(content));
 f.sql.prepare('INSERT INTO newsletter_subscribers(id,email,status,unsubscribe_token) VALUES(1,?,?,?)').run('buyer@example.test','active','a'.repeat(64));
 f.sql.prepare('INSERT INTO newsletter_subscribers(id,email,status,unsubscribe_token) VALUES(2,?,?,?)').run('stopped@example.test','unsubscribed','b'.repeat(64));
 f.sql.exec("INSERT INTO telegram_users(user_id,chat_id,is_blocked,broadcast_opt_out,pending_action) VALUES('11','11',0,0,'waiting'),('22','22',1,0,NULL),('33','-100',0,0,NULL),('44','44',0,1,NULL),('55evil','55evil',0,0,NULL)");
 const {salesGatewayControl}=await import('@/lib/whatsapp/gateway');vi.mocked(salesGatewayControl).mockReset().mockResolvedValue({connected:true,...identity,groupName:"AXVARA'S"});
 const {sendBroadcast}=await import('@/lib/broadcasts/sender');vi.mocked(sendBroadcast).mockReset().mockResolvedValue({state:'sent',providerId:'fixture-id'});
});
afterEach(()=>{f.close();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});
function due(){f.sql.exec("UPDATE broadcast_deliveries SET next_attempt_at='2000-01-01';UPDATE broadcast_dispatch_control SET email_after=NULL,telegram_after=NULL");}
describe('reusable broadcast templates and launch snapshots',()=>{
 it('requires admin for library, edits and launches; never sends on save/review',async()=>{
  expect((await GET(new NextRequest('http://localhost/api/admin/broadcasts'))).status).toBe(401);
  expect((await post({action:'save',content},false)).status).toBe(401);expect((await launch()).status).toBe(202);
  const {sendBroadcast}=await import('@/lib/broadcasts/sender');expect(sendBroadcast).not.toHaveBeenCalled();
  const list=await GET(new NextRequest('http://localhost/api/admin/broadcasts',{headers:{cookie}}));expect(list.headers.get('cache-control')).toBe('private, no-store');
  expect(JSON.stringify(await list.json())).not.toContain('buyer@example.test');
 });
 it('validates content, links and destinations before saving',async()=>{
  for(const data of [{...content,body:''},{...content,title:'bad\r\nSubject'},{...content,cta_url:'javascript:alert(1)'},{...content,cta_url:'https://user:pass@example.test'},{...content,cta_label:''}])expect((await post({action:'save',content:data})).status).toBe(400);
  expect((await post({action:'review',templateId:TEMPLATE,revision:1,channels:['email','email']})).status).toBe(400);
  const response=await post({action:'save',content:{...content,cta_url:'/pedia'}});expect(response.status).toBe(201);
  const {id}=await response.json();expect(f.sql.prepare('SELECT cta_url FROM broadcast_templates WHERE id=?').get(id)?.cta_url).toBe('https://axvara.tech/pedia');
 });
 it('supports repeated use while edits and archives cannot change an existing campaign',async()=>{
  expect((await launch()).status).toBe(202);
  expect((await post({action:'save',id:TEMPLATE,revision:1,content:{...content,body:'Pesan baru'}})).status).toBe(200);
  expect((await post({action:'save',id:TEMPLATE,revision:1,content})).status).toBe(409);
  expect(JSON.parse(String(f.sql.prepare('SELECT snapshot_json FROM broadcast_campaigns').get()?.snapshot_json)).body).toBe(content.body);
  expect((await post({action:'archive',id:TEMPLATE,revision:2,archived:true})).status).toBe(200);
  expect((await post({action:'review',templateId:TEMPLATE,revision:3,channels:['email']})).status).toBe(409);
  expect((await post({action:'archive',id:TEMPLATE,revision:3,archived:false})).status).toBe(200);
  expect((await post({action:'send',id:OTHER,templateId:TEMPLATE,revision:4,channels:['email']})).status).toBe(202);
  expect(f.sql.prepare('SELECT count(*) AS n FROM broadcast_campaigns').get()?.n).toBe(2);
 });
 it('previews only active recipients and freezes a deduplicated list on launch/retry',async()=>{
  const review=await post({action:'review',templateId:TEMPLATE,revision:1,channels:['whatsapp','email','telegram']});expect((await review.json()).counts).toEqual({whatsapp:1,email:1,telegram:1});
  const results=await Promise.all([launch(),launch()]);expect(results.map(r=>r.status)).toEqual([202,202]);
  expect(f.sql.prepare('SELECT count(*) AS n FROM broadcast_deliveries').get()?.n).toBe(3);
  f.sql.prepare('INSERT INTO newsletter_subscribers(email,status,unsubscribe_token) VALUES(?,?,?)').run('new@example.test','active','c'.repeat(64));
  expect((await launch()).status).toBe(202);expect(f.sql.prepare('SELECT count(*) AS n FROM broadcast_deliveries').get()?.n).toBe(3);
  expect((await launch(OTHER)).status).toBe(202);expect(f.sql.prepare('SELECT count(*) AS n FROM broadcast_deliveries WHERE campaign_id=?').get(OTHER)?.n).toBe(4);
  expect((await post({action:'send',id:CAMPAIGN,templateId:TEMPLATE,revision:1,channels:['email']})).status).toBe(409);
 });
 it('refuses stale WhatsApp number/group and a template edit during preflight',async()=>{
  const {salesGatewayControl}=await import('@/lib/whatsapp/gateway');
  vi.mocked(salesGatewayControl).mockResolvedValueOnce({connected:true,...identity,botRevision:'new-revision',groupName:"AXVARA'S"});
  expect((await launch()).status).toBe(409);expect(f.sql.prepare('SELECT count(*) AS n FROM broadcast_campaigns').get()?.n).toBe(0);
  vi.mocked(salesGatewayControl).mockImplementationOnce(async()=>{f.sql.exec('UPDATE broadcast_templates SET revision=2');return {connected:true,...identity,groupName:"AXVARA'S"};});
  expect((await launch()).status).toBe(409);expect(f.sql.prepare('SELECT count(*) AS n FROM broadcast_deliveries').get()?.n).toBe(0);
 });
 it('rolls back launch and all recipient rows when snapshot insertion fails',async()=>{
  f.control.fail=query=>query.includes('SELECT c.id,\'telegram\'');
  expect((await launch()).status).toBe(503);f.control.fail=null;
  expect(f.sql.prepare('SELECT count(*) AS n FROM broadcast_campaigns').get()?.n).toBe(0);
  expect((await launch()).status).toBe(202);
 });
});
describe('bounded broadcast delivery',()=>{
 it('rechecks unsubscribes and opt-outs and keeps the snapshot content immutable',async()=>{
  await launch();due();f.sql.exec("UPDATE newsletter_subscribers SET status='unsubscribed' WHERE id=1;UPDATE telegram_users SET broadcast_opt_out=1 WHERE user_id='11';UPDATE broadcast_templates SET body='changed'");
  const result=await processBroadcasts();expect(result).toMatchObject({sent:1,skipped:2});
  const {sendBroadcast}=await import('@/lib/broadcasts/sender');expect(sendBroadcast).toHaveBeenCalledTimes(1);expect(vi.mocked(sendBroadcast).mock.calls[0][2].body).toBe(content.body);
  await processBroadcasts();expect(sendBroadcast).toHaveBeenCalledTimes(1);
 });
 it('serializes workers and cancels pending rows while preserving in-flight results',async()=>{
  await launch();due();const {sendBroadcast}=await import('@/lib/broadcasts/sender');let finish!:(value:any)=>void;
  vi.mocked(sendBroadcast).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const first=processBroadcasts(createDatabaseAccess(),1);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  await processBroadcasts();expect(sendBroadcast).toHaveBeenCalledTimes(1);
  expect((await post({action:'cancel',id:CAMPAIGN})).status).toBe(200);
  finish({state:'sent',providerId:'delivered'});await first;
  expect(f.sql.prepare("SELECT count(*) AS n FROM broadcast_deliveries WHERE status='sent'").get()?.n).toBe(1);
  expect(f.sql.prepare("SELECT count(*) AS n FROM broadcast_deliveries WHERE status='canceled'").get()?.n).toBe(2);
  expect(f.sql.prepare('SELECT status FROM broadcast_campaigns').get()?.status).toBe('canceled');
 });
 it('quarantines interrupted non-idempotent sends and expired email retries',async()=>{
  await launch();f.sql.exec("UPDATE broadcast_deliveries SET status='sending',lease_until='2000-01-01',first_attempt_at='2000-01-01'");
  await processBroadcasts();const {sendBroadcast}=await import('@/lib/broadcasts/sender');expect(sendBroadcast).not.toHaveBeenCalled();
  expect(f.sql.prepare("SELECT count(*) AS n FROM broadcast_deliveries WHERE status='unknown'").get()?.n).toBe(3);
 });
 it('retries ambiguous emails with the same delivery identity inside the dedupe window',async()=>{
  await launch(CAMPAIGN,['email']);due();const {sendBroadcast}=await import('@/lib/broadcasts/sender');
  vi.mocked(sendBroadcast).mockResolvedValueOnce({state:'retry',error:'email_delivery_unknown',retryAfter:60});
  await processBroadcasts();expect(f.sql.prepare('SELECT status FROM broadcast_deliveries').get()?.status).toBe('pending');
  due();await processBroadcasts();expect(sendBroadcast).toHaveBeenCalledTimes(2);
  expect(vi.mocked(sendBroadcast).mock.calls[0]).toEqual(vi.mocked(sendBroadcast).mock.calls[1]);
  expect(f.sql.prepare('SELECT status FROM broadcast_deliveries').get()?.status).toBe('sent');
 });
 it('honors retry_after without consuming attempts and suppresses blocked Telegram users',async()=>{
  await launch(CAMPAIGN,['telegram']);due();const {sendBroadcast}=await import('@/lib/broadcasts/sender');
  vi.mocked(sendBroadcast).mockResolvedValueOnce({state:'retry',error:'telegram_rate_limited',retryAfter:120,consumeAttempt:false});
  await processBroadcasts();expect(f.sql.prepare('SELECT attempts FROM broadcast_deliveries').get()?.attempts).toBe(0);
  expect(Date.parse(String(f.sql.prepare('SELECT telegram_after FROM broadcast_dispatch_control').get()?.telegram_after))).toBeGreaterThan(Date.now()+110000);
  await processBroadcasts();expect(sendBroadcast).toHaveBeenCalledTimes(1);
  due();vi.mocked(sendBroadcast).mockResolvedValueOnce({state:'skipped',error:'telegram_blocked',blocked:true});await processBroadcasts();
  expect(f.sql.prepare("SELECT is_blocked FROM telegram_users WHERE user_id='11'").get()?.is_blocked).toBe(1);
 });
 it('stays within the existing 40-statement cron budget',async()=>{
  for(let i=100;i<115;i++)f.sql.prepare('INSERT INTO telegram_users(user_id,chat_id) VALUES(?,?)').run(String(i),String(i));
  await launch(CAMPAIGN,['telegram']);due();f.control.queries=0;f.control.limit=40;
  const {access}=createBudgetedDatabase(40,2,f.db);const result=await processBroadcasts(access);
  expect(result.sent).toBeGreaterThan(0);expect(result.sent).toBeLessThanOrEqual(8);expect(f.control.queries).toBeLessThanOrEqual(38);
  expect(f.sql.prepare('SELECT worker_token FROM broadcast_dispatch_control').get()?.worker_token).toBeNull();
 });
});
describe('subscriber control',()=>{
 it('uses an inert GET and a scoped unsubscribe POST; re-subscription rotates the token',async()=>{
  await launch(CAMPAIGN,['email']);
  const {GET:preview,POST:unsubscribe}=await import('@/app/api/subscribers/unsubscribe/route');
  const url='http://localhost/api/subscribers/unsubscribe?token='+'a'.repeat(64);
  expect((await preview(new NextRequest(url))).status).toBe(200);expect(f.sql.prepare('SELECT status FROM newsletter_subscribers WHERE id=1').get()?.status).toBe('active');
  expect((await unsubscribe(new NextRequest(url,{method:'POST'}))).status).toBe(200);
  const {POST:subscribe}=await import('@/app/api/subscribers/route');
  await subscribe(new NextRequest('http://localhost/api/subscribers',{method:'POST',body:JSON.stringify({email:'buyer@example.test'})}));
  const record=f.sql.prepare('SELECT status,unsubscribe_token FROM newsletter_subscribers WHERE id=1').get()!;expect(record.status).toBe('active');expect(record.unsubscribe_token).not.toBe('a'.repeat(64));
  due();await processBroadcasts();const {sendBroadcast}=await import('@/lib/broadcasts/sender');expect(sendBroadcast).not.toHaveBeenCalled();
 });
 it('lets Telegram users stop/start broadcasts without altering purchase conversation state',async()=>{
  const {handleCommand}=await import('@/lib/telegram/handlers/command');
  await handleCommand('/stop',11,'private',{id:11,first_name:'Test'});
  expect(f.sql.prepare("SELECT broadcast_opt_out,pending_action FROM telegram_users WHERE user_id='11'").get()).toEqual({broadcast_opt_out:1,pending_action:'waiting'});
  await handleCommand('/siaran_on',11,'private',{id:11,first_name:'Test'});
  expect(f.sql.prepare("SELECT broadcast_opt_out FROM telegram_users WHERE user_id='11'").get()?.broadcast_opt_out).toBe(0);
 });
});
