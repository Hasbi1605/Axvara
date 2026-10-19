/** Additive reviewed catalog release. Reads no credentials/network and never changes old orders. */
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync('src/lib/pedia/curation-20261019.json', 'utf8'));
const q = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const rows = values => values.map(row => `(${row.map(q).join(',')})`).join(',\n');
const ps=[], ss=[], slugs=new Set();
for (const [i,p] of manifest.products.entries()) {
  if (!/^[a-z0-9-]{1,80}$/.test(p.slug) || slugs.has(p.slug) || !p.services.length) throw Error(`Invalid product ${p.slug}`);
  slugs.add(p.slug);
  ps.push([p.slug,p.platform,p.metric,p.target_kind,p.name,p.description,JSON.stringify(p.checklist),JSON.stringify(p.packages),100+i,0]);
  const seen=new Set();
  for (const s of p.services) {
    const pair=`${s.supplier}:${s.service_id}`;
    if (!['providersmm','indosmm'].includes(s.supplier) || !Number.isSafeInteger(s.service_id) || s.service_id<=0 || seen.has(pair)) throw Error(`Invalid mapping ${pair}`);
    seen.add(pair);
    if (![s.min_qty_override,s.max_qty_override,s.quantity_step].every(n=>Number.isSafeInteger(n)&&n>0) || s.max_qty_override<s.min_qty_override || !p.packages.some(n=>n>=s.min_qty_override&&n<=s.max_qty_override&&n%s.quantity_step===0)) throw Error(`Invalid bounds ${pair}`);
    if (s.refill_days>0 && !s.evidence?.api_refill) throw Error(`Unverified refill ${pair}`);
    if (s.public_name.length>200 || [s.description,s.terms,s.instructions].some(t=>typeof t!=='string'||t.length>3000)) throw Error(`Invalid copy ${pair}`);
    ss.push([p.slug,s.supplier,s.service_id,s.public_name,s.description,s.terms,s.instructions,s.recommendation_note,s.region,s.quality,s.refill_days,s.eta_start,s.speed_note,s.drop_risk,s.min_qty_override,s.max_qty_override,s.quantity_step,s.sort_order,s.is_recommended,s.target_format,s.refill_anchor]);
  }
}
const sql=[`-- Generated reviewed 2026-10-19 expansion: additive, no old order/snapshot changes.\n-- Only current present/Default/rate-positive mirrors can activate new offers.\n-- Slug conflicts (including owner drafts) are intentionally preserved.`,
`CREATE TABLE pedia_expansion_products_20261019(slug TEXT PRIMARY KEY,platform TEXT,metric TEXT,target_kind TEXT,name TEXT,description_md TEXT,checklist_json TEXT,packages_json TEXT,sort_order INTEGER,is_new INTEGER);`,
`CREATE TABLE pedia_expansion_services_20261019(product_slug TEXT,supplier TEXT,service_id INTEGER,public_name TEXT,description_md TEXT,terms_md TEXT,instructions_md TEXT,recommendation_note TEXT,region TEXT,quality TEXT,refill_days INTEGER,eta_start TEXT,speed_note TEXT,drop_risk TEXT,min_qty_override INTEGER,max_qty_override INTEGER,quantity_step INTEGER,sort_order INTEGER,is_recommended INTEGER,target_format TEXT,refill_anchor TEXT,PRIMARY KEY(product_slug,supplier,service_id));`];
for(let i=0;i<ps.length;i+=10)sql.push(`INSERT INTO pedia_expansion_products_20261019 VALUES\n${rows(ps.slice(i,i+10))};`);
for(let i=0;i<ss.length;i+=10)sql.push(`INSERT INTO pedia_expansion_services_20261019 VALUES\n${rows(ss.slice(i,i+10))};`);
sql.push(`UPDATE pedia_expansion_products_20261019 SET is_new=CASE WHEN EXISTS(SELECT 1 FROM pedia_products p WHERE p.slug=pedia_expansion_products_20261019.slug) THEN 0 ELSE 1 END;`);
sql.push(`INSERT OR IGNORE INTO pedia_products(slug,platform,metric,target_kind,name,description_md,checklist_json,packages_json,step,sort_order,is_active,is_featured)
 SELECT slug,platform,metric,target_kind,name,description_md,checklist_json,packages_json,1,sort_order,0,0 FROM pedia_expansion_products_20261019 WHERE is_new=1;`);
