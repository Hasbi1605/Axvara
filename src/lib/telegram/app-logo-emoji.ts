// src/lib/telegram/app-logo-emoji.ts — Logo aplikasi (custom emoji animasi)
// berdasarkan nama produk, untuk tombol katalog, detail produk dan promo.
//
// Peta ulang 27 Nov 2026 malam dari 37 pack pilihan owner (lihat komentar
// LOGO). ID awal diambil 27 Nov 2026 dari pack ApplicationEmoji, AppsIconsWB,
// Insightxstore, DCoreStoreBot, DigitalizEmoji, UdemyMasterStore, appprem,
// AppPremium dan AkundingBrandLogos_by_Akunding_store_bot; tiap
// logo dicek visual. Aturan dicocokkan berurutan: yang lebih spesifik
// (mis. "YouTube Music", "Adobe Express") HARUS di atas yang umum.

const LOGO = {
  // Peta ulang 27 Nov 2026 malam atas permintaan owner (37 pack yang dibagikan,
  // dicek visual lewat lembar kontak): logo AI/sosial/crypto seragam gaya JABA,
  // animasi diutamakan; "(statis)" = tidak ada versi animasi yang cocok.
  chatgpt: "5310259124817134249", // JABA
  claude: "5321196473784773037", // JABA
  gemini: "5321197740800120767", // JABA
  grok: "5319288443153445517", // JABA
  midjourney: "5310161156613110960", // JABA
  perplexity: "5321199630585732877", // JABA
  muse: "5891219692881714411", // bunnytoolss (statis)
  elevenlabs: "5987854309558066066", // AppsLog (animasi)
  elevenreader: "5949555742582251295", // bunnytoolss (statis, sama dengan StoreBat)
  mscopilot: "5372937764411031477", // ApplicationEmoji
  github: "5319084384962248505", // JABA
  kiro: "6066586789580118982", // ApplicationEmojiCheapLuxuryAIBot (statis)
  cursor: "6298374487939227752", // ApplicationEmojiCheapLuxuryAIBot (statis)
  office: "5354834915345048029", // KorysnostiIcons
  m365: "5879540508572783398", // AppsIconsWB (statis)
  windows: "5307728023280166199", // KorysnostiIcons
  microsoft: "5309880373126113150", // KorysnostiIcons
  word: "5357433404918866587", // KorysnostiIcons
  excel: "5357379528849106868", // KorysnostiIcons
  powerpoint: "5355272843095449523", // KorysnostiIcons
  msproject: "5253610035191234471", // JABA soft
  netflix: "5366477429223209600", // JABA
  spotify: "5233578612665375810", // JABA
  applemusic: "5318890501548570977", // JABA
  youtube: "5321505140199418151", // JABA
  youtubemusic: "5335036005168728789", // JABA brands
  disney: "5884437729067932014", // AppsIconsWB (statis, logo Disney+ terbaru)
  hbo: "5346319945112240722", // ApplicationEmoji
  youku: "6174919776184311543", // namlc1Emoji (statis)
  iqiyi: "6165677491894624269", // namlc1Emoji (statis)
  crunchyroll: "4958988936681620024", // streaming_emojis (statis)
  viu: "6172215587465334604", // Random_bebaspakai (statis, kiriman owner 28 Nov 2026)
  canva: "5900192223160438756", // AppsIconsWB (statis)
  capcut: "5364339557712020484", // ApplicationEmoji
  zoom: "5334934296048193646", // JABA brands
  notion: "5334930671095793808", // JABA brands
  grammarly: "5334614570092744019", // JABA brands
  adobecc: "5278478123468340584", // JABA soft
  adobeexpress: "5278668274555436578", // JABA soft
  acrobat: "5278718972349399923", // JABA soft
  firefly: "5395313251238049131", // m0nkrus (statis)
  photoshop: "5352556692892564574", // JABA
  illustrator: "5354937148451600987", // JABA
  aftereffects: "5355325791452281549", // JABA
  premiere: "5352591263084330931", // JABA
  lightroom: "5276274994224054385", // JABA soft
  figma: "5352668512366115705", // JABA
  ilovepdf: "6206155660283879718", // namlc1Emoji (statis)
  wattpad: "5883996592976957180", // AppsIconsWB (statis)
  camscanner: "5879934262584545380", // AppsIconsWB (statis)
  apple: "5318795767454923927", // JABA
  meitu: "6177045544477662408", // namlc1Emoji (statis)
  alight: "6287057966373805879", // namlc1Emoji (statis)
  picsart: "5877624510777135360", // AppsIconsWB (statis)
  gmail: "5935891935490216040", // applicationsicon
  hma: "5879636621350933766", // AppsIconsWB (statis)
  surfshark: "5879507561878654934", // AppsIconsWB (statis)
  expressvpn: "5868200072629458257", // AppsIconsWB (statis)
  nordvpn: "5879826927056850883", // AppsIconsWB (statis)
  protonvpn: "5870566921732100562", // AppsIconsWB (statis)
  jetbrains: "5300808388584678952", // dev_emojis_solid (statis)
  tradingview: "5870756282545213172", // AppsIconsWB (statis)
  card: "5445353829304387411", // FinanceEmoji
  kick: "5206341617996300902", // AppLogosEmoji
  roblox: "6129532198182723368", // namlc1Emoji (statis)
  coinmarketcap: "5336953394533780524", // JABA
  vimeo: "5334764984142412896", // ApplicationEmoji
  tumblr: "5328242556612395440", // ApplicationEmoji
  medium: "5325647210954637197", // ApplicationEmoji
  dribbble: "5334666109700294414", // JABA brands
  reddit: "5319276623403458717", // JABA
  qriscode: "5440410042773824003", // kode QR animasi pilihan owner (baris QRIS pesan sambutan)
  getcontact: "6183630429422094747", // Random_bebaspakai (statis)
  dramabox: "6102843344419819687", // Random_bebaspakai (statis)
  drakor: "6172461238119828547", // Random_bebaspakai (statis)
  fizzo: "6143365708022550941", // Random_bebaspakai (statis)
  visionplus: "6179306432442142921", // Random_bebaspakai (statis)
  loklok: "6154496081410397543", // Random_bebaspakai (statis)
  leonardo: "6133975818591805751", // namlc1Emoji (statis)
  gamma: "5988084597114543318", // AppsLog
  udemy: "5228729521573764600", // UdemyMasterStore (statis)
  edx: "5917894076899795088", // cnmojis (statis)
  skillshare: "5100745878474327235", // NopehxStreamings (statis)
  instagram: "5364310996179503764", // JABA
  tiktok: "5391044040860906456", // JABA
  facebook: "5389064576333527180", // JABA
  threads: "5233449944035123527", // JABA
  x: "5233376087777501917", // JABA
  telegram: "5364125616801073577", // JABA
  whatsapp: "5233354831984353090", // JABA
  discord: "5233582387941630314", // JABA
  twitch: "5233333563306301418", // JABA
  pinterest: "5368456936700263949", // JABA
  linkedin: "5321272434576355870", // JABA
  soundcloud: "5366186127361326004", // JABA
  steam: "5318801707394695066", // JABA
  playstation: "5363934885893389858", // JABA
  xbox: "5366104999724072406", // JABA
  website: "5332618260703624145", // JABA
  usdt: "5413589900450625318", // JABA
  usdc: "5388945416760866233", // JABA
  btc: "5388637433246003258", // JABA
  eth: "5388839713320742959", // JABA
  bnb: "5280848571753584087", // JABA
  trx: "5391239186994967770", // JABA
  ton: "5312441698347934993", // JABA
  ltc: "5389057313543828476", // JABA
  sol: "5244831238002335293", // JABA
  doge: "5282989316597894472", // JABA
  xrp: "5199528541439406759", // JABA
  qris: "6339136888674192137", // iconrekening (@kunyuk, logo QRIS resmi, statis)
  shopee: "6052988884466272744", // iconrekening (@kunyuk, statis)
  gamepad: "5319120041780726017", // IslomjonAnimeEmoji
  check: "6267225207560214192", // ZNV CLAN
  // Dipertahankan dari pemetaan awal (belum ada yang lebih cocok)
  prime: "5877697061364698656",
  duolingo: "5249484813592717631", // animasi (app_set)
  coursera: "5082727863602381620",
  cyberghost: "5879870563924579090",
  dropbox: "5372994299065550645",
  gdrive: "5372878055775683161",
  audible: "5882068715301769392",
  deezer: "5899774597720445767",
  tidal: "5870489702515085884",
  headspace: "5305538835499757151",
  wetv: "6210892326311562345",
  vidio: "6212786664587135856",
  remini: "6212911124149439872",
  wink: "6057739384583628047", // violastore_bot (statis)
  scribd: "6210943865919114393",
  bilibili: "5335012820935261564", // ApplicationEmoji
  iflix: "6192694876295923684",
  ibispaint: "6160979897184422552",
  beautyplus: "6188235123989679041",
} as const;

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // AI — Grok di atas Cursor ("Grok + Cursor Premium"), Reader di atas Labs.
  [/chat\s*gpt|openai|\bgpt\b|codex|sora/i, LOGO.chatgpt],
  [/claude|anthropic/i, LOGO.claude],
  [/gemini|google\s*ai/i, LOGO.gemini],
  [/grok/i, LOGO.grok],
  [/\bmuse\b/i, LOGO.muse],
  [/eleven\s*reader/i, LOGO.elevenreader],
  [/eleven\s*labs?/i, LOGO.elevenlabs],
  [/microsoft\s*copilot|copilot\s*(pro|premium)/i, LOGO.mscopilot],
  [/github|copilot/i, LOGO.github],
  [/\bkiro\b/i, LOGO.kiro],
  [/cursor/i, LOGO.cursor],
  [/midjourney/i, LOGO.midjourney],
  [/perplexity/i, LOGO.perplexity],
  [/gamma/i, LOGO.gamma],
  [/leonardo/i, LOGO.leonardo],
  [/email\s*(kampus|student|edu)|\bgmail\b/i, LOGO.gmail],
  [/jetbrains/i, LOGO.jetbrains],
  [/trading\s*view/i, LOGO.tradingview],
  [/canva/i, LOGO.canva],
  [/cap\s*cut/i, LOGO.capcut],
  // Streaming
  [/netflix/i, LOGO.netflix],
  [/spotify/i, LOGO.spotify],
  [/youtube\s*music/i, LOGO.youtubemusic],
  [/youtube/i, LOGO.youtube],
  [/disney|hotstar/i, LOGO.disney],
  [/\bhbo\b|hbo\s*max|\bmax\s+(standard|ultimate|premium)/i, LOGO.hbo],
  [/prime\s*video|amazon\s*prime/i, LOGO.prime],
  [/apple\s*music/i, LOGO.applemusic],
  [/apple\s*(tv|one|icloud|arcade)|icloud/i, LOGO.apple],
  [/youku/i, LOGO.youku],
  [/iqiyi/i, LOGO.iqiyi],
  [/crunchyroll/i, LOGO.crunchyroll],
  [/\bviu\b/i, LOGO.viu],
  [/we\s*tv/i, LOGO.wetv],
  [/vidio/i, LOGO.vidio],
  [/bilibili|bstation/i, LOGO.bilibili],
  [/iflix/i, LOGO.iflix],
  [/loklok/i, LOGO.loklok],
  [/vision\s*(\+|plus)/i, LOGO.visionplus],
  [/fizzo/i, LOGO.fizzo],
  [/drakor/i, LOGO.drakor],
  [/drama\s*box/i, LOGO.dramabox],
  [/get\s*contact/i, LOGO.getcontact],
  // Produktivitas — Microsoft dibedakan per produk
  [/zoom/i, LOGO.zoom],
  [/notion/i, LOGO.notion],
  [/duolingo/i, LOGO.duolingo],
  [/microsoft\s*word|\bword\b/i, LOGO.word],
  [/\bexcel\b/i, LOGO.excel],
  [/power\s*point/i, LOGO.powerpoint],
  [/microsoft\s*project|\bms\s*project\b/i, LOGO.msproject],
  [/windows/i, LOGO.windows],
  [/office\s*365|\boffice\b/i, LOGO.office],
  [/microsoft\s*365|\bm365\b|\bms\s*365\b/i, LOGO.m365],
  [/microsoft|\bvisio\b/i, LOGO.microsoft],
  [/grammarly/i, LOGO.grammarly],
  [/ilove\s*pdf|i\s*love\s*pdf/i, LOGO.ilovepdf],
  [/cam\s*scanner/i, LOGO.camscanner],
  [/wattpad/i, LOGO.wattpad],
  [/scribd|everand/i, LOGO.scribd],
  [/udemy/i, LOGO.udemy],
  [/coursera/i, LOGO.coursera],
  [/skillshare/i, LOGO.skillshare],
  [/\bedx\b/i, LOGO.edx],
  [/dropbox/i, LOGO.dropbox],
  [/google\s*(drive|one)/i, LOGO.gdrive],
  // Adobe & kreatif
  [/adobe\s*express/i, LOGO.adobeexpress],
  [/firefly/i, LOGO.firefly],
  [/creative\s*cloud/i, LOGO.adobecc],
  [/acrobat|adobe\s*(pdf|reader)/i, LOGO.acrobat],
  [/photoshop/i, LOGO.photoshop],
  [/illustrator/i, LOGO.illustrator],
  [/premiere/i, LOGO.premiere],
  [/after\s*effects/i, LOGO.aftereffects],
  [/lightroom/i, LOGO.lightroom],
  [/figma/i, LOGO.figma],
  [/picsart/i, LOGO.picsart],
  [/meitu/i, LOGO.meitu],
  [/alight\s*motion/i, LOGO.alight],
  [/remini/i, LOGO.remini],
  [/\bwink\b/i, LOGO.wink],
  [/ibis\s*paint/i, LOGO.ibispaint],
  [/beauty\s*plus/i, LOGO.beautyplus],
  // VPN
  [/\bhma\b|hide\s*my\s*ass/i, LOGO.hma],
  [/surf\s*shark/i, LOGO.surfshark],
  [/express\s*vpn/i, LOGO.expressvpn],
  [/nord\s*vpn/i, LOGO.nordvpn],
  [/proton/i, LOGO.protonvpn],
  [/cyber\s*ghost/i, LOGO.cyberghost],
  // Sosial, game & lain-lain
  [/telegram/i, LOGO.telegram],
  [/whats\s*app/i, LOGO.whatsapp],
  [/instagram/i, LOGO.instagram],
  [/tik\s*tok/i, LOGO.tiktok],
  [/steam/i, LOGO.steam],
  [/playstation|\bpsn\b/i, LOGO.playstation],
  [/xbox|game\s*pass/i, LOGO.xbox],
  [/twitch/i, LOGO.twitch],
  [/discord/i, LOGO.discord],
  [/linkedin/i, LOGO.linkedin],
  [/audible/i, LOGO.audible],
  [/deezer/i, LOGO.deezer],
  [/tidal/i, LOGO.tidal],
  [/soundcloud/i, LOGO.soundcloud],
  [/headspace/i, LOGO.headspace],
  [/\bvcc\b/i, LOGO.card],
];

