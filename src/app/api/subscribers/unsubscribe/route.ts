import { NextRequest, NextResponse } from 'next/server';
import { createDatabaseAccess } from '@/lib/db-access';
export const runtime='edge';export const dynamic='force-dynamic';
const headers={'content-type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"};
function html(content:string,status=200){return new NextResponse(`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Langganan Email AXVARA</title><style>body{margin:0;background:#080c1e;color:white;font:16px system-ui;display:grid;min-height:100vh;place-items:center}main{max-width:440px;padding:32px;margin:20px;background:#101428;border:1px solid #ffffff22;border-radius:22px}p{line-height:1.7;color:#ffffffaa}button{background:#00e5ff;border:0;border-radius:12px;padding:14px 20px;font:inherit;cursor:pointer}</style><main>${content}</main></html>`,{status,headers});}
export async function GET(req:NextRequest){
 const token=req.nextUrl.searchParams.get('token')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return html('<h1>Tautan tidak valid</h1><p>Buka tautan berhenti berlangganan dari email siaran AXVARA.</p>',400);
 // GET is intentionally inert: mail preview/scanning must not unsubscribe people.
 return html(`<h1>Berhenti berlangganan?</h1><p>Anda tidak akan menerima siaran email AXVARA berikutnya. Email pesanan tetap dikirim.</p><form method="post"><button type="submit">Berhenti berlangganan</button></form>`);
}
export async function POST(req:NextRequest){
 const token=req.nextUrl.searchParams.get('token')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return html('<h1>Tautan tidak valid</h1>',400);
 const db=createDatabaseAccess();if(!db.getD1())return html('<h1>Belum dapat diproses</h1><p>Coba kembali sebentar lagi.</p>',503);
 await db.execRun("UPDATE newsletter_subscribers SET status='unsubscribed',updated_at=datetime('now') WHERE unsubscribe_token=?",token);
 return html('<h1>Langganan dihentikan</h1><p>Anda tidak lagi menerima siaran email AXVARA. Email pesanan tetap berjalan.</p>');
}
