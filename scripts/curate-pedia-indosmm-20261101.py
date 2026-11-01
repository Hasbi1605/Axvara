# /tmp/indosmm/curate.py — selects IndoSMM services for AXVARA Pedia (2026-11-01).
# Input: scraped read-only data (services+descriptions+7-day stats). Output: manifest JSON.
import json, re, collections, html

rows = json.load(open('/tmp/indosmm/scored.json'))
products = {p['slug']: p for p in json.load(open('/tmp/indosmm/axv-products.json'))[0]['results']}
conv = json.load(open('/tmp/indosmm/axv-conv.json'))[0]['results']
instr = {}
for c in conv:
    if c['instructions_md'] and c['slug'] not in instr:
        lines = [l for l in c['instructions_md'].split('\n') if l.strip()][:2]
        instr[c['slug']] = '\n'.join(lines)

L = lambda s: s.lower()
def has(r, pat): return re.search(pat, L(r['name']), re.I) is not None

AVOID = r'auto |auto-|future|subscription|story|live|comment|custom|mention|poll|vote|premiere|stream|\btv\b|igtv only|package|paket|bundle|targeted|country|gender|female|male|wanita|pria|usa|brazil|arab|turkey|russia|india\b|vietnam|kore|japan|thai'
RULES = {
    # slug: (include, extra-exclude)
    'followers-instagram':  (r'instagram.*followers|followers.*instagram', r'likes|views|reel|channel|thread'),
    'likes-instagram':      (r'instagram.*likes|likes.*instagram', r'followers|views|reel views|save|share|impression only'),
    'views-reels-instagram':(r'instagram.*(video|reel)s? views|instagram.*views', r'followers|likes|profile|visit|impression only|save'),
    'saves-instagram':      (r'instagram.*save', r'followers|likes'),
    'shares-instagram':     (r'instagram.*share', r'followers|likes'),
    'followers-tiktok':     (r'tiktok.*followers', r'likes|views'),
    'likes-tiktok':         (r'tiktok.*likes', r'followers|views|comment'),
    'views-tiktok':         (r'tiktok.*views', r'followers|likes|profile'),
    'saves-tiktok':         (r'tiktok.*(save|favorite|favourite)', r'followers'),
    'shares-tiktok':        (r'tiktok.*share', r'followers'),
    'views-youtube':        (r'youtube.*views', r'short|likes|subscri'),
    'likes-youtube':        (r'youtube.*likes', r'short|comment|subscri'),
    'subscriber-youtube':   (r'youtube.*subscri', r'likes|views'),
    'followers-facebook':   (r'facebook.*followers', r'group|likes'),
    'likes-facebook':       (r'facebook.*(post )?likes', r'page|video|reel|followers|comment'),
    'views-facebook':       (r'facebook.*(video|reel)s? views', r'followers|likes'),
    'members-telegram':     (r'telegram.*(members|subscribers)', r'reaction|views'),
    'views-telegram':       (r'telegram.*views', r'reaction|members'),
    'reactions-telegram':   (r'telegram.*reaction', r'members'),
    'followers-shopee':     (r'shopee.*follow', r'like|views'),
    'likes-x':              (r'(twitter|x\.com|\bx\b).*likes', r'followers|comment'),
    'views-x':              (r'(twitter|x\.com|\bx\b).*(views|impression)', r'followers|likes|video views only'),
    'followers-x':          (r'(twitter|x\.com|\bx\b).*followers', r'likes'),
    'likes-threads':        (r'threads.*likes', r'followers'),
    'followers-threads':    (r'threads.*followers', r'likes'),
    'members-whatsapp':     (r'whatsapp.*(members|followers)', r'reaction'),
}
# New products: random comments only need a post link (custom text is out of scope).
NEW_PRODUCTS = {
    'comments-instagram': dict(platform='instagram', metric='comments', target_kind='post', name='Komentar Instagram', include=r'instagram.*comment', exclude=r'custom|likes|mention|reply', packages=[5,10,20,25,50,100,200,250,500,1000]),
    'comments-tiktok':    dict(platform='tiktok', metric='comments', target_kind='video', name='Komentar TikTok', include=r'tiktok.*comment', exclude=r'custom|likes|mention|reply', packages=[5,10,20,25,50,100,200,250,500,1000]),
    'comments-youtube':   dict(platform='youtube', metric='comments', target_kind='video', name='Komentar YouTube', include=r'youtube.*comment', exclude=r'custom|likes|mention|reply', packages=[5,10,20,25,50,100,200,250,500,1000]),
    'comments-facebook':  dict(platform='facebook', metric='comments', target_kind='post', name='Komentar Facebook', include=r'facebook.*comment', exclude=r'custom|likes|mention|reply', packages=[5,10,20,25,50,100,200,250,500,1000]),
}

