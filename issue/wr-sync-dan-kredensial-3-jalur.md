# Sync Otomatis Sehat + Kredensial WR Terkirim ke Email, WA, dan Lacak Web

## Latar Belakang

Dua masalah berjalan paralel per 18 Sep 2026 sore:

1. **Sync otomatis mati.** Sweep produk cron terakhir `trigger='cron'` tercatat 17 Sep 11:37 UTC; setelah itu hanya baris `manual` (Force Sync). Guard anti-starvation baru (`84ff08d`, deploy 14:55 WIB) belum menghasilkan sweep tercatat. Rotasi fase bergerak normal (`cron_phase` berpindah, `deferred` kosong) — jadi bukan poison-pill, melainkan sweep tidak dieksekusi/dicatat meski slot diberikan. Tembakan manual ke `/api/cron/operations` mental 401 (secret lokal ≠ Pages), jadi diagnosis lanjut lewat D1 + baca kode.
2. **Kredensial belum sampai ke pembeli.** Order Meitu pertama (`AXV-20260918-95FC8669` / `RBHN-20260918-10AB7A`) COMPLETED di dashboard WR (detail teks: email + password + akses OTP — bukan screenshot, kabar baik), tapi link Axvara masih `processing` + detail kosong. Jalur kabar status (Email B via forwarder + Resend) sudah jalan sejak secret dicocokkan (2 baris `09:01 UTC`, `buyer_notified_at` terisi). Yang belum: pengiriman **isi kredensial** ke email + WA + lacak web.

Keputusan owner: isi kredensial **tetap dikirim via WA dan email** (bukan hanya kabar + ambil di web).

## Tujuan

1. Sweep katalog WR tercatat otomatis tiap ~30 menit + kartu 🟢 "Otomatis" di dashboard bergerak.
2. Setiap order WR completed: isi kredensial terkirim otomatis ke (a) email pembeli, (b) WA pembeli, (c) tampil di halaman pesanan + hasil lacak status web setelah verifikasi.

## Ruang Lingkup

- Diagnosis + perbaikan gerbang/eksekusi sweep produk cron (tanpa mengubah arsitektur fase).
- Fungsi kirim kredensial via email (Resend, template Axvara baru "Detail Akun Siap").
- Perluas delivery channel `web`: selain capability token + kabar WA, antrekan juga pesan WA berisi **isi kredensial** + kirim email berisi **isi kredensial**.
- Reuse `WrCredentialsPanel` di hasil `/lacak-pesanan` (lookup sudah verifikasi WA penuh via `constantTimeEqual`, lebih ketat dari 6 digit halaman pesanan — jadi tanpa input ulang).
- Tambah field formatter untuk key non-standar (`akses otp`, URL) agar tidak jatuh ke `JSON.stringify` mentah.
- Rotasi `CRON_SECRET` Pages + Worker agar sama dengan file lokal (tanpa itu verifikasi tembak-manual tidak bisa; cron Worker resmi tetap jalan karena pakai `AXVARA_CRON_SECRET` yang cocok).

## Di Luar Scope

- Supplier ke-2 (Sekalipay) dan SMM — menunggu 5 kotak "matang" (lihat chat 18 Sep sore).
- Mengubah desain Email A/B yang sudah jalan (forwarder + template status).
- Mengirim kredensial via Telegram selain yang sudah ada (`deliverTelegramCredential` tetap).
- Perubahan skema D1 baru — dipakai kolom/tabel yang ada (`wr_order_links`, `whatsapp_outbox`, `wr_email_forward_log`, `wr_credential_tokens`).

## Area / File Terkait

- `src/app/api/cron/operations/route.ts` — gerbang admission sync (`lastSync`, `parseExpiry`, `syncOn`, `TIME_WR_NETWORK`), pemanggilan `reconcileStuckWrOrders`.
- `src/lib/warung-rebahan/sync.ts` — `syncProducts`, trigger `cron`, pencatatan `wr_sync_log`.
- `src/lib/warung-rebahan/deliver.ts` — `processCredentialDelivery` (cabang `web`), `notifyWebBuyerCredentialsReady`, `formatWrAccountDetails`, `deliverWhatsAppCredential`, fungsi baru `deliverEmailCredential`.
- `src/lib/warung-rebahan/forward-sender.ts` — reuse `sendForwardEmail` untuk email kredensial.
- `src/lib/warung-rebahan/email-forward.ts` — template baru "Detail Akun Siap" (subject + html + text, nol jejak WR).
- `src/app/lacak-pesanan/lacak-pesanan-client.tsx` — render `WrCredentialsPanel` saat order lunas + kredensial siap.
- `src/app/api/orders/route.ts` — flag `credentials_ready` sudah ada; pastikan ikut di lookup lacak bila perlu.
- `src/components/storefront/WrCredentialsPanel.tsx` — reuse tanpa ubah logika (prop `code` saja; WA lookup sudah terverifikasi).
- `tests/wr-queued-delivery.regression.test.ts`, `tests/cron-deadline-poison.integration.test.ts`, `tests/order-status-delivery.behavior.test.tsx` — tambah/ubah test.
- `docs/ARCHITECTURE.md` (§batch cron + §15), `README.md`, `docs/PRD.md` (FR baru), `CHANGELOG.md`.
- Ops manual: Pages secrets (`CRON_SECRET`, `AXVARA_CRON_SECRET` Worker), `.cf-credentials` lokal disamakan.

