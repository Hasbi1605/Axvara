# Notifikasi penjualan WhatsApp dan pengaturan grup — 24 Oktober 2026

Implementasi selesai di source; publikasi lewat push main/CI. **Pengiriman belum
diaktifkan**: pemeriksaan gateway lama menemukan connected=false/code401. Pairing
nomor baru dan aktivasi merupakan langkah owner setelah rilis, bukan bukti bot
telah tersambung. Tidak ada pesan WhatsApp atau order supplier nyata saat QA.

## Keputusan dan isi pesan

Tetap Baileys pada app Heroku existing, tanpa layanan berbayar/resource baru.
Hanya order lunas/paid dengan SEMUA unit apps delivered atau semua item Pedia
completed. Pembayaran berhasil sendiri belum cukup. Template publik:

```text
🎉 PESANAN BERHASIL DIPROSES - WEB
━━━━━━━━━━━━━━━━━━━━

📦 Gemini Pro
↳ Varian: 1 Bulan
↳ Jumlah: 1 item
↳ Harga: Rp 20.000

Rincian Transaksi
🧾 Referensi: TRX-<acak>
👤 Pembeli: R***
💰 Harga produk: Rp 20.000
💳 Total bayar: Rp 20.123
💠 Pembayaran: QRIS

✅ Status: SELESAI
🗓 24 Oktober 2026 pukul 07.37 WIB

Terima kasih telah berbelanja di AXVARA 🤍
🌐 axvara.tech
```

Judul mengikuti WEB/TELEGRAM/WHATSAPP dari order. Beberapa item ditampilkan
berurutan; harga adalah harga per item dan total bayar dari ledger paid terbaru.
Referensi publik acak independen dari invoice. Whitelist hanya nama/varian katalog,
qty/harga/nominal/metode/waktu selesai. Nama satu huruf +***; email, nomor WA,
username/ID Telegram, target Pedia, invoice asli, supplier, akun/password/PIN/token
dan URL akses pembeli **tidak dikirim**. Email/nomor/URL dalam copy katalog juga
disamarkan. Payload immutable disimpan sekali agar retry tetap identik.

## Kontrak dan keandalan

- Source kanonis `gateway/` masuk repo AXVARA, bukan folder saudara berisi session
  lokal. CI menguji/build Node22 dan mengunggah arsip allowlist source melalui
  Heroku API setelah migrasi D1, sebelum Pages/MCP. Secret GitHub
  `HEROKU_API_KEY_AKUN1` dari `.heroku-credentials`; Pages memakai tiga secret_text
  existing WHATSAPP_GATEWAY_URL/WHATSAPP_WEBHOOK_TOKEN/WHATSAPP_BOT_NUMBER.
  Tidak ada env Pages baru. Rilis gateway dilewati hanya dengan bukti build sukses,
  slug release aktif cocok, ancestor Git dan source/script tidak berubah; API gagal
  menghentikan CI. Push bukan bukti deploy berhasil; agent berhenti sesudah push.
- Migrasi0076 menambah expression index paid_at untuk scanner. `notify_b` existing
  mengantrekan maksimal4/tick, budget D1 tetap; tanpa cron/polling baru. Apps memeriksa
  manifest semua unit unik; Pedia tidak menganggap partial/canceled selesai.
- `store_settings.whatsapp_sales_notifications` internal: enabled/enabledAt/groupId,
  tidak dibuka oleh settings publik. Aktivasi hanya gateway connected, nomor cocok,
  grup tepat dan tidak blocked. Cutoff berdasarkan paid_at: tidak backfill order
  yang dibayar sebelum aktivasi. Klik aktif berulang mempertahankan cutoff;
  nonaktif→aktif memulai cutoff baru untuk order belum diantrekan. Pesan yang sudah
  diantrekan tetap tersimpan saat nonaktif/offline dan dilanjutkan dengan pacing.
- D1 CAS/lease/outbox key `wa:sale-completed:<code>`; Postgres gateway mematok
  fingerprint key+target+payload sebelum send. Lock session eksklusif, auth prefix
  nomor baru, satu reconnect timer dan flush credentials. Tidak ada session lokal
  yang dikirim ke Heroku. Kegagalan PG menghentikan send.
- Batas satu percobaan baru/60detik bersifat operasional, bukan angka aman resmi.
  Offline/paced/cooldown tidak menghabiskan attempt D1. HTTP timeout boleh meminta
  ulang key sama untuk membaca hasil durable; gateway tidak send ulang key ambigu.
  Interrupted sending menjadi unknown saat restart; D1 explicit unknown menjadi
  dead/manual_check_required. ACK dicatat terpisah; sent bukan bukti semua anggota
  grup sudah menerima/membaca. Retry Baileys getMessage memuat payload tersimpan.
