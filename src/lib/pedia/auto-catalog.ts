// src/lib/pedia/auto-catalog.ts — Katalog otomatis ProviderSMM (PSMM-P2, 2026-11-12; revisi review-1).
//
// Membangkitkan SATU produk + tier "managed" deterministik per layanan
// supplier, tanpa kurasi manual per layanan. Aturannya sengaja fail-closed:
// platform/metrik/target yang tidak bisa dipetakan eksplisit TIDAK dijual.
//
// Batas keras:
// - Kepemilikan diperiksa SEBELUM mutasi produk apa pun: slug bentrok dengan
//   produk kurasi tidak pernah diubah. Baris kurasi manusia (`managed='curated'`)
//   tidak pernah di-upsert.
// - Snapshot/copy order lama tidak dibaca atau ditulis di sini.
// - Harga hanya G2 pada PEMBUATAN awal; nilai markup/min-profit admin pada
//   baris auto yang sudah ada TIDAK di-reset tiap sync.
// - Larangan manusia (margin/manual/dll.) menang atas status mesin. Hanya alasan
//   mesin yang dikenal (`service_missing`, `description_missing`, `description_oversize`,
//   `warranty_unconfirmed`, `terms_conflict`) boleh pulih oleh mesin.
// - Refill: `api_refill` boolean BUKAN durasi. Durasi hanya dipakai bila sumber
//   menyebut durasi eksplisit DAN anchor eksplisit; selain itu tidak dijanjikan.
// - "Tidak Bergaransi"/"No Refill" lebih dulu dikecualikan dari klaim refill.

import { pediaBounds } from "./bounds";
import { computePediaPrice, passesMarginGuard, PRICE_GROUP_DEFAULTS } from "./pricing";
import { PEDIA_SALE_PROVIDER } from "./sales-policy";

export type ManagedService = {
  service_id: number;
  name: string;
  type: string;
  category: string;
  rate: number;
  min_qty: number;
  max_qty: number;
  api_refill: number;
};

export type ManagedPlan = {
  eligible: boolean;
  /** Alasan tidak dapat dijual; null bila eligible. */
  reason: string | null;
  slug: string;
  platform: string;
  metric: string;
  target_kind: string;
  input_kind: null | "comments";
  product_name: string;
  packages: number[];
  prices: Record<string, number>;
  /** Durasi refill eksplisit yang koheren; 0 bila tidak dijanjikan. */
  refill_days: number;
  refill_anchor: "created" | "completed";
};

/** Batas materialisasi per request agar statement D1 tetap terukur (§platform-ops). */
export const MANAGED_PER_CALL = 25;

/** Jumlah paket kanonis per layanan (cukup untuk chip; harga bebas tetap live). */
const CANONICAL_QUANTITIES = [10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000];

/** Token platform eksplisit. Urutan penting: alias spesifik lebih dulu. */
const PLATFORM_TOKENS: [string, RegExp][] = [
  ["shopee", /\bshopee\b/i], ["lazada", /\blazada\b/i], ["snackvideo", /snack\s*video/i],
  ["coinmarketcap", /coinmarketcap/i], ["reverbnation", /reverbnation/i], ["audiomack", /audiomack/i],
  ["mixcloud", /mixcloud/i], ["soundcloud", /soundcloud/i], ["dribbble", /dribbble/i],
  ["instagram", /\binstagram\b|\binsta\b/i], ["tiktok", /\btik\s*tok\b/i],
  ["youtube", /\byoutube\b|\byt\b/i], ["facebook", /\bfacebook\b|\bfb\b/i],
  ["threads", /\bthreads\b/i], ["twitter", /\btwitter\b|\bx\/twitter\b/i],
  ["telegram", /\btelegram\b/i], ["linkedin", /\blinkedin\b/i], ["pinterest", /\bpinterest\b/i],
  ["discord", /\bdiscord\b/i], ["spotify", /\bspotify\b/i], ["twitch", /\btwitch\b/i],
  ["github", /\bgithub\b/i], ["roblox", /\broblox\b/i], ["whatsapp", /\bwhats\s*app\b/i],
  ["kick", /\bkick\.com\b/i], ["vimeo", /\bvimeo\b/i], ["tumblr", /\btumblr\b/i],
  ["reddit", /\breddit\b/i], ["rumble", /\brumble\b/i], ["rutube", /\brutube\b/i],
  ["coub", /\bcoub\b/i], ["tidal", /\btidal\b/i], ["medium", /\bmedium\b/i],
];

