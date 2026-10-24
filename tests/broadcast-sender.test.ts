import {afterEach,it,expect,vi} from 'vitest';
import {sendBroadcast} from '@/lib/broadcasts/sender';
import {sendMessage} from '@/lib/telegram/api';
import {sendTextMessage} from '@/lib/whatsapp/gateway';
vi.mock('@/lib/telegram/api',()=>({sendMessage:vi.fn()}));vi.mock('@/lib/whatsapp/gateway',()=>({sendTextMessage:vi.fn()}));
const snapshot={name:'Template',title:'<Promo>',body:'<script>alert(1)</script>\nBaris 2',cta_label:'Buka & lihat',cta_url:'https://axvara.tech/?a=1&b=2'};
const row={campaign_id:'22222222-2222-4222-8222-222222222222',recipient_id:'1',destination:'buyer@example.test',unsubscribe_token:'a'.repeat(64)};
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});
it('sends individual escaped emails with stable idempotency and one-click unsubscribe headers',async()=>{
 vi.stubEnv('RESEND_API_KEY','test-secret');vi.stubEnv('FORWARD_FROM_EMAIL','noreply@axvara.tech');
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:'resend-id'}),{status:200}));vi.stubGlobal('fetch',fetcher);
 expect(await sendBroadcast('email',row,snapshot)).toEqual({state:'sent',providerId:'resend-id'});await sendBroadcast('email',row,snapshot);
 const [url,request]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://api.resend.com/emails');
 const body=JSON.parse(String(request.body));expect(body.to).toEqual([row.destination]);expect(body.html).toContain('&lt;script&gt;');expect(body.html).not.toContain('<script>');expect(body.html).toContain('&lt;Promo&gt;');
 expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');expect(body.headers['List-Unsubscribe']).toContain(row.unsubscribe_token);expect(body.headers['List-Unsubscribe']).not.toContain(row.destination);
 expect((request.headers as Record<string,string>)['Idempotency-Key']).toBe('broadcast/'+row.campaign_id+'/1');
 const second=fetcher.mock.calls[1] as unknown as [string,RequestInit];expect(second[0]).toBe(url);expect(second[1].body).toBe(request.body);expect(second[1].headers).toEqual(request.headers);
});
it('preserves Telegram retry_after, treats network outcomes as unknown and offers opt-out',async()=>{
 vi.stubEnv('TELEGRAM_BOT_ENABLED','true');vi.stubEnv('TELEGRAM_BOT_TOKEN','fixture');
 vi.mocked(sendMessage).mockResolvedValueOnce({ok:false,error_code:429,parameters:{retry_after:123}});
 expect(await sendBroadcast('telegram',{...row,destination:'11'},snapshot)).toMatchObject({state:'retry',retryAfter:123,consumeAttempt:false});
 expect(vi.mocked(sendMessage).mock.calls[0][0]).toMatchObject({chat_id:'11',text:expect.stringContaining('/stop')});expect(vi.mocked(sendMessage).mock.calls[0][0]).not.toHaveProperty('parse_mode');
 vi.mocked(sendMessage).mockResolvedValueOnce({ok:false,description:'timeout'});expect(await sendBroadcast('telegram',{...row,destination:'11'},snapshot)).toMatchObject({state:'unknown'});
});
it('binds WhatsApp broadcasts to the reviewed group, phone/revision and durable campaign key',async()=>{
 const wa={destination:'123@g.us',botNumber:'6283181632507',botRevision:'initial'};
 vi.mocked(sendTextMessage).mockResolvedValue({ok:false,error:'delivery_outcome_unknown',outcomeUnknown:true});
 expect(await sendBroadcast('whatsapp',{...row,destination:wa.destination},{...snapshot,wa})).toMatchObject({state:'unknown'});
 expect(sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({target:wa.destination,broadcastNotification:true,idempotencyKey:'wa:broadcast:'+row.campaign_id,botNumber:wa.botNumber,botRevision:wa.botRevision}));
 expect(await sendBroadcast('whatsapp',row,{...snapshot,wa})).toMatchObject({state:'failed'});
});
