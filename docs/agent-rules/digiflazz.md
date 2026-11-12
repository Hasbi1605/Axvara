# Digiflazz buyer - status env/domain dan keputusan owner (9 November 2026 malam)

- Operasi PM sekitar21.40–22.05WIB: Pages produksi menerima empat `secret_text`:
  `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_API_KEY` (Development Key), `DIGIFLAZZ_WEBHOOK_SECRET`,
  `DIGIFLAZZ_TESTING=true`;75env dikonfigurasi,79/128 termasuk4sistem. Berlaku deployment
  CI berikutnya; jangan mengklaim runtime/sinkron aktif tanpa bukti. Cron katalog
  mulai memakai Development Key sesudah env terbaca; ordering tetap preview P9,
  nickname selalu unavailable selama testing=true.
- Owner memilih **tidak merotasi key**, gerbang brief7.1 ditutup9November malam.
  Bukan bukti rotasi; jangan merotasi otomatis. Dashboard webhook tetap non-aktif
  (7.2 terbuka); belum deposit/Production (7.3) atau transaksi nyata (7.4).
- CNAME `games` ke `axvara.pages.dev` proxied/custom domain Pages ditambahkan,
  status awal initializing, aktif belum diverifikasi. Access belum mencakup Games:
  `/admin` ke apex, `/api/admin` fail-closed. Tidak ada klaim live atau perubahan Access.

# Digiflazz buyer - username utility S1/S1b (9 November 2026, lokal)

- Cek Username adalah transaksi BERBIAYA, bukan nominal topup yang dapat dijual.
  `ffcekusername` (FF+FF MAX), `mlcekusername`, `pubgcekusername` dan nama
  `/cek\s*username/i` wajib tersembunyi dari katalog/sitemap/quote/order baru,
  enable admin409 `not_sellable`, enable-wave melewatinya. Jangan hapus SKU dari
  sinkron: modalnya dibutuhkan cek nickname.
- Hanya endpoint nickname berpagar D1 (`docs/GAMES.md` §5.2, ARCHITECTURE §16.29)
  memakai utility. Max_price modal katalog bila ada, fallback snapshot5/24/80,
  ceiling80/cek; IP10/device5 per15menit, global500/hari UTC. Cache sukses24jam,
  ID salah rc54 satu jam; rc55 bukan ID salah. Testing/kredensial kosong tidak
  melakukan cek berbayar atau mengarang nickname. Pending satu recheck1,5detik
  payload/ref sama; ambigu tetap klaim durable tanpa expiry, tidak membeli ulang.
  S1b lokal: request berikut setelah60detik CAS checked_at mere-poll ref/payload/modal
  asli satu kali. Tanpa slot global/log biaya baru; scope IP10/device5 per15menit
  best-effort per isolate existing terpisah dari admission berbayar D1. Jangan
  mengklaim rate limit free re-poll global/durable; CAS satu per60detik tetap durable.
- Log/admin cost adalah batas modal admission, bukan settlement. Paket kode S1
  tidak melakukan transaksi/deposit atau memasang env (status konfigurasi terbaru
  di atas); pemulihan ambiguity harus memakai
  referensi existing dan bukti supplier, jangan reset klaim supaya membeli lagi.

# Digiflazz buyer - pemilihan seller Games (9 November 2026)

Keputusan owner 9 November 2026, menggantikan kalimat "bukan memilih seller
tunggal untuk semua game" pada langkah 3 di bawah: seller utama **Om\*\*\***
(`seller_id` `D2wn4W`, rating 4,74/40+, rekon H+0, CS 24 jam) plus pengisi celah
(Ci\*\*\* `DAbq6W`, Di\*\*\* `WXJ9Lo`, DF\*\*\* `gdxwZg`, PT\*\*\* `DapG0o` untuk PUBG, dsb.)
sesuai berkas owner `~/OrganizedFiles/Excel/2026-11/Rekomendasi_Seller_Game_Digiflazz.xlsx`
(612 produk, 18 game). Tidak ada satu seller matang yang lengkap untuk semua game.
Nama seller disamarkan sampai deposit pertama; kenali seller lewat `seller_id`.

