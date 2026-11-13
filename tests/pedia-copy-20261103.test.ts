// Copy layanan Pedia 3 Nov 2026: klasifikasi sumber, manifest → migrasi 0093, dan kebijakan kata.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { buildSql, classifySource, rewriteDescription } from '../scripts/generate-pedia-copy-20261103.mjs';
import { hasInstantStart, refillPromise, serviceTermNames, whiteLabel } from '@/lib/pedia/terms';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

type Entry = { id: number; sid: number; from: string; to: string; quality?: string; desc?: { from: string[]; to: string }; descMap?: Record<string, string> };
const manifest = JSON.parse(readFileSync('src/lib/pedia/copy-20261103.json', 'utf8')) as { entries: Entry[]; skipped: unknown[] };
const migration = readFileSync('drizzle/migrations/0093_pedia_service_copy_20261103.sql', 'utf8');
const byId = new Map(manifest.entries.map((e) => [e.id, e]));

describe('classifySource', () => {
  const c = (name: string) => classifySource(name);
  it('reads the characteristic the source states', () => {
    expect(c('🇮🇩Instagram Followers Indonesia REAL LOOK | 50K | LOW DROP').word).toBe('Real Look');
    expect(c('TikTok Followers [ Max 100K ] | HQ Real People | Non Drop | Instant').word).toBe('Real People');
    expect(c('[CUSTOM] TikTok Comment Indonesia | 1K | Real Human').word).toBe('Real Human');
    expect(c('Instagram Followers | 100% Real Accounts | Non Drop').word).toBe('Real');
    expect(c('Instagram Followers | HQ Accounts with Posts | Low Drop')).toMatchObject({ word: 'HQ', posts: true, hq: true });
    expect(c('Instagram Followers | Old Accounts With Posts | Low Drop')).toMatchObject({ old: true, posts: true, hq: false, word: null });
    expect(c('Instagram Likes | 100% Old Accounts | Drop 0%')).toMatchObject({ old: true, posts: false });
    expect(c('Instagram Followers | 𝐑𝐞𝐚𝐥 𝐏𝐞𝐨𝐩𝐥𝐞 𝐖𝐢𝐭𝐡 𝐏𝐨𝐬𝐭𝐬 | Non Drop')).toMatchObject({ realPeople: true, posts: true });
    expect(c('Telegram Members | 100% Real &amp;amp; Active Users').word).toBe('Real');
  });
  it('treats mixed/bot sources as Campuran, never as Real or HQ', () => {
    for (const name of ['[RANDOM] Tiktok Comment Indonesia | 2K | BOT &amp; REAL', 'Instagram Likes | Mixed Quality | 90 Days', 'Tiktok Save | Indonesia | Mix | Max 5K']) {
      expect(c(name)).toMatchObject({ mix: true, real: false, hq: false, word: null });
    }
  });
  it('does not treat reaction sets, traffic source, active or buzzer as characteristics', () => {
    expect(c('Telegram Reactions | Mix Positive: 👍🤩 | Quality: High').mix).toBe(false);
    expect(c('WhatsApp Reactions | Random Mix [👍❤️] | Instant Start').mix).toBe(false);
    expect(c('YouTube Shorts Views | Source: Mix | Refill: 30 Days').mix).toBe(false);
    expect(c('Threads Likes Indonesia [Buzzer Active]')).toMatchObject({ word: null, real: false, hq: false, mix: false });
    expect(c('Instagram Followers Indonesia Aktif | LOW DROP').word).toBeNull();
    expect(c('Instagram Followers | HQ Accounts | Low Drop').posts).toBe(false);
    expect(c('Telegram Posts Views | 1 Post | Start : 0-1h').posts).toBe(false);
  });
  it('detects Instant Start only as a start fact', () => {
    for (const name of ['Instagram Followers | HQ | Instant Start | Day 500K', 'Twitter Post Views | Start: Instant | Speed: 50K/Day', 'Linkedin Followers | SuperInstant | 30 Days Refill',
      'Youtube Likes | Instant | Day 50K', 'Instagram Likes [Start Time: Instant] [Speed: 100K/Day]', 'X Likes | Ultra Instant Start 🚀', 'Instagram Real Saves | Speed 10K/H | Instant Super Fast!']) {
      expect(c(name).instant, name).toBe(true);
    }
    for (const name of ['Instagram Likes | Instant Refill | Day 500K', 'Instagram Likes | Speed: Instant | 30 Days', 'Instagram Shares [5M] [Instant - 5M / Day]', 'Instagram Followers | Start Time: 0-1 Hour']) {
      expect(c(name).instant, name).toBe(false);
    }
  });
});

