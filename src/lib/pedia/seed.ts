// src/lib/pedia/seed.ts — Kurasi awal Pedia (PEDIA-PRD §7.3).
//
// Data API ProviderSMM 2026-10-07 (576 layanan, rate IDR per 1K —
// diverifikasi langsung via API `services`). Harga final mengikuti rumus
// §7.2; WAJIB dicek ulang setelah uji order (PRD §14 pra-launch).
//
// Catatan kurasi wajib (PRD §7.3):
// - Field `refill` API TIDAK DAPAT DIPERCAYA (113 layanan menyebut garansi
//   di nama tetapi `refill=false`). `refill_days` diisi admin per tingkat.
// - `min`/`max` per layanan berasal dari API. Paket di luar rentang
//   otomatis disembunyikan (saat render, bukan saat seed).
// - Member Telegram TIDAK dikurasi fase 1.
// - Seed ini NONAKTIF semua (`is_active=0`) — admin mengaktifkan setelah
//   uji order + setujui harga final.

export type PediaSeedTier = {
  tier: "hemat" | "standar" | "premium";
  serviceId: number;
  group: "G1" | "G2" | "G3";
  refillDays: number;
  etaStart?: string;
  etaFinish?: string;
  labelNote?: string;
};

export type PediaSeedProduct = {
  slug: string;
  platform: string;
  metric: string;
  targetKind: string;
  name: string;
  tagline: string;
  packages: number[];
  step: number;
  checklist: { id: string; label: string; help?: string }[];
  tiers: PediaSeedTier[];
};

export const PEDIA_CHECKLIST_PUBLIC = { id: "public", label: "Akun saya publik (tidak dikunci)" };
export const PEDIA_CHECKLIST_NO_RENAME = { id: "no_rename", label: "Saya tidak ganti username selama proses" };
export const PEDIA_CHECKLIST_IG_FLAG = {
  id: "ig_flag",
  label: "\u201CTandai untuk ditinjau\u201D sudah mati",
  help: "Buka Pengaturan Instagram → Privasi → Tandai untuk ditinjau → matikan. Layanan followers butuh ini agar bisa masuk.",
};

