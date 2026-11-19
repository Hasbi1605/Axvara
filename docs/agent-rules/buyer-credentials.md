# Aturan agent — Kredensial pembeli (invoice + kontak + PIN)

## Ambil Ulang: dekripsi gagal = permanen — 20 November 2026

- `resendTelegramCredentials` membedakan tiga kelas kegagalan. (a) Baris
  `delivered_ciphertext`/`delivered_iv` NULL atau `orders.fulfillment_status='delivered'`
  tanpa baris = **permanen tidak tersimpan** ("tidak tersimpan di bot", tanpa `🔁`).
  (b) Baris yang **tidak bisa didekripsi** (atau plaintext kosong) = juga
  **permanen**: AES-256-GCM terauntentikasi, jadi auth-tag mismatch hanya berarti
  kunci lain/tamper dan retry tidak akan pernah berhasil. Ini yang membuat order
  `sk:` Oktober 2026 (kunci `FULFILLMENT_ENCRYPTION_KEY` diganti 10 Nov 2026,
  ARCHITECTURE §16.2) berputar di "coba ambil detail lagi" selamanya. (c) Hanya
  kegagalan kirim/DB yang tetap **transient** dengan `🔁 Coba lagi`.
- Jangan mengembalikan (b) ke transient "karena mungkin kunci sementara salah";
  itu menciptakan loop tanpa akhir bagi pembeli. Pemulihan hanya lewat admin
  (kirim ulang manual/serah terima), bukan tombol pembeli.
- `sendTelegramCredentialParts` mengirim HTML sekali, lalu **satu** percobaan
  plain text bila Telegram menolak entitas (`400 can't parse entities`) atau
  panjang; bagian >4096 dipecah, bukan menggagalkan unit. Penolakan 400 lain
  (chat not found/blocked) TIDAK memakai fallback plain text agar kegagalan
  nyata tidak tersamar sebagai masalah format.
- Diagnostik: satu baris `[tg-resend] failed` per unit dengan
  `{ order, item, stage: decrypt|empty|render|send, tg }` (`tg` = `error_code` +
  `description` ≤120). JANGAN pernah menulis plaintext/ciphertext ke log.
- Berlaku global untuk kanal Telegram (`sendTelegramCredential`,
  `sendTelegramCredentialParts`) termasuk pengiriman awal; status: implementasi
  lokal + test, publikasi CI/deployment belum diverifikasi.

## Cookie perangkat d1 (30 hari) — keputusan owner 18 November 2026

- Menggantikan sebagian aturan28Oktober "proof hanya sessionStorage/tab": owner
  menyetujui proof perangkat `d1` agar browser yang sama membuka pesanan
  otomatis (tab baru, daftar perangkat, link email). Hanya pin6.
- `d1` HANYA diterbitkan dari c1 valid (POST `/api/orders/[code]/device` atau
  sukses `/credentials` via c1) atau sukses kontak+PIN. Lookup kontak saja,
  p1/status, admin, Telegram, link email/share tidak pernah menerbitkannya.
- Hanya cookie HttpOnly/SameSite=Lax/Secure, Path `/api/orders/<CODE>`, umur
  tetap 30 hari (tidak diperpanjang saat dipakai), terikat versi akses. Jangan
  memindahkannya ke URL, localStorage, body respons, log atau email.
- d1 setara c1 untuk `/credentials` (body `{device:true}`) dan `/pin`; tidak
  untuk status/cancel/reissue/refill. Jalur d1 tidak memakai jatah PIN.
- Risiko diterima owner: siapa pun di browser yang sama dapat membuka pesanan
  itu selama 30 hari; ✕ di daftar perangkat menghapus cookie.
- Input PIN `type=text` + `autocomplete=one-time-code` (bukan password) agar
  password manager tidak mengisi PIN. PIN tetap state/DOM saja.
- Status: implementasi lokal + test; publikasi CI, deployment belum diverifikasi.

