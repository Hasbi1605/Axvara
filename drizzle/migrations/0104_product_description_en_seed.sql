-- 0104_product_description_en_seed.sql — Terjemahan Inggris deskripsi produk (LOCAL ONLY).
--
-- Sumber: export produksi 2026-11-07 (95 produk aktif). Hanya produk yang punya
-- teks (admin_description_override ?? description) dan bukan produk Testing Only.
-- Admin-owned: UPDATE hanya mengisi description_en yang masih NULL agar suntingan
-- admin di panel tidak pernah tertimpa. Angka/durasi/peringatan mengikuti teks ID.

UPDATE products SET description_en='Adobe Creative Cloud unlocks access to Adobe''s flagship creative apps for design, photo, video, and animation in one subscription.

- Photoshop, Illustrator, and InDesign
- Premiere Pro and After Effects
- Acrobat, Lightroom, Adobe XD, and many more' WHERE slug='adobe-creative-cloud' AND description_en IS NULL;
UPDATE products SET description_en='A ready-to-use GSuite account with flexible duration options, suitable for temporary needs such as work, study, and productivity, as well as signing up for services that offer premium trials and require an email account.

- Ready to use with fast activation
- Duration options from 1 day to 1 month
- Suitable for registering apps or premium trial services

Terms & Conditions:
- The number of days in the variant name is the account''s active period, not processing time (1 Day active 1 day, 3 Days active 3 days, 7 Days active 7 days, 1 Month active 1 month)
- The active period starts when the account is delivered or activated
- Full warranty during the account''s active period' WHERE slug='akun-gsuite' AND description_en IS NULL;
UPDATE products SET description_en='Alight Motion Premium is the paid version of the video editing and animation app for creating quality work easily and creatively.

- Professional effects and unlimited layers
- No watermark' WHERE slug='alight-motion' AND description_en IS NULL;
UPDATE products SET description_en='Alight Motion Premium for motion graphics on phones.
- Annual account and bot create account options
- Stock available, processed immediately' WHERE slug='alight-motion-sk' AND description_en IS NULL;
UPDATE products SET description_en='Apple Music is a premium music streaming service with millions of ad-free songs.

- High audio quality
- Exclusive playlists from around the world' WHERE slug='apple-music' AND description_en IS NULL;
UPDATE products SET description_en='Apple Music for streaming millions of songs.
- Famhead, iOS, and Android options
- Check stock status before checkout' WHERE slug='apple-music-sk' AND description_en IS NULL;
UPDATE products SET description_en='Bstation Premium is a streaming service for popular anime and Asian content, suitable for fans of anime, dramas, and other Asian entertainment.

- Ad-free with high image quality
- Fast and convenient access' WHERE slug='bstation' AND description_en IS NULL;
UPDATE products SET description_en='Bstation for watching anime.
- Check stock status before checkout' WHERE slug='bstation-sk' AND description_en IS NULL;
UPDATE products SET description_en='CamScanner is a document scanning app that turns photos of documents into digital files directly from your phone.' WHERE slug='camscanner' AND description_en IS NULL;
UPDATE products SET description_en='Canva Pro unlocks Canva''s premium features for faster, more professional designs — from social media content, presentations, posters, and CVs to business needs and other creative projects.

- Millions of premium templates, elements, photos, videos, and fonts
- One-click Background Remover, Magic Resize, and AI Magic Studio features
- Brand Kit for logos, fonts, and brand colors, plus high-quality design export

Terms & Conditions:
- The Canva invitation is sent by email
- Make sure the email you enter at checkout is active

How to Activate:
- Open the invitation email from Canva and accept the invitation' WHERE slug='canva-premium' AND description_en IS NULL;
UPDATE products SET description_en='CapCut Pro is the premium version of the popular video editing app for more professional results, ideal for TikTok, Instagram Reels, and YouTube Shorts creators.

- No watermark and ad-free
- Exclusive Pro features' WHERE slug='capcut-pro' AND description_en IS NULL;
UPDATE products SET description_en='CapCut Pro for watermark-free editing with all premium effects.
- All templates, effects, and AI tools unlocked
- Private and sharing options available as needed
- Backfree warranty according to the variant terms' WHERE slug='capcut-sk' AND description_en IS NULL;
UPDATE products SET description_en='Claude Pro is a paid subscription plan ($20/month) from Anthropic for the Claude AI chatbot, designed for complex reasoning and document analysis.