/** Token metrik eksplisit. Banyak yang cocok = ambigu → tidak dijual. */
const METRIC_TOKENS: [string, RegExp][] = [
  ["reposts", /\breposts?\b|\bretweet/i], ["subscribers", /\bsubscribers?\b|\bsubs\b/i],
  ["followers", /\bfollowers?\b|\bpengikut\b/i], ["members", /\bmembers?\b|\banggota\b/i],
  ["listeners", /\blisteners?\b/i], ["connections", /\bconnections?\b/i],
  ["reactions", /\breactions?\b/i], ["comments", /\bcomments?\b|\bkomentar\b/i],
  ["bookmarks", /\bbookmarks?\b/i], ["saves", /\bsaves?\b/i], ["shares", /\bshares?\b/i],
  ["quotes", /\bquotes?\b/i], ["likes", /\blikes?\b|\bsuka\b/i],
  ["views", /\bviews?\b|\btayangan\b|\bpenayangan\b/i],
  ["plays", /\bplays?\b/i], ["claps", /\bclaps?\b/i], ["downloads", /\bdownloads?\b/i],
  ["forks", /\bforks?\b/i], ["traffic", /\btraffic\b/i], ["visits", /\bvisits?\b|\bkunjungan\b/i],
];

const METRIC_ALIASES: Record<string, string> = { bookmarks: "saves" };

/**
 * Pemetaan deterministik (platform, metrik) → jenis target yang benar-benar
 * didukung parser (`detectPediaLink`). Tidak ada fallback "post" generik.
 */
const TARGET_TABLE: Record<string, Record<string, string>> = {
  instagram: { followers: "profile", comments: "post", views: "post", saves: "post", shares: "post", reposts: "post", reactions: "post" },
  tiktok: { followers: "profile", likes: "video", views: "video", shares: "video", saves: "video", reposts: "video", comments: "video" },
  youtube: { subscribers: "channel", members: "channel", likes: "video", views: "video", comments: "video", shares: "video" },
  facebook: { followers: "profile", likes: "post", views: "video", shares: "post", members: "group", reactions: "post", comments: "post" },
  threads: { followers: "profile", likes: "post", reposts: "post", quotes: "post", shares: "post", comments: "post", views: "post" },
  x: { followers: "profile", likes: "post", views: "post", reposts: "post", quotes: "post", comments: "post", shares: "post" },
  telegram: { members: "channel", subscribers: "channel", reactions: "post", views: "post", likes: "post" },
  discord: { members: "invite" },
  linkedin: { followers: "profile", likes: "post", comments: "post", shares: "post" },
  pinterest: { followers: "profile", likes: "post", saves: "post" },
  spotify: { plays: "track", followers: "artist", listeners: "artist", saves: "track" },
  soundcloud: { plays: "track", likes: "track", followers: "profile" },
  twitch: { followers: "profile" },
  github: { followers: "profile", forks: "repository" },
  shopee: { followers: "shop", likes: "post", views: "post" },
  lazada: { followers: "shop" },
  website: { traffic: "website", visits: "website" },
  kick: { followers: "profile" },
};

/** Mesin hanya boleh mengubah status ini; alasan lain = larangan manusia. */
const MACHINE_REASONS = new Set([
  "service_missing", "description_missing", "description_oversize",
  "warranty_unconfirmed", "terms_conflict", "type_unsupported", "platform_ambiguous",
  "platform_unmapped", "metric_ambiguous", "metric_unmapped", "target_unmapped",
  "premium_tool_excluded", "bounds_invalid", "packages_empty", "invalid_service", "name_unsafe",
]);

/**
 * PSMM-ACCEPTANCE-CLOSE 5: alasan mesin yang berarti baris BELUM layak jual.
 * Admin tidak boleh memaksa `is_active=1` pada baris `managed='auto'` dengan
 * alasan ini — kelayakan ditentukan mesin; menunggu sync berikutnya, bukan
 * menimpa alasan lewat body API. `margin` juga ditahan (bukan larangan admin,
 * tetapi harga tidak lagi menutup untung).
 */
