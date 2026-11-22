-- 0157_pixelverif_whitelabel_copy.sql — salinan ID/EN Google AI Pro 3 Bulan (whitelabel).
--
-- Permintaan owner 23 Nov 2026: tanpa nama mitra/kata supplier, diproses "bot otomatis",
-- kebijakan gagal = dana dikembalikan penuh, penjelasan Link Redeem vs Aktivasi Langsung,
-- versi Inggris. Dibangkitkan dari src/lib/pixelverif/copy.ts. Aman/idempoten:
-- ID hanya menimpa kosong atau template bawaan lama (awalan tetap), *_en hanya bila kosong.

UPDATE products SET description='Langganan Google AI Pro 3 bulan langsung di akun Gmail kamu sendiri, diproses otomatis oleh bot dalam hitungan menit.
- Masa aktif 3 bulan di akun Gmail milikmu
- Diproses otomatis setelah pembayaran terkonfirmasi, status dan urutan antrean tampil di Lacak Pesanan
- Gagal diproses = dana dikembalikan penuh

Pilih yang mana?
- Link Redeem: cocok bila kamu ingin menukarkan sendiri. Kamu menerima link resmi one.google.com, buka saat login ke Gmail yang didaftarkan, lalu ikuti langkah di halaman Google. Estimasi ±1–2 menit.
- Aktivasi Langsung: cocok bila ingin beres tanpa langkah tambahan. Bot memasang langganan langsung ke akun Gmail kamu; kamu menerima link beserta keterangan status aktivasi. Estimasi ±3–5 menit.

Syarat akun:
- Gmail aktif, tidak sedang diminta captcha atau ditandai aktivitas tidak biasa.
- Hapus passkey di myaccount.google.com/signinoptions/passkeys.
- Tutup payment profile lama di payments.google.com (bila ada).
- Keluar dari Google Family di families.google.com/families.
- Tidak ada langganan Gemini/Google One yang sedang aktif.
- Verifikasi 2 langkah aktif dengan aplikasi authenticator (myaccount.google.com/signinoptions/twosv).
- Disarankan memakai Gmail cadangan.', updated_at=datetime('now')
WHERE pixelverif_family='google_ai_pro_3m' AND (description IS NULL OR description='' OR description LIKE 'Google AI Pro 3 bulan via Pixel%');

UPDATE products SET description_en='A 3-month Google AI Pro subscription on your own Gmail account, processed automatically by our bot within minutes.
- 3 months of Google AI Pro on the Gmail you own
- Processed automatically once payment is confirmed; status and queue position appear on Track Order
- Failed to process = full refund

Which one should I pick?
- Redeem Link: for buyers who prefer to redeem it themselves. You receive an official one.google.com link; open it while signed in to the registered Gmail and follow the steps on Google''s page. About 1–2 minutes.
- Direct Activation: for buyers who want it done with no extra steps. The bot activates the subscription straight on your Gmail; you receive the link plus an activation status note. About 3–5 minutes.

Account requirements:
- Active Gmail that is not being asked for a captcha or flagged for unusual activity.
- Remove passkeys at myaccount.google.com/signinoptions/passkeys.
- Close any old payment profile at payments.google.com.
- Leave Google Family at families.google.com/families.
- No active Gemini/Google One subscription.
- 2-Step Verification on, using an authenticator app (myaccount.google.com/signinoptions/twosv).
- Using a spare Gmail is recommended.', updated_at=datetime('now')
WHERE pixelverif_family='google_ai_pro_3m' AND (description_en IS NULL OR description_en='');

UPDATE products SET name_en='Google AI Pro 3 Months', updated_at=datetime('now')
WHERE pixelverif_family='google_ai_pro_3m' AND (name_en IS NULL OR name_en='');

UPDATE product_variants SET admin_terms='Detail paket:
- Link redeem resmi Google AI Pro 3 bulan (one.google.com) untuk Gmail yang kamu daftarkan; kamu menukarkannya sendiri.
- Data yang diminta saat checkout: alamat Gmail, password Gmail, dan kunci setup 2FA (kunci dari aplikasi authenticator, bukan kode 6 digit).
- Data akun disimpan terenkripsi, hanya dipakai bot otomatis untuk memproses pesanan ini, dan dihapus dari sistem kami setelah pesanan selesai atau gagal.
- Jangan mengubah password atau 2FA selama pesanan diproses.

Syarat akun:
- Gmail aktif, tidak sedang diminta captcha atau ditandai aktivitas tidak biasa.
- Hapus passkey di myaccount.google.com/signinoptions/passkeys.
- Tutup payment profile lama di payments.google.com (bila ada).
- Keluar dari Google Family di families.google.com/families.
- Tidak ada langganan Gemini/Google One yang sedang aktif.
- Verifikasi 2 langkah aktif dengan aplikasi authenticator (myaccount.google.com/signinoptions/twosv).
- Disarankan memakai Gmail cadangan.

