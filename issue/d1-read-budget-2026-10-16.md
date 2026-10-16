# Penghematan D1 Free — 2026-10-16

Status: implementasi dan verifikasi lokal selesai; publikasi hanya lewat CI setelah push. Hasil deployment/kuota sesudah rilis belum diukur.

Audit produksi baca-saja: 4.582.928 rows_read (91,7%); indeks log 0057 tetap
terpasang. Biaya baru berasal dari mirror Pedia (~5.024 baris/panggilan),
katalog Market, laporan admin dan query rutin yang memindai riwayat.

Rencana perubahan kecil:
- [x] Pedia membaca supplier/service yang dirujuk tier + produk aktif saja;
      kontrak, harga, batas, pemisahan dua provider tetap.
- [x] GoPay memakai indeks invoice aktif existing; auth, merchant per invoice,
      expiry dan batas 50 tetap. Migrasi korektif indeks Pedia memakai nama baru
      karena nama lama dimiliki tabel arsip; tidak menghapus arsip/FK.
- [x] Cache API eksplisit untuk katalog publik, termasuk pemanggilan handler
      oleh SSR; private/admin, checkout dan status order tidak ikut cache publik.
- [x] Overview hanya dimuat pada tab ringkasan; periode standar memakai hasil
      laporan yang sama, laporan historis tetap tersedia dan akurat.
- [x] Probe cron mengikuti fase yang diminta; rotasi lama, pemulihan order,
      watchdog dan guard idempotensi tetap; cleanup cukup berkala.
- [x] Kurangi pembacaan pairs tanpa mengubah kontrak proxy; recovery tetap jalan.
- [x] Regresi biaya baca pada D1/workerd dengan riwayat dan mirror besar,
      cache hit/miss/error/private, periode laporan dan fase cron.
- [x] Seluruh vitest, type-check, lint, build Pages, HTTP dev + CSS, Obscura;
      dokumen hidup + changelog siap; publikasi commit/push main lalu berhenti setelah GitHub menerima push.

Asumsi: TTL katalog dibatasi 30 detik Market/60 detik Pedia; quote/order tetap
memverifikasi harga/stok aktual. Cache per lokasi Cloudflare, bukan jaminan
cache global. Target 2–2,5 juta rows_read/hari adalah sasaran pengukuran setelah
rilis, bukan hasil produksi yang sudah terbukti. Tanpa order supplier berbayar.

## Hasil verifikasi lokal

- `npx vitest run --run`: 2.534 test / 217 file lulus (log sementara
  `/tmp/axvara-d1-tests-release.log`). Type-check exit 0; lint exit 0 dengan
  warning existing; `npm run build:pages` exit 0.
- D1/workerd: 5.000 layanan supplier tak terpakai tidak meningkatkan biaya
  katalog terkurasi secara linear (<40 rows_read pada fixture); GoPay dengan
  1.000 invoice terminal <8 rows_read kosong/<12 dengan invoice aktif; recovery
  tetap menemukan yatim pada 5.000 order lama dengan <60 rows_read. Partial
  recovery index diawali status/payment_status agar planner benar-benar memilihnya.
- Cache API workerd asli: MISS → HIT pada pemanggilan berbeda. Regresi mencakup
  private/auth, expiry, key filter/slug, coalescing, error load/cache dan respons
  degraded. Agregasi laporan standar cocok dengan perhitungan periode terpilih;
  cache privat gagal tidak menahan kegagalan, generation time tetap aktual.
- Dev HTTP: `/`, `/pedia`, `/admin`, `/api/products?active=1`,
  `/api/pedia/catalog`, `/api/categories` dan CSS 200; overview tanpa sesi 401.
  GoPay pending lokal 503 karena rail tidak dikonfigurasi, bukan uji supplier
  produksi; kontrak auth/merchant/expiry diuji integrasi dengan fixture.
- Obscura CLI memuat home/Pedia nyata, screenshot 1280px nonblank diperiksa,
  scrollWidth=innerWidth. Dev tanpa D1 memakai seed Market dan katalog Pedia
  kosong. Warning hydration namespace SVG `xmlns`/paint existing Obscura tetap
  batas renderer, bukan bukti browser produksi penuh. Tidak ada error kompilasi.
- Obscura CDP (`obscura serve --allow-private-network --port 9222`): komponen
  admin aktual dengan API fixture HANYA di browser, tanpa kredensial/server
  mutation: Produk 0 overview, Ringkasan 1, Hari ini menambah request period=today;
  exception JS kosong, screenshot ringkasan diperiksa. MCP Obscura menolak IP
  privat; CLI/CDP Obscura dipakai sesuai aturan proyek.
- `git diff --check` bersih, file kredensial tetap ignored. Tanpa pembelian
  supplier, perubahan secret/env produksi, deploy manual atau perubahan proxy.

## Keputusan cakupan

Pairs tetap dihitung pada trigger existing; stok finite/unlimited kini satu
pemindaian per produk, bukan dua. Dirty queue lintas request tidak ditambahkan
karena akan mengubah pola sinkronisasi dan menambah risiko kehilangan refresh.
Indeks recovery mengoptimalkan pencarian tanpa mengganti urutan, jendela 7 hari
atau guard lunas/paid/yatim. Hasil harian pascarilis perlu satu siklus kuota
produksi; tidak diklaim target harian sudah tercapai.