describe('manifest', () => {
  it('only touches indosmm tiers, never tier 285 (refill 90 vs 30 stays unresolved)', () => {
    expect(byId.has(285)).toBe(false);
    expect(migration).not.toMatch(/refill_days|terms_md|id=285 /);
    expect(manifest.skipped).toEqual([]);
  });
  it('every changed name is backed by the source and never invents a Start range', () => {
    for (const e of manifest.entries) {
      if (e.to === e.from) continue;
      expect(e.to).not.toMatch(/\b\d+\s*[–-]\s*\d+\s*(?:jam|menit)\b|kelas|label Real|aktif|active|buzzer|supplier|indosmm|penyedia/i);
      expect(e.to.split(' · ').slice(1).join(' ')).not.toMatch(/story/i);
    }
    const t = (id: number) => byId.get(id)!.to;
    expect(t(388)).toBe('Followers Indonesia Real Look');
    expect(t(46)).toBe('Followers Global HQ · Akun berpostingan · Instant Start');
    expect(t(47)).toBe('Followers Global · Akun lama berpostingan · Instant Start');
    expect(t(378)).toBe('Komentar Indonesia · Campuran');
    expect(t(404)).toBe('Likes Post Global · Campuran · Instant Start');
    expect(t(91)).toBe('Saves Video Indonesia · Campuran');
    expect(t(534)).toBe('Komentar Custom Indonesia Real Human');
    expect(manifest.entries.filter((e) => e.to !== e.from && e.to.endsWith('· Instant Start')).length).toBeGreaterThan(90);
    expect(byId.get(378)!.quality).toBe('standar');
  });
  it('descriptions no longer carry the old label wording', () => {
    const texts = manifest.entries.flatMap((e) => [e.desc?.to, ...Object.values(e.descMap ?? {})]).filter(Boolean) as string[];
    expect(texts.length).toBeGreaterThan(40);
    for (const text of texts) expect(text).not.toMatch(/label Real|real\/aktif|menurut (?:label|keterangan)|aktif|active|kelas|supplier|indosmm/i);
    expect(byId.get(388)!.desc!.to).toBe('Followers Instagram Indonesia dari akun Real Look.');
    expect(byId.get(96)!.descMap).toBeTruthy();
    const views = manifest.entries.flatMap((e) => Object.values(e.descMap ?? {})).filter((d) => d.startsWith('Views '));
    expect(views.length).toBeGreaterThanOrEqual(4);
    for (const d of views) expect(d).toMatch(/^Views (?:YouTube|TikTok|Instagram) dari akun Real \(global\)\.$/);
  });
  it('committed migration equals the generator output', () => {
    expect(migration).toBe(buildSql(manifest));
  });
  it('rewriteDescription keeps unknown characteristics out', () => {
    expect(rewriteDescription('Followers dari akun Indonesia, label Real.', { product: 'followers-instagram', region: 'indonesia' }, { word: null })).toBe('Followers Instagram Indonesia.');
    expect(rewriteDescription('Views global, label Real.', { product: 'views-youtube', region: 'global' }, { word: 'Real' })).toBe('Views YouTube dari akun Real (global).');
    expect(rewriteDescription('Likes global, akun real/aktif.', { product: 'likes-tiktok', region: 'global' }, { word: 'Real' })).toBe('Likes TikTok global dari akun Real.');
    expect(rewriteDescription('Tayangan dari sumber yang disarankan menurut keterangan layanan. Perkiraan 20.000.', { product: 'views-youtube', region: 'global' }, {})).toBe('Tayangan dari sumber yang disarankan. Perkiraan 20.000.');
  });
});

