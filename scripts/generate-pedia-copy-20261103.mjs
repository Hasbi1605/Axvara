/** Copy katalog Pedia 3 Nov 2026 — nama/deskripsi layanan aktif dari karakteristik yang tertulis di sumber.
 * Dua tahap, satu berkas:
 *   node scripts/generate-pedia-copy-20261103.mjs --from-cache  (offline; baca /tmp/indosmm + manifest committed)
 *       → src/lib/pedia/copy-20261103.json
 *   node scripts/generate-pedia-copy-20261103.mjs                (hanya manifest committed)
 *       → drizzle/migrations/0093_pedia_service_copy_20261103.sql
 * Tidak membaca kredensial/jaringan. Hanya menyentuh pedia_tiers; snapshot order lama tidak diubah.
 * Setiap UPDATE di-guard id + supplier + service id + nama/deskripsi lama persis, sehingga edit admin
 * terlindungi dan hasilnya idempoten. Tier 285/svc 5834 (kontrak refill 90 vs 30) sengaja TIDAK disentuh. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MANIFEST = 'src/lib/pedia/copy-20261103.json';
const MIGRATION = 'drizzle/migrations/0093_pedia_service_copy_20261103.sql';

// ---- klasifikasi nama sumber (diuji di tests/pedia-copy-20261103.test.ts) ----------------
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
export function normalizeSource(raw) {
  let s = String(raw ?? '').normalize('NFKC');
  for (let i = 0; i < 3; i++) s = s.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);
  return s.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}️‍]/gu, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}
/** Fakta karakteristik dari satu nama layanan sumber. `active`/`buzzer` sengaja diabaikan. */
export function classifySource(raw) {
  const n = normalizeSource(raw);
  const segs = n.split(/[|[\]~()]/).map((s) => s.trim()).filter(Boolean);
  const any = (re) => segs.some((s) => re.test(s));
  const mix = any(/^(?:mix|mixed(?: quality)?|real mix)$/) || /\b(?:bot (?:&|and) real|real (?:&|and) bot)\b/.test(n);
  const real = !mix && /\breal\b/.test(n);
  const realLook = !mix && /\breal look\b/.test(n);
  const realPeople = !mix && /\breal people\b/.test(n);
  const realHuman = !mix && /\breal humans?\b/.test(n);
  const hq = !mix && /(?:^|[^a-z])(?:hq|high quality)(?![a-z])/.test(n);
  const instant = /\binstant start\b/.test(n) || any(/^(?:ultra )?(?:super ?)?instant(?: start)?(?: super fast)?!?$/) ||
    any(/^start(?: time)?\s*:\s*instant$/);
  const word = realLook ? 'Real Look' : realPeople ? 'Real People' : realHuman ? 'Real Human' : real ? 'Real' : hq ? 'HQ' : null;
  return { mix, real, realLook, realPeople, realHuman, hq, posts: /\bwith posts?\b/.test(n), old: /\bold accounts?\b/.test(n), instant, word };
}

