# Invoice, kontak dan PIN untuk membuka kredensial

Koreksi owner28Oktober menggantikan ketentuan pengiriman/display PIN pada rilis
9fe3170. Implementasi lokal untuk publikasi melalui CI, bukan bukti deployment.

| Jalur | Data yang diperiksa | Data yang diberikan |
| --- | --- | --- |
| Checkout quote valid | Quote bertanda tangan, order durable, guard harga/stok | Invoice/QR, sesi status dan c1 checkout asli, tanpa PIN |
| Kredensial tab checkout asli | c1 valid terikat quote/order/versi, paid/ready | Akun otomatis tanpa input PIN, capability untuk akses ulang |
| Lacak status | Invoice + email/WA checkout penuh | Status dan kontak tersamar, tanpa kredensial/PIN |
| Status tab checkout | Sesi p1 valid dan versi order | Status/pembayaran, tanpa kredensial/PIN |
| Kredensial order PIN6 baru | Invoice + kontak penuh + PIN | Kredensial dan capability untuk akses ulang |
| Kredensial legacy v0 | Kontak checkout seperti sebelumnya | Kredensial setelah paid/ready |
| Kredensial code26 yang sudah terbit | Kode lama yang sah | Kompatibilitas tanpa mengubah kode |
| Email produk siap | Pembayaran dan fulfillment existing | Kredensial lengkap langsung + PIN dalam pesan sama |
| Pedia tanpa akun/kredensial | Kontak penuh untuk status/refill | Status dan tindak lanjut, tanpa langkah PIN |

## Pemisahan proof dan cutover

Body contact dan access_code adalah dua field berbeda. PIN saja, kontak saja,
kontak salah/PIN benar, dan kontak benar/PIN salah tidak membuka kredensial PIN6.
Sesi p1 maupun b1 juga tidak memenuhi proof kredensial. Admission10 gagal/in-flight
per order+versi/15menit lintasIP tetap atomik sebelum compare. Keberhasilan hanya
mengurangi slot sendiri; semua gagal generik404, admission D1 bermasalah503.

Prefix p1 memakai domain status baru dan hanya diterima oleh GET status yang
secara eksplisit mengizinkannya. Prefix b1 lama ditolak. Cancel/reissue/refill
tetap memerlukan kontak dan guard state existing. Belum siap/paid tidak menuntut
PIN yang belum pernah dikirim. Plaintext akun tidak dibaca sebelum proof lengkap.

Koreksi lanjutan owner: tab checkout asli otomatis membuka akun tanpa PIN.
Proof c1 HMAC256 memakai domain terpisah dan mengikat order, versi, HMAC quote_id
tersimpan serta expiry tetap24jam. Hanya respons checkout yang sudah memverifikasi
quote bertanda tangan dan order durable dapat menerbitkannya, termasuk retry jti
asli. Quote baru untuk keranjang yang sama tidak cocok dengan order korban.
Lookup kontak/p1/status tidak menerbitkan atau memperbarui c1. Header khusus c1
hanya diterima credentials POST; guard paid/ready dan CAS capability generasi
tetap. Counter PIN tidak dikonsumsi atau dihapus oleh c1. Rotasi mencabutnya.
Client menyimpan bukti kuat ini hanya di tab, tidak menyimpan/menampilkan PIN.

Migrasi0083 menambah wr_credential_tokens.buyer_access_version default0. Writer
lama, termasuk yang masih berjalan di sela migrasi/deployment, hanya menulis0.
API setelah kontak+PIN atau c1 checkout asli lolos menulis versi akses yang diverifikasi lewat INSERT
SELECT kondisional, hanya bila order paid dan versinya masih sama. Untuk PIN6,
verifier token mewajibkan versi token sama dengan versi order dan positif.
Capability lama PIN6 tidak dapat melewati kebijakan baru; legacy/code26 tetap
mempertahankan expiry/revokasinya. Rotasi versi mencabut seluruh token sebelumnya.

## Satu pengiriman PIN bersama kredensial

Tidak ada statement/email PIN di factory baru, respons checkout, pesan pembayaran,
status Pedia atau Telegram. Email ready existing tetap memuat kredensial langsung
dan PIN. Kegagalan derivasi key/metadata tidak boleh diam-diam mengirim email order
baru tanpa PIN; jalur delivery menunda/retry sesuai penanganan error existing.

