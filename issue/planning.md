# Planning — Ekosistem AXVARA & Pedia untuk End User

Tanggal awal: 2026-10-11; status disinkronkan 2026-10-12 berdasarkan diff/source.

Status: **Implementasi lokal telah tersedia; BELUM deployed di Pages/proxy. Tidak ada flag diubah. Readiness credentials, currency/rate-unit supplier dan kurasi awal data produksi pending.**

Scope: 11 rekomendasi yang disetujui owner, setelah overhaul Pedia sebelumnya.

Acuan: Market sebagai standar visual; Pedia sebagai layanan kedua; layanan berikutnya masih dalam perancangan.

## Latar Belakang

AXVARA harus terasa sebagai satu ekosistem dengan banyak layanan, bukan beberapa website yang tidak saling terhubung. Market sudah menjadi acuan desain, animasi, dan kemudahan transaksi. Pedia perlu mengikuti kualitas tersebut, menampilkan produk terkurasi dari ProviderSMM dan IndoSMM, serta melayani pembeli awam, bukan reseller.

Overhaul sebelumnya meningkatkan keterbacaan, tetapi membuat Pedia terlalu polos, memisahkan footer, dan belum menyelesaikan promosi lintas layanan. Rencana ini mengoreksi arah tersebut tanpa merombak Market yang sudah baik.

Checkbox `[x]` di bawah hanya berarti implementasi/tugas yang dibuktikan source/diff telah ada, **bukan** acceptance visual, test pass, approval kurasi atau live gate. `[ ]` tetap dipakai untuk bukti supplier/QA/rollout, permintaan yang belum diterapkan, dan syarat gabungan yang belum seluruhnya tercapai. Riwayat katalog 2026-10-08 serta QA overhaul 2026-10-11 bukan bukti release diff ini. Audit docs tidak membuka secret, menjalankan order supplier, mengubah kode/test/CHANGELOG, commit/push atau deploy.

## Tujuan

- Identitas, footer, dan jalur perpindahan layanan konsisten di seluruh AXVARA.
- Promosi Pedia terlihat di Market dan promosi Market terlihat di Pedia.
- Storefront Pedia indah, compact, beranimasi halus, dan mudah dipahami di mobile.
- Dua provider menjadi sumber operasional internal; pembeli tetap membeli produk AXVARA.
- Katalog unggulan terkurasi, dengan akses ke semua produk terbit tanpa menampilkan katalog supplier mentah.
- Order sederhana: pilih paket/jumlah → masukkan link/kontak → lanjut ke pembayaran.
- Admin mudah mengkurasi, menerbitkan, dan memantau produk/pesanan kedua provider.

## Prinsip dan Batas Scope

- Pertahankan hero, katalog, keranjang, dan flow Market; ubah hanya titik integrasi yang diperlukan.
- Gunakan token Midnight, cyan, gold, SF Pro/system font, dan pola Liquid Glass yang sudah ada.
- Native CSS/HTML dan dependency terpasang terlebih dahulu; tidak menambah framework animasi atau plugin tanpa kebutuhan nyata.
- Ekstraksi komponen bersama hanya untuk penggunaan nyata Market/Pedia; bukan membangun framework multi-platform generik.
- Tidak membuat platform ketiga, homepage portal pengganti Market, saldo/deposit reseller, atau checkout lintas layanan.
- Tidak mengimpor dan menerbitkan seluruh layanan supplier secara otomatis.
- Tidak membuka order/dispatch produksi hanya karena banner nonaktif dihapus.
- Tidak membuat order berbayar, cancel, atau refill supplier sebagai bagian pengujian tanpa persetujuan terpisah.
- API key tidak ditulis di planning, source, fixture, screenshot, log, atau Git. Integrasi mengikuti pola secret server-side di VPS proxy.

## Temuan Baseline (Historis 2026-10-11, Superseded oleh Implementasi)

