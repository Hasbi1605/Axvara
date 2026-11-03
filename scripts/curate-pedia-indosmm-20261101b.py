# scripts/curate-pedia-indosmm-20261101b.py — Perluasan katalog tahap 2 (2026-11-01).
# Reuses the helpers of curate-pedia-indosmm-20261101.py (same scrape in /tmp/indosmm).
# Output: src/lib/pedia/curation-20261101b.json (services not yet mapped in production).
import json, re, collections, html

_src = open('scripts/curate-pedia-indosmm-20261101.py').read()
base = {}
exec(_src[:_src.index('manifest = dict(')], base)  # helpers only; v1 output untouched
rows, region, quality, refill_days, drop_label, norm_time, norm_speed, refill_text, has, AVOID = (
    base[k] for k in ('rows', 'region', 'quality', 'refill_days', 'drop_label', 'norm_time', 'norm_speed', 'refill_text', 'has', 'AVOID'))
descs = {int(k): v for k, v in json.load(open('/tmp/indosmm/descs.json')).items()}
mon = {int(x['service']): x for x in json.load(open('/tmp/indosmm/monitor-api-1.json'))}
for r in rows: r['desc'] = descs.get(r['id'], r.get('desc', ''))
products = {p['slug']: p for p in json.load(open('/tmp/indosmm/axv-products2.json'))[0]['results']}
mapped = {r['sid'] for r in json.load(open('/tmp/indosmm/axv-mapped2.json'))[0]['results']}
prev = json.load(open('src/lib/pedia/curation-20261101.json'))
mapped |= {s['service_id'] for s in prev['services']}
CAP = 30  # pilihan aktif maks per kebutuhan

def field(d, keys):
    for k in keys:
        m = re.search(r'(?im)^[^\w\n]*' + k + r'\s*[:：]\s*(.+)$', d or '')
        if m: return m.group(1).strip()
    return None
def health(r):
    if not r['orders7']: return 'no-data'
    if r['orders7'] >= 10 and (r['succ7'] or 0) >= 95 and (r['cancel7'] or 100) <= 5 and (r['score7'] or 0) >= 80: return 'sehat'
    if (r['succ7'] or 0) >= 85 and (r['score7'] or 0) >= 65: return 'cukup'
    return 'berisiko'
def droprisk(r):
    rr = r['refill7']
    return 'sedang' if rr is None or not r['orders7'] else 'rendah' if rr <= 2 else 'sedang' if rr <= 8 else 'tinggi'
def duration(r):
    m = re.search(r'(?i)(\d{1,4})\s*(?:minutes?|menit|mins?)\b', r['name'])
    return f"{m.group(1)} menit" if m else None