export const PEDIA_SEED_PRODUCTS: PediaSeedProduct[] = [
  {
    slug: "followers-instagram", platform: "instagram", metric: "followers", targetKind: "profile",
    name: "Followers Instagram", tagline: "Bikin profil terlihat ramai",
    packages: [100, 250, 500, 1000], step: 10,
    checklist: [PEDIA_CHECKLIST_PUBLIC, PEDIA_CHECKLIST_NO_RENAME, PEDIA_CHECKLIST_IG_FLAG],
    tiers: [
      { tier: "hemat", serviceId: 948, group: "G3", refillDays: 0, etaStart: "±10 menit", labelNote: "Akun global" },
      { tier: "standar", serviceId: 86, group: "G3", refillDays: 30, etaStart: "±5 menit", labelNote: "Akun Indonesia" },
      { tier: "premium", serviceId: 24, group: "G2", refillDays: 0, etaStart: "±30 menit", labelNote: "Akun Indonesia aktif" },
    ],
  },
  {
    slug: "likes-instagram", platform: "instagram", metric: "likes", targetKind: "post",
    name: "Likes Instagram", tagline: "Postingan terlihat disukai",
    // #701 min 10 → paket mulai 20 agar Hemat & Standar (#541 min 20) sama.
    packages: [20, 50, 100, 250], step: 10,
    checklist: [PEDIA_CHECKLIST_PUBLIC],
    tiers: [
      { tier: "hemat", serviceId: 701, group: "G1", refillDays: 0, etaStart: "±10 menit", labelNote: "Akun global" },
      { tier: "standar", serviceId: 541, group: "G2", refillDays: 30, etaStart: "±5 menit", labelNote: "Akun Indonesia" },
    ],
  },
  {
    slug: "views-reels-instagram", platform: "instagram", metric: "views", targetKind: "reel",
    name: "Views Reels Instagram", tagline: "Reels terlihat ditonton",
    // #802 min 100 (API) → paket mulai 100.
    packages: [100, 500, 1000, 5000], step: 100,
    checklist: [PEDIA_CHECKLIST_PUBLIC],
    tiers: [
      { tier: "standar", serviceId: 802, group: "G1", refillDays: 0, etaStart: "±5 menit", labelNote: "Proses cepat" },
    ],
  },
  {
    slug: "views-tiktok", platform: "tiktok", metric: "views", targetKind: "video",
    name: "Views TikTok", tagline: "Video terlihat ramai ditonton",
    // Hemat #651 max 10.000 (API) → paket dibatasi 10.000.
    packages: [500, 1000, 5000, 10000], step: 100,
    checklist: [PEDIA_CHECKLIST_PUBLIC],
    tiers: [
      { tier: "hemat", serviceId: 651, group: "G1", refillDays: 0, etaStart: "±5 menit", labelNote: "Akun global" },
      { tier: "standar", serviceId: 82, group: "G1", refillDays: 30, etaStart: "±5 menit", labelNote: "Garansi 30 hari" },
    ],
  },
  {
    slug: "likes-tiktok", platform: "tiktok", metric: "likes", targetKind: "video",
    name: "Likes TikTok", tagline: "Video terlihat disukai",
    // Premium #17 max 200 (API) → paket dibatasi 200 (paket di luar rentang
    // otomatis disembunyikan saat render; seed jujur sejak awal).
    packages: [50, 100, 150, 200], step: 10,
    checklist: [PEDIA_CHECKLIST_PUBLIC],
    tiers: [
      { tier: "hemat", serviceId: 976, group: "G1", refillDays: 30, etaStart: "±10 menit", labelNote: "Garansi 30 hari" },
      { tier: "standar", serviceId: 13, group: "G2", refillDays: 90, etaStart: "±5 menit", labelNote: "Akun Indonesia" },
      { tier: "premium", serviceId: 17, group: "G2", refillDays: 0, etaStart: "±30 menit", labelNote: "Akun Indonesia aktif" },
    ],
  },
  {
    slug: "followers-tiktok", platform: "tiktok", metric: "followers", targetKind: "profile",
    name: "Followers TikTok", tagline: "Profil TikTok terlihat ramai",
    // Premium #18 max 300 (API) → paket dibatasi 300.
    packages: [50, 100, 200, 300], step: 10,
    checklist: [PEDIA_CHECKLIST_PUBLIC, PEDIA_CHECKLIST_NO_RENAME],
    tiers: [
      { tier: "hemat", serviceId: 116, group: "G3", refillDays: 0, etaStart: "±10 menit", labelNote: "Akun Indonesia" },
      { tier: "standar", serviceId: 16, group: "G3", refillDays: 30, etaStart: "±5 menit", labelNote: "Akun Indonesia" },
      { tier: "premium", serviceId: 18, group: "G2", refillDays: 0, etaStart: "±30 menit", labelNote: "Akun Indonesia aktif" },
    ],
  },
  {
    slug: "views-youtube", platform: "youtube", metric: "views", targetKind: "video",
    name: "Views YouTube", tagline: "Video terlihat ditonton",
    packages: [500, 1000, 5000, 10000], step: 100,
    checklist: [PEDIA_CHECKLIST_PUBLIC],
    tiers: [
      { tier: "standar", serviceId: 984, group: "G1", refillDays: 30, etaStart: "±30 menit", labelNote: "Garansi 30 hari" },
    ],
  },
  {
    slug: "likes-youtube", platform: "youtube", metric: "likes", targetKind: "video",
    name: "Likes YouTube", tagline: "Video terlihat disukai",
    packages: [100, 250, 500, 1000], step: 10,
    checklist: [PEDIA_CHECKLIST_PUBLIC],
    tiers: [
      { tier: "standar", serviceId: 988, group: "G1", refillDays: 30, etaStart: "±30 menit", labelNote: "Garansi 30 hari" },
    ],
  },
  {
    slug: "subscriber-youtube", platform: "youtube", metric: "subscribers", targetKind: "channel",
    name: "Subscriber YouTube", tagline: "Channel terlihat ramai",
    packages: [100, 250, 500, 1000], step: 10,
    checklist: [PEDIA_CHECKLIST_PUBLIC, PEDIA_CHECKLIST_NO_RENAME],
    tiers: [
      { tier: "standar", serviceId: 676, group: "G3", refillDays: 30, etaStart: "±1 jam", labelNote: "Garansi 30 hari" },
    ],
  },
  {
    slug: "followers-facebook", platform: "facebook", metric: "followers", targetKind: "profile",
    name: "Followers Facebook", tagline: "Halaman terlihat ramai",
    packages: [500, 1000, 5000, 10000], step: 100,
    checklist: [PEDIA_CHECKLIST_PUBLIC],
    tiers: [
      { tier: "hemat", serviceId: 958, group: "G1", refillDays: 0, etaStart: "±10 menit", labelNote: "Akun global" },
      { tier: "standar", serviceId: 959, group: "G1", refillDays: 30, etaStart: "±10 menit", labelNote: "Garansi 30 hari" },
    ],
  },
  {
    slug: "views-facebook", platform: "facebook", metric: "views", targetKind: "video",
    name: "Views Video Facebook", tagline: "Video terlihat ditonton",
    // #235 min 500 (API) → paket mulai 500.
    packages: [500, 1000, 5000, 10000], step: 100,
    checklist: [PEDIA_CHECKLIST_PUBLIC],
    tiers: [
      { tier: "standar", serviceId: 235, group: "G1", refillDays: 0, etaStart: "±10 menit", labelNote: "Proses cepat" },
    ],
  },
  {
    slug: "followers-threads", platform: "threads", metric: "followers", targetKind: "profile",
    name: "Followers Threads", tagline: "Profil Threads terlihat ramai",
    // Premium #93 max 300 (API) → paket dibatasi 300.
    packages: [50, 100, 200, 300], step: 10,
    checklist: [PEDIA_CHECKLIST_PUBLIC, PEDIA_CHECKLIST_NO_RENAME],
    tiers: [
      { tier: "hemat", serviceId: 835, group: "G1", refillDays: 0, etaStart: "±10 menit", labelNote: "Akun global" },
      { tier: "premium", serviceId: 93, group: "G2", refillDays: 0, etaStart: "±30 menit", labelNote: "Akun Indonesia aktif" },
    ],
  },
  {
    slug: "followers-shopee", platform: "shopee", metric: "followers", targetKind: "shop",
    name: "Followers Toko Shopee", tagline: "Toko terlihat dipercaya",
    packages: [100, 250, 500, 1000], step: 10,
    checklist: [],
    tiers: [
      { tier: "standar", serviceId: 512, group: "G1", refillDays: 0, etaStart: "±10 menit", labelNote: "Akun Indonesia" },
    ],
  },
  {
    slug: "plays-spotify", platform: "spotify", metric: "plays", targetKind: "track",
    name: "Plays Spotify Indonesia", tagline: "Lagu terlihat didengar",
    // #282 min 500 (API) → paket mulai 500.
    packages: [500, 1000, 5000, 10000], step: 100,
    checklist: [],
    tiers: [
      { tier: "standar", serviceId: 282, group: "G1", refillDays: 0, etaStart: "±30 menit", labelNote: "Akun Indonesia" },
    ],
  },
];

export const PEDIA_SEED_TIER_COUNT = PEDIA_SEED_PRODUCTS.reduce((n, p) => n + p.tiers.length, 0);