- `CommunityBar.tsx` berisi dua kartu Grup WhatsApp dan Bot Telegram; undangan WA ditulis langsung di komponen.
- `PediaNavbar.tsx` memakai `AppSwitcher.tsx` dengan Apps/Pedia/AI; label mobile dipendekkan dan AI belum menjadi layanan siap pakai.
- `pedia/layout.tsx` saat ini merender footer Pedia sendiri, meskipun komentar lamanya menyebut footer bersama.
- Footer Market masih mengandung klaim khusus Market seperti aktivasi 5–15 menit; tidak boleh menjadi janji global Pedia.
- Beranda Pedia menampilkan semua produk, section link di bawah katalog, serta banner order nonaktif.
- `OrderClient` memilih tier dan jumlah otomatis, dengan dua aksi Periksa harga → Lanjut ke pembayaran.
- Schema/model sudah mengenal supplier, tetapi sync, katalog publik, dispatch, saldo, dan beberapa write admin masih spesifik ProviderSMM.
- Harga publik sudah menyembunyikan ID/rate supplier; boundary ini harus dipertahankan.
- Dokumentasi IndoSMM: `POST https://indosmm.id/api/v2`; services/add/status/refill/refill_status/cancel/balance. Contoh respons memakai USD; belum membuktikan mata uang akun sebenarnya.
- Dokumentasi services tidak menyediakan statistik best seller maupun durasi refill yang lengkap.

### Bukti Working-Tree 2026-10-12

- `src/lib/site.ts` + `shared/{ServicesMenu,CrossServicePromo}`: menu Market/Pedia, promo dua arah/UTM, URL komunitas terpusat; CommunityBar Pedia+Bot Market dan satu `Footer` kedua layout. AppSwitcher dihapus; /link grup memakai konstanta, Pedia /link tetap tersembunyi.
- `home-client.tsx`, `PlatformGrid.tsx`, `Typewriter.tsx`: featured maks 8/fallback 6 tanpa klaim laris, full-catalog search/filter/all, grid 1/2/3, harga/jumlah/tier/refill sepadan, Cari lewat link terlipat, suffix faktual accessible/tab-hidden/reduced-motion aware.
- `order-client.tsx`: tier/qty null, satu CTA quote+order, consent harga berubah/kredit, invalidation/expiry/single-flight/ambigu retry token sama; order mati tanpa kontak, pesan dekat CTA saja.
- `proxy/sync/quote/dispatch` + API Pedia/admin/cron/supplier-sync: provider-aware composite identity, IDR-only, encrypted quotes + legacy HS256, snapshot order, submitting sebelum jaringan, needs_check tanpa retry/failover, recovery berpagar. Proxy `src/{psmm,psmm-diff,index}.ts` punya /indosmm, gate currency/unit dan durable reservation/fsync.
- `PediaManager.tsx`: create produk/tier nonaktif, provider filter/mapping, preview storefront tersimpan terpenuhi, publish/featured/readiness terpisah, API refill vs masa kurasi, saldo live/cache/error/pricing/sync per provider; save/reprice tidak atomik. Tagline tampil kartu/detail; `description_md` katalog publik opsional tampil detail/order sebagai teks literal escaped dengan newline dipertahankan, bukan Markdown/HTML, tanpa link-helper teknis tambahan. Preview memakai `ProductCard` aktual + `OrderClient` embedded dalam mode preview aman, termasuk draf privat dan tingkat nonaktif dengan paket layak; navigasi/pemesanan disabled, interaksi tanpa panggilan API dan CTA mobile inline, bukan fixed. Input belum disimpan tidak ikut; unsaved live preview di luar scope.
- Followup: quote mengikat `refill_days/min_profit_rp`, snapshot mempertahankan ketentuan quote (legacy tanpa field fallback tier); refill requested/submitted/needs_check diblokir berapa pun usianya. Disable margin disimpan sebelum reprice untuk melindungi replay. ID admin desimal positif kanonik; checklist ID unik setelah trim dan bantuan opsional bertipe string.
- Diff VPS membatasi layanan `chunkMax` 1..100 (default 50) dan removals 100 secara independen per batch; antrean/snapshot maju hanya potongan ber-ack 2xx. >100 removals dilanjutkan, bukan batas pending; guard kosong/>50% missing tetap berlaku.
- Hasil final aktual MAIN setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau seluruh acceptance/gate live lulus.

## 11 Paket Pekerjaan dan Kriteria Penerimaan

### 1. Promosi dan Integrasi Lintas Layanan

