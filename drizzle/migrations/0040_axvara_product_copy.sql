-- 0040_axvara_product_copy.sql — Deskripsi produk versi Axvara (2026-09-24).
--
-- Permintaan owner: deskripsi, S&K, dan cara aktivasi diseragamkan dalam
-- suara Axvara untuk produk WR maupun non-WR, tanpa kalimat berulang, dan
-- tanpa menghilangkan maksud/ketegasan keterangan pemasok.
--
-- Format deskripsi baru (diurai src/lib/product-copy/format.ts):
--   paragraf pembuka, lalu baris "- " untuk keunggulan, lalu (opsional)
--   judul "Syarat & Ketentuan:" / "Cara Aktivasi:" untuk bagian yang tampil
--   di kartu S&K PDP (terlipat di mobile). Aturan pakai TIDAK ditulis di
--   deskripsi: untuk produk WR, S&K + cara aktivasi datang per varian dari
--   wr_variants dan versi Axvara-nya dipilih di kode (curated.ts), bukan di DB.
--
-- Kepemilikan (ownership.ts) tetap dihormati:
--   - Produk WR: ditulis ke admin_description_override (milik admin, tidak
--     pernah disentuh sync). `description` milik WR tetap utuh, dan override
--     yang SUDAH diisi admin tidak ditimpa.
--   - Produk non-WR: `description` hanya diganti bila isinya masih PERSIS
--     teks lama saat dikurasi, supaya suntingan admin sesudahnya aman.
-- Kunci baris = slug (sync WR hanya mengisi slug saat INSERT) + source.
-- Idempoten: menjalankan ulang tidak mengubah apa pun (guard di WHERE).
-- api-testing sengaja dilewati (produk uji nonaktif).

-- Produk WR → admin_description_override (hanya bila masih kosong).
UPDATE products SET admin_description_override = 'Loklok adalah platform streaming untuk menonton film, serial TV, drama (termasuk drama Korea), dan anime dalam satu aplikasi.', updated_at = datetime('now')
  WHERE slug = 'loklok' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Netflix Premium adalah paket tertinggi dari layanan streaming paling populer di dunia, cocok untuk hiburan pribadi maupun keluarga.

- Ribuan film, serial, dokumenter, dan tayangan original eksklusif
- Kualitas tayangan terbaik', updated_at = datetime('now')
  WHERE slug = 'netflix-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'CapCut Pro adalah versi premium aplikasi edit video populer untuk hasil yang lebih profesional, ideal bagi kreator TikTok, Instagram Reels, dan YouTube Shorts.

- Tanpa watermark dan bebas iklan
- Fitur-fitur eksklusif versi Pro', updated_at = datetime('now')
  WHERE slug = 'capcut-pro' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Claude Pro adalah paket langganan berbayar ($20/bulan) dari Anthropic untuk chatbot AI Claude, dirancang untuk penalaran kompleks dan analisis dokumen.

- Penggunaan 5x lebih banyak daripada versi gratis
- Akses prioritas dan fitur terbaru', updated_at = datetime('now')
  WHERE slug = 'claude-pro' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'YouTube Premium menghadirkan pengalaman YouTube tanpa iklan di semua perangkat tempat kamu login, termasuk aplikasi YouTube Kids.

- Tanpa iklan, bisa unduh video untuk ditonton offline
- Putar di latar belakang (background play)
- Termasuk YouTube Music Premium: musik bebas iklan, offline, dan background play', updated_at = datetime('now')
  WHERE slug = 'youtube-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Leonardo.Ai adalah platform AI generatif untuk membuat aset visual berkualitas tinggi dari perintah teks (prompt), dirancang untuk kreator, desainer, dan pelaku bisnis.

- Gambar dan ilustrasi berkualitas tinggi
- Konsep seni dan tekstur 3D', updated_at = datetime('now')
  WHERE slug = 'leonardo-ai' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Spotify Premium adalah layanan streaming musik tanpa iklan untuk pengalaman mendengarkan yang lebih bebas, fleksibel, dan berkualitas tinggi, cocok untuk penikmat musik, podcast, dan playlist harian.', updated_at = datetime('now')
  WHERE slug = 'spotify-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Getcontact membantu mengenali nomor telepon tak dikenal dan memblokir panggilan spam, berdasarkan basis data penggunanya.

