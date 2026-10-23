import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";
import { queryAll, getD1 } from "@/lib/db";
import { BannerOrderConflict, saveBanner } from "@/lib/banner-order";
import { POST, PUT as fullUpdate, GET, DELETE } from "@/app/api/banners/route";
import { PUT as patch } from "@/app/api/banners/[id]/route";
import { POST as reorder } from "@/app/api/banners/reorder/route";
import { PUT as settings } from "@/app/api/banners/settings/route";
import { requireAdmin } from "@/lib/auth";
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "admin" })) }));
let fixture: ReturnType<typeof createD1Fixture>;
const request = (body: unknown, url = "/api/banners", method = "POST") => new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const update = (id: number, body: unknown) => patch(request(body, `/api/banners/${id}`, "PUT"), { params: Promise.resolve({ id: String(id) }) });
const move = (ids:number[],expected_ids:number[]) => reorder(request({ids,expected_ids},'/api/banners/reorder'));
const rows = () => fixture.sql.prepare("SELECT id,title,sort_order FROM banners ORDER BY sort_order").all();
const seed = async () => { for (const title of ['First','Second','Third']) await POST(request({title})); };
beforeEach(() => { fixture = createD1Fixture(); vi.mocked(requireAdmin).mockResolvedValue({email:'admin'} as never); });
afterEach(() => { fixture.close(); vi.restoreAllMocks(); });
describe("banner order and shared settings",()=>{
 it('appends creates and ignores retired numeric position/timing on content saves',async()=>{
  await seed();expect(rows().map(r=>r.id)).toEqual([1,2,3]);
  expect((await move([3,1,2],[1,2,3])).status).toBe(200);
  await fullUpdate(request({title:'Edited',sort_order:0,delay_ms:9999},'/api/banners?id=2','PUT'));
  await update(1,{is_active:true,sort_order:999});
  expect(rows().map(r=>r.id)).toEqual([3,1,2]);expect(rows().map(r=>r.sort_order)).toEqual([0,1,2]);
  expect(fixture.sql.prepare('SELECT delay_ms FROM banners WHERE id=2').get()).toMatchObject({delay_ms:1500});
  await POST(request({title:'Last',sort_order:0}));expect(rows().map(r=>r.id)).toEqual([3,1,2,4]);
 });
 it('compacts delete including inactive rows without losing content',async()=>{
  await seed();await DELETE(new NextRequest('http://localhost/api/banners?id=2',{method:'DELETE'}));
  expect(rows()).toEqual([{id:1,title:'First',sort_order:0},{id:3,title:'Third',sort_order:1}]);
 });
 it('two concurrent reorders have one winner and one stale conflict with no negative rows',async()=>{
  await seed();const result=await Promise.all([move([3,2,1],[1,2,3]),move([2,1,3],[1,2,3])]);expect(result.map(r=>r.status).sort()).toEqual([200,409]);expect(rows().map(r=>r.sort_order)).toEqual([0,1,2]);
 });
 it('concurrent create is appended or rejects stale drag; never loses new rows',async()=>{
  await seed();const result=await Promise.all([move([3,1,2],[1,2,3]),POST(request({title:'Fourth'}))]);expect([200,409]).toContain(result[0].status);expect(result[1].status).toBe(201);expect(rows()).toHaveLength(4);expect(rows().map(r=>r.sort_order)).toEqual([0,1,2,3]);expect(rows().at(-1)?.title).toBe('Fourth');
 });
 it('rejects missing/duplicate/foreign IDs before writing',async()=>{
  await seed();const before=rows();for(const ids of [[1,1,2],[1,2],[1,2,99]])expect((await move(ids,[1,2,3])).status).toBe(400);expect(rows()).toEqual(before);
  expect((await move([3,2,1],[3,1,2])).status).toBe(409);
 });
 it('a failure after staging rolls back negative positions and content',async()=>{
  await seed();const before=rows(),db=getD1()!;const batch=db.batch.bind(db);vi.spyOn(db,'batch').mockImplementation(async stmts=>{const broken=[...stmts];broken.splice(2,0,db.prepare('INSERT INTO missing_banner_table VALUES(1)'));return batch(broken)});
  await expect(saveBanner({title:'Lost'},1)).rejects.toThrow();expect(rows()).toEqual(before);
 });
 it('bounds retry and propagates unrelated storage failures',async()=>{
  const db=getD1()!;const spy=vi.spyOn(db,'batch').mockRejectedValue(new Error('CHECK constraint failed: operation_guards'));await expect(saveBanner({title:'New'},null)).rejects.toBeInstanceOf(BannerOrderConflict);expect(spy).toHaveBeenCalledTimes(5);
  spy.mockClear().mockRejectedValue(new Error('disk unavailable'));await expect(saveBanner({title:'New'},null)).rejects.toThrow('disk unavailable');expect(spy).toHaveBeenCalledTimes(1);
 });
 it('stores config in one key, validates bounds and exposes only active banners publicly',async()=>{
  await seed();await update(2,{is_active:true});const config={delay_ms:500,interval_ms:8000,autoplay:true,max_show_per_session:2};expect((await settings(request(config,'/api/banners/settings','PUT'))).status).toBe(200);
  expect((await settings(request({...config,interval_ms:100},'/api/banners/settings','PUT'))).status).toBe(400);
  vi.mocked(requireAdmin).mockResolvedValue(null);expect((await GET(new NextRequest('http://localhost/api/banners?active=0'))).status).toBe(401);expect((await move([3,1,2],[1,2,3])).status).toBe(401);
  const pub=await GET(new NextRequest('http://localhost/api/banners?active=1'));expect(await pub.json()).toMatchObject({settings:config,banners:[{id:2}]});expect(pub.headers.get('cache-control')).toBe('no-store');
 });
 it('simultaneous creates preserve every row and normalized positions',async()=>{
  const result=await Promise.all(Array.from({length:5},(_,i)=>POST(request({title:`Banner ${i}`}))));expect(result.map(r=>r.status)).toEqual([201,201,201,201,201]);expect(rows().map(r=>r.sort_order)).toEqual([0,1,2,3,4]);
 });
 it('dev fallback uses the same ordering rules',async()=>{
  fixture.close();fixture={...fixture,close(){}};const state=process as unknown as {__AXVARA_BANNERS?:Record<string,unknown>[]};state.__AXVARA_BANNERS=[];
  try {await seed();expect((await move([3,1,2],[1,2,3])).status).toBe(200);expect((await queryAll('SELECT * FROM banners')).map(r=>r.id)).toEqual([3,1,2]);}finally{delete state.__AXVARA_BANNERS}
 });
 it('staging and rollback run on real D1 workerd',async()=>{
  const runtime=new Miniflare({modules:true,script:'export default { fetch(){ return new Response("ok") } }',compatibilityDate:'2024-11-01',d1Databases:['DB']});
  try {const db=await runtime.getD1Database('DB');await db.batch([db.prepare('CREATE TABLE banners(id INTEGER PRIMARY KEY,title TEXT,sort_order INTEGER UNIQUE,is_active INTEGER,updated_at TEXT)'),db.prepare('CREATE TABLE operation_guards(operation_id TEXT PRIMARY KEY,valid INTEGER CHECK(valid=1))'),db.prepare("INSERT INTO banners VALUES(1,'First',0,1,NULL),(2,'Second',1,1,NULL),(3,'Third',2,0,NULL)")]);
   const global=globalThis as unknown as {DB:unknown};const saved=global.DB;global.DB=db;try{expect((await move([3,1,2],[1,2,3])).status).toBe(200);expect((await db.prepare('SELECT id,sort_order FROM banners ORDER BY sort_order').all()).results).toEqual([{id:3,sort_order:0},{id:1,sort_order:1},{id:2,sort_order:2}]);expect((await move([2,3,1],[1,2,3])).status).toBe(409);}finally{global.DB=saved}
  }finally{await runtime.dispose()}
 },15000);
 it('legacy migration keeps IDs/content and unique index intact',()=>{
  fixture.sql.exec("DROP INDEX banners_sort_order_unique; INSERT INTO banners(id,title,sort_order) VALUES(2,'Older',0),(9,'Newer',0),(4,'Middle',1)");fixture.sql.exec(readFileSync('drizzle/migrations/0064_banner_sort_order_unique.sql','utf8'));expect(rows().map(r=>r.id)).toEqual([9,2,4]);expect(()=>fixture.sql.exec('UPDATE banners SET sort_order=0 WHERE id=4')).toThrow(/UNIQUE/);
 });
});
