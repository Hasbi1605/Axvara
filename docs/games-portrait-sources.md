# Sumber portrait katalog Games (15 Nov 2026)

> Portrait 2:3 gaya katalog Oura: karakter resmi di 2/3 atas + logo judul resmi di 1/3 bawah, gradien navy seragam. Dibuat oleh Codex GPT-6.1 Sol (GPT Image) dari art & logo resmi; tiap logo dicek huruf demi huruf. Master: `scripts/games-assets-src/portraits/<slug>.webp` (1200×1800). Catatan asli pilot di bawah, apa adanya.

# AXVARA Games — portrait pilot sources

Staging-only pilot prepared 2026-11-15. Nothing integrated into the AXVARA checkout; no commit/push. PM review pending.

Creation used built-in GPT Image (`image_gen`); exact backend model version is not exposed. The character compositions are AI edits/outpaints of downloaded official references, not unchanged official posters. Generated originals are 1024×1536; `masters/` contains 1200×1800 PNG files normalized with Lanczos resizing. The final wordmarks are direct composites of downloaded logo geometry/imagery, not generated lettering. Original references remain in `refs/`, raw character drafts in `generated/`, exact shared and per-game prompts in `PROMPTS.md`.

Every logo is horizontally centered at 80% of card width with center at 82% of card height, preserving its native aspect ratio. Typography was inspected in the final per-game logo crops and in the actual 120×180 mobile sheet. See `QA.md` for the limits of that check.


## `mobile-legends` — Mobile Legends: Bang Bang

