#!/usr/bin/env python3
"""Nama layanan Pedia seragam + perapian layanan kembar (owner 2026-11-02).

Input : ekspor baca-saja tier aktif produksi (lihat docs/pedia/service-naming-2026-11-02.md)
        /tmp/prod-tiers.json (join produk + supplier + statistik) dan
        /tmp/prod-tiers2.json (public_name/label_note/pemakaian order).
Output: src/lib/pedia/names-20261102.json (manifest yang di-commit) dan
        drizzle/migrations/0089_pedia_service_names_20261102.sql.

Aturan nama: [Metrik] [Wilayah] [Kualitas] (+ " · Keterangan" bila nama lama
membawa pembeda bermakna, mis. "Referrer Google"). Refill/drop TIDAK masuk nama
(sudah chip). "Ekonomis", "Max N", "Mulai N" dibuang.

Perapian: per produk, satu layanan per (wilayah, masa refill, kualitas,
keterangan, input). Pemenang: success rate terukur (≥5 order/7 hari) tertinggi,
lalu jumlah order, lalu modal termurah. Tier yang pernah dipakai order tetap
boleh nonaktif (riwayat order memakai snapshot).
"""
import json, re, collections, sys

rows = json.load(open('/tmp/prod-tiers.json'))[0]['results']
extra = {r['id']: r for r in json.load(open('/tmp/prod-tiers2.json'))[0]['results']}

PLATFORM_WORDS = {'instagram', 'tiktok', 'youtube', 'facebook', 'telegram', 'shopee', 'spotify', 'x', 'threads',
                  'whatsapp', 'linkedin', 'lazada', 'pinterest', 'reddit', 'twitch', 'kick', 'roblox', 'github',
                  'soundcloud', 'audiomack', 'mixcloud', 'tidal', 'reverbnation', 'vimeo', 'rumble', 'rutube',
                  'tumblr', 'medium', 'dribbble', 'coub', 'coinmarketcap'}
REPL = [(r'\bTayangan\b', 'Views'), (r'\bSubscriber\b', 'Subscribers'), (r'\bPostingan\b', 'Post'),
        (r'\bRe-up\b', 'Repost')]
TARGET_NOUN = {'post': 'Post', 'video': 'Video', 'reel': 'Reels'}
BARE = {'Likes', 'Views', 'Saves', 'Share'}
REGION = {'global': 'Global', 'indonesia': 'Indonesia', 'mixed': 'Campuran'}
QUALITY = {'real': 'Real', 'hq': 'HQ'}

# Kata yang sudah terwakili oleh metrik/wilayah/kualitas/chip → bukan keterangan.
KNOWN = {w.lower() for w in '''Followers Likes Views Tayangan Saves Share Shares Repost Reposts Members Subscriber
Subscribers Komentar Custom Reactions Reaksi Plays Live Watchtime Story Reels Reel Post Postingan Video Shorts Global
Indonesia Campuran HQ Real Ekonomis Standar Murah Stabil Fans Koneksi Bookmarks Kunjungan profil Traffic Website
Pendengar Bulanan Fork Repository Toko Perusahaan Channel Grup Halaman Lagu Playlist Album Board Pin Profil Shot
Produk Artikel Re-up Likes'''.split()} | PLATFORM_WORDS
NOISE = re.compile(r'^(?:Refill\s+(?:\d+\s+(?:hari|Days)|Lifetime)|No Refill(?: AXVARA)?|Tanpa refill|No Drop|Less Drop|'
                   r'High Drop|Ekonomis|Murah|Max\s+[\d.,]+\s*[KM]?|Mulai\s+[\d.,]+.*|Kelipatan\s+[\d.,]+|'
                   r'Opsi\s+\d+|Paket umum|[\d.,]+[KM]?/hari|Global|Indonesia|HQ|Real)$', re.I)