GENDER = r'female|male|wanita|pria|usa|brazil|arab|turkey|russia|india\b|vietnam|kore|japan|thai'
FILL = {  # slug: (include, exclude)
    'followers-instagram': (r'instagram.*followers', r'likes|views|reel|channel|thread'),
    'likes-instagram': (r'instagram.*likes', r'followers|views|story|comment|save|share'),
    'views-reels-instagram': (r'instagram.*(video|reel)s? views|instagram.*views', r'followers|likes|profile|visit|story|save'),
    'views-story-instagram': (r'instagram.*stor(y|ies).*view', r'likes|poll|vote|link'),
    'likes-story-instagram': (r'instagram.*stor(y|ies).*like', r'views'),
    'saves-instagram': (r'instagram.*save', r'followers|likes'),
    'shares-instagram': (r'instagram.*share', r'followers|likes'),
    'repost-instagram': (r'instagram.*repost', r'likes'),
    'visits-instagram': (r'instagram.*(profile visit|visit)', r'likes'),
    'followers-tiktok': (r'tiktok.*followers', r'likes|views|live'),
    'likes-tiktok': (r'tiktok.*likes', r'followers|views|comment|live'),
    'views-tiktok': (r'tiktok.*views', r'followers|likes|profile|live|watch'),
    'saves-tiktok': (r'tiktok.*(save|favorite|favourite)', r'followers'),
    'shares-tiktok': (r'tiktok.*share', r'followers|live'),
    'repost-tiktok': (r'tiktok.*repost', r'likes'),
    'views-youtube': (r'youtube.*views', r'short|likes|subscri|live|watch'),
    'views-shorts-youtube': (r'youtube.*short.*views', r'likes'),
    'likes-youtube': (r'youtube.*likes', r'short|comment|subscri'),
    'likes-shorts-youtube': (r'youtube.*short.*likes', r'views'),
    'subscriber-youtube': (r'youtube.*subscri', r'likes|views'),
    'shares-youtube': (r'youtube.*share', r'likes'),
    'followers-facebook': (r'facebook.*followers', r'group|likes'),
    'likes-facebook': (r'facebook.*(post )?likes', r'page|video|reel|followers|comment'),
    'views-facebook': (r'facebook.*(video|reel)s? views', r'followers|likes|live'),
    'members-group-facebook': (r'facebook.*group.*member', r'likes'),
    'share-post-facebook': (r'facebook.*share', r'video|reel'),
    'members-telegram': (r'telegram.*(members|subscribers)', r'reaction|views'),
    'views-telegram': (r'telegram.*views', r'reaction|members|story'),
    'reactions-telegram': (r'telegram.*reaction', r'members'),
    'share-telegram': (r'telegram.*share', r'members'),
    'followers-shopee': (r'shopee.*follow', r'like|views|live'),
    'likes-product-shopee': (r'shopee.*like', r'follow|live'),
    'likes-x': (r'(twitter|x\.com|\bx\b).*likes', r'followers|comment'),
    'views-x': (r'(twitter|x\.com|\bx\b).*(views|impression)', r'followers|likes'),
    'followers-x': (r'(twitter|x\.com|\bx\b).*followers', r'likes'),
    'repost-x': (r'(twitter|x\.com|\bx\b).*(retweet|repost)', r'likes'),
    'likes-threads': (r'threads.*likes', r'followers'),
    'followers-threads': (r'threads.*followers', r'likes'),
    'members-whatsapp': (r'whatsapp.*(members|followers)', r'reaction'),
    'reactions-whatsapp': (r'whatsapp.*reaction', r'members'),
    'plays-spotify': (r'spotify.*(plays|streams)', r'playlist|follow'),
}
LIVE = r'\blive\b'
NEW = {
    'views-live-tiktok': dict(platform='tiktok', metric='views', target_kind='profile', name='Live Views TikTok', include=r'tiktok.*live.*(views|stream|broadcast)|tiktok.*live stream', exclude=r'likes|comment|share', packages=[50, 100, 200, 250, 500, 1000, 2000, 5000, 10000], live=True,
        desc='Penonton live TikTok. Pesan saat sedang live; penonton masuk selama durasi layanan.', instr='1. Mulai live TikTok lebih dulu.\n2. Tempel link profil TikTok (tiktok.com/@username) yang sedang live.'),
    'likes-live-tiktok': dict(platform='tiktok', metric='likes', target_kind='profile', name='Live Likes TikTok', include=r'tiktok.*live.*like', exclude=r'views|comment', packages=[100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000], live=True,
        desc='Likes (tap) untuk live TikTok yang sedang berjalan.', instr='1. Mulai live TikTok lebih dulu.\n2. Tempel link profil TikTok (tiktok.com/@username) yang sedang live.'),
    'views-live-youtube': dict(platform='youtube', metric='views', target_kind='video', name='Live Views YouTube', include=r'youtube.*live', exclude=r'likes|comment|chat', packages=[50, 100, 200, 500, 1000, 2000, 5000, 10000], live=True,
        desc='Penonton live stream YouTube (concurrent) selama durasi layanan.', instr='1. Mulai live stream YouTube lebih dulu.\n2. Tempel link video live (youtube.com/watch?v=…).'),
    'views-live-facebook': dict(platform='facebook', metric='views', target_kind='video', name='Live Views Facebook', include=r'facebook.*live', exclude=r'likes|comment|reaction', packages=[50, 100, 200, 500, 1000, 2000, 5000], live=True,
        desc='Penonton live Facebook selama durasi layanan.', instr='1. Mulai live Facebook lebih dulu.\n2. Tempel link video live Facebook.'),
    'views-live-shopee': dict(platform='shopee', metric='views', target_kind='live', name='Live Views Shopee', include=r'shopee.*live', exclude=r'likes|comment|follow', packages=[20, 50, 100, 200, 500, 1000, 2000, 5000], live=True,
        desc='Penonton Shopee Live selama durasi layanan, untuk meramaikan sesi jualan.', instr='1. Mulai Shopee Live lebih dulu.\n2. Bagikan live, lalu tempel link live.shopee.co.id/share?…session=… .'),
    'watchtime-tiktok': dict(platform='tiktok', metric='views', target_kind='video', name='Watchtime Views TikTok', include=r'tiktok.*watch ?(time|hour)', exclude=r'live', packages=[100, 200, 500, 1000, 2000, 5000, 10000],
        desc='Views TikTok dengan durasi tonton lebih lama (high retention).', instr='1. Buka video TikTok target, lalu salin link lengkapnya.'),
    'comments-custom-instagram': dict(platform='instagram', metric='comments', target_kind='post', name='Komentar Custom Instagram', include=r'instagram.*comment', exclude=r'like|mention|reply|live|story', packages=[1, 5, 10, 20, 25, 50, 100, 200], custom=True,
        desc='Komentar Instagram dengan isi yang kamu tulis sendiri, satu komentar per baris.', instr='1. Buka postingan/reel target, lalu salin link lengkapnya.\n2. Tulis komentar di kolom yang disediakan, satu per baris.'),
    'comments-custom-tiktok': dict(platform='tiktok', metric='comments', target_kind='video', name='Komentar Custom TikTok', include=r'tiktok.*comment', exclude=r'like|mention|reply|live', packages=[1, 5, 10, 20, 25, 50, 100, 200], custom=True,
        desc='Komentar TikTok dengan isi yang kamu tulis sendiri, satu komentar per baris.', instr='1. Buka video TikTok target, lalu salin link lengkapnya.\n2. Tulis komentar di kolom yang disediakan, satu per baris.'),
    'comments-custom-youtube': dict(platform='youtube', metric='comments', target_kind='video', name='Komentar Custom YouTube', include=r'youtube.*comment', exclude=r'like|mention|reply|live', packages=[1, 5, 10, 20, 25, 50, 100, 200], custom=True,
        desc='Komentar YouTube dengan isi yang kamu tulis sendiri, satu komentar per baris.', instr='1. Buka video YouTube target, lalu salin link lengkapnya.\n2. Tulis komentar di kolom yang disediakan, satu per baris.'),
    'comments-custom-facebook': dict(platform='facebook', metric='comments', target_kind='post', name='Komentar Custom Facebook', include=r'facebook.*comment', exclude=r'like|mention|reply|live', packages=[1, 5, 10, 20, 25, 50, 100, 200], custom=True,
        desc='Komentar Facebook dengan isi yang kamu tulis sendiri, satu komentar per baris.', instr='1. Buka postingan Facebook target, lalu salin link lengkapnya.\n2. Tulis komentar di kolom yang disediakan, satu per baris.'),
}

