import {afterEach,it,expect,vi} from 'vitest';
import {sendBroadcast} from '@/lib/broadcasts/sender';
import {sendMessage,sendPhoto} from '@/lib/telegram/api';
import {sendTextMessage} from '@/lib/whatsapp/gateway';
vi.mock('@/lib/telegram/api',()=>({sendMessage:vi.fn(),sendPhoto:vi.fn()}));vi.mock('@/lib/whatsapp/gateway',()=>({sendTextMessage:vi.fn()}));
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
it('sends Telegram promo photo first then HTML chunks and never resends photo on retry',async()=>{
 vi.stubEnv('TELEGRAM_BOT_ENABLED','true');vi.stubEnv('TELEGRAM_BOT_TOKEN','fixture');
 const promoSnapshot={
  name:'Promo otomatis pagi 2026-11-19',title:'Promo otomatis pagi 2026-11-19',body:'',cta_label:'',cta_url:'',
  promo:{
   kind:'telegram_promo' as const,businessDate:'2026-11-19',slot:'morning' as const,
   bannerUrl:'https://axvara.tech/banners/ready-promo.jpg',
   captionHtml:'🔥 <b>PRODUK AXVARA READY PAGI INI</b>',
   messagesHtml:['<b>Part 1</b>','<b>Part 2</b>\n\nKetik /stop untuk berhenti menerima promo.'],
   expiresAt:'2099-11-19T12:00:00+07:00',
  },
 };
 // Photo succeeds (message_id 10), chunk 0 succeeds (11), chunk 1 rate-limited (429)
 vi.mocked(sendPhoto).mockResolvedValueOnce({ok:true,result:{message_id:10} as never});
 vi.mocked(sendMessage)
  .mockResolvedValueOnce({ok:true,result:{message_id:11} as never})
  .mockResolvedValueOnce({ok:false,error_code:429,parameters:{retry_after:25}});
 const first=await sendBroadcast('telegram',{...row,destination:'11'},promoSnapshot);
 expect(first).toMatchObject({state:'retry',retryAfter:25,consumeAttempt:false});
 expect(first.providerId).toBe(JSON.stringify({photoId:'10',sentChunks:1,lastMessageId:'11'}));
 expect(sendPhoto).toHaveBeenCalledWith({chat_id:'11',photo:'https://axvara.tech/banners/ready-promo.jpg',caption:'🔥 <b>PRODUK AXVARA READY PAGI INI</b>',parse_mode:'HTML'});
 expect(sendMessage).toHaveBeenCalledTimes(2);
 expect(vi.mocked(sendMessage).mock.calls[0][0]).toMatchObject({chat_id:'11',text:'<b>Part 1</b>',parse_mode:'HTML',disable_web_page_preview:true});

 // Retry using persisted provider_id: skips photo AND chunk 0, sends only chunk 1
 vi.mocked(sendPhoto).mockClear();vi.mocked(sendMessage).mockClear();
 vi.mocked(sendMessage).mockResolvedValueOnce({ok:true,result:{message_id:12} as never});
 const second=await sendBroadcast('telegram',{...row,destination:'11',provider_id:first.providerId},promoSnapshot);
 expect(second).toEqual({state:'sent',providerId:JSON.stringify({photoId:'10',sentChunks:2,lastMessageId:'12'})});
 expect(sendPhoto).not.toHaveBeenCalled();
 expect(sendMessage).toHaveBeenCalledTimes(1);
 expect(vi.mocked(sendMessage).mock.calls[0][0].text).toContain('Part 2');

 // Ambiguous error after photo succeeds marks unknown (never blindly repeated) and retains photoId
 vi.mocked(sendPhoto).mockClear();vi.mocked(sendMessage).mockClear();
 vi.mocked(sendPhoto).mockResolvedValueOnce({ok:true,result:{message_id:20} as never});
 vi.mocked(sendMessage).mockResolvedValueOnce({ok:false,description:'Request timeout'});
 const third=await sendBroadcast('telegram',{...row,destination:'22'},promoSnapshot);
 expect(third).toEqual({state:'unknown',error:'telegram_delivery_unknown',providerId:JSON.stringify({photoId:'20',sentChunks:0})});
});
it('link_preview promo sends banner above chunk 0 in one bubble, no sendPhoto, resumes without re-sending chunk 0',async()=>{
 vi.stubEnv('TELEGRAM_BOT_ENABLED','true');vi.stubEnv('TELEGRAM_BOT_TOKEN','fixture');
 vi.mocked(sendPhoto).mockClear();vi.mocked(sendMessage).mockReset();
 const promoSnapshot={
  name:'Promo otomatis sore 2026-11-21',title:'Promo otomatis sore 2026-11-21',body:'',cta_label:'',cta_url:'',
  promo:{
   kind:'telegram_promo' as const,businessDate:'2026-11-21',slot:'evening' as const,
   bannerUrl:'https://axvara.tech/banners/ready-promo.jpg',bannerMode:'link_preview' as const,captionHtml:'',
   messagesHtml:['🔥 <b>PRODUK AXVARA READY SORE INI</b>\nPart 1','Part 2'],
   expiresAt:'2099-11-21T20:00:00+07:00',
  },
 };
 vi.mocked(sendMessage)
  .mockResolvedValueOnce({ok:true,result:{message_id:31} as never})
  .mockResolvedValueOnce({ok:false,error_code:429,parameters:{retry_after:5}});
 const first=await sendBroadcast('telegram',{...row,destination:'33'},promoSnapshot);
 expect(first).toMatchObject({state:'retry',retryAfter:5});
 expect(sendPhoto).not.toHaveBeenCalled();
 expect(vi.mocked(sendMessage).mock.calls[0][0]).toEqual({chat_id:'33',text:'🔥 <b>PRODUK AXVARA READY SORE INI</b>\nPart 1',parse_mode:'HTML',link_preview_options:{url:'https://axvara.tech/banners/ready-promo.jpg',prefer_large_media:true,show_above_text:true}});
 expect(vi.mocked(sendMessage).mock.calls[1][0]).toMatchObject({text:'Part 2',disable_web_page_preview:true});
 expect(vi.mocked(sendMessage).mock.calls[1][0]).not.toHaveProperty('link_preview_options');
 vi.mocked(sendMessage).mockReset();
 vi.mocked(sendMessage).mockResolvedValueOnce({ok:true,result:{message_id:32} as never});
 const second=await sendBroadcast('telegram',{...row,destination:'33',provider_id:first.providerId},promoSnapshot);
 expect(second).toMatchObject({state:'sent'});
 expect(sendMessage).toHaveBeenCalledTimes(1);
 expect(vi.mocked(sendMessage).mock.calls[0][0].text).toBe('Part 2');
 expect(sendPhoto).not.toHaveBeenCalled();
});