describe('migration 0093 in sqlite', () => {
  const setup = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE pedia_tiers(id INTEGER PRIMARY KEY, supplier TEXT, supplier_service_id INTEGER, public_name TEXT, description_md TEXT, quality TEXT, refill_days INTEGER, terms_md TEXT, updated_at TEXT);
      CREATE TABLE pedia_order_items(snapshot_json TEXT);`);
    const ins = db.prepare('INSERT INTO pedia_tiers VALUES (?,?,?,?,?,?,?,?,NULL)');
    for (const e of manifest.entries) {
      const oldDesc = e.desc ? e.desc.from[0] : Object.keys(e.descMap ?? {})[0] ?? 'tidak berubah';
      ins.run(e.id, 'indosmm', e.sid, e.from, oldDesc, 'hq', 30, 'syarat');
    }
    ins.run(285, 'indosmm', 5834, 'Followers Indonesia', 'Followers Indonesia', 'real', 90, 'Refill 90 Days: ajukan refill');
    db.prepare('INSERT INTO pedia_order_items VALUES (?)').run('{"service_copy":{"service_name":"Followers Global HQ","description":"Followers global, label Real."},"refill_days":90}');
    return db;
  };
  const rows = (db: any) => db.prepare('SELECT id, public_name, description_md, quality, refill_days, terms_md, updated_at FROM pedia_tiers ORDER BY id').all();
  it('renames, rewrites and is idempotent; snapshots and tier 285 are untouched', () => {
    const db = setup();
    const snap = db.prepare('SELECT snapshot_json FROM pedia_order_items').get().snapshot_json;
    db.exec(migration);
    const first = rows(db);
    for (const e of manifest.entries) {
      const row = first.find((r: { id: number }) => r.id === e.id);
      expect(row.public_name).toBe(e.to);
      if (e.quality) expect(row.quality).toBe(e.quality);
    }
    expect(first.find((r: { id: number }) => r.id === 388).description_md).toBe('Followers Instagram Indonesia dari akun Real Look.');
    expect(first.find((r: { id: number }) => r.id === 285)).toMatchObject({ public_name: 'Followers Indonesia', refill_days: 90, terms_md: 'Refill 90 Days: ajukan refill', updated_at: null });
    expect(db.prepare('SELECT snapshot_json FROM pedia_order_items').get().snapshot_json).toBe(snap);
    db.exec(migration);
    assert.deepEqual(rows(db), first);
    db.close();
  });
  it('preserves admin edits and ignores a wrong service id', () => {
    const db = setup();
    db.prepare("UPDATE pedia_tiers SET public_name='Nama admin', description_md='Deskripsi admin' WHERE id=388").run();
    db.prepare("UPDATE pedia_tiers SET supplier_service_id=1 WHERE id=46").run();
    db.prepare("UPDATE pedia_tiers SET supplier='legacy_supplier' WHERE id=47").run();
    db.exec(migration);
    const get = (id: number) => db.prepare('SELECT public_name, description_md FROM pedia_tiers WHERE id=?').get(id);
    expect(get(388)).toEqual({ public_name: 'Nama admin', description_md: 'Deskripsi admin' });
    expect(get(46).public_name).toBe(byId.get(46)!.from);
    expect(get(47).public_name).toBe(byId.get(47)!.from);
    db.close();
  });
});

describe('migration 0093 after 0090', () => {
  it('rewrites tier 47 from the real post-0090 text, keeps admin edits, stays idempotent', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE pedia_tiers(id INTEGER PRIMARY KEY, supplier TEXT, supplier_service_id INTEGER, public_name TEXT, description_md TEXT, quality TEXT, updated_at TEXT);
      INSERT INTO pedia_tiers VALUES (47,'indosmm',7887,'Followers Global HQ · Akun lama','Followers Instagram untuk target publik. Pilihan dengan akun berpostingan menurut keterangan layanan.','hq',NULL);`);
    db.exec(readFileSync('drizzle/migrations/0090_pedia_source_copy_20261102.sql', 'utf8'));
    const desc = () => db.prepare('SELECT description_md FROM pedia_tiers WHERE id=47').get().description_md;
    expect(desc()).toBe('Followers Instagram untuk target publik. Akun lama menurut label layanan.');
    db.exec(migration);
    expect(desc()).toBe('Followers Instagram global dari akun lama berpostingan.');
    db.exec(migration);
    expect(desc()).toBe('Followers Instagram global dari akun lama berpostingan.');
    db.exec("UPDATE pedia_tiers SET description_md='Teks admin', public_name='Nama admin' WHERE id=47");
    db.exec(migration);
    expect(db.prepare('SELECT description_md, public_name FROM pedia_tiers WHERE id=47').get()).toEqual({ description_md: 'Teks admin', public_name: 'Nama admin' });
    db.close();
  });
});

