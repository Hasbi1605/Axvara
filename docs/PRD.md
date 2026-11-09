# PRD — AXVARA

## Keputusan owner 9 November 2026: batas pembayaran supplier/manual
- Revisi order Market baru web/Telegram: supplier WR/SK VA/e-wallet (`sekalipay_gateway:*`) 30 menit, crypto/QRIS 60 menit; manual dan keranjang campuran tetap 15 menit untuk semua metode. Yang menentukan supplier adalah metadata produk WR/SK, bukan mode pengiriman manual pada varian supplier. Telegram tetap hanya menawarkan QRIS + crypto; WhatsApp tetap mengikuti kontrak existing.
- Jendela order bukan perpanjangan invoice: gateway tetap minimum deadline order/provider; crypto minimum deadline order/`valid_until` provider. Pada floating-rate NOWPayments, `expiration_estimate_date`/`expirationEstimateDate` adalah masa estimasi kurs, bukan expiry pembayaran: estimasi lewat tetap diterima bila timestamp valid. QRIS tetap 15 menit dengan maksimal satu renewal existing selama order belum expired. Order manual tidak dapat diperpanjang melewati 15 menit.
- Pedia baru mulai 30 menit untuk gateway, 60 menit untuk crypto/QRIS, lalu dipendekkan ke deadline transaksi/provider, termasuk QRIS 15 menit. Snapshot 15 menit di bagian lama diganti hanya untuk order baru. Deadline order/invoice lama tidak dimigrasikan atau diperpanjang; retry/reconcile dan validasi legacy fixed-rate tetap. Pembayaran telat tetap pemeriksaan manual tanpa dispatch otomatis.
- Status: implementasi lokal dan tes; belum ada bukti deployment perubahan TTL. Pemulihan order produksi `AXV-20261109-EFF4DEA2` atas konfirmasi dana dan izin owner sudah diterima WR dengan referensi `RBHN-20261109-9B8954` (processing, bukan selesai).

## Keputusan owner 9 November 2026: AXVARA Games (implementasi bertahap, belum ada bukti deployment)

- B2 API pembayaran selesai lokal: quote tidak meminta kontak dan mengembalikan `paymentMethods` seperti Pedia; kontak `whatsapp`/`email` + metode dipilih saat create order. QRIS15/gateway30/crypto60 menit dipendekkan ke deadline provider, tanpa perpanjangan retry. Katalog, kurasi gateway, biaya/minimum crypto, invoice, consent dan payment view memakai mesin bersama; metode wajib autentik. Definitif cancel+expire item tanpa restock Market, ambigu klaim dipertahankan tanpa POST ulang; callback/IPN paid menjadwalkan Games sekali, late/underpaid/mismatch manual review tanpa dispatch. Guard pembayaran AXG ditambahkan aditif, route Market tetap AXV-only. Ini menggantikan status non-QRIS belum termasuk pada snapshot B1 di bawah; UI/nickname/env/deployment tetap paket lain. Kontrak `docs/GAMES.md` §12.8; 67 file/1016 tes fokus lokal hijau, bukan bukti live.

- AXVARA Games menjadi lini dalam ekosistem AXVARA, pola seperti Pedia: route internal
  `/games`, URL kanonis final `https://games.axvara.tech` (bukan toko/infrastruktur terpisah).
- S1 lokal menambah host rewrite/308 tanpa enable flag, sitemap/robots Games, cek nickname
  berbayar (`POST /api/games/nickname`, cache24jam sukses/1jam ID invalid, IP10/perangkat5
  per15menit/global500 perhari UTC, batas modal Rp80/cek), log/ringkasan admin dan migrasi0109.
  Testing/kredensial kosong/error/limit/pending ambigu => unavailable tanpa nama palsu;
  pending satu recheck ref sama, ambigu tidak dibeli ulang. SKU Cek Username tidak dapat
  dijual/diaktifkan ke pembeli; nickname klien hanya display. Kontrak lengkap GAMES §5.2,
  ARCHITECTURE §16.29. Custom domain Pages, metadata UI, QA browser dan deployment belum dibuktikan.
- Supplier: Digiflazz buyer (seller utama Om*** + pengisi celah; kode buyer `<game>[id]<nominal>`; lihat `docs/agent-rules/digiflazz.md`).
- Pembayaran memakai rail yang sudah ada di Market/Pedia: QRIS, Virtual Account, e-wallet (gateway Sekalipay) dan crypto (NOWPayments).
- Harga jual dibandingkan dengan Oura Store (ourastore.com). Snapshot 9 November 2026: ruang di atas modal Digiflazz median FF/FF MAX ~24% (15–39%), ML ~5,4%, PUBG ~6%, Valorant ~5,5%, CODM ~8%, Genshin <1%; WDP/Twilight Pass Indonesia modal kita di atas harga Oura. Rumus disetujui owner 9 November 2026: harga jual = harga Oura −2%, dengan batas bawah modal Digiflazz + biaya kanal pembayaran + margin minimum 3%; bila harga Oura −2% di bawah batas bawah, jual di batas bawah (atau sembunyikan SKU bila tidak kompetitif). SKU tanpa pembanding Oura memakai modal + biaya kanal + margin minimum 3% sampai ada aturan lain.
- Spesifikasi produk & desain: `docs/GAMES.md`. Keputusan owner 9 November 2026: hero hybrid orbit + carousel promo; gelombang 1 FF, FF MAX, ML, PUBG; cek nickname sebelum bayar aktif; gagal setelah bayar otomatis dicoba ke seller cadangan (kode buyer akhiran `b`, hanya setelah Gagal final) lalu admin; kode promo menyusul; aset awal disiapkan agent dari sumber resmi publisher.
- Snapshot B1 9 November 2026 (status nickname/rail diperbarui B2+S1 di atas): backend inti + admin data selesai lokal/CI — proxy `/dgf` terpasang di VPS, sinkron katalog/harga, schema (0107/0108), dispatch + seller cadangan otomatis, webhook, dan tab admin Games (`games_reference_prices` sebagai sumber kebenaran harga Oura, override grup nominal, aktivasi gelombang 1 yang sehat dengan dry-run). API pembeli B1 katalog/quote/order/status/lacak QRIS diimplementasikan lokal (kontrak `docs/GAMES.md` §12.8): prefix `AXG`, quantity 1, `max_price=min(harga jual,ceil(modal*1.05))`, deadline QRIS 15 menit, kontak penuh, tanpa stok Market. P9 menutup ordering (503 `games_preview`) saat testing true atau username/key kosong; katalog tetap terbaca. Belum ada bukti deployment B1, UI storefront, nickname publik, rail Games non-QRIS, env Pages Digiflazz, deposit, mode Production, transaksi nyata, atau harga Oura terisi di produksi.

## Keputusan owner 8 November 2026: editor harga grosir di modal produk, hanya produk manual (lokal, belum deploy)
- Harga grosir (tier per varian) kini bisa diatur dari editor produk yang benar-benar dipakai admin: `ProductEditorModal` → `sections/ProductVariantRows` (multi varian) dan `sections/SingleVariantFields` (satu varian). Sebelumnya `BulkTierEditor` hanya terpasang di `VariantEditor` yang tidak diimpor halaman mana pun sejak September 2026, sehingga tidak ada jalan mengatur grosir dari UI.
- **Batasan owner:** grosir HANYA untuk produk manual. Produk supplier WR (Akun Premium/Jaspay) dan Sekalipay-SK tidak menampilkan editor (hanya catatan "Harga grosir hanya untuk produk manual."); API menolak permintaan mengaktifkan grosir pada produk supplier dengan 400 `bulk_pricing_supplier_forbidden`, sedangkan menonaktifkan (`enabled=false`) tetap diterima agar data lama bisa dibersihkan. Data tier yang mungkin sudah tersimpan pada varian supplier diabaikan oleh katalog, quote, order, dan Telegram (harga dasar yang berlaku), tanpa menghapus data dari database.
- Draft hanya dikirim sebagai `bulk_pricing` saat admin mengubahnya; varian lain dipertahankan server. Isian tidak valid memblokir simpan, membuka baris varian terkait, dan memfokuskan field pertama yang salah. Produk baru (`POST /api/products` tidak menerima bulk) menampilkan catatan "Simpan produk dulu" dan editor baru aktif setelah produk tersimpan.
- Tampilan pembeli (PDP/kartu/keranjang/checkout) dan aturan tier tidak berubah: tier tertinggi yang tercapai berlaku untuk seluruh unit di baris, agregasi tetap per varian, dan harga otoritatif tetap quote server.
- Status: implementasi LOKAL; belum dipublikasikan/deploy. Bukti: tes fixture + behavior (editor manual, tersembunyi WR/SK, payload hanya saat disentuh, guard 400, harga dasar untuk varian supplier) dan pemeriksaan Chromium lead di dev lokal (mode memori, login admin dev): produk manual ChatGPT Plus → Edit Produk → tab Varian menampilkan editor "Harga grosir"; mengaktifkannya lalu menambah tier 5 pcs @ Rp80.000 menampilkan "5+ pcs · hemat 10%", dan **Simpan Produk** mengirim `PUT /api/products/1` dengan `"bulk_pricing":{"enabled":true,"tiers":[{"min_qty":5,"unit_price":80000}]}` → 200 `{"ok":true}`. Batas bukti: mode memori lokal tidak mempersist baris varian (persistensi dibuktikan tes integrasi fixture D1), dan hides WR/SK belum diuji di browser karena tidak ada produk supplier di lokal (tercakup tes behavior).

## Keputusan owner 7 November 2026: nama produk, S&K admin, dan email pembeli EN — fase 3 (lokal, belum deploy)
- `products.name_en` (migrasi 0105) adalah nama EN milik admin; bila kosong tampilan EN memakai terjemahan token durasi/tier dari nama tersimpan. Seed 0106 hanya mengisi nama yang butuh padanan non-token (7 baris). Nama tersimpan, snapshot order, dan identitas email tidak berubah.
- `product_variants.admin_terms_en`/`admin_activation_en` (0105) diisi lewat endpoint variant-copy yang sama; EN hanya berlaku selama salinan admin ID masih valid terhadap fingerprint WR, lalu fallback ke kurasi EN atau teks WR. Seed 0106 menerjemahkan 9 varian admin yang ada.
- Perbaikan propagasi 7 November 2026: `mapVariant` katalog meneruskan `admin_terms_en`/`admin_activation_en` ke resolver, jadi `copy_en` publik pada `/api/catalog` benar-benar berisi S&K/aktivasi EN admin yang tersimpan (sebelumnya kolom ter-SELECT tetapi terbuang). `copy` tetap ID, fallback NULL/otomatis dan proteksi fingerprint tidak berubah. Ini perbaikan jalur data, bukan jaminan seluruh konten supplier sudah diterjemahkan.
- Email pembeli Market (konfirmasi/lunas/pending, kredensial, handover, gagal kirim, QRIS kedaluwarsa, akses PIN) mengikuti `order.locale`: subject, isi, dan tombol EN; default ID. Admin-facing email tetap ID.

## Keputusan owner 7 November 2026: metadata, halaman "segera hadir", dan email Pedia ID/EN (lokal, belum deploy)
- Semua route Pedia menyajikan title/description/OpenGraph sesuai cookie bahasa (`axv_locale`), tanpa mengubah canonical/robots yang sudah ada. Pindah bahasa hanya mengubah tampilan; pesanan, quote, dan tautan tidak berubah.
- Halaman "segera hadir" saat Pedia belum dibuka tampil dalam Indonesia atau Inggris.
- Email transaksional pembeli (pembayaran diterima, diproses, selesai, dan pesan penyelesaian manual) mengikuti bahasa yang dipakai pembeli saat memesan, termasuk subjek, isi, label ringkasan, tombol, dan nama layanan versi Inggris. Angka, batas jumlah, dan ketentuan refill tidak berubah. Notifikasi internal admin tetap Indonesia.
- Bahasa pembeli disimpan pada pesanan saat dibuat menggunakan kolom yang sudah ada; tidak ada kolom baru. Pengiriman ulang/percobaan ulang email tetap sama.

## Keputusan owner 7 November 2026: konten EN Market — fase 2 (lokal, belum deploy)
- Deskripsi produk punya kolom admin `description_en` (migrasi 0103) dengan editor di tab "Deskripsi & S&K" untuk semua produk; EN dipakai bila terisi, fallback ID (override ?? WR). Seed 0104 menerjemahkan 71 produk produksi yang punya teks (Testing Only dilewati) secara idempoten dan tidak menimpa suntingan admin.
- S&K + cara aktivasi kurasi punya versi Inggris untuk 95 entri dengan fingerprint lock yang sama; perubahan teks WR membuat versi Inggris (dan ID) fallback ke teks WR terbaru. Konten S&K per-varian yang disunting admin tetap ID.
- Badge admin dan label varian diterjemahkan saat render (nilai tersimpan tidak berubah, cart/SKU tetap memakai label asli); kategori `bundle-hemat` menjadi "Value Bundles".
- Email pembeli tetap ID (di luar fase ini).

## Keputusan owner 7 November 2026: rail pembayaran Pedia (fase B, lokal, belum deploy)
- Checkout Pedia web menawarkan QRIS (bawaan), Sekalipay gateway VA/e-wallet (kurasi sama dengan Market: `SHOPEEPAY` biasa + `DANA_REALTIME` berlabel "DANA"; `SHOPEEPAY_REALTIME` tidak ditawarkan), dan crypto NOWPayments (USD; biaya layanan mengikuti konstanta crypto existing; minimum per koin ×1,15). Pilihan metode berasal dari quote bertanda tangan; metode tidak sah → pembeli diminta memuat ulang.
- Alur pembeli: pilih layanan → tempel target → isi kontak → (opsional) buka "Pilih metode lain" untuk VA/e-wallet/crypto → lanjut ke pembayaran. QRIS tetap terpilih secara bawaan dan langkah qty/target/kontak tidak berubah.
- Halaman pesanan menampilkan panel pembayaran yang sama dengan Market (VA/tautan, alamat+nominal crypto dengan pembulatan tampilan, tombol cek pembayaran, persetujuan biaya gateway satu klik yang langsung mengarahkan ke provider). Status otomatis diperbarui lewat polling/rekonsiliasi yang sudah ada.
- Batas waktu order = `min(15 menit, deadline provider)`. Pembayaran telat/underpaid crypto masuk pemeriksaan manual dan tidak memicu dispatch; pembayaran gateway yang telat juga mengikuti aturan Market. Kredit Pedia tetap tidak tersedia.
- Setelah lunas, dispatch Pedia berjalan seperti QRIS (order `lunas`), diverifikasi untuk gateway dan crypto. Telegram/WhatsApp tidak berubah.

## Keputusan owner 7 November 2026: cakupan bahasa EN penuh Market — fase 1 (lokal, belum deploy)
- Menggantikan aturan lama bahwa konten/kategori Market tidak pernah EN. Saat English dipilih (`axv_locale`) atau pesanan tersimpan ber-locale EN (`order.locale`), seluruh permukaan pembeli Market berbahasa Inggris: chrome navbar/footer/kartu/PDP/keranjang, nama kategori (map slug produksi; unknown → nama DB), halaman pesanan/lacak, panel QRIS/gateway/crypto, form akses/PIN, kredensial akun, reminder/device orders, bantuan, garansi, hero/community/banner.
- Halaman statis `cara-order`, `garansi-replace`, `artikel`, serta menu lintas-layanan (`ServicesMenu`/`CrossServicePromo`, termasuk navbar/kartu Pedia yang memakai cookie) ikut EN.
- Salinan ID tidak berubah. Nama/deskripsi produk, S&K/aktivasi (fase 2), email pembeli, admin, dan Pedia berada di luar fase ini; halaman pesanan Pedia tetap ditangani agen Pedia.
- Tidak ada perubahan route/API/schema/env; hanya modul salinan dan komponen tampilan.

## Keputusan owner 7 November 2026: Pedia ikut bahasa + mata uang tampilan (fase A, lokal, belum deploy)
- Switcher bahasa/mata uang Pedia memakai kontrol Market yang sama (`PreferenceControls`, cookie `axv_locale`/`axv_currency`), tersedia di header desktop dan toolbar mobile. Memilih bahasa/mata uang hanya mengubah tampilan; quote, pesanan, dan rel pembayaran tidak tersentuh.
- Seluruh teks pembeli Pedia tersedia ID/EN: beranda, katalog/platform, halaman order (langkah, validasi, checklist, syarat), status pesanan, lacak, refill, bantuan, ketentuan, dan pesan galat API Pedia. Default tetap Indonesia; tanpa cookie = Indonesia.
- Nama/deskripsi/syarat layanan dari katalog tersimpan tetap sumbernya (Indonesia) dan diterjemahkan saat render; snapshot pesanan lama ikut EN tanpa migrasi. Istilah SMM (No Drop/Less Drop/High Drop/Refill N Days/Start time/Speed/Avg time/Success rate) tidak diterjemahkan ke istilah Indonesia. Angka, batas min/max, masa refill, dan kebijakan tidak berubah.
- Harga Pedia tampil dalam USD saat pembeli memilih USD, memakai jalur FX tampilan Market (`POST /api/display-prices`, satu snapshot server). Tanpa FX valid, harga kembali ke Rupiah. Nominal yang ditagih tetap IDR/QRIS; USD bukan otoritas quote/charge.
- Fase B (rail pembayaran non-QRIS untuk Pedia: Sekalipay gateway VA/e-wallet + crypto NOWPayments) BELUM dikerjakan dan menunggu persetujuan lead atas laporan fase A.

## Keputusan owner 7 November 2026: Telegram hanya QRIS + Crypto; metode ulang setelah gagal (lokal, belum deploy)
- Penawaran BARU di bot Telegram hanya QRIS + Crypto. Sekalipay gateway (VA/e-wallet) tetap tersedia penuh di web, tetapi tidak pernah masuk katalog/payq1/keyboard Telegram meski `SEKALIPAY_GATEWAY_ENABLED=true`; create Telegram juga menolak ID gateway (fail closed, notis generik). Tidak ada flag/env baru.
- Invoice/order Telegram lama pada `sekalipay_gateway` tetap dibaca, consent (`gconsent:`), refresh, dan direkonsiliasi dengan binding tersimpan; tanpa migrasi atau mutasi.
- Setelah kegagalan create crypto yang **DEFINITIF** (klasifikasi sama dengan web/Pedia: tidak ada TX klaim `initializing|pending` dan pesan bukan `nowpayments_network_ambiguous`/`nowpayments_finalize_failed_manual_review`), bot membatalkan order (stok kembali sekali), menandai TX terminal, melepas anchor, menampilkan copy gangguan, dan menyertakan tombol "Metode pembayaran lain" (`pmentry`) yang membuka quote/nonce BARU tanpa auto-create; dari offer baru pembeli bisa memilih QRIS (dialihkan ke alur QRIS legacy) atau koin lain. Kegagalan **AMBIGU** (timeout/unreadable/proses provider mungkin sudah membuat invoice) tetap terikat pada order yang sama: tanpa cancel, tanpa POST ulang, tanpa order kedua; pmentry sengaja `namespace_busy` dan status/refresh order tetap bekerja.
- Batas (revisi 8 November 2026): kasus definif yang membuat order lalu gagal sebelum klaim TX kini dibatalkan + anchor dilepas (tidak lagi buntu); kasus ambigua tetap sengaja tidak bisa dilepas sampai order kedaluwarsa/diterminalkan, demi menghindari invoice/order kedua. Resume eksplisit (`pgo:`) tetap melepas anchor seperti perilaku lama.

## Keputusan owner 7 November 2026: nominal crypto tampil dibulatkan ke atas (lokal, belum deploy)
- Angka koin yang DILIHAT/DISALIN pembeli memakai presisi TERPENDEK (mulai 2 desimal, dibatasi presisi nominal asli) yang kelebihan AKTUAL hasil pembulatan ke atas ≤ US$0,01 menurut rasio USD/koin tersimpan pada invoice — bukan heuristik per langkah, kurs live, atau jaminan settlement provider. Contoh: 2.24671004 + US$2.25 → 2.25; 0.000468 + US$1.05 → 0.00047; 1.009 + US$10.09 → 1.01 (tepat 1 sen); 0.000503 + US$1.13 tetap 0.000503 (pembulatan ke 0.00051 > 1 sen). Tanpa teks penjelasan tambahan; label "Kirim tepat" tetap.
- Berlaku di panel pesanan web (tampilan dan nilai Salin), hasil lacak, dan instruksi pembayaran Telegram. Nominal tersimpan, yang dikirim ke NOWPayments, serta cek paid/underpaid TIDAK berubah; overpay tetap diterima dengan review existing.

## Persetujuan gateway satu klik & hierarki panel pending — 7 November 2026 (lokal, belum deploy)
- Persetujuan total final tetap wajib (form biaya + kontak checkout), tetapi satu klik: setelah `POST /api/orders/:code/payment-consent` mengembalikan 200 dengan `payment.state=pending` dan tautan https (`payment_link` kanonik atau `checkout_url`), klien menyimpan kontak lalu langsung mengalihkan tab yang sama ke tautan provider. Tanpa tautan (mis. VA saja) halaman hanya membaca ulang status; 409 tetap membaca ulang dan menampilkan total baru tanpa persetujuan otomatis. Kontak tidak pernah masuk URL, tombol tetap sibuk selama navigasi, dan tidak ada popup/new-tab kedua.
- Copy tombol persetujuan: ID "Setujui <total> & bayar", EN "Approve <total> & pay"; tautan utama gateway "Bayar via <label>" / "Pay with <label>". Status pending gateway/crypto memakai header ringkas yang sama dengan QRIS (tepat satu h1, ikon jam berputar, container 760px) dan panel detail mengikuti hierarki QRIS; state consent/initializing/confirming/preparing tetap memakai header penuh. Resume surfaces (lacak/pengingat/perangkat) tidak berubah dan tetap menautkan ke halaman pesanan yang sama.
- Bukti lokal: fokus 50 tes + full 361 file/4824 tes lulus, tsc/lint lulus; perubahan visual belum diverifikasi di browser nyata, dan ini bukan deployment atau transaksi.

## Keputusan owner 7 November 2026: ShopeePay kanal biasa, DANA Realtime disembunyikan, copy gangguan (lokal, belum deploy) [bagian DANA_REALTIME DIGANTI sore 7 Nov 2026: DANA ditampilkan lagi]
- Penawaran baru memakai kanal Sekalipay `SHOPEEPAY` biasa (label pembeli "ShopeePay"). Snapshot pagi 7 November: `SHOPEEPAY_REALTIME` dan `DANA_REALTIME` tidak pernah ditawarkan (regex ID eksak, bukan substring), tanpa fallback dua arah. **Sore 7 November owner memutuskan DANA ditampilkan lagi** (lihat butir di bawah); `SHOPEEPAY_REALTIME` tetap tidak pernah ditawarkan. Bukti produksi read-only: POST create `DANA_REALTIME` konsisten HTTP500 (order `AXV-20261107-0F943ABA`, `AXV-20261107-49A6C50F`), GET by ref 404; kanal lain 201.
- Keputusan sore 7 November: `DANA_REALTIME` kembali ditawarkan dengan label "DANA" di **Market web dan Pedia** meski create-nya bisa HTTP500. Owner menerima pembeli menabrak error asalkan melihat "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain." dan bisa pindah metode: klien checkout (Market maupun Pedia) membuang quote lama, mengambil quote baru, lalu submit metode lain memakai token baru. Telegram tidak terpengaruh — `freezePayq1` memakai `buildMethodOptions(..., { includeGateway:false })`, jadi gateway/DANA tidak pernah ditawarkan di bot.
- Pedia (diperbaiki 7 November 2026): kegagalan gateway yang **terbukti definitif** — provider menolak dengan respons terbaca (`sekalipay_gateway_create_rejected`) DAN GET read-only membuktikan invoice tidak ada (404) — membatalkan order + meng-expire item seketika, jadi quote baru pada target yang sama bisa membuat order baru. Kasus ambigu (timeout/jaringan, 502/504, respons proxy tak terbaca, `DUPLICATE_REF_ID`, GET rate-limited/error/bukan-404) TIDAK dibatalkan: klaim tetap, order menunggu/kedaluwarsa seperti sebelumnya dan quote baru masih ditolak `409 duplicate_active_order`. Reuse `quote_id` bukan penyebab; quote baru selalu `pedia:<jti>` baru. Tidak ada POST ulang ke provider.
- Invoice lama pada kanal realtime tetap dibaca/consent/retry/reconcile/callback dengan binding tersimpan (tanpa migrasi). Urutan E-Wallet tetap ShopeePay→DANA→GoPay→OVO karena picker memakai label tampilan; sejak sore 7 November `DANA_REALTIME` (label "DANA") ikut di posisi kedua, `SHOPEEPAY_REALTIME` tetap tidak ikut.
- Copy gangguan baru saat invoice gateway/crypto gagal dibuat, ambigu, atau `initializing` di checkout: ID "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain." / EN "This payment method is having problems. Please try another payment method." Notifikasi Telegram `create_failed` memakai kalimat yang sama; copy persiapan QRIS tidak berubah. Status code/klaim/no-rePOST tidak berubah.
- Batas (DIGANTI 7 Nov 2026 sore): klien checkout kini otomatis membuang quote lama + mengambil quote baru saat menerima `error_code: "payment_method_unavailable"`, jadi metode lain bisa dipilih tanpa reload. Reuse `orders.quote_id`/semantik klaim server tidak diubah; order lama dibiarkan expire.

## Katalog kurasi kanal gateway — 6 November 2026 (DIGANTI 7 November 2026, lihat bagian teratas; lokal, belum deploy)
- Keputusan owner: penawaran baru tidak memuat kanal Sekalipay `SHOPEEPAY` biasa; hanya `SHOPEEPAY_REALTIME` yang boleh tampil/ditawarkan. Bila realtime tidak ada di katalog merchant, ShopeePay tidak ditawarkan sama sekali — tidak ada fallback ke kanal biasa. Kanal lain (DANA realtime, GoPay, OVO, VA) tidak dihapus.
- Label pembeli: `SHOPEEPAY_REALTIME` tampil "ShopeePay" dan `DANA_REALTIME` tampil "DANA", tanpa kata "Realtime". ID kanal tetap persis (`SHOPEEPAY_REALTIME`, `DANA_REALTIME`) dan biaya/min/max tetap berasal dari provider (contoh subtotal Rp58.000: ShopeePay realtime Rp2.030, DANA Rp2.146 — angka ini hanya contoh, tidak di-hardcode).
- Urutan E-Wallet web: ShopeePay → DANA → GoPay → OVO untuk metode yang ada, lalu metode lain dengan urutan server (tersedia dulu). Metode nonaktif/di luar batas tetap tampil redup pada posisinya; QRIS, VA, Lainnya, Crypto, dan perilaku consent tidak berubah.
- Filter/label diterapkan di katalog gateway bersama sehingga quote web, halaman tes admin, create preflight, dan katalog Telegram konsisten tidak menawarkan kanal biasa. Flag publik/bot tetap OFF.
- Karena snapshot merchant 6 November memiliki 18 kanal (10 VA + 8 E-Wallet), tampilan kurasi menjadi 17 kanal (10 VA + 7 E-Wallet) bila semua kanal snapshot aktif. Ini perubahan perilaku lokal, bukan bukti deployment.
- Invoice lama tetap aman: invoice kanal biasa/realtime masih dibaca, consent, retry, reconcile, dan callback dengan binding tersimpan; tidak ada migrasi atau mutasi baris lama. Label realtime historis dinormalisasi hanya saat dibaca berdasarkan ID kanal eksak; nama/kanal tak dikenal tidak diubah.
- Verifikasi: 2 file fokus/71 tes + integrasi PM final 361 file/4817 tes (`--maxWorkers=2`, 111,07 dtk), lint exit0 (warning existing), tsc/build Pages148, audit0 high/critical+6 moderate existing; Chromium fixture flag OFF 1280 EN/390 ID menampilkan 7 wallet urut ShopeePay/DANA/GoPay/OVO/LinkAja/Virgo/AstraPay tanpa SHOPEEPAY biasa/teks Realtime, ID/fee persis, VA10/Crypto28 tetap; 360 ShopeePay nonaktif tetap posisi pertama dan keyboard melewati ke DANA. Belum ada deployment/klaim live; parser/kurasi baru menunggu publikasi.

