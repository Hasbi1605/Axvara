import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createDatabaseAccess } from '@/lib/db-access';
import { listBroadcasts, reviewBroadcast, launchBroadcast, BroadcastError } from '@/lib/broadcasts/store';
import { templateSchema,targetSchema } from '@/lib/broadcasts/validation';
import { UUID } from '@/lib/broadcasts/model';
import { z } from 'zod';
export const runtime='edge';export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:NextRequest){
 if(!await requireAdmin(req))return json({error:'Unauthorized'},401);
 const db=createDatabaseAccess();if(!db.getD1())return json({error:'Database siaran belum tersedia.'},503);
 return json(await listBroadcasts(db));
}
export async function POST(req:NextRequest){
 const admin=await requireAdmin(req);if(!admin)return json({error:'Unauthorized'},401);
 const db=createDatabaseAccess(),d1=db.getD1();if(!d1)return json({error:'Database siaran belum tersedia.'},503);
 const body=await req.json().catch(()=>null);
 try{
  if(body?.action==='save'){
   const data=templateSchema.safeParse(body.content);
   if(!data.success)return json({error:data.error.issues[0]?.message||'Isi template tidak valid.'},400);
   const v=data.data;
   if(body.id){
    if(!UUID.test(body.id)||!Number.isSafeInteger(body.revision)||body.revision<1)return json({error:'Template tidak valid.'},400);
    const result=await db.execRun(`UPDATE broadcast_templates SET name=?,title=?,body=?,cta_label=?,cta_url=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND archived=0`,v.name,v.title,v.body,v.cta_label,v.cta_url,body.id,body.revision);
    if(!result.changes)return json({error:'Template berubah atau diarsipkan. Muat ulang sebelum menyimpan.'},409);
    return json({ok:true,id:body.id});
   }
   const id=crypto.randomUUID();
   const result=await db.execRun('INSERT INTO broadcast_templates(id,name,title,body,cta_label,cta_url) SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM broadcast_templates)<200',id,v.name,v.title,v.body,v.cta_label,v.cta_url);
   if(!result.changes)return json({error:'Maksimal 200 template. Edit atau pulihkan template yang sudah ada.'},409);
   return json({ok:true,id},201);
  }
  if(body?.action==='archive'){
   if(!UUID.test(body.id)||!Number.isSafeInteger(body.revision)||typeof body.archived!=='boolean')return json({error:'Template tidak valid.'},400);
   const result=await db.execRun("UPDATE broadcast_templates SET archived=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=?",body.archived?1:0,body.id,body.revision);
   return result.changes?json({ok:true}):json({error:'Template berubah. Muat ulang.'},409);
  }
  if(body?.action==='cancel'){
   if(!UUID.test(body.id))return json({error:'Siaran tidak valid.'},400);
   await d1.batch([
    d1.prepare("UPDATE broadcast_campaigns SET status='canceled' WHERE id=? AND status='queued'").bind(body.id),
    d1.prepare("UPDATE broadcast_deliveries SET status='canceled',updated_at=datetime('now') WHERE campaign_id=? AND status='pending' AND EXISTS(SELECT 1 FROM broadcast_campaigns c WHERE c.id=campaign_id AND c.status='canceled')").bind(body.id),
   ]);return json({ok:true});
  }
  const parsed=targetSchema.safeParse({templateId:body?.templateId,revision:body?.revision,channels:body?.channels});
  if(!parsed.success)return json({error:'Pilih template tersimpan dan minimal satu tujuan.'},400);
  if(body.action==='review')return json(await reviewBroadcast(parsed.data.templateId,parsed.data.revision,parsed.data.channels,db));
  if(body.action==='send'){
   const launch=z.object({id:z.string().regex(UUID),waIdentity:z.object({botNumber:z.string(),botRevision:z.string(),groupId:z.string().regex(/^\d+(-\d+)?@g\.us$/)}).strict().optional()}).safeParse({id:body.id,waIdentity:body.waIdentity});
   if(!launch.success)return json({error:'Kunci pengiriman tidak valid.'},400);
   return json(await launchBroadcast({...parsed.data,...launch.data},admin.email,db),202);
  }
  return json({error:'Aksi tidak valid.'},400);
 }catch(error){return error instanceof BroadcastError ? json({error:error.message},409) : json({error:'Siaran belum dapat dipastikan. Perbarui riwayat atau coba lagi.'},503);}
}
