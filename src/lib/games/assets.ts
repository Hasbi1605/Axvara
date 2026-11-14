// AUTO-GENERATED oleh scripts/games-assets.mjs dari scripts/games-assets.manifest.json.
// Jangan edit manual: ubah manifest lalu jalankan `node scripts/games-assets.mjs`.
// Aset = artwork resmi publisher (App Store ID). Tanpa gambar produk Sekalipay.

export interface GamesLocalAsset {
  icon: string | null;
  banner: string | null;
}

export const GAMES_LOCAL_ASSETS: Readonly<Record<string, GamesLocalAsset>> = Object.freeze({
  "aniimo": { icon: "/brand/games/aniimo-icon.webp", banner: null },
  "arena-breakout": { icon: "/brand/games/arena-breakout-icon.webp", banner: null },
  "arena-of-valor": { icon: "/brand/games/arena-of-valor-icon.webp", banner: "/brand/games/arena-of-valor-banner.webp" },
  "blood-strike": { icon: "/brand/games/blood-strike-icon.webp", banner: null },
  "call-of-duty-mobile": { icon: "/brand/games/call-of-duty-mobile-icon.webp", banner: "/brand/games/call-of-duty-mobile-banner.webp" },
  "captain-tsubasa-ace": { icon: "/brand/games/captain-tsubasa-ace-icon.webp", banner: null },
  "crossfire-legends": { icon: "/brand/games/crossfire-legends-icon.webp", banner: null },
  "delta-force": { icon: "/brand/games/delta-force-icon.webp", banner: "/brand/games/delta-force-banner.webp" },
  "dragon-city": { icon: "/brand/games/dragon-city-icon.webp", banner: "/brand/games/dragon-city-banner.webp" },
  "fc-mobile": { icon: "/brand/games/fc-mobile-icon.webp", banner: null },
  "football-master-2": { icon: "/brand/games/football-master-2-icon.webp", banner: null },
  "free-fire": { icon: "/brand/games/free-fire-icon.webp", banner: "/brand/games/free-fire-banner.webp" },
  "free-fire-max": { icon: "/brand/games/free-fire-max-icon.webp", banner: "/brand/games/free-fire-max-banner.webp" },
  "gangstar-mirage-city": { icon: "/brand/games/gangstar-mirage-city-icon.webp", banner: "/brand/games/gangstar-mirage-city-banner.webp" },
  "garena-undawn": { icon: "/brand/games/garena-undawn-icon.webp", banner: "/brand/games/garena-undawn-banner.webp" },
  "genshin-impact": { icon: "/brand/games/genshin-impact-icon.webp", banner: "/brand/games/genshin-impact-banner.webp" },
  "growtopia": { icon: "/brand/games/growtopia-icon.webp", banner: null },
  "haikyu-fly-high": { icon: "/brand/games/haikyu-fly-high-icon.webp", banner: "/brand/games/haikyu-fly-high-banner.webp" },
  "heartopia": { icon: "/brand/games/heartopia-icon.webp", banner: null },
  "honkai-star-rail": { icon: "/brand/games/honkai-star-rail-icon.webp", banner: null },
  "honor-of-kings": { icon: "/brand/games/honor-of-kings-icon.webp", banner: null },
  "identity-v": { icon: "/brand/games/identity-v-icon.webp", banner: "/brand/games/identity-v-banner.webp" },
  "league-of-legends-wild-rift": { icon: "/brand/games/league-of-legends-wild-rift-icon.webp", banner: null },
  "lifeafter": { icon: "/brand/games/lifeafter-icon.webp", banner: "/brand/games/lifeafter-banner.webp" },
  "lineage2m": { icon: "/brand/games/lineage2m-icon.webp", banner: "/brand/games/lineage2m-banner.webp" },
  "machina-waking": { icon: "/brand/games/machina-waking-icon.webp", banner: null },
  "magic-chess-go-go": { icon: "/brand/games/magic-chess-go-go-icon.webp", banner: null },
  "mobile-legends": { icon: "/brand/games/mobile-legends-icon.webp", banner: "/brand/games/mobile-legends-banner.webp" },
  "mobile-legends-adventure": { icon: "/brand/games/mobile-legends-adventure-icon.webp", banner: "/brand/games/mobile-legends-adventure-banner.webp" },
  "mu-origin-2": { icon: "/brand/games/mu-origin-2-icon.webp", banner: "/brand/games/mu-origin-2-banner.webp" },
  "one-punch-man": { icon: "/brand/games/one-punch-man-icon.webp", banner: "/brand/games/one-punch-man-banner.webp" },
  "onmyoji-arena": { icon: "/brand/games/onmyoji-arena-icon.webp", banner: null },
  "pubg-mobile": { icon: "/brand/games/pubg-mobile-icon.webp", banner: "/brand/games/pubg-mobile-banner.webp" },
  "ragnarok-m-eternal-love": { icon: "/brand/games/ragnarok-m-eternal-love-icon.webp", banner: "/brand/games/ragnarok-m-eternal-love-banner.webp" },
  "rainbow-six-mobile": { icon: "/brand/games/rainbow-six-mobile-icon.webp", banner: null },
  "roblox": { icon: "/brand/games/roblox-icon.webp", banner: null },
  "sausage-man": { icon: "/brand/games/sausage-man-icon.webp", banner: "/brand/games/sausage-man-banner.webp" },
  "speed-drifters": { icon: "/brand/games/speed-drifters-icon.webp", banner: null },
  "state-of-survival": { icon: "/brand/games/state-of-survival-icon.webp", banner: null },
  "super-sus": { icon: "/brand/games/super-sus-icon.webp", banner: null },
  "where-winds-meet": { icon: "/brand/games/where-winds-meet-icon.webp", banner: null },
  "zenless-zone-zero": { icon: "/brand/games/zenless-zone-zero-icon.webp", banner: null },
  "zepeto": { icon: "/brand/games/zepeto-icon.webp", banner: null },
});

const EMPTY: GamesLocalAsset = Object.freeze({ icon: null, banner: null });

export function gamesLocalAsset(slug: unknown): GamesLocalAsset {
  const key = String(slug ?? "").trim().toLowerCase();
  return GAMES_LOCAL_ASSETS[key] ?? EMPTY;
}

export const gamesLocalIcon = (slug: unknown): string | null => gamesLocalAsset(slug).icon;
export const gamesLocalBanner = (slug: unknown): string | null => gamesLocalAsset(slug).banner;