def region(r):
    t = L(r['name'] + ' ' + r['cat'])
    return 'indonesia' if re.search(r'indo|🇮🇩|lokal', t) else 'global'
def quality(r):
    t = L(r['name'] + ' ' + (r.get('d_quality') or ''))
    if re.search(r'\breal\b|aktif|active|human', t): return 'real'
    if re.search(r'\bhq\b|high quality|premium|old account|with posts?', t): return 'hq'
    if re.search(r'cheap|murah|termurah|\bbot\b|\bmq\b|low quality|ekonomis', t): return 'ekonomis'
    return 'standar'
def refill_days(r):
    v = L(r.get('d_refill') or '')
    n = L(r['name'])
    if 'no refill' in v or re.search(r'no ?refill|\bnr\b|non[- ]?refill|refill: ?no', n): return 0
    if 'lifetime' in v or 'lifetime' in n: return 3650
    m = re.search(r'(\d{1,3})\s*(?:d|day|days|hari)', v) or re.search(r'(?:refill|r)\s*[:\[]?\s*(\d{1,3})\s*(?:d\b|day|days|hari)', n) or re.search(r'(\d{1,3})\s*days?\s*♻', n)
    return int(m.group(1)) if m else 0
def drop_label(r):
    t = L(r['name'] + ' ' + r.get('desc', ''))
    if re.search(r'high drop|drop tinggi|drop rate\s*:?\s*high', t): return 'high_drop'
    if re.search(r'low drop|less drop|minim drop|drop 0-\d+%|drop rate\s*:?\s*(low|\d%)', t): return 'less_drop'
    if re.search(r'non[- ]?drop|no[- ]?drop|zero ?drop|nodrop|drop\s*:\s*no\b|0% drop|tidak drop', t): return 'no_drop'
    return 'unknown'
def norm_time(v):
    if not v: return None
    v = v.strip().strip('.')
    v = re.sub(r'(?i)\binstant\b', 'Instan', v)
    v = re.sub(r'(?i)(\d+)\s*-\s*(\d+)\s*(h|hrs?|hours?|jam)\b', r'\1–\2 jam', v)
    v = re.sub(r'(?i)(\d+)\s*-\s*(\d+)\s*(m|mins?|minutes?|menit)\b', r'\1–\2 menit', v)
    v = re.sub(r'(?i)(\d+)\s*(h|hrs?|hours?)\b', r'\1 jam', v)
    v = re.sub(r'(?i)(\d+)\s*(mins?|minutes?)\b', r'\1 menit', v)
    return v[:40]
def norm_speed(v):
    if not v: return None
    v = v.strip().strip('.')
    v = re.sub(r'(?i)\s*(?:/|\bper\b)?\s*(days?|d|hari)\b', '/hari', v)
    v = re.sub(r'(?i)\bp/d\b', '/hari', v)
    v = re.sub(r'(?i)\s*per\s*(day|hari)\b', '/hari', v)
    v = re.sub(r'(?i)/\s*(hours?|hr|jam)\b', '/jam', v)
    return v[:40]

METRIC = {'followers':'Followers','likes':'Likes','views':'Views','saves':'Saves','shares':'Shares','subscribers':'Subscribers','members':'Members','reactions':'Reactions','comments':'Komentar'}
QUALITY = {'real':'Real','hq':'HQ','ekonomis':'Ekonomis','standar':''}
DROP = {'no_drop':'No Drop','less_drop':'Less Drop','high_drop':'High Drop','unknown':''}
def refill_text(d): return 'No Refill' if d <= 0 else 'Refill Lifetime' if d >= 3650 else f'Refill {d} Days'

def candidates(include, exclude, avoid=AVOID):
    out = []
    for r in rows:
        if r['mapped'] or r['health'] not in ('sehat', 'cukup'): continue
        if not has(r, include) or has(r, exclude) or has(r, avoid): continue
        if r['rate'] <= 0 or r['min'] <= 0 or r['max'] < r['min']: continue
        out.append(r)
    return out