## Estimasi refund Market — 18 November 2026

- Accordion garansi tetap satu dan terlipat per pesanan lunas. Keputusan lanjutan owner: `POST /api/refund` boleh mengembalikan proyeksi estimasi hanya dengan invoice AXV, tanpa kontak/p1/c1. Pengecualian hanya untuk estimasi, bukan status order, data kontak, PIN, detail akun atau kredensial. Tautan accordion hanya membawa invoice; tidak ada perubahan issuance/persistensi proof atau pengiriman produk.
- Share dibuat admin hanya untuk ringkasan estimasi item terpilih, kadaluwarsa 7 hari dan dapat dicabut. Jangan menaruh proof akses order, PIN, kontak atau detail akun di link/payload ini.

## C0 fence kirim otomatis per item/kanal — 18 November 2026 (lokal)

- Migrasi `0135_fulfillment_send_claims.sql` menambah ledger khusus D1 dengan
  PK `(item_id,channel)` Telegram/WhatsApp, status `sending/sent/failed`, token
  kepemilikan, SHA-256 payload, checkpoint bagian dan jumlah klaim. Jangan
  memakai `store_settings`, membangun ulang `buyer_notice_log`, atau menyimpan
  plaintext/penerima di ledger ini. FK item `ON DELETE CASCADE`; tanpa trigger.
- Otomatis shared/unique dan receipt TUNVN/AIVault mengklaim lewat UPSERT CAS
  hanya saat lease item persis masih aktif. Hanya pemenang boleh mengirim;
  ledger hilang/gagal dibaca = fail-closed, bukan fallback kirim tanpa klaim.
  Sukses `sent` memulihkan settlement item tanpa kirim ulang. Snapshot shared
  push disimpan terenkripsi di CAS lease item yang sama sebelum kirim dan
  dipakai lagi saat pemulihan. Klaim item/job/ledger memakai native `RETURNING`
  agar tidak menambah read round-trip pada pemenang; tetap budget cron existing.
- Penolakan Telegram4xx eksplisit (kecuali408), atau reason WA pra-kirim yang
  dikenal = `failed`, boleh retry. Timeout/jaringan/5xx/hasil tak terbaca dan
  checkpoint gagal = tetap `sending`; baru dapat diambil alih sesudah **600
  detik**. WA `outcomeUnknown:false` sendiri BUKAN bukti penolakan pasti.
  Stop memulai bagian setelah30detik; timeout native Telegram teks10detik,
  WA15detik, sehingga transport terakhir≤40/45detik, jauh di bawah600detik.
  Timestamp ledger presisi milidetik, tidak dibulatkan ke detik penuh.
- Tiap bagian sukses dicheckpoint; retry hanya melanjutkan bagian yang belum
  diakui. Payload berubah sebelum `sent` ditolak `credential_send_payload_changed`
  agar indeks checkpoint tidak menunjuk isi berbeda; admin perlu merekonsiliasi.
  `sent` dipercaya tanpa mengirim ulang sekalipun copy/S&K sudah berubah.
- Pending/ambigu/yield menunda item/job10menit tanpa menghabiskan jatah gagal.
  Ledger membatasi maksimal5 klaim otomatis (termasuk yield); habis masuk retry
  gagal normal menuju tindak lanjut admin, bukan mengirim tanpa batas. Klaim
  basi setelah hasil ambigu tetap bisa menggandakan bagian terakhir: bukan
  jaminan exactly-once di provider. Lebih baik terlambat daripada replay segera.
- Email web/salinan Telegram dan ledger email TIDAK berubah. Tombol pembeli
  `resendTelegramCredentials` (pemilik + chat privat) dan handover admin memakai
  jalur eksplisit existing, bukan fence item otomatis. Tidak membuat API resend
  admin baru, tidak mengaktifkan DM/bot WhatsApp atau mengubah kill-switch.
- Status: implementasi/fixture/native D1 lokal; belum publikasi/deployment.

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

