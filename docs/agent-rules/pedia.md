# Aturan agent — Pedia (SMM)

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

## Kebijakan Pedia 24 Oktober 2026 (menggantikan kredit pada snapshot lama)
- Spec terkini `docs/pedia/manual-resolution-2026-10-24.md`: QRIS per order, tanpa wallet/deposit/kredit/refund otomatis.
- Partial/canceled disimpan atomik dengan antrean tindak lanjut manual; pembayaran paid tetap paid. Unknown remains jangan diasumsikan nol.
- Arsip kredit/ledger lama dipertahankan, tidak dapat dibelanjakan. Retry order yang sudah tersimpan mempertahankan nominal; quote lama berkredit tanpa order ditolak sebelum mutasi.
- Expiry reservasi pra-pensiun dibalik sekali hanya ke arsip beku + follow-up owner. Penyelesaian dengan pembeli di luar AXVARA, bukan saldo baru.
- Status Pedia wajib kontak checkout penuh; kredensial Market mengikuti aturan PIN/proof checkout 28 Oktober di atas beserta kompatibilitas legacy, bukan kontak saja untuk order PIN6. Pengecualian admin24Oktober: adminView hanya sesudah requireAdmin server-side, URL tanpa kontak/token buyer dan tidak menerbitkan capability buyer. Tidak menampilkan kode kredit lama ke browser.

### Histori Pedia (dipindah 2 November 2026)
- Snapshot Pedia 12, 15 dan 19 Oktober 2026 dipindah utuh tanpa perubahan isi ke `docs/agents-history.md` agar konteks agent lebih ringan. Itu bukti bertanggal, bukan status produksi atau izin rollout.
- Pengaman di sana (secret supplier hanya di VPS, idempotensi/reservasi durable proxy SMM, retry ambigu `needs_check`, quote JWE/snapshot order lama, larangan reset direktori idempotensi) tetap berlaku untuk jalur legacy yang kompatibel. Baca file itu sebelum menyentuh order/refill/recovery Pedia lama, proxy SMM atau kurasi.

### Copy layanan Pedia 3 November 2026 (terkini)
- Nama/deskripsi layanan hanya membawa karakteristik yang tertulis di sumber (Real Look, Real People, Real Human, Real, HQ, Akun berpostingan, Akun lama, Campuran, Instant Start). Jangan memakai "kelas/label Real", mengarang active/buzzer/story/kualitas, atau memberi kata Real/HQ pada sumber campuran/bot. Perubahan lewat manifest + `scripts/generate-pedia-copy-20261103.mjs`; migrasi 0093 sudah guard nama/deskripsi lama, jangan mengedit manual.
- `Instant Start` hanya segmen nama dari sumber; jangan mengisinya ke `eta_start` (dibaca dari tier hidup oleh API order sehingga mengubah janji order lama) dan jangan mengarang rentang.
- Kalimat refill: `Refill N hari [sejak pesanan dibuat|selesai], selama layanan masih tersedia.` memakai `refill_anchor` nyata; tanpa "dari/lewat AXVARA". Pembersihan teks historis hanya kosmetik, tanpa mengubah angka/anchor/kelayakan.
- Tier 285 / svc 5834: konflik sumber (nama 30 hari vs deskripsi 90 hari) belum diputuskan; kontrak tetap 90 sampai owner memutuskan. Jangan memperpanjang 30→35 hari hanya karena nama sumber.

### Pedia IndoSMM 1 November 2026 (terkini)
- ProviderSMM diputus: jangan menambah cek saldo/notif/penjualan ProviderSMM. Diff VPS ProviderSMM dibalas 200 `ignored`; order/snapshot lama tetap dibaca.
- Istilah SMM keputusan owner tetap bahasa supplier (No Drop, Less Drop, High Drop, Refill N Days, Refill Lifetime, No Refill, Drop rate, Start time, Speed, Avg time, Success rate) dari `src/lib/pedia/terms.ts`; jangan menerjemahkan ke istilah Indonesia.
- Layanan High Drop/No Refill boleh dijual dengan label jelas. Refill manual (bergaransi tanpa tombol API) sah: admin meneruskan ke CS IndoSMM lalu `refill_resolve`.
- Statistik supplier dari alat publik IndoSMM bukan API resmi dan bukan uji kualitas AXVARA. Katalog baru lewat manifest + generator; jangan mengedit migrasi 0086 manual.
- Komentar custom: tier `input_kind='comments'` hanya boleh dipetakan ke layanan tipe "Custom Comments"; jangan menjual layanan Custom Comments tanpa kolom komentar.
- White label 100%: teks yang dilihat pembeli Pedia tidak boleh menyebut supplier/IndoSMM/ProviderSMM. Teks baru wajib lolos `whiteLabel()`/test leak; admin boleh menyebut IndoSMM.
- Nama layanan (2 November): [Metrik] [Wilayah] [Kualitas] (+ " · keterangan" bermakna); jangan memasukkan Refill/drop/"Ekonomis"/"Max N" ke nama karena sudah chip. Kurasi berikutnya satu layanan per (wilayah, masa refill, kualitas, keterangan); migrasi data memakai guard nama lama.
- Spec: `docs/pedia/indosmm-catalog-refill-2026-11-01.md`.

### Pedia IndoSMM 20 Oktober 2026
- Spec terkini `docs/pedia/indosmm-only-2026-10-20.md` menggantikan dua supplier aktif: hanya IndoSMM untuk penjualan baru, ProviderSMM tetap untuk riwayat/retry checkout tersimpan/dispatch/refill/recovery lama. Jangan ubah provider/snapshot order lama.
- Quote ProviderSMM tanpa order tersimpan ditolak 409 sebelum reservasi/debit/invoice; retry order tersimpan diperiksa dahulu. Kebijakan server berlaku meski tier lama aktif di DB.
- Migrasi 0073 menonaktifkan penjualan PSMM dan menambah tier IndoSMM baru, tidak remap tier lama. Konflik slug/draf owner dan tier IndoSMM existing dijaga. Produk premium Canva/Gemini/CapCut dikecualikan.
- Manifest 20 Oktober: 53 kebutuhan baru, tujuh pengganti, 61 mapping, 18 platform tambahan. Quote Threads dan Share Video Facebook tidak dipaksakan tanpa padanan terverifikasi. Registry/target/ikon diperluas; semua penawaran baru tanpa refill AXVARA. Nama API/deskripsi bukan bukti kualitas.
- API akun IDR 4.395 layanan/saldo0 dibaca saja. Tidak ada order berbayar, top-up, env/cron/proxy baru. Rencana sampling dua supplier 19 Oktober historis; saldo uji selanjutnya IndoSMM.
