/** 2026-11-01 IndoSMM catalog + service health release. Reads no credentials/network; never changes old orders.
 * Inputs (committed): src/lib/pedia/service-stats-20261101.json, src/lib/pedia/curation-20261101.json
 * (produced offline by scripts/curate-pedia-indosmm-20261101.py from a read-only dashboard scrape).
 * Outputs: drizzle/migrations/0085_pedia_service_health.sql, 0086_pedia_indosmm_catalog_20261101.sql */
import fs from 'node:fs';

const stats = JSON.parse(fs.readFileSync('src/lib/pedia/service-stats-20261101.json', 'utf8'));
const m = JSON.parse(fs.readFileSync('src/lib/pedia/curation-20261101.json', 'utf8'));
const q = (v) => v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const rows = (list) => list.map((r) => `(${r.map(q).join(',')})`).join(',\n');
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const DROP = new Set(['no_drop', 'less_drop', 'high_drop', 'unknown']);
const RISK = new Set(['rendah', 'sedang', 'tinggi']);
const write = (file, parts) => {
  if (parts.some((s) => Buffer.byteLength(s) > 90_000)) throw Error(`D1 statement too large in ${file}`);
  fs.writeFileSync(file, parts.join('\n\n') + '\n');
};

// ---- 0085: schema + measured supplier health snapshot ---------------------
const statRows = stats.rows.map(([id, avg, orders, success, cancel, refill, score]) => {
  if (!Number.isSafeInteger(id) || id <= 0) throw Error(`Invalid stat ${id}`);
  // Supplier placeholder text is not a time; keep NULL instead.
  const avgTime = typeof avg === 'string' && /\d/.test(avg) ? avg : null;
  return ['indosmm', id, avgTime, orders, success, cancel, refill, score, stats.period_hours, stats.analyzed_at];
});
const s85 = [
  `-- 0085_pedia_service_health.sql — Kesehatan layanan IndoSMM + label drop (2026-11-01).
-- pedia_service_stats: data terukur supplier 7 hari (success/cancel/refill rate, AI score)
-- dan avg time dari Daftar Layanan IndoSMM. Diperbarui per jam oleh cron lite
-- (sumber publik ai.indosmm.web.id); avg_time hanya dari snapshot ini/admin.
-- pedia_tiers.drop_label: label drop supplier (No Drop/Less Drop/High Drop);
-- speed_per_day: speed klaim supplier. Tidak mengubah order/snapshot lama.`,
  `CREATE TABLE IF NOT EXISTS pedia_service_stats (
  supplier TEXT NOT NULL,
  service_id INTEGER NOT NULL,
  avg_time TEXT,
  orders_7d INTEGER NOT NULL DEFAULT 0,
  success_rate REAL,
  cancel_rate REAL,
  refill_rate REAL,
  ai_score INTEGER,
  period_hours INTEGER,
  analyzed_at TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (supplier, service_id)
);`,
  `ALTER TABLE pedia_tiers ADD COLUMN drop_label TEXT CHECK (drop_label IS NULL OR drop_label IN ('no_drop','less_drop','high_drop','unknown'));`,
  `ALTER TABLE pedia_tiers ADD COLUMN speed_per_day TEXT;`,
  ...chunks(statRows, 250).map((c) => `INSERT OR IGNORE INTO pedia_service_stats(supplier,service_id,avg_time,orders_7d,success_rate,cancel_rate,refill_rate,ai_score,period_hours,analyzed_at) VALUES\n${rows(c)};`),
];
write('drizzle/migrations/0085_pedia_service_health.sql', s85);