// ---- keputusan copy per tier (spec Claude 3 Nov §3; nama = tanpa "· Instant Start") ------
const LAMA_POSTS = 'Followers Instagram global dari akun lama berpostingan.';
const OV = {
  388: ['Followers Indonesia Real Look', 'real', 'Followers Instagram Indonesia dari akun Real Look.', ['realLook']],
  46: ['Followers Global HQ · Akun berpostingan', 'hq', 'Followers Instagram global dari akun HQ berpostingan.', ['hq', 'posts']],
  47: ['Followers Global · Akun lama berpostingan', 'standar', LAMA_POSTS, ['old', 'posts']],
  386: ['Followers Global · Akun lama berpostingan', 'standar', LAMA_POSTS, ['old', 'posts']],
  387: ['Followers Global · Akun lama berpostingan', 'standar', LAMA_POSTS, ['old', 'posts']],
  393: ['Followers Global Real People · Akun berpostingan', 'real', 'Followers Instagram global dari akun Real People berpostingan.', ['realPeople', 'posts']],
  73: ['Followers Global Real · Akun berpostingan', 'real', 'Followers TikTok global dari akun Real berpostingan.', ['real', 'posts']],
  76: ['Likes Video Global HQ · Akun berpostingan', 'hq', 'Likes TikTok global dari akun HQ berpostingan.', ['hq', 'posts']],
  30: ['Likes Post Global · Akun lama', 'standar', 'Likes Instagram global dari akun lama.', ['old']],
  263: ['Likes Post Global · Akun lama', 'standar', 'Likes Instagram global dari akun lama.', ['old']],
  408: ['Likes Post Global · Akun lama', 'standar', 'Likes Instagram global dari akun lama.', ['old']],
  282: ['Followers Global Real People', 'real', 'Followers TikTok global dari akun Real People.', ['realPeople']],
  71: ['Followers Global Real People', 'real', 'Followers TikTok global dari akun Real People.', ['realPeople']],
  534: ['Komentar Custom Indonesia Real Human', 'real', 'Komentar TikTok dari akun Indonesia Real Human; isi komentar kamu tulis sendiri.', ['realHuman']],
  378: ['Komentar Indonesia · Campuran', 'standar', 'Komentar TikTok acak dari akun Indonesia campuran.', ['mix']],
  404: ['Likes Post Global · Campuran', 'standar', 'Likes Instagram global dari akun campuran.', ['mix']],
  91: ['Saves Video Indonesia · Campuran', 'standar', 'Saves TikTok dari akun Indonesia campuran.', ['mix']],
  137: ['Members Global Real', 'real', 'Members Telegram global dari akun Real.', ['real']],
  118: ['Followers Indonesia Real', 'real', 'Followers Threads dari akun Indonesia Real.', ['real']],
  123: ['Likes Post Indonesia Real', 'real', 'Likes Threads dari akun Indonesia Real.', ['real']],
  164: ['Followers Global Real', 'real', 'Followers GitHub global dari akun Real.', ['real']],
  165: ['Fork Repository Global Real', 'real', 'Fork Repository GitHub global dari akun Real.', ['real']],
  237: ['Bookmarks Artikel Global Real', 'real', 'Bookmarks Artikel Medium global dari akun Real.', ['real']],
};
const PLATFORM = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', threads: 'Threads' };
const BAD_REAL = /akun real\/aktif|label Real/;
const STRIP = /\s*menurut (?:keterangan|label) layanan/;

/** Deskripsi baru untuk tier di luar tabel: hanya teks yang membawa label lama. */
export function rewriteDescription(old, { product, region }, facts) {
  if (BAD_REAL.test(old)) {
    const platform = PLATFORM[product.split('-').pop()];
    const metric = old.match(/^(.*?)(?: global| dari akun Indonesia),/)?.[1];
    if (!platform || !metric) throw Error(`Tidak bisa menyusun deskripsi: ${product} / ${old}`);
    const id = region === 'indonesia';
    const quality = facts.word ?? null;
    if (quality) return metric === 'Views' ? `${metric} ${platform} dari akun ${quality}${id ? ' Indonesia' : ' (global)'}.` : id ? `${metric} ${platform} dari akun Indonesia ${quality}.` : `${metric} ${platform} global dari akun ${quality}.`;
    return `${metric} ${platform} ${id ? 'Indonesia' : 'global'}.`;
  }
  return old.replace(STRIP, '');
}
/** Semua teks yang mungkin tersimpan untuk deskripsi lama (asli + varian 0090 "label Real"). */
// Teks tersimpan setelah 0090 yang tidak ada di migrasi sumber (0090 menulis ulang deskripsi tier 47).
const EXTRA_FROM = { 7887: ['Followers Instagram untuk target publik. Akun lama menurut label layanan.'] };
const variants = (list) => [...new Set(list.flatMap((d) => [d, d.replace(', akun real/aktif.', ', label Real.')]))];