## Finalisasi/pemulihan invoice gateway — 6 November 2026 (lokal, belum deploy)
- Bukti produksi read-only (order admin `AXV-20261106-5A2FF24C`, subtotal Rp18.000): invoice provider ada (amount18.000/fee543/total18.543/pending) tetapi TX lokal `initializing` dengan `provider_payment_id`, payable/fee kosong, dan marker `sekalipay_gateway_status_mismatch_manual_review`.
- Penyebab: (1) link `checkout_url` sah milik app (`app.shopeepay.co.id`) ditolak validator yang hanya mengizinkan host `sekalipay.com`, padahal `payment_link` kanonis sudah valid; finalisasi gagal setelah invoice id diklaim. (2) GET payment-status resmi tidak mengirim `is_sandbox` (create mengirim); reconcile lama mewajibkannya.
- Perilaku baru: `payment_link` tetap wajib kanonis; `checkout_url` opsional non-kanonis diredaksi ke null (tanpa allowlist host baru). `is_sandbox` create-time disimpan; GET boleh tanpa field itu, dan bila ada harus cocok dengan mode tersimpan. `completed` hanya diterima sebagai lunas untuk invoice sandbox tersimpan; tidak ada asumsi false.
- Batas: invoice lama yang sudah `initializing` tanpa mode sandbox create-time **tidak dapat dipulihkan aman via GET** (tidak ada mode tepercaya); biarkan manual review, jangan reset klaim/mutasi/POST ulang. Untuk kegagalan finalisasi baru, mode tersimpan memungkinkan retry GET-only.
- Tidak berubah: validasi amount/channel/order/invoice/expiry, consent fee (estimasi540 vs aktual543 tetap diminta), late review, callback, no-rePOST, budget status, flag/env. Verifikasi fokus 4 file/97 tes (integration56, proxy25, picker15, workerd1; termasuk workerd) + integrasi PM final 361/4817, lint exit0 (warning existing), tsc/build Pages148, audit0 high/critical+6 moderate existing; order mock subtotal64000 OVO estimasi1920→final provider2420/total66420 hanya satu POST create, consent200→link kanonik, reload invoice sama/GET200; bukan transaksi produksi baru; legacy produksi tetap manual review tanpa reset; belum deploy dan bukan klaim live/settled.

## Data produk pengujian produksi — 6 November 2026
- Atas permintaan owner, satu produk **For Testing Only** aktif di D1 produksi: ID116, `/produk/for-testing-only`, kategori Developer & Tools, badge `Testing Only`. Ini produk katalog biasa yang terlihat publik, bukan produk dengan otorisasi admin-only atau sandbox; rail baru tetap hanya tersedia melalui halaman tes admin existing.
- Tiga varian: ID268 `Test Rp8.000` (Rp8.000), ID269 `Test Rp10.000` (Rp10.000), ID270 `Test Rp40.000` (Rp40.000). Angka tersebut harga dasar sebelum biaya metode; minimum1, stok tak terbatas, tanpa harga coret/grosir. Sumber dan fulfillment manual, tidak terhubung WR/SK atau inventori kredensial; Telegram produk dinonaktifkan. Deskripsi menegaskan tidak ada akun/lisensi/layanan atau pengiriman otomatis dan pembayaran tetap uang nyata.
- Perubahan data saja: dibuat sebagai draft nonaktif, ketiga varian diverifikasi sebelum aktivasi; tidak mengubah kode/schema/env/flag pembayaran atau produk lain. Verifikasi D1, katalog publik200 (1produk/3varian, min8000/max40000), Chromium1280/390 memilih seluruh varian dengan harga benar dan tanpa overflow; keyboard desktop dan gambar termuat. Tidak membuat order/invoice atau memverifikasi pembayaran/settlement. CSP memblokir beacon analytics Cloudflare existing; bukan perubahan produk ini.

Koreksi tes nyata6November2026: halaman tes `770a051` sudah terdeploy, tetapi percobaan ShopeePay owner ditolak upstreamPOST401. Bug adapter mencampur mode autentikasi: akun IP whitelist memerlukan HMAC body JSON mentah, bukan Enhanced path/params/timestamp. POST via VPS kini menandatangani byte yang dikirim; GET200 hanya membuktikan key/IP, bukan signature POST. Tidak ada perubahan harga/fee/UI atau flag publik/bot, tidak ada POST ulang percobaan lama. Tes kontrak independen mereproduksi kegagalan lama; koreksi ini aktif di canonical `d2edb1924250472af223cfce0b955e2412bca1ee` (success `2026-11-06T15:40:46.22327Z`) dan invoice tersimpan terbukti dibuat — belum bukti dibayar/settlement live. Detail ARCHITECTURE §16.20.

## Tes pembayaran admin — 6 November 2026
- Owner membatasi aktivasi NOWPayments dan Sekalipay gateway ke `/admin/payments/test`, bukan checkout publik atau Telegram. Halaman memakai keranjang/produk dan checkout asli; pesanan/invoice nyata, dan pesanan lunas tetap diproses serta dikirim. Peringatan ini tampil sebelum submit. Login admin aplikasi + idle/revokasi dan Cloudflare Access produksi tetap wajib.
- Quote/create melalui `/api/admin/payments/test/{quote,orders}` dengan pemeriksaan admin server-side. Marker `admin_payment_test:true` ikut token bertanda tangan; quote tes ditolak di create publik, quote publik ditolak di create tes, termasuk retry. Query/body/header bukan pemberi izin. Kill-switch `PAYMENT_ADMIN_TEST_ENABLED=false` menghentikan quote/order tes baru; retry order tersimpan tetap memerlukan admin, callback/status tetap berjalan.
- Keputusan owner 7 November 2026: rail non-QRIS (Sekalipay gateway VA/E-Wallet + crypto NOWPayments) dibuka ke PUBLIK web + bot Telegram. Pages produksi `SEKALIPAY_GATEWAY_ENABLED=true` dan `NOWPAYMENTS_ENABLED=true` (`secret_text`, PATCH metadata 71 env tetap) — berlaku pada deployment CI berikutnya; belum ada bukti transaksi publik paid/settlement.
- Snapshot 6 November (histori): produksi disiapkan dengan `PAYMENT_ADMIN_TEST_ENABLED=true`, kedua flag publik `NOWPAYMENTS_ENABLED=false` dan `SEKALIPAY_GATEWAY_ENABLED=false`, outcome `usdtbsc`, serta empat kredensial provider `secret_text`. Tidak ada perubahan biaya, minimum, stok, consent, claim/idempotensi, payout atau bot.
- Bukti: proxy VPS sudah terpasang, health `skg:true`, tanpa token401 dan GET katalog bertanda tangan200/18kanal. Bootstrap snapshot produksi dari GET provider menghasilkan kurs valid dan21koin pada `2026-11-06T13:55:17.602Z`; tujuh minimum gagal dihilangkan, bukan dipaksakan tersedia. Percobaan awal FX429 tidak ditimpa kurs tebakan; bootstrap dijeda lalu berhasil. Cron existing menyegarkan snapshot dengan API key saja, tanpa flag publik.
- Verifikasi implementasi770a051: 361file/4803tes, lint/typecheck/build Pages148edge routes lulus. Chromium fixture ID1280/390/360: auth, isolasi checkout publik, pilih jaringan eksplisit/keyboard/fokus, OVO dengan consent selisih fee, crypto pending/refresh/resume/expiry, tanpa overflow/error konsol terkait. Tidak ada invoice/pembayaran/settlement produksi untuk QA. Versi770a051 dan koreksi POST di atas (canonical `d2edb19`) sudah terdeploy; invoice tersimpan terbukti dibuat, tetapi jangan menganggapnya bukti dibayar/settlement atau siap live.

> Catatan implementasi lokal bertanggal di bawah adalah snapshot historis. Baseline UI/logo sudah terdeploy pada `e2aa02a375d4dd7dab0ed33a1499f6262e433f5f` (Pages `8d7a4469-3d89-414e-bf3e-89dc8c4bf0d5`); bukan aktivasi rail publik. Kontrak yang tidak diganti tetap berlaku.

Keputusan owner 6 November 2026 (implementasi lokal): suspensi merchant Sekalipay dicabut; tampilkan metode non-QRIS dalam grup **Virtual Account → E-Wallet → Lainnya → Crypto**, sesudah QRIS langsung. Grup kosong tidak tampil; angka biaya/batas dan ID tetap dari quote server. Header gateway menampilkan biaya termurah, baris kanal ringkas dengan logo/nama/biaya, serta animasi buka/tutup 220ms (tanpa animasi saat reduced motion). Revisi terbaru: hapus pencarian di seluruh grup pembayaran, termasuk VA dan Crypto; seluruh 18 label snapshot merchant memakai logo asli lokal, termasuk varian Alternative/Realtime. Label tidak dikenal tetap monogram netral. Semua 12 simbol/28 opsi crypto tetap ditampilkan, dengan jaringan dipilih eksplisit tanpa bawaan. Kanal di luar batas tetap nonaktif; menutup grup terpilih menghapus pilihan. Ringkasan gateway = Subtotal, biaya metode, Total dan catatan persetujuan total akhir; consent selisih fee tetap wajib di halaman pesanan.

Bukti akses 6 November: GET katalog bertanda tangan dari VPS HTTP200, 18 kanal (10 VA + 8 E-Wallet), tanpa membuat invoice nyata. Adapter memakai proxy VPS karena whitelist IP merchant; konfigurasi proxy parsial/invalid gagal tertutup. Jalur `/skg/*` masih lokal, belum dipasang di VPS; flag/env gateway Pages tidak diubah. QA memakai snapshot katalog tersebut dengan D1 lokal dan invoice mock, bukan bukti pembayaran/settlement atau aktivasi produksi. Detail: ARCHITECTURE §16.20 dan `docs/agent-rules/payments.md`.

Verifikasi revisi logo/tanpa pencarian lokal 6 November: 360 file/4794 tes, typecheck/lint/build Pages lulus (145 edge routes). Chromium ID/EN pada 1280/390/360: semua grup tersedia tanpa input pencarian, seluruh logo berhasil decode tanpa monogram kanal dikenal, tanpa overflow/error konsol; keyboard/fokus, close/deselect, inert, jaringan eksplisit dan reduced motion lulus. Bukti consent invoice mock berasal dari QA sebelumnya, tidak diulang untuk perubahan dekoratif ini. Tanpa perubahan flag produksi atau bukti deployment.

Snapshot keputusan 5 November 2026 (**bagian penyembunyian Sekalipay diganti keputusan 6 November di atas**): merchant Sekalipay gateway disuspend, sehingga metode non-QRIS Sekalipay (VA/E-Wallet/transfer lain) tidak ditampilkan. Kodenya dipertahankan dan tetap tersembunyi karena `SEKALIPAY_GATEWAY_ENABLED` tidak aktif di produksi. Rail yang dituju saat itu: QRIS + Crypto NOWPayments. Bulk order, harga USD, dan bilingual id/en tetap direstui; aktivasi produksi crypto tetap terpisah dari perubahan ini.

Crypto multi-koin (lokal 5 November 2026, belum deploy; revisi 7 November 2026: biaya layanan per koin): pembeli boleh membayar dengan koin apa pun yang aktif di akun NOWPayments dan ada di katalog kurasi (populer + stablecoin; 28 koin) — owner tetap menerima USDT BSC lewat auto-konversi (`NOWPAYMENTS_OUTCOME_CURRENCY`). Invoice baru memakai kurs mengambang dengan fee provider ditanggung merchant, sehingga minimum provider rendah (US$0,08–1,95); pembeli menanggung biaya lewat **biaya layanan crypto per koin** = 1% proporsional + biaya tetap per ticker (usdtbsc 8c, bnbbsc 8c, eth 17c, ticker lain 20c termasuk cadangan payout; keputusan owner 7 November 2026, angka BNB/ETH estimasi dan koin lain menunggu kalibrasi dashboard NOWPayments) atas nilai USD, dibulatkan ke atas ke sen — total USD = `ceil((base + biaya tetap) × 10000 / 9900)`, biaya layanan = total − base. Copy pembeli memakai label generik "Biaya layanan crypto"/"Crypto service fee" (bukan persentase). **Tidak ada lantai US$2 milik AXVARA**: crypto hanya dibatasi minimum provider koin × 1,15, jadi pesanan kecil seperti US$0,51 tetap bisa dibayar dengan koin yang minimumnya rendah; koin di bawah minimum tampil nonaktif dengan "Min. US$…" (web) atau tidak ditampilkan (Telegram). Invoice lama tetap memakai rincian biaya yang tersimpan (mis. 1,5%/2%) di halaman pesanan dan rekonsiliasi. Telegram menampilkan satu entri "Crypto (USD)" lalu sub-keyboard koin. Instruksi bayar menyebut jumlah tepat + simbol + jaringan dan peringatan koin/jaringan lain dapat hilang. Alamat dengan memo/extra id tidak pernah ditampilkan (gagal tertutup). Detail: `docs/agent-rules/payments.md`, ARCHITECTURE §16.19. Status: implementasi LOKAL dengan tes fixture; belum dipublikasikan atau diverifikasi di akun live.

Kurs USD otomatis (lokal 5 November 2026, belum deploy): harga tampilan USD dan harga crypto memakai kurs IDR/USD yang di-refresh server dari estimasi NOWPayments (disimpan di D1, dicek ≥30 menit sekali oleh cron), bukan env manual. Kurs tertua yang dipakai 24 jam; tanpa kurs segar (atau cadangan env darurat) tampilan kembali ke IDR dan crypto tidak ditawarkan. Saat membuat pesanan crypto, kurs bertanda di quote tetap diterima bila kurs terbaru berbeda ≤2% dan quote ≤24 jam; di luar itu pembeli diminta memuat ulang quote (409). Nominal USD yang ditagih tetap angka pada quote. Daftar koin crypto (28 kurasi) dan minimum USD tersedia di server dan kini dipakai quote/create (lihat paragraf crypto multi-koin di atas).

Koreksi lokal 5 November: halaman pesanan menafsirkan expiry SQL tanpa zona sebagai UTC agar consent gateway yang masih hidup tidak tampil kedaluwarsa di WIB; expiry kosong/invalid menyembunyikan pembayaran. Snapshot checkout lokal tanpa expiry order valid menunggu GET server, bukan menebak expiry dari QR. TTL dan validasi pembayaran server tidak berubah; browser/build ulang belum diverifikasi.

Checkout Market lokal menggunakan chrome ID/EN sesuai preferensi eksplisit atau locale quote; perubahan bahasa tidak membuat quote baru atau mengubah pilihan metode, kontak, persetujuan, keranjang, maupun pesanan. Nama dan pesan pemilik/provider yang tidak dikenal tetap asli. Diverifikasi lokal dengan browser nyata dan disetujui review UI pembeli (5 November 2026); belum deploy produksi.

## Integrasi UI Market lokal — 4 November 2026
Editor admin tingkat grosir dan tampilan grosir PDP/keranjang/checkout terhubung secara lokal: agregasi per varian, harga klien estimasi, quote server otoritatif dan `expected_price` harga dasar. Checkout memilih ID metode dari quote; consent gateway serta status gateway/crypto memakai view aman server. Preferensi bahasa dan mata uang independen; USD display memakai sen hasil server atau fallback IDR, tanpa mengubah charge. Belum terbit ke produksi. Status 5 November 2026: Vitest penuh 4547/4547, build Pages 145 edge routes, QA browser nyata lokal 1280/390 lulus dan review UI pembeli Opus disetujui; editor admin tidak dirender/diverifikasi.

## Revisi owner marketplace (5 November 2026, lokal; persetujuan visual baru menunggu)
- **Pembayaran:** QRIS tampil langsung di atas semua grup sebagai kartu radio terpilih bawaan (tanpa header akordeon, chip, chevron, atau panel tersembunyi; satu badge "Paling cepat"/"Fastest" inline di judul kartu QRIS); akordeon grup Virtual Account / E-Wallet / Transfer lainnya / Crypto dengan chip logo saat tertutup dan semua metode merchant (logo, biaya est., batas min) saat terbuka; menutup grup yang memuat pilihan menghapus pilihan eksplisit (tanpa ringkasan metode/fee; CTA menunggu pilihan baru, QRIS langsung dan default checkout baru tidak berubah). Metode/biaya/batas hanya dari quote server (tidak ada katalog statis). Kanal di luar batas min/max merchant tampil nonaktif (tidak bisa dipilih) dengan alasan dan kekurangan dari server; hanya yang tersedia yang ditandatangani dan diterima saat create (batas inklusif, divalidasi ulang). Bila total berubah dan pilihan menjadi nonaktif, pilihan pindah ke QRIS dengan pemberitahuan sebelum membuat pesanan. Paragraf peringatan panjang biaya/gas crypto dihapus (caption "+ biaya jaringan"); alamat/nominal tepat dan total akhir tetap muncul/disetujui di halaman pesanan.
- **Grosir:** rincian harga berupa daftar baris tier (rentang inklusif dari min_qty asli; tier terakhir "N+" yang inklusif, bukan "> N"; harga satuan di kanan; tanpa chip persen); perhitungan total, agregasi, stok dan plafon tidak berubah.
- **Bahasa dan mata uang:** satu tombol bendera bulat di header semua lebar membuka menu dua bagian independen (Bahasa: Indonesia/English UK; Mata uang: Rupiah/US Dollar); perilaku cookie, default otomatis dan independensi tidak berubah; footer tidak lagi memuat baris/sheet.
- Status: lokal, tes fokus lulus; belum deploy; persetujuan Opus untuk revisi ini menunggu (bukan persetujuan 4 November).

## Preferensi bahasa/mata uang — penempatan responsif (4 November 2026, lokal)
(Riwayat: penempatan tombol teks/footer di bawah digantikan oleh tombol bendera 5 November 2026.)
Perilaku produk tidak berubah: bahasa dan mata uang tetap independen (EN+IDR dan ID+USD valid), cookie hanya ditulis saat pilihan eksplisit, default otomatis dari server, dan perubahan tidak mereset quote, pesanan, rel terpilih, kontak, persetujuan, atau keranjang. Yang berubah hanya penempatan: tombol teks di header ≥sm; di bawah sm lewat baris pertama footer yang membuka bottom sheet. Chrome ringkasan/footer halaman pesanan mengikuti locale pesanan tersimpan, bukan preferensi global. Belum terbit ke produksi; dipenuhi dan diterima review UI pembeli Opus pada 5 November 2026 (lokal).

## Persiapan payout (lokal, 4 November 2026)
Implementasi invoice/reconcile lokal bukan implementasi withdrawal atau bukti dana terselesaikan. Payout sendiri belum diaktifkan: tujuan bank/DANA Sekalipay, atau aset/jaringan/alamat dan custody/routing crypto harus dipastikan owner; ambang/cadence hanya ditentukan bila diperlukan. Ketidaktersediaan payout tidak otomatis memblokir rollout pembayaran bila payout sengaja ditunda. Aturan tanpa retry withdrawal ambigu, biaya dan batas bukti ada di `docs/agent-rules/payments.md`.

R3 koreksi lokal: pemberitahuan terminal Telegram untuk gateway/crypto memakai locale order dan tidak menampilkan QRIS atau detail bayar; retry invoice terikat klaim pengiriman pertama dan budget query terhitung. Ini bukti fixture, belum publikasi.

R2 koreksi lokal: konflik callback/status gateway tetap review meski muncul saat probe finalisasi; detail dan consent tersembunyi. Pemulihan POST ambigu menunggu refresh/cron GET, bukan POST ulang. Isu minimum quote tetap membawa slug bila diberikan.

TG-R1 lokal: ekstraksi method-options web→TG + frozen payq1 offer/seleksi per nonce (QRIS-first, namespace guard, tanpa create/consent/provider-write; R2 menangani create/consent/status). Detail: docs/agent-rules/payments.md, ARCHITECTURE §method-options, CHANGELOG.

TG2c1 buyer transaction locale fixture lokal: copy invoice/status/paid/delivery/credential + tombol pembeli mengikuti locale order tersimpan (ID legacy bila kosong); charge QRIS tetap IDR aktual via payable ledger; admin/grup tetap ID; rail baru/fee gateway tetap TG2c2.

TG2b bulk Telegram fixture lokal: harga efektif agregat per varian (all-units,
tier tertinggi menang; varian berbeda tidak digabung), pin base/konfigurasi di
guard atomik + tag persetujuan; order baru simpan locale pemilik, replay pakai
harga/locale snapshot tersimpan; currency display-only tidak mengubah charge.

TG2a read-commerce locale fixture lokal: copy baca ID/EN dari prefs tersimpan
(home/reply/inline menus, katalog/kategori/cari/list/detail/varian/qty/email
prompt/cart/help/warranty/error/loading); satu harga display-currency per tombol
(IDR jujur bila FX USD basi, tanpa USDT/$0); invoice/order-status tetap TG2b/c.

TG1 fixture lokal (+correction1): /start pertama chooser eksplisit; payload disimpan di pending_action onboarding:* lalu dikonsumsi sekali saat lang: (tidak auto-order, duplikat tidak replay); jawaban callback tepat sekali milik handler (route tidak pre-answer lang:/cur:).

BULK1c fixture lokal (+correction1): protected admin API persists bulk pricing per varian
(enabled+tiers mentah di GET, default off create, omitted=merged-validated, strict zod,
guards atomic dalam batch + 409 stale, audit console.info). UI/Telegram belum dihubungkan; jangan aktifkan/publikasi.

BULK1a fixture lokal menyimpan maksimal lima tier per varian, harga IDR satuan untuk seluruh unit pada ambang tertinggi; penerapan quote/order dan editor admin belum diimplementasikan.

LOC1 fixture lokal: preferensi bahasa dan mata uang tampilan independen; kurs USD tidak tersedia tidak mengubah preferensi tersimpan. UI/Telegram belum dihubungkan.

S3d2 kebijakan biaya crypto pembeli diuji fixture lokal; UI dan publikasi belum dilakukan.

S3d1 lokal memerlukan outcome crypto eksplisit untuk preflight minimum fixed-rate/buyer-fee; ini bukan aktivasi kebijakan fee pembeli pada invoice.

S3c lifecycle merchant diuji dengan fixture lokal untuk polling/expiry/cancel; belum dipublikasikan.

S3b order dan consent gateway masih dalam pengerjaan fixture lokal; jangan aktifkan sebelum verifikasi lengkap.

S3a lokal: quote dapat menawarkan metode merchant default-off dengan estimasi fee dan total bertanda tangan; integrasi order/UI dan publikasi belum dilakukan.

Sekalipay merchant S2b lokal menyimpan fee final, mewajibkan consent selisih, serta memverifikasi callback dan status sebelum paid atomik; checkout dan scheduling belum terhubung atau dipublikasikan.

## W3 backend lokal — 4 November 2026
Snapshot checkout crypto USD dan locale order tersedia pada backend fixture; UI/Telegram dan publikasi belum dilakukan. QRIS tidak digantikan. W1 di bawah adalah snapshot historis.

## Snapshot historis implementasi lokal NOWPayments W1 - 3 November 2026

Provider crypto NOWPayments diimplementasikan LOKAL saja (fixture, flag default
OFF): adapter invoice terikat order + rekonsiliasi GET + receiver IPN terverifikasi
HMAC-SHA512 dengan dedupe durable; reconcile invoice tersimpan berjalan walau
flag pembuatan baru OFF. QRIS tetap satu-satunya rail publik; rail baru tidak
tampil di checkout web/Telegram sampai appearance ACC (W3). Sekalipay gateway
tetap preparation shell tanpa adapter (kontrak gateway belum terverifikasi).
Belum payout otomatis, belum settlement Bitget; blokir manual tercatat di runbook.
Detail: `docs/agent-rules/payments.md`.

## Rencana metode pembayaran tambahan - 3 November 2026

Owner merencanakan NOWPayments untuk crypto dan Sekalipay payment gateway untuk
pembayaran selain QRIS pada web AXVARA dan bot Telegram. Kredensial gateway
disimpan privat; implementasi W1 bersifat lokal/fixture dan belum menjadi metode
pembayaran publik. Sekalipay gateway terpisah dari integrasi supplier existing.
Detail: `docs/agent-rules/payments.md`.

## Snapshot historis persiapan NOWPayments - 3 November 2026

Tahap ini hanya menyimpan kredensial privat lokal dan memeriksa API baca-saja
(API key final diterima `GET /merchant/coins` HTTP200). Checkout Market/Pedia/bot
belum menawarkan crypto; belum ada endpoint IPN, env Pages, invoice atau transaksi
NOWPayments. Pemilihan aset/jaringan, wallet, alur settlement dan kontrak
konfirmasi/rekonsiliasi harus ditentukan sebelum integrasi pembayaran berikutnya.
Detail: `docs/agent-rules/payments.md`, ARCHITECTURE §16.15.

## Persiapan buyer Digiflazz - 2 November 2026

PKS clear menurut owner; belum berarti produk topup AXVARA siap dijual.
Tahap ini hanya alat lokal cek saldo/katalog melalui VPS ber-IP tetap, berkas
kredensial privat dan handoff pengaturan buyer. Owner mengisi whitelist/OTP/key,
memilih produk/seller sesuai region dan reminder saldo. Tidak ada perubahan
checkout/pembayaran, produk publik, dispatch, webhook, deposit atau transaksi
supplier. Update owner: seluruh kategori Games, bukan hanya ML/FF; cek Development
berhasil (saldo0, 73 produk akun, 9 Games), sedangkan Production HTTP400 pada
`cek-saldo` (penyebab belum dipastikan).
Snapshot publik 4.380 produk/150brand bukan konfigurasi seller akun; pilihan
seller termurah/reputasi baik menunggu sesi dashboard login dan data pembanding
aktual. API buyer tidak mendokumentasikan ranking favorit/perbandingan seller.
Tidak ada seller akun yang diubah. Integrasi live
menunggu ledger/referensi stabil, batas modal, rekonsiliasi pending dan webhook
terautentikasi serta pengujian development. Detail: `docs/agent-rules/digiflazz.md`.