Proses & pengiriman:
- Diproses otomatis oleh bot setelah pembayaran terkonfirmasi, estimasi ±1–2 menit.
- Status dan urutan antrean tampil di halaman Lacak Pesanan; link dikirim ke email/Telegram kontak pesanan.

Pengembalian dana:
- Pesanan yang gagal diproses dikembalikan penuh, termasuk gagal karena password, kunci 2FA, atau syarat akun tidak terpenuhi.
- Ingin mencoba lagi dengan data yang sudah diperbaiki? Buat pesanan baru setelah dana dikembalikan.
- Gmail yang dinyatakan tidak memenuhi syarat untuk penawaran ini tidak dapat dipesan ulang; gunakan Gmail lain.'
WHERE sku='PV-NORMAL-3' AND product_id IN (SELECT id FROM products WHERE pixelverif_family='google_ai_pro_3m') AND (admin_terms IS NULL OR admin_terms='' OR admin_terms LIKE 'Syarat: akun aktif tanpa captcha%');

UPDATE product_variants SET admin_terms_en='Package details:
- Official 3-month Google AI Pro redeem link (one.google.com) for the Gmail you register; you redeem it yourself.
- Requested at checkout: Gmail address, Gmail password and 2FA setup key (the key from your authenticator app, not the 6-digit code).
- Account data is stored encrypted, used only by our automated bot to process this order, and deleted from our system once the order completes or fails.
- Do not change your password or 2FA while the order is being processed.

Account requirements:
- Active Gmail that is not being asked for a captcha or flagged for unusual activity.
- Remove passkeys at myaccount.google.com/signinoptions/passkeys.
- Close any old payment profile at payments.google.com.
- Leave Google Family at families.google.com/families.
- No active Gemini/Google One subscription.
- 2-Step Verification on, using an authenticator app (myaccount.google.com/signinoptions/twosv).
- Using a spare Gmail is recommended.

Processing & delivery:
- Processed automatically by our bot once payment is confirmed, about 1–2 minutes.
- Status and queue position appear on the Track Order page; the link is sent to the order''s contact email/Telegram.

Refunds:
- Orders that fail to process are refunded in full, including failures caused by a wrong password, 2FA key, or unmet account requirements.
- Want to try again with corrected details? Place a new order after the refund.
- A Gmail found ineligible for this offer cannot be ordered again; please use another Gmail.'
WHERE sku='PV-NORMAL-3' AND product_id IN (SELECT id FROM products WHERE pixelverif_family='google_ai_pro_3m') AND (admin_terms_en IS NULL OR admin_terms_en='');

UPDATE product_variants SET admin_activation='1. Tunggu link muncul di halaman Lacak Pesanan atau email/Telegram (±1–2 menit setelah pembayaran).
2. Login ke Gmail yang didaftarkan di browser.
3. Buka link one.google.com yang diterima.
4. Ikuti langkah di halaman Google sampai Google AI Pro aktif.
5. Cek di one.google.com bahwa paket Google AI Pro sudah aktif.'
WHERE sku='PV-NORMAL-3' AND product_id IN (SELECT id FROM products WHERE pixelverif_family='google_ai_pro_3m') AND (admin_activation IS NULL OR admin_activation='' OR admin_activation LIKE '1. Login ke Gmail yang didaftarkan.%');

UPDATE product_variants SET admin_activation_en='1. Wait for the link on the Track Order page or in your email/Telegram (about 1–2 minutes after payment).
2. Sign in to the registered Gmail in your browser.
3. Open the one.google.com link you received.
4. Follow the steps on Google''s page until Google AI Pro is active.
5. Check on one.google.com that the Google AI Pro plan is active.'
WHERE sku='PV-NORMAL-3' AND product_id IN (SELECT id FROM products WHERE pixelverif_family='google_ai_pro_3m') AND (admin_activation_en IS NULL OR admin_activation_en='');

UPDATE product_variants SET admin_terms='Detail paket:
- Google AI Pro 3 bulan diaktifkan langsung oleh bot otomatis ke Gmail yang kamu daftarkan, tanpa langkah tambahan.
- Kamu menerima link beserta keterangan status aktivasi.
- Selama aktivasi, metode pembayaran dapat ditambahkan ke akun Google kamu; cek dan matikan perpanjangan otomatis di one.google.com bila ada.
- Data yang diminta saat checkout: alamat Gmail, password Gmail, dan kunci setup 2FA (kunci dari aplikasi authenticator, bukan kode 6 digit).
- Data akun disimpan terenkripsi, hanya dipakai bot otomatis untuk memproses pesanan ini, dan dihapus dari sistem kami setelah pesanan selesai atau gagal.
- Jangan mengubah password atau 2FA selama pesanan diproses.