- [x] Ganti kartu Grup WhatsApp di posisi CommunityBar dengan CrossServicePromo Pedia; Bot Telegram Market tetap.
- [x] Tambahkan CrossServicePromo Market di beranda Pedia sebelum katalog.
- [x] Bedakan layanan dari kanal order; Bot berlabel kanal Market, tidak menjanjikan order Pedia.
- [x] Grup WA di Footer dan /link memakai WA_GROUP_HREF di site.ts; Bot TG_BOT_HREF, tidak menduplikasi undangan.
- [ ] Saat layanan ketiga benar-benar live, gunakan strip layanan dengan ukuran kartu tetap, bukan terus mengecilkan tombol. Tidak membuat placeholder platform sekarang.
- [x] Menu/promo/footer memakai URL host absolut; promo UTM source=axvara|pedia + medium=cross_promo.

**Diterima jika:** pengunjung kedua beranda menemukan layanan lain sebelum footer; navigasi balik benar; teks dan target sentuh tetap nyaman di mobile.

### 2. Navbar: Ganti Pill Apps–Pedia–AI

- [x] Hapus segmented pill/AppSwitcher dari working-tree Pedia.
- [x] ServicesMenu Layanan AXVARA di Market/Pedia, hanya dua layanan dengan ikon/nama/fungsi, tanpa AI placeholder.
- [x] Akses katalog/cari/keranjang Market dan navigasi Pedia sesuai konteks tetap di source; regresi runtime masih perlu QA.
- [x] Menu mobile memakai nama lengkap/fungsi, panel fixed; bukan label dua huruf.
- [x] Disclosure mendukung Tab/Enter + panah/Home/End, Escape focus-return, outside click/blur dismiss; overflow clipping header dihapus. QA keyboard/geometry aktual tetap pending.

**Diterima jika:** tidak ada tujuan AI yang belum siap; menu lintas layanan bisa dioperasikan tanpa mouse; navbar tidak overflow.

### 3. Footer AXVARA Bersama

- [x] Kedua layout memakai komponen Footer yang sama.
- [x] Brand/sosial/layanan-kategori/bantuan/newsletter konsisten di source.
- [x] Copy ekosistem mengganti janji global Bergaransi/Aktivasi 5–15 menit.
- [ ] Pastikan tautan Market/Pedia, bantuan, ketentuan, kategori, newsletter, dan pelacakan bekerja dari kedua host.
- [x] Satu Footer/layout dan padding bawah mobile+safe-area tersedia; bukti tidak tabrakan aktual menunggu visual QA.

**Diterima jika:** struktur dan style footer sama; tidak ada klaim garansi universal Pedia; semua link dan form tetap fungsional.

### 4. Beranda Pedia yang Indah dan Compact

- [x] Urutan hero → promo Market → cari/filter → featured/fallback → semua → cara pesan/FAQ → Footer tersedia.
- [ ] Glow hero statis/glass/hover-tap/motion-safe sudah ada; motion masuk khusus tidak ditambahkan dan acceptance performa/visual belum diukur (bukan seluruh butir selesai).
- [x] Kartu compact nama/harga/jumlah/refill paket sama + aksi Lihat paket.
- [x] Filter berikon/wrap dan search berlabel.
- [x] Grid source: 1 kolom <360px, 2 mulai 360px, 3 desktop; keterbacaan nama panjang masih gate QA.
- [x] catalogCard menyatukan harga/jumlah/tier/refill dari satu paket.

**Diterima jika:** katalog tidak terasa seperti tumpukan kartu tinggi; harga/jumlah jelas; teks tidak terpotong; target sentuh minimal 44 px untuk kontrol utama.

### 5. Pintasan Cari Lewat Link

- [x] Section besar lama dihapus.
- [x] Cari lewat link opsional dalam details dekat pencarian.
- [x] Saran seluruh produk cocok platform/jenis, tidak memutuskan satu layanan otomatis; empty suggestion punya arahan katalog.
- [x] Target normalized diteruskan melalui query t ke detail yang dipilih.
- [x] Cari nama/platform tetap utama tanpa link wajib.

**Diterima jika:** pintasan mudah ditemukan, tidak mendominasi hero, error membantu memperbaiki input, dan target tidak hilang setelah memilih layanan.

### 6. Hero Typewriter