def candidates(include, exclude, live=False, custom=False):
    typ = 'Custom Comments' if custom else 'Default'
    out = []
    for r in rows:
        if r['id'] in mapped or mon[r['id']]['type'] != typ or health(r) not in ('sehat', 'cukup'): continue
        if not has(r, include) or has(r, exclude) or has(r, GENDER): continue
        if not live and has(r, LIVE): continue
        if not custom and not live and has(r, AVOID): continue
        if r['rate'] <= 0 or r['min'] <= 0 or r['max'] < r['min']: continue
        out.append(r)
    return out

def pick(cands, n):
    cands = sorted(cands, key=lambda r: (-(r['score7'] or 0), r['rate']))
    sig, chosen = set(), []
    for r in cands:
        k = (region(r), quality(r), refill_days(r), drop_label(r), duration(r), min(r['max'], 100_000_000))
        if k in sig: continue
        sig.add(k); chosen.append(r)
        if len(chosen) >= n: break
    return chosen

QLAB = {'real': 'Real', 'hq': 'HQ', 'ekonomis': 'Ekonomis', 'standar': ''}
DROP_LINE = {'no_drop': 'No Drop: saat ini belum terlihat drop, tetapi drop tetap bisa terjadi.',
             'less_drop': 'Less Drop: bisa drop sedikit, dan masih mungkin drop lebih banyak nanti.',
             'high_drop': 'High Drop: drop besar. Pilih hanya bila menerima risikonya.',
             'unknown': 'Belum ada label drop; anggap drop bisa terjadi.'}