- Lihat siapa yang menelepon dari nomor tak dikenal
- Blokir panggilan dan pesan yang mengganggu atau spam', updated_at = datetime('now')
  WHERE slug = 'getcontact-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Apple Music adalah layanan streaming musik premium dengan jutaan lagu tanpa iklan.

- Kualitas audio tinggi
- Playlist eksklusif dari seluruh dunia', updated_at = datetime('now')
  WHERE slug = 'apple-music' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'ChatGPT Plus adalah paket langganan resmi dari OpenAI yang membantu menjawab pertanyaan, membuat konten, hingga mendukung pekerjaan profesional.

- Akses ke model terbaru dengan performa lebih cepat dan stabil
- Prioritas akses dan fitur premium lainnya', updated_at = datetime('now')
  WHERE slug = 'chatgpt-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Vidio Platinum adalah layanan streaming premium dari Vidio untuk menikmati hiburan favorit dengan kualitas terbaik dan tanpa gangguan.

- Akses penuh ke film dan series
- Siaran olahraga eksklusif', updated_at = datetime('now')
  WHERE slug = 'vidio-platinum' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Viu Premium adalah layanan streaming drama Asia, film, dan variety show, cocok untuk pecinta drama Korea, Jepang, dan Thailand.

- Akses eksklusif dan bebas iklan
- Subtitle lengkap dan episode cepat tayang', updated_at = datetime('now')
  WHERE slug = 'viu-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Zoom Pro adalah layanan meeting premium untuk kerja, kelas online, dan rapat yang lebih nyaman.

- Panggilan video tanpa batas waktu
- Kapasitas peserta lebih banyak
- Rekaman cloud dan kontrol meeting lanjutan', updated_at = datetime('now')
  WHERE slug = 'zoom-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Prime Video adalah layanan streaming dari Amazon dengan konten lengkap dalam satu platform.

- Film, serial, dan tayangan eksklusif Prime Original
- Kualitas tinggi dengan fitur nonton offline', updated_at = datetime('now')
  WHERE slug = 'prime-video' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'TradingView adalah platform charting dan jaringan sosial berbasis cloud tempat trader dan investor menganalisis pasar keuangan global, dari saham, kripto, hingga forex.', updated_at = datetime('now')
  WHERE slug = 'tradingview-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Scribd Premium memberi akses penuh tanpa batas ke perpustakaan digital Scribd.

- Ebook dan audiobook
- Dokumen, majalah, dan sheet musik', updated_at = datetime('now')
  WHERE slug = 'scribd' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'HMA VPN (HideMyAss) adalah VPN yang mudah digunakan dengan lebih dari 1.100 server di 190 negara. Kecepatannya bisa tidak stabil dan kurang optimal untuk streaming.

- Enkripsi kuat
- Kebijakan no-logs', updated_at = datetime('now')
  WHERE slug = 'hma-vpn' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'ExpressVPN adalah layanan VPN premium yang cepat, aman, dan mudah digunakan, cocok untuk streaming, gaming, dan menjaga privasi online.

- Lebih dari 3.000 server di 105+ negara
- Tanpa log aktivitas', updated_at = datetime('now')
  WHERE slug = 'express-vpn' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'VCC (Virtual Credit Card) adalah kartu digital sekali pakai atau sementara untuk membayar langganan layanan digital, seperti klaim trial aplikasi premium, tanpa memakai kartu utamamu.

- 16 digit nomor kartu, tanggal kedaluwarsa, dan kode CVV seperti kartu kredit fisik
- Data kartu utamamu tetap aman', updated_at = datetime('now')
  WHERE slug = 'vcc-trial-aplikasi' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Microsoft 365 adalah platform produktivitas berbasis cloud dengan aplikasi Office populer, pembaruan fitur terbaru, dan keamanan tingkat lanjut.