function disabled(): boolean {
  const flag = (process.env.TELEGRAM_CUSTOM_EMOJI ?? "").trim().toLowerCase();
  return flag === "off" || flag === "false" || flag === "0";
}

/**
 * Logo merek untuk kunci tetap (platform Pedia, koin crypto, QRIS), bukan
 * nama produk. Kunci tak dikenal → undefined.
 */
const BRAND_KEYS: Readonly<Record<string, string>> = {
  instagram: LOGO.instagram, tiktok: LOGO.tiktok, youtube: LOGO.youtube, facebook: LOGO.facebook,
  threads: LOGO.threads, x: LOGO.x, telegram: LOGO.telegram, linkedin: LOGO.linkedin,
  pinterest: LOGO.pinterest, discord: LOGO.discord, spotify: LOGO.spotify, soundcloud: LOGO.soundcloud,
  twitch: LOGO.twitch, github: LOGO.github, website: LOGO.website, shopee: LOGO.shopee,
  whatsapp: LOGO.whatsapp, reddit: LOGO.reddit, dribbble: LOGO.dribbble, medium: LOGO.medium,
  tumblr: LOGO.tumblr, vimeo: LOGO.vimeo, tidal: LOGO.tidal, coinmarketcap: LOGO.coinmarketcap,
  roblox: LOGO.roblox, kick: LOGO.kick,
  USDT: LOGO.usdt, USDC: LOGO.usdc, BTC: LOGO.btc, ETH: LOGO.eth, BNB: LOGO.bnb, TRX: LOGO.trx,
  TON: LOGO.ton, LTC: LOGO.ltc, SOL: LOGO.sol, DOGE: LOGO.doge, XRP: LOGO.xrp,
  qris: LOGO.qris,
  qriscode: LOGO.qriscode,
};

/** Spread ke tombol untuk kunci merek tetap: `{ text, ...brandIcon("BTC") }`. */
export function brandIcon(key: string | null | undefined): { icon_custom_emoji_id?: string } {
  if (!key || disabled()) return {};
  const id = BRAND_KEYS[key];
  return id ? { icon_custom_emoji_id: id } : {};
}

/** Potongan HTML ikon merek tetap (`<tg-emoji>`), atau `fallback` bila tidak dikenal/dimatikan. */
export function brandHtml(key: string, fallback: string): string {
  const id = disabled() ? undefined : BRAND_KEYS[key];
  return id ? `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>` : fallback;
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