def base_name(p):
    words = p['pname'].split()
    if len(words) > 1 and words[-1].lower() in PLATFORM_WORDS:
        words = words[:-1]
    name = ' '.join(words)
    for a, b in REPL:
        name = re.sub(a, b, name)
    if name in BARE and p['target_kind'] in TARGET_NOUN:
        name = f"{name} {TARGET_NOUN[p['target_kind']]}"
    return name


def descriptor(old):
    parts = [x.strip() for x in old.split('·')]
    head = [w for w in re.split(r'\s+', parts[0]) if w and w.lower().strip(',') not in KNOWN]
    rest = [x for x in parts[1:] if x and not NOISE.match(x)]
    bits = ([' '.join(head)] if head else []) + rest
    d = ' · '.join(bits).strip()
    return d[:1].upper() + d[1:] if d else ''


out, groups = [], collections.defaultdict(list)
for r in rows:
    e = extra[r['id']]
    old = e['public_name'] or e['label_note'] or r['pname']
    base = base_name(r)
    desc = ' '.join(w for w in descriptor(old).split(' ') if w.lower() not in {b.lower() for b in base.split()})
    desc = re.sub(r'^(?:Berpostingan)$', 'Akun berpostingan', desc[:1].upper() + desc[1:] if desc else '')
    name = ' '.join(x for x in [base, REGION.get(r['region'] or 'global', 'Global'), QUALITY.get(r['quality'], '')] if x)
    if desc:
        name = f'{name} · {desc}'
    item = dict(id=r['id'], product=r['slug'], old=old, new=name[:120], region=r['region'], refill=r['refill_days'],
                quality=QUALITY.get(r['quality'], 'standar'), input=r['input_kind'] or '', success=r['success_rate'],
                orders=r['orders_7d'] or 0, rate=r['rate'] or 0, used=e['used'])
    out.append(item)
    groups[(r['product_id'], r['region'], r['refill_days'], item['quality'], desc, item['input'])].append(item)


def rank(x):
    measured = x['success'] if (x['success'] is not None and x['orders'] >= 5) else -1
    return (-measured, -x['orders'], x['rate'], x['id'])


keep, drop = [], []
for g in groups.values():
    g.sort(key=rank)
    keep.append(g[0])
    drop.extend(g[1:])

manifest = {'source': 'prod pedia_tiers aktif 2026-11-02 (baca-saja)', 'rename': sorted(
    [{k: x[k] for k in ('id', 'product', 'old', 'new')} for x in keep if x['old'] != x['new']], key=lambda x: x['id']),
    'deactivate': sorted([{k: x[k] for k in ('id', 'product', 'old')} for x in drop], key=lambda x: x['id'])}
json.dump(manifest, open('src/lib/pedia/names-20261102.json', 'w'), ensure_ascii=False, indent=1)


def q(s):
    return "'" + s.replace("'", "''") + "'"


sql = ['-- 0089 — Nama layanan Pedia seragam + nonaktifkan layanan kembar (owner 2026-11-02).',
       '-- Dibuat oleh scripts/curate-pedia-names-20261102.py dari ekspor baca-saja produksi.',
       '-- Guard nama lama: perubahan admin sesudah ekspor tidak ditimpa. Idempoten.', '']
for x in manifest['deactivate']:
    sql.append(f"UPDATE pedia_tiers SET is_active=0, updated_at=datetime('now') WHERE id={x['id']} AND is_active=1 AND COALESCE(public_name,label_note)={q(x['old'])};")
for x in manifest['rename']:
    sql.append(f"UPDATE pedia_tiers SET public_name={q(x['new'])}, updated_at=datetime('now') WHERE id={x['id']} AND COALESCE(public_name,label_note)={q(x['old'])};")
open('drizzle/migrations/0089_pedia_service_names_20261102.sql', 'w').write('\n'.join(sql) + '\n')
print(f"active {len(out)} → keep {len(keep)}, deactivate {len(drop)}, rename {len(manifest['rename'])}", file=sys.stderr)