def service(slug, metric, r, idx, packages, instructions, custom=False, live=False):
    d = refill_days(r); dl = drop_label(r); reg = region(r); q = quality(r); dur = duration(r)
    lo, hi = r['min'], min(r['max'], 200 if custom else 100_000_000)
    if lo > hi or not any(lo <= p <= hi for p in packages): return None
    lead = 'Indonesia' if reg == 'indonesia' else 'Global'
    name = ' '.join(x for x in [lead, QLAB[q]] if x) + (f' · {dur}' if dur else '') + f' · {refill_text(d)}' + (f" · {DROP_LINE[dl].split(':')[0]}" if dl != 'unknown' else '')
    nm = r['name']
    ms = re.search(r'(?i)start(?: time)?\s*[:：]?\s*([^\]\|]+?)\s*(?:\]|\||$)', nm)
    mp = re.search(r'(?i)speed\s*[:：]?\s*([^\]\|]+?)\s*(?:\]|\||$)', nm)
    start = norm_time(field(r['desc'], ['start', 'start time']) or (ms.group(1) if ms else None))
    speed = None if live else norm_speed(field(r['desc'], ['speed']) or (mp.group(1) if mp else None))
    refill_line = 'No Refill: jumlah yang drop tidak diisi ulang.' if d <= 0 else f"{refill_text(d)}: ajukan refill di halaman Refill Pedia selama masa refill sejak pesanan dibuat, 1× per 24 jam. " + ('Refill diproses otomatis.' if r['api_refill'] else 'Refill diproses admin, biasanya dalam 1×24 jam.')
    extra = [f'Penonton bertahan sekitar {dur}. Pesan saat live sudah berjalan; live yang berakhir lebih cepat tidak bisa diulang.'] if live and dur else ['Pesan saat live sudah berjalan; live yang berakhir lebih cepat tidak bisa diulang.'] if live else []
    if custom: extra = ['Jumlah pesanan = jumlah komentar. Tulis satu komentar per baris; komentar yang melanggar aturan platform bisa dihapus platform.']
    terms = '\n'.join([f"Jumlah per pesanan {lo:,}–{hi:,}.".replace(',', '.'), *extra, refill_line, DROP_LINE[dl],
                       'Target harus publik. Jangan mengganti link, membuat target privat, atau menghapus target selama proses.',
                       'Tunggu pesanan sebelumnya untuk target yang sama selesai sebelum memesan kembali.',
                       'Start time dan speed dapat berubah mengikuti antrean.'])
    desc = ('Komentar custom' if custom else ('Penonton live' if live else metric.title())) + (' dari akun Indonesia' if reg == 'indonesia' else ' global') + {'real': ', akun Real', 'hq': ', akun HQ', 'ekonomis': ', pilihan ekonomis', 'standar': ''}[q] + '.'
    return dict(product_slug=slug, supplier='indosmm', service_id=r['id'], public_name=name[:200], description=desc, terms=terms, instructions=instructions,
                region=reg, quality=q, refill_days=d, eta_start=start, speed_per_day=speed, drop_label=dl, drop_risk=droprisk(r),
                input_kind='comments' if custom else None, min_qty_override=lo, max_qty_override=hi, quantity_step=1, sort_order=200 + idx,
                evidence=dict(orders_7d=r['orders7'], success_rate=r['succ7'], refill_rate=r['refill7'], ai_score=r['score7'], api_refill=r['api_refill'], supplier_name=html.unescape(r['name'])[:160]))

