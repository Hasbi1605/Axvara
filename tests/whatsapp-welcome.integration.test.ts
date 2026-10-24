import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createD1Fixture } from './helpers/d1-fixture';
import { POST } from '@/app/api/whatsapp/group-events/route';
import { POST as chat } from '@/app/api/whatsapp/webhook/route';
import { processDueWhatsAppOutbox } from '@/lib/whatsapp/outbox';
import { welcomeNewMemberMessage } from '@/lib/whatsapp/messages';
vi.mock('@/lib/whatsapp/gateway',async original=>({...await original<object>(),salesGatewayControl:vi.fn(),sendTextMessage:vi.fn()}));
const groupId='120363123456789012@g.us', botNumber='6283181632507', botRevision='initial';
const join={event:'member_join',groupId,botNumber,botRevision,members:[{id:'628123456789@s.whatsapp.net',name:'THNS!!'}]};
let f:ReturnType<typeof createD1Fixture>;
const req=(body:unknown,authorized=true)=>new NextRequest('http://localhost/api/whatsapp/group-events',{method:'POST',headers:{'content-type':'application/json',...(authorized?{'x-webhook-token':'fixture'}:{})},body:JSON.stringify(body)});
beforeEach(async()=>{f=createD1Fixture();vi.stubEnv('WHATSAPP_WEBHOOK_TOKEN','fixture');vi.stubEnv('WHATSAPP_OUTBOX_PACE_MS','0');
 const {salesGatewayControl,sendTextMessage}=await import('@/lib/whatsapp/gateway');vi.mocked(salesGatewayControl).mockReset().mockResolvedValue({connected:true,groupId,groupName:"AXVARA'S",botNumber,botRevision});vi.mocked(sendTextMessage).mockReset().mockResolvedValue({ok:true,messageId:'welcome-fixture'});
});
afterEach(()=>{f.close();vi.useRealTimers();vi.unstubAllEnvs();vi.clearAllMocks();});
it('accepts only authenticated joins to the verified group and current bot identity',async()=>{
 expect((await POST(req(join,false))).status).toBe(401);expect((await POST(req({...join,event:'remove'}))).status).toBe(400);
 expect((await POST(req({...join,botRevision:'11111111-1111-4111-8111-111111111111'}))).status).toBe(409);
 expect((await POST(req({...join,groupId:'999@g.us'}))).status).toBe(409);
 expect(f.sql.prepare('SELECT count(*) AS n FROM whatsapp_outbox').get()?.n).toBe(0);
});
it('queues actual joins once, greets by available name, and uses durable dispatch without enabling WA commerce',async()=>{
 vi.stubEnv('WHATSAPP_ENABLED','false');
 expect((await POST(req(join))).status).toBe(202);expect((await POST(req(join))).status).toBe(202);
 expect(f.sql.prepare('SELECT count(*) AS n FROM whatsapp_outbox').get()?.n).toBe(1);
 const {sendTextMessage}=await import('@/lib/whatsapp/gateway');expect(sendTextMessage).not.toHaveBeenCalled();
 await processDueWhatsAppOutbox();expect(sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({target:groupId,welcomeNotification:true,botNumber,botRevision,message:expect.stringContaining('*THNS!!*'),idempotencyKey:expect.stringMatching(/^wa:welcome:[a-f0-9]{64}$/)}));
 await processDueWhatsAppOutbox();expect(sendTextMessage).toHaveBeenCalledTimes(1);
});
it('deduplicates reordered join batches, excludes the bot, and quarantines explicit ambiguous sends',async()=>{
 const members=[...join.members,{id:'112233@lid',name:''}];await POST(req({...join,members}));await POST(req({...join,members:[...members].reverse()}));
 expect(f.sql.prepare('SELECT count(*) AS n FROM whatsapp_outbox').get()?.n).toBe(1);
 const ignored=await POST(req({...join,members:[{id:botNumber+'@s.whatsapp.net'}]}));expect((await ignored.json()).status).toBe('ignored');
 const {sendTextMessage}=await import('@/lib/whatsapp/gateway');vi.mocked(sendTextMessage).mockResolvedValue({ok:false,error:'delivery_outcome_unknown',outcomeUnknown:true});
 await processDueWhatsAppOutbox();await processDueWhatsAppOutbox();expect(sendTextMessage).toHaveBeenCalledTimes(1);expect(f.sql.prepare('SELECT status FROM whatsapp_outbox').get()?.status).toBe('dead');
});
it('does not welcome or answer ordinary text, emoji, reaction-only and sticker payloads even with legacy discovery enabled',async()=>{
 vi.stubEnv('WHATSAPP_ENABLED','true');vi.stubEnv('WHATSAPP_GROUP_DISCOVERY','true');vi.stubEnv('WHATSAPP_GROUP_ALLOWLIST',groupId);
 for(const [i,message] of ['halo semuanya','🔥',''].entries())expect((await chat(req({sender:groupId,member:'628123456789',inboxid:'normal-'+i,message,name:'THNS!!',isGroup:true}))).status).toBe(200);
 const {sendTextMessage}=await import('@/lib/whatsapp/gateway');expect(sendTextMessage).not.toHaveBeenCalled();expect(f.sql.prepare('SELECT count(*) AS n FROM whatsapp_outbox').get()?.n).toBe(0);expect(f.sql.prepare('SELECT count(*) AS n FROM whatsapp_sessions').get()?.n).toBe(0);
});
it('keeps the framed template, WIB greetings, safe names and web/Telegram/admin links',()=>{
 vi.useFakeTimers();
 for(const [hour,greeting] of [[0,'Pagi'],[6,'Siang'],[9,'Sore'],[14,'Malam']] as const){vi.setSystemTime(new Date(`2026-10-24T${String(hour).padStart(2,'0')}:00:00Z`));expect(welcomeNewMemberMessage('THNS!!')).toContain('Selamat '+greeting);}
 const text=welcomeNewMemberMessage('Budi\n*Admin*');expect(text).toContain('━━━━━━━━━━━━━━━━━━━━');expect(text).toContain('*Budi  Admin*');expect(text).toContain('Optimasi Media Sosial, Topup Games!');expect(text).toContain('https://axvara.tech/wa');expect(text).toContain('https://t.me/Axvara_bot?start=beli');expect(text).not.toContain('Ketik');expect(welcomeNewMemberMessage()).toContain('*Kak*');
});
