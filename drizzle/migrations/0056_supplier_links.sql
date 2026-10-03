-- 0056_supplier_links.sql — Shortlink internal axvara.tech/go/:slug (2026-10-03).
--
-- Pembungkus link supplier + artikel AXVARA yang panjang agar tampil pendek
-- di PDP/email/panel ("axvara.tech/go/otp" bukan
-- "netflix-codes.sekalipay.com/mailbox"). BUKAN SaaS publik ala Kliqs:
-- hanya admin yang bisa CRUD (via /api/admin/supplier-links), pembeli hanya
-- GET redirect 307. Supplier ganti URL → update 1 baris, tanpa edit kurasi.
--
-- CREATE TABLE + INDEX IF NOT EXISTS dan INSERT OR IGNORE: idempoten, aman
-- dijalankan ulang bila prod sudah di-seed manual.
CREATE TABLE IF NOT EXISTS supplier_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  destination     TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  is_active       INTEGER NOT NULL DEFAULT 1,
  click_count     INTEGER NOT NULL DEFAULT 0,
  last_clicked_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_links_slug ON supplier_links(slug);
CREATE INDEX IF NOT EXISTS idx_supplier_links_active ON supplier_links(is_active);

-- Seed 31 slug (peta 2026-10-03 dari kurasi + snapshot + AUDIT D1 PROD LIVE:
-- seluruh wr_terms/wr_delivery_terms/sk_seller_note/sk_description ber-link,
-- termasuk produk off/restok; netflix clearcookies/youraccount SENGAJA tidak
-- dibungkus = keputusan owner):
INSERT OR IGNORE INTO supplier_links (slug, destination, title) VALUES
  ('netflix-login', '/artikel/cara-login-netflix-setelah-order-di-axvara', 'Panduan login Netflix AXVARA'),
  ('alight-login', '/artikel/cara-login-alight-motion-setelah-order-di-axvara', 'Panduan login Alight Motion AXVARA'),
  ('gemini-redeem', '/artikel/cara-redeem-google-ai-pro-setelah-order-di-axvara', 'Panduan redeem Google AI Pro AXVARA'),
  ('otp', 'https://netflix-codes.sekalipay.com/mailbox', 'Mailbox OTP Netflix'),
  ('otp-bot', 'https://bototp.site/', 'Mailbox OTP BotOTP'),
  ('otp-sengare', 'https://sengare.art/check-inbox', 'Mailbox OTP Sengare (Zoom)'),
  ('otp-genjos', 'https://genjos.xoftware.my.id/mailbox', 'Mailbox OTP Genjos (Zoom/Scribd)'),
  ('otp-sekalichat', 'https://tmail.sekalichat.com/', 'Mailbox OTP Sekalichat (Canva/Capcut)'),
  ('otp-waroeng', 'https://waroengmail.com/', 'Mailbox OTP Waroengmail (Wink/Meitu)'),
  ('otp-runcubes', 'https://tmail.runcubesapps.com/mailbox', 'Mailbox OTP Runcubes (Scribd)'),
  ('otp-generator', 'https://generator.email/', 'Mailbox Generator.email (Perplexity)'),
  ('otp-2fa', 'https://2fa.live/', 'Alat kode 2FA (Gemini)'),
  ('mail-olies', 'https://oliesmail.com/', 'Mailbox Oliesmail (Prime Video)'),
  ('mail-fnstore', 'https://fnstore.my.id/', 'Mailbox Fnstore (iQiyi)'),
  ('mail-losantoz', 'https://losantoz.com/', 'Mailbox Losantoz (iQiyi)'),
  ('otp-spotify', 'https://t.me/autoresetpwspotify_bot', 'Bot OTP Spotify'),
  ('bot-viu', 'https://t.me/sekalipayviu_bot', 'Bot Viu Sekalipay'),
  ('bot-alight', 'https://t.me/alightmotion321_bot', 'Bot redeem Alight Motion'),
  ('bot-scribd', 'https://t.me/Scribd_Downloaderbot', 'Bot downloader Scribd'),
  ('tutor-canva', 'https://youtu.be/p_xpw5M1zaU', 'Tutorial Canva Pro'),
  ('tutor-remini', 'https://youtu.be/J07zn3FAJyY', 'Tutorial Remini web'),
  ('tutor-scribd', 'https://youtu.be/8nMzvoauNVk', 'Tutorial Scribd web'),
  ('tutor-arcade', 'https://youtu.be/IbSEx5_pUr8', 'Tutorial redeem Apple Arcade'),
  ('tutor-vision-tv', 'https://www.youtube.com/watch?v=XzMXIty8kr4', 'Cara konek Vision+ ke TV'),
  ('tutor-vision-tv2', 'https://www.youtube.com/watch?v=Ylrroy1fJAE', 'Cara konek Vision+ ke Smart TV'),
  ('office-login', 'https://portal.office.com/', 'Login Office 365'),
  ('office-install', 'https://www.youtube.com/watch?v=fBOfOmj9Uj8', 'Tutorial install Office 365'),
  ('cek-domain', 'https://name.com/', 'Cek domain Name.com'),
  ('github-pack', 'https://education.github.com/pack', 'GitHub Student Pack'),
  ('tv-harga', 'https://tradingview.com/pricing', 'Harga TradingView Premium'),
  ('vidio-web', 'https://m.vidio.com/', 'Nonton Vidio di laptop'),
  ('doc-scribd', 'https://docdownloader.com/', 'Downloader Scribd web'),
  ('netflix-solusi', 'https://pastebin.com/CPYvC5Ku', 'Solusi masalah Netflix'),
  ('grok-error', 'https://drive.google.com/file/d/11Jk3aPT4Jgfw4eWsNiD_BeCN8Xl5_cr0/view?usp=drivesdk', 'Panduan error login Grok'),
  ('ms-family', 'https://support.microsoft.com/id-id/office/berbagi-langganan-microsoft-365-family-b389b9ce-3ae3-4a82-9017-39d79972fcba', 'Berbagi Microsoft 365 Family'),
  ('remini-web', 'https://app.remini.ai/', 'Remini web'),
  ('leonardo-web', 'https://leonardo.ai/', 'Leonardo AI web'),
  ('blackbox-web', 'https://www.blackbox.ai/', 'Blackbox AI web'),
  ('grok-web', 'https://grok.com/', 'Grok web'),
  ('rcti-login', 'https://rctiplus.com/login', 'Login RCTI+ (Vision+)'),
  ('ibis-tutor', 'https://ibispaint.com/lecture/index.jsp?lang=in&no=26', 'Tutorial Ibis Paint'),
  ('wetv-redeem', 'https://film.wetv.vip/wetv/cdkey.html', 'Redeem voucher WeTV'),
  ('dramaku', 'https://dramaku.world/', 'Website Dramaku');
