# Aturan agent — WhatsApp gateway, grup, siaran

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

Notifikasi grup24Oktober: pencarian AXVARA'S menyetarakan NFKC/trim/kapitalisasi
dan apostrof ’/‘/ʼ → ', tanpa substring. Nama setara ganda ditolak; ID pin PG
tidak berpindah otomatis. Gateway status memberi `groupName` kanonis untuk
validasi aktivasi Pages dan `groupSubject` asli hanya setelah grup/izin lolos.
Bot tersambung tidak perlu pairing ulang untuk perbaikan nama.

Ganti nomor bot24Oktober: nomor awal6283181632507 hanya bootstrap. Pilihan aktif,
revisi dan pin grup disimpan singleton PG axvara_wa_runtime. Admin menjeda D1 lalu
gateway mengganti sesi manual lewat mutex/CAS; prefix auth tiap nomor terisolasi,
sent/unknown/cooldown tetap, tanpa rotasi otomatis. Aktivasi/pair/send diikat
nomor+revisi; tab basi termasuk A→B→A ditolak. Tidak perlu env baru. Rollback setelah
pergantian harus ke rilis kompatibel runtime/revisi; jangan rollback ke kode nomor
tetap. Rincian di gateway/AGENTS.md dan ARCHITECTURE §16.12.

Siaran+welcome24Oktober: menu Konten → Siaran memakai template reusable (maks200,
migrasi0077) + snapshot kampanye atomik; tujuan grup WA terverifikasi/subscriber
email active/user Telegram pribadi non-blokir/non-opt-out. Worker cron lite existing
maks8/tick, hasil ambigu unknown tanpa kirim ulang; opt-out email token acak dan
Telegram /stop. Sambutan hanya dari event group add via /api/whatsapp/group-events
→ outbox group_welcome dedupe SHA256 harian; chat biasa tidak lagi menyapa/mencari
produk. Gateway /send-broadcast//send-welcome namespace key terpisah. Rincian di
gateway/AGENTS.md, ARCHITECTURE §16.13, issue/broadcasts-welcome-2026-10-24.md.