## Risiko

- **Kredensial via WA/email = permukaan bocor lebih luas.** Email bisa diforward, WA bisa dibaca orang lain. Mitigasi: ini keputusan eksplisit owner; tetap simpan juga di panel terverifikasi; pesan mencantumkan "jangan bagikan"; tidak ada tautan login langsung selain yang dari WR.
- **Panjang pesan WA.** Detail Meitu (email+password+OTP URL) pendek, tapi varian lain bisa sampai 2000 char (batas formatter). Mitigasi: potong per 1500 char jadi 2 pesan berurutan dengan kunci idempoten berbeda (`wr-delivery:<code>:p1/p2`).
- **Email masuk spam.** Pengirim `noreply@axvara.tech` domain terverifikasi Tokyo; template teks+html; subject jelas. Risiko diterima; bukan blocker.
- **Gerbang sync ternyata bukan bug kode melainkan env** (`WARUNG_REBAHAN_SYNC_ENABLED=false` di Pages). Cek env dulu sebelum ubah kode — 5 menit vs 1 commit sia-sia.
- **Formatter key tak dikenal.** Key seperti `akses otp` (spasi) hari ini jatuh ke `JSON.stringify` — masih terbaca tapi jelek. Tambah key map (`akses otp`, `otp`, `url`, `link`, `username`) sebelum kirim massal.
- **Idempoten ganda.** WA outbox idempoten per key; email forward log idempoten per `gmail_message_id` — tapi email kredensial butuh kunci sendiri (`wr-cred-email:<order_code>`) agar retry delivery tidak kirim email ganda. Wajib sebelum live.

## Langkah Implementasi

1. **Diagnosis sync (tanpa kode dulu).** Baca `WARUNG_REBAHAN_SYNC_ENABLED` di Pages; bandingkan `cron_phase`/`cron_deferred` tiap 5 menit × 3; uji `parseExpiry("2026-09-18 04:43:09")` di fixture. Putuskan: bug env / bug gerbang / bug eksekusi.
2. **Perbaiki sync.** Sesuai temuan langkah 1 (kecil, satu commit). Verifikasi: baris `trigger='cron'` baru muncul + kartu 🟢 bergerak, tanpa Force Sync.
3. **Rotasi CRON_SECRET.** Samakan Pages `CRON_SECRET` + Worker `AXVARA_CRON_SECRET` + `.cf-credentials` lokal; verifikasi tembak manual 200 (bukan 401). Tanpa ini langkah 4 tidak bisa diverifikasi cepat.
4. **Formatter + template email kredensial.** Tambah key map di `formatWrAccountDetails`; template "Detail Akun Siap" di `email-forward.ts` (isi kredensial + tombol invoice + peringatan jangan bagikan).
5. **Perluas delivery web.** Di cabang `web` `processCredentialDelivery`: setelah token + kabar (yang ada), antrekan pesan WA isi kredensial (`wr-delivery:<code>`, reuse `deliverWhatsAppCredential` dengan target `customer_wa`) + kirim email isi kredensial via Resend dengan kunci idempoten `wr-cred-email:<code>` (catat di `wr_email_forward_log`, channel `email-credential`).
6. **Panel di lacak.** Render `WrCredentialsPanel` di hasil lookup bila order lunas + `credentials_ready`; lewati input WA bila lookup sudah verifikasi (teruskan flag terverifikasi, bukan token mentah ke client).
7. **Verifikasi hidup.** Tunggu reconcile menarik Meitu (>1 jam + fase aktif) → cek 3 jalur: Email B isi masuk `sailinnadia1@gmail.com`, WA isi masuk `6283878525697`, panel muncul di `/pesanan/[code]` + `/lacak-pesanan`.

## Rencana Test

- Baru: formatter key `akses otp`/URL tidak jatuh ke JSON mentah.
- Baru: delivery web mengantrekan 3 pesan (token+kabar+isi WA+email) tepat sekali walau dipanggil 2× (idempoten email `wr-cred-email:<code>`).
- Baru: hasil lacak order lunas + kredensial siap me-render panel; order belum siap tidak render.
- Ubah bila perlu: `wr-queued-delivery.regression` (copy kabar), `cron-deadline-poison` (bila gerbang sync berubah).
- Wajib: full `vitest` hijau + `tsc` bersih + dev 200/CSS 200 + Obscura (lacak + pesanan + Email B).

## Kriteria Selesai

- [ ] Kartu 🟢 sync cron tercatat otomatis tanpa Force Sync (2 baris berurutan `trigger='cron'`).
- [ ] Order Meitu `95FC8669`: detail TERISI, `delivery_status='delivered'`.
- [ ] Email isi kredensial diterima `sailinnadia1@gmail.com` (template Axvara, bukan mentah WR).
- [ ] WA isi kredensial diterima `6283878525697`.
- [ ] Panel kredensial muncul di `/pesanan/[code]` DAN hasil `/lacak-pesanan` untuk order tersebut.
- [ ] Full test hijau, docs (ARCHITECTURE/README/PRD/CHANGELOG) ikut, commit + push `main`.
