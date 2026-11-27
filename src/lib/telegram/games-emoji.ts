// src/lib/telegram/games-emoji.ts — Custom emoji AXVARA Games untuk Bot Telegram.
//
// Pack milik owner, dibuat 27 Nov 2026 oleh @Axvara_bot dari aset web:
//   https://t.me/addemoji/axvara_games_by_Axvara_bot      — logo game (public/brand/games/<slug>-icon.webp)
//   https://t.me/addemoji/axvara_game_items_by_Axvara_bot — ikon nominal (public/brand/games/items/*.webp)
// Gambar 100×100: logo dibulatkan sudutnya, ikon dipotong ke bbox alfa lalu dipusatkan.
// Game/ikon baru: tambah aset web, unggah ke pack (addStickerToSet), lalu tambah ID di sini.

import { gamesItemIcon } from "@/lib/games/item-icons";

export const GAME_LOGO_EMOJI: Readonly<Record<string, string>> = {
  "aniimo": "6073539066027062334",
  "arena-breakout": "6075466071823885699",
  "arena-of-valor": "6073356040290707373",
  "au2-mobile": "6075692644233651175",
  "blood-strike": "6075855724141879400",
  "call-of-duty-mobile": "6075619908962493078",
  "captain-tsubasa-ace": "6075469258689619268",
  "crossfire-legends": "6073202147317525083",
  "delta-force": "6073571329821385942",
  "dragon-city": "6073217922732402698",
  "fc-mobile": "6075853688327383302",
  "football-master-2": "6075670722720572127",
  "free-fire": "6075369933275930335",
  "free-fire-max": "6073307073368564951",
  "gangstar-mirage-city": "6075583844122108231",
  "garena-undawn": "6075645751780712188",
  "genshin-impact": "6073158132492673955",
  "growtopia": "6073395236162250918",
  "haikyu-fly-high": "6073350001566690036",
  "heartopia": "6075502875398644418",
  "honkai-star-rail": "6075822244871807426",
  "honor-of-kings": "6073330712868561603",
  "identity-v": "6075640537690415604",
  "laplace-m": "6075362026241140044",
  "league-of-legends-wild-rift": "6075597089801248956",
  "lifeafter": "6075682216053057712",
  "lineage2m": "6075786059772340456",
  "machina-waking": "6075449806782736833",
  "magic-chess-go-go": "6075879866153051094",
  "marvel-rivals": "6073487612318852854",
  "mobile-legends-adventure": "6075863102895693772",
  "mobile-legends": "6075477616695977128",
  "mu-origin-2": "6075464946542453953",
  "one-punch-man": "6073111635176727484",
  "onmyoji-arena": "6075737728505357772",
  "point-blank": "6073441849442314108",
  "pubg-mobile": "6075840421173405562",
  "ragnarok-m-eternal-love": "6075418054089515943",
  "rainbow-six-mobile": "6075786274520704645",
  "roblox": "6075413544373854614",
  "sausage-man": "6075529117648824308",
  "speed-drifters": "6075760964278428728",
  "state-of-survival": "6073185512909186215",
  "super-sus": "6075505718666994168",
  "valorant": "6073152832503031305",
  "where-winds-meet": "6075559354218586947",
  "zenless-zone-zero": "6075376105143935994",
  "zepeto": "6075786751262073459",
};

export const GAME_ITEM_EMOJI: Readonly<Record<string, string>> = {
  "codm-cp-1": "6075456064550085709",
  "codm-cp-2": "6075726217993003651",
  "codm-cp-3": "6075725122776343773",
  "coin-1": "6075812924792776013",
  "coin-2": "6075852438491897907",
  "coin-3": "6075675649048061664",
  "ff-diamond-1": "6075373742911923132",
  "ff-diamond-2": "6075687696431326529",
  "ff-diamond-3": "6075432253251397746",
  "ff-monthly-membership": "6075843749773058838",
  "ff-weekly-lite": "6075897277950469635",
  "ff-weekly-membership": "6075778534989636928",
  "gem-1": "6075590767609391463",
  "gem-2": "6075889138987444982",
  "gem-3": "6073352204884911247",
  "genshin-crystal-1": "6075407853542187851",
  "genshin-crystal-2": "6075633566958494692",
  "genshin-crystal-3": "6073507158715016780",
  "genshin-welkin-moon": "6075585562109026150",
  "gift": "6075411916581250111",
  "hok-token-1": "6073255958962775672",
  "hok-token-2": "6073374899492103579",
  "hok-token-3": "6075751270537241497",
  "hsr-express-supply-pass": "6075777143420233557",
  "hsr-shard-1": "6073304006761915173",
  "hsr-shard-2": "6075431471567348102",
  "hsr-shard-3": "6073174646641927233",
  "member": "6073530544811943702",
  "ml-starlight": "6075810386467103866",
  "ml-twilight-pass": "6075673132197224635",
  "ml-weekly-diamond-pass": "6075514042313615456",
  "mlbb-diamond-1": "6073200420740670567",
  "mlbb-diamond-2": "6073324914662713257",
  "mlbb-diamond-3": "6075862604679487224",
  "pack": "6073204578269014614",
  "pass": "6073184409102592060",
  "promo": "6075838402538775860",
  "pubg-royale-pass": "6073287522677433289",
  "pubg-uc-1": "6075372802314084962",
  "pubg-uc-2": "6075671139332399333",
  "pubg-uc-3": "6073268740785447230",
  "roblox-gift-card": "6075687219689956736",
  "robux-1": "6075490896734855758",
  "robux-2": "6075643711671247221",
  "robux-3": "6075764116784423006",
  "special": "6075521584276186109",
  "valorant-points-1": "6075658774121558662",
  "valorant-points-2": "6075378458786014008",
  "valorant-points-3": "6075915338287950109",
  "wild-rift-core-1": "6075554694179072359",
  "wild-rift-core-2": "6075546873043624183",
  "wild-rift-core-3": "6075496583271556834",
  "zzz-monochrome-1": "6075397030224603209",
  "zzz-monochrome-2": "6075507763071427533",
  "zzz-monochrome-3": "6075687163855381122",
};

function disabled(): boolean {
  const flag = (process.env.TELEGRAM_CUSTOM_EMOJI ?? "").trim().toLowerCase();
  return flag === "off" || flag === "false" || flag === "0";
}

/** Spread ke tombol game: `{ text, ...gameLogoIcon(slug) }`. */
export function gameLogoIcon(slug: string | null | undefined): { icon_custom_emoji_id?: string } {
  const id = slug && !disabled() ? GAME_LOGO_EMOJI[slug] : undefined;
  return id ? { icon_custom_emoji_id: id } : {};
}

/** Logo game sebagai HTML (`<tg-emoji>`), atau `fallback` bila tidak ada/dimatikan. */
export function gameLogoHtml(slug: string | null | undefined, fallback = "🎮"): string {
  const id = slug && !disabled() ? GAME_LOGO_EMOJI[slug] : undefined;
  return id ? `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>` : fallback;
}

/** Ikon nominal yang sama dengan web (`gamesItemIcon`) → spread ke tombol SKU. */
export function gameItemIcon(
  slug: string,
  product: Parameters<typeof gamesItemIcon>[1],
  rank?: { index: number; total: number },
): { icon_custom_emoji_id?: string } {
  if (disabled()) return {};
  const key = gamesItemIcon(slug, product, rank).split("/").pop()?.replace(/\.webp$/, "") ?? "";
  const id = GAME_ITEM_EMOJI[key];
  return id ? { icon_custom_emoji_id: id } : {};
}