- 5x more usage than the free version
- Priority access and the latest features' WHERE slug='claude-pro' AND description_en IS NULL;
UPDATE products SET description_en='Crunchyroll is an on-demand streaming platform dedicated to anime, from a wide range of popular series to original anime produced by Crunchyroll itself.' WHERE slug='crunchyroll' AND description_en IS NULL;
UPDATE products SET description_en='Devin AI Windsurf gives access to advanced AI systems for coding and automation integrated with modern development workflows, including the latest models such as the fast and accurate Claude Opus 4.7 MAX.' WHERE slug='devin-ai-windsurf' AND description_en IS NULL;
UPDATE products SET description_en='Disney+ Hotstar Premium is a streaming service for the whole family with the best quality and no ads.

- Blockbuster films and exclusive series
- Disney, Marvel, Star Wars, Pixar, and National Geographic content' WHERE slug='disney-hotstar' AND description_en IS NULL;
UPDATE products SET description_en='Affordable domains from Name.com for your website or project, with a limited choice of extensions (the list is in the Terms & Conditions).' WHERE slug='domain-murah' AND description_en IS NULL;
UPDATE products SET description_en='Drakor.id is an unofficial app from Indonesia for streaming Korean and Asian dramas, complete with Indonesian subtitles.' WHERE slug='drakor-id' AND description_en IS NULL;
UPDATE products SET description_en='Get access to thousands of short and long dramas from various platforms in one place.
Website: https://dramaku.world' WHERE slug='drama-all-in-one' AND description_en IS NULL;
UPDATE products SET description_en='Duolingo Premium for ad-free language learning.
- 7-day plan, store warranty' WHERE slug='duolingo-sk' AND description_en IS NULL;
UPDATE products SET description_en='An official Campus Email (.ac.id) with full access — the key to many student benefits and discounts across premium services, from AI tools and creative software to streaming and education subscriptions.

- Active, ready-to-use email with full access (send & receive email)
- Can be used to sign up for student plans / education discounts, such as Spotify Student, YouTube Premium Student, GitHub Student Pack, Notion & Figma Education (availability follows each service''s policy)
- Suitable for claiming student trials and benefits across various apps
- Fast delivery after payment is verified

Terms & Conditions:
- The campus email is assigned randomly; specific campuses/universities cannot be requested
- No warranty after the account is handed over in active condition — secure and use it immediately
- One email for one buyer; do not share it with others
- Use it according to the destination service''s rules; AXVARA is not responsible if a student benefit is rejected or revoked by the service provider
- Make sure the contact email you enter at checkout is active to receive the account details

How to Activate:
- After payment is verified, the account details (email + password) are sent to your email/WhatsApp
- Log in and secure the account, then use it to sign up for the student benefit you want' WHERE slug='email-kampus-student-ac-id' AND description_en IS NULL;
UPDATE products SET description_en='Private and sharing Express VPN for a fast connection.
- Check stock status before checkout' WHERE slug='express-vpn-sk' AND description_en IS NULL;
UPDATE products SET description_en='Getcontact helps identify unknown phone numbers and block spam calls, based on its user database.

- See who is calling from an unknown number
- Block disturbing or spam calls and messages' WHERE slug='getcontact-premium' AND description_en IS NULL;
UPDATE products SET description_en='GitHub Copilot is an AI-based coding assistant from GitHub and OpenAI that helps developers write code faster, right in editors such as Visual Studio Code.

- Automatic code suggestions and line completion
- Generates complete functions from context or comments' WHERE slug='github-copilot' AND description_en IS NULL;
UPDATE products SET description_en='GitHub Student Developer Pack is an official GitHub program containing various facilities and offers to support learning, project development, and technology exploration for students.' WHERE slug='github-student' AND description_en IS NULL;
UPDATE products SET description_en='Google AI Pro for work, study, and content creation with Gemini and cloud storage.

