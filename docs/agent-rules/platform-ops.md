# Aturan agent — Workers Paid, unit unik, operasional D1

### Jaspay katalog multi-produk per tick —16 November2026

Keputusan owner (Workers Paid): job lite `jaspay_catalog` memakai budget **96**
(sama dengan `fulfillment`; job lite lain tetap40) dan plafon10 produk/tick.
Cursor `wr_sync_state.jaspay_catalog_cursor` berputar wrap-around tanpa memproses
produk dua kali per tick dan kini memperbarui `updated_at`. Berhenti karena
budget sesudah >=1 produk = batas tick normal; cadangan4 statement disisakan
agar zero-missing (seen-set feed penuh) tetap jalan. Siklus11 produk ±3 tick
(sebelumnya ±11). Tanpa trigger/env baru; fetch feed tetap satu per tick.

### Antrean grup produk —16 November2026

Migrasi0129 menambah `product_group_dirty(group_id,version,pending)` menggantikan
antrean pasangan untuk keputusan katalog. Shim mempertahankan request/response
`action:pairs` dan cron existing; tanpa env/jadwal baru. Satu SELECT statistik,
drain maksimal10 **grup utuh**, bukan10 anggota. Budget existing, CAS versi pada
write+ack dan token tetap setelah ack wajib; error tidak dianggap daftar kosong.
Grup yatim juga dikuras. Trigger inventory/minimum/durasi/modal/FX/aktivitas/
anggota/prefer menjaga keputusan; mirror TUNVN/AIVault hanya grup terkait.
Status lokal (termasuk migrasi+replay D1/workerd), bukan bukti penggunaan atau
deployment produksi. Lihat ARCHITECTURE “Grup produk lintas supplier”.

### Batas pola LIKE/GLOB di D1 — 15 November 2026

- D1 produksi menolak literal `LIKE`/`GLOB` panjang (`LIKE or GLOB pattern too
  complex`, SQLITE_ERROR 7500; batas 50 byte) walau SQLite lokal/test lulus.
  Migrasi 0127 gagal di CI #713 dan #714 karenanya (rollback; deploy terhenti).
  #712 dibatalkan setelah push berikutnya sesuai `cancel-in-progress`, bukan
  kegagalan migrasi. Batas resmi: https://developers.cloudflare.com/d1/platform/limits/.
- Untuk mencocokkan teks panjang pakai `substr(col, -N)=…`, `instr`, atau
  kesamaan penuh. `tests/d1-migration-like-limit.test.ts` menolak literal >50
  byte di semua migrasi. Cek ekspresi baru dengan SELECT baca-saja bila ragu.

### Katalog Jaspay otomatis — 14 November 2026 (implementasi lokal)

- Worker menambah langkah lite `jaspay_catalog` pada trigger menit existing,
  sesudah seluruh job order, satu produk/tick dengan cursor durable dan budget40
  (cadangan2). Tidak menambah trigger jadwal/env/secret. Heavy sync existing
  tetap cadangan; hasil snapshot10 produk baru lengkap setelah hingga10 tick
  sukses, bukan segera terverifikasi live saat push.
- Progress aman menambah satu query hanya untuk order Jaspay; non-Jaspay tetap
  memakai jumlah read sebelumnya. Akun/kredensial tidak masuk JSON progres.

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

### Workers Paid dan unit unik — 2026-10-23

- Revisi10November2026 lokal: Worker menambah job lite `tunvn_catalog` tiap3menit
  sesudah order, budget40/soft alarm existing; tanpa trigger/env baru. Mirror+
  proyeksi memesan sisa statement sebelum write. Detail aturan TUNVN/ARCH16.34;
  bukan bukti deployment. `tunvn_orders` tetap per tick menit secara terpisah.
- Paket Workers Paid aktif pada akun existing; CI membaca metadata langganan melalui `scripts/cloudflare-plan.cjs`, tanpa env/secret baru. Preflight variabel mengikuti Paid128/Free64; API/metadata gagal menghentikan rilis.
- Cron MCP existing setiap menit: payments/expiry/fulfillment/WR/SK/Pedia/notify/promo; cleanup dan publish artikel tetap lima menit, heavy hanya menit00. Tidak menambah trigger atau loop polling server tanpa batas. Cadangan KlikQRIS maksimal empat GET invoice aktif per tick, bukan create/reissue; validasi otoritatif dan late-payment manual tetap.
- Fulfillment lite mempunyai budget96 statement dan maksimal empat unit/job; job lain tetap40. Jalur immediate multi-unit yield sesudah40 detik sebelum unit berikutnya untuk menjaga lease. Jangan meniadakan budget, lease, snapshot, atau dedupe supplier.
- Unit unik baru ditandai server `unique_units:true` dan mode unique dalam `orders.items` yang tetap teragregasi. Manifest menambah unit ekstra SESUDAH index baris asli agar link supplier tetap benar. Total maksimal10 di web/Telegram, reservasi qty utuh atomik, bukan memotong stok dahulu lalu memilih satu akun. Jangan memecah/menulis ulang order lama, membuka DM WA, atau membeli ulang unit gagal.
- Monitor D1 memakai periode Paid dari metadata dan jatah25miliar baca/50juta tulis per bulan; Free tetap harian. Proyeksi bukan invoice, dapat mencakup pemakaian Free sebelum upgrade. Alert budget eksternal tetap email, tanpa pemutusan layanan.
- Rincian kontrak/rollback: `docs/PAID-OPERATIONS.md`, `docs/UNIQUE-UNITS.md`. Pengujian memakai fixture tanpa transaksi supplier berbayar.

### Operasional D1 lanjutan — 2026-10-17
- Migrasi 0068 menambah indeks inventory/recipient dan `supplier_pair_dirty`.
  Trigger invalidasi atomik mengganti token versi; ack hanya menyetel pending=0,
  jangan menghapus/reset token (pelindung race terhadap proses/sweep lama).
- Request VPS `action:pairs` tetap bentuk existing, kini menguras maksimal 10
  pasangan pending; error 503 menyisakan antrean. Cron lite cleanup existing
  juga menguras antrean tiap tick selama budget cukup, termasuk perubahan WR
  saja/retry; sweep penuh hourly tetap cadangan, tulisnya dijaga versi.
- `.github/workflows/d1-usage.yml` HANYA baca GraphQL Analytics akun per jam
  pada menit 17/manual; tidak query SQL/deploy. Memakai Secrets CI existing,
  laporan agregat dan warning/job gagal untuk risk/exhausted/unknown. Notifikasi
  mengikuti pengaturan GitHub owner; tidak ada pesan Telegram monitoring baru.
- Target ≤3 juta reads/hari harus diukur satu siklus 07.00–07.00 produksi,
  jangan menyamakan hasil benchmark fixture atau push dengan bukti tercapai.