## Koreksi order Pedia - 3 November 2026

Keputusan owner terbaru: batalkan paket UX jumlah/Sorotan/waktu/ringkasan
(`1b0efde`), pertahankan redesign panel deskripsi (`3820cbc`) dan buat lebih
compact di mobile. Pilihan jumlah kembali berbasis paket existing tanpa filter
minimum tambahan atau catatan pembulatan baru; grup Sorotan dihapus, chip waktu
kembali memakai aturan sebelumnya, Speed dan Avg time tetap terpisah, dan daftar
langkah ringkasan kembali tampil. Redesign deskripsi tetap netral, statistik
label–nilai satu kolom mobile/dua kolom mulai sm, Refill/Drop bertumpuk di mobile,
serta arti istilah fitur di disclosure. Chip pill, warna drop, animasi dan banner
existing tetap; penghapusan teks Harga acuan dan hitungan layanan pada judul
(permintaan sebelumnya) dipertahankan. Implementasi untuk publikasi CI;
deployment belum diverifikasi. Harga server dan minimum pembayaran tidak berubah.

## Copy layanan dan refill Pedia - 3 November 2026

Implementasi lokal untuk publikasi CI; deployment belum diverifikasi. Bukti sumber
adalah cache baca-saja 1 November 2026 (IndoSMM sedang 503 saat pekerjaan ini, jadi
tidak ada klaim "diperiksa ulang"). Tidak ada fitur, kolom, atau env baru.

- Nama layanan membawa karakteristik yang memang tertulis di sumber, langsung dan
  konkret: `Followers Indonesia Real Look`, `Followers Global HQ · Akun berpostingan`,
  `Followers Global · Akun lama berpostingan`, `Komentar Indonesia · Campuran`,
  `… Real People/Real Human`. Sumber campuran/bot tidak lagi diberi kata Real/HQ.
  Tidak ada klaim active, buzzer, story, kualitas, atau "kelas/label Real".
- `Instant Start` adalah segmen nama dari sumber (bukan kolom baru) dan tampil sebagai
  chip, tanpa chip waktu tambahan meski ETA atau fallback tersedia; layanan tanpa
  Instant Start tetap menampilkan chip waktu. Snapshot order baru membekukannya lewat `service_copy.service_name`; order lama
  tetap memakai nama lamanya. `eta_start` tidak diisi dan rentang tidak dikarang:
  baris Start time = `eta_start`, atau `Instant Start` dari nama, atau fallback lama.
  Start time, Speed, dan Avg time tetap terpisah.
- Janji refill: `Refill N hari [sejak pesanan dibuat|selesai], selama layanan masih
  tersedia.` Anchor dari `pedia_tiers.refill_anchor` (kini dibaca katalog); anchor tidak
  dikenal tidak diberi klausa "sejak". Lifetime dan 0 tetap. Chip tetap `Refill N Days`.
  Atribusi "dari/lewat AXVARA" dihapus. Pembersihan teks lama hanya kosmetik (label dan
  atribusi); angka hari, anchor, dan kelayakan tidak berubah.
- Halaman pesanan memuat satu blok Refill dengan satu tombol Ajukan Refill dan status
  belum selesai/siap/cooldown/diproses/berakhir/butuh admin (masa berakhir dari
  `refill.ends_at` API). `/pedia/refill` hanya panduan sekunder dengan backend yang sama.
  Kontak checkout tanpa PIN Pedia, batas 1× per 24 jam, dan snapshot tidak berubah.
- Kontrak yang SENGAJA tidak diubah: tier 285 / layanan 5834 tetap `Refill 90 Days`.
  Cache menunjukkan konflik (nama sumber 30 hari, deskripsi sumber 90 hari); keputusan
  kontrak menunggu owner. Tidak ada perpanjangan global 30→35 hari dan order terjual
  tidak diubah.

## Status aktual Pedia vs serah terima Market - 2 November 2026

Implementasi lokal (backend + UI); publikasi melalui CI, deployment belum
diverifikasi. Pedia tidak lagi diperlakukan sebagai handover Market: guard
fulfillment generik (DANA/webhook, ensure, reconcile, cron) no-op untuk
`order_kind='pedia'` dan tidak membuat baris Market baru (baris lama yang
salah dibiarkan inert, tanpa hapus/migrasi/beli ulang); DANA bercabang
seperti GoPay/KlikQRIS. Nama pembeli mengikuti Market
(`deriveNameFromEmail`, disimpan saat checkout + fallback baca untuk baris
lama). Status Telegram/admin/API, lookup dan email pembeli memakai item
Pedia durable (status aktual, qty, progres, ETA verbatim, nama layanan
snapshot; link `SITE.pediaUrl/pesanan/<code>`; tanpa kata handover/kredensial
dan tanpa identitas supplier).

Halaman pembeli `/pesanan/[code]` di host Pedia menampilkan status aktual
(Pembayaran Diterima, Diproses, Berjalan, Selesai, Selesai Sebagian,
Dibatalkan, Sedang Dicek) dengan `StatusPill`, waktu bayar sebagai baris
sekunder, ringkasan layanan snapshot, empat sel hitungan (Jumlah awal,
Dipesan, Sisa, Masuk; tidak diketahui = "Belum dilaporkan", bukan 0),
progres hanya bila terkonfirmasi, estimasi jujur (eta_finish atau eta_start
pra-progres), baris kesegaran 5/10/30 detik (needs_check ikut polling 30
detik), tanpa animasi baru. Pintu masuk Market (`/pesanan/AXP-…`,
`/lacak-pesanan` form/deep-link) dialihkan atau menunjuk ke host Pedia tanpa
kontak; respons lookup Pedia hanya kartu penunjuk. Admin Pesanan: chip Pedia
+ chip status lifecycle, quantity Pedia, tanpa handover/kredensial Market;
needs_check/partial/canceled menautkan ke Admin → Pedia → Pesanan.

Email lifecycle paid/processing/completed memakai pagar klaim fenced
(`buyer_notice_log` existing: lease UUID, attempts maks 5, backoff
1/5/15/60 mnt, due/stale guard, settle CAS; klaim gagal = tidak kirim) dan
tampil seperti email Market (shell `renderBrandedNotice`: header Midnight,
badge invoice, pill STATUS, kotak detail Layanan/Jumlah dipesan/Jumlah awal/
Sisa/Masuk/Link tujuan, CTA "Lihat Status Pesanan →", blok WA, footer;
tidak diketahui = "Belum dilaporkan"/"Belum dikonfirmasi", bukan 0; tanpa
PIN/kredensial/garansi Market/ID supplier/biaya). Paid independen dari
sukses supplier; processing = "Diproses" setelah resi durable dan jumlah awal
serta sisa valid tersimpan pada `submitted`/`in_progress` (jumlah pesanan
integer aman positif, awal integer aman ≥0, sisa integer aman 0..jumlah;
0 asli valid). Belum siap tidak mengklaim atau membakar percobaan; retry
existing memeriksa lagi, dan email terkirim lama tidak dikirim ulang.
(Bukan "sedang berjalan"
kecuali `in_progress` aktual; supplier Pending tidak dipromosikan dan tidak
meregresi item berjalan; tanpa resi/ambigu tidak kirim dan tidak beli ulang;
order lama yang sudah completed tidak diemail processing retroaktif);
completed memakai istilah `Refill N Days` (bukan "masa garansi"). Isi:
nama layanan snapshot, jumlah awal independen (bila dilaporkan) + sisa/
terkirim (bila diketahui), tanpa PIN/kredensial/nama supplier, estimasi
hanya field layanan yang dapat kosong, bukan snapshot. Forward sender
memakai API Resend tanpa idempotency key untuk email ini: transport bounded
at-least-once (bukan exactly-once). Partial/canceled memakai bahasa tindak
lanjut tanpa kata manual/admin untuk pembeli. Recovery: sighting paid
maksimal 5 dan discovery maksimal 2/fase; paid/completed hanya order lunas
≤24 jam, processing memilih hanya `submitted`/`in_progress` berresi dan
hitungan valid tanpa batas 24 jam agar yang belum siap tidak menghalangi antrean;
ledger due existing tetap retry setelah 24 jam. Stale terminal disupresi
tanpa kirim. Input start_count hanya number/string (boolean/object/array
ditolak — Number(true) tidak boleh jadi hitungan); blank/missing/invalid
tidak pernah menjadi 0 (angka 0 yang benar-benar dilaporkan tetap valid dan
settled; nilai nonzero existing dipertahankan). Conditional correction:
slot NULL/0 menerima nilai positif tervalidasi berikutnya (mis. Pending 0 →
Completed 8278); positif terkonfirmasi tidak pernah digeser nilai konflik
berikutnya; tanpa tebak dari target/quantity. Koreksi historis terminal
HANYA via script operator satu-kali `scripts/pedia-recount-start-count.mjs`
(dry-run default, apply eksplisit; cron tidak memindai terminal): allowlist
wajib maksimal 50 kode termasuk row historis tanpa marker, wajib status terminal
supplier; outage maksimal tiga percobaan per item per invocation dan exit gagal;
tanpa marker atau retry otomatis. Status-read dan
tulis count-only bersyarat; tanpa dispatch/pembayaran/email/refill/mutasi
kontrak order; tanpa migrasi/env/cron/lease100-tahun baru. Tanpa migrasi, env, cron,
atau klaim deployment baru. Halaman terminal yang sudah terbuka perlu dibuka
ulang setelah koreksi; koreksi historis produksi belum dijalankan.

### Sumber data status Pedia: resmi vs non-resmi

| Kebutuhan | Sumber resmi | Non-resmi (bukan sumber status) |
|---|---|---|
| Lifecycle + start_count/remains | API IndoSMM v2 `action: status` (resmi, pull-based) | — |
| Nama layanan/paket, quantity, target | Snapshot order Pedia (saat checkout) | — |
| ETA | Field tier saat ini, dapat kosong; bukan snapshot | — |
| Katalog, harga, min/max, flag refill API | API `services` + `balance` resmi | — |
| Deskripsi/speed/start-time marketing | — | AJAX deskripsi layanan (hanya kurasi offline, tidak dipakai status live) |
| Statistik 7 hari (success/cancel rate) | — | Analisis publik (sinkron kesehatan katalog via cron, bukan ETA per order) |
| Avg time dashboard | — | Tidak dipakai (butuh sesi terautentikasi; bukan ETA per order) |

Rincian: `docs/pedia/indosmm-catalog-refill-2026-11-01.md`; pemetaan
sumber-ke-kebutuhan: artefak tim `api-gap-map.md` (bukti kerja, bukan
kontrak permanen repo — kontrak permanen adalah bagian ini + PEDIA-PRD).

## WR Jaspay terpisah dari Premium - 2 November 2026

Kontrak integrasi lokal; deployment Pages belum diverifikasi. Jaspay adalah
keluarga API WR terpisah pada base v1 resmi, bukan migrasi order Premium ke v3.
Katalog/identitas baru tidak memindahkan varian atau order lama berdasarkan nama.
Produk tersedia diproses otomatis setelah pembayaran dengan waktu mengikuti
antrean; tidak mengiklankan proses admin/manual atau stok akun siap instan.
Availability berarti unlimited, bukan batas jumlah per pembelian. Maksimum
jumlah wajib valid dan diperiksa server-side termasuk baris varian ganda.

Pembelian memakai referensi supplier stabil. Receipt hilang tidak mengizinkan
repurchase Premium atau tebak invoice; exact replay Jaspay hanya sesuai kontrak
duplicate-ref. Partial/malformed accounts disimpan terenkripsi dan diteruskan
untuk tindak lanjut admin, tanpa menandai seluruh item selesai atau otomatis
mengembalikan uang buyer. Tidak mengubah kontak/PIN/proof checkout pembeli.
Transport proxy VPS sudah terverifikasi; belum ada transaksi supplier nyata atau
bukti deployment Pages untuk tugas ini.

## Detail varian Market dan navigasi layanan - 2 November 2026

Implementasi lokal; deployment belum diverifikasi. Pilihan varian PDP menjadi
satu sumber untuk harga, keranjang, checkout, S&K dan cara aktivasi. Sebelum
memilih pada produk multi-varian, tampil ajakan memilih tanpa menampilkan S&K
varian pertama. Salinan identik yang tersedia pada seluruh varian boleh tampil
dengan label eksplisit semua varian; salinan varian terpilih yang kosong diberi
status belum tersedia, bukan diganti salinan varian lain.

Deskripsi tingkat produk tampil sebagai Deskripsi umum; bagian Pilihan varian
bernama Perbandingan varian, bukan detail pilihan aktif. Ketentuan/aktivasi dari
deskripsi produk tetap terpisah dan tidak diklaim sebagai ketentuan varian.
Deskripsi umum tampil sebelum S&K varian pada mobile dan desktop (koreksi owner
2 November); disclosure
mobile yang terbuka tetap terbuka ketika varian diganti. Tidak menghapus syarat
penting, menebak isi berdasarkan durasi, atau membuat pemilih S&K terpisah.

Kartu promosi layanan Market/Pedia tetap kanan-kiri di mobile (koreksi owner
2 November), judul tidak terpotong;
Produk Serupa mempertahankan ukuran mobile dan menaikkan tipografi desktop.
Pemicu dropdown Market/Pedia bernama Layanan pada semua ukuran; nama aksesibel
tetap Layanan AXVARA. Tidak mengubah pembayaran, stok atau proof pembeli.

## Info layanan Pedia terpadu - 2 November 2026

Implementasi lokal; deployment belum diverifikasi. Panel tepat di bawah layanan
terpilih menjadi sumber deskripsi: karakter layanan, syarat khusus, garansi/drop,
angka layanan, lalu Arti istilah. HQ (High Quality) dan Real adalah label layanan,
bukan jaminan akun aktif/asli, akun lama/berpostingan atau bebas drop. Karakter
khusus hanya mengikuti bukti layanan tersebut. Deskripsi dan syarat unik tetap
terbaca pada mobile; ringkasan tidak mengulang deskripsi. Kartu detail bawah
digabung; Tentang layanan hanya sebelum memilih bila ada copy produk bermakna.

Persentase permintaan refill diberi nama Pengajuan Refill (7 hari), bukan Drop
rate atau tingkat risiko; disembunyikan pada No Refill dan bila data tidak valid.
Gate sampel katalog minimal lima order tetap. Migrasi0090 mengoreksi copy akun
lama dan template Real dengan guard copy lama, tanpa mengubah edit admin atau
snapshot order. Deskripsi dashboard menjadi bahan kurasi, bukan impor otomatis
HTML/API; tidak ada perubahan checkout, harga, supplier atau garansi.

Penyempurnaan nada dan urutan - 2 November 2026 (implementasi lokal; deployment
belum diverifikasi): angka layanan (Start time, Speed, Avg time, Min / Max, Success
rate) tampil paling atas dengan satu caption estimasi, lalu Info layanan. Penjelasan
HQ/Real singkat dan faktual (kategori kualitas / label karakter akun, tanpa perbandingan relatif) tanpa klaim
akun aktif/organik dan tanpa peringatan berulang; risiko drop disebut sekali pada
baris Drop. Label No Drop adalah perkiraan, bukan janji bebas drop; High Drop
menyatakan drop tinggi; layanan tanpa label tidak dianggap No Drop. No Refill
ditulis jelas tanpa klaim harga. Baris syarat hasil generator yang persis
mengulang rentang jumlah, refill, caption estimasi, "Jumlah dapat diisi sendiri dalam batas layanan." dan "Refill N hari sejak pesanan dibuat, sesuai syarat layanan." (hanya bila N = masa refill layanan) tidak ditampilkan lagi; label drop tidak tersedia dinyatakan sekali di baris Drop ("Label drop belum tersedia; jumlah masih dapat berkurang setelah pengiriman."), bukan di glosarium;
syarat khusus lain tetap. Market: judul S&K/aktivasi memakai huruf biasa, langkah
aktivasi tunggal berupa paragraf, hanya URL YouTube berlabel singkat, URL lain tampil utuh agar tujuan tetap terbedakan.
Koreksi owner 2 November: hanya layout datar Market dibatalkan, kotak Cara Aktivasi
di dalam kartu S&K desktop kembali seperti semula. Judul, penomoran, label tautan,
fokus keyboard dan seluruh perubahan panel Pedia tetap dipertahankan.

## Orbit Pedia mobile dan pencarian — koreksi 31 Oktober 2026

Implementasi lokal untuk publikasi CI. Orbit Pedia tampil di tengah sesudah teks
hero pada mobile/tablet dan di kanan pada desktop, mengikuti Market; menggantikan
ketentuan desktop-only16Oktober. Animasi tetap hemat mobile dan menghormati reduced
motion/offscreen. Pencarian navbar Market/Pedia hanya menampilkan satu tombol hapus
custom putih; tombol cancel bawaan WebKit/Chromium disembunyikan tanpa mengubah filter.

## Pencarian dan pemulihan harga web — 31 Oktober 2026

Implementasi lokal untuk publikasi CI; deployment belum diverifikasi. Pencarian
Market tetap memfilter langsung di beranda; Enter/tombol cari dari halaman lain
membuka katalog dengan query tetap tersimpan dalam state tab. Query kosong tidak
menavigasi. Anchor katalog memperhitungkan navbar desktop/mobile.
Pedia menyediakan coba ulang harga secara eksplisit setelah gagal, tanpa mengubah
jumlah, layanan atau draf. Tidak membuat quote/order saat mencoba ulang harga;
validasi, consent nominal, penguncian retry pembayaran dan proof tetap existing.

## Editor ketentuan supplier, 29 Oktober 2026

Implementasi lokal; belum merupakan bukti deployment. Tab Deskripsi & S&K
memuat teks aktual WR/SK yang dapat langsung disunting. Override admin tetap
terpisah dari mirror supplier; perubahan sumber menjeda override dan menampilkan
versi otomatis kepada pembeli. Editor membedakan draft admin dijeda, sumber asli,
dan versi pembeli. Pratinjau menggabungkan draft varian dengan deskripsi di form;
deskripsi tetap disimpan lewat Simpan Produk. Deskripsi WR punya aksi eksplisit
menyalin sumber sebagai awal override.

Simpan teks membawa fingerprint sumber yang ditinjau; sumber berubah atau race
saat UPDATE ditolak 409 tanpa mengubah draft. Muat sumber terbaru mempertahankan
draft. Tersedia Batalkan perubahan dan Kembali ke versi otomatis. Draft memblokir
Simpan Produk serta meminta konfirmasi sebelum modal ditutup; saat menyimpan teks,
modal tidak dapat ditutup. Stok sendiri tetap memakai tab Varian. Pascabayar tetap
membaca katalog terkini, bukan snapshot order; `seller_note` transaksi SK dalam
kredensial tidak diubah. Tidak ada migrasi, dependency, env atau mutasi produksi baru.

## Order Telegram, 29 Oktober 2026

Koreksi owner terbaru: loading persentase lama0/40/70/100% dipulihkan pada
/start dan produk, ditambah sebelum create QRIS satuan/keranjang. Animasi selesai
dan pesan dihapus sebelum langkah berikutnya, best-effort tanpa mutasi transaksi.
Ini indikator transisi berbasis timer, bukan persentase pekerjaan provider.
Varian habis memakai ❌ + nama (tanpa suffix Habis); callback `soldout` hanya
menampilkan alert “Varian produk habis. Silakan pilih produk lain.”, tanpa checkout.
Ketentuan loading paralel di bawah adalah histori yang digantikan koreksi ini.

Implementasi lokal, disiapkan untuk publikasi CI; bukan bukti deployment.
Keputusan ini menggantikan presentasi/fallback penerima Telegram pada snapshot
lama yang bertentangan di bawah.

- Produk dan varian tampil dalam satu pesan, memakai label pembeli kanonis web.
  Durasi metadata non-WR tidak ditempel ulang; harga berasal dari varian yang
  dapat dibeli, stok unik memakai inventory efektif dan batas minimum aktual.
- Jumlah, harga, email masked dan ketentuan dapat diperiksa sebelum QRIS.
  Ringkasan basi kembali ke pilihan terbaru. Email wajib gagal tertutup;
  konfirmasi email sekali pakai terikat email yang ditampilkan dan tidak dapat
  membeli lagi lewat replay sesudah lunas. Navigasi membatalkan input lama.
- Keranjang berubah atomik, dan checkout membersihkan hanya snapshot yang dibeli.
  Produk harus masih aktif/diizinkan pada kanal Telegram di batch order.
  Invoice/order aktif dipakai ulang sebelum memeriksa keranjang atau email baru.
- Pembatalan meminta konfirmasi lalu mengubah order/ledger/stok secara atomik.
  Gagal setup tanpa invoice dibatalkan atomik; invoice tercatat atau hasil ambigu
  mempertahankan reservasi. Tidak mengembalikan stok terpisah dari status order.
- Status mencantumkan semua item. Pembayaran diterima, produk belum siap,
  pengiriman gagal dan hasil parsial dibedakan. Kredensial/notifikasi buyer
  hanya ke ID pribadi pemilik, bukan fallback akun lain dari chat tersimpan.
  Notifikasi lunas memakai lease/backoff bounded pada antrean existing; input
  WA cadangan tidak menimpa percakapan yang sedang aktif.
- Koreksi presentasi lanjutan owner29Oktober: loading /start dan produk berjalan
  bersama pekerjaan nyata, tanpa persentase/jeda palsu. Satu bubble dikirim
  langsung; hasil menunggu request awal loading selesai agar tidak mendahuluinya.
  Maksimal3edit lalu teks masih memuat, dihapus setelah pekerjaan selesai/gagal.
  Gangguan animasi tidak menggagalkan hasil. Respons Telegram yang timeout tetap
  ambigu, bukan bukti pesan tidak pernah diterima; tanpa retry kirim otomatis.
- Pagination/stepper dan ringkasan konfirmasi dari tombol memperbarui pesan
  existing; input email teks tetap mendapat balasan baru, invoice/kredensial
  terpisah. Ringkasan memisahkan identitas, jumlah/harga/subtotal dan email masked
  dengan ruang kosong/judul tebal, bukan kolom monospace. Ikon tindakan tetap
  disertai teks; checkout/pilih jumlah bukan centang sukses. Guard finansial sama.

Tidak mengubah PIN/c1, Pedia, WA, supplier, merchant, env, schema atau cron.
Verifikasi menggunakan fixture/mocked transport, tanpa order/pesan produksi.

## PIN bersama kredensial, koreksi owner 28 Oktober 2026

✅ Implementasi lokal untuk publikasi CI. PIN enam karakter campuran huruf dan
angka diterima pembeli **hanya dalam email yang juga berisi kredensial produk**.
Kredensial tetap langsung terbaca dalam email. Tidak ada email PIN saat checkout
atau saat pembayaran diterima, PIN di respons web, kartu PIN, fragment tautan,
penyimpanan PIN browser, maupun pengiriman PIN dalam pesan Telegram.

Lacak kredensial pesanan baru memerlukan nomor invoice, email/WA checkout penuh,
dan PIN sebagai tiga isian terpisah. Kontak benar dengan PIN salah atau sebaliknya
sama-sama ditolak. Lacak status sebelum produk siap tetap dapat memakai invoice
+ kontak; PIN opsional pada form status, wajib ketika membuka kredensial. Sesi
status dari checkout tidak membuka kredensial dan tidak mengizinkan cancel/reissue.
Aksi tersebut tetap memakai kontak penuh dan pagar status pembayaran existing.
Pedia tidak mengirim akun/kredensial, sehingga status/refill tetap kontak penuh.

Koreksi lanjutan owner28Oktober: **di tab checkout Market asli, kredensial muncul
otomatis setelah pembayaran terverifikasi dan akun siap, tanpa memasukkan PIN**.
Bukti checkout terpisah dari sesi status, hanya terbit setelah quote asli yang
bertanda tangan cocok dengan order tersimpan. Berlaku tetap24jam di tab tersebut;
lookup kontak tidak dapat membuat bukti ini. Perangkat lain/lacak tanpa bukti
checkout tetap meminta invoice+kontak+PIN. Rotasi admin mencabut bukti lama.

Pembeli yang melacak mengisi PIN dari email, bukan mengambilnya dari web. Sesudah
kontak+PIN atau bukti checkout asli lolos, capability kuat hanya di sessionStorage dapat dipakai untuk akses ulang.
PIN tidak disimpan browser. Migrasi0083 mengikat capability PIN6 ke versi akses
setelah proof lengkap; token yang terbit di kebijakan lama tidak melewati aturan
baru. Legacy version0 tetap kontak; kode26 lama tetap kompatibel tanpa dipotong.

Batas PIN tetap10 gagal/in-flight per pesanan+versi/jendela15menit lintas IP,
diklaim sebelum membandingkan PIN dan kontak. Sukses hanya melepas slot sendiri.
Rotasi admin mencabut akses lama dan mengirim ulang **email kredensial lengkap
bersama PIN baru** bila order lunas dan kredensial tersedia. Antrean PIN awal lama
inert, metadata tidak dihapus. Bot WhatsApp nonaktif dan tidak diubah.
[Kontrak dan bukti](../issue/buyer-contact-pin-2026-10-28.md).

## Lapisan admin Cloudflare Access — 27 Oktober 2026

✅ Konfigurasi Access aktif; guard aplikasi diverifikasi lokal dan publikasi CI.
Login admin memakai email owner pada `ADMIN_EMAIL` dengan password existing.
Cloudflare lebih dahulu memeriksa PIN email dan MFA independent (Google
Authenticator/TOTP, security key atau biometrik). Hanya satu email owner yang
diizinkan. Pergantian email mencabut sesi aplikasi beremail lama.

UI `/admin` dan namespace API auth/admin dilindungi di apex/www/Pedia. API
campuran seperti produk/artikel membutuhkan sesi aplikasi **dan** JWT Access
untuk operasi admin; katalog, checkout pembeli, webhook dan bot tetap memakai
otorisasi masing-masing. Token Access saja tidak menggantikan password aplikasi.
Sesi Access/MFA8jam melapisi sesi aplikasi8jam dengan idle2jam. Saat Access perlu
diperbarui, alur auth mengarahkan navigasi penuh ke admin; gangguan verifikasi503
tidak menerbitkan/menyegarkan sesi. Manager lain tetap menolak operasi terlindungi
dan pembaruan Access tersedia dengan memuat ulang halaman admin.

Owner mendaftarkan Authenticator langsung di portal Cloudflare; QR dan kode
tidak diberikan kepada agent. Enrollment fisik dan login admin aktual harus
dikonfirmasi owner. Panduan pemulihan dan batas verifikasi:
[admin Access](../issue/admin-access-2026-10-27.md).