- [x] Layanan media sosial tetap, suffix saja berubah.
- [x] Source Typewriter memakai Harga terjangkau / Mudah dipesan / Pilihan terkurasi.
- [x] Permintaan awal Termurah/Termudah/Terpercaya/#1 tetap dicatat sebagai historis tanpa bukti; **tidak dipakai**, bukan klaim yang sudah terverifikasi.
- [x] Typing 85ms/delete 45ms/jeda 2.2s/caret dan min-height suffix ada; CLS/mobile aktual belum diukur.
- [x] Reduced-motion statis, visual aria-hidden + sr-only seluruh frasa, timer pause/resume visibilitychange.
- [x] Deskripsi hero sesuai copy faktual yang diminta.

**Diterima jika:** motion tetap halus di mobile, tidak menyebabkan layout shift, dan tetap informatif tanpa animasi.

### 7. Integrasi ProviderSMM + IndoSMM

- [x] Schema 0059 sudah memuat supplier composite/featured/submitting; kontrak AGENTS proxy dan source kedua repo dibaca saat audit. Tidak diperlukan migrasi baru pada diff ini.
- [x] VPS source menambah /indosmm/:action dengan auth bersama/allowlist/timeout/secret server-side; gate services/add IDR + INDOSMM_RATE_PER_1000_VERIFIED, tanpa konversi kurs.
- [ ] Verifikasi mata uang akun, satuan rate, min/max, tipe layanan, refill/cancel, bentuk error, dan batas API lewat dokumentasi/respons read-only yang diizinkan. Jangan menganggap contoh USD sebagai nilai akun nyata.
- [x] Sync/bounds/mapping memakai (supplier,service_id), currency IDR wajib IndoSMM; legacy providersmm tanpa currency tetap kompatibel.
- [x] Sync/reprice/catalog/quote/admin/saldo/dispatch/status/refill/refill_status/recovery provider-aware; proxy cancel provider-aware tersedia. Tidak ada tombol supplier cancel buyer baru; cancel_credit adalah recovery pra-submit, bukan memanggil supplier cancel.
- [x] Quote mengikat refill_days/min_profit_rp, snapshot mempertahankan ketentuan quote beserta provider/service/rate/supplier ID; mapping tidak mengganti asal dispatch/poll/refill lama. Legacy tanpa field tetap fallback tier.
- [x] CAS submitting + lease 5 menit sebelum network, ambigu/basi → needs_check tanpa retry/failover; proxy reservation exclusive/fsync/fingerprint/cache durable tanpa TTL. Refill/cancel dedupe hanya dengan key.
- [x] Overview/marker diff/log/check/alert per provider; public catalog memakai mirror tersimpan, bukan health live probe.
- [x] Diff layanan chunkMax 1..100/default 50 dan removals 100 independen, hanya potongan ber-ack 2xx maju; >100 pending removals dilanjutkan. Guard kosong/>50% missing tetap ada.
- [x] Refill requested/submitted/needs_check terkunci tanpa batas umur; ID/key ambigu dipertahankan. Disable margin sebelum harga baru melindungi replay.
- [x] Hanya present/Default/rate/bounds/paket valid masuk flow link+qty; tipe flow khusus tidak dipublikasikan.
- [x] Public payload tanpa identity/rate supplier; quote baru JWE encrypted dengan HS256 legacy hingga expiry. Payload legacy signed masih terbaca sampai kedaluwarsa.

**Diterima jika:** kedua provider bisa menjadi sumber tier; routing status/refill benar; tidak ada collision ID/order; harga rupiah dihitung dari dasar tarif terverifikasi; ProviderSMM lama tetap berjalan.

### 8. Kurasi Unggulan dan Tampilkan Semua

- [x] Model produk AXVARA terpisah dari katalog supplier; nama/copy publik dari admin, tidak menerbitkan supplier otomatis. Tagline kartu/detail dan description_md publik opsional detail/order tersedia; kurasi isi produksi tetap pending.
- [ ] Pilih sekitar 6–8 produk unggulan sebagai awal, bukan kuota wajib. Owner meninjau kandidat dan ketentuan sebelum publikasi.
- [x] is_featured → Pilihan AXVARA maks 8; fallback 6 Jelajahi layanan eksplisit bukan ranking. Tanpa badge laris fiktif.
- [ ] Nilai kandidat berdasarkan harga/margin, karakteristik, refill, ETA, dan data hasil/keluhan yang tersedia. Jangan mengklaim terbaik hanya karena murah atau dari nama supplier.
- [x] Tier boleh provider berbeda dan subset Hemat/Standar/Premium; keputusan mapping awal aktual pending owner.
- [x] Tampilkan semua membuka seluruh produk AXVARA terbit.
- [x] Cari/filter memakai full catalog, empty punya reset/link-cari alternatif.

