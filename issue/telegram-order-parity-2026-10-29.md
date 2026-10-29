# Telegram: konsistensi order dan bahasa pembeli

## Latar belakang
Revisi presentasi lanjutan29Oktober: indikator paralel bounded tanpa persentase,
edit bubble ringkasan callback, hierarki nominal/email tanpa tabel monospace,
serta ikon tindakan. Menggantikan loading bar yang dipulihkan sebelumnya saja;
guard transaksi di bawah tetap. Pengujian fetch/timer dan router D1 tanpa pesan
produksi; hasil final dicatat pada changelog.

Audit screenshot lanjutan29Oktober: send loading paralel/debounce300ms dengan
timeout1detik dapat kalah urutan dari hasil dan kehilangan ID saat Telegram sudah
menerima pesan. Perbaikan mengirim loading langsung dan memasang barrier respons
awal sebelum publish hasil; data tetap paralel, animasi tetap hidup selama upload.
Send/delete kembali timeout existing10detik, edit5detik. Fixture respons2,5detik
membuktikan loading mendahului hasil dan cleanup; timeout tanpa ID masih ambigu,
tidak dijanjikan dapat dibatalkan di server Telegram atau diulang otomatis.

Label Google AI Pro Head 18 Bulan ditempeli metadata durasi 1 month oleh
Telegram, sedangkan web memakai label pembeli kanonis. Audit juga menemukan
harga varian habis, stok unik mentah, pembatalan non-atomik, pemeriksaan email
fail-open, persetujuan checkout basi dan kelemahan status/notifikasi.

## Tujuan dan ruang lingkup
- Gunakan label, stok efektif dan ketentuan katalog yang sama dengan web.
- Gabungkan detail produk dan pilihan varian, sediakan ketentuan sebelum bayar.
- Bahasa Indonesia singkat; nominal, jumlah dan email harus cocok ringkasan.
- Pembatalan atomik, email wajib fail-closed, mutasi keranjang atomik.
- Status semua item, pengambilan produk dengan error jujur dan retry notifikasi
  ber-lease/backoff yang tidak menimpa percakapan aktif.
- Pulihkan invoice KlikQRIS initializing melalui GET existing, tanpa POST ulang.

## Di luar scope
Tidak mengubah data katalog/order produksi, PIN/c1, Pedia, bot WA, supplier,
merchant, secret, environment, cron atau dependency. Tidak membuat transaksi,
mengirim pesan/email produksi, atau menjanjikan exactly-once pengiriman Telegram.

## Area terkait dan risiko
`src/lib/telegram`, test fixture D1, PRD/DESIGN/ARCHITECTURE/README.
Callback lama harus tetap aman: tampilkan ringkasan terbaru sebelum bayar,
tetapi order existing tetap reuse. Harga/stok tetap diperiksa batch factory.
Kontak tidak dimuat dalam callback. Kepemilikan order dan chat pribadi wajib.
Retry notifikasi harus tetap dalam budget cron 40 statement.

## Langkah implementasi dan test
1. Label/harga/stok/ketentuan dan copy, tag snapshot callback serta konfirmasi
   email sekali pakai, tanpa menambah layar persetujuan berulang.
2. Pembatalan memakai batch transisi existing, status dan resend semua item.
3. Keranjang atomik; notifikasi memakai lease/backoff existing dan state idle-only.
4. Fixture regresi data durasi bertentangan, stok kosong, callback lama, email
   berubah/gagal baca, rollback pembatalan, race keranjang/notifikasi, retry parsial.
5. Seluruh Vitest, tsc/lint dan fixture alur pesan/callback aktual. Dev home/CSS
   dan screenshot browser N/A: perubahan bot/backend tanpa UI web.

## Kriteria selesai
Kode/test/dokumentasi selaras, tidak ada test gagal, tidak ada secret di diff.
Commit dan push main melalui CI normal; berhenti setelah push diterima.
Hasil verifikasi akhir ditulis di changelog, bukan dianggap bukti deploy.

## Penyelesaian setelah handoff
- Sesi utama lama dan11subagent dihentikan melalui abort API sebelum edit lanjutan.
- Replay epay yang sudah dikonsumsi kembali ke ringkasan baru, termasuk ketika
  require_email berubah setelah order lunas; retry invoice existing tetap reuse.
- Invoice satuan tidak lagi mengembalikan stok terpisah ketika ledger terminal.
  Ketiadaan ledger diperiksa dalam batch pembatalan atomik; error ambigu/ledger
  tercatat menjaga reservasi, rollback failure tidak mengubah stok separuh jalan.
- Test router memakai D1 SQLite nyata dan transport mock: consent/email CAS,
  replay/concurrency, callback lama, stock/channel admission, owner/group,
  pagination ketentuan dan kompensasi/payment race. PIN/c1 tidak ditambahkan.

## Verifikasi akhir
- `npx vitest run --run --reporter=json`:3639lulus/286file,0gagal;
  termasuk61test router dan fixture workerd existing.
- `npx tsc --noEmit`:lulus. ESLint semua file TypeScript yang berubah:0error,
  dua warning unused existing pada test invoice retry.
- `npm run build:pages`:exit0; warning existing tidak menghalangi bundle Pages.
- `git diff --check`:lulus. UI browser/dev N/A (bot/backend saja).
- Tidak ada QA pesan/email/order/supplier produksi atau akses secret.
  Commit/push bukan bukti deployment dan tidak dilanjutkan polling CI.
