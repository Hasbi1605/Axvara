// src/lib/telegram/app-logo-emoji.ts — Logo aplikasi (custom emoji animasi)
// berdasarkan nama produk, untuk tombol katalog, detail produk dan promo.
//
// ID diambil 27 Nov 2026 dari pack ApplicationEmoji, AppsIconsWB,
// Insightxstore, DCoreStoreBot, DigitalizEmoji, UdemyMasterStore, appprem,
// AppPremium dan AkundingBrandLogos_by_Akunding_store_bot; tiap
// logo dicek visual. Aturan dicocokkan berurutan: yang lebih spesifik
// (mis. "YouTube Music", "Adobe Express") HARUS di atas yang umum.

const LOGO = {
  chatgpt: "5359726582447487916",
  claude: "5417984549642601364", // animasi (app_set)
  gemini: "5440706056214840396", // animasi (app_set)
  elevenlabs: "5305733994518700539", // animasi (app_set)
  copilot: "5372937764411031477",
  midjourney: "5359618237602480327",
  canva: "5879982576671657703",
  capcut: "5364339557712020484",
  netflix: "5318911503938634641",
  spotify: "5346074681004801565",
  youtubemusic: "5870597514784150136",
  youtube: "5334681713316479679",
  disney: "5332394707655869572",
  hbo: "5346319945112240722",
  prime: "5877697061364698656",
  applemusic: "5346251367369425932",
  apple: "5334955749409834455",
  zoom: "5334932883003949665",
  notion: "5364199932620194408",
  duolingo: "5249484813592717631", // animasi (app_set)
  microsoft: "5370857634440170316",
  word: "5879737140765527783",
  excel: "5877198664769736986",
  powerpoint: "5877662216295025964",
  adobeexpress: "5240231297963565442",
  acrobat: "5305721281415505693", // animasi (app_set)
  photoshop: "5359480394922082925",
  illustrator: "5359320531944358335",
  premiere: "5363973751052452405",
  aftereffects: "5357394595594388140",
  lightroom: "5305466718703871498", // animasi (app_set)
  udemy: "5228729521573764600",
  coursera: "5082727863602381620",
  skillshare: "5078141478480381355",
  edx: "5008559864369120538",
  grammarly: "5879859242390786365",
  picsart: "5877624510777135360",
  protonvpn: "5870816768569643122",
  expressvpn: "5868200072629458257",
  nordvpn: "5240047889975124109",
  cyberghost: "5879870563924579090",
  dropbox: "5372994299065550645",
  gdrive: "5372878055775683161",
  telegram: "5330237710655306682",
  whatsapp: "5334998226636390258",
  instagram: "5319160079465857105",
  tiktok: "5327982530702359565",
  steam: "5373144051690258848",
  playstation: "5373306783706137993",
  xbox: "5373019729566908647",
  twitch: "5334678011054669335",
  discord: "5325612636467903082",
  figma: "5357286671656176924",
  linkedin: "5346024520081751155",
  audible: "5882068715301769392",
  crunchyroll: "5913528148154126357",
  deezer: "5899774597720445767",
  tidal: "5870489702515085884",
  soundcloud: "5345844509412444249",
  headspace: "5305538835499757151",
  // Tambahan 27 Nov 2026 (pack appprem, AppPremium, AkundingBrandLogos)
  wetv: "6210892326311562345",
  vidio: "6212786664587135856",
  remini: "6212911124149439872",
  alight: "6213194969948098573",
  wink: "6212809230345309185",
  scribd: "6210943865919114393",
  iqiyi: "6213255657835990774",
  bilibili: "6213188274094083250",
  iflix: "6192694876295923684",
  ibispaint: "6160979897184422552",
  ilovepdf: "6165591004138180323",
  beautyplus: "6188235123989679041",
  surfshark: "5841245343211069842",
  perplexity: "5821441463757580403",
} as const;

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/chat\s*gpt|openai|\bgpt\b|codex|sora/i, LOGO.chatgpt],
  [/claude|anthropic/i, LOGO.claude],
  [/gemini/i, LOGO.gemini],
  [/eleven\s*(labs|reader)/i, LOGO.elevenlabs],
  [/copilot/i, LOGO.copilot],
  [/midjourney/i, LOGO.midjourney],
  [/canva/i, LOGO.canva],
  [/cap\s*cut/i, LOGO.capcut],
  [/netflix/i, LOGO.netflix],
  [/spotify/i, LOGO.spotify],
  [/youtube\s*music/i, LOGO.youtubemusic],
  [/youtube/i, LOGO.youtube],
  [/disney|hotstar/i, LOGO.disney],
  [/\bhbo\b|hbo\s*max|\bmax\s+(standard|ultimate|premium)/i, LOGO.hbo],
  [/prime\s*video|amazon\s*prime/i, LOGO.prime],
  [/apple\s*music/i, LOGO.applemusic],
  [/apple\s*(tv|one|icloud)|icloud/i, LOGO.apple],
  [/zoom/i, LOGO.zoom],
  [/notion/i, LOGO.notion],
  [/duolingo/i, LOGO.duolingo],
  [/adobe\s*express/i, LOGO.adobeexpress],
  [/acrobat|adobe\s*(pdf|reader)/i, LOGO.acrobat],
  [/photoshop/i, LOGO.photoshop],
  [/illustrator/i, LOGO.illustrator],
  [/premiere/i, LOGO.premiere],
  [/after\s*effects/i, LOGO.aftereffects],
  [/lightroom/i, LOGO.lightroom],
  [/microsoft\s*word|\bword\b/i, LOGO.word],
  [/\bexcel\b/i, LOGO.excel],
  [/power\s*point/i, LOGO.powerpoint],
  [/microsoft|office\s*365|\bm365\b|windows|visio|\bms\s*project\b|microsoft\s*project/i, LOGO.microsoft],
  [/udemy/i, LOGO.udemy],
  [/coursera/i, LOGO.coursera],
  [/skillshare/i, LOGO.skillshare],
  [/\bedx\b/i, LOGO.edx],
  [/grammarly/i, LOGO.grammarly],
  [/picsart/i, LOGO.picsart],
  [/proton/i, LOGO.protonvpn],
  [/express\s*vpn/i, LOGO.expressvpn],
  [/nord\s*vpn/i, LOGO.nordvpn],
  [/cyber\s*ghost/i, LOGO.cyberghost],
  [/dropbox/i, LOGO.dropbox],
  [/google\s*(drive|one)/i, LOGO.gdrive],
  [/telegram/i, LOGO.telegram],
  [/whats\s*app/i, LOGO.whatsapp],
  [/instagram/i, LOGO.instagram],
  [/tik\s*tok/i, LOGO.tiktok],
  [/steam/i, LOGO.steam],
  [/playstation|\bpsn\b/i, LOGO.playstation],
  [/xbox|game\s*pass/i, LOGO.xbox],
  [/twitch/i, LOGO.twitch],
  [/discord/i, LOGO.discord],
  [/figma/i, LOGO.figma],
  [/linkedin/i, LOGO.linkedin],
  [/audible/i, LOGO.audible],
  [/crunchyroll/i, LOGO.crunchyroll],
  [/deezer/i, LOGO.deezer],
  [/tidal/i, LOGO.tidal],
  [/soundcloud/i, LOGO.soundcloud],
  [/headspace/i, LOGO.headspace],
  [/we\s*tv/i, LOGO.wetv],
  [/vidio/i, LOGO.vidio],
  [/remini/i, LOGO.remini],
  [/alight\s*motion/i, LOGO.alight],
  [/\bwink\b/i, LOGO.wink],
  [/scribd|everand/i, LOGO.scribd],
  [/iqiyi/i, LOGO.iqiyi],
  [/bilibili|bstation/i, LOGO.bilibili],
  [/iflix/i, LOGO.iflix],
  [/ibis\s*paint/i, LOGO.ibispaint],
  [/ilove\s*pdf/i, LOGO.ilovepdf],
  [/beauty\s*plus/i, LOGO.beautyplus],
  [/surf\s*shark/i, LOGO.surfshark],
  [/perplexity/i, LOGO.perplexity],
];

function disabled(): boolean {
  const flag = (process.env.TELEGRAM_CUSTOM_EMOJI ?? "").trim().toLowerCase();
  return flag === "off" || flag === "false" || flag === "0";
}

/** custom_emoji_id logo aplikasi untuk nama produk, atau undefined. */
export function appLogoEmojiId(productName: string | null | undefined): string | undefined {
  if (!productName || disabled()) return undefined;
  for (const [re, id] of RULES) if (re.test(productName)) return id;
  return undefined;
}

/**
 * Potongan HTML logo produk: `<tg-emoji>` berlogo bila dikenal, selain itu
 * `fallback` apa adanya (emoji standar, nanti dihias peta umum).
 */
export function appLogoHtml(productName: string | null | undefined, fallback: string): string {
  const id = appLogoEmojiId(productName);
  return id ? `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>` : fallback;
}

/** Spread ke tombol: `{ text, ...appLogoIcon(name) }`. */
export function appLogoIcon(productName: string | null | undefined): { icon_custom_emoji_id?: string } {
  const id = appLogoEmojiId(productName);
  return id ? { icon_custom_emoji_id: id } : {};
}