**Diterima jika:** unggulan ringkas, katalog penuh dapat diakses, badge memiliki dasar, serta pilihan terbit/unggulan/nonaktif konsisten.

### 9. Detail dan Order: Pilihan Kosong, Badge, Satu CTA

- [x] Tier/quantity awal null, radio tidak dipilih, total order Belum dipilih.
- [x] Harga awal tiap tier disertai quantity; ringkasan Belum dipilih. Ganti tier yang tak mendukung quantity → null.
- [x] Refill cyan/Tanpa refill gold + teks, bukan warna saja.
- [x] ETA Mulai/Selesai terpisah dengan fallback Belum ditentukan, refill bersyarat bukan garansi penuh/instan default.
- [x] Satu CTA per viewport melakukan quote+order; harga berubah atau input kredit menampilkan nominal server dan Setujui & lanjut sebelum order.
- [x] Checklist/kontak/S&K/kredit/29 menit refresh/invalidation/abort respons usang/in-flight/ambigu retry token sama tersedia. Ini bukan atomisitas backend penuh.
- [x] Jumlah paket-only; tidak ada jumlah bebas.

**Diterima jika:** flow tanpa pilihan default, tanpa tombol pemeriksaan harga terpisah; perubahan harga tidak dibayar diam-diam; double-click/retry tidak membuat order ganda.

### 10. Copy dan Status Pemesanan

- [x] Hint target sesuai platform/jenis + publik/tayangan sesuai metric, bukan jargon generik.
- [x] Format link sesuai/dikenali dijelaskan bukan pemeriksaan keberadaan akun/konten.
- [x] Banner hero/sebelum judul dihapus, pesan order tutup dekat CTA; kontak/kredit/S&K tidak dirender.
- [x] Source flag/gate tetap dipisah; tidak ada flag diubah atau aktivasi produksi dalam tugas ini.
- [ ] Tulis deskripsi produk tentang apa yang dibeli, karakteristik penting, tujuan link, ETA, dan refill; hindari jargon atau janji hasil organik.
- [x] Copy partial/canceled tetap Kode Kredit 180 hari, bukan tunai.

**Diterima jika:** copy singkat membantu tindakan; tidak ada banner berulang; customer tahu batas transaksi sebelum mengisi data; kebijakan kredit tetap terbaca.

### 11. Admin Dua Provider, Satu Daftar Produk Jual

- [x] Shell/table/form/feedback existing, tanpa dashboard baru.
- [x] Lima panel Produk/Layanan Supplier/Pesanan/Kredit/Pengaturan terpisah.
- [x] Alur lokal create nonaktif → cari/mapping → metadata/harga → preview tersimpan → terbit/featured tersedia; approval data live belum dilakukan. Tagline/deskripsi tampil publik sesuai kontrak teks literal escaped.
- [x] Preview storefront tersimpan memakai `ProductCard` aktual + `OrderClient` embedded dalam mode preview aman, termasuk draf privat dan tingkat nonaktif dengan paket layak; navigasi/pemesanan disabled, interaksi tanpa panggilan API dan CTA mobile inline. Input belum disimpan tidak ikut; unsaved live preview di luar scope. Checkbox implementasi, bukan bukti QA final/produksi.
- [x] ID admin desimal positif kanonik; checklist ID unik setelah trim, field bantuan opsional bertipe string.
- [x] Filter supplier/platform/kompatibilitas/mapping, asal provider admin-only.
- [x] Terbit/Unggulan/Siap dijual dipisah; nonfeatured tetap full catalog.
- [x] Mapping pasangan provider+service, modal/margin/harga paket, API refill vs masa kurasi terpisah; gate pricing IndoSMM saat mapping/aktivasi.
- [x] POST existing dipakai create produk/tingkat nonaktif, tanpa migrasi/abstraksi baru.
- [x] Snapshot asal/status/recovery/konfirmasi; mark_submitted cek provider status/conflict, retry/cancel_credit blocked setelah add dicoba/ID ada.
- [x] Pengaturan per-provider saldo live/cache/error/pricing/sync; partial sync/save/reprice bukan sukses penuh/rollback palsu.

