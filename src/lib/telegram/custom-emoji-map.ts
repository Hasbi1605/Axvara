// src/lib/telegram/custom-emoji-map.ts — Peta emoji standar → custom emoji ID
// (premium/animasi) untuk bot Telegram AXVARA.
//
// Bot API 9.4+: bot boleh memakai custom emoji di pesan yang dikirim langsung
// ke chat privat/grup/supergrup dan sebagai ikon tombol
// (`icon_custom_emoji_id`) selama pemilik bot berlangganan Telegram Premium.
//
// Kunci = emoji standar TANPA variation selector (U+FE0F); pencocokan di
// `custom-emoji.ts` menerima kedua bentuk. Nilai = `custom_emoji_id`.
//
// Sumber pack (dipilih owner 27 Nov 2026 + pelengkap):
//   NewsEmoji, ZEROX_660_by_TgEmodziBot (ZNV CLAN), IconsEmoji_JABA,
//   FinanceEmoji, FlagsEmoji, IslomjonAnimeEmoji — lihat https://t.me/addemoji/<nama>.
// Regenerasi dari pack lain: node scripts/telegram-custom-emoji-pack.mjs <pack>

export const CUSTOM_EMOJI_MAP: Readonly<Record<string, string>> = {
  // Navigasi
  "🏠": "5416041192905265756", // NewsEmoji
  "◀": "5332348837405145999", // IconsEmoji_JABA (panah kiri tebal)
  "▶": "5332684922891025384", // IconsEmoji_JABA (panah kanan tebal)
  "⬅": "5332348837405145999", // IconsEmoji_JABA (panah kiri tebal)
  "➡": "5332684922891025384", // IconsEmoji_JABA (panah kanan tebal)
  "⬇": "5406745015365943482", // NewsEmoji
  "🔄": "6282685788450721937", // DSPSIR_by_TgEmojis_bot (panah refresh)
  "🔁": "6282685788450721937", // DSPSIR_by_TgEmojis_bot (panah refresh)
  "🔎": "5231012545799666522", // NewsEmoji
  "🔍": "5231012545799666522", // NewsEmoji
  "📂": "5332586662629227075", // IconsEmoji_JABA
  "🗂": "5332586662629227075", // IconsEmoji_JABA
  "⚙": "5341715473882955310", // NewsEmoji
  "ℹ": "5334544901428229844", // NewsEmoji
  "❓": "5436113877181941026", // NewsEmoji
  "🔗": "5271604874419647061", // NewsEmoji
  "🌐": "5447410659077661506", // NewsEmoji
  "🌏": "5224450179368767019", // FinanceEmoji
  "🌍": "5224450179368767019", // FinanceEmoji
  "🌎": "5224450179368767019", // FinanceEmoji
  // Status
  "✅": "6267225207560214192", // ZNV CLAN (gaya centang Viola, pilihan owner)
  "✔": "5206607081334906820", // NewsEmoji
  "❌": "5210952531676504517", // NewsEmoji
  "✖": "5271934564699226262", // IconsEmoji_JABA (silang merah)
  "⚠": "5447644880824181073", // NewsEmoji
  "🚨": "5395695537687123235", // NewsEmoji
  "⏳": "6267229004311303657", // ZNV CLAN
  "⌛": "5386367538735104399", // NewsEmoji
  "⏱": "5382194935057372936", // FinanceEmoji
  "⚡": "5456140674028019486", // NewsEmoji
  "🔔": "5458603043203327669", // NewsEmoji
  "🔐": "5296369303661067030", // NewsEmoji
  "🔒": "5296369303661067030", // NewsEmoji
  "🛡": "5251203410396458957", // NewsEmoji
  "🟢": "5332440771180116150", // IconsEmoji_JABA
  "🟡": "5332345843812943191", // IconsEmoji_JABA
  "🟠": "5332369556327383798", // IconsEmoji_JABA
  "🔴": "5377620300965888937", // IconsEmoji_JABA
  "🔵": "5332571076192910271", // IconsEmoji_JABA
  "🟣": "5332694612337244014", // IconsEmoji_JABA
  // Belanja & pembayaran
  "🛍": "5406683434124859552", // NewsEmoji (stiker SALE, dikembalikan atas permintaan owner)
  "🛒": "5312361253610475399", // FinanceEmoji
  "📦": "5429263077927300012", // IslomjonAnimeEmoji (kotak; dulu logo Nova Poshta)
  "💳": "5472250091332993630", // TONEmoji (kartu hijau + koin animasi, pilihan owner)
  "🪙": "5377505475015235101", // FinanceEmoji
  "💰": "6267068789146260253", // ZNV CLAN
  "💵": "5409048419211682843", // NewsEmoji
  "💸": "5233326571099534068", // NewsEmoji
  "💱": "5402186569006210455", // NewsEmoji
  "🧾": "5444856076954520455", // FinanceEmoji
  "🏷": "5240228673738527951", // FinanceEmoji
  "🏦": "5332455502917949981", // IconsEmoji_JABA
  "🧮": "5303214794336125778", // FinanceEmoji
  "💼": "5445221832074483553", // FinanceEmoji
  "📈": "5244837092042750681", // NewsEmoji
  "📉": "5246762912428603768", // NewsEmoji
  "📊": "5231200819986047254", // NewsEmoji
  "📤": "5445355530111437729", // FinanceEmoji
  "📥": "5443127283898405358", // FinanceEmoji
  "🎁": "5309849913218071967", // IconsEmoji_JABA
  "💎": "5427168083074628963", // NewsEmoji
  "👑": "5217822164362739968", // NewsEmoji
  "🆓": "5406756500108501710", // NewsEmoji
  // Komunikasi & akun
  "💬": "5443038326535759644", // NewsEmoji
  "📧": "5366201992970518798", // IconsEmoji_JABA
  "✉": "5253742260054409879", // NewsEmoji
  "📩": "5253742260054409879", // NewsEmoji (amplop)
  "📢": "5424818078833715060", // NewsEmoji
  "📣": "5424818078833715060", // NewsEmoji
  "✈": "5364125616801073577", // IconsEmoji_JABA
  "📞": "5233354831984353090", // IconsEmoji_JABA
  "🤖": "5287684458881756303", // DogsEmoji (robot, pilihan owner; ikon kategori AI)
  "👤": "5819154994967874788", // iconemoji1 (orang dengan laptop)
  "💻": "6129469062163471210", // getmodpc (laptop)
  "📱": "6053360738439798205", // getmodpc (ponsel)
  "🖥": "5282843764451195532", // NewsEmoji
  "✍": "5197269100878907942", // FinanceEmoji
  "✏": "5395444784611480792", // NewsEmoji
  "🗓": "5413879192267805083", // NewsEmoji
  "📌": "5397782960512444700", // NewsEmoji
  "📍": "5391032818111363540", // NewsEmoji
  "🗑": "5445267414562389170", // NewsEmoji
  "➕": "5397916757333654639", // NewsEmoji
  // Kategori & hiburan
  "🎮": "5319120041780726017", // IslomjonAnimeEmoji (stik analog, pilihan owner)
  "🎵": "5463107823946717464", // NewsEmoji
  "🎤": "5224736245665511429", // NewsEmoji
  "🎥": "5348125953090403204", // NewsEmoji (tombol play; dulu logo YouTube)
  "📸": "5364310996179503764", // IconsEmoji_JABA
  "🎨": "5321030241370531982", // Top Hat @GiftChanges (topi animasi, pilihan owner; kategori Desain & Video)
  "🎯": "5310278924616356636", // FinanceEmoji
  "🎬": "5794077849157636817", // editing_club (clapperboard animasi, pilihan owner)
  "🛠": "5341715473882955310", // NewsEmoji
  // Ekspresi & promo
  "🔥": "6264785189394717307", // ZNV CLAN
  "🎉": "5461151367559141950", // NewsEmoji
  "✨": "5325547803936572038", // NewsEmoji
  "⭐": "5438496463044752972", // NewsEmoji
  "🌟": "6267118537752450044", // ZNV CLAN
  "💡": "5422439311196834318", // NewsEmoji
  "🚀": "5195033767969839232", // FinanceEmoji
  "💯": "5341498088408234504", // NewsEmoji
  "🆕": "5382357040008021292", // NewsEmoji
  "🔝": "5415655814079723871", // NewsEmoji
  "🔜": "5440621591387980068", // NewsEmoji
  "🏆": "6266973397922616654", // ZNV CLAN
  "🥇": "5440539497383087970", // NewsEmoji
  "👍": "6267032805910254913", // ZNV CLAN
  "👀": "5210956306952758910", // NewsEmoji
  "🙂": "5461117441612462242", // NewsEmoji
  // Bendera bahasa/mata uang
  "🇮🇩": "5291997937486800451", // FlagsEmoji
  "🇬🇧": "5458416160586342331", // FlagsEmoji
  "🇺🇸": "5474446335744680905", // FlagsEmoji
};