export const MACHINE_INELIGIBLE_REASONS: ReadonlySet<string> = new Set([
  ...MACHINE_REASONS, "margin",
]);

const PREMIUM_RE = /canva|gemini|capcut/i;
/** Badge superskrip/subskrip "ᴾʳᵒᵛᶦᵈᵉʳ" + emoji status supplier. */
const BADGE_RE = /[\u1D2C-\u1D6A\u1D9B-\u1DBF\u2070-\u209F\u02B0-\u02FF]/g;
const EMOJI_STATUS_RE = /[⭐🚫♻️]+\s*/gu;
const REFILL_NONE_RE = /\bno\s*refill\b|\btanpa\s*refill\b|\btidak\s*bergaransi\b|\bnot\s*guaranteed\b|\bno\s*garansi\b|\brefill\s*[:=]\s*(?:tidak|no|none|tanpa)\b/i;
const REFILL_DURATION_RE = /\b(?:refill|garansi|warranty)\D{0,12}(\d{1,4})\s*(hari|days?|bulan|month)\b/i;
const REFILL_LIFETIME_RE = /\brefill\s*lifetime\b|\bgaransi\s*seumur\b/i;
/** Sinyal klaim refill/garansi tanpa durasi eksplisit. */
const REFILL_CLAIM_RE = /\bgaransi\b|\bwarranty\b|\bguarantee\b|\brefill\b|♻/i;

function detect<T extends string>(text: string, tokens: [T, RegExp][]): { value: T | null; ambiguous: boolean } {
  const found = tokens.filter(([, re]) => re.test(text)).map(([value]) => value);
  const unique = [...new Set(found)];
  return { value: unique.length === 1 ? unique[0] : null, ambiguous: unique.length > 1 };
}

function cleanName(raw: string): string {
  return String(raw ?? "")
    .replace(BADGE_RE, "").replace(EMOJI_STATUS_RE, " ")
    .replace(/\s{2,}/g, " ").trim().slice(0, 200);
}

function canonicalPackages(min: number, max: number, step: number): number[] {
  const set = new Set<number>();
  if (Number.isSafeInteger(min) && min > 0) set.add(min);
  for (const q of CANONICAL_QUANTITIES) if (q >= min && q <= max && q % step === 0) set.add(q);
  return [...set].sort((a, b) => a - b).slice(0, 12);
}

type RefillVerdict = { days: number; anchor: "created" | "completed" } | { reason: "terms_conflict" | "warranty_unconfirmed" };

/**
 * Refill: durasi hanya dijanjikan bila sumber menyebut durasi eksplisit dan
 * koheren (nama vs deskripsi tidak bertentangan) memakai skema refill existing.
 * `No Refill`/`Tidak Bergaransi` menang LEBIH DULU (bukan konflik). Klaim
 * tanpa durasi atau `api_refill` saja = belum pasti → baris nonaktif.
 */