Syarat akun:
- Gmail aktif, tidak sedang diminta captcha atau ditandai aktivitas tidak biasa.
- Hapus passkey di myaccount.google.com/signinoptions/passkeys.
- Tutup payment profile lama di payments.google.com (bila ada).
- Keluar dari Google Family di families.google.com/families.
- Tidak ada langganan Gemini/Google One yang sedang aktif.
- Verifikasi 2 langkah aktif dengan aplikasi authenticator (myaccount.google.com/signinoptions/twosv).
- Disarankan memakai Gmail cadangan.

Proses & pengiriman:
- Diproses otomatis oleh bot setelah pembayaran terkonfirmasi, estimasi ±3–5 menit.
- Status dan urutan antrean tampil di halaman Lacak Pesanan; hasil dikirim ke email/Telegram kontak pesanan.

Pengembalian dana:
- Pesanan yang gagal diproses dikembalikan penuh, termasuk gagal karena password, kunci 2FA, atau syarat akun tidak terpenuhi.
- Ingin mencoba lagi dengan data yang sudah diperbaiki? Buat pesanan baru setelah dana dikembalikan.
- Gmail yang dinyatakan tidak memenuhi syarat untuk penawaran ini tidak dapat dipesan ulang; gunakan Gmail lain.'
WHERE sku='PV-FULL-3' AND product_id IN (SELECT id FROM products WHERE pixelverif_family='google_ai_pro_3m') AND (admin_terms IS NULL OR admin_terms='' OR admin_terms LIKE 'Syarat: akun aktif tanpa captcha%');

UPDATE product_variants SET admin_terms_en='Package details:
- 3 months of Google AI Pro activated straight on the Gmail you register by our automated bot, with no extra steps.
- You receive the link plus an activation status note.
- A payment method may be added to your Google account during activation; check and turn off auto-renewal on one.google.com if present.
- Requested at checkout: Gmail address, Gmail password and 2FA setup key (the key from your authenticator app, not the 6-digit code).
- Account data is stored encrypted, used only by our automated bot to process this order, and deleted from our system once the order completes or fails.
- Do not change your password or 2FA while the order is being processed.

Account requirements:
- Active Gmail that is not being asked for a captcha or flagged for unusual activity.
- Remove passkeys at myaccount.google.com/signinoptions/passkeys.
- Close any old payment profile at payments.google.com.
- Leave Google Family at families.google.com/families.
- No active Gemini/Google One subscription.
- 2-Step Verification on, using an authenticator app (myaccount.google.com/signinoptions/twosv).
- Using a spare Gmail is recommended.

Processing & delivery:
- Processed automatically by our bot once payment is confirmed, about 3–5 minutes.
- Status and queue position appear on the Track Order page; the result is sent to the order''s contact email/Telegram.

Refunds:
- Orders that fail to process are refunded in full, including failures caused by a wrong password, 2FA key, or unmet account requirements.
- Want to try again with corrected details? Place a new order after the refund.
- A Gmail found ineligible for this offer cannot be ordered again; please use another Gmail.'
WHERE sku='PV-FULL-3' AND product_id IN (SELECT id FROM products WHERE pixelverif_family='google_ai_pro_3m') AND (admin_terms_en IS NULL OR admin_terms_en='');

UPDATE product_variants SET admin_activation='1. Tunggu keterangan aktivasi di halaman Lacak Pesanan atau email/Telegram (±3–5 menit setelah pembayaran).
2. Bila keterangan menyebut Google AI Pro sudah aktif, tidak ada langkah tambahan.
3. Cek di one.google.com bahwa paket Google AI Pro sudah aktif.
4. Matikan perpanjangan otomatis di one.google.com bila ada.'
WHERE sku='PV-FULL-3' AND product_id IN (SELECT id FROM products WHERE pixelverif_family='google_ai_pro_3m') AND (admin_activation IS NULL OR admin_activation='' OR admin_activation LIKE '1. Tim melakukan aktivasi langsung%');

UPDATE product_variants SET admin_activation_en='1. Wait for the activation note on the Track Order page or in your email/Telegram (about 3–5 minutes after payment).
2. If the note says Google AI Pro is already active, there are no extra steps.
3. Check on one.google.com that the Google AI Pro plan is active.
4. Turn off auto-renewal on one.google.com if present.'
WHERE sku='PV-FULL-3' AND product_id IN (SELECT id FROM products WHERE pixelverif_family='google_ai_pro_3m') AND (admin_activation_en IS NULL OR admin_activation_en='');
