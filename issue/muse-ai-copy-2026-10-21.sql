-- Salinan produk Muse sesuai arahan owner 2026-10-21.
-- Patch data sekali jalan, bukan migrasi schema; jalankan lewat D1 execute --file.
-- Guard mempertahankan suntingan admin baru; harga, stok, foto dan garansi tetap.
UPDATE products SET description = 'Muse AI adalah AI agent untuk membantu produktivitas, coding, riset, analisis data, penulisan, pembuatan konten, hingga penjadwalan. Dengan harga Rp16.000, kamu mendapatkan akun siap pakai dengan 1 miliar token tambahan dan akses fitur Muse yang tersedia pada akun.

- Komputer virtual bawaan di cloud untuk menjalankan tugas tanpa menyewa VPS tambahan atau menyalakan laptop terus-menerus
- Mendukung pekerjaan latar belakang dan tugas terjadwal sepanjang hari, termasuk saat aplikasi ditutup, selama kuota dan layanan tersedia
- Spesifikasi referensi dari informasi akun: 2 vCPU, RAM sekitar 7,7 GB, dan storage 100 GB; alokasi dapat berbeda atau berubah mengikuti layanan Muse
- Browser bawaan untuk pencarian informasi, membuka situs, mengisi formulir, dan mengerjakan tugas web; aktivitasnya dapat dipantau dan kamu dapat mengambil alih kendali
- Integrasi WhatsApp native untuk memberi instruksi melalui chat setelah nomor ditautkan lewat fitur bawaan, tanpa menyiapkan bot atau server sendiri
- Beragam konektor, seperti Google Calendar, Drive, Sheets, Docs, GitHub, Canva, Dropbox, dan Outlook, untuk menghubungkan pekerjaan dalam satu tempat
- Bantu membuat dan memperbaiki kode, mengolah file, merangkum sumber, menyusun konten, serta mengatur jadwal dan pengingat
- Email akun dapat diganti ke email pribadi setelah login agar akses lebih mudah diamankan
- Siap digunakan tanpa memasukkan kartu kredit, menyiapkan VPS, atau menggunakan VPN pada akses awal akun yang diberikan', updated_at = datetime('now')
WHERE id = 112 AND slug = 'muse-ai-1-miliar-token' AND source = 'manual'
  AND COALESCE(description, '') = '' AND admin_description_override IS NULL;

UPDATE product_variants SET admin_terms = 'Detail paket:
- Mendapatkan akun Muse siap pakai dengan 1 miliar token tambahan; paket dasar dapat tetap tertulis Free plan
- Token tambahan bukan langganan berbayar atau akses unlimited; penggunaan mengurangi saldo sesuai perhitungan Muse
- Token tambahan ditampilkan tanpa kedaluwarsa pada halaman Usage saat referensi dibuat; ini bukan jaminan akun atau layanan aktif selamanya
- Komputer virtual dan browser merupakan fasilitas bawaan Muse untuk pekerjaan agent, dengan kapasitas dan batas penggunaan mengikuti layanan

Proses & pengiriman:
- Setelah pembelian diproses, kamu menerima email akun dan akses web OTP untuk login
- Email akun dapat diganti ke email pribadi setelah berhasil masuk dan menyelesaikan verifikasi

Aturan pakai:
- Wajib segera mengamankan akun dengan mengganti email ke email pribadi yang aktif dan dapat diakses
- Jangan membagikan email login, kode OTP, atau tautan akses OTP kepada orang lain
- WhatsApp dan konektor memerlukan penautan atau otorisasi akun pribadi sebelum digunakan; langganan layanan pihak ketiga tidak termasuk
- Fitur, spesifikasi komputer virtual, akses wilayah, dan batas penggunaan mengikuti ketersediaan serta kebijakan Muse
- Pekerjaan 24 jam mengikuti kuota, izin, dan ketersediaan layanan; bukan jaminan tugas berjalan tanpa henti atau selalu berhasil
- Gunakan sesuai ketentuan Muse, tinjau hasil AI, dan periksa izin sebelum menyetujui tindakan pada akun atau layanan yang terhubung

Garansi:
- Varian ini tanpa garansi, sesuai informasi varian produk
- Jika akses awal bermasalah, hubungi admin AXVARA dengan kode pesanan dan screenshot kendala untuk pengecekan; jangan sertakan kode OTP',
admin_activation = 'Masuk dan amankan akun:
1. Buka detail akses pada pesanan yang sudah selesai diproses, lalu siapkan email akun dan tautan web OTP yang diberikan
2. Buka https://muse.ai melalui browser dan pilih masuk menggunakan email akun dari pesanan
3. Minta kode login, buka web OTP yang diberikan, lalu ambil kode terbaru untuk email akun tersebut
4. Masukkan kode OTP ke halaman login Muse sebelum kode kedaluwarsa; jangan berikan kode kepada pihak lain
5. Setelah berhasil masuk, buka Settings, lalu General dan Meta Account untuk mengelola detail akun; nama menu dapat berubah mengikuti tampilan Muse
6. Ganti email akun ke email pribadimu, ikuti verifikasi yang diminta, dan pastikan email baru sudah terverifikasi sebelum keluar dari sesi aktif
7. Periksa pengaturan keamanan dan sesi perangkat; aktifkan perlindungan tambahan jika tersedia, lalu simpan informasi akses baru dengan aman

Mulai menggunakan Muse:
1. Periksa Settings bagian Usage untuk melihat paket dan saldo token tambahan pada akun
2. Kirim instruksi yang jelas, misalnya membuat website, merangkum riset, menganalisis file, atau menyusun jadwal dan pengingat
3. Untuk memakai WhatsApp, buka Messaging channels dan ikuti petunjuk penautan nomor pribadi melalui fitur bawaan Muse
4. Buka Connectors untuk menghubungkan layanan yang diperlukan, lalu tinjau izin akses yang diminta
5. Gunakan browser bawaan untuk memantau tugas web atau mengambil alih kendali saat dibutuhkan; ikuti permintaan login dan persetujuan tindakan
6. Untuk tugas terjadwal, sebutkan pekerjaan, waktu, dan zona waktu dengan jelas, lalu periksa jadwal serta aktivitas yang dibuat Muse

Catatan:
- Jika OTP belum muncul atau pergantian email terkendala, gunakan kode terbaru dan hubungi admin dengan kode pesanan jika kendala berlanjut',
admin_copy_fingerprint = '', updated_at = datetime('now')
WHERE id = 248 AND product_id = 112 AND sku = 'DEFAULT-MUSE-AI-1-MILIAR-TOKEN'
  AND wr_variant_id IS NULL AND sk_variant_id IS NULL
  AND admin_terms = 'Testinggg' AND admin_activation IS NULL
  AND COALESCE(admin_copy_fingerprint, '') = ''
  AND EXISTS (SELECT 1 FROM products WHERE id = 112 AND slug = 'muse-ai-1-miliar-token' AND source = 'manual');
