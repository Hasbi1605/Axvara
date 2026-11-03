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