// ---- tahap 1: dari cache offline ---------------------------------------------------------
function fromCache() {
  const names = JSON.parse(fs.readFileSync('src/lib/pedia/names-20261102.json', 'utf8')).rename;
  const tiers = new Map(JSON.parse(fs.readFileSync('/tmp/indosmm/axv-tiers.json', 'utf8'))[0].results.map((r) => [r.id, r]));
  const joined = new Map(JSON.parse(fs.readFileSync('/tmp/indosmm/joined.json', 'utf8')).map((r) => [r.id, r.name]));
  const cur = new Map(); const hist = new Map();
  const add = (sid, d) => hist.set(sid, [...(hist.get(sid) ?? []), d]);
  for (const f of ['curation-20261101', 'curation-20261101b']) {
    for (const s of JSON.parse(fs.readFileSync(`src/lib/pedia/${f}.json`, 'utf8')).services) {
      const k = `${s.product_slug}\u0000${s.public_name}`; cur.set(k, [...(cur.get(k) ?? []), s.service_id]); add(s.service_id, s.description);
    }
  }
  const sql = /'indosmm',(\d+),'((?:[^']|'')*)','((?:[^']|'')*)'/g;
  for (const f of ['0066_pedia_catalog_expansion', '0070_pedia_catalog_breadth', '0073_pedia_indosmm_only_catalog']) {
    for (const m of fs.readFileSync(`drizzle/migrations/${f}.sql`, 'utf8').matchAll(sql)) add(Number(m[1]), m[3].replaceAll("''", "'"));
  }
  const entries = [], skipped = [];
  for (const r of names) {
    const ids = new Set(tiers.has(r.id) && tiers.get(r.id).supplier === 'indosmm' ? [tiers.get(r.id).sid] : cur.get(`${r.product}\u0000${r.old}`) ?? []);
    if (ids.size !== 1) { skipped.push({ id: r.id, why: 'mapping tidak unik' }); continue; }
    const sid = [...ids][0]; const source = joined.get(sid);
    if (!source) { skipped.push({ id: r.id, why: 'nama sumber tidak ada di cache' }); continue; }
    const facts = classifySource(source);
    const region = /Indonesia/.test(r.new) ? 'indonesia' : 'global';
    let to = r.new; let quality = null; let desc = null;
    const descFrom = variants([...new Set([...(hist.get(sid) ?? []), ...(EXTRA_FROM[sid] ?? [])])]);
    if (OV[r.id]) {
      const [name, q, d, need] = OV[r.id];
      const miss = need.filter((k) => !facts[k]);
      if (miss.length) throw Error(`Tier ${r.id} (${sid}) tidak didukung sumber "${source}": ${miss}`);
      to = name; quality = q; desc = d;
    } else {
      const bad = descFrom.filter((d) => BAD_REAL.test(d) || STRIP.test(d));
      if (bad.length) desc = { generic: true };
    }
    if (facts.instant) to = `${to} · Instant Start`;
    const e = { id: r.id, product: r.product, sid, source, from: r.new, to };
    if (quality) e.quality = quality;
    if (typeof desc === 'string') e.desc = { from: descFrom, to: desc };
    else if (desc) {
      const out = {}; // satu teks baru per teks lama (lama berbeda → baru berbeda)
      for (const d of descFrom.filter((x) => BAD_REAL.test(x) || STRIP.test(x))) out[d] = rewriteDescription(d, { product: r.product, region }, facts);
      e.descMap = out;
    }
    entries.push(e);
  }
  const changed = entries.filter((e) => e.to !== e.from || e.desc || e.descMap);
  const instant = entries.filter((e) => e.to !== e.from && e.to.endsWith('· Instant Start')).length;
  fs.writeFileSync(MANIFEST, JSON.stringify({
    source: 'cache baca-saja 1 Nov 2026 (nama layanan supplier) ⨝ names-20261102.json; tanpa panggilan baru',
    skipped, entries: changed,
  }, null, 1) + '\n');
  console.error(`aktif ${names.length}, berubah ${changed.length} (nama ${changed.filter((e) => e.to !== e.from).length}, deskripsi ${changed.filter((e) => e.desc || e.descMap).length}, Instant Start ${instant}), skipped ${skipped.length}`);
}

// ---- tahap 2: SQL -----------------------------------------------------------------------
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
export function buildSql(manifest) {
  const out = ['-- 0093 — Copy layanan Pedia 3 Nov 2026 (nama/deskripsi dari karakteristik sumber; "Instant Start").',
    '-- Dibuat oleh scripts/generate-pedia-copy-20261103.mjs dari src/lib/pedia/copy-20261103.json.',
    '-- Guard id + supplier + service id + nama/deskripsi lama persis: edit admin tidak ditimpa, idempoten.',
    '-- Hanya pedia_tiers; snapshot pedia_order_items tidak disentuh. Tier 285/svc 5834 tidak diubah.', ''];
  for (const e of manifest.entries) {
    const base = `id=${e.id} AND supplier='indosmm' AND supplier_service_id=${e.sid}`;
    if (e.to !== e.from) {
      out.push(`UPDATE pedia_tiers SET public_name=${q(e.to)}${e.quality ? `, quality=${q(e.quality)}` : ''}, updated_at=datetime('now') WHERE ${base} AND public_name=${q(e.from)};`);
    }
    const pairs = e.desc ? [[e.desc.from, e.desc.to]] : Object.entries(e.descMap ?? {}).map(([from, to]) => [[from], to]);
    for (const [from, to] of pairs) {
      out.push(`UPDATE pedia_tiers SET description_md=${q(to)}, updated_at=datetime('now') WHERE ${base} AND description_md IN (${from.map(q).join(', ')});`);
    }
  }
  return out.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--from-cache')) fromCache();
  else fs.writeFileSync(MIGRATION, buildSql(JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))));
}