// ---- 0086: catalog expansion ----------------------------------------------
const ps = [], ss = [], us = [], slugs = new Set();
for (const [i, p] of m.new_products.entries()) {
  if (!/^[a-z0-9-]{1,80}$/.test(p.slug) || slugs.has(p.slug)) throw Error(`Invalid product ${p.slug}`);
  slugs.add(p.slug);
  ps.push([p.slug, p.platform, p.metric, p.target_kind, p.name, p.description, JSON.stringify(p.checklist), JSON.stringify(p.packages), 300 + i]);
}
const seen = new Set();
for (const s of m.services) {
  const key = `${s.product_slug}:${s.service_id}`;
  if (s.supplier !== 'indosmm' || !Number.isSafeInteger(s.service_id) || s.service_id <= 0 || seen.has(key)) throw Error(`Invalid mapping ${key}`);
  seen.add(key);
  if (![s.min_qty_override, s.max_qty_override, s.quantity_step].every((n) => Number.isSafeInteger(n) && n > 0) || s.max_qty_override < s.min_qty_override) throw Error(`Invalid bounds ${key}`);
  if (!DROP.has(s.drop_label) || !RISK.has(s.drop_risk) || !Number.isSafeInteger(s.refill_days) || s.refill_days < 0) throw Error(`Invalid labels ${key}`);
  if (s.public_name.length > 200 || [s.description, s.terms, s.instructions].some((t) => typeof t !== 'string' || t.length > 3000)) throw Error(`Invalid copy ${key}`);
  ss.push([s.product_slug, s.service_id, s.public_name, s.description, s.terms, s.instructions, s.region, s.quality, s.refill_days, s.eta_start, s.speed_per_day, s.drop_label, s.drop_risk, s.min_qty_override, s.max_qty_override, s.quantity_step, s.sort_order]);
}
for (const u of m.existing_updates) {
  if (!Number.isSafeInteger(u.service_id) || !DROP.has(u.drop_label) || (u.drop_risk != null && !RISK.has(u.drop_risk))) throw Error(`Invalid update ${u.service_id}`);
  us.push([u.service_id, u.drop_label, u.drop_risk, u.speed_per_day, u.eta_start]);
}
const dead = m.deactivate_service_ids.map(Number);
if (!dead.every((n) => Number.isSafeInteger(n) && n > 0)) throw Error('Invalid deactivation list');