Variant options:
- Head 3 Months: Google AI Pro 3-month redeem link, supports Antigravity (Argon).
- Head 18 Months: Jio promo redeem link to your own account.
- Invite 18 Months: family invitation, shared AI quota and storage. Personal data stays private.

Benefit details, terms, and activation steps follow the selected variant.' WHERE slug='google-ai-pro-antigravity' AND description_en IS NULL;
UPDATE products SET description_en='SuperGrok is a premium subscription from xAI with access to its most advanced model, Grok 4, which is more powerful, faster, and smarter than standard Grok.

- Multimodal: processes text, images, and voice
- Access to tools such as DeepSearch' WHERE slug='grok-ai' AND description_en IS NULL;
UPDATE products SET description_en='HBO Max is a paid streaming service owned by Warner Bros. Discovery.

- Thousands of popular films and series from HBO and the DC Universe
- Exclusive Originals' WHERE slug='hbo-max' AND description_en IS NULL;
UPDATE products SET description_en='HideMyAss VPN for privacy and changing region.
- 1-month sharing, limited stock' WHERE slug='hidemyass-vpn-sk' AND description_en IS NULL;
UPDATE products SET description_en='HMA VPN (HideMyAss) is an easy-to-use VPN with more than 1,100 servers in 190 countries. Speed can be unstable and less than optimal for streaming.

- Strong encryption
- No-logs policy' WHERE slug='hma-vpn' AND description_en IS NULL;
UPDATE products SET description_en='iLovePDF is an online platform with complete tools for managing PDF files.

- Merge, split, and compress PDFs
- Convert and edit PDF documents' WHERE slug='i-love-pdf' AND description_en IS NULL;
UPDATE products SET description_en='iQIYI VIP is a leading streaming service for the latest Asian dramas, films, variety shows, and popular anime, ideal for fans of Chinese and Korean dramas.

- Ad-free, viewing quality up to 1080p/4K
- Faster access to the latest episodes and iQIYI exclusive original series
- Multilingual subtitles' WHERE slug='iqiyi' AND description_en IS NULL;
UPDATE products SET description_en='iQIYI for Chinese and Korean dramas.
- Private and sharing options
- Check stock status before checkout' WHERE slug='iqiyi-sk' AND description_en IS NULL;
UPDATE products SET description_en='Kiro AI (Kiro IDE) is an AI agent-based IDE developed by the team at AWS to speed up software development with a Spec-Driven Development approach, turning prompts into technical plans, code, documents, and tests.' WHERE slug='kiro-ai' AND description_en IS NULL;
UPDATE products SET description_en='Leonardo.Ai is a generative AI platform for creating high-quality visual assets from text prompts, designed for creators, designers, and businesses.

- High-quality images and illustrations
- Art concepts and 3D textures' WHERE slug='leonardo-ai' AND description_en IS NULL;
UPDATE products SET description_en='Loklok is a streaming platform for watching films, TV series, dramas (including Korean dramas), and anime in one app.' WHERE slug='loklok' AND description_en IS NULL;
UPDATE products SET description_en='Meitu Premium is a professional photo editing service for more aesthetic, smooth, share-ready photos.

- Advanced beauty and retouch features
- Exclusive filters and creative tools' WHERE slug='meitu-premium' AND description_en IS NULL;
UPDATE products SET description_en='Microsoft Project is project management software developed and sold by Microsoft to help project managers plan, manage, and track tasks and budgets.' WHERE slug='microsoft-project' AND description_en IS NULL;
UPDATE products SET description_en='Microsoft Visio is vector graphics-based application software developed by Microsoft for creating various types of complex diagrams and visual illustrations.' WHERE slug='microsoft-visio' AND description_en IS NULL;
UPDATE products SET description_en='Muse AI is an autonomous AI agent from Meta, the company behind WhatsApp, Instagram, Threads, and Facebook. Within the same ecosystem, Muse works well as an assistant for social media promotion and content creation — from researching ideas and writing captions and promotional material to planning a content calendar.

Muse runs 24 hours with its own virtual machine and can help with coding, research, analysis, content creation, and scheduling. It is also multimodal: it can read text, images, video, and audio, and generate images and video.