**Diterima jika:** admin bisa menyiapkan produk dari kedua provider tanpa SQL manual; preview sesuai storefront; perubahan mapping tidak merusak order lama; mobile admin dapat digunakan.

## Urutan Implementasi dan Dependensi

| Fase | Pekerjaan | Gate sebelum lanjut |
| --- | --- | --- |
| A — keputusan & baseline | Konfirmasi suffix hero, status transaksi, kurasi awal; audit kontrak/mata uang IndoSMM; simpan baseline screenshot Market/Pedia/admin | Tidak ada asumsi tarif/refill/claim yang dianggap fakta; scope Market terkunci |
| B — ekosistem bersama | 1, 2, 3: promosi, menu, footer | Link kedua host, keyboard/mobile, newsletter, Market regression lulus |
| C — fondasi dua provider | 7: proxy, data/sync, harga, routing lifecycle, saldo | Fixture kedua provider, collision ID, timeout/dedupe, pesanan lama lulus; belum membuka dispatch produksi |
| D — kurasi & admin | 8 dan 11: kandidat, mapping, preview, publish/featured | Owner meninjau produk awal; semua produk unggulan dapat diproses sesuai ketentuan |
| E — storefront & checkout | 4, 5, 6, 9, 10 | Visual dan flow fully hydrated lulus, termasuk order mati dan perubahan harga |
| F — integrasi akhir | Dokumentasi, full regression, build Pages, rollout terpisah | Kriteria selesai terpenuhi; aktivasi flag/transaksi hanya atas keputusan owner |

Bagian visual dapat dikerjakan paralel memakai fixture saat fondasi provider dibuat, tetapi tidak dipublikasikan dengan klaim atau mapping yang belum diverifikasi. Setiap fase harus menghasilkan diff kecil yang bisa direview; jangan deploy dua implementasi besar tanpa gate.

## Area / File Terkait

- Ekosistem: `src/components/storefront/{CommunityBar,Navbar,Footer}.tsx`, `src/components/pedia/{PediaNavbar,AppSwitcher,PediaBottomNav}.tsx`, `src/app/{(shop),pedia}/layout.tsx`, konfigurasi URL yang ada, `src/app/(shop)/link/link-bio-client.tsx` bila akses komunitas disesuaikan.
- Storefront: `src/app/pedia/{home-client,p/[platform]/platform-client,o/[slug]/order-client}.tsx`, `src/components/pedia/{PlatformGrid,LinkPasteHero}.tsx`, `src/app/globals.css` bila token/motion bersama diperlukan.
- Backend: `src/lib/pedia/{proxy,sync,pricing,quote,dispatch,notify}.ts`, API `pedia/{catalog,quote,orders}`, API `admin/pedia/*`, `src/app/api/supplier-sync/*` dan cron Pedia yang relevan.
- Admin/data: `src/components/admin/PediaManager.tsx`, `drizzle/schema.sql`, migrasi hanya bila model yang ada tidak cukup, test adapter database lokal bila kontrak SQL berubah.
- Lintas repo: `/Users/macbookair/axvara-wr-proxy` untuk API/sync/secret supplier. File konkret ditentukan setelah audit repo proxy, bukan ditebak di planning.
- Docs: `docs/{PRD,DESIGN,ARCHITECTURE,PEDIA-PRD,PEDIA-DESIGN}.md`, `README.md`, `CHANGELOG.md`, `.env.example` tanpa secret, AGENTS kedua repo jika kontrak integrasi berubah.
- Tests: perluas test `pedia-*`, navigasi/footer/launch, admin UX/API, harga, sync, dispatch, quote/orders, dan cron yang sudah ada.

## Risiko dan Pengendalian

