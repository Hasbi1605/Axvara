# Aturan agent — WhatsApp gateway, grup, siaran

Privasi broadcast grup 21 November 2026 (audit FX-13, lokal): notifikasi LUNAS
order WA historis (`paymentDetectedMessage`, `src/lib/whatsapp/messages.ts`)
kini menyamarkan kode order (`maskOrderCode`, kepala + `••••` + 4 ekor) dan
nominal (`MASKED_TOTAL = "Rp•••••"`) karena grup dibaca seluruh anggota; nada
perayaan + nama produk + ucapan terima kasih dipertahankan, kalimat penutup
netral "Pesanan lunas sedang diproses admin. Pembeli tidak perlu membayar ulang."
(menggantikan "Pesanan kamu…" yang ambigu di grup). Jangan mengembalikan kode
order/nominal persis ke broadcast grup. Teks QRIS kedaluwarsa WA juga diperbaiki
menjadi "QRIS di grup WhatsApp tidak bisa diperpanjang; buat pesanan baru di
website atau Telegram" — order WA memang dikecualikan dari reissue
(`sales_channel !== 'whatsapp'`), jadi ini akurat per-kanal, bukan klaim global.

Auth webhook header-only 21 November 2026 (audit AU-B1-2, lokal): `authenticateWebhook`
(`src/lib/whatsapp/gateway.ts`) HANYA menerima token dari header `x-webhook-token`
(atau `Authorization: Bearer`) yang dikirim gateway kanonis
(`gateway/src/index.ts:201,327`). Fallback query `?token=`/`?secret=` dan body
`secret`/`webhook_secret` dihapus; token query bocor ke access log/proxy/referrer.
Token salah/kosong tetap 401 (`missing_token`/`invalid_token`), compare tetap
constant-time, dan gate fail-closed bila `WHATSAPP_WEBHOOK_TOKEN` kosong. Jangan
menambahkan kembali jalur query/body; pemanggil wajib header.

Promo otomatis Telegram 19 November 2026 (lokal): promo pagi/sore 09.00 dan 17.00 WIB yang selama ini ke grup WA kini juga dikirim ke seluruh pengguna bot Telegram yang eligible (`is_blocked=0`, `broadcast_opt_out=0`, chat pribadi) lewat `broadcast_campaigns`/`broadcast_deliveries` (`src/lib/telegram/promo-broadcast.ts`) menggunakan banner JPEG `public/banners/ready-promo.jpg` (revisi 20 Nov 2026: pratinjau tautan besar di atas teks dalam satu bubble, tanpa `sendPhoto`/caption terpisah; snapshot lama tetap foto + caption) + daftar HTML bold (`promoMessages(slot, products).full`) + footer `/stop` + expiry di 12.00/20.00 WIB. Promo digest admin lama ke `TELEGRAM_ADMIN_CHAT_ID` (`sendDueAdminPromoDigest`, dua bubble salin-tempel) dihapus; `TELEGRAM_PROMO_DIGEST_ENABLED` tidak lagi dibaca. Perilaku promo WA (`promo-digest.ts`, `promo-bot.ts`, `ready-promo.webp`) tidak berubah.

Urutan kategori digest 19 November 2026 (lokal): `loadPromoProducts` (`src/lib/telegram/promo-digest.ts`, dipakai bersama `promo-digest.ts` dan `promo-bot.ts` WA serta digest Telegram) kini mengurutkan kategori lebih dulu sesuai urutan web (`categories.sort_order`, tie-break nama/id, tanpa kategori terakhir), baru `p.sort_order` dan `p.id`, sehingga produk baru/ber-`sort_order` kecil di kategori akhir tidak lagi menggeser kategori tersebut ke baris paling atas.

Revisi17November2026 (keputusan owner; implementasi lokal, publikasi via CI):
tambahkan nomor kedua **Bot Promo**, nomor pribadi owner yang sudah lama digunakan,
untuk maksimal20grup pilihan manual admin (perkiraan8). Gambar dan caption
`promoMessages(slot, products).short` sama dengan bot AXVARA'S; HANYA Bot Promo
menambahkan `\n\n👥 *Join Grup WA:* <url>` (bold WhatsApp + ikon, revisi owner 17 Nov) dari store_settings `whatsapp_group_url`
(fallback `WA_GROUP_HREF`), dibaca saat enqueue. Slot09.00–<12.00 dan17.00–<20.00
WIB, jeda60detik antargrup pada nomor promo. Bot AXVARA'S/welcome tidak berubah.
Konfigurasi JSON `whatsapp_promo_bot` terpisah: enabled/nomor/revisi/grup≤20;
admin wajib memilih grup dan mengaktifkan sesi yang sesuai. Ganti nomor menjeda
dan mengosongkan pilihan grup; simpan grup menjeda sampai diaktifkan kembali.
Jangan memakai nomor yang sama dengan bot notifikasi. Kontrak gateway
`/promo-bot/{status,number,pair,groups,send-promo}` memakai token existing,
identitas nomor+revisi, ledger idempoten `wa:promo2:YYYY-MM-DD:slot:groupId`,
pacing per nomor dan gambar promo existing. Outbox `promo_bot_digest`: cek aktivasi/grup/identitas lagi sebelum kirim; perubahan retry5menit tanpa menghabiskan
attempt, expired/grup tidak diizinkan/hasil ambigu eksplisit dikarantina dead.
Update 17 Nov 2026: aktivasi (`enabled:false→true`) mencatat `enabledAt` ISO (absen tetap valid untuk kompatibilitas mundur; nilai tidak valid gagal-tertutup). Scheduler melewati slot berjalan bila `enabledAt > awal_slot` (09.00/17.00 WIB), dan outbox menandai dead `promo_bot_reenabled_after_enqueue` untuk baris `created_at < enabledAt` agar aktivasi/aktivasi ulang di tengah slot dimulai dari jadwal berikutnya.
Tidak ada env Pages baru. Pairing nomor promo dilakukan owner setelah deploy;
QA hanya fixture, tanpa pairing/reset/pesan atau mutasi produksi.