Highlights:
- Built-in VPS: 2 vCPU, ±7.7 GB RAM, 100 GB storage
- 24-hour background tasks without renting an extra VPS
- Built-in browser and direct control / chat via WhatsApp
- Connectors to Google Workspace, GitHub, Canva, Instagram, Threads, and other services
- Ready-to-use account without a credit card or VPN' WHERE slug='muse-ai-1-miliar-token' AND description_en IS NULL;
UPDATE products SET description_en='Netflix Premium is the top plan from the world''s most popular streaming service, suitable for personal or family entertainment.

- Thousands of films, series, documentaries, and exclusive original titles
- The best viewing quality' WHERE slug='netflix-premium' AND description_en IS NULL;
UPDATE products SET description_en='Netflix Premium sharing with your own profile, unlimited viewing without ads.
- Stable sharing account, watch on your own profile
- Up to Ultra HD 4K quality according to the profile plan
- Works on phones, laptops, and Smart TVs
- Full warranty during the active period if you follow the rules' WHERE slug='netflix-sk' AND description_en IS NULL;
UPDATE products SET description_en='Microsoft 365 is a cloud-based productivity platform with the popular Office apps, the latest feature updates, and advanced security.

- Word, Excel, PowerPoint, Outlook, and Teams
- Bonus 1 TB OneDrive cloud storage' WHERE slug='office365-lifetime' AND description_en IS NULL;
UPDATE products SET description_en='PicsArt Pro is the premium version of PicsArt for more professional photo and video editing.

- Full access to effects, stickers, fonts, and advanced tools
- Ad-free' WHERE slug='picsart-pro' AND description_en IS NULL;
UPDATE products SET description_en='Picsart Premium for photo editing with all gold effects.
- Private and sharing options, daily to monthly
- Check stock status before checkout' WHERE slug='picsart-sk' AND description_en IS NULL;
UPDATE products SET description_en='Prime Video is Amazon''s streaming service with complete content in one platform.

- Films, series, and exclusive Prime Original titles
- High quality with offline viewing' WHERE slug='prime-video' AND description_en IS NULL;
UPDATE products SET description_en='Prime Video for Amazon films and original series.
- Private (5 profiles) and sharing (1 profile) options
- Active period 25-30 days
- Legal and covered by warranty' WHERE slug='prime-video-sk' AND description_en IS NULL;
UPDATE products SET description_en='Remini is an AI-based photo and video editor that turns low-quality images into sharp, clear ones.

- Clears up blurry images
- Repairs old, damaged photos
- Sharpens low resolution into HD quality' WHERE slug='remini-premium' AND description_en IS NULL;
UPDATE products SET description_en='Remini Pro to enhance blurry photos into sharp ones.
- Private and sharing options from 7 days to monthly
- Check stock status before checkout' WHERE slug='remini-pro-sk' AND description_en IS NULL;
UPDATE products SET description_en='Scribd Premium gives full, unlimited access to the Scribd digital library.

- Ebooks and audiobooks
- Documents, magazines, and sheet music' WHERE slug='scribd' AND description_en IS NULL;
UPDATE products SET description_en='Scribd for reading ebooks and audiobooks.
- Check stock status before checkout' WHERE slug='scribd-sk' AND description_en IS NULL;
UPDATE products SET description_en='Spotify Premium is an ad-free music streaming service for a freer, more flexible, high-quality listening experience, suitable for music lovers, podcasts, and daily playlists.' WHERE slug='spotify-premium' AND description_en IS NULL;
UPDATE products SET description_en='Individual Spotify Premium with ad-free and offline music.
- Private individual account, supported on all devices
- High audio quality, download for offline listening
- Full warranty for backfree and disable for 28-30 days' WHERE slug='spotify-premium-sk' AND description_en IS NULL;
UPDATE products SET description_en='Surfshark VPN is a premium VPN service for protecting your privacy and online freedom.