def pick(cands, n=6):
    """Spread choices: Indonesia/Global × refill/no refill × drop level, best AI score first."""
    cands = sorted(cands, key=lambda r: (-(r['score7'] or 0), r['rate']))
    # Near-identical offers (same region/quality/refill/drop label/max) add clutter, not choice.
    sig, uniq = set(), []
    for r in cands:
        k = (region(r), quality(r), refill_days(r), drop_label(r), min(r['max'], 100_000_000))
        if k not in sig: sig.add(k); uniq.append(r)
    cands = uniq
    chosen, buckets = [], set()
    for r in cands:
        b = (region(r), refill_days(r) > 0, r['droprisk'])
        if b in buckets: continue
        buckets.add(b); chosen.append(r)
        if len(chosen) >= n: break
    for r in cands:
        if len(chosen) >= n: break
        if r not in chosen: chosen.append(r)
    return chosen

def service(slug, metric, r, idx, packages, instructions, mode_api):
    d = refill_days(r); dl = drop_label(r); reg = region(r); q = quality(r)
    lo, hi = r['min'], min(r['max'], 100_000_000)
    if not any(lo <= p <= hi for p in packages): return None
    parts = [METRIC.get(metric, metric.title()), 'Indonesia' if reg == 'indonesia' else 'Global']
    if QUALITY[q]: parts.append(QUALITY[q])
    name = ' '.join(parts) + f' · {refill_text(d)}' + (f' · {DROP[dl]}' if DROP[dl] else '')
    nm = r['name']
    ms = re.search(r'(?i)start(?: time)?\s*[:：]?\s*([^\]\|]+?)\s*(?:\]|\||$)', nm)
    mp = re.search(r'(?i)speed\s*[:：]?\s*([^\]\|]+?)\s*(?:\]|\||$)', nm) or re.search(r'(?i)day\s+(\d+[km]?)\b', nm)
    start = norm_time(r.get('d_start') or (ms.group(1) if ms else None))
    speed = norm_speed(r.get('d_speed') or ((mp.group(1) + ('/hari' if mp.re.pattern.startswith('(?i)day') else '')) if mp else None))
    desc = f"{METRIC.get(metric, metric)} {'dari akun Indonesia' if reg == 'indonesia' else 'global'}"
    desc += {'real': ', akun real/aktif', 'hq': ', akun HQ', 'ekonomis': ', pilihan ekonomis', 'standar': ''}[q] + '.'
    refill_line = ('No Refill: jumlah yang drop tidak diisi ulang.' if d <= 0 else
                   f"{refill_text(d)}: ajukan refill di halaman Refill Pedia selama masa refill sejak pesanan dibuat, 1× per 24 jam. " +
                   ('Refill diproses otomatis.' if mode_api else 'Refill diproses admin, biasanya dalam 1×24 jam.'))
    drop_line = {'no_drop': 'No Drop: saat ini belum terlihat drop, tetapi drop tetap bisa terjadi.',
                 'less_drop': 'Less Drop: bisa drop sedikit, dan masih mungkin drop lebih banyak nanti.',
                 'high_drop': 'High Drop: drop besar. Pilih hanya bila menerima risikonya.',
                 'unknown': 'Belum ada label drop; anggap drop bisa terjadi.'}[dl]
    terms = '\n'.join([f"Jumlah per pesanan {lo:,}–{hi:,}.".replace(',', '.'), refill_line, drop_line,
                       'Target harus publik. Jangan mengganti link, membuat target privat, atau menghapus target selama proses.',
                       'Tunggu pesanan sebelumnya untuk target yang sama selesai sebelum memesan kembali.',
                       'Start time dan speed dapat berubah mengikuti antrean.'])
    return dict(product_slug=slug, supplier='indosmm', service_id=r['id'], public_name=name[:200], description=desc,
                terms=terms, instructions=instructions, region=reg, quality=q, refill_days=d, eta_start=start,
                speed_per_day=speed, drop_label=dl, drop_risk=r['droprisk'] or 'sedang',
                min_qty_override=lo, max_qty_override=hi, quantity_step=1, sort_order=100 + idx,
                evidence=dict(orders_7d=r['orders7'], success_rate=r['succ7'], refill_rate=r['refill7'], ai_score=r['score7'], api_refill=r['api_refill'], supplier_name=html.unescape(r['name'])[:160]))