## Pemulihan timeout WR — 27 Oktober 2026

✅ Implementasi dan fixture lokal; publikasi melalui CI. Pembelian WR yang
timeout tidak dibeli ulang. Jika invoice belum tersimpan, admin memverifikasi
invoice di riwayat WR dan mengisi **Hubungkan invoice WR** pada Pesanan. Server
memeriksa transaksi, varian atau identitas katalog lengkap yang unik, jumlah,
modal snapshot, pembayaran serta kepemilikan invoice sebelum mengikat atomik.
Sesudah terikat, akun diteruskan lewat completion/outbox existing. Nama/waktu
saja tidak dipakai menebak invoice karena akun supplier juga bisa dipakai manual.
Riwayat WR hanya50 transaksi terakhir; invoice tidak tersedia/metadata berubah
tetap memerlukan pemeriksaan owner, bukan pembelian ulang.

Webhook terminal yang belum menemukan link mendapat respons retryable; order
yang sudah terminal tidak diturunkan oleh respons pembelian/error terlambat.
Kasus `AXV-20261027-2664E813` dipulihkan dengan invoice owner
`RBHN-20261027-3C99F5`; D1 membuktikan item/order delivered dan kredensial
tersimpan27Oktober14.36WIB, tanpa pembelian tambahan.

## Keamanan OWASP — 27 Oktober 2026

✅ Implementasi dengan verifikasi fixture, publikasi melalui CI. Editor detail
produk wajib sesi admin, termasuk pembacaan modal/draf. Checkout menolak harga
quote yang berubah, produk induk nonaktif atau varian berpindah produk pada batch
reservasi atomik; retry order tersimpan tetap dapat dipakai ketika stok habis.
Guard harga/produk induk aktif juga berlaku di Telegram/WhatsApp. Artikel publik
tidak membagikan email admin atau metadata review/idempotensi; konten terbit dan
sumber tetap tampil, penulis publik memakai AXVARA, editor admin tetap lengkap.
Permintaan terlalu besar ditolak413 sebelum parse, termasuk header ukuran palsu.
Header keamanan tetap dipasang pada halaman Pedia dan penolakan lintas origin.

Login admin: burst5/menit existing + D1 maksimal10 percobaan gagal/in-flight per
IP per jendela tetap15menit; limit429 menjelaskan waktu tunggu, error store503.
Sukses hanya mereset IP sendiri, bukan IP penyerang lain. Pembeli tidak memakai
limiter login. Shared NAT dapat berbagi batas; bot terdistribusi tetap residual.
Challenge password-proof publik baru tidak menyertakan email admin dalam JWT;
challenge lama bertanda tangan tetap berlaku sampai expiry5menit.
Event login dan otorisasi admin disimpan tanpa kredensial/kontak/token/IP mentah;
retensi30hari dengan cleanup bounded existing. Otorisasi tidak sama dengan bukti
mutasi berhasil; retensi console/alert operasional masih perlu verifikasi.
Laporan cakupan10 kategori dan batas bukti: [audit](../issue/owasp-audit-2026-10-27.md).
Pernyataan ini bukan sertifikasi OWASP atau jaminan tidak ada kerentanan.

## Pembatas checkout dan insiden order fiktif — 27 Oktober 2026

✅ Implementasi terverifikasi; publikasi melalui CI. Order baru Market dan
Pedia memakai kuota D1 bersama dalam jendela tetap15menit: maksimal5 per IP,
3 per WA dan3 per email. Respons saat batas tercapai adalah429 dengan
Retry-After sampai akhir jendela. Batas ini menahan pembuatan berulang dari
identitas yang sama; IP/proxy/kontak yang seluruhnya berganti tetap memerlukan
lapisan anti-bot tambahan. Pola nama/kontak berurutan merupakan indikasi otomasi,
bukan bukti semua request berasal dari satu IP.

Kuota diklaim sekali per quote secara atomik, termasuk retry paralel dan retry
setelah pergantian jendela. Order tersimpan selalu dipakai kembali. Error baca/
tulis limiter atau tabel belum tersedia menghentikan checkout baru dengan503
retryable sebelum reservasi stok/invoice; hanya dev tanpa D1 boleh bypass.
Klaim yang diikuti kegagalan stok/validasi atomik tetap memakan satu slot, namun
retry quote yang sama tidak memakan slot tambahan. Counter menyimpan HMAC-SHA256
berkunci secret server existing, tanpa IP/WA/email mentah. IP IPv6 dan email
dinormalisasi; batas IP bersama dapat memengaruhi pembeli dari kantor/NAT.

Limiter WAF/in-memory dan guard Telegram/WhatsApp existing tetap berlaku.
Cleanup existing menghapus maksimal200 klaim dan200 counter yang lebih tua
24jam per eksekusi housekeeping, tanpa cron/env baru. Riwayat order palsu
insiden ini dibersihkan hanya atas instruksi owner setelah backup dan pemeriksaan
belum dibayar, expiry serta tidak adanya proses supplier/fulfillment. Detail
operasional dan hasil ada di [laporan insiden](../issue/checkout-abuse-2026-10-27.md).

## Perbandingan layanan Pedia — 27 Oktober 2026

✅ Implementasi; publikasi melalui CI. [Spesifikasi UX 27 Oktober](pedia/purchase-ux-2026-10-27.md)
menggantikan susunan pemilihan layanan/detail versi20–22 Oktober. Daftar tetap
terbuka setelah memilih; nama, harga jumlah yang sama, wilayah, refill dan mulai
ditampilkan ringkas. Filter/urutan berada sebelum daftar; pilihan di luar filter
tetap terlihat dan tidak diganti otomatis. Deskripsi pilihan, ketentuan dan
ringkasan terbuka; panduan link berada pada tahap Target. Total dan tombol lanjut
berdekatan di desktop, sedangkan mobile memakai CTA dengan safe-area.

Draf jumlah/layanan/target/checklist/kontak disimpan terpisah per kebutuhan selama
halaman platform terbuka. Link awal hanya berlaku pada kebutuhan awal; mengganti
kebutuhan tidak membawa link profil ke postingan. Persetujuan dan quote tidak
disimpan dalam draf. Jumlah/layanan tetap dipilih eksplisit dan validasi,
persetujuan perubahan harga, penguncian retry ambigu, QRIS per order serta
penanganan manual tetap mengikuti kontrak existing.

## Kembali ke GoPay Merchant pribadi — 27 Oktober 2026

✅ Implementasi dan verifikasi fixture; rilis Pages melalui CI. Atas instruksi
owner, invoice baru kembali memakai GoPay Merchant **Axvara Digital**
(`G564039370`, NMID `ID1024342457479`, nomor `082135277434`). Identitas QR,
nomor merchant, outlet aktif, sesi dan akses baca mutasi telah diverifikasi;
tidak ada pembayaran/order supplier berbayar pada QA. Penyebab suspend terdahulu
belum diketahui dan perubahan ini tidak menjamin akun bebas pembatasan.

Pola reuse, expiry15menit, status otomatis dan callback terverifikasi mengikuti
referensi AutoGoPay, diimplementasikan pada server AXVARA sendiri. Tidak memakai
API/langganan AutoGoPay. QR dibuat lokal dari payload owner, satu invoice per
order; klik ulang memakai QR/nominal yang sama. Maksimal satu QR pengganti hanya
setelah QR lama kedaluwarsa dan order masih hidup, tanpa memperpanjang deadline.
GoPay yang tidak lengkap gagal tertutup; tidak mengalihkan uang ke merchant DANA.
Invoice KlikQRIS/DANA/GoPay lama tetap di provider dan merchant tersimpannya;
initializing KlikQRIS tidak diubah menjadi invoice GoPay baru.

Pemeriksaan mutasi dilakukan satu loop per server, minimal15detik dan melambat
menjadi30/60detik saat invoice terbaru berumur2/5menit; tidak ada query GoBiz
saat tidak ada invoice aktif. Tombol cek tidak mempercepat batas ini. Error
menjalankan backoff; sesi mati/penolakan akun/persistensi token gagal menjeda
akun untuk pemeriksaan manual. Callback wajib signature atas body mentah,
merchant/nominal/order/status settlement atau capture/waktu bayar yang cocok.
Data tidak lengkap, salah merchant/order atau terlambat tidak melunasi otomatis.
Paid tersimpan dahulu, pengiriman dilanjutkan background server/cron existing.

Koreksi29Oktober: pemeriksaan expiry sesi SDK mendahului pembacaan mutasi di
dalam gate merchant; sesi valid tidak memicu refresh tambahan. Kegagalan refresh
atau persist menghentikan pembacaan dan mengikuti pengaman existing. Rilis VPS
09:50UTC sudah terpasang dan24test fixture lulus. Refresh sesi201 terbukti;
pembayaran otomatis produksi belum terbukti karena tidak ada invoice aktif saat
verifikasi akhir. Tiga ACC manual yang dilaporkan owner tidak diproses ulang.

