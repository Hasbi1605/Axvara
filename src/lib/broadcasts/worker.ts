import { createDatabaseAccess, type DatabaseAccess } from '@/lib/db-access';
import { sendBroadcast, type SendOutcome } from './sender';
import type { BroadcastChannel, BroadcastSnapshot } from './model';

function eligibleSQL(channel:string){
 if(channel==='email')return `EXISTS(SELECT 1 FROM newsletter_subscribers s WHERE CAST(s.id AS TEXT)=broadcast_deliveries.recipient_id AND lower(s.email)=broadcast_deliveries.destination AND s.status='active' AND s.unsubscribe_token=broadcast_deliveries.unsubscribe_token)`;
 if(channel==='telegram')return `EXISTS(SELECT 1 FROM telegram_users t WHERE t.user_id=broadcast_deliveries.recipient_id AND t.chat_id=broadcast_deliveries.destination AND t.is_blocked=0 AND t.broadcast_opt_out=0)`;
 return '1=1';
}
/** Existing promo tick only. Lease, SQL budget and elapsed time all bound each batch. */
export async function processBroadcasts(db:DatabaseAccess=createDatabaseAccess(),limit=8,timeBudgetMs=20000){
 const out={sent:0,unknown:0,failed:0,skipped:0,deferred:0};
 if(!db.getD1()||!db.canSpend(8))return out;
 const token=crypto.randomUUID(),now=()=>new Date().toISOString(),started=Date.now();
 const lock=await db.execRun(`UPDATE broadcast_dispatch_control SET worker_token=?,lease_until=? WHERE id=1 AND (lease_until IS NULL OR julianday(lease_until)<=julianday(?))`,token,new Date(Date.now()+60000).toISOString(),now());
 if(!lock.changes)return out;
 try{
  const control=await db.queryFirst('SELECT * FROM broadcast_dispatch_control WHERE id=1 AND worker_token=?',token);if(!control)return out;
  // No blind retry for Telegram/WA after an interrupted send. Email retries only
  // inside Resend's 24-hour dedupe window, with an extra hour of margin.
  await db.execRun(`UPDATE broadcast_deliveries SET status=CASE WHEN channel='email' AND julianday(first_attempt_at)>julianday(?,'-23 hours') THEN 'pending' ELSE 'unknown' END,
    last_error='delivery_interrupted',lease_until=NULL,next_attempt_at=?,updated_at=? WHERE status='sending' AND julianday(lease_until)<=julianday(?)`,now(),now(),now(),now());
  const rows=await db.queryAll(`SELECT d.*,c.snapshot_json FROM broadcast_deliveries d JOIN broadcast_campaigns c ON c.id=d.campaign_id
    WHERE d.status='pending' AND c.status='queued' AND julianday(d.next_attempt_at)<=julianday(?)
      AND (d.channel!='email' OR ? IS NULL OR julianday(?)<=julianday(?,'+1 second'))
      AND (d.channel!='telegram' OR ? IS NULL OR julianday(?)<=julianday(?,'+1 second'))
    ORDER BY d.id LIMIT ?`,now(),control.email_after??null,control.email_after??null,now(),control.telegram_after??null,control.telegram_after??null,now(),Math.max(1,Math.min(8,limit)));
  for(const row of rows){
   if(!db.canSpend(7))break;
   const channel=row.channel as BroadcastChannel;
   if(Date.now()-started+(channel==='whatsapp'?16000:channel==='telegram'?11000:7000)>timeBudgetMs)continue;
   const after=channel==='email'?control.email_after:channel==='telegram'?control.telegram_after:null;
   const delay=after?Date.parse(String(after))-Date.now():0;
   if(delay>1000)continue;
   if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
   // A late retry must not outlive the provider's idempotency protection.
   if(channel==='email'&&row.first_attempt_at&&Date.now()-Date.parse(String(row.first_attempt_at))>=23*3600000){
    await db.execRun("UPDATE broadcast_deliveries SET status='unknown',last_error='email_retry_window_elapsed' WHERE id=? AND status='pending'",row.id);out.unknown++;continue;
   }
   const eligible=await db.queryFirst(`SELECT id FROM broadcast_deliveries WHERE id=? AND ${eligibleSQL(channel)}`,row.id);
   if(!eligible){await db.execRun("UPDATE broadcast_deliveries SET status='skipped',last_error='recipient_unsubscribed',updated_at=? WHERE id=? AND status='pending'",now(),row.id);out.skipped++;continue;}
   const claim=await db.execRun(`UPDATE broadcast_deliveries SET status='sending',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),lease_until=?,updated_at=?
     WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM broadcast_campaigns c WHERE c.id=campaign_id AND c.status='queued') AND ${eligibleSQL(channel)}`,now(),new Date(Date.now()+90000).toISOString(),now(),row.id);
   if(!claim.changes)continue;
   if(channel==='email'||channel==='telegram'){
    const next=new Date(Date.now()+(channel==='email'?650:150)).toISOString();control[channel==='email'?'email_after':'telegram_after']=next;
    await db.execRun(`UPDATE broadcast_dispatch_control SET ${channel==='email'?'email_after':'telegram_after'}=? WHERE id=1 AND worker_token=?`,next,token);
   }
   let result:SendOutcome;
   try{result=await sendBroadcast(channel,{campaign_id:String(row.campaign_id),recipient_id:String(row.recipient_id),destination:String(row.destination),unsubscribe_token:String(row.unsubscribe_token||'')},JSON.parse(String(row.snapshot_json)) as BroadcastSnapshot);}
   catch{result={state:'unknown',error:'delivery_unknown'};}
   if(result.blocked&&db.canSpend(1))await db.execRun('UPDATE telegram_users SET is_blocked=1 WHERE user_id=? AND chat_id=?',row.recipient_id,row.destination);
   if(result.state==='retry'&&(channel==='email'||channel==='telegram')){
    const next=new Date(Date.now()+(result.retryAfter||60)*1000).toISOString();control[channel==='email'?'email_after':'telegram_after']=next;
    if(db.canSpend(2))await db.execRun(`UPDATE broadcast_dispatch_control SET ${channel==='email'?'email_after':'telegram_after'}=? WHERE id=1 AND worker_token=?`,next,token);
   }
   const status=result.state==='retry'?'pending':result.state;
   await db.execRun(`UPDATE broadcast_deliveries SET status=?,provider_id=?,last_error=?,lease_until=NULL,attempts=attempts-?,first_attempt_at=CASE WHEN ? THEN NULL ELSE first_attempt_at END,next_attempt_at=?,updated_at=? WHERE id=? AND status='sending'`,status,result.providerId||null,result.error||null,result.consumeAttempt===false?1:0,result.consumeAttempt===false&&!row.first_attempt_at?1:0,new Date(Date.now()+(result.retryAfter||60)*1000).toISOString(),now(),row.id);
   if(result.state==='retry')out.deferred++;else out[result.state]++;
  }
  if(db.canSpend(2))await db.execRun(`UPDATE broadcast_campaigns SET status='completed' WHERE status='queued' AND NOT EXISTS(SELECT 1 FROM broadcast_deliveries d WHERE d.campaign_id=broadcast_campaigns.id AND d.status IN ('pending','sending'))`);
 }finally{if(db.canSpend(1))await db.execRun('UPDATE broadcast_dispatch_control SET worker_token=NULL,lease_until=NULL WHERE id=1 AND worker_token=?',token);}
 return out;
}