- Word, Excel, PowerPoint, Outlook, dan Teams
- Bonus penyimpanan cloud OneDrive 1 TB', updated_at = datetime('now')
  WHERE slug = 'office365-lifetime' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Windows adalah sistem operasi dari Microsoft yang paling populer untuk PC dan laptop, untuk menjalankan aplikasi, menjelajah internet, dan mengelola file.', updated_at = datetime('now')
  WHERE slug = 'windows-10-11-pro' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'PicsArt Pro adalah versi premium PicsArt untuk edit foto dan video yang lebih profesional.

- Akses penuh ke efek, stiker, font, dan alat canggih
- Tanpa iklan', updated_at = datetime('now')
  WHERE slug = 'picsart-pro' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Wink Premium membuka semua keunggulan aplikasi Wink dengan akses penuh ke fitur eksklusif dan fitur lanjutan, untuk pengalaman yang lebih personal dan efisien.', updated_at = datetime('now')
  WHERE slug = 'wink-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Meitu Premium adalah layanan edit foto profesional untuk menghasilkan foto yang lebih estetik, halus, dan siap dibagikan.

- Fitur beauty dan retouch lanjutan
- Filter eksklusif dan tools kreatif', updated_at = datetime('now')
  WHERE slug = 'meitu-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Remini adalah editor foto dan video berbasis AI untuk mengubah gambar berkualitas rendah menjadi tajam dan jernih.

- Menjernihkan gambar buram
- Memperbaiki foto lama yang rusak
- Mempertajam resolusi rendah menjadi kualitas HD', updated_at = datetime('now')
  WHERE slug = 'remini-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Bstation Premium adalah layanan streaming anime dan konten Asia populer, cocok untuk penggemar anime, drama, dan hiburan Asia lainnya.

- Bebas iklan dengan kualitas gambar tinggi
- Akses cepat dan nyaman', updated_at = datetime('now')
  WHERE slug = 'bstation' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'WeTV VIP adalah layanan streaming drama Asia, film, dan variety show, cocok untuk penggemar drama China, Korea, dan Thailand.

- Bebas iklan dengan kualitas tayangan terbaik
- Serial original eksklusif WeTV', updated_at = datetime('now')
  WHERE slug = 'wetv-vip' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Crunchyroll adalah platform streaming on-demand khusus anime, dari beragam series populer hingga anime original produksi Crunchyroll sendiri.', updated_at = datetime('now')
  WHERE slug = 'crunchyroll' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Youku adalah platform streaming video asal Tiongkok milik Alibaba, dengan drama, film, anime, dan konten orisinal.

- Fitur VIP yang tersedia global
- Subtitle multibahasa', updated_at = datetime('now')
  WHERE slug = 'youku-premium' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'iLovePDF adalah platform online dengan alat lengkap untuk mengelola file PDF.

- Gabungkan, pisahkan, dan kompres PDF
- Konversi dan edit dokumen PDF', updated_at = datetime('now')
  WHERE slug = 'i-love-pdf' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Alight Motion Premium adalah versi berbayar aplikasi edit video dan animasi untuk membuat karya berkualitas dengan mudah dan kreatif.

- Efek profesional dan layer tak terbatas
- Tanpa watermark', updated_at = datetime('now')
  WHERE slug = 'alight-motion' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Disney+ Hotstar Premium adalah layanan streaming untuk seluruh keluarga dengan kualitas terbaik dan bebas iklan.

- Film blockbuster dan serial eksklusif
- Konten Disney, Marvel, Star Wars, Pixar, dan National Geographic', updated_at = datetime('now')
  WHERE slug = 'disney-hotstar' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'SuperGrok adalah langganan premium dari xAI dengan akses ke model paling canggihnya, Grok 4, yang lebih kuat, cepat, dan pintar dibanding Grok standar.