manifest = dict(generated='2026-11-01', supplier='indosmm', new_products=[], services=[])
used = set()
for slug, (inc, exc) in RULES.items():
    p = products.get(slug)
    if not p: continue
    pk = json.loads(p['packages_json'])
    for i, r in enumerate(pick(candidates(inc, exc))):
        if r['id'] in used: continue
        s = service(slug, p['metric'], r, i, pk, instr.get(slug, '1. Buka target lalu salin link lengkapnya.'), r['api_refill'])
        if s: manifest['services'].append(s); used.add(r['id'])
for slug, np in NEW_PRODUCTS.items():
    if slug in products: continue
    picked = [r for r in pick(candidates(np['include'], np['exclude'], AVOID.replace('comment|', '')), 5) if r['id'] not in used]
    svc = [s for i, r in enumerate(picked) if (s := service(slug, np['metric'], r, i, np['packages'], '1. Buka postingan atau video target, lalu salin link lengkapnya.\n2. Komentar dipilih acak/positif; isi komentar tidak bisa ditentukan.', r['api_refill']))]
    if not svc: continue
    manifest['new_products'].append(dict(slug=slug, platform=np['platform'], metric=np['metric'], target_kind=np['target_kind'], name=np['name'],
        description=f"{np['name']} acak/positif untuk target publik. Isi komentar tidak bisa ditentukan.",
        checklist=[{"id": "public", "label": "Target saya dapat diakses publik."}, {"id": "stable", "label": "Saya tidak mengubah atau menghapus target selama proses."}],
        packages=np['packages']))
    for s in svc: manifest['services'].append(s); used.add(s['service_id'])
fmt = lambda n: f'{n/1_000_000:g}M' if n >= 1_000_000 else f'{n/1000:g}K' if n >= 1000 else str(n)
byp = collections.defaultdict(list)
for sv in manifest['services']: byp[sv['product_slug']].append(sv)
for lst in byp.values():
    names = collections.Counter(x['public_name'] for x in lst)
    for x in lst:
        if names[x['public_name']] > 1: x['public_name'] += f" · Max {fmt(x['max_qty_override'])}"
    names = collections.Counter(x['public_name'] for x in lst)
    for x in lst:
        if names[x['public_name']] > 1 and x.get('speed_per_day'): x['public_name'] += f" · {x['speed_per_day']}"
    names = collections.Counter(x['public_name'] for x in lst); seen = collections.Counter()
    for x in lst:
        if names[x['public_name']] > 1:
            seen[x['public_name']] += 1; x['public_name'] += f" · Opsi {seen[x['public_name']]}"
# Existing mapped tiers: measured drop risk + supplier drop label + speed/start when empty.
manifest['existing_updates'] = []
for r in rows:
    if not r['mapped']: continue
    nm = r['name']
    mp = re.search(r'(?i)speed\s*[:：]?\s*([^\]\|]+?)\s*(?:\]|\||$)', nm)
    ms = re.search(r'(?i)start(?: time)?\s*[:：]?\s*([^\]\|]+?)\s*(?:\]|\||$)', nm)
    manifest['existing_updates'].append(dict(service_id=r['id'], drop_label=drop_label(r), drop_risk=r['droprisk'],
        speed_per_day=norm_speed(r.get('d_speed') or (mp.group(1) if mp else None)), eta_start=norm_time(r.get('d_start') or (ms.group(1) if ms else None))))
# Supplier services failing orders (7-day success <85% or cancel >15%): stop selling.
manifest['deactivate_service_ids'] = sorted(r['id'] for r in rows if r['mapped'] and r['health'] == 'berisiko')
json.dump(manifest, open('/Users/macbookair/axvara/src/lib/pedia/curation-20261101.json', 'w'), ensure_ascii=False, indent=1)
c = collections.Counter(s['product_slug'] for s in manifest['services'])
print('services', len(manifest['services']), 'new products', [p['slug'] for p in manifest['new_products']])
for k, v in sorted(c.items()): print(f'  {k:24} +{v}')
print('drop labels', collections.Counter(s['drop_label'] for s in manifest['services']))
print('refill', collections.Counter((s['refill_days'] > 0, s['evidence']['api_refill']) for s in manifest['services']))
print('region', collections.Counter(s['region'] for s in manifest['services']))