- Kode produk buyer: huruf kecil `<game>[id]<nominal/varian>`, contoh `ml86`,
  `mlid97` (region Indonesia), `mlwdp`, `ff140`, `ffmax355`, `pubg60`, `gi60`,
  `codm264`. Prefix: ml, ff, ffmax, pubg, codm, gi, mcgg, hok, aov, val, bs, df,
  sus, sm, sg, eggy, undawn, wr. Integrasi kelak memanggil kode ini sebagai
  `buyer_sku_code`; jangan mengganti kode yang sudah terpasang tanpa migrasi.
- Produk berisiko (rating <4,5 atau seller tanpa rating) dibiarkan OFF tanpa seller.
- Kode buyer maksimal 25 karakter (validasi panel HTTP 422).
- Hasil pemasangan 9 November 2026 (snapshot): 612 baris Games (38 baris dobel
  kosong dihapus atas konfirmasi owner), 596 ON, 0 kode dobel. 7 produk yang seller
  rekomendasinya nonaktif diganti seller matang termurah (rating >=4,5, ulasan >=20):
  FF Membership Mingguan/Bulanan + Super Sus 310 -> Ki***, FF 12 DM + PUBG 32400 UC +
  Blood Strike 300 -> Di***, Undawn 250 RC -> Om***. OFF: 14 produk berisiko serta
  PUBG 48600 UC dan Stumble Guys 800 Gems (tidak ada seller matang).
- Harga Max belum diisi; tentukan bersama integrasi `max_price`.
- Keputusan owner 9 November 2026: seller cadangan otomatis untuk AXVARA Games memakai
  baris produk kedua dengan kode buyer akhiran `b` (seller matang lain), dipakai hanya
  setelah Gagal final seller utama. Detail `docs/GAMES.md` §9.
- Snapshot pemasangan cadangan 9 November 2026 (gelombang 1 ML/FF/FF MAX/PUBG): dari 561
  SKU utama ON, 396 mendapat baris `…b` ON (seller matang termurah selain seller utama:
  Br*** 153, Di*** 125, Ki*** 69, DF*** 14, Om*** 13, BC*** 13, Ga*** 9); 165 tanpa
  seller matang kedua (mis. PUBG nominal kecil, Royale/Elite Pass, Cek Username) tanpa
  cadangan. Total baris Games 1.008, ON 992, 0 kode dobel; 16 OFF = 14 berisiko + PUBG
  48600 UC + Stumble Guys 800 Gems.
- Panel membatasi request (HTTP 429 "Too Many Attempts", ~60/menit); otomasi
  dashboard wajib ≤1 request/detik dengan retry `retry-after`. Hapus produk massal
  butuh konfirmasi owner per daftar ID.
- Status: dipasang lewat sesi dashboard owner, bukan API; belum ada deposit,
  koneksi API produksi, webhook atau transaksi.

# Digiflazz buyer - persiapan 2 November 2026

## Batas tahap ini

Update owner 2 November 2026: cakupan diperluas ke **seluruh kategori Games**,
bukan hanya ML/FF. Kredensial sudah disimpan privat; cek Development lewat VPS
berhasil (saldo0, 73 produk akun, 9 Games dari 2 brand). Cek Production belum
berhasil (HTTP400 pada `cek-saldo`); jangan menyimpulkan key salah atau mode live
siap. Snapshot publik
4.380 produk/150 brand tersimpan lokal di
`.digiflazz-catalog-public-20261102.json` (git-ignored `.digiflazz-catalog*`).
Ini minimum harga marketplace, bukan daftar seller terpilih atau bukti region.
Endpoint publik yang teramati dari UI bukan kontrak runtime toko.

Browser agent diarahkan ke login member; API key tidak menggantikan sesi dashboard.
Belum ada seller/produk akun yang ditambah atau diubah. Buyer API hanya membaca
produk yang sudah disetel, tanpa daftar penawaran alternatif/ranking favorit.
Untuk benar-benar memilih seller, owner perlu login pada browser yang dapat
diakses agent. Prioritaskan region/jenis sesuai, seller aktif dan stok tersedia;
bandingkan harga per SKU, gunakan indikator reputasi/favorit yang benar-benar
tersedia sebagai pembanding, bukan klaim populer dari nama/marketing seller.

