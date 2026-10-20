import { expect,it } from "vitest";
import { shortlistPediaServices,type CurationService } from "@/lib/pedia/curation-shortlist";
const product={id:1,name:"Followers Instagram",platform:"instagram",metric:"followers",target_kind:"profile"};
const row:CurationService={supplier:"indosmm",service_id:1,name:"Instagram Followers Global",category:"Instagram",type:"Default",rate_idr_per_1k:1000,min_qty:10,max_qty:1000,api_refill:0,present:1};
it("compares equal quantities and excludes the historical supplier",()=>{
 const rows=shortlistPediaServices([{...row,supplier:"providersmm"},{...row,rate_idr_per_1k:2000}],product,100);
 expect(rows.map(r=>[r.supplier,r.service_id,r.estimated_cost])).toEqual([["indosmm",1,200]]);
});
it.each([{type:"Custom Comments"},{present:0},{rate_idr_per_1k:NaN},{min_qty:200},{max_qty:50},{service_id:0},{name:"TikTok Followers"},{name:"Instagram Custom Followers"}])("excludes incompatible candidates %j",patch=>{
 const r={...row,...patch};if(patch.name==='TikTok Followers')r.category="TikTok";
 expect(shortlistPediaServices([r],product,100)).toEqual([]);
});
it("includes geographic/capability diversity before many duplicate cheap variants",()=>{
 const rows=[...Array.from({length:7},(_,i)=>({...row,service_id:i+1,rate_idr_per_1k:100+i})),{...row,service_id:20,name:"Instagram Followers Indonesia",rate_idr_per_1k:500},{...row,service_id:30,name:"Instagram Followers Global R30",api_refill:1,rate_idr_per_1k:600}];
 expect(shortlistPediaServices(rows,product,100).slice(0,3).map(r=>r.service_id)).toEqual([1,20,30]);
});
it("never turns title/refill flags into a public refill promise or tested-quality claim",()=>{
 for(const api_refill of [0,1]){
  const [candidate]=shortlistPediaServices([{...row,name:"Instagram Followers R30",api_refill}],product,100);
  expect(candidate.suggested_terms).toContain("Tanpa refill dari AXVARA");
  expect(candidate.warnings.join(" ")).toMatch(/belum|Belum/);
  expect(candidate.warnings.length).toBe(2);
 }
});
it("keeps Shorts, ordinary video and incompatible Spotify target types separate",()=>{
 const youtube={...product,platform:"youtube",metric:"views",target_kind:"short"};
 expect(shortlistPediaServices([{...row,name:"Youtube Video Views",category:"Youtube"}],youtube,100)).toEqual([]);
 expect(shortlistPediaServices([{...row,name:"Youtube Shorts Views",category:"Youtube"}],youtube,100)).toHaveLength(1);
 expect(shortlistPediaServices([{...row,name:"Spotify Playlist Followers",category:"Spotify"}],{...product,platform:"spotify",target_kind:"artist"},100)).toEqual([]);
});
it.each([NaN,0,-1,1.5])("rejects invalid sample quantity %s",quantity=>expect(shortlistPediaServices([row],product,quantity)).toEqual([]));
it.each(['Canva Pro','Google Gemini AI Pro','CapCut'])('excludes premium-tool candidate %s even with a matching SMM name',category=>{
 expect(shortlistPediaServices([{...row,category}],product,100)).toEqual([]);
});
