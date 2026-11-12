#!/usr/bin/env node
/**
 * scripts/pedia-managed-fixture.mjs — PSMM-P5 (2026-11-12).
 *
 * Cetak SQL fixture untuk melihat katalog otomatis + panel admin secara lokal
 * TANPA memanggil supplier, tanpa auth bypass, dan tanpa transaksi.
 *
 * Pakai (dari akar repo, D1 lokal wrangler / lingkungan dev):
 *   node scripts/pedia-managed-fixture.mjs > /tmp/pedia-fixture.sql
 *   # lalu jalankan lewat harness D1 lokal pilihan Anda, mis.:
 *   npx wrangler d1 execute <DB_NAME> --local --file /tmp/pedia-fixture.sql
 *
 * Atau untuk unit test Node (D1 fixture in-memory), panggil langsung fungsi
 * `seedOfficialDescriptions` di `tests/helpers/pedia-managed-fixture.ts`.
 *
 * Catatan:
 * - Slug `psmm-dev-*` hanya untuk dev lokal; bukan data produksi.
 * - Tidak ada kunci/secret supplier dan tidak ada fetch upstream.
 * - Aplikasi TIDAK memuat fixture ini otomatis.
 */

const now = "2026-11-12T10:00:00.000Z";

/** @type {{ service_id:number, name:string, category:string, type:string, rate:number, min:number, max:number, desc:string, refill_api:0|1 }[]} */
const services = [
  { service_id: 900101, name: "Instagram Followers Global [No Refill]", category: "Instagram Followers", type: "Default", rate: 20000, min: 20, max: 10000, desc: "Followers masuk bertahap.\nJangan ubah profil selama proses.", refill_api: 0 },
  { service_id: 900102, name: "Instagram Likes Post [No Refill]", category: "Instagram Likes", type: "Default", rate: 12000, min: 20, max: 5000, desc: "Likes dikirim bertahap.\nFormat : https://www.instagram.com/p/CONTOH/", refill_api: 0 },
  { service_id: 900103, name: "Instagram Komentar Custom", category: "Instagram Komentar Custom", type: "Custom Comments", rate: 45000, min: 10, max: 200, desc: "Satu komentar per baris.\nJumlah komentar harus sama dengan jumlah pesanan.", refill_api: 0 },
  { service_id: 900104, name: "TikTok Views [No Refill]", category: "Tiktok Views", type: "Default", rate: 3000, min: 100, max: 100000, desc: "Views bertahap.\nJangan ubah video selama proses.", refill_api: 0 },
  // Sengaja DITAHAN: konflik syarat refill (nama klaim 30 hari vs deskripsi menolak).
  { service_id: 900105, name: "Instagram Followers [Garansi Refill 30 Hari]", category: "Instagram Followers", type: "Default", rate: 27000, min: 20, max: 20000, desc: "Garansi Refill : Tidak\nProses 1-6 jam.", refill_api: 0 },
  // Sengaja DITAHAN: tipe belum didukung (Invites tidak dijual di paket ini).
  { service_id: 900106, name: "Instagram Invites Group", category: "Instagram Invites", type: "Package", rate: 30000, min: 10, max: 1000, desc: "Undangan grup.", refill_api: 0 },
];

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Samakan dengan `src/lib/pedia/pricing.ts` (markup 60%, min profit 2000, min order 1000). */
function priceFor(rate, qty) {
  const modal = (qty * Number(rate)) / 1000;
  const raw = Math.max(modal * 1.6, modal + 2000);
  const step = raw < 10000 ? 100 : 500;
  return Math.max(Math.ceil(raw / step) * step, 1000);
}
const out = [];
out.push("-- Fixture DEV lokal katalog otomatis Pedia (PSMM-P5 + PSMM-ACCEPTANCE-CLOSE).");
out.push("-- Aman: tanpa supplier/secret. Baris auto dicap versi snapshot agar lolos gate syarat.");
out.push("BEGIN;");

const descriptions = {};
for (const s of services) {
  const eligible = !/Garansi Refill 30 Hari/i.test(s.name) && s.type !== "Package";
  const tierActive = eligible ? 1 : 0;
  const reason = eligible ? "NULL" : /Garansi Refill 30 Hari/i.test(s.name) ? q("terms_conflict") : q("type_unsupported");
  const platform = /TikTok/i.test(s.category) ? "tiktok" : "instagram";
  // Metrik mengikuti nama/kategori: TikTok Views = views/target video,
  // Likes = likes (target post), Custom Comments = comments (target post).
  const isViews = /\bViews?\b/i.test(s.name);
  const isLikes = /Likes/i.test(s.name);
  const isComments = s.type === "Custom Comments";
  const metric = isComments ? "comments" : isLikes ? "likes" : isViews ? "views" : "followers";
  const target = isComments || isLikes ? "post" : isViews ? "video" : "profile";
  const inputKind = isComments ? q("comments") : "NULL";
  const slug = q(`psmm-dev-${s.service_id}`);
  descriptions[String(s.service_id)] = { status: "ok", text: s.desc };
  // Paket kanonis: min layanan + 1.000 (bila muat batas).
  const packages = [...new Set([s.min, Math.min(s.max, 1000)])].sort((a, b) => a - b);
  const prices = Object.fromEntries(packages.map((qty) => [String(qty), priceFor(s.rate, qty)]));

  out.push(`INSERT OR IGNORE INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present)
  VALUES ('providersmm',${s.service_id},${q(s.name)},${q(s.category)},${q(s.type)},${s.rate},${s.min},${s.max},${s.refill_api},1);`);
  out.push(`INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,sort_order,managed)
  VALUES (${slug},${q(platform)},${q(metric)},${q(target)},${q(s.name)},${q(JSON.stringify(packages))},1,1,${s.service_id},'auto')
  ON CONFLICT(slug) DO UPDATE SET platform=excluded.platform, metric=excluded.metric, target_kind=excluded.target_kind, name=excluded.name, updated_at=datetime('now');`);
  out.push(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,package_prices_json,rate_snapshot,input_kind,public_name,min_qty_override,max_qty_override,sort_order,managed,is_active,auto_disabled_reason,target_format,refill_anchor,quantity_step,managed_snapshot_at)
  SELECT id,'standar','providersmm',${s.service_id},'G2',60,2000,0,${q(JSON.stringify(prices))},${s.rate},${inputKind},${q(s.name)},${s.min},${s.max},${s.service_id},'auto',${tierActive},${reason},'url','created',1,${q(now)}
  FROM pedia_products WHERE slug=${slug}
  ON CONFLICT(product_id,supplier,supplier_service_id) DO UPDATE SET is_active=excluded.is_active, auto_disabled_reason=excluded.auto_disabled_reason, managed_snapshot_at=excluded.managed_snapshot_at, updated_at=datetime('now');`);
}

const snapshot = JSON.stringify({ fetched_at: now, source_url: "https://providersmm.id/services", entries: descriptions });
out.push(`INSERT INTO store_settings (key,value,updated_at) VALUES ('pedia_psmm_desc_snapshot',${q(snapshot)},datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now');`);
out.push(`INSERT INTO store_settings (key,value,updated_at) VALUES ('pedia_psmm_desc_last_at',${q(now)},datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now');`);
out.push("COMMIT;");
out.push("-- Buka /pedia (katalog otomatis) dan /admin?section=pedia (ringkasan + tab Layanan Supplier).");

process.stdout.write(out.join("\n") + "\n");
