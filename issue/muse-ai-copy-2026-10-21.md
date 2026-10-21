# Muse AI — salinan produk 21 Oktober 2026

Arahan owner: deskripsi, S&K, dan cara penggunaan mengikuti format produk
AXVARA lain. Revisi owner pada tanggal yang sama: persingkat menjadi
pengantar + lima keunggulan, lima poin S&K, dan empat langkah aktivasi.
Teks terkini ada di
[`muse-ai-copy-compact-2026-10-21.sql`](muse-ai-copy-compact-2026-10-21.sql).
[`muse-ai-copy-2026-10-21.sql`](muse-ai-copy-2026-10-21.sql) adalah arsip
versi panjang awal. Patch ringkas hanya mengganti timestamp revisi awal;
suntingan admin berikutnya tetap terlindungi. Rincian bukti di bawah adalah
catatan internal, bukan teks panjang yang ditampilkan kepada pembeli.

Produk manual `muse-ai-1-miliar-token` (112), varian Default (248), harga
Rp16.000. Deskripsi masuk `products.description`; S&K dan panduan bersama
masuk `product_variants.admin_terms` / `admin_activation` dengan fingerprint
kosong sesuai kontrak stok sendiri. Hanya kolom salinan dan `updated_at`
disunting. Stok, foto, harga, pengiriman, dan garansi varian tetap.

Dasar salinan:

- Screenshot owner menunjukkan Free plan dengan additional tokens 1B dan
  contoh lain 2B; penawaran produk ini tetap **1 miliar**, sesuai nama produk.
  Label “Never expires” pada token tidak menjadi janji akun lifetime.
- Spesifikasi 2 vCPU / RAM 7,7 GB / storage 100 GB berasal dari jawaban AI
  dalam screenshot owner, bukan pengukuran mesin atau jaminan spesifikasi
  semua akun. Copy menyebutnya spesifikasi referensi yang dapat berubah.
- Screenshot konektor mendukung contoh Calendar, Drive, Sheets, Docs,
  Outlook, GitHub, Canva, dan Dropbox; konektor memerlukan otorisasi pengguna.
- Owner menyatakan akun siap login tanpa kartu kredit/VPN dan email dapat
  diganti; copy membatasi akses tanpa VPN pada akses awal akun yang diberikan.
  Menu penggantian email diberi konteks nama menu dapat berubah, serta wajib
  menyelesaikan verifikasi email baru sebelum meninggalkan sesi aktif.
- WhatsApp native tetap memerlukan penautan nomor pribadi. Tidak menjanjikan
  nomor pembeli sudah terhubung sebelum akun diterima.
- Kerja latar belakang/terjadwal mengikuti kuota, izin, dan ketersediaan.
  Tidak menjanjikan unlimited, uptime 100%, atau keberhasilan semua instruksi.
- Garansi mengikuti data varian existing `warranty_type=none`; tidak menambah
  hak refund/penggantian baru. Kendala akses awal diarahkan ke admin untuk cek.

Rujukan resmi: [desain Muse](https://introducing.muse.ai/) menjelaskan
komputer, terminal, browser, pembuatan dokumen, dan tugas latar belakang;
[arsitektur Muse](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
menjelaskan VM, konektor, izin tindakan, serta kendali browser pengguna.
Spesifikasi mesin dan transfer akun tidak disimpulkan dari artikel tersebut.

Patch sekali jalan memiliki guard ID + slug + source + isi awal, agar tidak
menimpa suntingan admin baru bila diulang. Ini bukan migrasi schema atau
perubahan aplikasi. Verifikasi hasil dan status penerapan dicatat di CHANGELOG.