| Risiko | Pengendalian |
| --- | --- |
| Market yang sudah bagus ikut berubah terlalu luas | Batasi perubahan ke navigasi/promosi/footer; bandingkan screenshot dan regression flow Market |
| Salah rate/mata uang menghasilkan harga rugi | Verifikasi kontrak akun, normalisasi rate, margin guard, dan fixture non-IDR bila memang didukung |
| ID layanan/order sama pada dua provider | Key gabungan provider+ID; provider asal disimpan pada lifecycle order |
| Timeout menyebabkan order ganda/cross-provider | Persist state/dedupe; rekonsiliasi atau needs_check; tidak auto-failover |
| Refill API disalahartikan sebagai durasi garansi | Masa/syarat dikurasi terpisah; badge tidak berasal dari boolean saja |
| Menu/footer lintas subdomain salah route | Link host eksplisit untuk perpindahan layanan dan test dari kedua origin |
| Animasi/card compact merusak a11y/performa | Stable geometry, reduced motion, focus jelas, target sentuh, no blur berat per kartu |
| Katalog besar menghabiskan CPU/D1 | Sync berbatas/pagination sesuai budget existing; jangan load katalog supplier penuh di storefront |
| Perubahan quote/CTA kehilangan proteksi retry | Uji stale quote, nominal berubah, kredit, double-click, uncertain response, token sama |
| Hapus banner dianggap aktivasi transaksi | Flag tetap terpisah; status ringkas dekat CTA ketika layanan tutup |

## Rencana Test dan Verifikasi

### Automated

- Jalankan `npx vitest run --run` setelah setiap perubahan kode; update assertion yang terpengaruh, bukan menghapus test lama agar lolos.
- Jalankan type-check, lint relevan, dan `git diff --check`.
- Test navigasi/footer dari Market dan Pedia, link komunitas satu sumber, menu keyboard/Escape/focus, dan tidak ada route platform belum siap.
- Test kurasi/featured/all/search/filter, harga+quantity+tier cocok, nonunggulan tetap terbit, dan supplier tidak bocor ke publik.
- Test initial tier/quantity null, harga awal tiap tier, kredit, quote expiry, pergantian input, perubahan harga meminta konfirmasi, dan satu order untuk klik/retry berulang.
- Test sync/catalog/admin/dispatch/status/refill/saldo kedua provider memakai mock; ID sama lintas provider; mapping berubah tidak mengubah provider order lama; unknown supplier ditolak.
- Test supplier error, saldo kurang, malformed JSON, service missing, margin guard, timeout setelah submit, dan kompatibilitas data ProviderSMM lama.
- Test flag order mati: tidak ada permintaan quote/order atau kontak checkout yang sia-sia, status dekat CTA tersedia.

### Dev dan Visual — Obscura Wajib

- GET `/`, `/pedia`, route detail layanan/admin yang diubah, dan CSS harus 200 di dev; periksa tidak ada compile error.
- Periksa 360/390/768/1440 px, nama produk panjang, empty/error/loading state, sticky CTA/footer/bottom nav, menu terbuka, dan reduced motion.
- Bandingkan baseline Market: hero, keranjang, pencarian, dan checkout tidak berubah tanpa alasan scope.
- Verifikasi komponen fully hydrated dan interaksi, bukan hanya SSR screenshot. Gunakan fixture/mock lokal untuk supplier/order; jangan mengirim transaksi nyata.
- Jika flag lokal atau data membuat route tidak aktif, gunakan konfigurasi/fixture lokal yang terkontrol dan dokumentasikan batas verifikasinya; jangan menyebut fixture sebagai bukti produksi.
- Jalankan `npm run build:pages` untuk verifikasi akhir sebelum publikasi, bukan setiap edit.

## Dokumentasi dan Rollout

- Update dokumen relevan di setiap fase implementasi; tandai rencana, lokal terverifikasi, dan live secara akurat.
- Perubahan API/env/schema/flow dicatat di ARCHITECTURE + README + changelog; desain di DESIGN/PEDIA-DESIGN; requirement di PRD/PEDIA-PRD.
- Kontrak proxy diperbarui di AGENTS/docs kedua repo; tentukan urutan migrasi/proxy/Pages sebelum rollout. Jangan menghapus backward compatibility saat order lama masih berjalan.
- Secret IndoSMM hanya pada penyimpanan server-side yang disetujui; perubahan secret/deploy VPS bukan bagian pembuatan planning ini.
- Implementasi tidak mengaktifkan flag transaksi produksi otomatis. Opening order/dispatch memerlukan gate operasional dan keputusan owner tersendiri.
- Publikasi Pages melalui CI/CD `git push origin main` setelah verifikasi dan persetujuan publikasi. Berhenti setelah push diterima, tanpa polling deployment atau deploy Wrangler manual.