Revisi13November2026 (keputusan owner; implementasi lokal): alur PEMBELI lewat
WhatsApp dipensiunkan — pencarian/discovery produk, pemesanan+pembayaran, dan
intake bukti manual dihapus dari kode (bukan env flag). `handlers/catalog.ts`,
`handlers/payment.ts`, `handlers/proof.ts`, `whatsapp/session.ts`, flag
`WHATSAPP_GROUP_DISCOVERY/PAYMENT/PROOF_INTAKE` dan `preflightWhatsAppPayment`
tidak ada lagi; jangan menghidupkannya kembali tanpa keputusan owner baru.
Webhook grup menjawab SATU arahan ke website/Telegram untuk pesan yang dulu
memicu alur itu (list/cari/angka/pay/metode manual/media bukti), tidak menyapa
percakapan biasa. Yang TETAP hidup: perintah admin `.d`, info `garansi`,
katalog digest/broadcast/welcome lewat outbox, event grup, dan notifikasi LUNAS
untuk order historis. `/api/admin/bot/health` melaporkan
`whatsapp_discovery/payment/proof_intake=false` + `whatsapp_buyer_flows:"retired"`.
Data order WhatsApp historis tidak diubah/dibersihkan.

Notifikasi LUNAS order WA historis tetap berbagi klaim Telegram dengan order
Telegram (FX-3b, lokal): cron hanya mengambil alih status `sending` setelah
`access_retry_at` kedaluwarsa, bukan berdasarkan umur `updated_at`. Cooldown
20 menit untuk timeout tercatat tidak berubah; tidak ada perubahan transport WA.

Revisi11November2026 (implementasi lokal, deployment belum diverifikasi): hentikan
notifikasi pembelian berhasil ke grup, termasuk pending/failed lama. Jangan
mengaktifkan kembali scanner transaksi. Penggantinya katalog ready09.00/17.00 WIB,
satu gambar owner+caption utuh, garis52tanda `-`, sumber katalog/harga sama dengan
Telegram. Saklar/nomor/revisi/grup existing tetap, retry hanya sampai12.00/20.00
WIB; jangan replay katalog basi/hasil ambigu. Endpoint `/send-promo` memakai
ledger/pacing/izin existing, `/send-notification` lama410. Tidak ada pairing,
reset sesi, pesan atau mutasi produksi saat QA. Detail ARCHITECTURE16.12.

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

Notifikasi grup24Oktober: pencarian AXVARA'S menyetarakan NFKC/trim/kapitalisasi
dan apostrof ’/‘/ʼ → ', tanpa substring. Nama setara ganda ditolak; ID pin PG
tidak berpindah otomatis. Gateway status memberi `groupName` kanonis untuk
validasi aktivasi Pages dan `groupSubject` asli hanya setelah grup/izin lolos.
Bot tersambung tidak perlu pairing ulang untuk perbaikan nama.

Ganti nomor bot24Oktober: nomor awal6283181632507 hanya bootstrap. Pilihan aktif,
revisi dan pin grup disimpan singleton PG axvara_wa_runtime. Admin menjeda D1 lalu
gateway mengganti sesi manual lewat mutex/CAS; prefix auth tiap nomor terisolasi,
sent/unknown/cooldown tetap, tanpa rotasi otomatis. Aktivasi/pair/send diikat
nomor+revisi; tab basi termasuk A→B→A ditolak. Tidak perlu env baru. Rollback setelah
pergantian harus ke rilis kompatibel runtime/revisi; jangan rollback ke kode nomor
tetap. Rincian di gateway/AGENTS.md dan ARCHITECTURE §16.12.

Siaran+welcome24Oktober: menu Konten → Siaran memakai template reusable (maks200,
migrasi0077) + snapshot kampanye atomik; tujuan grup WA terverifikasi/subscriber
email active/user Telegram pribadi non-blokir/non-opt-out. Worker cron lite existing
maks8/tick, hasil ambigu unknown tanpa kirim ulang; opt-out email token acak dan
Telegram /stop. Sambutan hanya dari event group add via /api/whatsapp/group-events
→ inbox PG, lalu outbox group_welcome dedupe SHA256 menurut hari event UTC;
tidak bergantung callback status, dan tak dikirim setelah 30 menit atau jika
grup/identitas tidak cocok saat admission. Chat biasa tidak lagi menyapa/mencari
produk. Gateway /send-broadcast//send-welcome namespace key terpisah. Rincian di
gateway/AGENTS.md, ARCHITECTURE §16.13, issue/broadcasts-welcome-2026-10-24.md.