- Strong data encryption
- Fast and stable connection with advanced security features' WHERE slug='surfshark-vpn' AND description_en IS NULL;
UPDATE products SET description_en='TradingView is a cloud-based charting platform and social network where traders and investors analyze global financial markets, from stocks and crypto to forex.' WHERE slug='tradingview-premium' AND description_en IS NULL;
UPDATE products SET description_en='UpCloud is a high-performance cloud infrastructure and hosting provider for developers and businesses, with virtual servers (VPS), storage, and secure networking.' WHERE slug='upcloud' AND description_en IS NULL;
UPDATE products SET description_en='VCC (Virtual Credit Card) is a single-use or temporary digital card for paying digital service subscriptions, such as claiming premium app trials, without using your main card.

- 16-digit card number, expiration date, and CVV code like a physical credit card
- Your main card data stays safe' WHERE slug='vcc-trial-aplikasi' AND description_en IS NULL;
UPDATE products SET description_en='Vidio Platinum is Vidio''s premium streaming service for enjoying favorite entertainment with the best quality and no interruptions.

- Full access to films and series
- Exclusive sports broadcasts' WHERE slug='vidio-platinum' AND description_en IS NULL;
UPDATE products SET description_en='Vidio Platinum Mobile for watching sports and local entertainment.
- Private account, supported on mobile and PC browsers
- 30-day backfree warranty' WHERE slug='vidio-sk' AND description_en IS NULL;
UPDATE products SET description_en='Private Vision+ for watching MNC content and originals.
- Private account, store warranty' WHERE slug='vision-plus-sk' AND description_en IS NULL;
UPDATE products SET description_en='Viu Premium is a streaming service for Asian dramas, films, and variety shows, suitable for fans of Korean, Japanese, and Thai dramas.

- Exclusive access and ad-free
- Complete subtitles and fast episode releases' WHERE slug='viu-premium' AND description_en IS NULL;
UPDATE products SET description_en='Viu Premium for unlimited Asian drama viewing.
- Private account, supported on all devices
- Daily, monthly, and lifetime options
- 3-month warranty for the lifetime plan' WHERE slug='viu-sk' AND description_en IS NULL;
UPDATE products SET description_en='WeTV VIP for Asian dramas and originals.
- Private and sharing options
- Check stock status before checkout' WHERE slug='wetv-sk' AND description_en IS NULL;
UPDATE products SET description_en='WeTV VIP is a streaming service for Asian dramas, films, and variety shows, suitable for fans of Chinese, Korean, and Thai dramas.

- Ad-free with the best viewing quality
- Exclusive WeTV original series' WHERE slug='wetv-vip' AND description_en IS NULL;
UPDATE products SET description_en='Windows is Microsoft''s most popular operating system for PCs and laptops, used to run apps, browse the internet, and manage files.' WHERE slug='windows-10-11-pro' AND description_en IS NULL;
UPDATE products SET description_en='Wink Premium unlocks all the advantages of the Wink app with full access to exclusive and advanced features, for a more personal and efficient experience.' WHERE slug='wink-premium' AND description_en IS NULL;
UPDATE products SET description_en='Youku is a Chinese video streaming platform owned by Alibaba, with dramas, films, anime, and original content.

- VIP features available globally
- Multilingual subtitles' WHERE slug='youku-premium' AND description_en IS NULL;
UPDATE products SET description_en='YouTube Premium brings an ad-free YouTube experience on all devices where you log in, including the YouTube Kids app.

- Ad-free, download videos for offline viewing
- Background play
- Includes YouTube Music Premium: ad-free music, offline, and background play' WHERE slug='youtube-premium' AND description_en IS NULL;
UPDATE products SET description_en='YouTube Premium without ads plus YouTube Music.
- Private account from admin, background play enabled
- 25-day warranty' WHERE slug='youtube-sk' AND description_en IS NULL;
UPDATE products SET description_en='Zoom Pro for meetings without the 40-minute limit.
- Private account for 100 participants
- 7-day, 2-week, and 1-month options' WHERE slug='zoom-meetings-pro-sk' AND description_en IS NULL;
UPDATE products SET description_en='Zoom Pro is a premium meeting service for work, online classes, and more comfortable meetings.

- Unlimited video call duration
- More participant capacity
- Cloud recording and advanced meeting controls' WHERE slug='zoom-premium' AND description_en IS NULL;