## PIN di halaman setelah lunas — keputusan owner 16 November 2026

- Menggantikan larangan PIN web/email-only pada snapshot28Oktober di bawah.
  Tetap bernama **PIN**, memakai PIN6 existing, bukan kode kedua. Sesudah
  `status=lunas` DAN `payment_status=paid`, pemilik c1 checkout asli yang valid
  atau capability kredensial terverifikasi boleh melihat/menyalin PIN di halaman
  pesanan/lacak, termasuk sebelum produk siap. Email produk siap tetap salinan
  kredensial+PIN; tidak ada email PIN awal, perubahan bot, env atau migrasi.
- POST privat/no-store `/api/orders/[code]/pin` hanya menerima header
  `x-checkout-credential-grant` atau `x-credential-token`. Invoice+kontak, PIN di
  body, p1, admin/session status bukan izin reveal. PIN tidak masuk status/lookup,
  checkout response, GET publik, URL, log, history atau storage browser.
  Recheck versi/format/payment/quote dan revokasi capability sebelum respons;
  key/DB gagal503, rotasi/expiry/order lain ditolak. Tidak menerbitkan token baru.
- Selama c1/capability sah, detail produk otomatis terbuka begitu siap tanpa
  form PIN. Gangguan sementara menawarkan retry, bukan meminta PIN ulang;
  proof yang ditolak kembali ke kontak checkout+PIN. Setelah verifikasi manual
  berhasil, PIN terverifikasi tampil juga bila issuance token tidak mengembalikan
  token baru. Semua PIN hanya state/DOM, bukan persist.
- Kartu ringkas memakai `ax-glass-card` existing: satu baris label/PIN/Salin,
  helper “Simpan untuk akses di perangkat lain.”, locale pesanan. Target/fokus
  keyboard dan fallback salin manual dipertahankan. Berlaku implementasi lokal;
  publikasi CI, deployment belum diverifikasi.

## Salinan email pembeli Telegram — 4 November 2026
- Keputusan owner: order Telegram yang memuat produk wajib email (`needsEmailForVariant`) dan punya `customer_email` valid menerima email yang SAMA dengan web (Pesanan Siap berisi kredensial lengkap + tanda terima + kabar pembeli). Gerbang wajib-email jangan dihapus: email tersimpan Telegram ikut menempel ke order berikutnya, dan owner tidak ingin email untuk produk yang tidak memintanya.
- DM Telegram tetap kanal otoritatif dan private-only; email hanya salinan best-effort idempoten (`buyer_notice_log`). Kegagalan email tidak boleh menggagalkan, me-retry, atau menggandakan DM. Tidak mengirim PIN/kredensial ke pesan Telegram di luar aturan yang ada.

- Email pembeli Market (kredensial, akses PIN, handover, bukti bayar, gagal kirim, QRIS kedaluwarsa) mengikuti `order.locale`: subject/isi/tombol EN bila pesanan EN, default ID. Nama produk di email memakai `name_en`/terjemahan token saat EN. Sender, penerima, secret, rate limit, dan semantics pengiriman tidak berubah; email admin tetap ID.