const s86 = [
  `-- 0086_pedia_indosmm_catalog_20261101.sql — Generated by scripts/generate-pedia-indosmm-20261101.mjs.
-- Owner 2026-11-01: katalog IndoSMM lebih kaya (termasuk High Drop/No Refill murah
-- dengan label jelas), refill manual diperbolehkan untuk layanan bergaransi tanpa
-- tombol API (lihat src/lib/pedia/refill-policy.ts). Hanya mirror present/Default/
-- rate>0 yang diaktifkan. Konflik slug/draf owner dipertahankan (INSERT OR IGNORE).
-- Layanan dengan success rate 7 hari rendah dinonaktifkan; order lama tidak diubah.`,
  `CREATE TABLE IF NOT EXISTS pedia_expansion_products_20261101(slug TEXT PRIMARY KEY,platform TEXT,metric TEXT,target_kind TEXT,name TEXT,description_md TEXT,checklist_json TEXT,packages_json TEXT,sort_order INTEGER,is_new INTEGER DEFAULT -1);`,
  `CREATE TABLE IF NOT EXISTS pedia_expansion_services_20261101(product_slug TEXT,service_id INTEGER,public_name TEXT,description_md TEXT,terms_md TEXT,instructions_md TEXT,region TEXT,quality TEXT,refill_days INTEGER,eta_start TEXT,speed_per_day TEXT,drop_label TEXT,drop_risk TEXT,min_qty_override INTEGER,max_qty_override INTEGER,quantity_step INTEGER,sort_order INTEGER,PRIMARY KEY(product_slug,service_id));`,
  `CREATE TABLE IF NOT EXISTS pedia_tier_updates_20261101(service_id INTEGER PRIMARY KEY,drop_label TEXT,drop_risk TEXT,speed_per_day TEXT,eta_start TEXT);`,
  ...chunks(ps, 10).map((c) => `INSERT OR IGNORE INTO pedia_expansion_products_20261101(slug,platform,metric,target_kind,name,description_md,checklist_json,packages_json,sort_order) VALUES\n${rows(c)};`),
  ...chunks(ss, 15).map((c) => `INSERT OR IGNORE INTO pedia_expansion_services_20261101 VALUES\n${rows(c)};`),
  ...chunks(us, 50).map((c) => `INSERT OR IGNORE INTO pedia_tier_updates_20261101 VALUES\n${rows(c)};`),
  `UPDATE pedia_expansion_products_20261101 SET is_new=CASE WHEN EXISTS(SELECT 1 FROM pedia_products p WHERE p.slug=pedia_expansion_products_20261101.slug) THEN 0 ELSE 1 END WHERE is_new=-1;`,
  `INSERT OR IGNORE INTO pedia_products(slug,platform,metric,target_kind,name,description_md,checklist_json,packages_json,step,sort_order,is_active,is_featured)
 SELECT slug,platform,metric,target_kind,name,description_md,checklist_json,packages_json,1,sort_order,0,0 FROM pedia_expansion_products_20261101 WHERE is_new=1;`,
  `INSERT OR IGNORE INTO pedia_tiers(product_id,tier,label_note,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,eta_start,package_prices_json,is_active,public_name,description_md,terms_md,instructions_md,region,quality,speed_note,speed_per_day,drop_risk,drop_label,is_recommended,sort_order,min_qty_override,max_qty_override,quantity_step,target_format,refill_anchor,auto_disabled_reason)
 SELECT p.id,'standar',c.public_name,'indosmm',c.service_id,'G3',20,1000,c.refill_days,c.eta_start,'{}',0,c.public_name,c.description_md,c.terms_md,c.instructions_md,c.region,c.quality,NULL,c.speed_per_day,c.drop_risk,c.drop_label,0,c.sort_order,c.min_qty_override,c.max_qty_override,c.quantity_step,'url','created','curation_20261101_pending'
 FROM pedia_expansion_services_20261101 c
 JOIN pedia_products p ON p.slug=c.product_slug
 LEFT JOIN pedia_expansion_products_20261101 r ON r.slug=c.product_slug
 JOIN pedia_supplier_services s ON s.supplier='indosmm' AND s.service_id=c.service_id
 WHERE (r.slug IS NULL OR r.is_new=1 OR (p.platform=r.platform AND p.metric=r.metric AND p.target_kind=r.target_kind))
 AND s.present=1 AND s.type='Default' AND s.rate_idr_per_1k>0 AND s.min_qty>0 AND s.max_qty>=s.min_qty
 AND MIN(s.max_qty,c.max_qty_override)>=MAX(s.min_qty,c.min_qty_override)
 AND EXISTS(SELECT 1 FROM json_each(p.packages_json) j WHERE CAST(j.value AS INTEGER) BETWEEN MAX(s.min_qty,c.min_qty_override) AND MIN(s.max_qty,c.max_qty_override) AND CAST(j.value AS INTEGER)%c.quantity_step=0);`,
  `WITH quantities AS (
 SELECT t.id,CAST(j.value AS INTEGER) AS qty,s.rate_idr_per_1k AS rate,t.markup_pct AS markup,t.min_profit_rp AS min_profit
 FROM pedia_tiers t JOIN pedia_products p ON p.id=t.product_id
 JOIN pedia_supplier_services s ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id JOIN json_each(p.packages_json) j
 WHERE t.auto_disabled_reason='curation_20261101_pending' AND s.present=1 AND s.type='Default' AND s.rate_idr_per_1k>0
 AND CAST(j.value AS INTEGER) BETWEEN MAX(s.min_qty,t.min_qty_override) AND MIN(s.max_qty,t.max_qty_override) AND CAST(j.value AS INTEGER)%t.quantity_step=0
), raw AS (SELECT id,qty,MAX(qty*rate/1000.0*(1+markup/100.0),qty*rate/1000.0+min_profit) AS amount FROM quantities),
 stepped AS (SELECT id,qty,amount,CASE WHEN amount<10000 THEN 100 ELSE 500 END AS step FROM raw),
 prices AS (SELECT id,qty,MAX(1000,CAST(amount/step AS INTEGER)*step+CASE WHEN amount>CAST(amount/step AS INTEGER)*step THEN step ELSE 0 END) AS price FROM stepped)
 UPDATE pedia_tiers SET package_prices_json=COALESCE((SELECT json_group_object(CAST(qty AS TEXT),price) FROM prices WHERE prices.id=pedia_tiers.id),'{}'),
 rate_snapshot=(SELECT rate_idr_per_1k FROM pedia_supplier_services s WHERE s.supplier=pedia_tiers.supplier AND s.service_id=pedia_tiers.supplier_service_id)
 WHERE auto_disabled_reason='curation_20261101_pending';`,
  `UPDATE pedia_tiers SET is_active=1,auto_disabled_reason=NULL,updated_at=datetime('now') WHERE auto_disabled_reason='curation_20261101_pending' AND package_prices_json<>'{}';`,
  `UPDATE pedia_tiers SET drop_label=(SELECT u.drop_label FROM pedia_tier_updates_20261101 u WHERE u.service_id=pedia_tiers.supplier_service_id),
 drop_risk=COALESCE((SELECT u.drop_risk FROM pedia_tier_updates_20261101 u WHERE u.service_id=pedia_tiers.supplier_service_id),drop_risk),
 speed_per_day=COALESCE(speed_per_day,(SELECT u.speed_per_day FROM pedia_tier_updates_20261101 u WHERE u.service_id=pedia_tiers.supplier_service_id)),
 eta_start=COALESCE(NULLIF(eta_start,''),(SELECT u.eta_start FROM pedia_tier_updates_20261101 u WHERE u.service_id=pedia_tiers.supplier_service_id)),
 updated_at=datetime('now')
 WHERE supplier='indosmm' AND drop_label IS NULL AND supplier_service_id IN (SELECT service_id FROM pedia_tier_updates_20261101);`,
  // White label (owner 2026-11-01): teks publik lama tanpa kata supplier. Runtime
  // juga menyaring (whiteLabel di src/lib/pedia/terms.ts); ini merapikan sumbernya.
  ...['terms_md', 'description_md', 'instructions_md', 'recommendation_note'].map((c) => `UPDATE pedia_tiers SET ${c}=REPLACE(REPLACE(REPLACE(REPLACE(${c},'Estimasi supplier','Estimasi'),'Supplier menyebut ','Info layanan: '),', tetapi API refill belum tersedia',' (refill diproses admin)'),' dari supplier',''),updated_at=datetime('now') WHERE supplier='indosmm' AND ${c} LIKE '%upplier%';`),
  // Owner 2026-11-01: istilah SMM pada nama layanan lama (Refill N Days / No Refill).
  `UPDATE pedia_tiers SET public_name=REPLACE(REPLACE(public_name,' hari',' Days'),'Tanpa refill','No Refill'),label_note=REPLACE(REPLACE(label_note,' hari',' Days'),'Tanpa refill','No Refill'),updated_at=datetime('now')
 WHERE supplier='indosmm' AND (public_name LIKE '%Refill % hari%' OR public_name LIKE '%Tanpa refill%' OR label_note LIKE '%Refill % hari%' OR label_note LIKE '%Tanpa refill%');`,
  `UPDATE pedia_tiers SET is_active=0,auto_disabled_reason='supplier_health_20261101',updated_at=datetime('now') WHERE supplier='indosmm' AND is_active=1 AND supplier_service_id IN (${dead.join(',')});`,
  `UPDATE pedia_products SET is_active=0 WHERE is_active=1 AND NOT EXISTS(SELECT 1 FROM pedia_tiers t WHERE t.product_id=pedia_products.id AND t.is_active=1)
 AND EXISTS(SELECT 1 FROM pedia_tiers t WHERE t.product_id=pedia_products.id AND t.auto_disabled_reason='supplier_health_20261101');`,
  `UPDATE pedia_products SET is_active=CASE WHEN EXISTS(SELECT 1 FROM pedia_tiers t WHERE t.product_id=pedia_products.id AND t.is_active=1 AND t.package_prices_json<>'{}') THEN 1 ELSE 0 END
 WHERE slug IN (SELECT slug FROM pedia_expansion_products_20261101 WHERE is_new=1);`,
  `DROP TABLE IF EXISTS pedia_expansion_services_20261101;\nDROP TABLE IF EXISTS pedia_expansion_products_20261101;\nDROP TABLE IF EXISTS pedia_tier_updates_20261101;`,
];
write('drizzle/migrations/0086_pedia_indosmm_catalog_20261101.sql', s86);
console.log(`0085: ${statRows.length} stats. 0086: ${ps.length} new products, ${ss.length} mappings, ${us.length} tier updates, ${dead.length} deactivations.`);