function planRefill(name: string, description: string, apiRefill: number): RefillVerdict {
  const nameNone = REFILL_NONE_RE.test(name);
  const descNone = REFILL_NONE_RE.test(description);
  const nameDuration = name.match(REFILL_DURATION_RE);
  const descDuration = description.match(REFILL_DURATION_RE);
  const nameLifetime = REFILL_LIFETIME_RE.test(name);
  const descLifetime = REFILL_LIFETIME_RE.test(description);

  if (nameNone || descNone) {
    // "Tidak Bergaransi"/"No Refill" eksplisit: durasi di teks lain = kontradiksi.
    if (nameDuration || descDuration || nameLifetime || descLifetime) return { reason: "terms_conflict" };
    return { days: 0, anchor: "created" };
  }
  // Lifetime tidak dapat diekspresikan sebagai hitungan hari yang jujur.
  if (nameLifetime || descLifetime) return { reason: "warranty_unconfirmed" };
  const parse = (m: RegExpMatchArray | null) => {
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    // Bulan kalender tidak selalu 30 hari: jangan mengarang konversi.
    if (/bulan|month/i.test(m[2])) return null;
    return n;
  };
  const nameDays = parse(nameDuration);
  const descDays = parse(descDuration);
  if (nameDays != null && descDays != null && nameDays !== descDays) return { reason: "terms_conflict" };
  const days = nameDays ?? descDays;
  if (days == null) {
    // Klaim tanpa durasi eksplisit, atau api_refill boolean saja, BUKAN bukti
    // masa refill → jangan dijual sebagai bergaransi.
    const claims = apiRefill === 1 || REFILL_CLAIM_RE.test(name) || REFILL_CLAIM_RE.test(description);
    return claims ? { reason: "warranty_unconfirmed" } : { days: 0, anchor: "created" };
  }
  // Anchor WAJIB eksplisit dari sumber. Skema tidak boleh dijadikan bukti:
  // masa garansi dihitung dari anchor, jadi menebaknya = janji salah.
  const createdAnchor = /sejak (?:pesanan )?dibuat|dari (?:waktu )?order dibuat|after (?:order )?creat|from order creation/i.test(`${name} ${description}`);
  const completedAnchor = /setelah (?:pesanan )?selesai|after (?:order )?(?:complet|finish)/i.test(`${name} ${description}`);
  if (!createdAnchor && !completedAnchor) return { reason: "warranty_unconfirmed" };
  const anchor: "created" | "completed" = completedAnchor ? "completed" : "created";
  return { days, anchor };
}

/** Tipe yang boleh dijual otomatis: Default dan (hanya) Custom Comments. */
function planInputKind(type: string, name: string, category: string): { input_kind: null | "comments"; reason: string | null } {
  if (type === "Default") return { input_kind: null, reason: null };
  if (type === "Custom Comments") {
    if (!/\bcomments?\b|\bkomentar\b/i.test(`${category} ${name}`)) return { input_kind: "comments", reason: "type_unsupported" };
    return { input_kind: "comments", reason: null };
  }
  return { input_kind: null, reason: "type_unsupported" };
}

/**
 * Rencana baris managed untuk satu layanan. `description` = teks resmi yang
 * sudah disanitasi, atau status eksplisit (`empty`/`oversize`) dari snapshot.
 * `priceConfig` = markup/min-profit yang AKAN TERSIMPAN (admin dipertahankan),
 * sehingga harga paket tidak pernah dihitung dari basis yang berbeda.
 */