sql.push(`INSERT OR IGNORE INTO pedia_tiers(product_id,tier,label_note,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,eta_start,package_prices_json,is_active,public_name,description_md,terms_md,instructions_md,recommendation_note,region,quality,speed_note,drop_risk,is_recommended,sort_order,min_qty_override,max_qty_override,quantity_step,target_format,refill_anchor)
 SELECT p.id,'standar',c.public_name,c.supplier,c.service_id,'G3',20,1000,c.refill_days,c.eta_start,'{}',1,c.public_name,c.description_md,c.terms_md,c.instructions_md,c.recommendation_note,c.region,c.quality,c.speed_note,c.drop_risk,c.is_recommended,c.sort_order,c.min_qty_override,c.max_qty_override,c.quantity_step,c.target_format,c.refill_anchor
 FROM pedia_expansion_services_20261019 c JOIN pedia_expansion_products_20261019 r ON r.slug=c.product_slug AND r.is_new=1
 JOIN pedia_products p ON p.slug=c.product_slug JOIN pedia_supplier_services s ON s.supplier=c.supplier AND s.service_id=c.service_id
 WHERE s.present=1 AND s.type='Default' AND s.rate_idr_per_1k>0 AND s.min_qty>0 AND s.max_qty>=s.min_qty
 AND MIN(s.max_qty,c.max_qty_override)>=MAX(s.min_qty,c.min_qty_override)
 AND EXISTS(SELECT 1 FROM json_each(p.packages_json) j WHERE CAST(j.value AS INTEGER) BETWEEN MAX(s.min_qty,c.min_qty_override) AND MIN(s.max_qty,c.max_qty_override) AND CAST(j.value AS INTEGER)%c.quantity_step=0)
 AND (c.refill_days=0 OR s.api_refill=1);`);
sql.push(`WITH quantities AS (
 SELECT t.id,CAST(j.value AS INTEGER) AS qty,s.rate_idr_per_1k AS rate,t.markup_pct AS markup,t.min_profit_rp AS min_profit
 FROM pedia_tiers t JOIN pedia_products p ON p.id=t.product_id JOIN pedia_expansion_products_20261019 r ON r.slug=p.slug AND r.is_new=1
 JOIN pedia_supplier_services s ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id JOIN json_each(p.packages_json) j
 WHERE t.is_active=1 AND s.present=1 AND s.type='Default' AND s.rate_idr_per_1k>0
 AND CAST(j.value AS INTEGER) BETWEEN MAX(s.min_qty,t.min_qty_override) AND MIN(s.max_qty,t.max_qty_override) AND CAST(j.value AS INTEGER)%t.quantity_step=0
), raw AS (SELECT id,qty,MAX(qty*rate/1000.0*(1+markup/100.0),qty*rate/1000.0+min_profit) AS amount FROM quantities),
 stepped AS (SELECT id,qty,amount,CASE WHEN amount<10000 THEN 100 ELSE 500 END AS step FROM raw),
 prices AS (SELECT id,qty,MAX(1000,CAST(amount/step AS INTEGER)*step+CASE WHEN amount>CAST(amount/step AS INTEGER)*step THEN step ELSE 0 END) AS price FROM stepped)
 UPDATE pedia_tiers SET package_prices_json=COALESCE((SELECT json_group_object(CAST(qty AS TEXT),price) FROM prices WHERE prices.id=pedia_tiers.id),'{}'),
 rate_snapshot=(SELECT rate_idr_per_1k FROM pedia_supplier_services s WHERE s.supplier=pedia_tiers.supplier AND s.service_id=pedia_tiers.supplier_service_id)
 WHERE product_id IN (SELECT p.id FROM pedia_products p JOIN pedia_expansion_products_20261019 r ON r.slug=p.slug AND r.is_new=1);`);
sql.push(`UPDATE pedia_products SET is_active=CASE WHEN EXISTS(SELECT 1 FROM pedia_tiers t WHERE t.product_id=pedia_products.id AND t.is_active=1 AND t.package_prices_json<>'{}') THEN 1 ELSE 0 END
 WHERE slug IN (SELECT slug FROM pedia_expansion_products_20261019 WHERE is_new=1);`);
sql.push(`DROP TABLE pedia_expansion_services_20261019;\nDROP TABLE pedia_expansion_products_20261019;`);
if(sql.some(s=>Buffer.byteLength(s)>90000))throw Error('D1 statement too large');
fs.writeFileSync('drizzle/migrations/0070_pedia_catalog_breadth.sql',sql.join('\n\n')+'\n');
console.log(`Generated ${ps.length} new needs / ${ss.length} mappings.`);
