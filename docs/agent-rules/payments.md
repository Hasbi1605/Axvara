# Aturan agent — Pembayaran (GoPay, KlikQRIS, maintenance)

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

## GoPay Merchant pribadi — 27 Oktober 2026
- Koreksi29Oktober: setelah gate/hold/backoff lolos, poller memanggil SDK `refreshSession()` sebelum GET feed agar expiry tersimpan diperiksa tanpa bergantung hanya pada401. Token valid tidak menambah request refresh; persist gagal menghentikan feed. Tidak ada refresh kedua manual setelah kegagalan401. Patch lanjutan snapshot27Oktober: `issue/patches/gopay-session-expiry-2026-10-29.patch`; bukti/batas pemulihan di `issue/gopay-session-expiry-2026-10-29.md`.
- Owner memilih pola pengaman AutoGoPay di server AXVARA, bukan memakai layanan/API AutoGoPay. Merchant yang dipilih kembali: Axvara Digital, G564039370, NMID ID1024342457479, nomor082135277434. Sesi/nomor/outlet aktif diperiksa baca-saja; ini bukan bukti pembayaran end-to-end atau jaminan bebas suspend.
- Payload QR owner berada di `.gopay-credentials` ignored/chmod600. Pages hanya mengubah tiga secret_text existing: GOPAY_STATIC_QRIS, GOPAY_QRIS_ENABLED=true, QRIS_ACTIVE_PROVIDER=gopay. GOPAY_POLLER_SECRET existing tetap; semua kredensial/callback KlikQRIS dipertahankan. Invoice tersimpan tetap pada provider/merchant asal, termasuk initializing KlikQRIS yang hanya boleh dipulihkan lewat GET.
- QR GoPay dihitung lokal, satu original + maksimal satu reissue setelah expiry; QR aktif/retry tidak dibuat ulang. Pilihan GoPay tidak lengkap gagal tertutup, tanpa fallback DANA. Nominal retry harus sama; pemenang race GoPay dibaca dari provider yang benar.
- Callback wajib x-poller-secret DAN x-poller-signature HMAC-SHA256 atas body mentah memakai secret existing. Bukti wajib order_code/event_id/merchant_id/currency IDR/status settlement|capture/paid_at berzona; merchant dari payload invoice, waktu dan nominal diperiksa. Kode berbeda tidak fallback ke order lain. Paid/outbox atomik mendahului background fulfillment dengan waitUntil.
- Rilis poller bertanda tangan di VPS SEBELUM push receiver Pages. Source `/Users/macbookair/axvara-gopay-poller`, snapshot lengkap di issue/patches/gopay-hardening-2026-10-27.patch. Salin SELURUH dist, backup dahulu, pertahankan .env/dua sesi/berkas .poll-state. Rollback receiver baru memerlukan poller yang tetap bertanda tangan.
- Poll GoBiz minimal15detik, cadence15/30/60detik menurut umur invoice terbaru (<2/<5/≥5menit), satu loop, nol query GoBiz saat idle. Wake/tick tidak melewati gate; interval/backoff/hold durable per sesi. SDK refresh401 sekali; poller tidak menambah refresh. Sesi mati/persist gagal/403 restriction menjeda akun sampai sesi diganti manual; jangan reset .poll-state untuk menghindari pembatasan. Transport hanya GET mutasi + POST token refresh, tanpa redirect, transfer atau generate QR upstream. Penyebab suspend lama tidak diketahui.

Perbaikan VPS GoPay 25 Oktober: dedupe mutasi hanya setelah respons Pages
HTTP 2xx + JSON `ok:true` dengan status `paid|already_paid|duplicate|unmatched`.
HTTP 4xx/5xx, redirect, atau respons rusak tetap retry pada cadence existing dengan event ID
sama. `/tick` legacy menjadi alias wake berantrean (`status:true,queued:true,eta_ms`)
agar tidak menjalankan poll/refresh sesi paralel atau melewati jarak minimum.
Source `axvara-gopay-poller/src/pages-forward.ts`; rilis VPS terpasang
25 Oktober, 21.21 WIB. Deploy seluruh dist ke
`/opt/axvara/gopay/app/dist`, tanpa mengubah sesi/env atau membuat invoice baru.

### PG KlikQRIS — 2026-10-18
- API/PNG wajib `redirect: "manual"` + tolak non-2xx; `redirect: "error"` ditolak workerd sebelum jaringan. Verifikasi adapter di runtime workerd, bukan hanya fetch mock. Retry quote existing dan aksi manual `wake=1` memulihkan initializing hanya melalui GET; jangan POST ulang untuk 404/timeout ambigu atau membuat reservasi baru.
- Sumber kredensial `.klikqris-credentials` (git-ignored, chmod600). Pages secret_text: KLIKQRIS_API_KEY, KLIKQRIS_MERCHANT_ID, KLIKQRIS_ENABLED=true, QRIS_ACTIVE_PROVIDER=klikqris. Jangan log/commit/masukkan key atau signature ke browser. Callback per invoice `/api/payments/klikqris/callback`.
- Keputusan owner: batas otomatis AXVARA tetap 15 menit; owner mengonfirmasi setting expiry KlikQRIS juga15menit pada24Oktober (uji awal18Oktober60menit). Deadline tetap mengambil batas paling awal order/lokal/provider. Pembayaran terlambat masuk Rekonsiliasi + alert admin, tanpa revive/refund/fulfillment otomatis. Callback signature + status API wajib cocok; konfirmasi gagal tidak boleh dianggap paid.
- Notifikasi buyer24Oktober: POST create menyertakan `whatsapp_buyer` hanya dari `orders.customer_wa` valid, dinormalisasi62 tanpa plus, maksimal15digit. Kosong/invalid/email/JID/ID Telegram diabaikan, tanpa fallback nomor admin/bot. Invoice existing/initializing tidak di-POST ulang untuk menambah nomor. Pengiriman success/expired dikelola KlikQRIS (langganan aktif + sesi pengirim owner); status WA bukan bukti paid. Gateway grup AXVARA dan pacing-nya terpisah, tanpa DM baru melalui gateway AXVARA atau env/cron baru.
- Ledger klaim sebelum POST; retry ambigu hanya GET order ID sama. Pertahankan stok in-flight. Migrasi 0069 hanya menambah provider_qris_url; DANA/GoPay lama tetap dilayani dan tidak dipindah provider. Tidak ada cron baru.
- Build maintenance saat rilis KlikQRIS false. Rollback memakai rilis CI; pertahankan key/merchant/flag KlikQRIS untuk invoice lama dan penanganan late payment. Lihat ARCHITECTURE §16.11/README.

### Maintenance pembayaran — 2026-10-18
- Switch build publik `NEXT_PUBLIC_PAYMENTS_MAINTENANCE="true"` pada langkah build Pages di `ci.yml` menghentikan pembayaran baru web/Telegram/WA dan reissue, dengan pemberitahuan order manual via hub WA. Ini nilai build nonrahasia, bukan env/secret runtime Pages.
- Pemulihan: ubah nilai CI ke `"false"`, verifikasi, commit/push; perubahan env Cloudflare saja tidak mengubah bundle lama. Dev memakai prefix env; test menguji kedua mode.
- Jangan menonaktifkan webhook/status/fulfillment/cleanup atau menghapus invoice lama. Mode terpisah dari kuota D1, tanpa auto-resume/estimasi jam selesai atau siaran massal otomatis.