- Multimodal: memproses teks, gambar, dan suara
- Akses alat seperti DeepSearch', updated_at = datetime('now')
  WHERE slug = 'grok-ai' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Surfshark VPN adalah layanan VPN premium untuk melindungi privasi dan kebebasan online.

- Enkripsi data yang kuat
- Koneksi cepat dan stabil dengan fitur keamanan canggih', updated_at = datetime('now')
  WHERE slug = 'surfshark-vpn' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Kiro AI (Kiro IDE) adalah IDE berbasis agen AI yang dikembangkan tim di AWS untuk mempercepat pengembangan perangkat lunak dengan pendekatan Spec-Driven Development, mengubah prompt menjadi rencana teknis, kode, dokumen, dan pengujian.', updated_at = datetime('now')
  WHERE slug = 'kiro-ai' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Devin AI Windsurf memberi akses ke sistem AI canggih untuk coding dan automation yang terintegrasi dengan workflow development modern, termasuk model terbaru seperti Claude Opus 4.7 MAX yang cepat dan akurat.', updated_at = datetime('now')
  WHERE slug = 'devin-ai-windsurf' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'HBO Max adalah layanan streaming berbayar milik Warner Bros. Discovery.

- Ribuan film dan serial populer dari HBO dan DC Universe
- Tayangan Originals eksklusif', updated_at = datetime('now')
  WHERE slug = 'hbo-max' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'iQIYI VIP adalah layanan streaming unggulan untuk drama Asia terkini, film, variety show, dan anime populer, ideal untuk penggemar drama China dan Korea.

- Tanpa iklan, kualitas tayangan hingga 1080p/4K
- Akses lebih cepat ke episode terbaru dan serial original eksklusif iQIYI
- Subtitle multibahasa', updated_at = datetime('now')
  WHERE slug = 'iqiyi' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Drakor.id adalah aplikasi tidak resmi asal Indonesia untuk streaming drama Korea dan Asia, lengkap dengan subtitle Indonesia.', updated_at = datetime('now')
  WHERE slug = 'drakor-id' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'CamScanner adalah aplikasi pemindai dokumen untuk mengubah foto dokumen menjadi file digital langsung dari HP.', updated_at = datetime('now')
  WHERE slug = 'camscanner' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Domain murah dari Name.com untuk website atau proyekmu, dengan pilihan ekstensi terbatas (daftarnya ada di Syarat & Ketentuan).', updated_at = datetime('now')
  WHERE slug = 'domain-murah' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'UpCloud adalah penyedia infrastruktur dan hosting cloud berkinerja tinggi untuk developer dan bisnis, dengan server virtual (VPS), penyimpanan, dan jaringan yang aman.', updated_at = datetime('now')
  WHERE slug = 'upcloud' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Adobe Creative Cloud membuka akses ke aplikasi kreatif andalan Adobe untuk desain, foto, video, dan animasi dalam satu langganan.

- Photoshop, Illustrator, dan InDesign
- Premiere Pro dan After Effects
- Acrobat, Lightroom, Adobe XD, dan masih banyak lagi', updated_at = datetime('now')
  WHERE slug = 'adobe-creative-cloud' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'GitHub Copilot adalah asisten coding berbasis AI dari GitHub dan OpenAI yang membantu developer menulis kode lebih cepat, langsung di editor seperti Visual Studio Code.

- Saran kode otomatis dan pelengkap baris
- Membuat fungsi utuh dari konteks atau komentar', updated_at = datetime('now')
  WHERE slug = 'github-copilot' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'GitHub Student Developer Pack adalah program resmi dari GitHub berisi berbagai fasilitas dan penawaran untuk mendukung belajar, pengembangan proyek, dan eksplorasi teknologi bagi pelajar dan mahasiswa.', updated_at = datetime('now')
  WHERE slug = 'github-student' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Canva Pro adalah versi premium platform desain grafis populer untuk membuat desain profesional dengan mudah, cocok untuk pelajar, pebisnis, konten kreator, hingga desainer.

- Canva Edu setara Canva Pro, tetapi tidak bisa upload font, durasinya lebih lama, dan tanpa garansi', updated_at = datetime('now')
  WHERE slug = 'canva-premium-wr' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