Prefix antrean lama email:access_pin: berhenti diproses. Metadata historis tidak
dihapus. Tidak menghapus/mengubah email yang sudah terkirim sebelum pembaruan.

Rotasi admin menggunakan batch versi+revoke+audit existing. Bila paid dan akun
tersedia, batch mengantrekan prefix email:credential_access:order:vN. Setelah audit,
sender membaca versi aktual; job superseded tidak mengirim. Sender mendekripsi
snapshot credential sementara, merender template ready berisi seluruh akun yang
tersedia dan PIN baru, lalu mengirim ke email tersimpan. Tidak ada PIN/credential
plaintext di antrean atau error. Retry provider memakai idempotency order/versi/HMAC isi,
lease CAS, max5attempt dengan increment sebelum fetch, timeout8detik dan deadline.
Cron notify existing maksimal2 email, anggaran8 statement per email ditambah2
probe, tanpa env/trigger baru. Retry ambigu memakai key dan isi sama; perubahan isi kredensial mendapat key baru. Hash isi memakai HMAC key buyer terpisah domain, bukan hash yang dapat dipakai menebak PIN secara offline.

## Tampilan dan penyimpanan

Kartu PIN/salin di halaman checkout/pesanan dihapus. Form lacak memisahkan invoice,
kontak dan PIN; PIN boleh kosong untuk cek status, wajib untuk membuka akun baru
tanpa proof checkout asli/capability valid.
Panel kredensial meminta kontak+PIN dengan password input dan submit native bila
tidak memiliki c1 checkout asli atau capability valid. Tab checkout asli otomatis
memuat akun sesudah paid/ready.
PIN hanya berada dalam React state dari input pembeli, tidak disimpan dalam
sessionStorage/localStorage/fragment. Browser hanya menyimpan kontak/status token, c1 checkout
atau capability sementara. Tidak ada PIN dalam respons buyer, query, log atau
riwayat. Admin reveal yang teraudit tetap jalur privat owner, bukan API buyer.

Desain mengikuti Midnight/Cyan AXVARA, tanpa kartu promosi PIN, glow atau aset baru.
PIN pada email ready adalah informasi akses tambahan, kredensial tetap langsung
terbaca. Bot WA nonaktif, tidak diaktifkan/diubah. Pengiriman kredensial Telegram
yang sudah terikat identitas platform tetap, tetapi pesan Telegram tidak memuat PIN.

## Pengujian

Fixture mencakup matriks proof, p1/b1 tidak membuka akun, token PIN6 pra-cutover
ditolak sementara token legacy tetap sah, race rotasi saat issuance, migrasi
metadata, antrean lama inert, tidak ada email sebelum akun siap, resend lengkap,
versi superseded, biaya cron, dan kode/format lama. UI diperiksa di Obscura pada
ponsel/desktop dengan data buatan tanpa order/pembayaran/pesan produksi.

Hasil akhir termasuk checkout otomatis: seluruh3417test/279file lulus, type-check lulus, build Pages selesai,
dev home/CSS200. Obscura390/1440 memeriksa route lacak aktual dan komponen order
aktual dalam fixture inert: kontak/PIN salah tertahan, proof lengkap membuka akun,
salin akun berjalan, tanpa PIN dalam URL/storage atau kartu checkout, tanpa
overflow/pageerror. Preview email memperlihatkan kredensial langsung dan PIN
ringkas dalam pesan sama. Review backend independen tidak menemukan blocker
material. Rincian [pemeriksaan UI](buyer-contact-pin-ui-check-2026-10-28.md).

Tambahan c1: Obscura390/1440 membuktikan akun terbuka otomatis pada tab checkout
asli tanpa input PIN, sementara tab tanpa proof tetap meminta PIN. Fixture backend
mencakup quote baru untuk keranjang identik, retry quote asli sesudah paid, grant
order/quote/versi/expiry/signature salah, p1 salah purpose, missing metadata/key,
guard paid/ready, serta counter PIN penuh yang tidak memblokir proof checkout.
Proof c1 adalah bearer24jam yang tetap bergantung pada keamanan tab pembeli;
tidak ada renewal dari endpoint status/lookup/credentials. PIN hanya di email.

Tidak ada pengiriman email, order atau pembayaran produksi untuk QA. Batas renderer
keyboard dicatat pada laporan UI. Tidak menjanjikan email masuk inbox atau
menyamakan push dengan deployment.