export function planManagedService(
  svc: ManagedService,
  description: string | null,
  minOrderRp: number,
  descriptionStatus: "ok" | "empty" | "oversize" | "missing" = description ? "ok" : "missing",
  priceConfig: { markupPct: number; minProfitRp: number } = {
    markupPct: PRICE_GROUP_DEFAULTS.G2.markup_pct,
    minProfitRp: PRICE_GROUP_DEFAULTS.G2.min_profit_rp,
  },
): ManagedPlan {
  const slug = `psmm-${svc.service_id}`;
  const name = cleanName(svc.name);
  const text = `${svc.category} ${name}`;
  const base = (reason: string, over: Partial<ManagedPlan> = {}): ManagedPlan => ({
    eligible: false, reason, slug, platform: "", metric: "", target_kind: "", input_kind: null,
    product_name: name, packages: [], prices: {}, refill_days: 0, refill_anchor: "created", ...over,
  });

  if (PREMIUM_RE.test(text)) return base("premium_tool_excluded");
  const input = planInputKind(svc.type, name, svc.category);
  if (input.reason) return base(input.reason);
  if (!Number.isFinite(svc.rate) || svc.rate <= 0 || !Number.isSafeInteger(svc.min_qty) || svc.min_qty <= 0
    || !Number.isSafeInteger(svc.max_qty) || svc.max_qty < svc.min_qty) return base("invalid_service");

  // Platform: kategori lebih dulu (struktur supplier), lalu nama.
  const fromCategory = detect(svc.category, PLATFORM_TOKENS);
  const fromName = detect(name, PLATFORM_TOKENS);
  if (fromCategory.ambiguous) return base("platform_ambiguous");
  const platformHit = fromCategory.value ? fromCategory : fromName;
  if (platformHit.ambiguous) return base("platform_ambiguous");
  if (!platformHit.value) return base("platform_unmapped");
  const platform = platformHit.value === "twitter" ? "x" : platformHit.value;

  const metricHit = detect(text, METRIC_TOKENS);
  let metric: string | null;
  if (input.input_kind === "comments") {
    metric = "comments";
  } else {
    if (metricHit.ambiguous) return base("metric_ambiguous", { platform });
    metric = metricHit.value ? METRIC_ALIASES[metricHit.value] ?? metricHit.value : null;
  }
  if (!metric) return base("metric_unmapped", { platform });

  // Kualifikasi eksplisit: Reel/Live/Story hanya bila sumber menyebutnya; Likes
  // generik pada Instagram tidak boleh otomatis menjadi target "post".
  const lower = text.toLowerCase();
  let target = TARGET_TABLE[platform]?.[metric] ?? null;
  const qualifier = /\bstory\b|\bstories\b/.test(lower) ? "story"
    : /\breel\b|\breels\b/.test(lower) ? "reel"
    : /\blive\b/.test(lower) ? "live"
    : null;
  if (qualifier) {
    // Hanya jenis yang BENAR-BENAR dideteksi parser `detectPediaLink`.
    // Facebook story tidak ada di parser (permalink story_fbid → post), jadi
    // layanan seperti itu tidak boleh diiklankan sebagai `story`.
    if (qualifier === "story" && platform === "instagram") target = "story";
    else if (qualifier === "reel" && platform === "instagram") target = "reel";
    else if (qualifier === "live" && platform === "shopee") target = "live";
    else return base("target_unmapped", { platform, metric });
  }
  // Instagram Likes tanpa kualifikasi = postingan, tetapi hanya bila sumber
  // memang menyebut postingan/feed/reel/story secara eksplisit ATAU kategori
  // menyebut "Likes" saja. Source kategori "Instagram Likes" aman = post.
  if (platform === "instagram" && metric === "likes") {
    const declaresPost = /\bpost\b|\bposting|\bfeed\b/i.test(lower);
    const declaresProfile = /\bprofile\b|\bprofil\b/i.test(lower);
    if (qualifier === "reel" || qualifier === "story") {
      target = qualifier;
    } else if (declaresProfile) {
      // Likes pada "profile"/"profil" bukan target postingan yang valid.
      return base("target_unmapped", { platform, metric });
    } else if (declaresPost) {
      target = "post";
    } else if (!/\binstagram\b/i.test(svc.category)) {
      // Tidak ada kualifikasi target sama sekali: jangan menebak.
      return base("target_unmapped", { platform, metric });
    } else {
      // Kategori platform-level "Instagram Likes" tanpa target lain = postingan.
      target = "post";
    }
  }
  // SnackVideo: parser hanya mendeteksi profil; "likes/views video" tidak punya
  // target terverifikasi, jadi DITAHAN sampai kontraknya dikonfirmasi.
  if (platform === "snackvideo") return base("target_unmapped", { platform, metric });
  // Spotify: parser hanya mendukung track/artist/playlist. Album tidak ada di
  // `detectPediaLink`, jadi tidak boleh diiklankan.
  if (platform === "spotify" && metric === "plays") {
    if (/\bplaylist\b/.test(lower)) target = "playlist";
    else if (/\btrack\b|\bsong\b|\blagu\b/.test(lower)) target = "track";
    else if (/\bartist\b/.test(lower)) target = "artist";
    else return base("target_unmapped", { platform, metric });
  }
  if (!target) return base("target_unmapped", { platform, metric });

  const limits = pediaBounds({ min_qty: svc.min_qty, max_qty: svc.max_qty }, {}, 1);
  if (!limits) return base("bounds_invalid", { platform, metric });

  // Deskripsi wajib & tidak boleh dipotong: tanpa teks utuh tidak dijual
  // (tidak ada pengganti "fakta terstruktur saja", dan potongan bisa
  // menghilangkan syarat penting).
  if (descriptionStatus === "oversize") return base("description_oversize", { platform, metric });
  if (descriptionStatus === "empty" || descriptionStatus === "missing" || !description || !description.trim()) {
    return base("description_missing", { platform, metric });
  }

  const refill = planRefill(name, description, svc.api_refill);
  if ("reason" in refill) return base(refill.reason, { platform, metric });

  const packages = canonicalPackages(limits.min, limits.max, limits.step);
  if (!packages.length) return base("packages_empty", { platform, metric });
  // PSMM-CORE-FIX B2: harga dihitung dari konfigurasi yang AKAN TERSIMPAN
  // (markup/min-profit/group yang dipertahankan dari admin), bukan default G2.
  const prices: Record<string, number> = {};
  for (const qty of packages) {
    prices[String(qty)] = computePediaPrice({
      supplierRatePer1k: svc.rate, quantity: qty,
      markupPct: priceConfig.markupPct, minProfitRp: priceConfig.minProfitRp, minOrderRp,
    });
  }
  return {
    eligible: true, reason: null, slug, platform, metric, target_kind: target, input_kind: input.input_kind,
    product_name: name || `Layanan ${svc.service_id}`, packages, prices,
    refill_days: refill.days, refill_anchor: refill.anchor,
  };
}