- Character art: [official source file](https://play-lh.googleusercontent.com/LzFc5Sb33eTUjSez6SPMgPhkm17t2MtG8x7AwD0Wv2xbSdVyNu9MPCNh9SE251Ts07Dk-aCtqPrLE8HOXW8GBA=s0).
- Character/source page(s): [page 1](https://play.google.com/store/apps/details?id=com.mobile.legends).
- Logo references: [Logo file](https://upload.wikimedia.org/wikipedia/en/a/a0/Mobile_Legends_Bang_Bang_2025_logo.png), [Logo context](https://en.wikipedia.org/wiki/Mobile_Legends:_Bang_Bang).
- GPT Image work: Recomposed/outpainted the official orange-haired seafaring heroine into a close vertical harbor portrait; face, sailor costume and color scheme referenced from the official art. Removed foreground bird/railing.
- Final assembly: exact official logo file/geometry resized without distorting aspect ratio, alpha composited over the generated art using Sharp; final output `masters/mobile-legends.png` and `out/mobile-legends-portrait.webp`.
- Notes/compromise: Uses the 2025 orange/gold logo with its native side monogram, rather than an older gold-only MLBB mark. Hero name not independently confirmed. Small decorative crest reaches the top edge; face remains fully visible.
- Licence note: official art/logo used for product identification; copyright/trademarks remain with Moonton; this pilot does not imply affiliation.
- Logo spelling checked in final crop: **Y**.

## `free-fire` — Free Fire

- Character art: [official source file](https://cdn.wildflamestudio.com/common/web_event/official2.ff.garena.all/202311/a80ef2744fa83dc119cc09249d70444e.png).
- Character/source page(s): [page 1](https://ff.garena.com/en/chars/1/).
- Logo references: [Brand page](https://ff.garena.com/en/brand/), [Official white logo](https://cdn.wildflamestudio.com/common/test/official/FREE_FIRE_LOGO.PNG(2).png).
- GPT Image work: Recomposed official Kelly render with tropical battleground depth and warm rim light. Second GPT Image edit removed the generated title and printed sleeve lettering; exact official logo then composited.
- Final assembly: exact official logo file/geometry resized without distorting aspect ratio, alpha composited over the generated art using Sharp; final output `masters/free-fire.png` and `out/free-fire-portrait.webp`.
- Notes/compromise: Uses Kelly in her official yellow tracksuit. Her render is more detailed/realistic than the original 550×800 source. No event or collaboration copy retained.
- Licence note: official art/logo used for product identification; copyright/trademarks remain with Garena; this pilot does not imply affiliation.
- Logo spelling checked in final crop: **Y**.

## `pubg-mobile` — PUBG Mobile

- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/6d/98/24/6d9824dd-f75f-9bd6-221e-33324fedecb2/AppIcon-0-0-1x_U007emarketing-0-7-0-85-220.png/1024x1024bb.png).
- Character/source page(s): [page 1](https://apps.apple.com/id/app/pubg-mobile/id1330123889).
- Logo references: [Official legacy site](https://www.pubgmobile.com/en_US/), [Official wide legacy wordmark](https://www.pubgmobile.com/en_US/images/slogn.c0f6e860.png), [Additional reference shown to GPT Image](https://fserveu20221222.blob.core.windows.net/files/Games%20Press/2019/04/na-1556303192-/pubg_mobile_logo_-_new.png?sv=2026-06-06&se=2051-12-31T00%3A00%3A00Z&sr=b&sp=r&sig=6RG1omBG68cPvfT22qk8VbmBPNey23Mok%2FBG1Ese2fc%3D&otf=y&sky=aa2da4f04d81f41924051cbdb4a21f4ff42b2a094003a394af5aaf1a981698de), [Current brand assets](https://www.pubgmobile.com/en/event/brandassets/).
- GPT Image work: Recomposed the classic official helmet soldier into head-to-thigh art, extended the battleground sky/landscape and removed icon rounding and baked-in title.
- Final assembly: exact official logo file/geometry resized without distorting aspect ratio, alpha composited over the generated art using Sharp; final output `masters/pubg-mobile.png` and `out/pubg-mobile-portrait.webp`.
- Notes/compromise: Final logo is the official legacy PLAYERUNKNOWN’S BATTLEGROUNDS MOBILE variant, matching the owner’s example. The current stacked PUBG MOBILE mark was initially tested but too tall at 70% width. The legacy PNG is 513×200, so its native distressed edges are softer at master size.
- Licence note: official art/logo used for product identification; copyright/trademarks remain with Tencent / Level Infinite / KRAFTON; this pilot does not imply affiliation.
- Logo spelling checked in final crop: **Y**.

## `genshin-impact` — Genshin Impact

- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/5e/56/3e/5e563e37-ace1-d6fa-dd9b-4f507b2b37c9/EN-2796x1290-_U65e0logo.jpg/2208x1242bb.jpg).
- Character/source page(s): [page 1](https://apps.apple.com/id/app/genshin-impact/id1517783697).
- Logo references: [English logo SVG](https://upload.wikimedia.org/wikipedia/en/5/5d/Genshin_Impact_logo.svg), [SVG context](https://en.wikipedia.org/wiki/Genshin_Impact), [Official white English reference](https://act-webstatic.hoyoverse.com/puzzle/hk4e/pz_c6XZYm0GKS/resource/puzzle/2026/10/14/bfb40a53b2b82639f5c9805156d39abc_13107869971339233.png), [Official site](https://genshin.hoyoverse.com/en/).
- GPT Image work: Used Lauma from the right side of the official store image; recomposed her over a clean moonlit landscape based on the source, removed screenshot UI and all promo copy. A second GPT Image edit added top clearance for the antlers.
- Final assembly: exact official logo file/geometry resized without distorting aspect ratio, alpha composited over the generated art using Sharp; final output `masters/genshin-impact.png` and `out/genshin-impact-portrait.webp`.
- Notes/compromise: Uses Lauma instead of Traveler/Paimon. Final logo preserves exact downloaded SVG geometry, with white display fill matching the official English HoYoverse header reference; its header-only blue glow is excluded. No letters redrawn or retyped. A small official raster variant was inspected but not used because it became soft at desktop size.
- Licence note: official art/logo used for product identification; copyright/trademarks remain with HoYoverse / Cognosphere; this pilot does not imply affiliation.
- Logo spelling checked in final crop: **Y**.

## `honor-of-kings` — Honor of Kings

- Character art: [official source file](https://www.honorofkings.com/img/head_bg.jpg).
- Character/source page(s): [page 1](https://www.honorofkings.com/global-en/).
- Logo references: [Official title logo](https://www.honorofkings.com/img/logo_new.png), [Official homepage](https://www.honorofkings.com/global-en/).
- GPT Image work: Recomposed official Mulan into a brighter close portrait with ember-lit battlefield/temple depth, preserving the red costume, ponytail ornaments and weapon silhouette.
- Final assembly: exact official logo file/geometry resized without distorting aspect ratio, alpha composited over the generated art using Sharp; final output `masters/honor-of-kings.png` and `out/honor-of-kings-portrait.webp`.
- Notes/compromise: Uses official Mulan homepage character art, not the 5v5 app-icon badge. Native cream-gold horizontal logo and emblem retained.
- Licence note: official art/logo used for product identification; copyright/trademarks remain with Level Infinite / TiMi; this pilot does not imply affiliation.
- Logo spelling checked in final crop: **Y**.

## `valorant` — VALORANT

- Character art: [official source file](https://cmsassets.rgpub.io/sanity/images/dsfx7636/news/083baed63d306ee9ba41df4971ac0f6bb0222032-1920x1080.jpg?accountingTag=VAL).
- Character/source page(s): [page 1](https://playvalorant.com/en-us/media/).
- Logo references: [Official Riot logo archive](https://www.riotgames.com/darkroom/original/529d413f0d04b52fa43ac4e0afae762a:5079209ca6c46089fe07ff56ed1cf3d1/valorant-logos.zip), [Official Riot press page](https://www.riotgames.com/en/press).
- GPT Image work: Recomposed official Iso key art, extended head/hair clearance, replaced typographic white background with saturated crimson/architectural depth and retained violet ability energy.
- Final assembly: exact official logo file/geometry resized without distorting aspect ratio, alpha composited over the generated art using Sharp; final output `masters/valorant.png` and `out/valorant-portrait.webp`.
- Notes/compromise: Uses Iso, not Jett. Final title is the exact off-white Logotype/V_Logotype_Off-White.png from Riot’s archive, including its native tiny TM.
- Licence note: official art/logo used for product identification; copyright/trademarks remain with Riot Games; this pilot does not imply affiliation.
- Logo spelling checked in final crop: **Y**.

## Deliverables and supporting evidence

- `masters/<slug>.png`: six 1200×1800 PNG masters.
- `out/<slug>-portrait.webp`: six 600×900 WebP exports at quality 80, each ≤120,000 bytes.
- `contact-sheet.png`: 1968×784; six 300×450 cards with 24 px horizontal gaps, plus a second row with the same six at actual 120×180, all on #080C1E. Row labels are outside the card images.
- `compare.png`: 1968×1078; current repository portraits on top, pilot below; each card 300×450 with 24 px gaps. Current files are copied to `refs/current-<slug>-portrait.webp` for a stable comparison.
- `qa/mobile-actual-size.png`: compact 120×180-per-card review row.
- `qa/<slug>-logo-check.png`: 1200×630 lower-card crops for letter-by-letter review.
- `qa/asset-checks.json`: actual dimensions, quality, byte counts, placement and export SHA-256 values.
- `PROMPTS.md`: shared and per-game generation/edit prompt record.
- `normalize-refs.cjs`, `package.cjs`: staging-local reference normalization and deterministic packaging; both import Sharp read-only from the AXVARA installation. Research scripts and page snapshots are retained in staging. They are not part of the proposed integration.

Logo reference normalization strips transparent outer padding and rescales; it never retypes, stretches, or reconstructs the lettering. Genshin uses the downloaded English SVG paths in the official white display color, supported by the official white header reference. Some additional research references in `refs/` were inspected and rejected; the per-game lists above identify the actual final art and logo sources.


# Batch 1 — 11 additional games (2026-11-15)

Pilot status update: the PM reported owner approval of the original six. Those six masters/exports and original contact/comparison sheets remain unchanged, verified against `qa/batch-1-pilot-baseline.json`. Batch 1 is staged for separate PM review; no integration, repository writes, commit/push or Batch 2 work.

All eleven character drafts used built-in GPT Image with three inputs: official character art, each game’s own official logo reference, and a read-only approved pilot card for framing/light/fade reference. Final logos were composited from source imagery/geometry; no title letters were AI-redrawn or retyped. Generated originals are 1024×1536; masters are normalized to 1200×1800. All WebPs are 600×900 at q80, ≤120,000 bytes.

## Batch 1: `magic-chess-go-go` — Magic Chess: Go Go

- Character art: [official input](https://akmweb.youngjoygame.com/web/gms/image/fe231ec3e3e48e910de00e4cb1627452.jpg); [store/source listing](https://apps.apple.com/id/app/magic-chess-go-go/id6612014908).
- Logo: [downloaded reference](https://akmweb.youngjoygame.com/web/gms/image/fe231ec3e3e48e910de00e4cb1627452.jpg); [reference page](https://magicchessgogo.com/).
- GPT Image work: Blonde ponytailed chibi heroine holding blue cards; sunlit chess garden. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: The white game-specific monogram and MAGIC / CHESS / GO GO lettering were isolated from the top-left of the official 1920×1080 key art. Background alpha and isolated faint specks were cleaned; glyphs were not retyped or redrawn. An official launch press image supplies an additional spelling/shape reference: https://en.moonton.com/upload/image/20250521/11195a84fdf205e9760065ef7d5f2c4b.png.
- Notes/compromise: Native logo is raster-derived; edges remain softer at enlarged master zoom. Chibi proportions are deliberately retained.
- Outputs: `masters/magic-chess-go-go.png` and `out/magic-chess-go-go-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with Moonton / Vizta Pte. Ltd.; no affiliation implied.

## Batch 1: `free-fire-max` — Free Fire MAX

- Character art: [official input](https://cdn.wildflamestudio.com/common/web_event/official2.ff.garena.all/img/20228/c62e709e3ad8387f5484bb12e1cc81a9.png); [store/source listing](https://apps.apple.com/id/app/free-fire-max-x-naruto/id1480516829).
- Logo: [downloaded reference](https://cdn.wildflamestudio.com/common/test/official/FREE_FIRE_MAX_LOGO.PNG.png); [reference page](https://ff.garena.com/en/brand/).
- GPT Image work: Alok in black/gold coat and gold sunglasses in a blue-hour urban battleground. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: Character page: https://ff.garena.com/en/chars/146/. Exact official gold FREE FIRE MAX logo, including the native knife I and MAX subline.
- Notes/compromise: Clearly different character, outfit and scene from the pilot’s Kelly. The Naruto collaboration screenshot was rejected as an art input.
- Outputs: `masters/free-fire-max.png` and `out/free-fire-max-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with Garena; no affiliation implied.

## Batch 1: `honkai-star-rail` — Honkai: Star Rail

- Character art: [official input](https://play-lh.googleusercontent.com/051CQwb9h4yW9Vxtk9nAIZlAMO_Trf1w8J85sZoahHXQYi14AF_6uSqbQcX-OL471QK9HJmVobgc1lyMfhbWhg=s0); [store/source listing](https://apps.apple.com/id/app/honkai-star-rail/id1599719154).
- Logo: [downloaded reference](https://upload.wikimedia.org/wikipedia/en/8/8e/Honkai_Star_Rail_logo.svg); [reference page](https://en.wikipedia.org/wiki/Honkai:_Star_Rail).
- GPT Image work: White/silver-haired red-and-white-costumed heroine from official store key art; astral red/violet clockwork background. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: English SVG title with native train/crescent artwork, provided as reference then composited directly. The initially downloaded Chinese localized logo was rejected. A second GPT Image edit added crown clearance.
- Notes/compromise: Hero name not independently confirmed; identity was anchored visually to the exact official input. The tiny HONKAI line is small at 120 px.
- Outputs: `masters/honkai-star-rail.png` and `out/honkai-star-rail-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with HoYoverse (Cognosphere); no affiliation implied.

## Batch 1: `roblox` — Roblox

- Character art: [official input](https://play-lh.googleusercontent.com/XRnJa5L_GOx-Gq10qbyt7oGZwVkAx9jl-KUU68ooQm-HCGtK4neFOfnKIWdzTJRrD6pLs8sN8mO2Pm3E9oy2RvA=s0); [store/source listing](https://apps.apple.com/id/app/roblox/id431946152).
- Logo: [downloaded reference](https://about.roblox.com/images/Roblox_Logo_White.svg); [reference page](https://about.roblox.com/press-kit).
- GPT Image work: Yellow block avatar in striped clothes and squid hat holding a flashlight in a teal/green block forest. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: Exact current official white ROBLOX wordmark from Roblox’s own press site; native tilted first O retained.
- Notes/compromise: A source-specific avatar/world, rather than a generic realistic person. Background monster and extra characters were removed.
- Outputs: `masters/roblox.png` and `out/roblox-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with Roblox Corporation; no affiliation implied.

## Batch 1: `call-of-duty-mobile` — Call of Duty Mobile

- Character art: [official input](https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/74/90/fa/7490fa0c-5957-f720-4e62-f4ccd78808ba/AppIcon-0-0-1x_U007emarketing-0-10-0-85-220.png/1024x1024bb.jpg); [store/source listing](https://apps.apple.com/id/app/call-of-duty-mobile-garena/id1465688043).
- Logo: [downloaded reference](https://codm.garena.com/static/images/Main-page/P1/codm-logo.png); [reference page](https://codm.garena.com/).
- GPT Image work: Ghost with skull balaclava, beanie, headset and goggles in a blue/orange urban battlefield. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: Full official CALL OF DUTY / MOBILE logo from Garena’s CODM homepage assets, including yellow mobile emblem. The console-only mark and Garena publisher badge in the art were removed.
- Notes/compromise: Character reference was the official App Store icon; GPT Image recomposed/outpainted a complete scene rather than simply enlarging/cropping that icon.
- Outputs: `masters/call-of-duty-mobile.png` and `out/call-of-duty-mobile-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with Garena / Activision; no affiliation implied.

## Batch 1: `league-of-legends-wild-rift` — League of Legends: Wild Rift

- Character art: [official input](https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/3229a91c0b046bbb8ef3a8fb4487cd975f8611b0-1920x1080.jpg); [store/source listing](https://apps.apple.com/id/app/league-of-legends-wild-rift/id1480616990).
- Logo: [downloaded reference](https://www.riotgames.com/darkroom/original/e0d8faf8ae33b14f587cde3b864669d7:5cffc64a75cec51a6f13bec08bd2be31/lol-wild-rift-logos.zip); [reference page](https://www.riotgames.com/en/press).
- GPT Image work: Sylas with native shackles/chains and blue arm runes, in an arcane stone battleground. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: Exact white wildrift-logo-rgb1c-white.png from Riot’s LoL Wild Rift Logos archive; includes LEAGUE OF LEGENDS and WILD RIFT.
- Notes/compromise: Taller native aspect ratio uses 70% of card width; all other Batch 1 titles use 80%. No PC-only title substitution.
- Outputs: `masters/league-of-legends-wild-rift.png` and `out/league-of-legends-wild-rift-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with Riot Games; no affiliation implied.

## Batch 1: `zenless-zone-zero` — Zenless Zone Zero

- Character art: [official input](https://play-lh.googleusercontent.com/ZukZToKkbyw713RQmFKGy7jDVzR-kHR-sjex6auhQslgk_cvwD48nl7TxAVbMk-if_5fvWRqA2rRpMvPC63ndQ=s0); [store/source listing](https://apps.apple.com/id/app/zenless-zone-zero/id1606356401).
- Logo: [downloaded reference](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4162040/3c36d08a02d5f822dba9f2da44b06e0e98a3fa4d/logo_2x.png); [reference page](https://store.steampowered.com/app/4162040/).
- GPT Image work: Silver-haired animal-eared male from official store art, preserving navy/gold tailored outfit and electric-blue environment. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: Full publisher-supplied Steam wordmark. Steam app metadata confirms developer/publisher COGNOSPHERE PTE. LTD. and links zenless.hoyoverse.com; metadata saved in refs/batch-1/zenless-steam-metadata.json. Exact title glyph geometry is used in a white display variant for the navy card; native white Z emblem with black extrusion is retained. Symbol-only and studio lockups were rejected.
- Notes/compromise: White display text changes the original Steam file’s black title fill; letter geometry/layout are unchanged. Character name not independently confirmed.
- Outputs: `masters/zenless-zone-zero.png` and `out/zenless-zone-zero-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with HoYoverse (Cognosphere); no affiliation implied.

## Batch 1: `arena-of-valor` — Arena of Valor

- Character art: [official input](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/56/0f/ca/560fcaff-99e2-17bb-55cd-972cf7e1d75e/1.__U9996_U5f35_U5f62_U8c61_U5716_2796x1290.jpg/2208x1242bb.jpg); [store/source listing](https://apps.apple.com/id/app/garena-aov-10th-anniversary/id1222857607).
- Logo: [downloaded reference](https://www.arenaofvalor.com/web2017/images/pc/logo.png); [reference page](https://www.arenaofvalor.com/).
- GPT Image work: Central silver/violet armored lord from official promotional key art, recomposed as a close helmet/torso portrait. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: Exact full English white ARENA OF VALOR logo linked by the official global homepage stylesheet. Anniversary/Rift copy, borders and corner marks removed from the art. Garena Indonesia’s current alternatives were inspected but are tall AOV abbreviations, so they were not substituted.
- Notes/compromise: The official global white title is low resolution, visibly soft at master zoom; correct spelling/letterforms and small-size identification are preserved. Source character name not independently confirmed.
- Outputs: `masters/arena-of-valor.png` and `out/arena-of-valor-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with Garena / MOBA Games; no affiliation implied.

## Batch 1: `delta-force` — Delta Force

- Character art: [official input](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2507950/library_hero.jpg); [store/source listing](https://apps.apple.com/id/app/garena-delta-force/id6670604287).
- Logo: [downloaded reference](https://web.df.garena.com/02_h5/240923_official_website/id/pc/top_logo_01.png); [reference page](https://www.playdeltaforce.com/en/).
- GPT Image work: Silver-haired bearded operator from base-game Steam hero art with headset, tactical harness and dog tags. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: Official green emblem + white DELTA FORCE wordmark from Garena’s regional official site. Base-game art: https://store.steampowered.com/app/2507950/. The Phantom Blade collaboration screenshot was rejected.
- Notes/compromise: Native regional logo raster is softer at master zoom. Character pose remains side-on, matching the source; face is not hidden by the title.
- Outputs: `masters/delta-force.png` and `out/delta-force-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with Garena / Good Mobile Games; no affiliation implied.

## Batch 1: `blood-strike` — Blood Strike

- Character art: [official input](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3199170/library_hero.jpg); [store/source listing](https://apps.apple.com/id/app/blood-strike-x-dj-snake/id1637059453).
- Logo: [downloaded reference](https://www.blood-strike.com/pc/gw/20230718104343//img/logo_810802e.png); [reference page](https://www.blood-strike.com/).
- GPT Image work: Red-masked tactical striker from the official Steam hero, against a blue industrial battleground. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: Exact official white brush-script Blood Strike title from the game website. Art source page: https://store.steampowered.com/app/3199170/.
- Notes/compromise: No DJ Snake, artist/collaboration/event copy, NetEase badge or extra fighters retained.
- Outputs: `masters/blood-strike.png` and `out/blood-strike-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with NetEase; no affiliation implied.

## Batch 1: `mobile-legends-adventure` — Mobile Legends: Adventure

- Character art: [official input](https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/0a/b0/4c/0ab04c27-011b-3d41-85e3-6957e0cfb164/f447203c-8c71-41f1-8b49-cd890f5cdac9_2208_1242_U9996_U56fe2.jpg/2208x1242bb.jpg); [store/source listing](https://apps.apple.com/id/app/mobile-legends-adventure/id1456213261).
- Logo: [downloaded reference](https://m.mladventure.net/static/media/logo.3b4c690c.png); [reference page](https://m.mladventure.net/).
- GPT Image work: Pink-haired animal-eared heroine from the right of official store art, above a warm fantasy castle city. Recomposition/outpainting, lighting/background extension, promotional/UI/badge cleanup and a smooth navy lower fade.
- Logo method: Exact game-specific gold/purple MOBILE LEGENDS / ADVENTURE logo from the official MLA site bundle, not the MLBB logo. A second GPT Image edit added ear clearance.
- Notes/compromise: Native soft 2D/anime look retained. Official 144×70 logo raster is soft at master zoom; ADVENTURE remains small at mobile size.
- Outputs: `masters/mobile-legends-adventure.png` and `out/mobile-legends-adventure-portrait.webp`.
- Logo spelling zoom-checked in the final composite: **Y**.
- Licence note: official art/logo used for product identification; copyrights/trademarks remain with Moonton; no affiliation implied.

## Batch 1 supporting deliverables

- `batch-1-sheet.png`: 1968×1885, #080C1E background; unchanged pilot six as the first row, eleven new cards in two rows of six/five at 300×450 with 24 px horizontal gaps, then all eleven at actual 120×180 in one row. Labels are outside card images.
- `qa/batch-1-mobile.png`: compact one-row mobile review image; each new card exactly 120×180.
- `qa/<batch-1-slug>-logo-check.png`: eleven 1200×630 lower-card zoom crops.
- `qa/batch-1-asset-checks.json`: actual sizes, quality, positions, SHA-256 values, and unchanged-pilot result.
- `refs/batch-1/downloads.json`: source URL registry; contains research candidates as well as final references. The per-slug list above identifies the selected inputs.
- `refs/batch-1/prompts.json`, `refs/batch-1/framing-fixes.json`: exact generation/edit specifications.
- `batch-1-normalize.cjs`, `batch-1-clean-magic-logo.cjs`, `batch-1-package.cjs`: staging-local normalization, alpha-speck cleanup and packaging. They read Sharp from AXVARA’s existing installation; no repo changes. Reproduction order: normalize → clean Magic logo → package.


# Batch 1 logo fixes + Batch 2 — PM handoff (2026-11-15)

This appendix is the current handoff status and supersedes earlier pending-review/soft-logo notes for the three corrected cards. The six pilot cards and eight approved Batch 1 cards remain approved and untouched. Three Batch 1 logo fixes and eleven Batch 2 cards are ready for PM review. No later batch has been started.

All writes remain in this staging directory. Official references were downloaded before generation. GPT Image restored the soft title references as high-resolution transparent artwork; the checked results were then composited without enlarging them into the 1200×1800 masters. MLA uses a newly found 3000×1846 official PNG directly. These generated logo restorations are visually faithful, letter-checked redraws, not source-vector or pixel-identical branding files.

Owner correction for the football games: the final FC Mobile card adapts the current Mbappé portrait; Football Master 2 adapts the current three-legends portrait and retains FOOTBALL MASTER 26 EVOLUTION. Earlier fictional-player drafts and the older MASTER 2 logo are superseded and are not in masters/ or out/.

## Batch 1 logo-only corrections

### `mobile-legends-adventure` — higher-resolution official wordmark

- Character art source remains [official store art](https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/0a/b0/4c/0ab04c27-011b-3d41-85e3-6957e0cfb164/f447203c-8c71-41f1-8b49-cd890f5cdac9_2208_1242_U9996_U56fe2.jpg/2208x1242bb.jpg); the existing character image was not regenerated.
- New logo: [Moonton 3000×1846 official PNG](https://cn.moonton.com/upload/image/20240325/37ed020a46e1cbebdb1a41463f916f02.png), downloaded from the [publisher site](https://cn.moonton.com/news/51.html). The image asset itself is the reference; the linked article is not a licence grant.
- Method: downsample/composite native gold/purple MOBILE LEGENDS ADVENTURE logo; no GPT logo redraw needed. Every letter and the ADVENTURE subtitle checked in the final 1200 px crop. Native trailing S swash retained.
- Licence note: official art/logo used for product identification; rights remain with Moonton, no affiliation implied.

### `delta-force` — broad stacked lockup

- Character art remains [official Steam hero art](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2507950/library_hero.jpg); no character regeneration.
- Logo reference: [official Garena logo](https://web.df.garena.com/02_h5/240923_official_website/id/pc/top_logo_01.png), [game site](https://www.playdeltaforce.com/en/).
- GPT Image work: faithful crisp restoration with green delta emblem above the broad white DELTA FORCE title. Final title spans 80% of card width, centered below the character. Every letter rechecked.
- Licence note: official art/logo used for product identification; rights remain with the respective game rights holders, no affiliation implied.

### `arena-of-valor` — crisp native title restoration

- Character art remains [official store art](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/56/0f/ca/560fcaff-99e2-17bb-55cd-972cf7e1d75e/1.__U9996_U5f35_U5f62_U8c61_U5716_2796x1290.jpg/2208x1242bb.jpg); no character regeneration.
- Logo reference: [official global white English title](https://www.arenaofvalor.com/web2017/images/pc/logo.png), [official site](https://www.arenaofvalor.com/).
- GPT Image work: restore the original ARENA OF / VALOR serif shapes and long descending V as crisp white transparent artwork. Final master letters rechecked.
- Licence note: official art/logo used for product identification; rights remain with the respective game rights holders, no affiliation implied.

For all three fixes: masters/<slug>.png and out/<slug>-portrait.webp replaced only the wordmark. All three raw character files are hash-identical, and the upper 1200×1170 pixels of each before/after master are identical. Evidence: qa/batch-1-logo-fixes-checks.json. The eight approved Batch 1 cards and six pilot cards are hash-unchanged.

## Batch 2 — per-game sources and edits

### `arena-breakout` — Arena Breakout

- Character art: [official source file](https://arenabreakout.com/pre-register/img/header_pc.1c79a012.jpg); [publisher/store listing](https://apps.apple.com/id/app/arena-breakout-realistic-fps/id1560765304).
- Logo reference: [official reference file](https://arenabreakout.com/pre-register/img/logo.e064541b.png); [official game site](https://arenabreakout.com/).
- Subject/edit: Silver-haired tactical operator from the right of official key art; urban extraction scene. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: Official season/chapter copy excluded; the game title and arrow are retained.
- Outputs: `masters/arena-breakout.png` (1200×1800) and `out/arena-breakout-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with Level Infinite (Proxima Beta) and the respective rights holders, no affiliation or additional licence grant implied.

### `fc-mobile` — EA SPORTS FC Mobile

- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/41/d1/84/41d18457-ec03-6812-f0a7-8a83686c6009/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/1024x1024bb.jpg); [publisher/store listing](https://apps.apple.com/id/app/ea-sports-fc-football-mobile/id1094930513).
- Logo reference: [official reference file](https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/41/d1/84/41d18457-ec03-6812-f0a7-8a83686c6009/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/1024x1024bb.jpg); [official game site](https://www.ea.com/games/ea-sports-fc/fc-mobile).
- Owner-selected immediate edit input: `public/brand/games/fc-mobile-portrait.webp` (versi sebelumnya), copied read-only into refs/batch-2/fc-mobile-owner-current.webp. Official store art above corroborates the player/title reference.
- Subject/edit: Owner-selected current Mbappé portrait in Real Madrid kit, striking the ball; likeness, action pose and kit retained in the generated adaptation. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: Owner correction overrides fictional-player direction. Current stacked EA SPORTS + FC / MOBILE lockup restored. Native kit sponsor/crest details are retained as part of the owner-selected art. Player is smaller than bust portraits to keep the complete kick and both boots visible.
- Outputs: `masters/fc-mobile.png` (1200×1800) and `out/fc-mobile-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with EA Swiss Sarl and the respective rights holders, no affiliation or additional licence grant implied.

### `football-master-2` — Football Master 2 (current FOOTBALL MASTER 26 EVOLUTION artwork)

- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/5a/14/35/5a143502-07f4-911c-14b8-24a57a8369aa/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/1024x1024bb.jpg); [publisher/store listing](https://apps.apple.com/id/app/football-master-2-soccer-star/id1559688336).
- Logo reference: [official reference file](https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/5a/14/35/5a143502-07f4-911c-14b8-24a57a8369aa/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/1024x1024bb.jpg); [official game site](https://fm2.galasports.com/).
- Owner-selected immediate edit input: `public/brand/games/football-master-2-portrait.webp` (versi sebelumnya), copied read-only into refs/batch-2/football-master-2-owner-current.webp. Official store art above corroborates the player/title reference.
- Subject/edit: Owner-selected current portrait with all three official legends, white/blue/yellow kits and original facial expressions. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: Owner correction overrides fictional-player and older MASTER 2 logo directions. Current 26 EVOLUTION branding retained intentionally. Three-player composition preserves source arrangement.
- Outputs: `masters/football-master-2.png` (1200×1800) and `out/football-master-2-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with Gala Sports and the respective rights holders, no affiliation or additional licence grant implied.

### `point-blank` — Point Blank

- Character art: [official source file](https://www.zepetto.com/images/v2/pb_info04.jpg); [publisher/store listing](https://play.google.com/store/apps/details?id=com.zepetto.PointBlank.CompanionApp).
- Logo reference: [official reference file](https://www.pointblank.id/images/common/event/bi_pbbl.png); [official game site](https://www.pointblank.id/).
- Subject/edit: Helmeted source soldier with goggles above the brow, face covering and rifle; world-map overlay removed. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: Native distressed POINT BLANK letter cuts retained; BEYOND LIMITS tagline omitted.
- Outputs: `masters/point-blank.png` (1200×1800) and `out/point-blank-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with Zepetto and the respective rights holders, no affiliation or additional licence grant implied.

### `crossfire-legends` — CrossFire Legends

- Character art: [official source file](https://cdn-mainsite-aka.vnggames.com/products/cfl/mainsite/dist/assets/cfl-ms-25-intro/images/characters.png); [publisher/store listing](https://apps.apple.com/id/app/crossfire-legends/id6743618701).
- Logo reference: [official reference file](https://cdn-mainsite-aka.vnggames.com/products/cfls/skin-2025/promotion/assets/images/content/logo-mb.png); [official game site](https://cfl.vnggames.net/).
- Subject/edit: Blonde gold-uniform officer from VNG's official character render; the other two characters removed. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: Full CF emblem + CROSSFIRE LEGENDS lockup, including the native silhouette in the O. The long horizontal lockup makes LEGENDS small at 120 px.
- Outputs: `masters/crossfire-legends.png` (1200×1800) and `out/crossfire-legends-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with Level Infinite (Proxima Beta) and the respective rights holders, no affiliation or additional licence grant implied.

### `rainbow-six-mobile` — Rainbow Six Mobile

- Character art: [official source file](https://play-lh.googleusercontent.com/LOshPgbahPoVZ6sAWJO4bOLMGHOAIpIwHVVflkW-d9bznfY7p8x7CYjhZxUAfXN9T5IYSKNg2JW6zzLwKJYFHcs=s0); [publisher/store listing](https://apps.apple.com/id/app/rainbow-six-mobile/id1608916511).
- Logo reference: [official reference file](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/DIol2hmt6NJkV8VPSm8Mg/4fb0de050685f4bdd7d48c4479abbe34/R6M_Logo_White_V2.png); [official game site](https://www.ubisoft.com/en-us/game/rainbow-six/mobile).
- Subject/edit: Gas-mask operator from the right of the official store screenshot, without tablet, other operators or promotional copy. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: Full white RAINBOW SIX + cyan MOBILE title with native TOM CLANCY’S prefix. Prefix is tiny at mobile size. First image-service logo request was rejected; a simpler faithful-restoration request succeeded.
- Outputs: `masters/rainbow-six-mobile.png` (1200×1800) and `out/rainbow-six-mobile-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with Ubisoft and the respective rights holders, no affiliation or additional licence grant implied.

### `marvel-rivals` — Marvel Rivals

- Character art: [official source file](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2767030/library_hero.jpg); [publisher/store listing](https://store.steampowered.com/app/2767030/).
- Logo reference: [official reference file](https://www.marvelrivals.com/pc/gw/20241128194803/img/logo_95906827.png); [official game site](https://www.marvelrivals.com/).
- Subject/edit: Daredevil in the official Steam hero artwork: horned red mask, crimson armor, chain and magenta dragon energy. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: The downloaded landscape-only background was not used as the character reference. Full MARVEL / RIVALS title retained; small MARVEL box stays small at mobile size.
- Outputs: `masters/marvel-rivals.png` (1200×1800) and `out/marvel-rivals-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with NetEase Games and the respective rights holders, no affiliation or additional licence grant implied.

### `identity-v` — Identity V

- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/49/59/db/4959db8c-a6f9-3c14-25ea-1ed411bf1595/0.jpg/2208x1242bb.jpg); [publisher/store listing](https://apps.apple.com/id/app/identity-v/id1347780764).
- Logo reference: [official reference file](https://www.identityvgame.com/pc/gw/20210609113612/img/logo_34fe59c.png); [official game site](https://www.identityvgame.com/).
- Subject/edit: Central floral-gown doll from the official store garden art; button-like eyes and stylized proportions retained. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: 8th-anniversary text, publisher credit and other figures removed. Native cracked gothic title texture retained sharply.
- Outputs: `masters/identity-v.png` (1200×1800) and `out/identity-v-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with NetEase and the respective rights holders, no affiliation or additional licence grant implied.

### `onmyoji-arena` — Onmyoji Arena

- Character art: [official source file](https://play-lh.googleusercontent.com/20HKSjJcLzhBoqO6iquvTfrrNcAxP3aPx9bGRb7sU3raw0kmvtGbiSfTgaI9dNw4lSsPeLZfT2RWILib-Soyeg=s0); [publisher/store listing](https://apps.apple.com/id/app/onmyoji-arena/id1343073274).
- Logo reference: [official reference file](https://www.onmyojiarena.us/pc/gw/20190219173313/img/01_golo_4059adc.png); [official game site](https://www.onmyojiarena.us/).
- Subject/edit: White-haired aquatic fantasy character from the official store art, with purple/white costume, shell object and underwater motifs. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: Chinese seasonal text and publisher marks removed. Pale-gold English Onmyoji ARENA wordmark restored; source character name not guessed.
- Outputs: `masters/onmyoji-arena.png` (1200×1800) and `out/onmyoji-arena-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with NetEase and the respective rights holders, no affiliation or additional licence grant implied.

### `sausage-man` — Sausage Man

- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/19/b6/d0/19b6d0c6-d8fb-0c72-2fec-1fe0a900a854/2688x1242-_U730e_U6237_U5ea7_U539f_U8272_U6e32_U67d3_U56fe-_U521b_U9020_U4e0e_U7834_U574f-en.jpg/2208x1242bb.jpg); [publisher/store listing](https://apps.apple.com/id/app/sausage-man/id1563750315).
- Logo reference: [official reference file](https://website.xdcdn.net/poster/212769/sausageman-website/slogan/z9ESc1og.png); [official game site](https://sausageman.xd.com/).
- Subject/edit: Purple/gold armored sausage hero from the right of the official store screenshot, in a floating-island setting. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: Screenshot UI and Create & Destroy copy removed. A second GPT Image pass restored complete helmet-spike clearance. Native black-edged SAUSAGE MAN silhouette retained.
- Outputs: `masters/sausage-man.png` (1200×1800) and `out/sausage-man-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with XD Entertainment and the respective rights holders, no affiliation or additional licence grant implied.

### `super-sus` — Super Sus

- Character art: [official source file](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2920270/library_hero.jpg); [publisher/store listing](https://apps.apple.com/id/app/super-sus/id6498889637).
- Logo reference: [official reference file](https://www.supersus.io/_nuxt/img/float_logo.1faae98.png); [official game site](https://www.supersus.io/).
- Subject/edit: Central red/orange crewmate from the official Steam hero, preserving broad visor, helmet rim and compact proportions. GPT Image recomposed/outpainted the official input, matched lighting/saturation, removed the old title/promotional material, and added the smooth navy lower fade.
- Logo method: GPT Image faithful high-resolution transparent restoration from the downloaded official reference; pasted separately at 80% width without enlarging the restored logo. Exact title spelling and final edges visually inspected at 1200 px master zoom.
- Notes/compromise: Other crewmates removed. Native SUPERSUS white lettering and red integrated P detail retained, not another franchise's logo or character.
- Outputs: `masters/super-sus.png` (1200×1800) and `out/super-sus-portrait.webp` (600×900, q80, ≤120,000 bytes). Logo spelling verified: **Y**.
- Licence note: official art/logo used for product identification; rights remain with Giant Network and the respective rights holders, no affiliation or additional licence grant implied.

## Batch 2 review artifacts

- `batch-2-sheet.png`: 1968×1885, #080C1E; three corrected Batch 1 cards in row 1 at 300×450, eleven new cards in rows of six/five at 300×450, then all eleven at actual 120×180. Horizontal gaps are 24 px; labels sit outside cards.
- `qa/batch-2-mobile.png`: eleven actual-size mobile cards. `qa/batch-1-fixed-mobile.png`: three fixed cards at mobile size.
- `qa/batch-2-football-compare.png`: owner-selected current portraits above final football adaptations.
- `qa/<slug>-logo-check.png`: final 1200×630 lower-card crops for all fourteen reviewed cards.
- `qa/batch-2-asset-checks.json`: sizes, quality, geometry, hashes and preservation check. `refs/batch-2/final-prompts.json`: exact final character prompts, correction prompts and successful Rainbow Six logo retry.
- Older top-level source/QA statements describe the pilot or initial Batch 1 snapshot. This appendix documents the new generated logo restorations and owner-approved football exception.


## Final batches 3 + 4 and CrossFire correction

Current review package, 15 November 2026. PM approved the earlier pilot and batches except CrossFire’s previous character. This appendix supersedes the old pending-review notes for those assets; the other 27 approved cards remain unchanged. All new source references were downloaded before GPT Image editing. Exact app names/pages were read from the repository manifest.

### `crossfire-legends` — official operator replacement

- Character: [official VNG character render](https://cdn-mainsite-aka.vnggames.com/products/cfl/mainsite/dist/assets/cfl-ms-25-intro/images/characters.png), cropped to the silver-haired male tactical operator with aviators, headset, leather coat and gloves. GPT Image recomposed/outpainted this source into the same house style; the previous female render is retained only as a staging audit backup.
- Logo: existing checked `refs/batch-2/crossfire-legends-wordmark.png`, preserved byte-for-byte. The native soldier silhouette inside the O remains. Logo spelling verified: **Y**. Master/export replaced; all other approved portraits preserved.
- Licence note: official art/logo used for product identification; rights remain with the respective rights holders, with no affiliation or additional licence grant implied.

### `aniimo` — Aniimo

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/aniimo/id6759098797); publisher/seller: Pawprint Interactive / PAWPRINT INTERACTIVE ENTERTAINMENT PTE. LTD.
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/71/69/87/716987bc-c98f-d85e-1803-e96f08e1a067/FPX_AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/1024x1024bb.jpg); downloaded `aniimo-icon.png`, normalized as `aniimo-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://kg-web-cdn.akamaized.net/master/official-website/worldx_office_frontend/images/logo/en_light.webp); selected local file `refs/final-batches/aniimo-logo.png`.
- Subject/edit: White fluffy blue-pawed mascot from the official app icon, in a coastal meadow. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Native paired I forms, star and cyan/pink loop retained; this is the Aniimo wordmark, not plain typesetting.
- Outputs: `masters/aniimo.png` (1200×1800); `out/aniimo-portrait.webp` (600×900, q80, 43,766 bytes). Logo spelling verified: **Y** — ANIIMO.
- Licence note: official art/logo used for product identification; rights remain with Pawprint Interactive and the respective rights holders, with no affiliation or additional licence grant implied.

### `au2-mobile` — AU2 Mobile-Lovely Babies

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/au2-mobile-lovely-babies/id1428629860); publisher/seller: Uniugame / Uniugame Information Technology Co.,Limited.
- Character art: [official source file](https://danceclub.uniugame.com/images/topbg.jpg); downloaded `au2-mobile-art.png`, normalized as `au2-mobile-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://danceclub.uniugame.com/images/logo.png); selected local file `refs/final-batches/au2-mobile-logo.png`.
- Subject/edit: Official pink-haired idol with closed navy/white stage bodice and microphone. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 70%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Dance/rhythm game by Uniugame, not Aura Kingdom 2. Tall native logo fits at 70% card width; no stretching.
- Outputs: `masters/au2-mobile.png` (1200×1800); `out/au2-mobile-portrait.webp` (600×900, q80, 110,334 bytes). Logo spelling verified: **Y** — AU2 Mobile.
- Licence note: official art/logo used for product identification; rights remain with Uniugame and the respective rights holders, with no affiliation or additional licence grant implied.

### `captain-tsubasa-ace` — CAPTAIN TSUBASA: ACE

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/captain-tsubasa-ace/id1637404845); publisher/seller: Tadpole Entertainment / Tadpole Entertainment Company Limited.
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/fb/89/62/fb8962d6-3484-b5fe-3407-01e7a786d160/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/1024x1024bb.jpg); downloaded `captain-tsubasa-ace-icon.png`, normalized as `captain-tsubasa-ace-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://play-lh.googleusercontent.com/fIwZ0Hd5yYCDG638GbdFeq5DyQOtVLN0iDhaUX5w5F3j8yajhN5fHQWvMZ5lHz_qSFKDBtlRzKFPT8SkHN9mWw=s0); selected local file `refs/final-batches/captain-tsubasa-ace-logo-reference.png`.
- Subject/edit: Official Tsubasa Ozora in white/blue football kit, with ball and stadium. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Complete hair/head clearance restored in a second GPT edit. Kit letters/numbers removed; red/gold title and blue ACE retained.
- Outputs: `masters/captain-tsubasa-ace.png` (1200×1800); `out/captain-tsubasa-ace-portrait.webp` (600×900, q80, 86,270 bytes). Logo spelling verified: **Y** — CAPTAIN TSUBASA ACE.
- Licence note: official art/logo used for product identification; rights remain with Tadpole Entertainment and the respective rights holders, with no affiliation or additional licence grant implied.

### `dragon-city` — Dragon City: Collect & Battle!

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/dragon-city-collect-battle/id561941526); publisher/seller: Socialpoint / Socialpoint.
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/26/e7/b8/26e7b828-0677-14b6-27bb-35ea88ff1642/1_IOS_2796x1290_en-US.jpg/2208x1242bb.jpg); downloaded `dragon-city-art.png`, normalized as `dragon-city-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://images.ctfassets.net/7qho9llfhoio/1MDhHWmQXaIJBYUKT6x25s/7b79cb0eafa5e12fdfd39035e078a2da/dc-logo-2022.png); selected local file `refs/final-batches/dragon-city-logo.png`.
- Subject/edit: Red/orange, gold-and-purple armored dragon from the left of the official store screenshot. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 79%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Other dragon, egg and breeding UI removed. Native egg-shaped O and red CITY ribbon retained.
- Outputs: `masters/dragon-city.png` (1200×1800); `out/dragon-city-portrait.webp` (600×900, q80, 100,580 bytes). Logo spelling verified: **Y** — DRAGON CITY.
- Licence note: official art/logo used for product identification; rights remain with Socialpoint and the respective rights holders, with no affiliation or additional licence grant implied.

### `gangstar-mirage-city` — Gangstar Mirage City: Online

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/gangstar-mirage-city-online/id6472700792); publisher/seller: Gameloft / Proxima Beta / PROXIMA BETA PTE.LIMITED.
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/70/41/2e/70412e0e-94ae-262d-a256-eaa9d8762e66/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/1024x1024bb.jpg); downloaded `gangstar-mirage-city-icon.png`, normalized as `gangstar-mirage-city-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://www.gangstarmiragecity.com/assets/logo-nqwp_GNM.webp); selected local file `refs/final-batches/gangstar-mirage-city-logo.png`.
- Subject/edit: Official white rabbit-mask character with red/cyan lenses, teal jacket and gold chain. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Entire mask ears retained; neon city replaces the app-icon background. Native crown/paint logo treatment retained.
- Outputs: `masters/gangstar-mirage-city.png` (1200×1800); `out/gangstar-mirage-city-portrait.webp` (600×900, q80, 102,848 bytes). Logo spelling verified: **Y** — GANGSTAR MIRAGE CITY.
- Licence note: official art/logo used for product identification; rights remain with Gameloft / Proxima Beta and the respective rights holders, with no affiliation or additional licence grant implied.

### `garena-undawn` — Garena Undawn

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/garena-undawn/id1538722240); publisher/seller: Garena / Garena Mobile Private Limited.
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/65/7f/09/657f0947-cbe2-fae8-2bd9-5a844848cead/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/1024x1024bb.jpg); downloaded `garena-undawn-icon.png`, normalized as `garena-undawn-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://smp.undawn.cdn.garenanow.com/undawnEN/1221_Official/pc/nav_logo.png); selected local file `refs/final-batches/garena-undawn-logo.png`.
- Subject/edit: Central brown-haired leather-jacket survivor from the official app icon. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Other survivors, giant backdrop emblem and Garena badge removed; official UNDAWN title and eagle retained.
- Outputs: `masters/garena-undawn.png` (1200×1800); `out/garena-undawn-portrait.webp` (600×900, q80, 80,466 bytes). Logo spelling verified: **Y** — UNDAWN.
- Licence note: official art/logo used for product identification; rights remain with Garena and the respective rights holders, with no affiliation or additional licence grant implied.

### `growtopia` — Growtopia

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/growtopia/id590495115); publisher/seller: Ubisoft / Ubisoft.
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/47/81/75/4781755c-90ab-220f-277d-990c68a33480/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/1024x1024bb.jpg); downloaded `growtopia-icon.png`, normalized as `growtopia-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://upload.wikimedia.org/wikipedia/en/3/3c/Growtopia.jpg); selected local file `refs/final-batches/growtopia-logo-reference.png`.
- Subject/edit: Official red-haired blocky pixel avatar in green plaid, with a pixel-block world. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Pixel character geometry intentionally differs from the illustrated cards. Native tree-shaped t retained. Official poster/logo sourced from the Wikipedia file because the game site did not serve the asset.
- Outputs: `masters/growtopia.png` (1200×1800); `out/growtopia-portrait.webp` (600×900, q80, 56,204 bytes). Logo spelling verified: **Y** — Growtopia.
- Licence note: official art/logo used for product identification; rights remain with Ubisoft and the respective rights holders, with no affiliation or additional licence grant implied.

### `haikyu-fly-high` — HAIKYU!! FLY HIGH

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/haikyu-fly-high/id6737688139); publisher/seller: Garena / GARENA INTERNATIONAL II PRIVATE LIMITED.
- Character art: [official source file](https://dl-hiq.garena.com/web/preregister/en/pc/meta_image.jpg); downloaded `haikyu-fly-high-meta.png`, normalized as `haikyu-fly-high-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://dl-hiq.garena.com/web/preregister/en/pc/meta_image.jpg); selected local file `refs/final-batches/haikyu-fly-high-logo-reference.png`.
- Subject/edit: Official Hinata Shoyo, orange hair and black/orange volleyball uniform, in a gym. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Extra orphan arm in the first render removed in a targeted GPT edit; final has two arms. Jersey copy/numbers removed, native title punctuation retained.
- Outputs: `masters/haikyu-fly-high.png` (1200×1800); `out/haikyu-fly-high-portrait.webp` (600×900, q80, 80,246 bytes). Logo spelling verified: **Y** — HAIKYU!! FLY HIGH.
- Licence note: official art/logo used for product identification; rights remain with Garena and the respective rights holders, with no affiliation or additional licence grant implied.

### `heartopia` — Heartopia

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/heartopia/id6746151928); publisher/seller: XD (HK) / XD (HK) Limited.
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/34/8b/e4/348be4c2-b208-594d-8559-b70acf6b40a0/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/1024x1024bb.jpg); downloaded `heartopia-icon.png`, normalized as `heartopia-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://website.xdcdn.net/poster/133737826/ai-resource/RG4RD4j6.png); selected local file `refs/final-batches/heartopia-logo-reference.png`.
- Subject/edit: Official pink-haired, blue-bow avatar with crystal, white blouse and blue overalls. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Logo reference cropped before generation to exclude the My Little Pony collaboration mark. Native heart details remain.
- Outputs: `masters/heartopia.png` (1200×1800); `out/heartopia-portrait.webp` (600×900, q80, 48,394 bytes). Logo spelling verified: **Y** — HEARTOPIA.
- Licence note: official art/logo used for product identification; rights remain with XD (HK) and the respective rights holders, with no affiliation or additional licence grant implied.

### `laplace-m` — Laplace M

- Exact product: [manifest-matched store listing](https://laplacem.zlongame.com/); publisher/seller: Zlongame / Zlongame.
- Character art: [official source file](https://laplacem.zlongame.com/img/en/en_zs.jpg); downloaded `laplace-m-official-warrior.png`, normalized as `laplace-m-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://laplacem.zlongame.com/img/logo.png); selected local file `refs/final-batches/laplace-m-logo.png`.
- Subject/edit: Official orange-haired warrior in closed silver/bronze armor, with shield/sword and fantasy castle. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Fully armored character selected for heroic framing. Native blue/white serif lettering and wing flourishes retained.
- Outputs: `masters/laplace-m.png` (1200×1800); `out/laplace-m-portrait.webp` (600×900, q80, 112,714 bytes). Logo spelling verified: **Y** — Laplace M.
- Licence note: official art/logo used for product identification; rights remain with Zlongame and the respective rights holders, with no affiliation or additional licence grant implied.

### `lifeafter` — LifeAfter

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/lifeafter/id1441752845); publisher/seller: NetEase / Hong Kong Netease Interactive Entertainment Limited.
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/d6/22/07/d62207bc-7718-200f-db6d-e7ba1824f6c3/2208x1242-_U4e3bKV.jpg/2208x1242bb.jpg); downloaded `lifeafter-art.png`, normalized as `lifeafter-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://webinput.game.easebar.com/img/lifeafter.game/logo.png); selected local file `refs/final-batches/lifeafter-logo.png`.
- Subject/edit: Official cap-wearing female survivor in plaid shirt, tactical harness/backpack and pink-wrapped bat. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Source checked before rendering: backwards cap, not helmet/goggles. Other people, 101 Resort/Rebirth Day copy and UI removed. Native two-human logo silhouettes retained.
- Outputs: `masters/lifeafter.png` (1200×1800); `out/lifeafter-portrait.webp` (600×900, q80, 96,602 bytes). Logo spelling verified: **Y** — LIFEAFTER.
- Licence note: official art/logo used for product identification; rights remain with NetEase and the respective rights holders, with no affiliation or additional licence grant implied.

### `lineage2m` — Lineage2M

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/lineage2m/id6739482834); publisher/seller: NCSOFT (NCV Games) / NCV Games Pte. Ltd.
- Character art: [official source file](https://cdn-mainsite-aka.vnggames.com/products/l2ms/skin-2024/promotion/assets/images/bg/bg-header.jpg); downloaded `lineage2m-vng-hero-art.png`, normalized as `lineage2m-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://fizz-download.playnccdn.com/download/v2/buckets/marketing-platform/files/196561528e2-195e042e-9921-4ef0-86da-94601d663f02); selected local file `refs/final-batches/lineage2m-compact-logo-reference.png`.
- Subject/edit: Fully enclosed black/gold horned knight from the back-left of official VNG key art. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Official compact NCV lockup used: LINEAGE with gold II/M monogram at the right. Fully armored source knight selected instead of the foreground characters; no invented human face.
- Outputs: `masters/lineage2m.png` (1200×1800); `out/lineage2m-portrait.webp` (600×900, q80, 86,484 bytes). Logo spelling verified: **Y** — LINEAGE II M.
- Licence note: official art/logo used for product identification; rights remain with NCSOFT (NCV Games) and the respective rights holders, with no affiliation or additional licence grant implied.

### `machina-waking` — Machina Waking

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/machina-waking/id6698864769); publisher/seller: Guangzhou Diansheng / Guangzhou Diansheng Information Technology Co., Ltd..
- Character art: [official source file](https://play-lh.googleusercontent.com/M3-mhUrZvX7CWT0ST_4wdEDrEqQduNgWcyHetLviex3hxxbGa-ifd2RgQb4XSTo8gsC5s2wFpa-LOn3qXqZCxQ=s0); downloaded `machina-waking-art.png`, normalized as `machina-waking-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://play-lh.googleusercontent.com/M3-mhUrZvX7CWT0ST_4wdEDrEqQduNgWcyHetLviex3hxxbGa-ifd2RgQb4XSTo8gsC5s2wFpa-LOn3qXqZCxQ=s0); selected local file `refs/final-batches/machina-waking-logo-reference.png`.
- Subject/edit: Official silver-haired male at the right of the Play feature graphic, in navy/cyan armor, shown in profile. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Profile retained rather than inventing a new front-facing likeness. Other character and promotional copy removed; native gear/cyber wordmark preserved.
- Outputs: `masters/machina-waking.png` (1200×1800); `out/machina-waking-portrait.webp` (600×900, q80, 76,114 bytes). Logo spelling verified: **Y** — MACHINA WAKING.
- Licence note: official art/logo used for product identification; rights remain with Guangzhou Diansheng and the respective rights holders, with no affiliation or additional licence grant implied.

### `mu-origin-2` — MU ORIGIN 2

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/mu-origin-2/id1444994196); publisher/seller: GameNow Technology / GAMENOW TECHNOLOGY LIMITED.
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/3b/e9/a5/3be9a54e-b6e9-4668-7bda-210e94847b07/cba7d403-4aa8-45ba-bc60-65c8e41096b0_2208x1242-1-en.jpg/2208x1242bb.jpg); downloaded `mu-origin-2-art.png`, normalized as `mu-origin-2-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://content.game-bean.com/image/qiji/web/logo.png); selected local file `refs/final-batches/mu-origin-2-logo.png`.
- Subject/edit: Official red-haired purple/silver armored male warrior with native lower-face guard. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 70%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Native tall gold II ornament rises above the lower third into the fade; MU / ORIGIN 2 lettering stays low and clear of the face. Logo keeps native proportions at 70% width.
- Outputs: `masters/mu-origin-2.png` (1200×1800); `out/mu-origin-2-portrait.webp` (600×900, q80, 91,810 bytes). Logo spelling verified: **Y** — MU ORIGIN 2.
- Licence note: official art/logo used for product identification; rights remain with GameNow Technology and the respective rights holders, with no affiliation or additional licence grant implied.

### `one-punch-man` — ONE PUNCH MAN: The Strongest

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/one-punch-man-the-strongest/id1491275510); publisher/seller: FingerFun / FingerFun (HK) Limited.
- Character art: [official source file](https://content.game-bean.com/image/yqcr/dny/pc/yqcr_130.png); downloaded `opm-role-yqcr_130.png`, normalized as `one-punch-man-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://content.game-bean.com/image/yqcr/web/pc/logo.png); selected local file `refs/final-batches/one-punch-man-logo.png`.
- Subject/edit: Official Saitama in yellow jumpsuit, white cape and red gloves. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Manifest app is One Punch Man: The Strongest, not One Punch Man World. THE STRONGEST band and Saitama/cape emblem retained; character name/CV/quote UI removed.
- Outputs: `masters/one-punch-man.png` (1200×1800); `out/one-punch-man-portrait.webp` (600×900, q80, 81,692 bytes). Logo spelling verified: **Y** — ONE PUNCH MAN THE STRONGEST.
- Licence note: official art/logo used for product identification; rights remain with FingerFun and the respective rights holders, with no affiliation or additional licence grant implied.

### `ragnarok-m-eternal-love` — Ragnarok M : Eternal Love

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/ragnarok-m-eternal-love/id1404051022); publisher/seller: Gravity Interactive / Gravity Interactive, Inc..
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/40/12/19/4012197c-8297-2f67-a60b-b7b12b3fdb15/2796x1290-EN.png/2208x1242bb.png); downloaded `ragnarok-m-eternal-love-art.png`, normalized as `ragnarok-m-eternal-love-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://website.xdcdn.net/poster/191499/homepage/Ic1llZeD.png); selected local file `refs/final-batches/ragnarok-m-eternal-love-na-ref-1.png`.
- Subject/edit: Blonde blue/white-clad chibi adventurer at the left foreground of official store art. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Full English official Eternal Love lockup from the NA site used, not the later 2.0 emblem alone. Native Ö umlaut and gold M retained. Snowy setting retained, event wording and other characters removed.
- Outputs: `masters/ragnarok-m-eternal-love.png` (1200×1800); `out/ragnarok-m-eternal-love-portrait.webp` (600×900, q80, 104,348 bytes). Logo spelling verified: **Y** — RAGNARÖK M ETERNAL LOVE.
- Licence note: official art/logo used for product identification; rights remain with Gravity Interactive and the respective rights holders, with no affiliation or additional licence grant implied.

### `speed-drifters` — Garena Speed Drifters

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/garena-speed-drifters/id1416604843); publisher/seller: Garena / Garena Online Private Ltd..
- Character art: [official source file](https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/67/f9/76/67f9766a-5bf8-e038-15c0-2b8010365d3e/AppIcon-1x_U007emarketing-0-10-0-85-220-0.png/1024x1024bb.jpg); downloaded `speed-drifters-icon.png`, normalized as `speed-drifters-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://speed.garena.com/main/static/Logo-24cdfa92218f2bfc128e3d2b33b12d9a.png); selected local file `refs/final-batches/speed-drifters-logo.png`.
- Subject/edit: Official chestnut-haired yellow/black-cap racing avatar with lightning earrings. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Cap SPEED/09 lettering and Garena badge removed. Native gold/silver tire-and-cyan wordmark retained.
- Outputs: `masters/speed-drifters.png` (1200×1800); `out/speed-drifters-portrait.webp` (600×900, q80, 81,762 bytes). Logo spelling verified: **Y** — SPEED DRIFTERS.
- Licence note: official art/logo used for product identification; rights remain with Garena and the respective rights holders, with no affiliation or additional licence grant implied.

### `state-of-survival` — State of Survival: Zombie War

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/state-of-survival-zombie-war/id1452474937); publisher/seller: FunPlus / FunPlus International AG.
- Character art: [official source file](https://d15h26rducpaui.cloudfront.net/kg-face/dev/ss_ea/hero/4a2c0fdf0a067ae42c2af9a62af57966.png); downloaded `state-of-survival-hero-1.png`, normalized as `state-of-survival-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://kg-web-cdn.akamaized.net/prod/official-website/sos-new-official-website/dist/public/logo.png); selected local file `refs/final-batches/state-of-survival-logo.png`.
- Subject/edit: Official hooded male survivor with scarf, gloves and respirator at neck, in an overgrown city. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Character-led portrait replaces hazard-only imagery. Source blood marks and garment letters removed. Native fist cutout in A retained.
- Outputs: `masters/state-of-survival.png` (1200×1800); `out/state-of-survival-portrait.webp` (600×900, q80, 101,040 bytes). Logo spelling verified: **Y** — STATE OF SURVIVAL.
- Licence note: official art/logo used for product identification; rights remain with FunPlus and the respective rights holders, with no affiliation or additional licence grant implied.

### `where-winds-meet` — Where Winds Meet

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/where-winds-meet/id6472396866); publisher/seller: NetEase / NETEASE INTERACTIVE ENTERTAINMENT PTE. LTD.
- Character art: [official source file](https://www.wherewindsmeetgame.com/pc/gw/20251024112521/img/kv-pc-bg_6cd43691.jpg); downloaded `where-winds-meet-art.png`, normalized as `where-winds-meet-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3564740/logo.png); selected local file `refs/final-batches/where-winds-meet-steam-logo.png`.
- Subject/edit: Central black-haired armored swordsman from official key art, with native sword and shoulder armor. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: GPT Image faithful transparent high-resolution restoration from the downloaded reference, composited separately without enlarging the restored logo; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Other views/armies removed. Full English Steam wordmark used rather than an emblem or anniversary slogan; native gold brush flourish retained.
- Outputs: `masters/where-winds-meet.png` (1200×1800); `out/where-winds-meet-portrait.webp` (600×900, q80, 88,150 bytes). Logo spelling verified: **Y** — WHERE WINDS MEET.
- Licence note: official art/logo used for product identification; rights remain with NetEase and the respective rights holders, with no affiliation or additional licence grant implied.

### `zepeto` — ZEPETO: Avatar, Connect & Live

- Exact product: [manifest-matched store listing](https://apps.apple.com/id/app/zepeto-avatar-connect-live/id1350301428); publisher/seller: NAVER Z / NAVER Z Corporation.
- Character art: [official source file](https://cf-web.zepeto.me/assets/img/im-default-og-new.png); downloaded `zepeto-art.png`, normalized as `zepeto-character-reference.png` under `refs/final-batches/`.
- Logo reference: [downloaded reference](https://cf-web.zepeto.me/_app/immutable/chunks/NewZepetoWorldLogo-7c817475.js); selected local file `refs/final-batches/zepeto-logo.svg`.
- Subject/edit: Official silver-blonde 3D avatar at the back center of the site OG art, wearing a white crewneck. GPT Image recomposed/outpainted the official reference, extended a related background, matched rich lighting/saturation and added the smooth navy lower fade.
- Logo method: official native vector paths rendered and directly composited; final width 80%. Exact spelling and final edges viewed at master zoom.
- Notes/compromise: Other avatars and garment X marks removed. Logo directly composited from native official SVG path geometry extracted from the site bundle, in the white variant supported by official OG art; no generated logo reconstruction.
- Outputs: `masters/zepeto.png` (1200×1800); `out/zepeto-portrait.webp` (600×900, q80, 62,094 bytes). Logo spelling verified: **Y** — ZEPETO.
- Licence note: official art/logo used for product identification; rights remain with NAVER Z and the respective rights holders, with no affiliation or additional licence grant implied.

### Final review files

- `batch-3-sheet.png`: new CrossFire operator first row, ten Batch 3 cards in six/four rows at 300×450, then eleven actual-size 120×180 cards.
- `batch-4-sheet.png`: ten Batch 4 cards in six/four rows at 300×450 and ten actual-size 120×180 cards.
- `all-48-sheet.png`: complete catalog, eight per row at 200×300, alphabetical by slug, labeled; 24 px horizontal gaps and #080C1E background.
- `qa/batch-3-mobile.png`, `qa/batch-4-mobile.png`, final master logo crops and `qa/final-batches-asset-checks.json` support review.
- Research URL registry, selected inputs, exact prompts and visual-review records are under `refs/final-batches/`.