out = dict(generated='2026-11-01', supplier='indosmm', new_products=[], services=[])
used = set()
existing_instr = {s['product_slug']: s['instructions'] for s in prev['services']}
for slug, (inc, exc) in FILL.items():
    p = products.get(slug)
    if not p: continue
    room = CAP - int(p['n']) - sum(1 for s in prev['services'] if s['product_slug'] == slug)
    if room <= 0: continue
    pk = json.loads(p['packages_json'])
    for i, r in enumerate(pick([c for c in candidates(inc, exc) if c['id'] not in used], room)):
        s = service(slug, p['metric'], r, i, pk, existing_instr.get(slug, '1. Buka target lalu salin link lengkapnya.'))
        if s: out['services'].append(s); used.add(r['id'])
for slug, np in NEW.items():
    if slug in products: continue
    svc = []
    for i, r in enumerate(pick([c for c in candidates(np['include'], np['exclude'], np.get('live', False), np.get('custom', False)) if c['id'] not in used], 8)):
        s = service(slug, np['metric'], r, i, np['packages'], np['instr'], np.get('custom', False), np.get('live', False))
        if s: svc.append(s); used.add(r['id'])
    if not svc: continue
    out['new_products'].append(dict(slug=slug, platform=np['platform'], metric=np['metric'], target_kind=np['target_kind'], name=np['name'], description=np['desc'],
        checklist=[{"id": "public", "label": "Target saya dapat diakses publik."}, {"id": "stable", "label": "Saya tidak mengubah atau menghapus target selama proses."}] + ([{"id": "live", "label": "Live sudah berjalan saat saya memesan."}] if np.get('live') else []),
        packages=np['packages']))
    out['services'] += svc
# Unique short names within each product.
byp = collections.defaultdict(list)
for s in out['services'] + [x for x in prev['services']]: byp[s['product_slug']].append(s)
fmt = lambda n: f'{n/1_000_000:g}M' if n >= 1_000_000 else f'{n/1000:g}K' if n >= 1000 else str(n)
for slug, lst in byp.items():
    mine = [s for s in lst if s in out['services']]
    for step in ('max', 'speed', 'opsi'):
        names = collections.Counter(s['public_name'] for s in lst)
        seen = collections.Counter()
        for s in mine:
            if names[s['public_name']] <= 1: continue
            if step == 'max': s['public_name'] += f" · Max {fmt(s['max_qty_override'])}"
            elif step == 'speed' and s.get('speed_per_day'): s['public_name'] += f" · {s['speed_per_day']}"
            elif step == 'opsi': seen[s['public_name']] += 1; s['public_name'] += f" · Opsi {seen[s['public_name']]}"
for s in out['services']:
    for k in ('public_name', 'description', 'terms', 'instructions'):
        assert not re.search(r'supplier|indosmm|providersmm|penyedia', s[k], re.I), (s['service_id'], k)
json.dump(out, open('src/lib/pedia/curation-20261101b.json', 'w'), ensure_ascii=False, indent=1)
c = collections.Counter(s['product_slug'] for s in out['services'])
print('services', len(out['services']), 'new products', [p['slug'] for p in out['new_products']])
for k, v in sorted(c.items()): print(f'  {k:28} +{v}')
