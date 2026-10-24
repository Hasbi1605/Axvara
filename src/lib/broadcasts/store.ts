import { createDatabaseAccess, type DatabaseAccess } from '@/lib/db-access';
import { salesGatewayControl } from '@/lib/whatsapp/gateway';
import { DEFAULT_SALES_BOT_NUMBER, normalizeBotNumber, validBotRevision } from '@/lib/whatsapp/bot-number';
import { SALES_GROUP_NAME } from '@/lib/whatsapp/sales-notifications';
import { isForwardEmailConfigured } from '@/lib/warung-rebahan/forward-sender';
import { broadcastText, type BroadcastChannel, type BroadcastSnapshot, type BroadcastTemplate } from './model';

export class BroadcastError extends Error {}

// Group IDs are never accepted from the browser. Snapshot only the verified target.
export const TELEGRAM_ELIGIBLE = `is_blocked=0 AND broadcast_opt_out=0 AND chat_id=user_id AND user_id NOT GLOB '*[^0-9]*' AND substr(user_id,1,1) BETWEEN '1' AND '9' AND length(user_id)<=16`;
export async function reviewBroadcast(templateId:string,revision:number,channels:BroadcastChannel[],db=createDatabaseAccess()) {
  const template=await db.queryFirst('SELECT * FROM broadcast_templates WHERE id=? AND archived=0',templateId) as BroadcastTemplate|null;
  if(!template || Number(template.revision)!==revision) throw new BroadcastError('Template berubah atau diarsipkan. Muat ulang lalu tinjau kembali.');
  const snapshot:BroadcastSnapshot={name:template.name,title:template.title,body:template.body,cta_label:template.cta_label,cta_url:template.cta_url};
  const counts:Partial<Record<BroadcastChannel,number>>={};
  for(const channel of channels) {
    if(channel==='email') {
      if(!isForwardEmailConfigured())throw new BroadcastError('Pengiriman email belum dikonfigurasi.');
      counts.email=Number((await db.queryFirst("SELECT count(*) AS n FROM newsletter_subscribers WHERE status='active' AND unsubscribe_token IS NOT NULL"))?.n||0);
    } else if(channel==='telegram') {
      if(process.env.TELEGRAM_BOT_ENABLED!=='true'||!process.env.TELEGRAM_BOT_TOKEN)throw new BroadcastError('Bot Telegram belum aktif.');
      counts.telegram=Number((await db.queryFirst('SELECT count(*) AS n FROM telegram_users WHERE '+TELEGRAM_ELIGIBLE))?.n||0);
    } else {
      const gateway=await salesGatewayControl('status');
      const revision=gateway.botRevision??(gateway.botNumber===DEFAULT_SALES_BOT_NUMBER?'initial':'');
      if(!gateway.connected||gateway.blocked||gateway.groupName!==SALES_GROUP_NAME||!/^\d+(-\d+)?@g\.us$/.test(gateway.groupId||'')||normalizeBotNumber(gateway.botNumber)!==gateway.botNumber||!validBotRevision(revision))throw new BroadcastError('Bot WhatsApp/grup belum siap. Cek koneksi di Pengaturan Toko.');
      snapshot.wa={destination:gateway.groupId!,botNumber:gateway.botNumber,botRevision:revision};counts.whatsapp=1;
    }
  }
  if(!Object.values(counts).some(n=>Number(n)>0))throw new BroadcastError('Belum ada penerima aktif untuk tujuan yang dipilih.');
  return {template,snapshot,counts,preview:broadcastText(snapshot)};
}
export async function contentFingerprint(value:unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function launchBroadcast(args:{id:string;templateId:string;revision:number;channels:BroadcastChannel[];waIdentity?:{botNumber:string;botRevision:string;groupId:string}},admin:string,db=createDatabaseAccess()) {
  const d1=db.getD1();if(!d1)throw new BroadcastError('Database siaran belum tersedia.');
  const channels=[...args.channels].sort();
  const fingerprint=await contentFingerprint({templateId:args.templateId,revision:args.revision,channels,waIdentity:args.waIdentity||null});
  const existing=await db.queryFirst('SELECT id,fingerprint FROM broadcast_campaigns WHERE id=?',args.id);
  if(existing){if(existing.fingerprint!==fingerprint)throw new BroadcastError('Kunci pengiriman sudah dipakai untuk siaran lain.');return {id:args.id,replayed:true};}
  const review=await reviewBroadcast(args.templateId,args.revision,args.channels,db);
  if(review.snapshot.wa && (args.waIdentity?.botNumber!==review.snapshot.wa.botNumber||args.waIdentity.botRevision!==review.snapshot.wa.botRevision||args.waIdentity.groupId!==review.snapshot.wa.destination))throw new BroadcastError('Nomor bot atau grup berubah. Tinjau ulang siaran sebelum mengirim.');
  const prepared=d1.prepare(`INSERT OR IGNORE INTO broadcast_campaigns(id,fingerprint,template_id,template_revision,snapshot_json,channels_json,status,created_by)
    SELECT ?,?,id,revision,?,?,'preparing',? FROM broadcast_templates WHERE id=? AND revision=? AND archived=0`).bind(args.id,fingerprint,JSON.stringify(review.snapshot),JSON.stringify(channels),admin,args.templateId,args.revision);
  const statements=[prepared];
  if(channels.includes('email'))statements.push(d1.prepare(`INSERT OR IGNORE INTO broadcast_deliveries(campaign_id,channel,recipient_id,destination,unsubscribe_token)
    SELECT c.id,'email',CAST(s.id AS TEXT),lower(s.email),s.unsubscribe_token FROM broadcast_campaigns c,newsletter_subscribers s
    WHERE c.id=? AND c.status='preparing' AND s.status='active' AND s.unsubscribe_token IS NOT NULL`).bind(args.id));
  if(channels.includes('telegram'))statements.push(d1.prepare(`INSERT OR IGNORE INTO broadcast_deliveries(campaign_id,channel,recipient_id,destination)
    SELECT c.id,'telegram',t.user_id,t.chat_id FROM broadcast_campaigns c,telegram_users t WHERE c.id=? AND c.status='preparing' AND ${TELEGRAM_ELIGIBLE}`).bind(args.id));
  if(review.snapshot.wa)statements.push(d1.prepare(`INSERT OR IGNORE INTO broadcast_deliveries(campaign_id,channel,recipient_id,destination)
    SELECT id,'whatsapp','group',? FROM broadcast_campaigns WHERE id=? AND status='preparing'`).bind(review.snapshot.wa.destination,args.id));
  statements.push(d1.prepare("UPDATE broadcast_campaigns SET status='queued' WHERE id=? AND status='preparing'").bind(args.id));
  await d1.batch(statements);
  const saved=await db.queryFirst('SELECT fingerprint FROM broadcast_campaigns WHERE id=?',args.id);
  if(!saved||saved.fingerprint!==fingerprint)throw new BroadcastError('Template atau siaran berubah. Muat ulang lalu tinjau kembali.');
  return {id:args.id,replayed:false};
}
export async function listBroadcasts(db:DatabaseAccess=createDatabaseAccess()) {
  const templates=await db.queryAll('SELECT * FROM broadcast_templates ORDER BY archived,name LIMIT 200');
  const campaigns=await db.queryAll(`SELECT id,template_id,template_revision,snapshot_json,channels_json,status,created_at FROM broadcast_campaigns ORDER BY created_at DESC,id DESC LIMIT 30`);
  // One bounded aggregate for the visible history, never one query per campaign.
  const progress=await db.queryAll(`SELECT d.campaign_id,d.channel,d.status,count(*) AS n,MAX(d.last_error) AS last_error FROM broadcast_deliveries d
    WHERE d.campaign_id IN (SELECT id FROM broadcast_campaigns ORDER BY created_at DESC,id DESC LIMIT 30) GROUP BY d.campaign_id,d.channel,d.status`);
  return {templates,campaigns:campaigns.map(c=>({...c,content:JSON.parse(String(c.snapshot_json)),channels:JSON.parse(String(c.channels_json)),progress:progress.filter(p=>p.campaign_id===c.id),snapshot_json:undefined,channels_json:undefined}))};
}