export type ManagedResult = { created: number; updated: number; skipped: number; ineligible: number; errors: string[] };

type ManagedDb = {
  queryFirst: (q: string, ...p: unknown[]) => Promise<Record<string, unknown> | null>;
  queryAll: (q: string, ...p: unknown[]) => Promise<Record<string, unknown>[]>;
  execRun: (q: string, ...p: unknown[]) => Promise<{ changes?: number }>;
};

/**
 * Materialisasi baris managed untuk sekumpulan layanan (sudah dibatasi
 * pemanggil). Idempoten & concurrency-safe:
 * - Kepemilikan produk diperiksa SEBELUM mutasi; slug kurasi tak pernah diubah.
 * - Pembuatan menangani race UNIQUE (INSERT OR IGNORE).
 * - UPDATE hanya untuk `managed='auto'` dan mempertahankan larangan manusia
 *   serta override markup/min-profit admin.
 */
export async function materializeManagedCatalog(
  db: ManagedDb,
  services: ManagedService[],
  descriptions: Map<number, string>,
  removedIds: number[] = [],
  statuses?: Map<number, "ok" | "empty" | "oversize">,
  snapshotAt: string | null = null,
): Promise<ManagedResult> {
  const out: ManagedResult = { created: 0, updated: 0, skipped: 0, ineligible: 0, errors: [] };
  const minOrderRp = Number(process.env.PEDIA_MIN_ORDER_RP || 1000) || 1000;
  const list = services.slice(0, MANAGED_PER_CALL);
  const defaults = PRICE_GROUP_DEFAULTS.G2;

  for (const svc of list) {
    const desc = descriptions.get(svc.service_id) ?? null;
    // Status eksplisit dari snapshot: `oversize` TIDAK pernah dipotong/dijual;
    // tanpa entri berarti `missing` (fail-closed).
    const status: "ok" | "empty" | "oversize" | "missing" = statuses?.get(svc.service_id) ?? (desc ? "ok" : "missing");
    try {
      const slug = `psmm-${svc.service_id}`;
      // 1. Kepemilikan SEBELUM mutasi produk.
      const product = await db.queryFirst(`SELECT id,managed FROM pedia_products WHERE slug=?`, slug);
      if (product && String(product.managed ?? "curated") !== "auto") { out.skipped++; continue; }
      let productId = Number(product?.id);
      const initialPlan = planManagedService(svc, desc, minOrderRp, status);
      if (!product) {
        // Race aman: dua sync bersamaan tidak membuat duplikat.
        await db.execRun(
          `INSERT OR IGNORE INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,sort_order,managed)
           VALUES (?,?,?,?,?,?,1,1,?,'auto')`,
          slug, initialPlan.platform || "unknown", initialPlan.metric || "unknown", initialPlan.target_kind || "profile",
          initialPlan.product_name, JSON.stringify(initialPlan.packages), svc.service_id,
        );
        const created = await db.queryFirst(`SELECT id,managed FROM pedia_products WHERE slug=?`, slug);
        if (!created || String(created.managed ?? "curated") !== "auto") { out.skipped++; continue; }
        productId = Number(created.id);
      }
      if (!Number.isSafeInteger(productId) || productId <= 0) { out.errors.push("product_missing"); continue; }

      const current = await db.queryFirst(
        `SELECT id,managed,is_active,auto_disabled_reason,markup_pct,min_profit_rp,price_group,package_prices_json FROM pedia_tiers
          WHERE product_id=? AND supplier=? AND supplier_service_id=?`,
        productId, PEDIA_SALE_PROVIDER, svc.service_id,
      );
      if (current && String(current.managed ?? "curated") !== "auto") { out.skipped++; continue; }

      // 2. Konfigurasi harga yang DIPERTAHANKAN: admin override tidak di-reset,
      // dan harga paket dihitung dari basis yang akan tersimpan (B2).
      const priceConfig = current
        ? { markupPct: Number(current.markup_pct ?? defaults.markup_pct), minProfitRp: Number(current.min_profit_rp ?? defaults.min_profit_rp) }
        : { markupPct: defaults.markup_pct, minProfitRp: defaults.min_profit_rp };
      const plan = planManagedService(svc, desc, minOrderRp, status, priceConfig);
      const wantActive = plan.eligible ? 1 : 0;

      if (product) {
        // Produk auto milik mesin: metadata struktural boleh diperbarui.
        await db.execRun(
          `UPDATE pedia_products SET platform=?, metric=?, target_kind=?, name=?, packages_json=?, updated_at=datetime('now')
             WHERE id=? AND managed='auto'`,
          plan.platform || "unknown", plan.metric || "unknown", plan.target_kind || "profile",
          plan.product_name, JSON.stringify(plan.packages), productId,
        );
      }

      if (!current) {
        await db.execRun(
          `INSERT OR IGNORE INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,
             min_profit_rp,refill_days,refill_anchor,package_prices_json,rate_snapshot,input_kind,public_name,
             min_qty_override,max_qty_override,sort_order,managed,is_active,auto_disabled_reason,
             target_format,quantity_step,managed_snapshot_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'auto',?,?,'url',1,?)`,
          productId, "standar", PEDIA_SALE_PROVIDER, svc.service_id, "G2",
          defaults.markup_pct, defaults.min_profit_rp, plan.refill_days, plan.refill_anchor,
          JSON.stringify(plan.prices), svc.rate, plan.input_kind, plan.product_name,
          svc.min_qty, svc.max_qty, svc.service_id, wantActive, wantActive === 1 ? null : plan.reason,
          snapshotAt,
        );
        out.created++;
        continue;
      }

      // 2. UPDATE hanya baris auto. Larangan manusia menang (B1).
      // `is_active=0` dengan alasan apa pun yang BUKAN alasan mesin (termasuk
      // NULL legacy dan `manual` hasil jeda admin) TIDAK boleh dihidupkan.
      // Hanya baris yang masih aktif atau nonaktif karena alasan mesin yang
      // dapat pulih secara otomatis.
      const prevActive = Number(current.is_active ?? 0) === 1;
      const prevReason = current.auto_disabled_reason == null ? null : String(current.auto_disabled_reason);
      const machineRecoverable = prevReason != null && MACHINE_REASONS.has(prevReason);
      const canRecover = prevActive || machineRecoverable;
      if (!canRecover) {
        // PSMM-LASTGOOD-PAUSE B: baris yang dikunci manusia (jeda manual/`margin`/
        // NULL legacy) TIDAK dipulihkan mesin, TETAPI metadata & cap versinya
        // tetap direkonsiliasi agar setelah admin membuka jeda, syarat yang
        // berlaku adalah syarat resmi TERBARU (bukan janji basi hingga 6 jam).
        // Status nonaktif + alasan manusia + basis harga admin dipertahankan;
        // CAS memakai is_active/reason lama supaya jeda/ubah admin bersamaan
        // tidak tertimpa.
        try {
          if (plan.eligible) {
            await db.execRun(
              `UPDATE pedia_tiers SET
                 package_prices_json=?, rate_snapshot=?, refill_days=?, refill_anchor=?, input_kind=?,
                 public_name=?, min_qty_override=?, max_qty_override=?, managed_snapshot_at=?,
                 updated_at=datetime('now')
               WHERE id=? AND managed='auto' AND is_active=? AND COALESCE(auto_disabled_reason,'')=?`,
              JSON.stringify(plan.prices), svc.rate,
              plan.refill_days, plan.refill_anchor, plan.input_kind, plan.product_name,
              svc.min_qty, svc.max_qty, snapshotAt, Number(current.id),
              Number(current.is_active ?? 0), prevReason ?? "",
            );
          } else {
            // Syarat baru tidak layak: jangan timpa salinan/harga terakhir yang
            // baik; cukup cap versi agar gate tidak memakai syarat basi, dan
            // baris tetap nonaktif dengan alasan manusia.
            await db.execRun(
              `UPDATE pedia_tiers SET managed_snapshot_at=?, updated_at=datetime('now')
                WHERE id=? AND managed='auto' AND is_active=? AND COALESCE(auto_disabled_reason,'')=?`,
              snapshotAt, Number(current.id), Number(current.is_active ?? 0), prevReason ?? "",
            );
          }
          out.updated++;
        } catch (e) {
          out.errors.push(e instanceof Error ? e.message.slice(0, 120) : "materialize_locked_failed");
        }
        continue;
      }
      // Margin-guard: harga tersimpan harus masih menutup margin pada rate
      // baru sebelum ditimpa — larangan margin/manual tidak boleh tertimpa.
      if (prevActive && Number(current.min_profit_rp ?? 0) > 0) {
        const prevPrices = (() => {
          try { const v = JSON.parse(String(current.package_prices_json ?? "{}")); return v && typeof v === "object" ? v as Record<string, number> : {}; } catch { return {}; }
        })();
        const priced = Object.entries(prevPrices).filter(([, v]) => typeof v === "number" && v > 0).map(([k]) => Number(k)).filter(Number.isSafeInteger);
        if (priced.length) {
          const smallest = Math.min(...priced);
          const stored = Number(prevPrices[String(smallest)]) || 0;
          if (stored > 0 && !passesMarginGuard({
            supplierRatePer1k: svc.rate, quantity: smallest, sellPrice: stored,
            minProfitRp: Number(current.min_profit_rp ?? 0),
          })) {
            await db.execRun(
              `UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='margin', managed_snapshot_at=?, updated_at=datetime('now')
                WHERE id=? AND managed='auto' AND is_active=1`, snapshotAt, Number(current.id),
            );
            out.ineligible++;
            continue;
          }
        }
      }
      const nextActive = wantActive === 1 && canRecover ? 1 : 0;
      const nextReason = wantActive === 1 ? null : plan.reason;
      // Pricing: pertahankan group/markup/min-profit admin (hanya selaraskan
      // pola default mesin). Harga paket sudah dihitung dari basis ini (B2).
      const keepGroup = String(current.price_group ?? "G2") !== "G2";
      await db.execRun(
        `UPDATE pedia_tiers SET
           price_group=?, markup_pct=?, min_profit_rp=?, package_prices_json=?, rate_snapshot=?,
           refill_days=?, refill_anchor=?, input_kind=?, public_name=?, min_qty_override=?, max_qty_override=?,
           is_active=?, auto_disabled_reason=?, managed_snapshot_at=?, updated_at=datetime('now')
         WHERE id=? AND managed='auto' AND is_active=? AND COALESCE(auto_disabled_reason,'')=?`,
        keepGroup ? String(current.price_group) : "G2",
        priceConfig.markupPct,
        priceConfig.minProfitRp,
        JSON.stringify(plan.prices), svc.rate,
        plan.refill_days, plan.refill_anchor, plan.input_kind, plan.product_name, svc.min_qty, svc.max_qty,
        nextActive, nextReason, snapshotAt, Number(current.id),
        Number(current.is_active ?? 0), prevReason ?? "",
      );
      out.updated++;
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message.slice(0, 120) : "materialize_failed");
    }
  }
  // Layanan yang hilang: nonaktifkan HANYA tier auto (kurasi tak disentuh).
  for (const sid of removedIds.slice(0, MANAGED_PER_CALL)) {
    try {
      const r = await db.execRun(
        `UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='service_missing', managed_snapshot_at=?, updated_at=datetime('now')
          WHERE supplier=? AND supplier_service_id=? AND managed='auto' AND is_active=1`,
        snapshotAt, PEDIA_SALE_PROVIDER, sid,
      );
      if (Number(r.changes || 0) > 0) out.ineligible++;
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message.slice(0, 120) : "managed_retire_failed");
    }
  }
  return out;
}
