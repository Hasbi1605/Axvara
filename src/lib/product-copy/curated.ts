// src/lib/product-copy/curated.ts — Salinan Axvara untuk S&K + cara aktivasi WR.
//
// Tiap entri dikunci `supplierFingerprint(wr_terms, wr_delivery_terms)` saat
// dikurasi (snapshot: tests/fixtures/product-copy-snapshot.json). Kalau WR
// mengubah kata/angka di teksnya, kunci tidak cocok lagi dan PDP otomatis
// kembali ke teks WR yang dirapikan — aturan baru pemasok tidak pernah
// tertutup salinan lama. Aturan menulis: semua angka, larangan, dan batas
// garansi pemasok wajib terbawa (dijaga tests/product-copy-content.test.ts).
//
// Server-only: diimpor resolve.ts, jangan diimpor komponen client.

export type CuratedVariantCopy = {
  key: string;
  /** Produk · varian saat dikurasi (jejak audit, tidak tampil ke pembeli). */
  label: string;
  paket?: readonly string[];
  proses?: readonly string[];
  aturan?: readonly string[];
  garansi?: readonly string[];
  langkah?: readonly string[];
  grupLangkah?: readonly { judul: string; langkah: readonly string[] }[];
  catatan?: readonly string[];
};

const AKUN = "Berupa akun siap pakai (tinggal login)";
const MBO = "Dibuat setelah order (made by order) dan tidak bisa dipercepat";
const BF_ONLY = "Garansi hanya berlaku bila akun kembali ke versi gratis (backfree)";
const NO_GAR = "Tanpa garansi";
const NO_GAR_NO_KOMPLAIN = "Tanpa garansi dan tanpa komplain";
const LANGSUNG_PAKAI = "Langsung pakai setelah beli";
const LIFETIME = "Durasi lifetime: aktif sampai akun berhenti dengan sendirinya (bukan jaminan selamanya)";
const SHARING_LIMIT = "Akun sharing berisiko terkena limit, harap sabar dan antre";
const TOLERANSI = "Tanpa toleransi: melanggar salah satu aturan di atas, akun ditarik dan garansi hangus";
const LOGIN_EMAIL = "Login dengan email";
const maxLogin = (n: number | string) => `Maksimal login di ${n} perangkat`;
const maxPakai = (n: number) => `Maksimal dipakai di ${n} perangkat`;
const cepatPakai = (massal: boolean) =>
  `Langsung pakai setelah beli, karena tidak ada yang tahu kapan banned${massal ? " massal" : ""} terjadi`;

const NETFLIX_UNINSTALL = "Wajib uninstall aplikasi Netflix dulu, lalu install ulang";
const CAPCUT_UPDATE = "Wajib update aplikasi CapCut ke versi terbaru agar email tidak terbaca belum terdaftar";
const YT_FAMILY_ATURAN = [
  "Pastikan email tidak sedang tergabung di family lain",
  "Pernah join YouTube Family lain (baru 1x)? Wajib keluar dari family tersebut dulu",
  "1 akun hanya bisa join family 2x dalam 1 tahun; bila sudah limit, pakai email lain",
];
const SPOTIFY_LOGIN = [
  "Wajib uninstall aplikasi Spotify dan hapus datanya sebelum login",
  "Nyalakan mode pesawat 1 kali sebelum login",
  "Login wajib memakai data seluler, jangan WiFi rumah",
  "Bila diminta OTP saat login, pilih Gunakan Password",
];
const VIDIO_BF = "Garansi hanya berlaku bila akun kembali ke versi gratis (backfree), tidak berlaku untuk banned, diretas (hack), atau limit";
const VIU_CATATAN = "Akun Viu sangat jarang backfree; bila sering backfree, penyebabnya login di banyak perangkat atau dibagikan ke banyak orang";
const ZOOM_PAKET_AKUN = "Akun private Zoom Pro untuk 100 peserta, akun baru (fresh)";
const ZOOM_PROSES = "Dibuat setelah order (made by order) dan tidak bisa dipercepat; bila bisa, order H-1 sebelum dipakai";
const ZOOM_ATURAN = [
  "Maksimal dipakai di 1 perangkat; akun private, tidak untuk dibagikan",
  "Aktivasi hanya lewat website dan aplikasi resmi Zoom",
];
const ZOOM_GARANSI = "Garansi backfree sejak pembelian: berlaku bila akun kembali ke versi gratis, tidak berlaku bila akun banned atau suspend";
const ZOOM_LANGKAH = [
  "Jangan salah ketik email dan password saat login karena akun bisa terkunci",
  "Bila diminta izin perangkat, klik “Verifikasi via kode sandi satu kali”, lalu buka link akses OTP dari kami",
  "Bila diminta verifikasi akun, klik Lewati (Skip)",
];
const ZOOM_CATATAN = "Rekaman cloud bisa dibuka di zoom.us/recording; rekaman ke file tersimpan di folder Documents perangkatmu";
const TV_PAKET = "Detail fitur lengkap: tradingview.com/pricing";
const VCC_ATURAN = [
  "1x order hanya untuk 1x pemakaian; VCC cuma bisa dipakai 1x",
  "Beli hanya bila sudah paham cara pakainya",
  "VCC terkena charge (tagihan masuk)? Wajib mengganti 2x lipat",
];
const OFFICE_PAKET = [
  "Akun Microsoft 365 original (100%), tinggal login",
  "Termasuk Word, Excel, PowerPoint, OneNote, Outlook, serta Publisher dan Access (khusus Windows)",
  "Untuk semua perangkat: iOS, Android, Windows, iPad, dan tablet",
  LIFETIME,
  "Bisa install ulang berkali-kali",
];
const OFFICE_GARANSI = "OneDrive hanya bonus: kendala OneDrive di luar tanggung jawab kami, simpan file penting secara offline";
const OFFICE_APPS = [
  "Office sudah terinstal? Langsung login di Word",
  "Di tablet atau HP, unduh Microsoft 365 dari App Store atau Play Store",
];
const OFFICE_TUTORIAL = "Tutorial unduh dan instal Office 365 di komputer: https://www.youtube.com/watch?v=fBOfOmj9Uj8";
const APP_BARU_PROSES = [MBO];
const WETV_ATURAN_UMUM = [
  "Dilarang mengubah password, mengutak-atik akun, atau mengutak-atik pembayaran",
  "Wajib mengirim screenshot bukti login ke admin",
];
const WETV_GARANSI = [
  "Garansi berlaku selama syarat & ketentuan dipatuhi; melanggar dikenai denda Rp100rb dan garansi hangus",
  "Tidak ada garansi untuk perubahan kebijakan aplikasi di luar kendali kami",
];
const WETV_MASA = "Masa aktif 25-30 hari dihitung 1 bulan";
const STREAM_SHARING_WEB = "Berupa akun sharing, disarankan nonton lewat website";
const NO_SMART_TV = "Tidak bisa di Smart TV atau TV Box";
const DISNEY_SHARING = ["Akun sharing 3 pengguna, anti limit", "Bisa di TV maupun HP, tidak bisa di website"];
const DISNEY_JASPAY = [
  "Paket Premium dengan limit screen 3 perangkat",
  "Jasa bayar (jaspay) di nomor milikmu sendiri",
  "Boleh dijual ulang sebagai sharing 3, 6, atau 10 pengguna",
];
const GROK_ATURAN = "Dilarang mengutak-atik data akun (email, password, pembayaran)";
const GROK_LANGKAH = [
  "Login akun yang kami kirim ke Google (Gmail)",
  "Buka Grok, pilih login dengan Google, lalu pilih email tersebut",
];
const VPN_WEB_APP = "Aktivasi hanya lewat website dan aplikasi resmi";
const KIRO_PAKET = ["Berupa akun siap pakai (tinggal login)", "Tersedia model Claude Opus 4.7 dan Opus 4.6"];
const KIRO_ATURAN = "Masa aktif berakhir di akhir bulan: habiskan limit sebelum itu";
const KIRO_LANGKAH = ["Unduh aplikasi Kiro (mirip VS Code dan Antigravity)", "Login memakai akun yang kami kirim"];
const UPCLOUD_PAKET_VPS = "Bisa untuk membuat VPS 6 core dengan RAM 12GB";
const UPCLOUD_PROSES = "Pre-order: dibuat setelah order (made by order)";
const CANVA_LINK_LANGKAH = [
  "Login ke Canva dengan akun pribadimu terlebih dahulu",
  "Klik link akses yang kami kirim; link hanya bisa diklik 1x",
];
const CANVA_LINK_CATATAN = "Link khusus untukmu: jangan bagikan atau biarkan orang lain mengkliknya";
const GEMINI_PAKET = [
  "Paket Gemini Pro lewat undangan family ke email pribadimu",
  "Termasuk Flow, Antigravity, NotebookLM, dan penyimpanan 5 TB",
  "Kredit/limit AI dan penyimpanan bersifat sharing, dipakai bersama anggota lain tanpa komplain",
  "Isi penyimpananmu tetap private, anggota lain tidak bisa melihatnya",
];
const GEMINI_ATURAN = [
  "Pastikan email belum pernah terdaftar di Family Plan mana pun",
  "Pernah join family lain? Keluar dulu; bila tetap tidak bisa, wajib memakai email lain",
];

