/** Explainable admin shortlisting, never evidence of delivery quality or permission to publish. */
import { PEDIA_ADDITIONAL_PLATFORMS } from "./additional-platforms";
import { isPediaPremiumToolCandidate, PEDIA_SALE_PROVIDER } from "./sales-policy";
export type CurationProduct = { id:number; name:string; platform:string; metric:string; target_kind:string };
export type CurationService = { supplier:string; service_id:number; name:string; category:string; type:string; rate_idr_per_1k:number; min_qty:number; max_qty:number; api_refill:number; present:number; used_in?:string|null };
export type CurationCandidate = CurationService & { estimated_cost:number; region:string; warnings:string[]; suggested_name:string; suggested_description:string; suggested_terms:string; suggested_instructions:string; group:string };
export const CURATION_PLATFORM_TERMS:Record<string,string[]>={instagram:['instagram'],tiktok:['tiktok'],youtube:['youtube'],facebook:['facebook'],threads:['threads'],x:['twitter','x /','x/'],telegram:['telegram'],spotify:['spotify'],soundcloud:['soundcloud'],linkedin:['linkedin'],pinterest:['pinterest'],discord:['discord'],shopee:['shopee'],twitch:['twitch'],github:['github'],website:['traffic'],...Object.fromEntries(PEDIA_ADDITIONAL_PLATFORMS.map(p=>[p.id,[p.id,p.label.toLowerCase()]]))};
export const CURATION_METRIC_TERMS:Record<string,string[]>={followers:['followers','follow'],subscribers:['subscriber'],members:['member'],likes:['likes','like'],views:['views','view'],plays:['plays','play'],shares:['share'],saves:['save','bookmark'],reposts:['repost','retweet'],quotes:['quote'],reactions:['reaction'],forks:['fork'],traffic:['traffic'],connections:['connection'],visits:['visit'],listeners:['listener'],comments:['comment'],claps:['clap'],downloads:['download']};
export function shortlistPediaServices(rows:CurationService[],product:CurationProduct,quantity:number):CurationCandidate[]{
 if(!Number.isSafeInteger(quantity)||quantity<=0)return [];
 const platformTerms=CURATION_PLATFORM_TERMS[product.platform]??[],metricTerms=CURATION_METRIC_TERMS[product.metric]??[];
 const candidates:CurationCandidate[]=[];
 for(const r of rows){
  const name=r.name.toLowerCase(),text=`${name} ${r.category.toLowerCase()}`;
  // INDO-POLICY-20: shortlist draws from the sale supplier only, and Pedia
  // SMM never offers premium tools (Canva/Gemini/CapCut live on Market).
  if(r.supplier!==PEDIA_SALE_PROVIDER)continue;
  if(isPediaPremiumToolCandidate(r.name,r.category))continue;
  if(!['providersmm','indosmm'].includes(r.supplier)||r.present!==1||r.type!=='Default'||!Number.isSafeInteger(r.service_id)||r.service_id<=0||!Number.isFinite(r.rate_idr_per_1k)||r.rate_idr_per_1k<=0||!Number.isSafeInteger(r.min_qty)||!Number.isSafeInteger(r.max_qty)||r.min_qty<=0||r.max_qty<r.min_qty||quantity<r.min_qty||quantity>r.max_qty)continue;
  if(!platformTerms.some(w=>text.includes(w))||!metricTerms.some(w=>name.includes(w)))continue;
  if(/custom|subscription|live.?stream|live views|poll|vote|comment|komentar|100%\s*drop|drop.{0,12}100%/.test(name))continue;
  if(product.metric==='reposts'&&/quote/.test(name))continue;
  if(product.target_kind==='short'&&!/short/.test(name))continue;
  if(product.platform==='youtube'&&product.target_kind==='video'&&/short/.test(name))continue;
  if(product.platform==='instagram'&&/story/.test(name)!==(product.target_kind==='profile'&&product.metric==='views'))continue;
  if(product.platform==='spotify'&&product.target_kind==='track'&&/followers/.test(name))continue;
  if(product.platform==='spotify'&&product.target_kind==='artist'&&/playlist/.test(name)&&!/artist/.test(name))continue;
  if(product.platform==='spotify'&&product.target_kind==='playlist'&&/artist/.test(name)&&!/playlist/.test(name))continue;
  const region=/indonesia/.test(text)?'Indonesia':/global|worldwide|\bww\b/.test(text)?'Global':'Wilayah perlu ditinjau';
  const warnings=['Belum membuktikan kualitas, drop, atau kesesuaian deskripsi. Periksa target dan ketentuan supplier sebelum terbit.'];
  if(/refill|garansi|guarantee|\br\d+\b|days|hari/.test(name)&&!/no refill|tanpa refill|tidak bergaransi/.test(name)&&r.api_refill!==1)warnings.push('Nama menyebut garansi, tetapi API refill tidak tersedia. Draf tidak menjanjikan refill.');
  if(r.api_refill===1)warnings.push('API refill tersedia; masa, syarat, dan titik awal garansi tetap perlu dikonfirmasi. Draf awal tanpa refill.');
  const step=name.match(/kelipatan\s*(\d+)/i)?.[1];
  if(step&&quantity%Number(step)!==0)continue;
  const estimated_cost=r.rate_idr_per_1k*quantity/1000;
  if(!Number.isFinite(estimated_cost))continue;
  candidates.push({...r,estimated_cost,region,warnings,group:`${region}:${r.api_refill===1?'refill':'none'}`,suggested_name:`${product.name} · ${region==='Wilayah perlu ditinjau'?'Pilihan baru':region} · Tanpa refill`.slice(0,200),suggested_description:`${product.name} untuk target publik. Periksa kesesuaian link dan ketentuan layanan sebelum mengaktifkan draf.`,suggested_terms:`Jumlah mengikuti batas supplier yang berlaku.\nTanpa refill dari AXVARA; drop setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.\nJangan mengubah atau menghapus target selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.`,suggested_instructions:'Gunakan link sesuai jenis produk, isi jumlah, baca ketentuan, lalu lanjutkan ke kontak dan pembayaran.'});
 }
 // Keep a representative from each region/capability group before near duplicates.
 const sorted=candidates.sort((a,b)=>a.estimated_cost-b.estimated_cost||a.supplier.localeCompare(b.supplier)||a.service_id-b.service_id),seen=new Set<string>(),first:CurationCandidate[]=[],rest:CurationCandidate[]=[];
 for(const c of sorted){if(seen.has(c.group))rest.push(c);else{seen.add(c.group);first.push(c);}}
 return [...first,...rest].slice(0,20);
}