Owner meminta persiapan yang bisa dilakukan sekarang sesudah PKS clear. Yang
tersedia hanya preflight baca-saja, bukan integrasi toko atau izin belanja saldo.
Tidak ada route webhook, produk publik, dispatch, cron, migrasi DB, env Pages,
perubahan proxy, restart, deposit atau transaksi supplier pada tahap ini.
DigiSwitch tidak diperlukan untuk jalur API JSON website sendiri.

SSH baca-saja pada 2 November 2026 membuktikan Node VPS v20.20.2, service
`wr-proxy` active, `/health` 200 dengan `staticProxy:false`, dan IP keluar
langsung `13.228.147.90` melalui api.ipify.org. Ini snapshot egress, bukan bukti
whitelist Digiflazz atau koneksi akun sudah berhasil. Jika egress berubah,
verifikasi ulang sebelum mengubah whitelist. Jangan deploy worktree proxy yang
berisi perubahan tugas lain hanya untuk persiapan ini.

## Kredensial privat

- Sumber tunggal lokal: `axvara/.digiflazz-credentials`, format **JSON, bukan
  shell env**; jangan `source` file ini. Git-ignore `.digiflazz-credentials*`.
- Buat sekali dengan `node scripts/digiflazz-preflight.mjs --init`. Exclusive
  create menolak overwrite; izin 600, secret webhook acak 32 byte. Jangan merotasi
  file existing otomatis. Pembacaan menolak symlink, izin grup/publik, owner
  berbeda, file bukan regular, atau ukuran >8 KiB.
- Field: `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_DEVELOPMENT_KEY`,
  `DIGIFLAZZ_PRODUCTION_KEY`, `DIGIFLAZZ_WEBHOOK_SECRET`. Username/key awal kosong;
  isi dari dashboard langsung di editor lokal, bukan chat, commit, log atau argv.
  Production Key boleh tetap kosong sampai dibutuhkan secara eksplisit.
- Secret webhook yang dibuat belum dipasang ke dashboard/Pages dan tidak berarti
  webhook aktif. Tidak membaca file ini untuk audit dokumentasi atau mencetak
  isinya. Semua env Pages kelak tetap `secret_text`, hanya jika runtime memerlukan.

## Yang perlu owner lakukan di dashboard

1. **Atur Koneksi > API > Atur > Pengaturan**: Development IP dan Production IP
   `13.228.147.90` jika kedua jalur memakai VPS yang sama. Bukan IP Wi-Fi Mac atau
   IP Cloudflare Pages. Simpan dengan OTP/password sendiri.
2. Ambil Username dan Development Key; isi field JSON lokal. Sesuaikan mode
   dashboard dengan key yang digunakan. Tidak ada fallback/pergantian mode atau
   key produksi otomatis dalam preflight.
3. **Produk > Prabayar > Tambah Produk**: pilih seller dan atur kode buyer untuk
   seluruh kategori Games sesuai permintaan owner. Pertahankan perbedaan game,
   nominal, region dan jenis; bukan memilih seller tunggal untuk semua game.
   Periksa harga akun, region, deskripsi, stok, cut-off, dan `multi`; jangan
   menyamakan harga minimum publik dengan harga akun. Opsi bulk/default termurah
   belum terverifikasi; jangan mengklaim sudah ditambahkan via API.
4. **Atur Profil > Biodata Perusahaan > Data Umum > Pengingat Saldo**: aktifkan
   reminder sesuai kebutuhan (misalnya Rp100.000); bukan isi ulang otomatis.
5. Webhook tetap **Non Aktif**, Payload URL jangan diisi homepage atau endpoint
   fiktif. Deposit dan penjualan live menunggu integrasi, test dan keputusan owner;
   PKS menyebut saldo deposit tidak dapat diuangkan kembali.

## Preflight tanpa pembelian

```bash
node scripts/digiflazz-preflight.mjs --check
# Hanya bila sengaja memakai Production Key, tetap baca-saja:
node scripts/digiflazz-preflight.mjs --check --production
```