Referensi: [AutoGoPay webhook](https://autogopay.site/docs/webhook),
[generate QRIS](https://autogopay.site/docs/gopay/qris-generate), serta peringatan
dashboard owner27Oktober mengenai maksimal1–2generate per transaksi. Cadence
3/5/10detik AutoGoPay tidak disalin ke query langsung GoBiz AXVARA.

✅ Perbaikan GoPay VPS 25 Oktober: pembayaran gagal dilaporkan tidak lagi
dianggap selesai selama dua jam; poller menunggu ACK durable Pages dan mencoba
kembali lewat interval existing. Pemicu manual memakai antrean loop yang sama,
sehingga tidak menabrak sesi/ritme GoBiz. Invoice lama dan keputusan manual
unmatched tetap mengikuti kontrak existing.

## Pemulihan dan dispatch supplier setelah pembayaran — 25 Oktober 2026

✅ Implementasi; publikasi melalui CI. Setelah KlikQRIS terkonfirmasi paid,
pekerjaan pengiriman dipertahankan dalam konteks server Cloudflare sehingga
request status pembeli dapat selesai tanpa menunggu pembelian supplier/notifikasi.
Penutupan halaman atau timeout browser20detik tidak lagi memutus pekerjaan yang
sudah dijadwalkan. Paid, reservasi dan outbox tetap durable; cron existing menjadi
pemulihan bila tugas server terputus.

Item pengiriman dimaterialisasi dan diikat ke supplier sebelum fulfillment umum,
agar varian supplier bermode manual tidak diberi status serah-terima admin palsu.
Upaya segera terbatas satu link per supplier untuk order yang baru dibayar;
sisanya mengikuti antrean cron existing. Hasil pembelian ambigu tetap hanya
lookup referensi semula, tanpa pembelian ulang otomatis. Kegagalan lookup SK
kini dicatat pada error link admin tanpa membocorkan respons/kredensial supplier.


Respons5xx generik, receipt sukses tanpa ID pesanan/invoice, atau ref_id SK yang
tidak cocok diperlakukan ambigu dan tidak dibeli ulang otomatis. Penolakan
`PRODUCT_TEMPORARILY_UNAVAILABLE` SK yang eksplisit tetap boleh retry biasa.

## Aktivasi manual pasangan WR/SK — 25 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Produk yang dinonaktifkan manual
keluar dari pemilihan pemenang WR vs SK. Bila hanya SK aktif (contoh ChatGPT WR
OFF), SK menjadi wakil; berlaku sebaliknya untuk WR. Bila keduanya aktif, aturan
stok → modal → preferensi dalam margin tetap berlaku. Bila keduanya OFF, keduanya
tetap tidak dijual. Wakil aktif yang habis stok mengikuti tampilan stok habis;
pergantian wakil tidak menambah stok atau mengalihkan order yang sudah tersimpan.
Toggle admin menghitung ulang pasangan terkait sebelum memuat daftar; kegagalan
perhitungan dilanjutkan antrean cron existing. Katalog publik dapat tertinggal
hingga TTL cache existing (daftar Market30detik). Migrasi0078 mengantrekan ulang
keputusan lama, termasuk produk yang sudah OFF sebelum perbaikan.

## Notifikasi pembayaran WA pembeli KlikQRIS — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Invoice KlikQRIS baru mengirim
`whatsapp_buyer` dari nomor WA pembeli yang sudah tersimpan pada checkout Market
atau Pedia. Nomor08/+62/62 dinormalisasi menjadi62 tanpa plus, maksimal15digit.
Telegram/WhatsApp juga memakai nomor tersimpan jika tersedia; Telegram tanpa
nomor WA tetap dapat membayar dan tidak mendapat notifikasi WA dari fitur ini.
Kontak kosong/tidak valid/email/ID chat atau grup tidak dijadikan tujuan, tanpa
fallback nomor admin atau pengirim. Menambah nomor setelah invoice dibuat tidak
mengubah invoice tersebut; retry tetap memakai invoice lama.

KlikQRIS mengirim pesan sukses/kedaluwarsa sesuai template dashboard selama
langganan aktif dan WA pengirim tersambung. Owner mengonfirmasi koneksi pengirim
dan setting expired15menit melalui dashboard24Oktober; ini bukan bukti penerimaan
WA buyer end-to-end. Pesan pembayaran bukan janji produk selesai: paid dan
fulfillment tetap mengikuti validasi callback/API AXVARA. Tidak menambah pesan
pembayaran dari gateway AXVARA, cron, env atau mengubah notifikasi grup selesai.

## Siaran admin dan sambutan grup — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Menu **Konten → Siaran** menyediakan
pustaka maksimal200 template teks: nama internal, judul/subjek email, isi hingga
3000 karakter dan tombol tautan HTTPS opsional. Admin bisa membuat, mengedit,
menyalin, mengarsipkan/memulihkan dan memakai ulang template. Simpan tidak
mengirim. Pilih satu/beberapa tujuan → Tinjau jumlah → Kirim siaran sekarang.
Tujuan: satu grup WA AXVARA'S terverifikasi pada nomor bot aktif, subscriber email
berstatus active, dan pengguna pribadi Telegram terdaftar yang tidak diblokir
atau opt-out. Telegram hanya bisa menjangkau pengguna yang pernah membuka bot;
jumlah terdaftar bukan jaminan pesan diterima. Tidak mengirim DM WA.

Setiap kirim menyimpan salinan pesan dan daftar penerima; perubahan template dan
subscriber baru tidak mengubah siaran yang sudah mulai. Retry permintaan yang
belum terkonfirmasi memakai ID yang sama, termasuk sesudah refresh tab. Riwayat
menampilkan jumlah per kanal/status, refresh manual dan Hentikan untuk penerima
belum diproses; pesan sedang dikirim mungkin tetap diterima. Terkirim berarti
layanan pengirim menerima pesan, bukan bukti dibaca. Pengiriman bertahap melalui
cron existing, tanpa kirim otomatis ketika template disimpan atau jadwal baru.

Email dikirim per alamat, menyertakan tautan berhenti berlangganan. GET tautan
hanya menampilkan konfirmasi; POST menghentikan langganan. Daftar footer bisa
berlangganan lagi dengan token baru. Telegram `/stop` menghentikan siaran saja,
`/siaran_on` mengaktifkannya kembali; notifikasi pesanan tidak ikut dihentikan.
Status pelanggan diperiksa lagi sebelum pengiriman. Nomor/revisi/grup WA dibekukan
saat Tinjau; jika berubah, hentikan antrean lama dan tinjau siaran baru.

Sambutan WA kini hanya dari event **anggota ditambahkan/bergabung**, bukan sesi
pertama, chat, emoji, reaksi, stiker, promote atau remove. Bingkai garis dan judul
“🎉 SELAMAT DATANG DI AXVARA! 🎉” dipertahankan, sapaan Pagi/Siang/Sore/Malam WIB,
nama jika tersedia (fallback Kak), deskripsi “Tools & Apps premium, Optimasi Media
Sosial, Topup Games! 🚀”, lalu Order via website, Order via Telegram, Bantuan Admin.
Instruksi ketik list/garansi dihapus dari sambutan. Percakapan biasa tidak lagi
auto-search; perintah pencarian legacy harus `cari <produk>`, tetap mengikuti flag.
Commerce WA tetap mengikuti flag existing dan tidak diaktifkan oleh fitur ini.

## Notifikasi transaksi dan link komunitas terpusat — 24 Oktober 2026

✅ Diimplementasikan; publikasi CI, pengiriman WA mengikuti pairing/aktivasi owner.
Admin Pengaturan Toko menyediakan satu input link undangan WhatsApp untuk seluruh
tombol grup Footer Market/Pedia dan Link Bio. Simpan admin memperbarui konsumen
melalui settings bersama, tab lain saat storage/fokus/visibility, tanpa polling.
Hanya URL HTTPS chat.whatsapp.com yang valid; link publik tidak mengubah grup bot.

Grup AXVARA'S dari nomor bot pilihan admin (awal6283181632507) menerima hanya transaksi lunas/paid yang seluruh
unit apps delivered atau seluruh item Pedia completed. Pesan berjudul **PESANAN
BERHASIL DIPROSES - WEB/TELEGRAM/WHATSAPP**, memuat produk/varian/qty/harga/total
bayar/metode, referensi publik acak, nama inisial+***, status SELESAI dan waktu
selesai WIB. Tidak mengumumkan invoice asli, nomor/email/ID akun pembeli, target,
supplier, kredensial atau URL akses. Partial/canceled/proses/gagal tetap tidak
diumumkan sebagai sukses. Jam pembayaran dan jam selesai dibedakan.

Admin Telegram menerima status pembayaran/pesanan dan paid_at WIB; order-created
Telegram/WhatsApp memakai created_at WIB; supplier otomatis
yang belum punya link tetap proses otomatis, gagal otomatis meminta pemeriksaan,
produk manual tetap handover admin. Tombol **Lihat pesanan pembeli** membuka lacak
pesanan tanpa input invoice/kontak melalui sesi admin tervalidasi server, bukan
tautan publik bypass verifikasi. Sesi tidak valid harus masuk admin; akses pembeli
normal tetap memerlukan kontak/capability.

Kontrol admin WA: Hubungkan nomor bot, Cek koneksi, Aktifkan/Nonaktifkan. Aktivasi
hanya nomor dan grup terverifikasi. Pencarian mengenali AXVARA’S (apostrof
melengkung) dan AXVARA'S sebagai nama yang sama, dengan trim/NFKC/tanpa membedakan
kapitalisasi; nama ganda ditolak dan ID grup tersimpan tidak berpindah otomatis.
Bot yang sudah tersambung cukup Cek koneksi, tanpa pairing ulang.
Cutoff paid_at mencegah backfill sebelum
aktivasi. Antrean existing tetap durable saat nonaktif/offline, dilanjutkan dengan
batas operasional satu percobaan baru/60detik. Hasil kirim ambigu membutuhkan
pemeriksaan; jangan mengirim ulang buta. Baileys bukan layanan resmi dan tidak
menjamin bebas pembatasan. Tidak membuka DM/promosi massal atau membeli supplier
saat QA. Detail: `issue/whatsapp-sales-notifications-2026-10-24.md`.

✅ Ganti nomor bot — 24 Oktober 2026, publikasi melalui CI. Pengaturan Toko →
Ganti nomor bot menerima nomor internasional atau08 Indonesia, tanpa edit kode/env
atau deploy berikutnya. Nomor admin toko terpisah. Menyimpan nomor berbeda menjeda
notifikasi sebelum memutus sesi lama; pilihannya tersimpan di gateway dan bertahan
saat restart. Owner menghubungkan nomor baru, memastikan keanggotaan/izin pada grup
tujuan yang sama, lalu mengaktifkan kembali. Tidak ada rotasi nomor otomatis.
Riwayat sent/unknown, ID grup dan cooldown tidak dihapus; pending yang pasti belum
terkirim dilanjutkan setelah aktivasi. Permintaan tab lama ditolak meski nomor
dikembalikan ke nomor semula. Timeout pergantian harus dicek statusnya dahulu;
panel membaca nomor aktual dan menghapus kode pairing lama. Nomor produksi tidak
diganti ketika QA.

## Carousel info storefront — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Semua banner aktif yang tidak disembunyikan
menjadi satu popup di beranda, mengikuti urutan admin. Pengunjung dapat memakai panah,
keyboard atau geser horizontal; putar otomatis default6detik, berhenti
saat interaksi/fokus, hover dan tab tersembunyi. Preferensi kurangi gerakan memakai
pergantian langsung/manual. Tidak menghalangi checkout/admin atau membuka popup
berikutnya ketika modal ditutup. Batas sesi dihitung sekali per pembukaan, bukan per
slide. Jangan tampilkan lagi menyembunyikan info aktif24jam dan meneruskan ke tetangga;
ketika semua disembunyikan modal ditutup. Key hide lama dipertahankan.

Revisi layout screenshot owner24Oktober: gambar penuh dari tepi ke tepi, rasio asli
tanpa crop atau padding samping; panah overlay pada gambar, counter1/2 di bawahnya.
Judul/deskripsi rata tengah pada panel putih tanpa garis pemisah. Judul tidak
menyisakan tinggi minimum; deskripsi mengikuti8px setelah teks judul. Checkbox
Jangan tampilkan lagi di atas tombol biru lebar di tengah; fallback Saya Paham jika CTA
belum diisi. Pada batas manual hanya panah ke slide tetangga yang tersedia.
Tidak ada tombol Putar/Jeda sesuai screenshot/keputusan owner; interaksi manual
atau fokus menghentikan putaran sampai popup ditutup, tanpa kontrol lanjutkan.
Pergantian info melebur dengan blur tipis2px selama420ms dan geseran pendek12px.
Info lama tetap terlihat sampai gambar berikutnya siap; perubahan tinggi kartu halus.
Klik cepat menuju pilihan terakhir tanpa memotong transisi berjalan. Mode kurangi
gerakan tetap berpindah langsung tanpa blur/animasi atau putaran otomatis.

Admin mengatur jeda buka0–10detik(default1,5), interval4–20detik(default6), otomatis
on/off dan maksimal1–10pembukaan per sesi(default1) pada satu panel bersama. Isi/CTA/
gambar/aktif per banner terpisah. Pegangan drag, keyboard dan naik/turun menyimpan
urutan langsung; banner baru selalu di akhir, hapus merapatkan posisi. Edit isi dari
tab lama tidak menggeser urutan. Konflik daftar ditolak dan dimuat ulang. Ini mengganti
aturan satu banner pertama, angka urutan/delay/maks sesi per banner pada bagian lama.


## Perbaikan audit dan kebijakan Pedia — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Pedia memakai QRIS per order tanpa
saldo pembeli, kode kredit atau refund otomatis. Supplier partial/canceled
membuka tindak lanjut manual admin; jumlah tak terkonfirmasi tidak dianggap nol.
Riwayat lama dan nominal retry tetap dihormati. [Kebijakan lengkap](pedia/manual-resolution-2026-10-24.md)
menggantikan aturan kredit/deposit pada versi Pedia terdahulu di dokumen ini.

Pengambilan akun mewajibkan WA penuh/email checkout atau capability, dengan
pembatasan kegagalan durable per order+client. Status Pedia memverifikasi kontak.
Konfirmasi Telegram bersamaan menghasilkan satu pending order/invoice aktif per
chat; kegagalan klaim update menghentikan handler, /batal hanya membatalkan input.
Lacak mengikuti progres seluruh akun, satu request aktif, jeda lima detik,
pause hidden dan backoff 429. Riwayat kontak lookup tersimpan maksimal tujuh hari.
Checkout mempertahankan identitas produk+varian pada koreksi minimum; stok cart
mengikuti stok efektif. Filter admin hanya menampilkan respons terbaru dan halaman
URL dipertahankan; statistik/filter global boleh tertinggal singkat sesuai TTL cache.


## Tautan komunitas — 23 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Footer dan halaman link memakai
[grup WhatsApp baru](https://chat.whatsapp.com/DHgtU7q39TlCV6ToZ4JU39?mode=gi_t),
Sejak24Oktober URL aktif berasal dari Pengaturan Toko `whatsapp_group_url`;
`WA_GROUP_HREF` di `src/lib/site.ts` hanya fallback.


## Pembelian beberapa kredensial unik — 23 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Web dan Telegram mendukung total
maksimal sepuluh unit stok unik per pesanan, termasuk beberapa varian,
mengikuti stok efektif dan minimum pembelian. Pembeli tetap melihat satu
baris produk ×jumlah, satu order dan satu invoice. Reservasi seluruh unit
mengikuti urutan stok admin dalam batch atomik; kekurangan satu unit
membatalkan seluruh batch sebelum invoice. Retry checkout memakai order lama.

Setiap akun memiliki item pengiriman, ikatan inventory, snapshot terenkripsi,
lease dan retry sendiri. Unit yang sudah terkirim tidak dikirim ulang; unit
yang gagal mempertahankan inventory yang sama. Pembatalan/expiry pending
melepaskan seluruh reservasi dan mengembalikan qty stok sekali. Akun diberi
nomor, tombol salin per akun, progres “2 dari 3 akun siap”, dan panduan identik
cukup sekali di panel. Pengiriman web memakai email per unit agar kegagalan
satu email tidak mengulang unit lain; tanda terima menampilkan baris belanja
aslinya. Pesanan lama mempertahankan interpretasi sebelumnya. Alur WA existing
masih satu unit dan kill-switch DM tidak diubah. [Kontrak unit](UNIQUE-UNITS.md).

## Workers Paid: pembayaran dan pengiriman cepat — 23 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Webhook tetap jalur utama untuk
konfirmasi pembayaran dan pengiriman seketika. Cron existing berjalan setiap
menit untuk cadangan KlikQRIS tanpa halaman pembeli terbuka, expiry,
fulfillment, WR/SK, Pedia dan notifikasi. Pemeriksaan KlikQRIS hanya GET invoice
pending yang masih berlaku, maksimal empat per tick, berbagi klaim atomik
dengan polling halaman; gagal konfirmasi tetap pending. Batas bayar 15 menit,
penanganan late payment manual dan larangan pembelian ulang ambigu tetap.

Pedia memeriksa supplier setiap menit selama 15 menit pertama, lalu dua menit
hingga umur satu jam dan lima menit sesudahnya; kegagalan status diberi jeda
lima menit. Status halaman terlihat diperbarui lima detik saat menunggu bayar,
sepuluh detik ketika diproses, dan segera setelah tab kembali terlihat.
Terminal/needs_check berhenti polling. Katalog tetap mengikuti diff VPS dan
sweep hourly; cleanup/publikasi artikel tetap lima menitan. Ini target latensi
pemicu, bukan janji waktu selesai supplier atau email.

Monitor membaca paket dan periode tagihan aktual: Paid memakai jatah D1
bulanan, Free memakai batas harian. Rincian biaya, batas kerja dan rollback:
[operasional Paid](PAID-OPERATIONS.md).


## Penyederhanaan pilihan layanan Pedia — 22 Oktober 2026

Revisi chip layanan Pedia 2 November 2026 (implementasi lokal untuk publikasi CI): chip informasi tetap netral, karena warna hanya untuk Refill (cyan), drop, dan success rate. Teks region/Start naik ke white/85, No Refill ke white/75. Indonesia memakai ikon pin lokasi, Global bola dunia. Tanpa data waktu, chip Start disembunyikan (tidak lagi "Start mengikuti antrean").

Revisi judul daftar layanan Pedia 3 November 2026 (implementasi lokal untuk publikasi CI): hitungan hasil pindah ke baris judul secara redup — "Pilih layanan · 11 layanan", saat filter aktif "· 4 dari 11 layanan" diikuti Reset filter; "· harga untuk N" dan "Kembali ke pilihan" di baris yang sama. Filter Semua/Global/Indonesia/Refill/No Refill tetap di kanan judul (desktop) dan di bawah judul (mobile). Teks "Harga acuan ditampilkan per layanan…" dihapus. Menggantikan "Hitungan … dan Reset filter berada di atas daftar" (1 November) yang dulunya baris terpisah.

Revisi nama layanan Pedia 2 November 2026 (implementasi lokal untuk publikasi CI): nama seragam [Metrik] [Wilayah] [Kualitas], mis. Followers Indonesia Real, Likes Post Global HQ, Views Reels Global; keterangan bermakna (durasi Live, Referrer, Akun berpostingan) ditambahkan sesudah "·". Refill/No Refill dan drop hanya chip; "Ekonomis", "Max N", "Mulai N" dihapus; nama kembar tidak lagi diberi akhiran refill. Migrasi0089 (generator `scripts/curate-pedia-names-20261102.py`, manifest `src/lib/pedia/names-20261102.json`) mengganti nama dengan guard nama lama dan menonaktifkan layanan kembar: satu per (wilayah, masa refill, kualitas, keterangan), pemenang success rate terukur → jumlah order → modal termurah; 431→280 layanan aktif. Produk komentar menampilkan harga nyata untuk 10 komentar (`price_ref`, rumus quote) alih-alih per 1.000. Harga kartu lain tetap per 1.000: harga 100 unit terkena minimum order Rp1.000 pada 156 dari 408 layanan sehingga tidak bisa dibandingkan.

Revisi filter layanan Pedia 1 November 2026 (implementasi lokal untuk publikasi CI): filter kini Semua/Global/Indonesia/Refill/No Refill. Pilihan layanan yang tidak termasuk filter baru dilepas, tanpa disematkan di atas daftar; teks "Pilihanmu tetap disimpan di atas…" dihapus. Hitungan "N dari M layanan" dan Reset filter berada di atas daftar. Menggantikan aturan 22 Oktober "pemilihan kategori tidak mengganti layanan" dan "hitungan sesudah daftar", serta "pilihan aktif tetap terlihat saat difilter" 27 Oktober.

✅ Implementasi; publikasi melalui CI. Koreksi owner22 Oktober: judul “Apa yang ingin ditingkatkan?” kembali ke ukuran24px/bold semula tanpa garis cyan. Yang diperkecil adalah pill kebutuhan Followers/Likes/dll: tinggi32px, teks12px, ikon13px dan padding12px; permukaan gradasi halus dengan highlight inset, pilihan aktif cyan/violet dan glow tipis. Gulir horizontal serta fokus keyboard tetap, scrollbar visual disembunyikan. Label tombol jumlah memakai `k` kecil untuk ribuan (`1k`, `2k`, `2.5k`); angka di bawah 1.000 tetap utuh, nilai input/perhitungan serta teks batas dan harga memakai angka aslinya. Pengantar panjang jumlah dihapus; batas tampil sesuai min/max layanan terpilih (“Layanan terpilih menerima 100–50.000 per pesanan.”), termasuk kelipatan bila perlu; sebelum memilih layanan ada petunjuk singkat tanpa angka asumsi. “Pilih layanan · harga untuk …” berada di kiri dan filter ringkas di kanan saat muat, bertumpuk pada mobile. Kategori **Semua/Global/Indonesia/Refill** memakai satu state eksklusif: tepat satu pill aktif, klik pill aktif mempertahankannya; Refill berarti semua wilayah dengan refill>0. Pemilihan kategori tidak mengganti layanan atau jumlah. Hitungan hasil, Reset filter dan pengaturan jenis akun/urutan berada sesudah daftar. Beranda, data katalog, validasi batas, quote/consent/retry dan pembayaran tetap.

Tipografi harga 22 Oktober mengikuti AXVARA pusat: harga kartu/daftar layanan Inter bold 700, 14px mobile/17px mulai sm, tracking −0.02em dan line-height 1 tanpa tabular-nums; total ringkasan Space Grotesk bold 700/18px, total ringkas mobile 14px; nominal QRIS/pembayaran diterima Space Grotesk bold 700/24px dengan kelas `leading-8`; line-height aktual mengikuti `.font-display` global seperti pusat. Acuan aktual: ProductCard storefront, total checkout pusat dan nominal QRIS pusat. Ini menggantikan ukuran harga pada redesain 20 Oktober; susunan beranda/checkout, nominal dan format jumlah tetap.


## Galeri foto produk — 21 Oktober 2026

✅ Implementasi; publikasi melalui CI. Foto pertama tetap menjadi thumbnail/cover
produk. Upload foto kedua dan seterusnya mempertahankan rasio asli tanpa crop
(WebP, sisi terpanjang maksimal 1920 px); galeri detail menampilkan gambar
utuh dengan tinggi mengikuti rasio asli, termasuk screenshot portrait dan
landscape. Preview foto tambahan di admin dan strip thumbnail juga tampil utuh.
Aturan berlaku untuk semua produk. Foto yang sudah dipotong oleh upload lama
perlu diunggah ulang dari gambar asli; mengubah tampilan tidak memulihkan
bagian gambar yang sudah hilang.

## Salinan produk Muse AI — 21 Oktober 2026

Revisi 23 Oktober 2026 ✅ live: pengantar deskripsi menjelaskan Muse sebagai AI agent
otonom dari Meta, satu ekosistem dengan WhatsApp, Instagram, Threads, dan
Facebook. Manfaat promosi/konten dicontohkan lewat riset ide, caption, materi
promosi, dan kalender konten; tidak menjanjikan hasil promosi atau akses
semua platform otomatis. Patch katalog khusus deskripsi:
[salinan Meta](../issue/muse-ai-meta-copy-2026-10-23.md).

✅ Live: produk manual `muse-ai-1-miliar-token` Rp16.000 memakai deskripsi,
S&K, dan cara penggunaan bersama per varian sesuai format Market. Penawaran
1 miliar token tambahan pada akun yang dapat tetap berlabel Free plan, bukan
janji paket berbayar/unlimited/lifetime. Komputer virtual, browser, WhatsApp
native, konektor, coding/riset/analisis/konten dan penjadwalan dijelaskan
dengan batas kuota, otorisasi, serta ketersediaan layanan. Spesifikasi
2 vCPU/RAM sekitar 7,7 GB/storage 100 GB adalah referensi informasi akun
owner yang dapat berbeda, bukan kapasitas terjamin untuk semua akun.
Pembeli menerima email dan web OTP, lalu mengganti serta memverifikasi email
pribadi sebelum keluar. Garansi mengikuti varian existing tanpa garansi.
Dasar bukti dan teks penerapan: [salinan Muse](../issue/muse-ai-copy-2026-10-21.md).
Revisi owner pada hari yang sama: copy publik diringkas menjadi pengantar
dan lima keunggulan, lima poin S&K, serta empat langkah login OTP/ganti email.

## Redesain alur pembelian Pedia — 20 Oktober 2026

✅ Implementasi; publikasi melalui CI. Keputusan owner: **beranda tetap seperti sebelumnya, tanpa jalan pintas**. Sesudah klik layanan/platform, konfigurator mengikuti referensi “Redesign SMM Panel Purchase Flow”: **Layanan → Target → Kontak → Bayar**. Kebutuhan pertama langsung terbuka (deep link mengikuti slug); jumlah/layanan tetap dipilih eksplisit. Tab kebutuhan berikon, perbandingan layanan tetap terbuka, validasi per tahap, ringkasan desktop340px, CTA di dasar panel desktop/fixed mobile dengan safe-area. Link dan checklist produk berada di tahap Target; WA/email, kredit dan consent di tahap Kontak. Kembali mempertahankan isian produk yang sama, tanpa melewati tahap mendatang; setelah POST ambigu semua navigasi langkah terkunci. Preview admin embedded tetap tanpa request harga/order atau kontak.

Halaman pesanan memakai timeline vertikal + progres server dan panel QRIS di kanan desktop/atas mobile (container1000px, rail380px, QR240px), countdown deadline, Simpan QRIS/Cek pembayaran, serta Pesan lagi pada status terminal. Partial/kredit/refill/needs_check dan snapshot lama tetap dilayani. QR/nominal/status berasal dari server, tanpa simulasi atau reset expiry. Kontrak API, quote/consent/retry, supplier IndoSMM untuk order baru, env/cron/ledger tidak berubah. Spesifikasi [redesain pembelian](pedia/purchase-flow-redesign-2026-10-20.md) menggantikan bagian UI checkout/status versi15–19 Oktober di bawah; desain beranda existing dipertahankan.


## Pedia IndoSMM untuk penjualan baru — 20 Oktober 2026

✅ Implementasi; publikasi melalui CI. IndoSMM menjadi supplier tunggal untuk katalog/harga/quote/order baru dan kurasi admin. ProviderSMM dipertahankan untuk retry checkout tersimpan, dispatch/status/refill/recovery historis; quote lama tanpa order perlu memilih ulang sebelum debit/reservasi/invoice. Migrasi 0073 menonaktifkan penjualan ProviderSMM, menambah 53 kebutuhan/61 mapping IndoSMM (termasuk tujuh pengganti) dan 18 platform; owner drafts serta snapshot order lama dipertahankan. Produk premium supplier Canva/Gemini/CapCut dikecualikan. API/description review belum membuktikan kualitas; tanpa order berbayar. Spesifikasi terkini: [IndoSMM 20 Oktober](pedia/indosmm-only-2026-10-20.md).


## Permintaan data sesuai kebutuhan — 2026-10-19

✅ Implementasi; publikasi melalui CI. Admin memuat katalog produk/kategori
editor ketika masuk menu Produk, termasuk tautan langsung/back/forward; kembali
ke Produk mengambil data baru. Menu lain tidak memuat katalog ini. Loading,
retry, penyuntingan dan pembacaan sesi tetap berlaku; error katalog hanya tampil
di menu Produk.

Halaman pesanan Market menunda polling pembayaran dan pengiriman ketika tab
tersembunyi. Saat kembali terlihat, cek status segera memakai GET biasa selama
polling masih aktif, tanpa `wake=1` atau penerbitan QR baru. Interval terlihat
5 detik untuk QR dinamis/30 detik lainnya tetap; polling pengiriman mempertahankan
urutan cepat/lambat dan jatah percobaan existing. Waktu tersembunyi tidak memakai
atau mengulang jatah tersebut. Request yang sudah berjalan boleh selesai;
webhook/cron/expiry/email tetap bekerja tanpa halaman terbuka.

## Drag kredensial dengan pratinjau gerak — 2026-10-23

✅ Diimplementasikan; publikasi melalui CI. Saat kredensial ditarik, kartu penuh mengambang mengikuti tarikan dan baris lain beranimasi memberi ruang. Slot tujuan bergaris cyan dan menampilkan “Lepas di urutan …” sebelum dilepas. Menahan tarikan di tepi atas/bawah menggulir daftar kredensial otomatis tanpa menggeser halaman/modal. Pointer/touch memakai pegangan, keyboard memakai Spasi + panah; Escape membatalkan. Gerakan menghormati prefers-reduced-motion. Tidak ada penulisan urutan selama hover; simpan sekali setelah drop melalui kontrak reorder existing.

## Prioritas stok kredensial pribadi — 2026-10-23

✅ Diimplementasikan; publikasi melalui CI. Editor produk → Varian → stok kredensial unik menyediakan pegangan drag & drop serta tombol naik/turun. Kredensial terakhir pada daftar dapat ditarik langsung ke posisi pertama; nomor posisi menunjukkan urutan pengiriman, perubahan langsung tersimpan tanpa menunggu Simpan Produk. Urutan berlaku untuk reservasi pesanan baru di web/Telegram/WhatsApp. Unit yang sudah dipesan/terkirim tidak dipindahkan; perubahan stok bersamaan meminta muat ulang. FIFO lama tetap default dan impor baru masuk di belakang antrean. Daftar mengikuti batas existing 100 kredensial tersedia per varian.

## Pemulihan pengiriman SK yang kehilangan invoice — 2026-10-23

✅ Diimplementasikan; publikasi melalui CI. Transaksi supplier yang sudah menerima pembelian tidak boleh tertahan selamanya di “Sedang dikirim ke supplier” ketika invocation terputus sebelum menyimpan invoice. Webhook bertanda tangan mengikat invoice melalui referensi pembelian yang tetap sebelum menerapkan status; respons pemesanan terlambat tidak menurunkan status yang sudah maju. Cron existing memulihkan klaim terkirim yang lease-nya habis dan transaksi ambigu yang due dengan GET referensi yang sama, menyimpan invoice sebelum menyelesaikan pengiriman, tanpa pembelian ulang. Pembacaan gagal tetap ambigu dan diberi jeda satu menit; maksimal tiga kandidat per tick dengan budget existing. Halaman pesanan dan lacak juga menarik status melalui referensi asli walaupun invoice hilang, dengan gerbang existing 20 detik/order; GET ini tidak perlu menunggu lease atau tick cron. Item bertanda penyerahan manual tetap dipertahankan dan tidak dikirim ulang oleh pemulihan supplier.

## Keandalan antrean Sekalipay — 2026-10-19

✅ Diimplementasikan; publikasi melalui CI. Order SK auto yang sudah lunas diproses oleh cron existing tanpa membutuhkan Retry admin. Antrean siap beli didahulukan sebelum pemulihan order tanpa link; pemulihan mencari order layak yang benar-benar kehilangan link, termasuk yang tertutup banyak riwayat selesai. Maksimal empat upaya pembelian per tick; link yang dipulihkan langsung diproses bila belum ada upaya pembelian pada tick tersebut, selebihnya tetap due untuk tick berikutnya. Kehabisan budget dilaporkan sebagai pekerjaan tertunda, bukan antrean kosong. Retry/backoff, klaim/idempotensi, penanganan saldo/hasil ambigu dan pengiriman lewat webhook/status supplier tetap berlaku; order yang sudah selesai tidak dibeli ulang.

## Dispatch Sekalipay seketika pasca-lunas KlikQRIS — 2026-10-22

✅ Diimplementasikan; publikasi melalui CI. Bukti produksi: order SK yang dibayar lewat KlikQRIS tidak pernah gagal dibeli (`attempt_count=1`, nol `last_error`) tetapi duduk `pending` 25–228 detik menunggu tick cron 5 menit, sehingga tampak "harus Retry manual dulu baru jalan" (Retry admin memang memanggil prosesor seketika). Akar: sejak migrasi rail ke KlikQRIS (18 Okt), jalur lunas hanya membuat link WR/SK tanpa memanggil prosesornya — tidak seperti webhook DANA/GoPay. Kini pelunasan KlikQRIS langsung memproses link WR/SK yang baru dibuat bila auto-order aktif, persis jalur Retry/DANA/GoPay; cron lite tetap penjamin dan callback duplikat tidak membeli ulang.

## Pedia dan loading — 19 Oktober 2026

✅ Implementasi; publikasi melalui CI. Loading mempertahankan logo dengan ring cyan yang berputar mengitarinya serta pulse halus mengikuti referensi ISTA AI; reduced motion dihormati. Kebutuhan memakai ikon semantik. Order dimulai dari jumlah sebelum membandingkan/pilih layanan, dengan total pada jumlah sama, filter yang mudah dijangkau, copy pembeda sebelum pilihan, dan link/persyaratan berdekatan. Kontak tetap tahap kedua; quote, consent dan retry tetap.

Perluasan terkurasi menambah 17 kebutuhan/23 mapping (kapasitas 55/154 di 16 platform); aktivasi mengikuti mirror/batas/refill API. Supplier tetap ProviderSMM/IndoSMM, tanpa SMM Sekalipay. Tab Kurasi admin menyaring kandidat pada jumlah sama dan membuat draf nonaktif tanpa janji refill untuk ditinjau owner. Rincian dan batas bukti: [spesifikasi 19 Oktober](pedia/catalog-ux-2026-10-19.md). UI/spec konfigurator 16 Oktober di bawah adalah riwayat yang digantikan. Kualitas hasil belum diuji berbayar; usulan saldo awal Rp50.000 + Rp100.000 terdapat di [rencana sampling](pedia/quality-sampling-2026-10-19.md).

## QRIS KlikQRIS — 2026-10-18

Deteksi lunas cepat 2026-10-18 ✅ diimplementasikan, publikasi melalui CI:
halaman pesanan yang sedang menunggu kini mengonfirmasi pembayaran KlikQRIS
tanpa menunggu callback gateway (teramati ±28 detik sesudah bayar). Polling
Market/Pedia memicu pemeriksaan status gateway maksimal sekali per ±10 detik
per pesanan lewat klaim atomik; polling selebihnya tetap membaca status lokal,
dan tombol cek manual tetap memeriksa seketika. Target deteksi ≤15 detik saat halaman terlihat
sesudah pembayaran terkonfirmasi gateway; tab tersembunyi menyusul saat dibuka
kembali (revisi 2026-10-19). Teks "Batas bayar otomatis 15 menit…"
di bawah QR halaman pembayaran Market/Pedia dihapus atas keputusan owner;
batas 15 menit, countdown, dan penanganan pembayaran terlambat tidak berubah.

Koreksi checkout 2026-10-18 ✅ diimplementasikan, publikasi melalui CI: koneksi
API dan PNG QR memakai mode redirect yang kompatibel dengan runtime Cloudflare,
tetap menolak redirect. Retry checkout dengan quote sama melanjutkan invoice
KlikQRIS yang sudah ada, termasuk ketika stok terakhir sudah direservasi; tidak
membuat order/reservasi/tagihan kedua. Bila QR belum siap, halaman pesanan
menampilkan **QRIS belum siap** dan tombol **Coba siapkan QRIS**, tanpa arahan
verifikasi bukti manual. Tombol itu memulihkan invoice lewat GET ID yang sama;
polling biasa tetap hanya membaca status lokal. Invoice yang tidak ditemukan
di gateway tetap ditahan untuk cleanup/review, tanpa mengulang POST ambigu.

✅ Diimplementasikan, publikasi melalui CI. Invoice baru Market, Pedia, Telegram (satuan/keranjang), dan bot WA memakai **PG KlikQRIS/in-house** bila `QRIS_ACTIVE_PROVIDER=klikqris`. Bukan MY PG/sandbox. Pemesanan otomatis dibuka kembali lewat build `NEXT_PUBLIC_PAYMENTS_MAINTENANCE=false`; switch maintenance tetap tersedia untuk recovery.

Nominal bayar persis `total_amount` gateway, termasuk kode unik dari provider; tidak menambah kode lokal kedua. Keputusan owner: **batas bayar AXVARA tetap 15 menit**. Invoice uji18Oktober berlaku60menit; owner mengonfirmasi setting dashboard gateway juga15menit pada24Oktober. Deadline order/ledger adalah yang paling awal antara deadline AXVARA yang sudah ada, 15 menit, dan expiry gateway; retry tidak memperpanjangnya. Semua kanal menjelaskan: lewat batas, jangan membayar QR lama; jika terlanjur, hubungi admin. Pembayaran terlambat/cancel/expiry yang sudah dikonfirmasi KlikQRIS tercatat di Rekonsiliasi dan diberitahukan ke admin sekali per event, tanpa menghidupkan order, memotong stok lagi, atau mengirim produk otomatis. Admin meninjau stok/dana untuk penyelesaian manual; tidak ada refund/pelunasan paksa otomatis.

Callback per invoice memvalidasi signature tersimpan, order/merchant/nominal dan konfirmasi status API server. Gagal konfirmasi tidak dianggap lunas. Transisi paid, event dan outbox Market atomik; Pedia memakai antreannya sendiri, tidak mengirim produk Market dengan ID sama. Callback duplikat tidak mengulang fulfillment. POST create hanya oleh pemenang klaim ledger durable; timeout/panggilan ambigu dipulihkan melalui GET status dengan order ID sama, tanpa membuat tagihan atau memindahkan provider otomatis. Stok order in-flight tetap direservasi, cleanup lama menjadi penjamin.

Invoice DANA/GoPay lama tetap di rail asalnya; webhook/secret/poller lama dipertahankan. QR gateway ditampilkan lewat proxy PNG same-origin yang dibatasi host/ukuran/redirect, tanpa Snap JS atau signature di browser. Callback adalah authority utama; tombol Cek pembayaran/Periksa pembayaran dapat mengonfirmasi lewat API provider. Polling halaman menumpang reconcile ter-throttle ±10 detik/order (2026-10-18); tidak ada cron/polling gateway baru.

## Maintenance pembayaran — 2026-10-18

✅ Switch diimplementasikan untuk penghentian pembayaran sementara. Pada rilis KlikQRIS 2026-10-18 nilainya `false`; perilaku berikut berlaku ketika switch diaktifkan kembali. Katalog Market/Pedia tetap dapat dibuka; banner di kedua layanan dan panel checkout mengarahkan pembeli ke **Order manual via WhatsApp**, melalui hub `/wa` dengan pesan terisi. Tidak menjanjikan jam selesai atau reset otomatis.

`/start`, tombol home dan percobaan bayar/perpanjang QRIS di Telegram memberi pemberitahuan serta tombol WA; katalog dan Pesanan saya tetap tersedia. Bot grup WA juga menolak pembayaran otomatis dengan tautan admin. Penolakan server sebelum membuat order, memotong stok/kredit atau menulis invoice berlaku pada checkout Market/Pedia dan reissue, termasuk akses langsung. Invoice dan order lama tidak dihapus: webhook merchant, pelacakan, pengiriman dan cleanup kedaluwarsa tetap berjalan. Pembeli yang sudah membayar diminta menyimpan bukti dan menghubungi admin dengan kode pesanan. Tidak ada siaran massal otomatis.

Pengaktifan/pemulihan memakai switch build publik `NEXT_PUBLIC_PAYMENTS_MAINTENANCE` di langkah build CI; `true` = maintenance, `false`/tidak diset = alur biasa. Perubahan membutuhkan build dan push baru, terpisah dari maintenance kuota D1.

## Pembaruan Pedia 2026-10-15 — spesifikasi terkini

Revisi konfigurator 2026-10-16 ✅ implementasi, publikasi melalui CI: halaman platform dimulai dari kartu kebutuhan tanpa jenis/paket/jumlah otomatis. Setelah jenis dipilih, tiga layanan awal tersedia pada semua ukuran, lalu layanan terpilih diringkas dengan aksi Ganti. Jumlah → link → persyaratan berdekatan; detail panjang terlipat setelah input, sementara informasi drop/refill tetap terlihat. Kontak & konfirmasi tetap tahap kedua, kembali mempertahankan isian. Harga alternatif memakai jumlah yang sama; batas/kelipatan tidak cocok ditandai dan harga minimum tidak menggantikan total yang belum tersedia. Header/ringkasan mengikuti identitas platform; ringkasan awal berisi petunjuk singkat. Kontrak harga, quote, kredit, pembayaran, supplier dan beranda tetap.

✅ Implementasi katalog per platform, perluasan dua supplier dan checkout dua tahap tersedia di kode; publikasi melalui push/CI. Spesifikasi serta dasar kurasi lengkap: [Katalog dan checkout Pedia](pedia/catalog-checkout-2026-10-15.md). Bagian berlabel Working-Tree 2026-10-12 di bawah adalah snapshot historis; aturan UI/katalog/checkout terkini mengikuti dokumen rilis ini.

Revisi 2026-10-16: beranda Pedia menampilkan kartu AXVARA Market dan Bot Telegram tepat setelah hero, sebelum katalog platform, pada mobile dan desktop.

Revisi katalog 2026-10-16: teks pengantar di bawah “Pilih platform” dihapus. Pill kategori mengikuti Market (24px mobile/36px mulai `sm`, ikon iOS monokrom, aktif putih/nonaktif glass). Marketplace menampung Shopee, terpisah dari Media sosial. Semua kartu platform memakai logo SVG responsif 48px di mobile/80px mulai `sm` di tengah panel gradasi gelap warna brand seperti GitHub/Website Traffic, membedakan visual Pedia dari tile 3D Market. Berlaku di beranda dan `/pedia/layanan`; gambar legacy R2 di kontrak produk tidak dipakai oleh `PlatformCatalog`.

Revisi skala 2026-10-16 ✅ implementasi, publikasi melalui CI: hero Pedia mengikuti skala Market dengan headline mobile `clamp(32px,9.3vw,40px)` (sekitar 36px pada 390px), tablet 56px dan laptop/desktop `clamp(48px,4.85vw,62px)` agar kolom orbit tetap muat. Container tetap 1280px; padding hero 40/56px atas dan 16px bawah, CTA berjarak 24px dari subjudul, promo tepat sesudah hero dan katalog ber-padding atas 8px. Katalog platform beranda serta `/pedia/layanan` memakai panel 4:3, grid dua kolom sampai tablet/empat mulai 1024px, gap 12px mobile/20px mulai `sm`, radius kartu 16/22px, judul 16/18px dan deskripsi/CTA 12/14px. Orbit tetap hanya desktop; ukuran SVG memakai `PlatformIcon.className` opsional, tanpa perubahan kontrak API, aset atau env produksi.

Revisi animasi desktop 2026-10-16 ✅ implementasi, publikasi melalui CI: layout Pedia memakai `Spotlight` yang sama dengan Market (glow putih/cyan mengikuti cursor), dan beranda Pedia memakai `ScrollRope` yang sama (panjang mengikuti progres scroll, ayunan saat hover/klik). Hook bersama `useDesktopMotion` mengaktifkan keduanya hanya pada lebar ≥768px, `pointer: fine`, `hover: hover` dan tanpa reduced motion. Perubahan media query saat halaman terbuka langsung memperbarui efek; saat nonaktif, kedua dekorasi disembunyikan, listener interaksi/frame dibersihkan dan klik/hover tali tidak dapat menjalankan animasi. Tali tetap khusus beranda; efek menggunakan pembaruan berbasis interaksi dan berhenti setelah ayunan mereda. Perbaikan guard komponen bersama juga berlaku di Market, tanpa env/aset/kontrak API baru. Revisi lapisan 2026-10-16: tali bersama berada pada `z-30`, di belakang navbar sticky `z-50` dan overlay navigasi `z-40`, pada Pedia maupun Market; pangkal tali tertutup navbar, sedangkan bagian di bawahnya tetap mengikuti scroll dan merespons interaksi.

Revisi copy hero 2026-10-16 ✅ implementasi, publikasi melalui CI: headline beranda Pedia menjadi “Satu tempat untuk / optimasi media sosial”, dengan typewriter cyan Termurah / Termudah / Terpercaya tetap. Baris pendukung di bawah CTA persis “Order cepat tanpa login • Garansi refill • Support WA admin”. Ini perubahan copy atas permintaan owner; kelayakan, masa dan ketentuan refill tetap mengikuti layanan/paket yang dipilih, tanpa perubahan kontrak checkout atau supplier.

Revisi navbar dan lacak 2026-10-16 ✅ implementasi, publikasi melalui CI: hierarki navbar Pedia mengikuti Market: logo → pencarian → Layanan AXVARA → Katalog → Lacak Pesanan → Artikel. Navigasi teks tampil mulai `xl`, dengan pill hover/focus membulat; Artikel menuju URL absolut Market dari `SITE.webUrl`, menggantikan Bantuan di navbar atas. Bantuan tetap tersedia di bottom nav dan footer. `/pedia/lacak` memakai header, kartu form glass, label/hint, tombol loading dan FAQ dengan gaya Market; verifikasi kode AXP + WA/email tetap melalui `POST /api/orders/lookup`, lalu membuka halaman status Pedia setelah berhasil. Riwayat sukses maksimal lima tersimpan lokal di `axp-track-recent` dengan kontak tersamarkan pada UI dan tombol hapus; daftar `axp-orders` maksimal 20 terlipat awal, menyaring entri rusak dan dapat disembunyikan per pesanan. Penyimpanan browser opsional; validasi, timeout jaringan dan penjagaan klik ganda tidak mengubah kontrak server atau supplier. Revisi lanjutan 2026-10-16: pill “WA Admin” dan “Panduan pemesanan” di bawah FAQ lacak dihapus; halaman berakhir pada FAQ sebelum footer bersama.

Katalog terkurasi berisi 38 jenis/131 mapping pada 16 platform, dengan 3 pilihan awal pada mobile/desktop, drop/refill tetap. Pilihan yang sudah dipilih dirangkum dan dapat diganti pada semua ukuran. Target GitHub/website/platform baru didukung parser client/server. Harga jumlah bebas dihitung server; order/job/kredit/ledger atomik D1, retry QR sama, kredit pending kedaluwarsa dikembalikan. Copy ketentuan disimpan ke quote/order. Tidak ada order supplier berbayar atau klaim hasil kualitas/drop teruji dalam verifikasi ini.

**Product:** AXVARA — Gerbang Semua Tools Premium
**Tagline:** Satu Gerbang, Semua Tools Premium
**Version:** 1.1 — Production (sinkron 2026-09-15, sebelumnya 1.0 Pre-Build 31 Agu 2026)
**Status:** Live di axvara.tech — 50 produk, 97 varian, 30 order
**Platform:** Cloudflare Pages + D1 + R2 + Heroku (WA gateway + WR proxy) + Telegram Bot API  
**Tanggal:** 31 Agustus 2026  
**Author:** Axvara Team + AI Architect  

---

## 1. Overview

### 1.1 Ringkasan Produk
AXVARA adalah website toko digital premium untuk menjual **Aplikasi Premium, AI Gateway, Akun AI Premium (ChatGPT Plus, Claude Pro, Midjourney, dll), Tools Premium, dan Bundle Kucing**.

Inspirasi fungsional dari **marketku.id** (katalog → keranjang → checkout → konfirmasi manual), tapi dengan **level desain 10x lebih premium** setara Apple Store — glassmorphism, animasi halus, dan checkout super simpel.

**Bedanya dengan Marketku.id:**
- Desain: Apple Store minimalis + glassmorphism, bukan template marketplace kaku
- Pembayaran: **QRIS dinamis GoPay Merchant Axvara Digital** untuk invoice baru sejak27Oktober2026; KlikQRIS/DANA/GoPay lama tetap pada rail asal; transfer manual tetap mode maintenance
- Hosting: **Gratis selamanya** di Cloudflare Pages — unlimited bandwidth, CDN Indonesia super cepat, tanpa ngurus VPS
- Fokus niche: Digital goods (lisensi/key/akun), bukan fisik

### 1.2 Tujuan Produk
- Menjadi toko digital premium yang terlihat **mahal & terpercaya** sehingga konversi lebih tinggi untuk produk digital 50rb–1jt
- Checkout **paling simpel** untuk pembeli awam: pilih produk → pilih Transfer/QRIS → scan QR dinamis atau upload bukti transfer manual → selesai
- Admin bisa kelola pesanan **dari HP**; pembayaran QRIS dilunasi otomatis oleh event merchant sesuai invoice, sedangkan transfer manual tetap ditinjau admin
- Biaya infrastruktur diupayakan Rp 0/bulan di luar domain; biaya gateway mengikuti ketentuan KlikQRIS

### 1.3 Target User

| Persona | Deskripsi | Kebutuhan Utama |
|---------|-----------|-----------------|
| **Pembeli Umum** | Mahasiswa, freelancer, creator, pekerja yang butuh tools AI murah | Cari produk cepat, lihat harga jelas, bayar via QRIS/DANA/Gopay/Shopeepay dalam 30 detik, dapat akun/lisensi via WA |
| **Pembeli Langganan** | Pelanggan bulanan AI Gateway / akun premium | Re-order cepat, riwayat pesanan, perpanjangan 1 klik |
| **Admin / Owner (Kamu)** | Pemilik Axvara | Tambah/edit produk, lihat pesanan per channel, konfirmasi transfer manual, pantau QRIS otomatis, kirim lisensi, lihat laporan omzet |

### 1.4 Glossary

- **QRIS Dinamis:** QRIS DANA Business yang dibuat per order dengan nominal unik dan masa berlaku 15 menit. **Sejak 2026-10-02 (Fase 0, default mati):** ledger + matcher + reissue multi-rail (`dana` | `gopay`); rail order baru mengikuti `QRIS_ACTIVE_PROVIDER` (default `dana` = perilaku lama). Rail GoPay (payload GoPay Merchant + poller mutasi GoBiz di VPS + `POST /api/webhook/gopay`) aktif bila `GOPAY_QRIS_ENABLED=true` + secret terisi — Fase 1
- **QRIS Hook (legacy DANA):** Aplikasi Android yang meneruskan notifikasi DANA. GoPay Merchant memakai poller mutasi GoBiz di server; provider efektif mengikuti konfigurasi server.
- **Transfer Manual:** Pembeli transfer ke e-wallet 082135277434 (DANA/Gopay/Shopeepay) atau SeaBank 901812349386 a.n. pemilik
- **Bukti Transfer:** Foto/screenshot yang di-upload pembeli setelah bayar
- **Pesanan Pending:** Pesanan menunggu verifikasi admin
- **Glassmorphism:** Efek kaca blur transparan ala Apple/macOS
- **Vault:** Metafora brand Axvara — gerbang akses ke semua tools premium
- **Kontak Admin:** WhatsApp dukungan `089519388264`; berbeda dari nomor e-wallet tujuan pembayaran `082135277434`
- **Varian Terpusat:** Setiap produk punya ≥1 varian (harga/stok/durasi/garansi per varian); harga kartu = varian termurah yang masih tersedia
- **Warung Rebahan (WR):** Supplier H2H (`warungrebahan.com/api/v1`); produk WR disync ke katalog (source=`warung_rebahan`), order lunas diteruskan otomatis (exactly-once), sync satu sweep penuh per run (Opsi A). Nama publik Gemini AI Antigravity sengaja tanpa suffix `(WR)`; kepemilikan supplier tetap dibedakan lewat `source`/`wr_product_id`.
- **Sekalipay (SK):** Supplier kedua paralel WR (`sekalipay.com/api`, 2026-09-30); produk SK disync ke katalog (nama publik bersih tanpa suffix supplier sejak 2026-09-30 — dibedakan di admin via badge asal + slug; preseden Antigravity 0045), order lunas diteruskan otomatis (exactly-once, `ref_id` idempoten sisi SK). Fase 1 hanya varian `auto` Aplikasi Premium; pasangan tampil otomatis mengikuti aktivasi manual → stok → modal → preferensi. Tanpa failover otomatis WR↔SK.
- **Proxy WR/SK:** VPS AWS `t4g.nano` Singapore (`https://wr-proxy.axvara.tech`, IP `13.228.147.90`, sejak 2026-10-02 — sebelumnya Heroku akun #2 + QuotaGuard) — satu-satunya egress yang di-whitelist WR/SK; Pages hanya pegang URL + token proxy
- **Gateway WA:** App Heroku akun #1 (`axvara-wa-gateway`, Baileys) — bot grup WhatsApp; route `/wr/*` lama sudah dimatikan (410)
- **Bot Telegram:** `@Axvara_bot` — katalog/keranjang/checkout/QRIS/garansi via Bot API webhook; foto welcome WebP ringan di `public/banners/tg-welcome.webp`

---

## 2. Requirements

**Pengiriman Telegram pasca-bayar — 2026-10-17 ✅ implementasi, publikasi melalui CI:** kredensial WR, SK, stok sendiri shared/unique, jalur legacy, serah terima admin berisi detail dan tombol **Ambil Detail Produk** diikuti **Syarat & Ketentuan** → **Cara Penggunaan / Aktivasi** → **Syarat klaim garansi**. Copy mengikuti varian yang benar dengan resolver PDP/panel website yang sama (admin → kurasi → supplier dirapikan, digabung dengan bagian S&K/aktivasi deskripsi produk). Ketentuan/panduan kosong atau katalog gagal dibaca mendapat petunjuk jujur ke deskripsi/admin `/bantuan`, tanpa membuat aturan produk baru. Klaim memakai sumber kebijakan Market: hanya produk bergaransi, invoice/bukti pemesanan + screenshot, proses 1–3 hari dan solusi refund bila gangguan masih terjadi setelah maksimal tiga hari; masa/cakupan tetap mengikuti produk. Pesan panjang dilanjutkan berurutan dengan identitas order, HTML/Unicode aman dan kredensial utuh; pengiriman baru dianggap sukses setelah seluruh bagian berhasil. Ambil ulang juga melengkapi order lama dengan copy katalog terkini; tidak otomatis mengirim ulang transaksi lama. Verifikasi memakai fixture tanpa pesan Telegram/transaksi supplier nyata; belum merupakan bukti produksi live.

**Pembayaran QRIS ringkas — 2026-10-15 ✅ implementasi, publikasi CI:** `/pesanan/[code]` saat QRIS pending memakai header kecil berisi status/kode, QR 224px di mobile (240px desktop), nominal termasuk kode unik dan sisa waktu dekat QR. Judul dan kode pesanan di tengah kartu serta satu pill Menunggu bayar di atas Total bayar pada mobile maupun desktop. Desktop dua kolom QR/informasi bayar, mobile satu kolom; tombol **Simpan QRIS** dan **Cek Pembayaran** berdampingan dengan tap target 44px. Informasi pengecekan otomatis tetap tampil; waktu terakhir dicek tersedia untuk pembaca layar. Ringkasan produk tertutup awal dan dapat dibuka, tautan Lacak Status dihilangkan saat pending, lanjut belanja/bantuan/pembatalan menjadi aksi sekunder ringkas. QR kedaluwarsa tetap tidak dapat dibayar, penerbitan ulang hanya jika diizinkan server; konfirmasi/verifikasi pembatalan, alur lunas dan auto-scroll akun tetap berlaku.

**Auto-scroll detail akun Market — 2026-10-15 ✅ implementasi, publikasi CI:** setelah pesanan lunas dan isi akun berhasil dimuat melalui verifikasi kontak/token, halaman pesanan dan hasil lacak otomatis bergulir sekali ke bagian **Detail Akun Digital**. Menunggu isi akun nyata, termasuk hasil polling pengiriman; form verifikasi, respons kosong/gagal, dan info pengiriman belum memicu scroll akun. Ada jarak dari navbar; reduced motion memakai perpindahan langsung. Polling/rerender dan membuka panduan/accordion tidak mengulang scroll. Melacak kode pesanan lain membuka panel baru dan menunggu detail akun pesanan itu.

**Klaim garansi Market — 2026-10-15 ✅ implementasi, publikasi CI:** semua pesanan Market lunas (WR, SK, stok sendiri, manual; termasuk riwayat lama) menampilkan satu accordion tertutup **Syarat klaim garansi** setelah detail akun/S&K/aktivasi atau informasi pengiriman, pada `/pesanan/[code]` dan hasil lacak. Isi: kirim invoice/bukti pemesanan serta screenshot kendala; proses 1–3 hari tergantung antrean, stok pengganti, atau gangguan pihak terkait; bila setelah maksimal 3 hari gangguan masih terjadi, diberikan solusi refund uang; ditutup ucapan terima kasih. Halaman `/garansi-replace` memakai isi yang sama dan mengganti ketentuan lama proses 1×24 jam/refund hanya stok kosong. Formatter kebijakan Market Telegram/WhatsApp ikut sinkron; masa/cakupan garansi tetap mengikuti produk. Informasi ini tidak menjalankan refund otomatis.

**Revisi 2026-10-16 ✅ implementasi, publikasi CI:** accordion **Syarat klaim garansi** berada di dalam kartu **Detail Akun Digital**, setelah seluruh accordion **Cara Penggunaan / Aktivasi** dan sebelum catatan simpan detail, dengan style yang sama seperti S&K/aktivasi. Revisi ukuran 2026-10-16: teks isi accordion memakai 12px dengan line-height relaxed yang sama seperti isi S&K/aktivasi; isi pada halaman ketentuan publik tetap 14px. Berlaku pada halaman setelah order dan hasil lacak; tetap satu per pesanan walau ada beberapa akun. Form verifikasi juga memuat accordion di dalam kartu; pesanan lunas yang detail akunnya belum tersedia tetap menampilkan informasi garansi setelah blok pengiriman. Isi accordion serta halaman ketentuan bersama diawali teks **pengajuan garansi hanya untuk produk bergaransi**; ketentuan masa/cakupan produk tetap berlaku.

**Footer bersama — 2026-10-15 ✅ implementasi, publikasi melalui CI:** Market dan Pedia menampilkan ikon WhatsApp satu tone dengan sosial lainnya tepat setelah Facebook, tanpa teks, menuju `https://axvara.tech/wa?pesan=Halo%20AXVARA`. Teks chat/jam layanan di footer dihapus. Di bawah ikon sosial terdapat pill kecil **Grup WA** (hijau) dan **Bot Order Telegram** (biru), menggunakan logo brand asli; bot tetap kanal order Market. Navigasi footer hanya **Layanan AXVARA** (Market/Pedia dari daftar layanan terpusat; layanan berikutnya ditambahkan saat tersedia) dan **Bantuan** (cara order, pelacakan, bantuan/ketentuan kedua layanan). Daftar kategori, Semua produk, dan AI & teknologi dihapus dari footer; newsletter tetap tersedia.

### 2.1 Functional — Pembeli (Storefront)

| ID | Requirement | Prioritas |
|----|-------------|-----------|
| FR-S1 | Pengunjung bisa melihat homepage hero premium + search + kategori + produk unggulan tanpa login. **2026-10-01 copy hero (permintaan owner):** penekanan dipindah dari "QRIS otomatis" ke "order cepat tanpa perlu login" — subheadline + trust item pertama | P0 MVP |
| FR-S2 | Katalog produk dengan grid Apple-style, filter kategori (AI & Chatbot, Streaming & Hiburan, Produktivitas & Office, Desain & Video, Developer & Tools, Bundle Hemat — taksonomi 6 kategori 2026-09-28, migrasi 0046; slug lama ai-gateway/akun-premium/tools-pro dialias di kode agar filter lama tidak 404), search, dan sorting. **2026-10-01 ✅ live (permintaan owner: jangan hilangkan yang habis + jangan nomor halaman):** 16 produk + "Tampilkan N produk lagi" (ganti filter kembali ke 16 awal); produk habis TETAP tampil di akhir sebagai kartu abu-abu tanpa tombol beli (trust + kurangi komplain "kok kemarin ada, sekarang hilang"); PDP produk pecundang WR-vs-SK 308 ke pemenang (noindex) | P0 MVP |
| FR-S3 | Halaman detail produk: galeri gambar, harga (diskon/coret), stok, deskripsi, benefit, tombol Tambah ke Keranjang & Beli Langsung. **2026-10-01 ✅ live (permintaan owner):** Produk Serupa TIDAK PERNAH menampilkan stok habis (Serupa = ajakan beli; kartu habis tetap ada di katalog utama untuk trust); bila kategori sama < 4, dilengkapi dari katalog lain (hanya yang bisa dibeli) | P0 MVP |
| FR-S4 | Keranjang slide-drawer dari kanan (tanpa pindah halaman), ubah qty, hapus item, lihat subtotal | P0 MVP |
| FR-S5 | Checkout 1 halaman ala Sekalipay (revamp 2026-09-23): ① metode pembayaran (QRIS auto-select; E-Wallet/SeaBank maintenance 2026-09-17) → ② data pembeli minimal (No WA + Email SELALU wajib, tanpa Nama; fallback nama = prefix email) → S&K → 1 CTA; ringkasan 1x per viewport (mobile accordion collapsed di atas, desktop rail sticky; rail `hidden lg:block` agar mobile tidak duplikat); 2 tombol submit (rail desktop + sticky mobile) 1 handler | P0 MVP |
| FR-S6 | Jika pilih E-Wallet: tampilkan nomor 082135277434 + nama pemilik + tombol Copy + instruksi | P0 MVP ⏸️ maintenance 2026-09-17 (field tampil disabled + badge Maintenance di WEB; dihilangkan di WA/TELE; upload bukti disembunyikan) |
| FR-S7 | Jika pilih SeaBank: tampilkan 901812349386 + instruksi **2026-10-15 ✅ implementasi:** submit dengan WA/email kosong atau salah menggulir dan memfokuskan field pertama yang tidak valid; label dan error terlihat di antara navbar/CTA mobile, menghormati reduced motion, tanpa membuat order. | P0 MVP ⏸️ maintenance 2026-09-17 (lihat FR-S6) |
| FR-S8 | Jika pilih QRIS: setelah order tampilkan QRIS dinamis, nominal unik, countdown 15 menit, tombol Download, dan polling status | P0 MVP |
| FR-S9 | Bukti transfer JPG/PNG/WebP max 5MB wajib untuk SeaBank/e-wallet; QRIS tidak memerlukan upload bukti | P0 MVP ⏸️ maintenance 2026-09-17 (upload disembunyikan di WEB; `POST /api/proof/upload` 503; `POST /api/orders` tolak non-QRIS 503) |
| FR-S10 | Setelah order sukses: halaman Terima Kasih + nomor pesanan (AXV-XXXX) + WA admin + status Pending | P0 MVP |
| FR-S11 | Pembeli bisa cek status pesanan via nomor WA / kode pesanan (tanpa login) | P1 ✅ live |
| FR-S11a | Halaman `/lacak-pesanan`: form kode pesanan (AXV-YYYYMMDD-XXXXXXXX) + No. WA atau email checkout (email sejak 2026-09-25), verifikasi server via `POST /api/orders/lookup`, timeline Dibuat → Pembayaran → Diproses, badge Pending/Lunas/Dibatalkan/Kedaluwarsa, auto-refresh Pending 10 detik, deep-link `?code=&wa=`, riwayat lokal 5 terakhir, tautan dari navbar/footer/bottom-nav/cara-order/halaman pesanan | P1 ✅ live 2026-09-17 |
| FR-S12 | Notifikasi WA otomatis ke pembeli saat admin konfirmasi lunas (kirim lisensi) | P1 ✅ live (gateway Baileys) |
| FR-S13 | Wishlist & histori pesanan jika pembeli login (opsional, email/WA OTP) | P2 |
| FR-S14 | Bot Telegram @Axvara_bot: /start (foto welcome + sapaan), katalog, cari, keranjang, checkout QRIS, pesanan, garansi. Katalog hanya menampilkan produk yang BISA DIBELI dan detailnya ringkas. Jumlah dapat diubah lewat −/+ atau tombol **Masukkan Jumlah** + ForceReply dengan rentang stok/minimum live. Varian wajib email memakai CTA **Lanjut Isi Email**, menyimpan email, lalu menampilkan ringkasan masked + Ubah Email/Ubah Jumlah sebelum QRIS diterbitkan (2026-09-27) | P0 ✅ live (redesign katalog + input 2026-09-27) · **2026-10-04 ✅ paritas Web:** pesan lunas sesuai kelas kirim (instan → "dikirim otomatis ke chat ini"; Made By Order WR/SK → pesan tunggu maks 12 jam + kredensial dikirim OTOMATIS ke chat yang sama begitu selesai; manual → dikirim admin + minta WA cadangan hanya untuk baris manual); kredensial WR & SK masuk DM chat pribadi pembeli (SK dulu hanya email → pembeli Telegram tidak menerima apa pun); tanpa kata "pemasok"; katalog/cari/bestseller/detail memfilter pecundang pasangan WR/SK; label garansi disembunyikan bila varian tanpa data garansi (bukan "Tanpa Garansi"); fallback kirim: target chat pribadi berurutan (chat tersimpan → id pembeli → chat order) + tombol **📦 Ambil Detail Produk** di pesan lunas/status untuk mengambil ulang detail kapan saja · **2026-10-10 ✅ UX jujur:** detail produk menampilkan kelas pengiriman per varian (🚚 ⚡ Kirim otomatis / ⏳ Made By Order — satu sumber `buyerDeliveryKind` dengan badge PDP web); invoice QRIS punya tombol **🔄 Periksa Pembayaran** (`refresh:*`, ownerBound + idempoten) + copy "Sudah bayar? Tekan Periksa Pembayaran" (ganti "tidak perlu cek manual" yang berbohong saat hook telat) · **2026-10-10 ✅ email di notif admin:** Order Baru + Lunas Telegram tampilkan 📧 email buyer (fallback "— tanpa email") — paritas notif Web · **2026-10-10 ✅ hanya Lunas (keputusan owner, paritas Web 2026-09-25):** "Order Baru — Telegram/WhatsApp" DIMATIKAN — grup Axvara_Notif hanya menerima "Lunas" · **2026-10-10 ✅ hub WA /wa (keputusan owner URGENT, suspend nomor):** semua tombol WA admin (web, /link, footer, lacak, pesanan, keyboard Telegram) mendarat di halaman perantara `/wa` — user pilih AXVARA 1/2/3 (badge Aktif/Suspend jujur) + Telegram; pesan bawaan per konteks diteruskan via `?pesan=` |
| FR-S15 | Bot grup WhatsApp (Baileys): list/katalog, cari, bayar QRIS, perintah admin `.d` (jalur manual + bukti SEABANK/EWALLET maintenance 2026-09-17) | P0 ✅ live |
| FR-S16 | Produk varian terpusat: harga/stok/durasi/garansi per varian; harga kartu dari varian termurah tersedia; label pembeli = label + durasi via `formatVariantLabel()` (audit 2026-09-19: 88/97 varian kehilangan durasi karena sync WR menulis label=nama verbatim — PDP/modal/quote web kini gabung "Meitu VIP - 7 Hari" ala web WR, anti-duplikasi case-insensitive) | P0 ✅ live |
| FR-S18 | PDP menampilkan S&K + cara aktivasi per varian WR (read-only, ikut varian terpilih); label garansi kanonis "Garansi N Unit". **2026-09-24:** deskripsi, S&K, dan cara aktivasi versi Axvara dalam satu format untuk WR & non-WR (deskripsi = pembuka + keunggulan; S&K berkelompok Detail paket/Proses & pengiriman/Aturan pakai/Garansi; aktivasi bernomor), S&K + cara aktivasi terlipat di mobile, kalimat berulang dibuang, semua angka/larangan/batas garansi pemasok tetap terbawa; teks WR yang berubah otomatis tampil (dirapikan) sampai dikurasi ulang | P0 ✅ live (migrasi 0040) |
| FR-S17 | Integrasi Warung Rebahan H2H: sync katalog terjadwal, auto-order exactly-once, webhook status, saldo monitor + throttle notif. **2026-09-28 ✅ live:** link WR tertahan bisa di-void admin (POST /api/admin/warung/orders/[id]/void, CAS, terminal failed + last_error=cancelled_by_admin); auto-revive blocked_balance dibatasi umur 24 jam (WR_BLOCKED_MAX_AGE_HOURS) + hanya order lunas; buyer dikabari sekali saat masuk blocked (idempoten wr-blocked:<kode>). **2026-10-01 ✅ live bulk markup (permintaan owner):** POST /api/admin/warung/markup/bulk — 1 request untuk ≤200 varian (formula harga sama dengan PUT satuan; default hanya % berubah, Rp dipertahankan kecuali reset dicentang; hasil jujur updated + failed; harga katalog ikut berubah) + toolbar bersama BulkMarkupToolbar (checkbox per baris + "Set semua tampil" + preset 20/30/50 + konfirmasi hitungan) | P0 ✅ live (auto-order flag default off) |
| FR-S17b | Integrasi Sekalipay (supplier kedua paralel WR, 2026-09-30): sync katalog terjadwal (delta `updated_since`), auto-order exactly-once (`ref_id` idempoten sisi SK), webhook status (SHA256), saldo monitor + throttle notif, tab admin setara WR + uji sandbox. Fitur khas SK (tanpa padanan WR): mutasi saldo audit (credit/debit + before/after), cek akun validasi nickname, stock-lock 10 mnt anti-overselling, daftar transaksi SK, detail capability per varian. Fase 1 hanya varian `auto` Aplikasi Premium; pasangan tampil otomatis dari sisi aktif manual, lalu stok/modal/preferensi (nama bersih, beda badge admin + slug); tanpa failover otomatis. **2026-10-01 bulk markup cermin WR** via POST /api/admin/sekalipay/markup/bulk (toolbar bersama yang sama). **2026-10-02 paritas email + flag SK:** order SK auto ikut instan (flag `queued/instant` baca `sk_order_process`, bukan `fulfillment_mode` lokal) sehingga halaman lunas spinner "Mengirim produkmu…" bukan Made By Order; webhook `order.completed` langsung kirim email kredensial template "Pesanan Siap" Axvara yang SAMA PERSIS dengan WR/non-WR (logo + tanda terima + blok kredensial + CTA, idempoten per item) + reconcile cron; event `order.paid/item.sent` kirim email "Pesanan Diproses"; saldo habis kabari pembeli (`sk-blocked`); QRIS pending ada spinner jam + "Mengecek otomatis tiap 5 detik • terakhir dicek" + tombol Cek Status Sekarang. **2026-10-03 white-label docs + anti-spam (keputusan owner):** link `sekalipay.com/docs/tutorial-login-netflix` di S&K Netflix di-rewrite ke artikel AXVARA `/artikel/cara-login-netflix-setelah-order-di-axvara` (ditulis ulang + foto white-label) di PDP + email/panel — tahan sync via `rewriteSupplierDocsLinks()`; **sore harinya diperluas ke video login Alight Motion supplier (laporan owner + screenshot PDP: blok "CARA AKTIVASI" varian SK masih menampilkan `youtu.be/8emqddsjPsE` mentah ke channel supplier) — semua bentuk URL ID itu (youtu.be/watch/embed/shorts + query `?si=`, https maupun bare) di-rewrite ke artikel AXVARA `/artikel/cara-login-alight-motion-setelah-order-di-axvara` (published id 24: player + teks dari deskripsi asli) di KETIGA jalur yang sama; video YouTube ID lain (mis. tutorial Office) tetap dipertahankan;** mailbox OTP + bot Viu dipertahankan (bukan toko). Notif saldo SK disamakan ke WR: 6 jam ATAU turun Rp5.000 (state `sk_sync_state`), max 24x/hari → max 4x/hari. **2026-10-03 paritas WR-SK panel (kasus F111FD64):** WR completed tidak muncul di panel karena webhook tidak sampai + completed tidak bind item + settle tanpa ciphertext; kini bind otomatis + ciphertext ke item (pola SK), reconcile fresh >3 mnt di cron + tombol sync-now admin | P0 ✅ live 2026-09-30 (whitelist + webhook + secrets terpasang; saldo 0 — top up sebelum order prod) |
| FR-S17c | Shortlink internal `axvara.tech/go/*` (keputusan owner 2026-10-03, permintaan "kayak Kliqs — versi internal"): pembungkus link supplier + artikel AXVARA panjang agar tampil pendek di PDP/email/panel ("axvara.tech/go/otp" bukan "netflix-codes.sekalipay.com/mailbox"); audit D1 prod live memetakan SEMUA link teks supplier (wr_terms/delivery + sk_seller_note/description, termasuk produk off/restok — 43 slug: mailbox OTP genjos/tmail/waroengmail/runcubes/generator/2fa + bot Telegram supplier + tutorial YouTube supplier + domain resmi app + panduan artikel, kecuali `netflix.com/clearcookies|youraccount` yang dibiarkan mentah); route `GET /go/:slug` redirect 307 + hitung klik, noindex, 404 bila mati; CRUD admin (tab Link Supplier); rewrite `rewriteSupplierDocsLinks()` diperluas tahan-sync ke KETIGA jalur (fallback PDP pre-bayar + email/panel pasca-bayar); kurasi tayang teks `go/*` langsung (linkify internal tanpa tab baru); supplier ganti URL → update 1 baris tanpa edit kurasi; **retroaktif order lama (screenshot AXV-BD58F7ED): ciphertext WR era pra-shortlink dibungkus saat tampil via `normalizeAccountDetailsForDisplay()` — panel/WA/email/Telegram WR ikut pendek tanpa migrasi data (email terkirim tidak berubah); 2026-10-19 diperluas ke Disney+ (permintaan owner, pola Netflix): `sekalipay.com/docs/tutorial-login-disney` → `go/disney-login` → artikel `/artikel/cara-login-disney-setelah-order-di-axvara` (ditulis ulang + 6 foto white-label R2, draf id 26 review), kurasi 2 entri sharing Premium 3U, total 44 slug | P0 ✅ live 2026-10-03 |
| FR-S17c-audit | Audit katalog publik live 2026-11-02 (99 produk/105 varian; LOKAL, belum deploy — basis historis di atas tetap live): cross-sell "halaman Jaspay" di 10 varian premium di-drop display-only S&K+aktivasi (raw/fingerprint utuh; keputusan implementasi S1), bare `netflix-codes.sekalipay.com` → `go/otp`, shorts Alight baru `YKOMcipD3ig` → `go/alight-shorts`, OTP admin Muse `inbox.hypathia.web.id` → `go/otp-hypathia`, typo statis `https;//dramaku.world` → `go/dramaku` terdaftar (migrasi 0092, total 46 slug; `@userinfobot`/clearcookies/domain resmi tetap mentah) | P0 lokal, belum deploy |
| FR-S19 | Minimum pembelian per varian (generik, default 1): GSuite min. 50 akun; label "Min. N" di PDP/modal/keranjang/bot; quote 409 + orders 409 + guard atomik; web/Telegram plafon 100/baris; WA qty-1 ditolak jelas untuk varian min>1 | P0 ✅ live (migrasi 0034) |
| FR-S25 | Opsi pengiriman non-WR + isi terlihat di admin (2026-09-19): dropdown "Cara Pengiriman" per varian (Made By Order / Kirim otomatis pesan bersama / Kirim otomatis stok unik, sinkron 1:1 `fulfillment_mode`) + panel konten fulfillment shared/unique di jalur resmi ProductVariantRows (akar hilang: satu-satunya panel isi kredensial hanya hidup di VariantEditor mati); keputusan owner: admin MELIHAT isi plaintext (shared "Isi saat ini" + Ganti, unique daftar + Hapus/baris, auto-load; reveal server-side di GET admin, tak ke pembeli); counts pantau dua sumber (kolom ciphertext + inventory); display buyer fulfillment-aware (non-WR manual = MBO + kalimat admin tanpa angka supplier) | P0 ✅ live 2026-09-19 |
| FR-S20 | Halaman pesanan lunas jujur soal pengiriman: order lunas yang pengirimannya GAGAL (`fulfillment_status='failed'`) tampil merah "Pengiriman Produk Bermasalah" + langkah hubungi admin, bukan "Pembayaran Dikonfirmasi 🎉" (2026-09-24, PR audit ronde 4); panel "Detail Akun Digital" (verifikasi WA + capability token) hanya muncul saat `credentials_ready` dari server; order lunas tanpa kredensial otomatis (fulfillment manual) menampilkan blok "Pengiriman Produk" berisi tujuan WA/email checkout tersamar + estimasi 5–15 menit, dan halaman mem-poll terbatas (20 dtk × maks 30) agar panel muncul sendiri tanpa reload. Sejak 2026-09-25 estimasi 5–15 menit hanya untuk produk WR (lihat FR-S32). **2026-10-13 paritas instan supplier:** order supplier (WR/SK) yang linknya masih berjalan menampilkan skeleton "Menyiapkan detail produkmu…" (TANPA kalimat stok/admin/diproses) dan dipoll rapat 2 dtk; setiap poll memicu tarikan status vendor di server (gerbang throttle 20 dtk/order di `store_settings`), sehingga detail muncul hitungan detik setelah vendor `COMPLETED` seperti SK — tanpa menunggu cron 5 menit/route besar 1 jam dan tanpa klik "Cek status" admin. Panel kredensial kini diikuti blok "Syarat & Ketentuan" + "Cara Aktivasi" (resolver PDP yang sama) di bawah tiap kredensial | P0 ✅ live 2026-09-18 + paritas instan 2026-10-13 |
| FR-S32 | Halaman pesanan setelah bayar produk kirim otomatis dari stok sendiri (varian non-WR `shared`/`unique`, mis. Canva Invite 1 Bulan): fase menyiapkan ±30 dtk pertama = skeleton tanpa teks pengiriman (bentuk mirip panel akhir, + baris mikro "Menyiapkan detail produkmu…") supaya tidak ada bacaan yang hilang saat panel kredensial muncul — tanpa sebut admin/12 jam; halaman memeriksa rapat 2 dtk ×5 lalu 5 dtk ×4 sehingga detail akun muncul beberapa detik setelah terkirim tanpa reload; lewat ±30 dtk teks jujur "Masih mengirim otomatis — butuh waktu lebih lama" (tetap tanpa admin/12 jam, order ber-email ditambah kalimat email + halaman ini); Made By Order (C1, manual by design) judul "Pesanan Made By Order" tanpa alasan stok; kirim otomatis yang diserahkan ke admin / `manual_required` (C2) judul "Pengiriman oleh Admin" + alasan "Stok otomatis habis, jadi admin menyiapkan manual" + "Umumnya kurang dari 1 jam, maksimal 12 jam" (tanpa jam layanan spesifik); order terkirim tanpa detail di halaman: order ber-email → copy "Detail pesanan akan otomatis dikirimkan di email saat order dan akan tampil di halaman ini." + cek spam, order lama tanpa email → "Produk sudah dikirim ke WhatsApp …" (tanpa cek spam); kontak checkout bertahan selama tab terbuka sehingga muat ulang tetap membuka detail otomatis. **Pagar 2026-10-13:** kalimat C1/C2 (stok habis, Made By Order, disiapkan admin) HANYA untuk order non-supplier — order supplier (WR/SK) tidak pernah menampilkannya; selama link supplier berjalan tampilannya skeleton menyiapkan + poll rapat yang memicu tarikan status vendor, persis perlakuan instan stok sendiri (lihat FR-S20) | P1 ✅ 2026-09-25 (PR, live setelah merge + deploy) + revisi copy A/B/C1/C2 2026-10-02 + skeleton fase menyiapkan sore 2026-10-02 + copy email 2026-10-07 + pagar supplier 2026-10-13 (permintaan owner, live setelah merge + deploy) |
| FR-S21 | Cron operations tahan dipotong platform: penanda fase dimajukan di awal run (anti poison-pill), deadline wall-clock 45 dtk sebelum tiap unit kerja jaringan, timeout API WR 12 dtk, lease pengiriman kredensial dapat dipulihkan, dan zero-missing stok hanya pada sweep penuh dari awal daftar | P0 ✅ live 2026-09-18 (perbaikan insiden sync WR mati 17–18 Sep) |
| FR-S22 | Produk kelas ANTREAN (dibuatkan setelah order; label pembeli "Made By Order" sejak 2026-09-19) diteruskan otomatis ke supplier begitu lunas — tidak lagi menunggu admin sadar; saklar mundur `WARUNG_REBAHAN_AUTO_ORDER_MBO=false`. Ekspektasi waktu jujur per kelas dan disebut SEBELUM bayar (PDP + checkout; kalimat ETA modal dihapus 2026-09-19): instan = 5–15 menit, antrean = "{produk} dibuat setelah pembayaran terkonfirmasi. Umumnya terkirim cepat, maksimal 12 jam pada jam layanan" (template checkout sejak 2026-09-19 atas keputusan owner; badge "Made By Order" polos tanpa angka; paragraf "Detail akun dikirim ke WhatsApp…Tidak perlu menunggu" dihapus 2026-09-19; checkbox checkout tanpa "DYOR, DWYOR." sejak 2026-09-19). Nol jejak nama supplier di seluruh copy pembeli; status third-party independen tetap ada di halaman ketentuan. Masa garansi kelas antrean mulai saat detail akun diserahkan. **2026-10-09 ✅ live penjamin yatim (kasus AXV-20261009-DA1ACF56):** order lunas yang link WR/SK-nya gagal dibuat webhook disembuhkan cron tanpa menunggu antrean (probe `reconcileMissing*` tanpa gate due di lite + route besar; kunci respons `orphan_links_healed`). **2026-10-11 live sumber kebenaran delivery_mode API WR (migrasi 0060):** kelas instan/antrean diturunkan dari `delivery_mode` per varian (auto->restock, manual/mixed->made_by_order), mengalahkan seed/tebakan/kunci admin; audit 62/92 varian salah kelas diperbaiki (mis. Vidio Mobile kini jujur Made By Order). **2026-10-13 penyederhanaan paten ala SK (migrasi 0061):** mesin tebakan + tombol kunci kelas admin + badge sumber dihapus — panel hanya badge AUTO/MANUAL murni dari API WR. Email: web selalu wajib; Telegram/WA + API orders memakai `needsEmailForVariant()` (tipe Invite/Link WR atau produk `require_email`); `email_invite` hanya untuk Invite/Link. Retry pra-kirim habis bisa dibuka ulang admin (kuota baru, tanpa dobel-bayar); panel Pesanan menampilkan status supplier + Retry/Batal/Cek status per baris; penyapu kredensial yatim berpagar anti-kirim-ulang (item sudah delivered tidak disentuh) | P0 ✅ live 2026-09-18 (estimasi supplier 6–12 jam, <1 jam bila lancar) |
| FR-S23 | Pengawasan antrean: pembeli web dikabari WA otomatis saat detail akun siap, admin dapat notifikasi Telegram bila satu order melewati 13 jam (idempoten, migrasi 0037), panel admin menampilkan umur tiap baris antrean, ambang alert saldo default naik 50.000 → 250.000 (modal termahal 200.000) | P0 ✅ live 2026-09-18 |
| FR-S26 | Kabar pembeli kanal WEB lewat email (Resend), bukan outbox WA yang mati: tanda terima pembayaran, pengiriman gagal (termasuk kegagalan supplier Warung Rebahan), serah terima manual, bukti ditolak, dan bukti menunggu Hook; idempoten per kabar (`buyer_notice_log`, migrasi 0039); order web lama tanpa email tetap lewat outbox WA; Telegram tetap DM pribadi terverifikasi | P0 ✅ 2026-09-24 (PR audit ronde 4, live setelah merge + deploy) · **2026-11-04 implementasi lokal → publikasi CI (deployment belum diverifikasi):** pembeli Telegram yang pesanannya memuat produk WAJIB EMAIL (`needsEmailForVariant`: WR Invite/Link atau `products.require_email`) dan punya `customer_email` valid ikut menerima email seperti web — Pesanan Siap berisi isi produk/kredensial (stok sendiri, WR, SK), tanda terima (email saja bila tidak semua baris terkirim otomatis), serta kabar serah terima/gagal kirim/bukti. DM Telegram tetap kanal otoritatif; email salinan best-effort idempoten (`buyer_notice_log`), tanpa retry cron khusus |
| FR-S29 | Produk non-WR untuk pembeli WEB: varian Kirim otomatis (shared/unique) dikirim lewat SATU email "Pesanan Siap" berisi isi produk + tanda terima pembayaran (tanda terima terpisah hanya untuk Made By Order/pesanan campuran/kirim tertunda); varian Made By Order diserahkan admin lewat tombol **Kirim ke pembeli** yang membawa isi (email bermerek untuk web, DM untuk Telegram, tidak pernah lewat outbox WA) dengan template per varian; isi terkirim tersimpan terenkripsi dan bisa dibuka lagi di `/pesanan/[code]` setelah verifikasi WA/token; admin di-ping Telegram saat order web lunas perlu diserahkan; semua email pembeli memakai shell bermerek; PDP tidak menjanjikan Kirim otomatis untuk varian campuran sebelum dipilih. **2026-10-02 ✅ stok jujur unique (insiden Head 18 Bulan: kolom stock=2 tapi kredensial tersisa 1, PDP bilang "Sisa 2"):** varian unique memakai stok EFEKTIF = min(kolom stock, unit `available` inventory) di PDP ("Sisa"), quote (tolak `out_of_stock` bila unit habis walau kolom > 0), dan purchasable; kolom stock unique diselaraskan otomatis ke available saat impor/revoke inventory; panel admin menampilkan banner selisih bila keduanya tidak sama; cache PDP by-slug 10 detik (bukan 30) agar angka segar setelah ada yang beli. **Revisi sore 2026-10-02 ✅ stok total jujur + mobile paritas (laporan owner + screenshot: Head HABIS tapi "Stok: 21" — agregat kartu ikut menjumlah stok phantom 1+20; mobile bottom-sheet masih "Sisa 1" padahal checkout Habis):** (a) `purchasableStockSql` ikut menolak unique tanpa unit di SQL — `variant_stock` kartu, `available_min_price`, bot Telegram (katalog/cari/bestseller), `llms.txt` seragam; (b) `variant_stock` kartu dihitung dari stok EFEKTIF per varian (unique = min kolom vs available) — Head habis → total 0+20=20; (c) QuickVariantModal (jalur mobile) + direct-checkout + add-to-cart semua memakai stok efektif — tidak ada lagi jalur baca kolom mentah **2026-10-15 ✅ implementasi:** panel setelah bayar menggabungkan S&K varian dan bagian S&K/aktivasi dalam deskripsi produk, sama dengan PDP; tampil terpisah sebagai accordion Syarat & Ketentuan serta Cara Penggunaan / Aktivasi, kredensial tidak dicampur dengan panduan. | P0 ✅ 2026-09-25 (PR, live setelah merge + deploy + migrasi 0043) |
| FR-S30 | Admin menerima notif Telegram `Lunas — Web` di `Axvara_Notif` untuk setiap order web yang lunas (sekali per order), berisi status kirim: terkirim otomatis ke email, perlu **Kirim ke pembeli**, atau diproses Warung Rebahan; tombol Buka Pesanan + WA pembeli; tetap sampai walau tombol ditolak Telegram (kirim ulang tanpa tombol) dan diulang cron bila Telegram sedang gagal (maks 6 jam); order web tidak lagi dinotif saat dibuat (keputusan owner) | P0 ✅ 2026-09-25 (PR, live setelah merge + deploy) |
| FR-S33 | Daily Promo Digest ke grup admin `Axvara_Notif` pukul 09.00 dan 17.00 WIB: tiap slot mengirim versi lengkap + ringkas siap salin, berisi 3–4 produk yang benar-benar ready, harga mulai nyata, rotasi menghindari produk slot lain/histori dua hari bila stok katalog memungkinkan, CTA **Order melalui Bot Telegram** + **Order melalui Website**, dan retry parsial idempoten per bubble | P1 ✅ live 2026-09-27 (migrasi 0044; kill switch `TELEGRAM_PROMO_DIGEST_ENABLED`) | **2026-09-29 revamp (permintaan owner):** pagi = 12 teratas katalog, sore = 12 berikutnya tanpa tumpang tindih (hierarki `sort_order` admin); format kelompok per kategori + harga tegas varian termurah (tanpa "Mulai", tanpa footer disclaimer); hook "Sedia semua kebutuhan aplikasi dan tools premium favorit anda, murah, mudah, cepat, dan bergaransi" | **2026-10-01 revamp (permintaan owner, contoh ceklis WR/SEKUDIL):** SEMUA produk ready masuk pesan (bukan 12+12 paruh; format Axvara dipertahankan — judul + hook + kelompok kategori + CTA — hanya baris produk + ✅); kandidat = produk ready non-pecundang (`telegram_enabled=1`, pecundang supplier-pair dikecualikan); link bot deep-link `?start=beli` (tap → chat pribadi langsung siap order) | **2026-10-03 revamp (permintaan owner + contoh manual: pesan ringkas lama "jelek"):** bubble kedua BUKAN lagi versi ringkas — melainkan versi WA siap copy-paste: ISI SAMA PERSIS dengan pesan utama (judul + garis `---` + intro dua baris + kelompok kategori + CTA), hanya bold pakai `*` literal ala WA (tanpa parse_mode HTML agar `&`/`<` di nama produk tidak bikin Telegram tolak pesan); CTA = website dulu baru bot; pesan utama ikut contoh manual (garis pemisah, intro dua baris, CTA website-dulu). Fix ikon: Desain & Video = 🎨 (dulu 🤖 — "desain" mengandung substring "ai", kini cek kategori spesifik dulu + AI pakai batas kata)
| FR-S31 | Mobile storefront: bottom nav **Beranda · Kategori · Pesanan · Bantuan** (2026-10-03: Keranjang dihapus — drawer tetap dari navbar sticky; Kategori = sheet filter katalog. Cara Order/Artikel pindah ke panel Bantuan + footer; Pesanan menampilkan pesanan perangkat ini dengan status server + titik belum dibayar); PDP mobile memilih varian lewat panel (ketuk = pilih untuk halaman, bukan checkout), harga/S&K/cara aktivasi/tombol beli ikut varian, "Ganti varian" di judul S&K bila isinya berbeda, panel ringkas >6 varian + cari >10 | P1 ✅ 2026-09-25 (PR, live setelah merge + deploy) |
| FR-S27 | Pengingat melayang "pesanan belum dibayar" di seluruh storefront (kecuali checkout/pesanan/admin): hitung mundur QRIS (atau tenggat pesanan bila QR hangus dan masih boleh diperpanjang), satu ketukan kembali ke `/pesanan/[code]` tanpa checkout ulang; status & tenggat selalu dari server, bisa ditutup per pesanan per sesi | P0 ✅ 2026-09-24 (PR, live setelah merge + deploy) |
| FR-S28 | Storefront tidak "bisu" di jaringan lambat: setiap klik yang memicu navigasi langsung memberi bar + skeleton halaman tujuan (8 dtk pesan koneksi lambat, 20 dtk Coba lagi); CTA Checkout/Beli Sekarang berputar sampai checkout tampil; Bayar berlabel bertahap lalu layar "Pesanan dibuat · Membuka halaman pembayaran"; putus jaringan saat bayar dijelaskan aman diulang (idempoten, tidak dobel); halaman pesanan langsung menampilkan QR dari respons create dengan placeholder + muat ulang; PDP dirender server lengkap; permintaan storefront dibatasi waktu | P0 ✅ 2026-09-24 (PR loading storefront, live setelah merge + deploy) |
| FR-S24 | Kredensial 3 jalur (keputusan owner): isi detail akun dikirim LANGSUNG via WA (outbox durable, kunci `wr-delivery:<code>`, potong 1500 char/bagian; target dinormalisasi ke JID `@s.whatsapp.net` di adapter sejak 18 Sep sore — Baileys baru melempar untuk nomor mentah) + via email Resend template "Detail Akun Siap" (idempoten `wr-cred-email:<code>`, migrasi 0038 untuk kind/channel; pembeli tanpa email dilewati diam; walau WR tidak mengirim email, Axvara membuat email sendiri dari detail completed) + tampil di panel web (`/pesanan/[code]` dan hasil `/lacak-pesanan` via `WrCredentialsPanel` prefill WA terverifikasi lookup). Display dinormalisasi di USE-time (`normalizeAccountDetailsForDisplay`: envelope JSON `{product,details}` dikupas, `\r\n` dinormalisasi, label Indonesia, label ganda dibuang — tidak pernah JSON mentah). DM kredensial TANPA footer `/garansi` (keputusan owner 19 Sep — perintah itu untuk grup, bukan DM buyer; command `/garansi` di grup tetap hidup).
 Kill-switch 19 Sep 2026: auto-DM kredensial WA ke buyer **MATI via flag `WHATSAPP_CREDENTIAL_DM_ENABLED=false`** (default) pasca-restriction nomor BOT (memulai chat baru = yang dibatasi WA) — kode + mekanisme DM UTUH di bawah gate, nyalakan lagi = 1 env + deploy. Selama mati: kredensial via email + panel web + kirim manual HP; order channel whatsapp legacy di-route ke `manual_required`. Outbox dipacing manusiawi (`WHATSAPP_OUTBOX_PACE_MS` 6 dtk + jitter ≤3 dtk, cooldown 60 dtk/destinasi, auto-pause lunak setelah 3 sinyal bahaya berurutan → `whatsapp_outbox_paused` di hasil cron). Delivery settled bila token terbit; dua-duanya gagal = retry, satu gagal = catat parsial | P0 ✅ live 2026-09-18 |

### 2.2 Functional — Admin

| ID | Requirement |
|----|-------------|
| FR-A1 | Admin login terpisah di `/admin` (email + password, rate-limited) |
| FR-A2 | Dashboard admin: pesanan lunas, omzet, modal, untung, margin dan rata-rata/order; periode Hari/Minggu/Bulan WIB mengendalikan SELURUH kartu, grafik, kontribusi omzet, untung supplier/channel dan Top 5. **2026-10-15 ✅ implementasi (publikasi CI):** omzet dikurangi modal per item (WR/SK/stok sendiri/Pedia), keranjang campuran tidak menghilangkan modal stok sendiri. Modal transaksi baru disnapshot atomik saat lunas (0063), riwayat tanpa snapshot tetap ditandai estimasi pada data/ekspor, tanpa kartu peringatan di Ringkasan. Hari ini memakai grafik per jam, minggu/bulan harian; mendukung rugi, sumbu jumlah order terpisah, donat kontribusi omzet dan batang untung. Top 5 memakai seluruh transaksi dalam periode, tanpa batas 500 order. **2026-10-15 pembaruan:** pilih bulan historis atau rentang inklusif WIB hingga 366 hari dari toolbar tanpa card/tombol Terapkan; perubahan bulan atau pasangan tanggal lengkap dan valid otomatis memuat laporan. Tolak tanggal invalid/masa depan; metadata tanggal/WIB/waktu pembuatan sejajar sesi admin, tanpa teks total/pending/pill stok menipis. Loading/gagal menyembunyikan metadata/angka lama. Tombol PDF dan Excel .xlsx sejajar di samping selector bulan/tanggal, membungkus pada layar sempit dan diunduh langsung dari respons yang sama (Ringkasan/Harian/Supplier/Channel/Top Produk); kredit Pedia dibedakan dari pembayaran merchant, omzet mencakup keduanya dan pembulatan invoice, untung belum dikurangi MDR/operasional. |
| FR-A3 | CRUD Produk: tambah/edit/hapus, upload foto (ke R2), set harga, diskon, kategori, stok, deskripsi, status aktif/nonaktif. **2026-09-24 ✅ live:** S&K + cara aktivasi per varian bisa disunting admin (WR & non-WR, migrasi 0041); suntingan varian WR dijeda otomatis bila WR mengubah teksnya (pembeli melihat teks WR terbaru, admin mendapat badge "S&K perlu ditinjau"). **2026-09-28:** produk single/non-varian (toggle varian OFF) paritas dengan multi-varian — Min. Beli + Masa Garansi + Cara Pengiriman + Template pesan tampil di tab Varian dan disimpan sebagai 1 varian `Default` eksplisit (update in-place, bukan insert baru). **2026-09-28 ✅ live:** atur posisi produk dari admin — kolom Urutan + tombol ↑↓ per baris (swap tetangga global, bukan tetangga satu halaman) + field angka Urutan tampil 0–999999 di modal edit; tidak ada endpoint baru (pakai PUT /api/products/[id] yang sudah terima sortOrder). **2026-09-29 fix display + exact-step + anti-429/lompat (laporan owner beruntun):** kolom Urutan = nomor posisi 1..N (raw key hanya di tooltip); reorder atomik POST /api/products/reorder (tepat 1 posisi, realtime, modal read-only); scope `products:reorder` 120/mnt + tulis hanya baris berubah (bukan kuota cron); badge bisa diketik untuk lompat 30→1 dalam 1 request. **2026-09-29 Terjual editable (permintaan owner):** angka Terjual bisa diubah admin dari kolom tabel (ketik + Enter, PATCH sold-count) maupun field Terjual di modal edit (ikut PUT); SET absolut sebagai baseline baru — order lunas tetap `sold_count += qty` di atasnya (perilaku increment tidak berubah). **2026-10-01 tab status toko ✅ live (permintaan owner: "tidak tahu kenapa produk tidak tampil"):** daftar Produk punya tab Live/Hidden/Nonaktif/Semua (default Live = yang tampil di toko SAAT INI; Hidden = toggle ON tapi tak tampil + sebab jujur "Kalah dari X" / "stok habis" / "nonaktif tapi stok tersedia"; Nonaktif = toggle OFF) + badge count + kartu "Hidden otomatis" + pagination 20/50/100 (persist, default 20); ↑↓ yang melewati batas halaman pindah halaman mengikuti produk. **2026-10-02 selip restok ✅ live (laporan owner: posisi 6/8 habis → restok terdampar 20+):** sync yang mendeteksi transisi stok parent 0→ready menyelipkan `sort_order` kembali ke sekitar posisi semula (±1–2 bila slot terisi; tanpa write bila slot kosong); reorder manual tetap otoritas tertinggi. **2026-10-01 tab panel WR/SK ✅ live (permintaan owner: "scroll jauh + acak"):** tab dalam-halaman Ringkas/Antrean/Markup/Aturan (WR) + Audit/Alat (SK: mutasi + transaksi / cek akun + lock + detail; sandbox di Antrean) — lazy-load per tab + cache, antrean pagination 20 + total, markup sub-tab Live/Hidden/Off + badge + pagination 20/50/100  **2026-10-15 ✅ implementasi:** tab Varian berupa accordion dengan ringkasan nama/harga/status/stok; harga-modal dan stok-minimum tersusun 2–3 kolom desktop/1 kolom mobile. Stok unique mengikuti inventory. Produk stok sendiri memiliki S&K bersama dan cara penggunaan/aktivasi per varian, disimpan atomik bersama Simpan Produk (termasuk varian baru); link/akun/key tetap terpisah di inventory. Teks supplier tetap memakai endpoint tinjauan khusus. |
| FR-A4 | Kategori management: AI & Chatbot, Streaming & Hiburan, Produktivitas & Office, Desain & Video, Developer & Tools, Bundle Hemat (taksonomi 6 kategori 2026-09-28, migrasi 0046; rename Bundle Kucing → Bundle Hemat dengan slug bundle-hemat dipertahankan; slug lama dialias di kode; DELETE ditolak 409 selama masih dipakai produk) |
| FR-A5 | Manajemen Pesanan: list semua pesanan (filter Pending/Lunas/Dibatalkan), detail pesanan + foto bukti transfer, tombol Konfirmasi Lunas / Batalkan. **2026-10-01 ACC manual QRIS ✅ live (laporan owner: hook DANA gagal padahal dana benar masuk):** order QRIS pending punya tombol **ACC pembayaran** (hijau) + **Tolak** (merah) di baris pesanan — ACC memakai `transitionPendingPaymentToPaid` yang SAMA dengan webhook (ledger ikut lunas + fulfillment + email kredensial + notif buyer seperti hook normal), catatan verifikasi mutasi wajib min. 10 karakter + tercatat `[ACC-QRIS manual email]` di admin_note, guard ketat (hanya QRIS pending, kalah race vs hook = 409 jujur) |
| FR-A6 | Saat konfirmasi: admin bisa input catatan/lisensi/key yang akan dikirim ke pembeli |
| FR-A7 | Tampilkan status konfigurasi QRIS dinamis DANA; payload merchant dan webhook secret hanya dikelola sebagai secret server |
| FR-A8 | Kelola metode pembayaran: edit nomor e-wallet, SeaBank, dan bank lain menyusul (tanpa deploy ulang) |
| FR-A9 | Laporan sederhana: export CSV pesanan, filter tanggal |
| FR-A10 | Pengaturan toko: nama, logo, WA admin, footer |
| FR-A11 | Daftar email dari form footer tersimpan dan hanya dapat dilihat admin |

### 2.3 Functional — Sistem
| ID | Requirement |
|----|-------------|
| FR-SYS1 | Upload gambar produk & bukti transfer ke Cloudflare R2 (10GB gratis) |
| FR-SYS2 | Simpan data produk, pesanan, kategori di Cloudflare D1 (SQLite, 5GB gratis) |
| FR-SYS3 | Generate kode pesanan unik format `AXV-YYYYMMDD-XXXX` |
| FR-SYS4 | Validasi file bukti: hanya JPG/PNG/WebP, max 5MB |
| FR-SYS5 | Kirim dan balas notifikasi WA via gateway Baileys Heroku akun #1 (`axvara-wa-gateway`); allowlist grup + flag discovery/payment/proof/fulfillment | P0 ✅ live |
| FR-SYS6 | SEO & GEO: meta title/description + canonical per halaman (produk, artikel, statis), sitemap, OG image 1200×630, JSON-LD Organization/WebSite/ItemList (beranda) + Product (gambar absolut, AXVARA sebagai penjual) + Article; katalog beranda dirender server; `/llms.txt`; robots menutup halaman transaksi + izinkan crawler AI; `/checkout` & `/pesanan/*` noindex | ✅ dasar live; perluasan SEO & GEO PR 2026-09-24 (live setelah merge + deploy) |
| FR-SYS7 | Sync WR satu sweep penuh per run (Opsi A, budget khusus katalog; cursor sebagai fallback); produk baru WR otomatis masuk katalog | ✅ live |
| FR-SYS8 | Env Pages WAJIB `secret_text` (plain_text tidak terbawa deploy); deploy hanya via CI | Aturan operasional |
| FR-SYS9 | Minimum pembelian ditegakkan server: quote 409 `below_minimum`, orders 409, guard atomik batch; UI/bot hanya cermin | P0 ✅ live (migrasi 0034) |
| FR-S19 | Email wajib SEBELUM bayar bila keranjang berisi varian WR Invite/Link (otomatis dari `wr_type`) atau produk `require_email=1` (toggle admin; fix 2026-09-25: centang kini termuat ulang di editor dan ikut tersimpan saat membuat produk baru): form web validasi + label dinamis, API 422 guard DB, Telegram minta + simpan + teruskan ke WR, WA tolak + arahkan kanal ber-form. **2026-10-07 (temuan admin WR):** `email_invite` hanya dikirim untuk Invite/Link (`wrTypeUsesEmailInvite`); Private/Sharing di-omit total agar tidak muncul TARGET ACCOUNT INVITATION palsu di dashboard WR — UX tetap 1-field tanpa copy baru | P0 ✅ live |
| FR-SYS10 | Bot email WR→buyer white-label: email WR (label Gmail WR-INGEST) diteruskan otomatis sebagai email branding Axvara (template Diproses/Invite Terkirim, nol jejak WR) via Resend; fallback WA bila buyer tanpa email; idempoten gmail_message_id; cari manual invoice WR di tab Warung Rebahan | P0 ✅ live 2026-09-17 |
| FR-SYS11 | Kartu antrean Ringkasan wajib membawa filternya ke section tujuan (bukan sekadar pindah tab), setiap filter aktif tampil sebagai chip yang bisa dilepas, dan satu nama metrik memakai satu satuan di semua layar | P1 ✅ live 2026-09-19 |
| FR-SYS12 | Editor produk bertab dengan aksi simpan yang selalu terjangkau; menu sidebar hanya untuk layar kerja harian (layar konfigurasi sekali-pakai jadi tab Pengaturan, `?section=` lama tetap sah); kartu metrik mengikuti filter aktif | P1 ✅ live 2026-09-20 |
| FR-SYS13 | Setiap timestamp yang ditampilkan ke pembeli/admin memakai jam WIB yang benar: nilai D1 (UTC berformat spasi) di-parse sebagai UTC lalu dirender `timeZone: "Asia/Jakarta"` lewat satu helper kanonis, sehingga jam yang terlihat sama di perangkat mana pun dan tidak mundur 7 jam | P0 ✅ live 2026-09-20 |
| FR-SYS14 | Varian yang stoknya di bawah minimum (stock < min_qty, stock ≠ -1) diperlakukan tak tersedia di PDP/modal/keranjang/checkout-direct — qty berapa pun pasti gagal di quote, jadi tolak sejak awal, bukan dead-end di checkout; editor admin memuat SEMUA varian termasuk nonaktif agar bisa diaktifkan ulang | P1 ✅ live 2026-09-20 |

### 2.4 Non-Functional

| ID | Kategori | Requirement |
|----|----------|-------------|
| NFR-1 | Performance | Lighthouse Performance > 95, LCP < 2.0s di mobile 4G, bundle JS < 200KB |
| NFR-2 | Design | Apple Store level: glassmorphism, blur, animasi spring 60fps, tidak ada layout shift |
| NFR-3 | Responsive | Mobile-first, sempurna di 320px–1440px, keranjang drawer di mobile full-height |
| NFR-4 | Keamanan | Admin behind auth, upload file type check, no SQL injection (D1 prepared statement), rate limit checkout |
| NFR-5 | Availability | 99.9% via Cloudflare CDN, Pages unlimited bandwidth, R2 99.99% durability |
| NFR-6 | Biaya | Rp 0/bulan infra (Pages + D1 + R2 free tier), hanya domain |
| NFR-7 | Aksesibilitas | Warna kontras WCAG AA, keyboard navigable, alt text |
| NFR-8 | Bahasa | UI Bahasa Indonesia (formal santai), harga Rupiah |
| NFR-9 | Kuota D1 | ✅ Implementasi 2026-10-16, publikasi melalui CI: katalog publik memakai cache server eksplisit (Market 30 dtk/produk tunggal 10 dtk, Pedia dan kategori 60 dtk). Pedia hanya membaca layanan rujukan aktif. Quote/order/status tetap memeriksa data aktual. Ringkasan admin dimuat saat section Ringkasan dibuka; laporan standar memakai satu agregasi bersama, snapshot keuangan privat terenkripsi maksimal lima menit (revisi 2026-10-19) dan waktu pembuatan aktual; status operasional Ringkasan maksimal 60 dtk. Cleanup data kedaluwarsa per jam; expiry pembayaran, fulfillment dan recovery order tetap setiap tick. Target terbaru 2026-10-17 ≤3 juta rows_read/hari perlu diukur satu siklus reset setelah rilis, bukan jaminan kapasitas. |
| NFR-10 | Maintenance kuota | ✅ Implementasi 2026-10-17, publikasi melalui CI: saat D1 mengembalikan error kuota baca/tulis harian, halaman Market/Pedia menampilkan maintenance sementara dengan estimasi 07.00–08.00 WIB dan tanggal reset berikutnya, tombol order manual serta coba buka toko. Hub WhatsApp menyediakan pilihan nomor aktif dan support Telegram tanpa database; jam layanan admin tetap ditampilkan. Pesanan yang sudah dibayar diarahkan ke admin dengan kode dan bukti. Toko kembali tersedia setelah pemeriksaan D1 berhasil; estimasi bukan janji penyelesaian. API/webhook/cron tidak diganti halaman HTML. |


Revisi kuota lanjutan 2026-10-17 ✅ implementasi/verifikasi lokal, publikasi CI:
seluruh Ringkasan memakai snapshot privat maksimal 60 detik setelah pemeriksaan
sesi/parameter. Revisi 2026-10-19: keuangan memakai snapshot terenkripsi maksimal
lima menit lintas proses pada lokasi Cloudflare yang sama, dengan waktu pembuatan
asli; status operasional tetap maksimal 60 detik. Umur snapshot tidak diperpanjang
saat pindah periode/proses. Laporan rentang historis tetap dihitung baru. Katalog, kategori,
pencarian dan bestseller Telegram berbagi snapshot publik 30 detik; detail/
checkout memvalidasi harga/stok aktual. Antrean pasangan berubah diproses
bertahap lewat diff dan cron cleanup existing; kegagalan/perubahan bersamaan
menyisakan pekerjaan untuk retry, sweep penuh tetap cadangan. Monitor analytics
akun tiap jam memuat baca/tulis, proyeksi dan anggaran tersisa; risiko melampaui
5 juta reads/100 ribu writes, ≥90% penggunaan atau data tak tersedia menghasilkan
warning/job gagal GitHub Actions. Jadwal/analytics dapat terlambat, notifikasi
mengikuti pengaturan GitHub owner. Target terbaru ≤3 juta reads/hari perlu
satu siklus reset produksi 07.00–07.00; hasil fixture bukan jaminan bebas limit.

Revisi operasional 2026-10-17 ✅ implementasi, publikasi CI: rilis kode tanpa perubahan database dapat memakai bukti migrasi dari rilis main sukses dengan berkas DB identik; berkas berubah/bukti tidak lengkap tetap memerlukan Wrangler remote sukses sebelum deploy. Pengingat saldo ProviderSMM/IndoSMM wajib berhasil membaca dan mereservasi penanda sebelum kirim; gangguan D1 menunda alert saldo, tanpa spam tiap tick. Throttle enam jam/penurunan Rp5.000 dan notifikasi pembeli tetap.

---

## 3. User Flow

### 3.1 Flow Pembeli — Happy Path (Tanpa Login)

```
1. Buka axvara.tech → Hero "Gerbang Semua Tools Premium" + Search
2. Scroll katalog / klik kategori AI Gateway
3. Klik produk "ChatGPT Plus 1 Bulan" → halaman detail
4. Klik "Tambah ke Keranjang" → drawer muncul dari kanan, item + subtotal
5. Klik "Checkout" di drawer
6. Isi Nama, No WA, Email (opsional)
7. Pilih Metode Pembayaran:
   - [] DANA / Gopay / Shopeepay — 082135277434
   - [ ] SeaBank — 901812349386
   - [x] QRIS — QR dinamis dibuat setelah order
8. Total dasar Rp 89.000 → Klik "Buat Pesanan"
9. → Halaman pesanan menampilkan QRIS + total unik (mis. Rp89.137) + countdown 15 menit
10. Pembeli scan dan membayar tepat sesuai total
11. Poller GoBiz (GoPay) atau QRIS Hook (legacy DANA) mengirim event sesuai provider invoice; AXVARA mencocokkan nominal aktif dan menandai order lunas atomik
12. Halaman, Telegram, atau WhatsApp menerima status terbaru; fulfillment dijalankan idempotent
```

### 3.2 Flow Pembeli — Batal / Error

- Jika upload bukti transfer manual gagal (file >5MB / bukan gambar) → error inline, tetap di halaman checkout
- QRIS berlaku 15 menit untuk SEMUA kanal (keputusan owner 2026-10-11; sebelumnya Web/Telegram 60 menit dengan 1x perpanjangan QR). QR mati = order kedaluwarsa = stok kembali otomatis via cron ±1 menit (revisi Workers Paid 23 Oktober 2026). Pembeli yang berubah pikiran / salah varian membatalkan sendiri dari halaman pesanan atau lacak pesanan (`POST /api/orders/[code]/cancel`, verifikasi kode + WA/email checkout, stok kembali detik itu juga) tanpa menunggu expiry atau admin.
- Jika pembeli tutup tab sebelum upload → pesanan tetap tercipta status Pending tanpa bukti, admin bisa follow-up WA
- Jika admin tolak (bukti palsu) → status Dibatalkan + WA "Bukti tidak valid, silakan hubungi admin"

### 3.3 Flow Admin

```
1. Buka axvara.tech/admin → login
2. Dashboard: lihat 3 pesanan Pending baru
3. Klik pesanan AXV-20260831-0012 → lihat detail: produk, pembeli, total, bukti foto (dari R2)
4. Buka aplikasi DANA/SeaBank, cek mutasi Rp 89.000 masuk
5. Klik "Konfirmasi Lunas" → modal input Lisensi/Key/Catatan → Kirim
6. → Status jadi Lunas, pembeli otomatis dapat WA, stok berkurang jika ada
7. Admin bisa tambah produk baru: /admin/products/new → upload foto → simpan → langsung tampil di storefront
```

### 3.4 State Pesanan

```
Pending (baru, tunggu verifikasi) 
  → Lunas (admin konfirmasi, bukti valid)
  → Dibatalkan (admin batalkan / bukti tidak valid)
  → Kadaluarsa (WA QRIS 15 menit; Telegram/Web maksimal 1 QR pengganti dan selesai pada deadline QR terakhir; transfer manual 24 jam; stok dikembalikan)
```

---

## 4. Katalog Awal (Seed Data)

Kategori:
- **AI Gateway** — akses gateway GPT-4o, Claude, Gemini hemat token
- **Akun Premium** — ChatGPT Plus, Claude Pro, Midjourney, Perplexity Pro, CapCut Pro
- **Tools Pro** — Canva Pro, Adobe CC, Notion Plus, Grammarly
- **Bundle Kucing** — paket 3-in-1 AI, paket creator

MVP seed: 8–12 produk dummy dengan foto placeholder premium + harga realistis (Rp 25.000 – Rp 350.000)

> Status 2026-09-15: katalog live 50 produk / 97 varian (manual + sync WR 48 produk);
> seed dummy sudah digantikan data produksi.

---

## 5. Payment Spec — Manual Transfer & QRIS Dinamis DANA

### 5.1 Metode Aktif (V1)
- **E-Wallet:** DANA / Gopay / Shopeepay → **082135277434** (1 nomor untuk semua)
- **Bank:** SeaBank → **901812349386**
- **Bank lain menyusul:** field dinamis di admin, bisa tambah BCA/Mandiri/BRI tanpa deploy
- **QRIS:** payload merchant DANA Business tersimpan sebagai Pages Secret dan diubah menjadi QRIS dinamis per order. **Rail GoPay (2026-10-02 Fase 0, default mati):** payload `GOPAY_STATIC_QRIS` + poller server + webhook `/api/webhook/gopay` ber-secret `GOPAY_POLLER_SECRET`; alih rail via `QRIS_ACTIVE_PROVIDER=gopay`. **✅ 2026-10-16:** merchant GoPay aktif diganti menjadi **axvara.tech** (`G284624569`, NMID `ID1026616934059`); invoice lama tetap diverifikasi ke merchant asal yang tersimpan di payload invoice, invoice baru memakai merchant axvara.tech — poller memeriksa kedua akun GoBiz secara terpisah.

### 5.2 Aturan
- QRIS diverifikasi dari event merchant ber-secret sesuai provider invoice; SeaBank/e-wallet tetap maintenance
- Upload bukti hanya wajib untuk metode transfer manual
- Satu pesanan bisa pakai 1 metode saja
- Harga, stok, dan rekening dikunci dalam quote server bertanda tangan selama 60 menit; retry quote yang sama tidak membuat order ganda
- Stok direservasi ketika order Pending dibuat dan dikembalikan jika Dibatalkan/Kadaluarsa
- QRIS dirender per order, bisa di-download, dan tidak tersedia setelah invoice kedaluwarsa
- Kode unik 1–299 membuat nominal aktif tidak ambigu; unique partial index D1 mencegah dua invoice DANA aktif dengan total sama
- Instruksi pembayaran memisahkan QRIS otomatis dari transfer manual agar bukti tidak diwajibkan pada QRIS

### 5.3 Keamanan Payment
- Nomor rekening diambil dari `/api/payment-methods`; payload merchant QRIS tidak pernah dikirim ke API umum atau source control
- Webhook hanya menerima JSON berukuran terbatas dengan `X-Webhook-Secret`, dideduplikasi, dan mencocokkan nominal persis pada invoice aktif
- File bukti disimpan di R2 dengan nama random (bukan original name), hanya admin yang bisa akses

---

## 6. Scope

### MVP (P0) — 1 Minggu
- Homepage Apple Store premium, katalog, detail produk, keranjang drawer, checkout, upload bukti, halaman sukses
- Admin login, dashboard, CRUD produk/kategori, kelola pesanan Pending/Lunas, dan pantau konfigurasi QRIS dinamis
- Deploy ke Cloudflare Pages dengan domain publik tunggal axvara.tech (`axvara.pages.dev` redirect permanen ke domain utama)

> Status 2026-09-15: MVP + P1 selesai dan live (bot Telegram + bot WA + varian + WR).
> Sisa P2: rating/testimoni, kupon, affiliate, Midtrans opsional.

### P1 — Minggu 2
- Cek status pesanan via kode, notifikasi WA otomatis (Baileys), OTP login pembeli, export CSV

### P2 — Next
- Rating/testimoni, kupon diskon, stok lisensi auto-kirim, payment gateway opsional (Midtrans) untuk auto-confirm, affiliate

### Out of Scope MVP
- Login wajib untuk beli, keranjang cross-device, payment gateway, mutasi auto, multi-admin role

---

## 7. Acceptance Criteria (Given/When/Then)

**AC-1 — Checkout QRIS Dinamis**
- Given pembeli di checkout dengan 1 produk di keranjang
- When pilih QRIS dan klik Buat Pesanan
- Then pesanan Pending menampilkan QR dengan nominal unik 15 menit; webhook pembayaran yang cocok mengubahnya menjadi Lunas tanpa bukti manual

**AC-2 — Checkout E-Wallet**
- Given pembeli pilih DANA
- When checkout
- Then tampil nomor 082135277434 + tombol Copy yang copy ke clipboard + toast "Disalin"

**AC-3 — Admin Konfirmasi**
- Given ada pesanan Pending dengan bukti
- When admin klik Konfirmasi Lunas dan isi lisensi
- Then status jadi Lunas dan pembeli dapat WA (atau link WA fallback)

**AC-4 — Keranjang Drawer**
- Given user tambah 2 produk
- When klik ikon keranjang
- Then drawer glassmorphism muncul dari kanan dengan animasi spring, tanpa reload, tampil subtotal benar

**AC-5 — Desain Apple**
- Given buka homepage di iPhone 14
- When scroll
- Then hero parallax halus, navbar glass blur tetap sticky, kartu produk hover glow cyan, no jank 60fps

**AC-6 — Upload Validasi**
- Given pembeli upload file PDF 10MB sebagai bukti
- When submit
- Then ditolak dengan pesan "Hanya JPG/PNG/WebP max 5MB"

---

## 8. Metrik Keberhasilan MVP

- Checkout → Pending conversion > 70%
- Pending → Lunas (admin) < 15 menit rata-rata
- Lighthouse Performance & Accessibility > 90
- Bounce rate homepage < 45%

---

## 9. Lini Produk Tambahan

- **AXVARA PEDIA** — toko SMM kurasi di `pedia.axvara.tech`. **Sinkronisasi working-tree 2026-10-12: implementasi lokal, BELUM deployed; tidak ada flag yang diubah.** Katalog awal 2026-10-08 adalah riwayat rollout berbeda, bukan bukti versi ini live. Dua provider internal (`providersmm` dan `indosmm`), tanpa failover otomatis; IndoSMM services/add dipagari balance IDR dan `INDOSMM_RATE_PER_1000_VERIFIED=true` di VPS. Kredensial/readiness supplier, satuan katalog serta data kurasi awal produksi masih pending. Beranda compact menampilkan hingga 8 unggulan editorial (fallback 6 produk, bukan laris), cari/filter dan Tampilkan semua menjangkau seluruh produk terbit; pintasan Cari lewat link opsional mengenali format saja. Hero "Satu tempat untuk / Layanan sosial media" + typewriter cyan Termurah / Termudah / Terpercaya (2026-10-12 atas permintaan owner). Market/Pedia saling mempromosikan, memakai menu Layanan AXVARA dan footer bersama; Bot Telegram tetap kanal Market. Checkout tiga kelompok memakai radio native, tier/jumlah awal kosong dan satu CTA per viewport **Lanjut ke pembayaran**: quote diperiksa di belakang layar, harga berubah atau kredit meminta **Setujui & lanjut ke pembayaran** sebelum order. Hanya paket terkonfigurasi; perubahan input membatalkan quote, retry ambigu mempertahankan token/kontak terkunci. Order tutup dijelaskan dekat CTA tanpa meminta kontak/kredit/S&K, bukan banner berulang. Quote baru terenkripsi; legacy bertanda tangan yang belum kedaluwarsa tetap diterima. Provider/service/refill/min-profit disimpan pada order, tidak mengikuti remapping tier; submit ambigu masuk needs_check tanpa kirim ulang/cross-provider. Admin mendukung buat produk/tingkat nonaktif, mapping pasangan provider+service, terbit/unggulan/kesiapan terpisah, preview tersimpan, saldo/health/sync per provider dan recovery berpagar. Reprice tidak atomik; tagline tidak dirender di kartu/detail sejak 2026-10-12 (hapus AI slop) dan `description_md` publik opsional tampil detail/order sebagai teks literal escaped dengan newline dipertahankan, bukan Markdown/HTML, tanpa link-helper teknis tambahan. Detail: `docs/PEDIA-PRD.md`, `docs/PEDIA-DESIGN.md`, `issue/planning.md`.

**Followup lokal Pedia 2026-10-12:** quote mengikat `refill_days/min_profit_rp`; snapshot order mempertahankan ketentuan quote (legacy tanpa field fallback tier). Refill requested/submitted/needs_check diblokir berapa pun usianya. Guard margin menyimpan disable sebelum harga baru untuk melindungi replay. ID admin desimal positif kanonik; checklist ID unik setelah trim dan bantuan opsional bertipe string. Diff VPS membatasi layanan `chunkMax` 1..100 (default 50) dan removals 100 independen per batch, maju hanya potongan ber-ack 2xx; >100 removals dilanjutkan, bukan batas pending. Preview storefront tersimpan terpenuhi: `ProductCard` aktual + `OrderClient` embedded dalam mode preview aman; draf tetap privat, tingkat nonaktif dengan paket layak ikut kurasi, navigasi/pemesanan disabled dan interaksi preview tanpa panggilan API. CTA mobile inline, bukan fixed. Input belum disimpan tidak ikut; unsaved live preview di luar scope. Hasil final aktual MAIN setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau seluruh gate live lulus. Tetap lokal, BELUM deployed; secret/flag tidak diubah atau diverifikasi, tanpa order supplier nyata. Bukti supplier live currency/rate-unit serta kurasi awal produksi/approval owner tetap pending.
- **AXVARA AI** (AI Gateway new-api di VPS Tencent) — menyusul setelah Pedia, belum ada PRD.

## Appendix — Referensi

- Inspirasi fungsional: https://marketku.id/
- Inspirasi desain: Apple Store (apple.com/store), Linear.app, Vercel.com
- Hosting: Cloudflare Pages + D1 + R2 — gratis selamanya, unlimited bandwidth
- Kontak pembayaran: E-Wallet 082135277434, SeaBank 901812349386, QRIS dinamis DANA Business

### Pembaruan panel admin 2026-10-15 (implementasi, publikasi via CI)

- Banner: sakelar Aktif/Nonaktif bergaya Produk di samping Edit langsung di daftar; posisi global unik 0–999 untuk banner aktif maupun nonaktif. Sejak24Oktober urutan disimpan melalui drag/naik-turun atomik, create append dan delete merapatkan posisi. Popup homepage menampilkan seluruh banner aktif yang belum disembunyikan dalam satu carousel dengan konfigurasi bersama dan frekuensi per popup; tanpa antrean modal setelah ditutup.
- Pedia admin: Produk/Layanan Supplier/Pesanan/Kredit, harga tingkat dan riwayat saldo memakai tabel kaca, header/sel/aksi seragam dengan Produk Market. Filter kompak, Edit putih dan sakelar publikasi sejajar; kesiapan tetap terpisah dari publikasi.
- Rekonsiliasi QRIS menampilkan provider efektif invoice baru dan provider milik setiap event (riwayat DANA dipertahankan). Konfigurasi lengkap dibedakan dari kesehatan poller/sesi; ACC mengharuskan pemeriksaan merchant sesuai invoice.
- Transisi Market/Pedia menampilkan logo putih. Filter X hanya ikon dengan nama aksesibel X; nama layanan seperti Followers X tetap utuh.