export const CURATED_VARIANT_COPY: readonly CuratedVariantCopy[] = [
  {
    key: "150rofm6drp",
    label: "loklok · Sharing",
    paket: ["Paket Basic, akun sharing untuk 3 pengguna", "Tidak termasuk pembelian Fish di dalam episode"],
    aturan: ["1x checkout hanya untuk 1 perangkat", "Tidak bisa login langsung di TV"],
    garansi: [BF_ONLY],
  },
  {
    key: "255seano9fm",
    label: "netflix-premium · Premium Anti Limit",
    paket: [
      "1 akun dipakai 2-3 pengguna, bebas pilih profil mana saja",
      "Login dengan password atau link",
      "Bisa nonton di aplikasi; bila tidak bisa, nonton lewat browser desktop atau TV",
      "Beberapa perangkat lama tidak didukung, gunakan perangkat lain",
      "Akun jalur non-resmi (black market): pahami risikonya sebelum membeli; ingin lebih aman, pilih varian Legal",
    ],
    aturan: [
      "1x checkout hanya untuk 1 perangkat",
      "Tidak bisa memasang PIN atau membuat profil sendiri",
      "Dilarang keras mengganti nama profil, memakai PIN, atau mengubah password dan profil akun",
      "Dilarang sign out",
      "Dilarang keras memakai VPN apa pun",
      TOLERANSI,
    ],
    garansi: [
      "Garansi 20 hari, termasuk screen limit; akun sesekali bisa error atau incorrect password dan tetap ditanggung",
      "Perbaikan garansi estimasi 1x24 jam",
      "Ada error? Langsung lapor admin",
    ],
    langkah: [
      NETFLIX_UNINSTALL,
      "Login pertama kali memakai data seluler (atau hotspot dari HP), karena tidak semua WiFi bisa dipakai login Netflix",
    ],
  },
  {
    key: "1mwpinolrt6",
    label: "netflix-premium · Premium Legal",
    paket: [
      "Paket Premium Ultra HD 4K",
      "1 profil untuk 1 perangkat",
      "Boleh mengganti profil dan PIN, wajib laporkan data barunya ke admin",
      "Verifikasi Household (OTP) diproses manual oleh admin",
      "Masa aktif 25-30 hari dihitung 1 bulan",
    ],
    aturan: [
      "Hanya login di 1 perangkat, lebih dari 1 bisa membuat akun error",
      "Dilarang mengubah email dan password",
      "Dilarang meminjamkan atau membagikan password kepada orang lain",
      "Dilarang mengutak-atik pembayaran dan paket, termasuk menekan Cancel Membership",
      "Muncul incorrect password? Ganti ke data seluler; bila tetap salah, lapor admin dan jangan klik reset",
      TOLERANSI,
    ],
    garansi: ["Perbaikan garansi 1x24 jam"],
    grupLangkah: [
      {
        judul: "Sebelum login",
        langkah: [
          NETFLIX_UNINSTALL,
          "Wajib login memakai data seluler (atau hotspot dari HP), terutama saat login pertama, karena tidak semua WiFi bisa dipakai login Netflix",
        ],
      },
      {
        judul: "Login di aplikasi",
        langkah: [
          "Buka aplikasi, lalu ketuk Masuk (Sign In)",
          "Masukkan email",
          "Bila diminta kode, ketuk Dapatkan Bantuan (Get Help)",
          "Pilih Gunakan Password, lalu masukkan password",
        ],
      },
      {
        judul: "Login di website",
        langkah: [
          "Bersihkan cache dan cookies bila pernah login sebelumnya",
          "Klik Masuk (Sign In)",
          "Klik Dapatkan Bantuan, lalu Pelajari selengkapnya tentang masuk",
          "Klik Gabung Netflix di pojok kanan atas",
          "Klik Masuk (Sign In) di pojok kanan atas, lalu masukkan email dan password",
        ],
      },
    ],
  },
  {
    key: "1en2ppvmiln",
    label: "capcut-pro · Pro Member (7 hari)",
    paket: [AKUN, "Durasi habis? Logout lalu login ke akun baru, hasil editan tidak hilang"],
    aturan: [maxLogin(2), "Login memakai email, bukan Google", "Dilarang mengklaim trial CapCut"],
    garansi: [
      "Garansi berlaku bila akun kembali ke versi gratis (backfree)",
      "Tanpa garansi untuk status Maximum (terlalu banyak login)",
    ],
    langkah: [
      CAPCUT_UPDATE,
      "Login di HP memakai email dan password dari kami",
      "Untuk PC, login lewat scan QR dari aplikasi di HP",
      "Cek status Pro di HP: ketuk Pro di samping deretan angka panjang",
      "Cek status Pro di PC atau web: ganti space di kiri bawah",
    ],
  },
  {
    key: "1ljmky1hnoh",
    label: "capcut-pro · Pro Member (29 hari)",
    paket: ["Paket Member Pro, durasi langsung 1 bulan (bukan perpanjangan)", "Berupa akun siap pakai (tinggal login) dengan pembayaran legal"],
    aturan: [
      "Maksimal login di 2 perangkat, termasuk PC atau laptop",
      "Login memakai email, bukan Google",
      "Jangan terlalu sering login-logout karena bisa membuat akun error",
      "Dilarang menjual ulang sebagai sharing: bisa terkena limit login dan tidak ditanggung garansi",
    ],
    garansi: [
      "Garansi hanya berlaku bila akun kembali ke versi gratis (backfree), bukan suspend",
      "Tanpa garansi untuk status Maximum (terlalu banyak login)",
    ],
    langkah: [
      CAPCUT_UPDATE,
      "Login di HP memakai email dan password dari kami",
      "Untuk PC atau laptop, login lewat scan QR dari aplikasi di HP",
    ],
  },
  {
    key: "25xbmeu3ld0",
    label: "claude-pro · 25 - 27 September",
    paket: [
      "Masa aktif 3 hari mengikuti jadwal tanggal yang dipilih, bukan 72 jam sejak pembelian",
      "Akun sharing: limit dipakai bersama pengguna lain",
      "Login khusus lewat website atau aplikasi HP",
    ],
    proses: ["Akses login dikirim H-1 jadwal, pada malam hari", "Disarankan order sebelum atau pada hari pertama jadwal"],
    aturan: [
      "Dilarang memakai model Fable",
      "Dilarang membuat gambar (generate image)",
      "Dilarang dipakai untuk coding atau dihubungkan ke tools coding",
      "Dilarang memakai API atau menghubungkan akun ke layanan pihak ketiga (9Router, dan sejenisnya)",
      "Limit bisa tercapai sewaktu-waktu, pahami risikonya sebelum membeli",
    ],
  },
  {
    key: "1yn33ohw2dc",
    label: "claude-pro · 28 - 30 September",
    paket: [
      "Masa aktif 3 hari mengikuti jadwal tanggal yang dipilih, bukan 72 jam sejak pembelian",
      "Akun sharing: limit dipakai bersama pengguna lain",
      "Login khusus lewat website atau aplikasi HP",
    ],
    proses: ["Akses login dikirim H-1 jadwal, pada malam hari", "Disarankan order sebelum atau pada hari pertama jadwal"],
    aturan: [
      "Dilarang memakai model Fable",
      "Dilarang membuat gambar (generate image)",
      "Dilarang dipakai untuk coding atau dihubungkan ke tools coding",
      "Dilarang memakai API atau menghubungkan akun ke layanan pihak ketiga (9Router, dan sejenisnya)",
      "Dilarang memakai tingkat upaya (effort) Tinggi, Ekstra, atau Maks",
      "Pengecualian: upaya Tinggi boleh dipakai dengan model Sonnet, tidak dengan Opus",
      "Limit bisa tercapai sewaktu-waktu, pahami risikonya sebelum membeli",
    ],
  },
  {
    key: "21qzoavouza",
    label: "youtube-premium · Premium Invite",
    paket: ["Undangan YouTube Family ke email pribadimu"],
    proses: ["Undangan dikirim pada malam hari"],
    aturan: YT_FAMILY_ATURAN,
  },
  {
    key: "10hp1pmqnpd",
    label: "youtube-premium · Premium Link",
    paket: ["Link undangan YouTube Family untuk email pribadimu", "Link berlaku 3 hari"],
    aturan: YT_FAMILY_ATURAN,
    langkah: ["Klik link undangan yang kami kirim", "Login dengan email pribadimu, lalu terima undangan family"],
  },
  {
    key: "s1lgeuek0b",
    label: "leonardo-ai · Credit 8500",
    paket: ["Berupa akun siap pakai", "Mendukung Seedance 2.0"],
    garansi: ["Garansi hanya sebatas akun bisa login"],
    langkah: [
      "Buka website Leonardo AI",
      "Pilih login lewat Canva, lalu pilih login dengan email",
      "Ambil kode OTP di https://bototp.site/",
      "Password hanya cadangan; utamakan login memakai OTP",
    ],
  },
  {
    key: "cvd3a73y8j",
    label: "leonardo-ai · Credit 14000",
    paket: ["Berupa akun siap pakai", "Mendukung Seedance 2.0"],
    garansi: ["Garansi hanya sebatas akun bisa login"],
  },
  {
    key: "1fiqy7j66lt",
    label: "spotify-premium · Premium (3 bulan)",
    paket: ["Berupa akun siap pakai, durasi langsung 3 bulan"],
    aturan: ["Jangan login di lebih dari 1 perangkat", "Dilarang mengganti email atau password"],
    garansi: [
      "Garansi hanya sebatas akun bisa login; selebihnya tanpa garansi",
      "Akun bisa backfree atau suspend sewaktu-waktu: risiko ini tanpa komplain",
      "Langsung cek tagihan setelah login, harus Premium 3 bulan; bila tidak, lapor admin via WA maksimal 24 jam setelah akun diterima",
    ],
    langkah: SPOTIFY_LOGIN,
  },
  {
    key: "1fox9vmug7g",
    label: "spotify-premium · Premium (bergaransi)",
    paket: ["Berupa akun siap pakai"],
    aturan: [
      "Login hanya di 1 perangkat karena Spotify sensitif terhadap IP perangkat",
      "Dilarang mengganti email",
      "Jangan mengutak-atik pembayaran maupun paket langganan",
    ],
    garansi: ["Garansi 25 hari", "Perbaikan garansi menyesuaikan ketersediaan stok, tanpa permintaan refund"],
    langkah: SPOTIFY_LOGIN,
    catatan: ["Muncul banner merah atau tulisan “pembayaran batal / tidak dapat diselesaikan”? Abaikan dan tekan X"],
  },
  {
    key: "scwvizd536",
    label: "getcontact-premium · Premium",
    paket: [
      "Aktivasi di nomor milikmu sendiri: nomor Getcontact harus nomor WhatsApp aktif",
      "Limit pencarian 300 per bulan dan lihat daftar tag 40 per bulan",
      "Bisa diperpanjang",
    ],
    proses: ["Diproses setiap malam; prosesnya lambat dan tidak bisa dipercepat", "Standby di nomormu selama proses berlangsung"],
  },
  {
    key: "own2y42xlz",
    label: "apple-music · Premium",
    paket: ["Undangan family ke email pribadimu", "Bisa di Android dan iOS", "Bisa diperpanjang tiap bulan di akun yang sama"],
    proses: ["Undangan dikirim sore atau malam hari", "Setelah join, status kadang tertunda: tutup aplikasi dan tunggu 60 menit"],
    aturan: ["Sedang tergabung di family lain? Keluar dulu sebelum join"],
  },
  {
    key: "pov46rjkyp",
    label: "chatgpt-premium · Voucher Go 3 Bulan",
    paket: ["Voucher ChatGPT Go durasi 3 bulan", "Region Mexico (MX)"],
    aturan: [
      "Jangan beli bila belum paham cara redeem voucher ini; membeli berarti kamu sudah paham caranya",
      "Tidak termasuk tutorial cara redeem",
    ],
  },
  {
    key: "ie8ec098t1",
    label: "chatgpt-premium · Plus Gcash",
    paket: ["Berupa akun ChatGPT Plus (email iCloud atau Outlook)", "Tagihan via GCash"],
    aturan: [maxLogin(2), "Dilarang mengutak-atik akun", "Codex wajib verifikasi nomor WhatsApp", cepatPakai(false)],
    garansi: [NO_GAR_NO_KOMPLAIN],
    langkah: [
      "Setelah login, buka Pengaturan (Settings)",
      "Masuk ke Keamanan (Security), lalu Sesi Aktif (Sessions)",
      "Pilih Logout All Devices",
    ],
    catatan: ["Tujuannya membersihkan perangkat yang masih tersangkut; terlalu banyak perangkat membuat akun cepat di-banned"],
  },
  {
    key: "1m77fg8i6oi",
    label: "chatgpt-premium · Member Invite",
    paket: [
      "Undangan private ke email pribadimu",
      "Riwayat chat aman dan tidak tercampur dengan pengguna lain",
      "Tidak bisa memakai Codex",
    ],
    aturan: [cepatPakai(true)],
    garansi: ["Garansi 1 hari"],
  },
  {
    key: "1vc36szlokt",
    label: "chatgpt-premium · Plus VCC",
    paket: ["Berupa akun sendiri, bukan undangan", "Tagihan via VCC (1 VCC untuk 1 akun), lebih awet dan stabil"],
    aturan: [maxLogin(2), "Codex wajib verifikasi nomor WhatsApp", cepatPakai(true)],
    garansi: ["Garansi 7 hari"],
  },
  {
    key: "21fsyz2kxb5",
    label: "vidio-platinum · TV",
    paket: ["Paket Platinum khusus TV", "Berupa akun siap pakai"],
    aturan: [maxLogin(2)],
    garansi: [VIDIO_BF],
  },
  {
    key: "135t5v6pyib",
    label: "vidio-platinum · Mobile",
    paket: ["Paket Platinum khusus mobile (HP atau tablet)", "Berupa akun siap pakai"],
    proses: ["Tanyakan ketersediaan stok ke admin sebelum membeli"],
    aturan: [
      "Maksimal login di 2 perangkat, tapi disarankan cukup 1 perangkat agar akun tidak dinonaktifkan (disable)",
      "Dilarang mengubah email atau kata sandi: ketahuan, akun ditarik dan tanpa garansi",
      "Mengubah pengaturan akun hingga error dikenai denda sebesar harga akun private",
    ],
    garansi: [
      "Garansi mencakup akun banned",
      "Tanpa garansi bila akun dicuri atau dinonaktifkan (disable)",
    ],
  },
  {
    key: "1c98n0ezuni",
    label: "vidio-platinum · All Device",
    paket: ["Paket Platinum untuk semua perangkat (all device)", "Berupa akun siap pakai", "Masa aktif 25-30 hari dihitung 1 bulan"],
    proses: ["Tanyakan ketersediaan stok ke admin sebelum membeli"],
    aturan: [
      maxLogin(2),
      "Dilarang mengganti email atau password akun",
      "Dilarang mengutak-atik pembayaran",
      "Wajib mengirim bukti login ke admin untuk memastikan akun aman tanpa kendala",
    ],
    garansi: [
      BF_ONLY,
      "Tidak berlaku untuk banned, diretas (hack), limit, disable, incorrect password, atau akun yang dicuri",
    ],
  },
  {
    key: "1n7qd81est7",
    label: "viu-premium · Premium (tanpa garansi)",
    paket: ["Paket Premium (bukan Plus), akses tanpa iklan", "Berupa akun siap pakai"],
    aturan: [maxLogin("1-2"), "Dilarang mengganti email atau password"],
    garansi: [NO_GAR],
    langkah: ["Hapus data aplikasi Viu sebelum login"],
    catatan: [VIU_CATATAN],
  },
  {
    key: "1w6j2f99iig",
    label: "viu-premium · Premium (bergaransi)",
    paket: ["Paket Premium (bukan Plus), akses tanpa iklan", "Berupa akun siap pakai"],
    aturan: [maxLogin("1-2"), "Dilarang mengganti email atau password"],
    garansi: [
      "Garansi 2 bulan, hanya berlaku bila akun kembali ke versi gratis (backfree)",
      "Proses klaim garansi maksimal 3x24 jam",
      "Tidak ada garansi untuk akun yang di-disable atau dinonaktifkan",
      "Tidak ada garansi untuk perubahan kebijakan aplikasi di luar kendali kami, termasuk bila metode aktivasi mati atau berubah",
    ],
    langkah: ["Hapus data aplikasi Viu sebelum login"],
    catatan: [VIU_CATATAN],
  },
  {
    key: "2g1ibt8ur0s",
    label: "zoom-premium · Pro 14D",
    paket: [ZOOM_PAKET_AKUN, "Masa aktif 12-14 hari"],
    proses: [ZOOM_PROSES],
    aturan: ZOOM_ATURAN,
    garansi: [ZOOM_GARANSI],
    langkah: ZOOM_LANGKAH,
    catatan: [ZOOM_CATATAN],
  },
  {
    key: "htpja16mam",
    label: "zoom-premium · Pro 28D",
    paket: [ZOOM_PAKET_AKUN, "Diperpanjang otomatis setiap 14 hari"],
    proses: [ZOOM_PROSES],
    aturan: ZOOM_ATURAN,
    garansi: [ZOOM_GARANSI],
    langkah: ZOOM_LANGKAH,
    catatan: [ZOOM_CATATAN],
  },
  {
    key: "9fur7a5iul",
    label: "prime-video · No Garansi",
    paket: ["Berupa akun siap pakai untuk semua perangkat (all device)", "Tidak termasuk film sewa (rental)"],
    aturan: [LANGSUNG_PAKAI],
    garansi: [NO_GAR],
  },
  {
    key: "123wzsoo0tq",
    label: "prime-video · Garansi",
    paket: [
      "Berupa akun siap pakai untuk semua perangkat (all device)",
      "Paket Prime with ads: iklan hanya 15 detik di awal tayangan",
      "Tidak termasuk film sewa (rental)",
    ],
    aturan: [maxLogin(2)],
  },
  {
    key: "1s4emey5naj",
    label: "tradingview-premium · Premium",
    paket: ["Paket Premium (senilai $69.95)", AKUN, TV_PAKET],
    proses: [MBO],
    garansi: [NO_GAR_NO_KOMPLAIN],
  },
  {
    key: "uwqn5zd0nv",
    label: "tradingview-premium · Premium Garansi",
    paket: ["Paket Premium (senilai $69.95)", AKUN, TV_PAKET],
    proses: [MBO],
    garansi: ["Garansi backfree: berlaku bila akun kembali ke versi gratis"],
  },
  {
    key: "tdxkgajlr1",
    label: "scribd · Premium",
    paket: ["Berupa akun siap pakai"],
    aturan: [maxLogin(2)],
  },
  {
    key: "6r4t0ocizg",
    label: "hma-vpn · Premium",
    paket: ["Berupa key (kode lisensi) HMA VPN", "Hanya untuk Windows dan Android"],
    proses: [MBO],
    aturan: [maxPakai(5), "Aktivasi hanya lewat aplikasi resmi"],
    garansi: ["Tidak ada refund setelah aktivasi berhasil"],
    langkah: ["Install aplikasi HMA VPN, lalu login memakai key yang kami kirim"],
  },
  {
    key: "1b6erf68baz",
    label: "express-vpn · Premium",
    paket: ["Berupa akun baru (fresh) beserta key aktivasi"],
    proses: [MBO],
    aturan: [maxPakai(5), VPN_WEB_APP],
  },
  {
    key: "7hxxxhegzn",
    label: "vcc-trial-aplikasi · Upcloud",
    paket: ["VCC untuk klaim trial UpCloud", "VCC aktif 1-3 jam, langsung pakai setelah diterima"],
    aturan: [...VCC_ATURAN, "Pakai hanya di aplikasi yang sesuai (UpCloud)"],
  },
  {
    key: "28gb79iogo7",
    label: "vcc-trial-aplikasi · TradingView",
    paket: ["VCC untuk klaim trial TradingView", "VCC aktif 1-3 jam, langsung pakai setelah diterima"],
    aturan: [...VCC_ATURAN, "Pakai hanya di aplikasi yang sesuai (TradingView)"],
  },
  {
    key: "1q6ymq7voq1",
    label: "office365-lifetime · No Garansi / Garansi",
    paket: OFFICE_PAKET,
    aturan: [maxPakai(5)],
    garansi: [OFFICE_GARANSI],
    langkah: [
      "Buka https://portal.office.com/",
      "Masukkan email dan password yang kami kirim",
      "Saat login pertama, kamu diminta mengganti password: buat password baru dan jangan sampai lupa",
      "Bila diminta menambahkan nomor HP atau email, cukup isi salah satu (hanya untuk keamanan tambahan)",
      ...OFFICE_APPS,
    ],
    catatan: [OFFICE_TUTORIAL],
  },
  {
    key: "1h1cv30d09z",
    label: "office365-lifetime · Custom Username No Garansi",
    paket: OFFICE_PAKET,
    proses: ["Kirim username pilihanmu ke admin via WhatsApp setelah order"],
    aturan: [maxPakai(5)],
    garansi: [OFFICE_GARANSI],
    langkah: OFFICE_APPS,
    catatan: [OFFICE_TUTORIAL],
  },
  {
    key: "afyqev2tjv",
    label: "office365-lifetime · Custom Username Garansi",
    paket: OFFICE_PAKET,
    proses: ["Kirim username pilihanmu ke admin via WhatsApp setelah order"],
    aturan: [maxPakai(5)],
    garansi: [OFFICE_GARANSI],
    langkah: OFFICE_APPS,
    catatan: [OFFICE_TUTORIAL],
  },
  {
    key: "6r1ndf34qa",
    label: "windows-10-11-pro · No Garansi / Garansi",
    paket: [
      "Key retail original untuk Windows 10 Pro dan Windows 11 Pro",
      "Aktivasi permanen",
      "Bisa dipakai untuk install ulang selama di 1 perangkat yang sama",
    ],
    langkah: [
      "Pastikan versi Windows sudah Pro sebelum aktivasi",
      "Masukkan key di Settings Windows",
      "Pilih aktivasi lewat telepon (Activate by phone)",
    ],
    catatan: ["Aktivasi dilakukan di jam kerja 09.00-17.00 WIB, saat server online"],
  },
  {
    key: "7r4odcx4n1",
    label: "picsart-pro · Member Pro",
    paket: ["Berupa akun siap pakai dengan akses fitur Pro"],
  },
  {
    key: "ir9q4z9zqg",
    label: "wink-premium · Wink VIP",
    paket: ["Berupa akun baru (fresh), khusus Android", LOGIN_EMAIL],
    proses: APP_BARU_PROSES,
  },
  {
    key: "pyoqht7w43",
    label: "wink-premium · Wink VIP+",
    paket: ["Berupa akun baru (fresh), bisa di iOS dan Android", LOGIN_EMAIL],
    proses: APP_BARU_PROSES,
  },
  {
    key: "1vnaeufq33",
    label: "meitu-premium · Meitu VIP",
    paket: ["Berupa akun baru (fresh), khusus Android; pengguna iOS pilih varian VIP+", LOGIN_EMAIL],
    proses: APP_BARU_PROSES,
  },
  {
    key: "205ut6u7kqc",
    label: "meitu-premium · Meitu VIP+",
    paket: ["Berupa akun baru (fresh), bisa di Android dan iOS", LOGIN_EMAIL],
    proses: APP_BARU_PROSES,
  },
  {
    key: "1cp6pu7gd18",
    label: "remini-premium · Remini",
    paket: ["Berupa link redeem langganan, bukan email dan password", "Hanya untuk website, tidak bisa di aplikasi mobile"],
    aturan: ["Siapkan akun Gmail milikmu sendiri untuk redeem"],
    langkah: [
      "Buka link redeem di browser",
      "Pilih login dengan Google memakai akun Gmail tersebut untuk menebus langganan",
    ],
  },
  {
    key: "50e1oa198c",
    label: "bstation · Premium",
    paket: ["Berupa akun sharing: riwayat tontonan otomatis tercampur dengan pengguna lain"],
    aturan: [
      "Login hanya di 1 perangkat, memakai email (bukan Google)",
      "Dilarang mengutak-atik pembayaran maupun apa pun yang berhubungan dengan informasi akun",
      "Akun sharing berisiko terkena limit, harap sabar dan antre; screen limit hanya ada di episode VIP dan tidak menerima komplain",
      "Kecurangan atau tindakan yang merugikan kami dikenai sanksi atau denda",
    ],
    garansi: ["Garansi 1 bulan", "Garansi hangus bila melanggar syarat & ketentuan ini"],
    langkah: ["Login dengan email dan password lewat website; nonton disarankan di browser seperti Chrome"],
    catatan: [
      "Muncul error saat login (misalnya “incorrect password” atau “terjadi kesalahan”)? Coba login lewat website dulu",
      "Terkena limit? Unduh episodenya dulu untuk ditonton sementara",
    ],
  },
  {
    key: "2gljpitnm2v",
    label: "wetv-vip · Sharing Anti Limit",
    paket: ["Akun sharing untuk 3 pengguna, anti limit", WETV_MASA],
    aturan: [
      "Login hanya di 1 perangkat, memakai email biasa (bukan Google)",
      "Total login di akun ini maksimal 6 pengguna/perangkat; lebih dari itu akun suspend dan tanpa garansi",
      ...WETV_ATURAN_UMUM,
    ],
    garansi: WETV_GARANSI,
  },
  {
    key: "1i4pkhjb2mi",
    label: "wetv-vip · Premium",
    paket: [
      "Berupa akun siap pakai, login dengan nomor atau email biasa (bukan Google)",
      "Boleh dijual ulang sebagai sharing hingga 6 pengguna",
      "Limit screen 3 perangkat sekaligus",
      WETV_MASA,
    ],
    aturan: ["Maksimal 6 pengguna/perangkat; lebih dari itu akun suspend dan tanpa garansi", ...WETV_ATURAN_UMUM],
    garansi: WETV_GARANSI,
  },
  {
    key: "10fg8iko62y",
    label: "crunchyroll · Premium",
    paket: [STREAM_SHARING_WEB, NO_SMART_TV],
    aturan: [
      "Login hanya di 1 perangkat",
      SHARING_LIMIT,
      "Dilarang mengganti data akun atau pembayaran; jangan klik menu langganan/pembayaran karena bisa terdeteksi",
      "Jangan login-logout berulang kali dan hindari aktivitas mencurigakan",
      "Melanggar aturan membuat akun suspend, tanpa ganti rugi",
    ],
    langkah: ["Wajib hapus cache dan data aplikasi sebelum login", "Login dengan akun yang kami kirim"],
    catatan: ["Tidak bisa login? Jangan dicoba berkali-kali, langsung hubungi admin"],
  },
  {
    key: "12e4aaiy2vk",
    label: "youku-premium · Premium",
    paket: [STREAM_SHARING_WEB, NO_SMART_TV],
    aturan: [
      "Login hanya di 1 perangkat",
      SHARING_LIMIT,
      "Dilarang mengubah informasi akun (email, password, pembayaran, dan lainnya)",
      "Dilarang login-logout berkali-kali tanpa alasan jelas",
      "Dilarang menghapus riwayat tontonan pengguna lain",
    ],
    catatan: ["Terkena screen limit? Tunggu sampai giliran berganti, atau unduh tayangan untuk ditonton offline"],
  },
  {
    key: "1w13tik3vez",
    label: "i-love-pdf · Premium (1 perangkat)",
    paket: ["Berupa akun siap pakai untuk Android dan website (tidak untuk iOS)"],
    aturan: [
      "Login hanya di 1 perangkat, memakai email dan kata sandi (bukan Google)",
      "Dilarang mengubah email atau password",
      "Dilarang mengutak-atik pembayaran maupun apa pun yang berhubungan dengan informasi akun",
    ],
  },
  {
    key: "8woact3bv2",
    label: "i-love-pdf · Premium (3 perangkat)",
    paket: ["Berupa akun siap pakai"],
    aturan: ["Maksimal login di 3 perangkat; khusus iOS hanya 1 perangkat"],
  },
  {
    key: "5xqem2png8",
    label: "alight-motion · Premium",
    paket: ["Berupa akun siap pakai, bisa di Android dan iOS"],
  },
  {
    key: "s0cjewl2a4",
    label: "disney-hotstar · Premium 3U",
    paket: DISNEY_SHARING,
    aturan: ["Hanya bisa di 1 perangkat", "Disarankan login di TV agar lebih stabil dan tidak sering logout"],
  },
  {
    key: "xatzf9m25w",
    label: "disney-hotstar · Jaspay Premium (119K)",
    paket: [...DISNEY_JASPAY, "Harga resmi Rp119rb"],
  },
  {
    key: "1kjxjx9mnax",
    label: "disney-hotstar · Premium 3U (799K)",
    paket: [...DISNEY_SHARING, "Harga resmi Rp799rb"],
    aturan: [
      "Hanya bisa di 1 perangkat",
      "Dilarang menekan “Sign out all devices” dan jangan logout",
      "Dilarang clear cache, clear data, apalagi memakai aplikasi cleaner",
      "Jangan melakukan hal yang mengganggu pengguna lain",
    ],
    langkah: ["Chat admin untuk meminta kode OTP login", "Login memakai OTP tersebut; kode OTP hanya diberikan 1x dan hanya untuk 1 perangkat"],
  },
  {
    key: "29bev6iw5xs",
    label: "disney-hotstar · Jaspay Premium (799K)",
    paket: [...DISNEY_JASPAY, "Harga resmi Rp799rb"],
  },
  {
    key: "28nggg902hm",
    label: "grok-ai · Super Grok",
    paket: ["Paket SuperGrok, login dengan akun Google"],
    aturan: [GROK_ATURAN],
    langkah: GROK_LANGKAH,
  },
  {
    key: "1itd4nsqzx9",
    label: "grok-ai · SuperGrok 10 Akun",
    paket: ["Paket SuperGrok, isi 10 akun dengan login Google", "Akun baru dengan tagihan fresh"],
    proses: ["Sistem pre-order (PO)"],
    aturan: [GROK_ATURAN],
    langkah: GROK_LANGKAH,
  },
  {
    key: "212jfbuesyx",
    label: "grok-ai · SuperGrok (akun)",
    paket: ["Paket SuperGrok, berupa akun siap pakai"],
    aturan: ["Hanya boleh mengganti password dan profil", "Dilarang menautkan akun X"],
    garansi: ["Full garansi untuk backfree, incorrect password, dan MFA", "Tanpa garansi bila email diganti"],
  },
  {
    key: "1bnv7h7ssyx",
    label: "surfshark-vpn · Premium",
    paket: [AKUN],
    aturan: [maxPakai(5), VPN_WEB_APP],
  },
  {
    key: "1be18hn6h4r",
    label: "kiro-ai · Pro Biasa",
    paket: ["Paket Pro berisi 1000 kredit", ...KIRO_PAKET],
    aturan: [KIRO_ATURAN],
    langkah: KIRO_LANGKAH,
  },
  {
    key: "vwbz89rdos",
    label: "kiro-ai · Pro Plus",
    paket: ["Paket Pro Plus berisi 2000 kredit", ...KIRO_PAKET],
    aturan: [KIRO_ATURAN],
    langkah: KIRO_LANGKAH,
  },
  {
    key: "5b6ps6s3ef",
    label: "devin-ai-windsurf · Pro",
    paket: [
      "Trial Pro berdurasi 14 hari, cocok untuk vibe coding",
      "Tersedia model Claude Opus 4.6, Opus 4.7 MAX, GPT 5.5, dan Kimi 2.6",
    ],
    aturan: ["Banyak pengguna baru sehingga kadang terkena limit global: ketik “lanjutkan” sampai berhasil"],
    langkah: ["Install IDE Windsurf (mirip VS Code)", "Login memakai akun devin.ai yang kami kirim"],
  },
  {
    key: "op95kbixch",
    label: "hbo-max · Premium Sharing",
    paket: ["Paket Premium 4K UHD", "Akun sharing 4 pengguna, anti limit screen", "Untuk semua perangkat (mobile dan TV)"],
    aturan: ["Login hanya di 1 perangkat", LANGSUNG_PAKAI],
    garansi: [NO_GAR],
  },
  {
    key: "hztjmbmqbr",
    label: "hbo-max · Premium Private",
    paket: [
      "Paket Premium 4K UHD (harga resmi Rp119rb), akun private",
      "Streaming di 4 perangkat sekaligus, mobile maupun TV",
    ],
    proses: ["Dibuat setelah order (made by order) agar akun tetap baru (fresh)"],
    aturan: [LANGSUNG_PAKAI],
    garansi: [NO_GAR],
  },
  {
    key: "lffzty7lea",
    label: "iqiyi · Premium",
    paket: [STREAM_SHARING_WEB],
    aturan: ["Login hanya di 1 perangkat", SHARING_LIMIT],
  },
  {
    key: "2e36p4bsu2c",
    label: "drakor-id · Premium",
    paket: ["Berupa akun sharing untuk Android atau website"],
    aturan: ["Login hanya di 1 perangkat", "Akun sharing berpotensi terkena limit, harap sabar dan antre"],
  },
  {
    key: "12w2t89p49d",
    label: "camscanner · Premium Edu",
    paket: ["Berupa akun siap pakai, akses tanpa iklan", "Penyimpanan cloud 10GB+"],
  },
  {
    key: "1kmv595we6s",
    label: "domain-murah · Domain",
    paket: [
      "Domain Name.com durasi 1 tahun, kamu mendapat akses ke domainnya",
      "Tidak bisa diperpanjang",
      "Pilihan ekstensi: .rocks, .ninja, .games, .codes, .systems, .studio, .email, .works, .software, .engineer, .live, .app, .dev, .page, .foo",
    ],
    langkah: ["Cek ketersediaan nama domain di https://name.com", "Kirim nama domain pilihanmu ke admin via WhatsApp"],
  },
  {
    key: "1my1m0jqwjj",
    label: "upcloud · Trial $250",
    paket: ["Akun baru (fresh) berisi saldo $250", UPCLOUD_PAKET_VPS],
    proses: [UPCLOUD_PROSES],
    garansi: ["Tidak ada garansi setelah berhasil login"],
  },
  {
    key: "5fteui634g",
    label: "upcloud · Trial $500",
    paket: ["Akun baru (fresh) berisi saldo $500", UPCLOUD_PAKET_VPS],
    proses: [UPCLOUD_PROSES],
  },
  {
    key: "19kzvxtfqkz",
    label: "adobe-creative-cloud · Pro",
    paket: ["Berupa akun siap pakai"],
    langkah: ["Login langsung di aplikasi Adobe memakai akun yang kami kirim"],
  },
  {
    key: "28mkwys4rce",
    label: "github-copilot · Pro",
    paket: ["Paket Pro (harga resmi Rp150rb+) dengan 300 request per bulan"],
    proses: ["Proses cenderung lambat, bisa lebih cepat tergantung server"],
  },
  {
    key: "2ealo0k3mcs",
    label: "github-student · Student Developer Pack",
    paket: [
      "Berupa akun GitHub Student Developer Pack",
      "Domain: 1 domain .me gratis + sertifikat SSL dari Namecheap, 2 domain (.live, .studio, .software, .app, atau .dev) dari name.com, dan 1 domain .tech dari get.tech, masing-masing 1 tahun untuk website atau portofolio",
      "GitHub Copilot Pro",
      "DigitalOcean: saldo $200 untuk hosting atau VPS selama 1 tahun",
      "Microsoft Azure: saldo $100 plus akses ke 25+ layanan cloud tanpa kartu kredit",
      "Lisensi JetBrains: IDE profesional seperti IntelliJ IDEA dan PyCharm",
      "Daftar benefit lengkap: https://education.github.com/pack",
    ],
    aturan: ["Beli hanya bila sudah paham cara pakainya; tidak termasuk tutorial", "Langsung klaim semua benefit karena akun rawan suspend"],
  },
  {
    key: "6t7hp6jndi",
    label: "canva-premium-wr · Member Edu Lifetime",
    paket: [
      "Link akses Canva Edu untuk 1x join lewat email pribadimu",
      "Canva Edu setara Canva Pro, tetapi tidak bisa upload font dan akses AI terbatas",
      LIFETIME,
    ],
    garansi: [NO_GAR],
    langkah: CANVA_LINK_LANGKAH,
    catatan: [CANVA_LINK_CATATAN],
  },
  {
    key: "10sr91kzyw7",
    label: "canva-premium-wr · Head Edu Lifetime",
    paket: ["Akun Head Canva Edu, bisa mengundang 500 member", LIFETIME],
    garansi: [NO_GAR],
  },
  {
    key: "590xzj9a67",
    label: "canva-premium-wr · Head Pro",
    paket: ["Akun Head Canva Pro (email dan password), bisa mengundang 100 member"],
    proses: [MBO],
  },
  {
    key: "7nslhsale1",
    label: "canva-premium-wr · Member Pro (link bulanan)",
    paket: ["Link join tim Canva Pro yang diperbarui gratis setiap bulan", "Boleh dijual ulang atau dibagikan lagi"],
  },
  {
    key: "1yg0dwzho35",
    label: "canva-premium-wr · Member Pro (2 bulan)",
    paket: ["Paket Member Pro, durasi langsung 2 bulan tanpa berganti tim", "Undangan tim ke akun Canva pribadimu"],
    langkah: CANVA_LINK_LANGKAH,
    catatan: [CANVA_LINK_CATATAN],
  },
  {
    key: "1wob3hzdl2h",
    label: "gemini-ai-antigravity · Pro Member",
    paket: GEMINI_PAKET,
    proses: ["Undangan diproses manual"],
    aturan: GEMINI_ATURAN,
  },
  {
    key: "191n7xk0kr2",
    label: "gemini-ai-antigravity · Pro Member (17-18 bulan)",
    paket: [...GEMINI_PAKET, "Durasi 17-18 bulan"],
    proses: ["Undangan diproses manual, harap sabar"],
    aturan: GEMINI_ATURAN,
  },
  {
    key: "1jw011nczs3",
    label: "gemini-ai-antigravity · Head",
    paket: [
      "Akun Head Gemini Pro region Indonesia, bisa mengundang 5 member",
      "Termasuk Flow (1000 kredit AI), Antigravity, NotebookLM, dan penyimpanan 5TB",
    ],
    garansi: ["Garansi berlaku bila akun kembali ke versi gratis (backfree), tidak termasuk suspend, disable, atau nonaktif"],
    grupLangkah: [
      {
        judul: "Login pertama",
        langkah: [
          "Wajib login pertama kali lewat HP, jangan laptop/PC, karena Gmail pasti terkunci",
          "Bila diminta verifikasi nomor atau OTP, masukkan nomor HP pribadimu; nomor ini hanya untuk verifikasi perangkat dan tidak tersimpan di akun Google",
          "Setelah berhasil login, diamkan akun selama 7 hari",
        ],
      },
      {
        judul: "Setelah 7 hari",
        langkah: [
          "Amankan akun: ganti password, atur pemulihan, dan aktifkan 2FA",
          "Keluarkan semua sesi perangkat lain agar akun tidak terkunci",
        ],
      },
    ],
  },
];