CLI memakai SSH fixed-host `ec2-user@13.228.147.90`, key existing
`~/.ssh/axvara-sg-proxy.pem`, BatchMode dan StrictHostKeyChecking. Ia menjalankan
Node sementara lewat stdin/command tanpa menulis file di VPS atau merestart
service. Hanya signature terbatas + username dikirim lewat stdin SSH; API key
tidak dikirim ke VPS atau dimasukkan argv.

Allowlist eksak: POST `https://api.digiflazz.com/v1/cek-saldo` (`cmd:deposit`,
MD5 username+key+`depo`) dan `/v1/price-list` (`cmd:prepaid`, suffix `pricelist`).
Tidak ada `/transaction`, retry, redirect atau pemilihan supplier lain. Timeout
15 detik/request, respons maksimal 1 MiB/request dan batas proses SSH40detik;
respons salah/HTTP gagal gagal tertutup tanpa mencetak body error mentah. Diagnostik
HTTP hanya mengeluarkan status numerik dan nama endpoint dari allowlist.

Laporan: saldo, jumlah produk akun, **semua** SKU kategori Games (tanpa batas50,
bukan hanya filter brand ML/FF), seller/deskripsi serta harga/status/stok/cut-off/
multi. Nama seller dapat disamarkan API; tidak ditebak menjadi identitas penuh.
Katalog kosong sah, bukan bukti harga siap. Data tidak diimpor
ke D1, tidak dipakai menghitung harga jual, dan tidak disimpulkan sebagai bukti
region/availability. Jalankan sesuai kebutuhan, bukan polling daftar harga.

## Gerbang tahap integrasi berikutnya

Bangun dispatch durable dan korelasi `ref_id`/SKU/target/harga sebelum transaksi.
Pending/timeout bukan alasan membeli ulang dengan ref baru; perlu rekonsiliasi
referensi sama sesuai kontrak. Terapkan `max_price` dan pembayaran terverifikasi.
Webhook baru boleh diaktifkan setelah endpoint tersedia, memverifikasi
`sha1=<HMAC-SHA1(body mentah, secret)>` pada `X-Hub-Signature`, memetakan transaksi
durable, dan menangani duplikasi/status terminal secara idempoten. Jangan membuat
endpoint yang mengaku menerima update transaksi tetapi membuangnya.

Test transaksi nantinya memakai Development Key dan `testing:true` dengan fixture
resmi sukses/gagal/pending, bukan pesanan game nyata. Preflight ini **tidak**
mengimplementasikan atau menjalankan transaksi development sekalipun.

## Rujukan resmi

- [Pengaturan koneksi](https://digiflazz.com/blog/post/panduan-buyer-pengaturan-koneksi-api=all)
- [Penambahan produk](https://digiflazz.com/blog/post/panduan-buyer-penambahan-produk=all)
- [Cek saldo](https://developer.digiflazz.com/api/buyer/cek-saldo/)
- [Daftar harga](https://developer.digiflazz.com/api/buyer/daftar-harga/)
- [Webhook](https://developer.digiflazz.com/api/buyer/webhook/)
- [Topup](https://developer.digiflazz.com/api/buyer/topup/)
- [Test case](https://developer.digiflazz.com/api/buyer/test-case/)

# Digiflazz diparkir untuk order Games baru — 12 November 2026 (lokal)

- Keputusan implementasi P2/P3: Sekalipay menjadi satu-satunya supplier order Games
  baru. Digiflazz tidak lagi dipanggil untuk price-list katalog Games dan tidak
  membuka quote/order baru; kredensial Digiflazz juga bukan gerbang order.
  Baris produk, order, attempt, webhook, dan polling Digiflazz LAMA tetap
  dipertahankan untuk histori/rekonsiliasi; jangan hapus atau remap.
- Admin katalog SK menolak PATCH baris Digiflazz (`legacy_parked`) dan endpoint
  `POST /api/admin/games/products/enable-wave` mengembalikan 410 eksplisit.
  Jangan membuat bulk activation baru. Gate `GAMES_SK_ENABLED` belum diset;
  tidak ada env/secret/deployment dalam perubahan ini.