- `/notification-status` GET, `/notification-pair` POST, `/send-notification` POST
  hanya token gateway timing-safe. Tujuan grup dipin setelah nama tepat unik,
  metadata5menit + invalidasi event. Nama sama ganda/berubah ditolak. Mengubah link
  undangan storefront **tidak memindahkan grup tujuan bot**. Legacy `/send` dan
  `/send-image` hanya grup existing/pin, DM tidak dibuka. Flag commerce lama tidak
  diubah dan bukan gate notifikasi penjualan baru.
- Auth401/403/conflict440/bad-session500 menghentikan reconnect otomatis;
  515 restart normal; transport sementara backoff maksimal~62detik. Send ambigu
  menjeda15menit, sinyal pembatasan menjeda24jam dan menutup socket; tidak ada trik
  bypass atau jaminan anti-ban. Owner memeriksa WA dan state sebelum recovery.

## Admin Telegram dan storefront

Notifikasi pembayaran Web/Telegram/WhatsApp menampilkan status pembayaran,
status pesanan dan tanggal/jam paid_at WIB; order-created memakai created_at WIB.
Timestamp kosong tidak dibuat-buat.
Klasifikasi supplier mendahulukan snapshot `order_item_costs.source`, lalu mapping
dan status link. `manual_required` placeholder supplier berarti proses otomatis,
bukan kewajiban kirim admin; kegagalan otomatis berarti perlu pemeriksaan.
Fulfillment benar-benar manual tetap diberi instruksi manual. Semua unit delivered
berarti selesai, termasuk supplier WR.

Tombol Telegram **Lihat pesanan pembeli** membuka
`/lacak-pesanan?code=<invoice>&admin=1`. POST lookup/credentials memvalidasi sesi
admin server-side sebelum baca data. URL tanpa kontak/token pembeli. UI admin tidak
membaca/menulis riwayat kontak atau capability buyer; sesi ditolak menghapus detail
dari layar. Akses publik tetap memakai verifikasi kontak/capability existing.

Pengaturan Toko mempunyai satu `whatsappGroupUrl` → DB `whatsapp_group_url`.
Hanya undangan HTTPS host persis chat.whatsapp.com + kode20–32alnum dan optional
`?mode=gi_t`. Save admin memperbarui Footer (Market/Pedia) dan Link Bio via hook
bersama. Cache30detik, refetch focus/visibility/storage; tidak ada polling server.
Settings API no-store; tab terbuka lain refresh lewat event storage. Fallback lama
dipakai sampai admin menyimpan link baru.

## Aktivasi dan rollback

1. Sesudah rilis, Admin → Pengaturan Toko → Hubungkan nomor bot. Pada WhatsApp
   **6283181632507**, Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor
   telepon. Masukkan kode dari panel, jangan dibagikan.
2. Masukkan bot ke satu grup **AXVARA'S**; jika hanya admin boleh mengirim,
   promosikan bot menjadi admin. Cek koneksi sampai nomor/grup benar.
3. Aktifkan notifikasi. Order yang dibayar sejak aktivasi baru diumumkan setelah
   seluruh item selesai. Periksa pesan transaksi riil berikutnya; QA belum mengirim
   pesan produksi. Link undangan publik diisi satu kali pada field terpisah.
4. Untuk jeda gunakan Nonaktifkan notifikasi. Periksa dead/unknown pada D1 serta
   axvara_wa_delivery PG dan pesan grup sebelum recovery; jangan reset key atau
   requeue ambigu membabi buta. Revisi kode/rollback melalui CI, pertahankan PG,
   prefix auth dan key outbox; jangan rollback ke kode DM lama demi recovery.

## Referensi dan batas bukti

- [Baileys upstream README](https://github.com/WhiskeySockets/Baileys/blob/master/README.md):
  auth produksi di DB, cachedGroupMetadata dan getMessage. Ini rekomendasi
  keandalan library, bukan bukti anti-ban.
- [WhatsApp responsible use](https://faq.whatsapp.com/361005896189245/?eea=0&locale=en_US)
  dan [Messaging Guidelines](https://www.whatsapp.com/legal/messaging-guidelines):
  otomatisasi/klien tidak resmi tetap berisiko pembatasan. Screenshot KlikQRIS,
  Viola, WR tidak membuktikan library/volume/riwayat enforcement mereka.
- [Heroku build/release API](https://devcenter.heroku.com/articles/build-and-release-using-the-api):
  source tarball build sukses menghasilkan release app; tidak perlu git remote.

Verifikasi final dan jumlah test dicatat di CHANGELOG. QA memakai fixture inert
komponen aktual melalui Obscura: link Footer+Link Bio berganti dari satu input,
admin detail tanpa kontak/capability buyer, sesi401 ditolak, viewport1440/390 tanpa
overflow/JS exception. Renderer Obscura tidak menggambar semua nilai input pada
PNG; nilai input, hasil PUT dan href diperiksa lewat DOM/evaluasi. Ini bukan bukti
pairing/performa pengiriman live atau bot bebas ban.