## Keputusan yang Masih Perlu Dikunci Saat Implementasi

1. Suffix sudah diimplementasikan versi faktual; klaim awal superlatif tidak dipakai. Persetujuan editorial bila diperlukan tetap terpisah, bukan bukti #1.
2. Mata uang/satuan rate akun IndoSMM, batas API, kebijakan refill/cancel, dan kebutuhan jaringan/proxy.
3. Produk unggulan awal beserta mapping supplier, perbedaan tier, deskripsi, margin, dan ketentuan yang ditinjau owner.
4. Status order/dispatch produksi yang diinginkan dan waktu aktivasi setelah readiness terpenuhi.

## Kriteria Selesai

- [ ] Seluruh 11 paket pekerjaan selesai atau pengecualiannya disetujui dan dicatat secara eksplisit.
- [ ] Market dan Pedia saling mempromosikan dengan navbar/footer konsisten, tanpa route mati atau regresi Market.
- [ ] Pedia indah/compact, memiliki motion accessible, katalog terkurasi, default pilihan kosong, dan satu CTA checkout.
- [ ] Dua provider bekerja end-to-end dalam test/mock; harga dan ketentuan terverifikasi; order lama tidak salah routing; tidak ada secret atau detail supplier bocor.
- [ ] Admin dapat melakukan kurasi sampai publikasi tanpa SQL manual, dengan status/feedback yang jelas.
- [ ] Full test, type-check, lint, build Pages, HTTP dev/CSS, dan Obscura visual-fungsional lulus; batas pengujian dicatat.
- [ ] Dokumen/changelog terkait diperbarui; commit hanya berisi perubahan yang dimaksud dan tidak memuat kredensial.
- [ ] Rollout dan aktivasi mengikuti gate terpisah; tidak mengklaim live sebelum benar-benar dipublikasikan.

## Status Sinkronisasi dan Gap

- Riwayat 2026-10-11: dokumen awal hanya planning. **Superseded 2026-10-12** untuk status implementasi oleh audit source/diff kedua repo; checkbox kode tersedia di atas tidak berarti gate QA/live lulus.
- Scope sinkronisasi ini hanya PRD/DESIGN/ARCHITECTURE/PEDIA-PRD/PEDIA-DESIGN/README/AGENTS/planning repo utama; tidak mengubah kode, test, CHANGELOG, secret, flags, data supplier atau repo proxy, tanpa commit/push/deploy.
- Pending: credentials/readiness kedua supplier, bukti IDR+rate per 1.000/min-max/refill/cancel/error/limit, approval awal produk/featured/ETA/margin/ketentuan pada data produksi, deployment/handoff backup durable state/receiver-before-diff dan aktivasi owner.
- Gap implementasi: motion masuk khusus tidak ditambahkan; resync manual tidak menandai missing. Preview storefront tersimpan sudah terpenuhi; unsaved live preview di luar scope, bukan gap acceptance ini. Save/reprice dan order/kredit/invoice bukan atomik penuh, durable dedupe single-VPS saja, legacy quotes/snapshot punya fallback yang didokumentasikan. Copy publik dan pemotongan removals bukan lagi gap implementasi; isi kurasi awal produksi tetap pending.
- Hasil final aktual MAIN 2026-10-12 setelah preview: **`npx vitest run --run` 2288 test pada 184 file pass**, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; hasil gabungan full acceptance tidak dicentang. Bukti fixture/mock tidak membuktikan supplier nyata, QA produksi penuh atau seluruh gate live/kesiapan membuka flag. Tetap lokal, BELUM deployed; secret/flag tidak diubah atau diverifikasi, tanpa order supplier nyata; bukti live currency/rate-unit dan kurasi awal produksi/approval owner pending.
- Riwayat run terarah audit docs: 128 test pass, 0 gagal (provider/home/order/admin UX/API/launch), bukan hasil full main terbaru atau test proxy/live. issue/planning.md belum tracked Git pada audit ini; tidak di-stage/commit sesuai scope. Tugas sinkronisasi docs ini tidak menjalankan ulang test/build/QA atau mengklaim hasil baru.