## Snapshot kredensial pembeli — 28 Oktober 2026 (bagian PIN web diganti 16 November)
- Koreksi owner menggantikan aturan PIN checkout27Oktober: PIN6 huruf+angka hanya dikirim bersama kredensial lengkap dalam email produk siap. Jangan mengirim email khusus PIN saat order dibuat/paid, mengembalikan PIN dalam respons buyer, menampilkan kartu/reveal PIN buyer, menaruh PIN dalam URL/fragment/storage atau pesan Telegram. Kredensial tetap langsung tampil dalam email.
- Kredensial web pin6 lewat lacak tanpa proof checkout asli wajib invoice + email/WA checkout penuh + PIN sebagai field terpisah. Admission D1 atomik sebelum compare, max10 gagal/in-flight per order+versi/15menit lintasIP, sukses decrement slot sendiri, error503 fail-closed. Kontak salah/PIN salah sama-sama generik404. Belum lunas/kredensial belum tersedia tidak menuntut PIN yang belum dikirim.
- Sesi status p1 HMAC256/order+versi/24jam hanya untuk GET status masked/wake melalui allowStatusSession eksplisit. Prefixb1 lama ditolak. Cancel/reissue/refill tetap kontak, tidak cukup sesi status. Pedia tanpa kredensial tidak memakai PIN untuk status/refill.
- Koreksi lanjutan owner28Oktober: tab checkout Market asli otomatis membuka kredensial sesudah paid/ready tanpa PIN. Hanya POST checkout dengan quote bertanda tangan yang cocok order durable boleh menerbitkan proof c1/HMAC256/domain terpisah/order+versi+HMAC quote_id tersimpan/expiry tetap24jam. Lookup kontak/p1/status/admin/Telegram tidak pernah menerbitkan atau memperbarui c1. Simpan c1 hanya sessionStorage/memori tab, bukan URL/localStorage/log; jangan mengirim PIN ke web. Credentials POST menerima c1 valid atau kontak+PIN, lalu capability generation CAS existing. Rotasi mencabut c1; quote/versi/order lain, metadata hilang, key hilang, belum paid/ready ditolak. Status/cancel/reissue/refill tidak menerima c1. Tidak mengubah Pedia/WA.
- Sesudah proof kontak+PIN atau c1 checkout asli, capability GET dapat disimpan sessionStorage. Migrasi0083 menambah wr_credential_tokens.buyer_access_version default0; pin6 verifier wajib versi token=current order>0, issuance INSERT SELECT CAS sesudah proof lengkap. Writer/token lama tidak boleh bypass cutover. Legacyv0 tetap kontak; code26 tetap strong-code kompatibel, tidak backfill/exchange kontak.
- PIN HMAC30bit domain buyer-order-pin dengan rejection campuran; factorybaru version1/formatpin6, migrasi0082 defaultcode26 menjaga kode128bit lama. BUYER_ORDER_ACCESS_SECRET khusus existing dari .buyer-access-credentials ignored/chmod600/Pages secret_text, produksi67/128 termasuk4 sistem. Jangan log/commit key/PIN. Password/JWT rotation tidak mengubah PIN; buyerkey rotation membatalkan seluruh kode/PIN/sesi. Key hilang503 sebelum reservasi.
- Factory order tidak lagi mengantrekan email PIN. Prefix lama email:access_pin: inert, metadata tidak dihapus. Adminrotate CAS+revoke+audit mengantrekan prefixbaru email:credential_access:order:vN hanya bila paid+kredensial tersedia; sender merender ulang kredensial lengkap+PIN versi aktual, job superseded tidak dikirim. Metadata-only, Resend idempotency order+versi+HMAC isi tanpa PIN mentah, lease CAS, increment attempt sebelum fetch, max5/backoff1/5/15/60menit, timeout8detik, notify existing bounded2/deadline/budget8statement peremail+2probe, tanpa env/cron baru.
- Reveal admin POST privat/no-store/audit tetap terpisah dari GET/cache; bukan akses buyer. Admin memverifikasi buyer di luar aplikasi, tidak ada recovery mandiri dari kontak. Jangan menambah PIN ke GET admin/list/cache.
- Browser hanya menyimpan kontak/sesi status, c1 checkout asli atau capability sementara di tab. PIN yang diketik hanya React state, jangan persist bahkan sessionStorage. History tidak menyimpan PIN/sesi. Telegram command/callback tetap pemilik/chat pribadi. Bot WA nonaktif dan di luar scope, jangan diaktifkan/DM/grup diubah.
- Rincian keputusan terkini: issue/buyer-contact-pin-2026-10-28.md; dokumen buyer-access/buyer-pin27Oktober adalah histori yang digantikan pada bagian terkait.