UPDATE products SET admin_description_override = 'Gemini Pro adalah model AI multimodal tercanggih dari Google untuk penalaran kompleks, analisis data luas, dan coding, serta memahami teks, gambar, video, dan audio.', updated_at = datetime('now')
  WHERE slug = 'gemini-ai-antigravity' AND source = 'warung_rebahan'
    AND COALESCE(TRIM(admin_description_override), '') = '';

-- Produk non-WR → description (hanya bila belum disunting sejak dikurasi).
UPDATE products SET description = 'Canva Pro membuka fitur premium Canva untuk desain yang lebih cepat dan tampak profesional, dari konten media sosial, presentasi, poster, dan CV hingga kebutuhan bisnis dan proyek kreatif lainnya.

- Jutaan template, elemen, foto, video, dan font premium
- Background Remover sekali klik, Magic Resize, dan fitur AI Magic Studio
- Brand Kit untuk logo, font, dan warna brand, plus export desain berkualitas tinggi', updated_at = datetime('now')
  WHERE slug = 'canva-premium' AND source = 'manual'
    AND description = '✅ Akses Template, Elemen & Konten Premium
✅ Background Remover Sekali Klik
✅ Magic Resize untuk Berbagai Ukuran Desain
✅ Magic Studio & Berbagai Fitur AI Canva
✅ Brand Kit untuk Logo, Font & Warna Brand
✅ Jutaan Foto, Video, Font & Elemen Premium
✅ Export Desain Berkualitas Tinggi
✅ Cocok untuk Konten, Bisnis, Tugas & Presentasi

💎 Desain lebih cepat. Hasil lebih profesional.

Nikmati berbagai fitur premium Canva untuk membuat desain dengan lebih praktis dan kreatif. Mulai dari kebutuhan media sosial, presentasi, poster, CV, konten bisnis hingga berbagai proyek kreatif lainnya dalam satu platform.

✨ Pilih paket sesuai kebutuhanmu dan mulai desain tanpa batas kreativitas!';

UPDATE products SET description = 'Akun GSuite siap pakai dengan pilihan durasi fleksibel, cocok untuk kebutuhan sementara seperti kerja, belajar, dan produktivitas, hingga mendaftar layanan yang menyediakan premium trial dan memerlukan akun email.

- Akun siap digunakan dengan aktivasi cepat
- Pilihan durasi mulai 1 hari hingga 1 bulan
- Cocok untuk pendaftaran aplikasi atau layanan premium trial

Syarat & Ketentuan:
- Angka hari pada nama varian adalah masa aktif akun, bukan waktu proses (1 Hari aktif 1 hari, 3 Hari aktif 3 hari, 7 Hari aktif 7 hari, 1 Bulan aktif 1 bulan)
- Masa aktif dimulai sejak akun diberikan atau diaktifkan
- Full garansi selama masa aktif akun', updated_at = datetime('now')
  WHERE slug = 'akun-gsuite' AND source = 'manual'
    AND description = '✅ Akun GSUITE siap digunakan
✅ Pilihan durasi fleksibel
✅ Aktivasi cepat
✅ Cocok untuk kerja, belajar & kebutuhan produktivitas
✅ Cocok digunakan untuk kebutuhan pendaftaran berbagai aplikasi / layanan premium trial*
✅ Full garansi selama masa aktif akun

⚠️ PENTING:
Hari pada nama varian = durasi aktif akun, BUKAN waktu proses.

Contoh:
1 Hari → Aktif 1 hari
3 Hari → Aktif 3 hari
7 Hari → Aktif 7 hari
1 Bulan → Aktif 1 bulan

⏳ Masa aktif dimulai sejak akun diberikan / diaktifkan.

💎 Pilih durasi sesuai kebutuhanmu.

Cocok untuk kebutuhan sementara, penggunaan produktivitas, maupun pendaftaran layanan yang menyediakan premium trial dan memerlukan akun email.';