describe('buyer wording helpers', () => {
  it('refillPromise honors the real anchor and never invents one', () => {
    expect(refillPromise(30, 'completed')).toBe('Refill 30 hari sejak pesanan selesai, selama layanan masih tersedia.');
    expect(refillPromise(30, 'created')).toBe('Refill 30 hari sejak pesanan dibuat, selama layanan masih tersedia.');
    expect(refillPromise(30)).toBe('Refill 30 hari, selama layanan masih tersedia.');
    expect(refillPromise(30, null)).toBe('Refill 30 hari, selama layanan masih tersedia.');
    expect(refillPromise(3650, 'created')).toBe('Refill selama layanan masih tersedia.');
    expect(refillPromise(0)).toBe('No Refill: jumlah yang drop tidak diisi ulang.');
    expect(refillPromise(30, 'completed')).not.toMatch(/AXVARA/);
  });
  it('whiteLabel cosmetic rules change attribution only, never days or anchors', () => {
    expect(whiteLabel('Refill 30 Days dari AXVARA, sejak pesanan selesai.')).toBe('Refill 30 Days, sejak pesanan selesai.');
    expect(whiteLabel('Refill 90 hari dari AXVARA')).toBe('Refill 90 hari');
    expect(whiteLabel('Tanpa refill dari AXVARA. Penurunan tidak diisi ulang.')).toBe('No Refill. Penurunan tidak diisi ulang.');
    expect(whiteLabel('Followers global, label Real.')).toBe('Followers global, Real.');
    expect(whiteLabel('Followers dari akun Indonesia, label Real.')).not.toMatch(/akun Real/);
    expect(whiteLabel('Label karakter akun pada layanan.')).toBe('');
    const digits = (s: string) => s.match(/\d+/g);
    for (const text of ['Refill 30 Days dari AXVARA, 1× per 24 jam', 'Refill 365 hari dari AXVARA']) expect(digits(whiteLabel(text))).toEqual(digits(text));
  });
  it('maps names to glossary terms and detects Instant Start from the name segment only', () => {
    expect(serviceTermNames('Followers Indonesia Real Look')).toEqual(['Real Look']);
    expect(serviceTermNames('Followers Global Real People · Akun berpostingan · Instant Start')).toEqual(['Real People', 'Akun berpostingan', 'Instant Start']);
    expect(serviceTermNames('Followers Global · Akun lama berpostingan', 'hq')).toEqual(['HQ', 'Akun lama', 'Akun berpostingan']);
    expect(serviceTermNames('Komentar Indonesia · Campuran')).toEqual(['Campuran']);
    expect(hasInstantStart('Followers Global HQ · Instant Start')).toBe(true);
    expect(hasInstantStart('Instant Start Followers')).toBe(false);
  });
});
