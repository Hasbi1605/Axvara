# DESIGN.md — AXVARA Design System

## Identitas supplier admin (15 November 2026, implementasi lokal)

Aturan **status ≠ supplier** menggantikan badge asal abu-abu pada Produk.
Warna identitas hanya untuk asal produk; success hijau tetap Live, warning
amber tetap stok habis/S&K perlu ditinjau, danger tetap gagal, secondary abu-abu
tetap Nonaktif. Angka/statistik dan warna storefront tidak berubah.

`src/components/admin/supplier-style.tsx` menyatukan label pendek, nama lengkap,
dan kelas badge untuk daftar Produk, legenda filter serta header varian editor.
Badge supplier selalu lebih dulu daripada status: pill dengan titik dekoratif,
tint 10%, border 40%, nama pendek terlihat, `title`/`aria-label` nama lengkap;
Manual memakai border putus-putus. Status tetap chip `rounded-md` tanpa titik.
Legenda noninteraktif membungkus di layar kecil; select/filter tetap native.

| Supplier | Nama lengkap | Hue | Teks gelap | Teks terang | Kontras min gelap / terang |
| --- | --- | --- | --- | --- | --- |
| WR | Warung Rebahan | Cyan | `#67E8F9` | `#155E75` | 10,16:1 / 5,97:1 |
| SK | Sekalipay | Ungu | `#D8B4FE` | `#6B21A8` | 8,53:1 / 7,03:1 |
| TUNVN | TUNVN PREHUB | Pink | `#F9A8D4` | `#9D174D` | 8,38:1 / 6,34:1 |
| AIVault | AIVault Hub | Indigo | `#A5B4FC` | `#3730A3` | 7,66:1 / 8,00:1 |
| Manual | Manual Axvara | Slate, outline putus-putus | `#CBD5E1` | `#334155` | 9,94:1 / 8,38:1 |

Palet identitas di `admin.css` terpisah dari token semantik status dan mengikuti
Terang/Gelap/Ikuti sistem. Warna bukan satu-satunya pembeda: label, titik, bentuk,
dan nama aksesibel tetap tersedia. Status implementasi lokal; bukan bukti deploy.

Verifikasi Chrome headless157, fixture lokal pada route sementara (sudah dihapus),
1440×1000 dan390×844: lima asal + Live/Nonaktif/Stok habis/S&K terlihat, filter
kelima asal, empty pencarian dan Tab ke select dengan outline cyan2px lulus;
tanpa overflow halaman, error console/page atau request gagal. Route dan6aset
CSS/JS200. Kontras tabel di atas adalah minimum teks terhadap background
terkomposit badge (tint10% + permukaan ancestor), mencakup legenda/tabel/kartu;
semua ≥4,5:1 dan mode sistem mengikuti tema masing-masing. Screenshot di
`/tmp/supplier-badges-desktop.png` dan `/tmp/supplier-badges-mobile.png`.
Fixture menguji presentasi/filter; bukan auth, persistensi backend atau transaksi.


## Panel supplier AIVault (15 November 2026, lokal saja)

Section Supplier→AIVault memakai primitive admin existing: PageHeader, StatCard
netral, tab Ringkas/Antrean/Markup/Alat, kartu family dan form varian responsif.
Harga modal memakai USD, harga jual IDR; markup dan harga manual terpisah,
switch aktivasi memiliki label aksesibel dan hint bila parent masih nonaktif.
Antrean memakai teks status bersama badge, retry pra-send dan dialog receipt
privat (Escape menutup/fokus kembali). Load/error/empty state eksplisit;
kegagalan endpoint menampilkan bagian+HTTP status tanpa menghapus data lain.
Bukan token/font/aset baru. Badge dan filter asal TUNVN/AIVault tetap terpisah
di admin Produk. Chrome fixture
1440px/390px memeriksa form/switch/retry/reveal/sync, fokus/keyboard dan overflow;
route fixture dihapus, bukan bukti login atau transaksi produksi.


## Progres produk otomatis (14 November 2026, implementasi lokal)

Halaman `/pesanan/[code]` memakai `AutomaticOrderProgress` untuk item Jaspay.
Permukaan mengikuti Midnight storefront existing, border putih10%, teks utama
putih90%, teks bantu putih70%, aksen Cyan #00E5FF, selesai emerald dan kendala
Gold #FFB800. Label status selalu berupa teks, bukan warna saja. Teks status
14px, bantu12px, label panjang dapat membungkus pada390px.

Satu akun: spinner + tahap nyata Menyiapkan produkmu/Menunggu giliran/Membuat
produkmu; posisi antrean hanya bila API memberikannya. Banyak akun: progressbar
ARIA + hitungan akun siap; nilai maksimal99 selama belum completed. Produk
siap menampilkan100% dan detail kredensial existing di bawah. Kendala menghentikan
spinner, menjelaskan tindak lanjut dan tidak meminta pembelian ulang. Tidak ada
persentase berbasis timer, klaim stok instan, merek supplier, atau janji12jam
pada kartu ini. `aria-live=polite`, reduced motion dan salinan ID/EN tersedia.
Polling mempertahankan batas existing dan berhenti saat tab tersembunyi.
Gambar/galeri katalog Jaspay tetap identik dengan produk MBO asal; bukan aset
pengganti generik. Publikasi CI; deployment belum diverifikasi.

## Header admin bersama (14 November 2026, implementasi lokal)

- Semua section memakai `PageHeader`: judul `text-xl`/line-height 28px,
  deskripsi `text-sm`/20px, aksi header di kanan pada desktop dan di bawah pada
  mobile. Tinggi minimum 72px mulai 768px dan 144px di bawahnya; teks panjang
  boleh menambah tinggi, tanpa dipotong. Jarak ke kartu, toolbar atau tab 24px.
  `AdminShell` menetralkan margin atas panel pertama agar titik awal seragam.
- Baris "Masuk sebagai"/email/durasi sesi dan metadata rentang/zona/waktu
  pembuatan laporan di atas Ringkasan dihapus dari UI. Indikator sesi sidebar
  dan filter periode Ringkasan tetap tersedia.
- Kategori memakai header di luar kartu daftar; Artikel dimulai dengan header
  lalu mini card. Tombol Kategori Baru/Artikel Baru berada rata kanan pada
  toolbar tepat di atas daftar (jarak 16px), mengikuti Template baru Siaran.
  Banner mendapat header sebelum mini card. `SystemTabs` memiliki satu header
  Pengaturan Toko sebelum tab Identitas/Integrasi Agent/Subscriber Email, tanpa
  header identitas kedua. Header Pembayaran tetap saat loading; error Produk
  berada setelah header bersama dengan retry.
- Menggantikan susunan header snapshot 13 November di bawah. Publikasi lewat
  CI; deployment belum diverifikasi.

## Modal template Siaran di tengah (14 November 2026, implementasi lokal)

- Editor Template baru/Edit template memakai Dialog terpusat yang sama dengan
  modal admin lain, menggantikan Sheet sisi kanan pada snapshot 13 November.
  Lebar maksimal 576px, jarak tepi viewport 16px dan scroll vertikal adaptif;
  pratinjau, konfirmasi buang perubahan dan pengaman saat menyimpan tetap.
  Publikasi lewat CI; deployment belum diverifikasi.

## Admin round 2: anatomi seragam, warna bermakna, label manusia (13 November 2026, implementasi lokal)

Menggantikan bagian "Panel admin memakai shadcn/ui sungguhan" di bawah hanya pada
aturan tata letak/istilah; token, tema dan primitive tetap.
- **Anatomi halaman identik** untuk setiap section: `PageHeader` (h2 `text-xl
  font-semibold` + satu kalimat deskripsi muted + aksi utama di kanan) → maksimal
  4–5 `StatCard` sama tinggi (label `text-sm font-medium` muted, nilai `text-2xl`
  `font-semibold tabular-nums` **netral**, hint kecil muted) → **satu** baris
  toolbar → Tabel (desktop) / kartu bertumpuk (mobile). Tidak ada header kedua di
  dalam tab; judul tab tidak mengulang judul+deskripsi halaman.
- **Warna = makna (D1)**: angka/nilai selalu `text-admin-fg`. Success hanya
  selesai/aman, warning hanya perlu dicek, danger hanya gagal/bahaya, secondary
  (abu) netral/nonaktif, info hanya catatan informatif. Tidak ada eyebrow cyan
  dekoratif ("Katalog") dan tidak ada nilai stat berwarna (Modal kuning, Margin cyan).
- **Satu primary per halaman/dialog/kartu (D2)** = aksi utama; aksi baris selalu
  outline/ghost `size sm`. Tidak ada tombol putih solid berulang per baris
  (Pedia Edit, aksi pesanan, TUNVN, Link Supplier, WR vs SK sudah outline).
- **Label manusia (D5)**: kode mentah tidak tampil — lunas→Lunas, qris→QRIS,
  completed→Selesai, delivered→Terkirim, manual_required→Perlu tindakan,
  blocked_balance→Saldo supplier habis; istilah dev ("sweep cron", "Pecundang",
  "Force Sync Now") diganti ("Sinkron sekarang", perbandingan modal manusia).
  Raw JSON/ID batch hanya di dalam dialog receipt.
- **Loading tidak menipu (D6)**: Skeleton atau "Memuat…", tidak pernah "0 pesanan",
  "Belum pernah", atau status merah saat data belum ada; error = alert danger +
  "Coba lagi"; supplier tak terbaca tampil "—"/"Belum terbaca" netral.
- **Round 2 per area**: Produk (kolom Terjual/Urutan berupa input berbingkai
  h-8/w-16 terpusat, nama kategori bukan slug; editor tanpa field alias WhatsApp,
  header varian accordion auto-tinggi + Badge/chevron, dialog tidak overflow saat
  URL kredensial panjang). Pesanan (satu toolbar faceted + chip filter + "Muat 25
  lagi", tabel 7 kolom tanpa kolom bukti, waktu WIB ringkas). Pedia (3 StatCard +
  tab Perlu tindakan). Games (4 StatCard termasuk "Bisa dijual" dari `sellable`,
  tanpa UI Oura, deskripsi supplier tanpa emoji). TUNVN (`Saldo TUNVN` + 3 StatCard,
  pengiriman otomatis tabel ringkas + dialog receipt). WR/SK (StatCard sama,
  "Sinkron sekarang"). WR vs SK (perbandingan manusia, Simpan hanya saat dirty).
  Siaran (tab Template/Riwayat, editor Dialog tengah + pratinjau sejak 14 November,
  dialog kirim 3 langkah).
  Rekonsiliasi (StatCard, "Tandai sudah dicek" ber-catatan, error manusia).
- **Koreksi round 1 (Games/TUNVN/Pedia/WR-SK)**: tabel Games dirancang muat di
  kontainer 1280 (terukur 966/966, tidak ada kolom Aktif terpotong) dengan teks
  panjang `truncate`/`line-clamp` + tooltip; kartu mobile mempertahankan select Grup
  dan guard eligibility yang sama dengan desktop.
  **[DIGANTIKAN 14 November 2026]** Untuk kolom **Kategori** Games: label penuh tanpa
  truncate 150 px dan tabel menggulir **di dalam region tabel sendiri** (lihat
  "Games storefront + admin delta"). Aturan Grup dua nilai juga diganti 8 kategori. TUNVN merender tabel hanya
  `>=md` dan kartu di bawahnya (satu tampilan saja per breakpoint). Pedia
  menaruh identifier supplier hanya di `<details>` terlipat. D6: kapasitas/sinkron
  WR/SK dan hitungan tindakan Pedia memakai Skeleton/"memuat" saat data belum ada.
- Bukti Chromium lokal (seluruh API, termasuk simulasi tulis, diintersep) 1280/390 × terang/
  gelap: UI1 Produk/editor/kredensial/Pesanan, UI2 Pesanan (filter, chip, load-more,
  detail, empty), UI3 Pedia 4 tab + Games + TUNVN + WR/SK + WR vs SK + koreksi
  Games@1280/390 & TUNVN@390, UI4 Siaran (template/editor/kirim/riwayat/hentikan) +
  Kanal + Rekonsiliasi + Ringkasan. Semua sesi melaporkan tanpa overflow halaman,
  tanpa pageerror, tanpa mutasi produksi. PM memberi verdict visual PASS pada sumber
  terintegrasi memakai tangkapan tersebut (orders desktop, payments gelap, editor
  mobile, games/TUNVN); bukti tetap fixture browser — bukan sesi admin produksi,
  transaksi nyata, atau deployment.

## Panel admin memakai shadcn/ui sungguhan (13 November 2026, implementasi lokal)

Menggantikan bagian "bergaya shadcn-admin" di bawah hanya pada komponen/dialog;
token warna, tema dan cakupan 19 section tetap.
- Semua layar admin (shell, login, 19 section, tab supplier/Pedia, dialog, toast)
  memakai primitive shadcn/ui gaya new-york di `src/components/admin/ui/`
  (Button cva default/secondary/outline/ghost/destructive/link; Input, Textarea,
  Label, NativeSelect, Select, Checkbox 16px, Switch 36×20, Badge
  default/secondary/outline/destructive/success/warning/info, Card, Table, Tabs,
  DropdownMenu, Tooltip, Popover, Dialog, AlertDialog, Sheet, Skeleton,
  Separator, Toaster sonner). Ikon hanya lucide-react; glyph teks (panah, centang,
  silang, bullet) tidak dipakai lagi.
- Pola halaman: judul `text-xl font-semibold` + deskripsi muted + aksi utama di
  kanan; toolbar (cari `w-72` + filter) di bawahnya; Table desktop/kartu mobile;
  pagination "Hal x dari y" + tombol outline (page-size di baris pagination).
  Label kalimat biasa `text-sm font-medium` (tidak ada label huruf kapital kecil);
  kartu statistik label `text-sm` muted + angka `text-2xl` tabular.
- Status = Badge berwarna token (lunas/aktif success, pending/perlu cek warning,
  gagal destructive, otomatis/legacy secondary). Kolom bukti Pesanan ringkas:
  badge "QRIS otomatis"/"Otomatis provider" + penjelasan di title/sr-only.
  Saldo supplier yang belum diketahui tampil netral "—", bukan hijau "aman".
- Loading = Skeleton/spinner; error = alert border danger + "Coba lagi"; data
  gagal tidak ditampilkan sebagai nol (termasuk Kanal & Fulfillment).
- `admin.css` hanya memberi default berspesifisitas nol (`:where(.admin-theme)`)
  untuk border/td/th/input agar utilitas shadcn selalu menang.
- Chromium lokal fixture 1024/1280/390, terang/gelap: Pesanan, Produk (tabel muat
  di 1280; 1024 scroll di region tabel), Pembayaran, Pengaturan, Artikel, Banner,
  Siaran, Kanal, WR/SK, Pedia, Games, Link Supplier tanpa overflow halaman/
  pageerror/mutasi. Bukan bukti sesi admin produksi atau deployment.

## Panel admin bergaya shadcn-admin, light/dark (13 November 2026, implementasi lokal)

- Seluruh 19 section admin (`summary`…`subscribers`, termasuk tab supplier/Pedia,
  login/auth-check, drawer, dialog, toast, loading/error/empty) memakai satu bahasa
  visual terinspirasi shadcn-admin (MIT, adopsi selektif; stack Next/React18/
  Tailwind3/auth tidak diganti): permukaan solid `admin-surface`, border tipis,
  shadow ringan, radius `rounded-xl`/`rounded-md`, tanpa glass/glow/pill di area
  kerja. Storefront tidak berubah; DESIGN Midnight/Cyan/Gold tetap untuk toko.
- Token semantic `admin.{bg,card,fg,muted,subtle,border,primary,inverse,accent,
  success,warning,danger,info}` (Tailwind, `rgb(var(--admin-*))`) didefinisikan
  di `src/components/admin/admin.css` dan hanya berlaku di `.admin-theme`.
  Terang: bg `#F8FAFC`, card putih, teks `#0F172A`, aksen cyan gelap `#0E7490`
  (5,36:1 pada putih; `#00E5FF` hanya 1,54:1 sehingga tidak dipakai untuk teks
  terang). Gelap: bg Midnight `#080C1E`, card navy `#0F1428`, aksen `#00E5FF`
  (12,62:1).
- Pilihan tema Terang · Gelap · Ikuti sistem (default sistem) lewat select native
  "Tema admin" di pojok kanan atas; tersimpan di cookie admin dan dirender SSR.
  Hanya `/admin`; `/admin/payments/test` tetap memakai checkout storefront asli.
  Pratinjau produk `.admin-preview` selalu gelap seperti toko.
- Ikon admin memakai adapter `AdminIcon` (lucide-react existing); ikon storefront
  `IosIcon` tidak diganti. Teks minimum `text-xs` (12px), tabel angka tabular,
  fokus `focus-visible` outline aksen 2px, input mobile 16px, reduced motion.
- Sidebar solid 248px/72px collapsed dengan nama aksesibel saat collapsed, skip
  link, breadcrumb/header; drawer mobile memakai native `<dialog>` (fokus
  terkurung + kembali ke pemicu). Modal Pesanan/Artikel/Produk/Kategori/Link
  Supplier/bukti bayar memakai `Dialog` native: header/footer tetap, body scroll,
  Escape/backdrop, busy guard. Modal Artikel mobile 390px kini terjangkau penuh.
- Draft belum tersimpan (Pengaturan Toko, Artikel, Produk/teks varian, Metode
  Pembayaran, Siaran) dilindungi dialog "Buang perubahan?" saat pindah section,
  link, back/forward atau tutup editor; saat simpan berlangsung navigasi ditahan.
- Error rekonsiliasi QRIS tampil sebagai alert persisten + "Coba lagi", bukan nol/
  empty; metrik loading/error Pesanan memakai em dash. Tabel Produk memisahkan
  badge dari nama terpotong dan label aksi tidak membungkus.
- Chromium lokal (fixture API diintersep, mutasi diblokir) 1280×800 dan 390×844:
  19 section tanpa overflow/pageerror, satu `<main>`, tiga mode tema, fokus drawer,
  draft/back-forward, dialog Artikel mobile, error+retry rekonsiliasi. Bukan bukti
  sesi admin produksi atau deployment.

## Admin Pedia IndoSMM (13 November 2026, implementasi lokal)

- Header singkat "Supplier: IndoSMM" dan satu strip tiga status: saldo + Periksa
  + waktu pemeriksaan (amber bila di bawah ambang), produk siap dijual/total,
  pesanan perlu tindakan yang membuka filter terkait. Data belum berhasil dimuat
  tidak ditampilkan sebagai nol. Midnight/Cyan/Gold, SF Pro dan shell Market tetap.
- Navigasi hanya Pesanan, Produk, Layanan IndoSMM, Pengaturan. Default Pesanan
  bila ada tindakan; selain itu Produk. Query tab lama dipetakan, view compare
  dan filter tindakan ikut back/forward. Data pesanan/pengaturan tidak menunggu
  katalog; loading, empty, error dan retry milik panel masing-masing.
- Produk desktop memakai tabel glass lima kolom: produk + ikon platform, jumlah
  varian aktif/total, harga mulai, status + alasan singkat, sakelar Market + Edit.
  Produk nonaktif tidak disebut siap dijual; produk aktif tanpa paket layak amber.
  Filter nama/slug/ID layanan, platform, status; 50 hasil/halaman. Di bawah768px
  memakai kartu, bukan tabel yang terpotong. Tidak menampilkan daftar ID supplier.
- Editor memisahkan Informasi produk dan daftar Varian ringkas. Edit varian
  membuka nama publik, ID IndoSMM, kelompok harga/markup/minimum untung, refill
  dan status; field lain tetap ada di Pengaturan lanjutan tertutup. Harga/margin
  dan pratinjau storefront tersimpan dilipat; pratinjau tetap privat tanpa order.
- Pesanan perlu tindakan dikelompokkan pertama; pesanan lainnya25/halaman dalam
  baris responsif dengan target terpotong + Salin, supplier singkat dan detail
  tertutup. Panel tindakan hanya pada status yang memerlukannya. Tombol retry/
  pembatalan hasil ambigu tetap disabled dan alasan terlihat, bukan tooltip saja;
  konfirmasi, pemeriksaan supplier dan pengakuan risiko tagihan tetap dipertahankan.
- Layanan supplier tetap IndoSMM: search/platform/pemakaian + Indonesia/refill,
  satu baris kesehatan, tambah ke produk, pagination50, kartu mobile. Mode
  Bandingkan per kebutuhan memuat kurasi existing dan menyimpan draf nonaktif.
  Pengaturan hanya mengedit enam nilai harga G1–G3; Minimum order/Ambang saldo
  read-only dari server, kesehatan/saldo dan riwayat7hari terpisah.
- Kontrol44px (saklar Market46x24 existing), aria switch/aksi, fokus cyan2px dan
  input berlabel. Chromium lokal1280/390 dengan fixture120 produk/540 varian,
  4.400 layanan dan30 pesanan: semua tab/editor/advanced/compare tanpa overflow;
  save produk/varian/settings, mapping, draft, rekonsiliasi, filter/pagination,
  back/forward, keyboard, error503+retry dan katalog tertunda diuji. Route/CSS/JS200;
  final reload tanpa pageerror/asset gagal. R2 lokal tanpa binding sempat500 dan
  HMR saat edit dependency memberi warning; final QA memakai gambar placeholder
  fixture lokal. Ini bukan bukti produksi, persistensi backend atau deployment.

## Kebutuhan dan varian Pedia (13 November 2026, implementasi lokal)

- Kebutuhan = satu pill per `product.metric`, urutan kemunculan pertama katalog,
  label ID/EN `pediaMetricLabel` + MetricIcon. Banyak produk supplier tidak lagi
  menjadi pill; pola scroll horizontal/ekspansi mobile dan Liquid Glass tetap.
- Di bawah jumlah, ServicePicker membandingkan seluruh tier dari semua produk
  bermetrik sama dengan baris/chip/harga existing. Awal delapan baris + pilihan
  aktif bila di luar delapan; tombol Tampilkan semua/Show all dapat dilipat ulang,
  `aria-expanded`, Enter/Space dan outline cyan existing. Tidak ada warna/font baru.
- Nama pendek hanya saat render: bracket teknis/dekor/emoji/duplikasi dibuang,
  wilayah/kualitas/kecepatan tetap; refill/drop/Instant Start tetap chip. Nama
  bertabrakan memakai qualifier pembeda atau Varian/Variant N, konsisten di baris
  dan ringkasan/sheet. Info layanan mempertahankan nama lengkap asli white-label.
- Memilih varian produk lain memindahkan slug+tier nyata dan membawa jumlah,
  target, checklist serta kontak. Fokus kembali ke radio pilihan; perpindahan
  metrik tetap memakai draft independen per produk (target profil tidak bocor ke post).
- Chromium lokal1280/390/320: fixture SQLite/D1 lokal69 produk (68 Instagram,
  enam metrik), delapan/semua14/pilihan kesembilan, switch metrik/varian, qty/target
  carry-over, Enter/Space, sheet Escape/focus-return dan ID/EN lulus tanpa overflow.
  Route/CSS/JS200; 503 harga sengaja untuk error/retry dan HMR proxy lokal terputus.
  Screenshot di direktori evidence Pedia13November; bukan deployment/transaksi produksi.

## Temp mail publik (12 November 2026, implementasi lokal)

- Web standalone mempertahankan Midnight `#080C1E`, cyan `#00E5FF`, gold
  `#FFB800`, SF Pro/fallback Apple dan panel glass. Tidak mengubah layout toko.
- Panel alamat custom/acak/copy, daftar inbox dan detail teks berdampingan pada
  desktop lalu bertumpuk pada mobile, tanpa email HTML/remote image aktif.
- Target kontrol minimal44px, label input eksplisit, fokus keyboard terlihat,
  status refresh `aria-live`, error/empty/loading terbaca, alamat/isi panjang wrap.
- Penjelasan inbox publik dan retensi24jam terlihat tanpa login; alamat dapat
  dibuka ulang. Aturan format dan pengecualian privat dijelaskan saat input ditolak.
- Chromium1280/390/320px pada Worker+D1 lokal: random/custom/reopen+reload/copy,
  keyboard Enter/Tab, detail OTP/HTML-only menjadi teks, error503/recovery, empty,
  reserved400 dan teks panjang lulus; fokus cyan2px, kontrol44px, tanpa overflow
  atau pageerror. HTML/script/tracker fixture tidak dieksekusi/dimuat; CSS/JS200.
  Screenshot `.playwright-mcp/temp-mail-{desktop,mobile}-final.png`; console400/503
  fixture disengaja, warning dev Request.cf timeout memakai placeholder lokal.
  Bukan QA SMTP/deployment produksi atau perangkat mobile fisik.

## Popup banner adaptif (11 November 2026, implementasi lokal)

- Pertahankan kartu putih448px, judul/deskripsi rata tengah, tombol biru #315DEA,
  tombol tutup44px, carousel dan animasi existing; tanpa perubahan aset poster.
- Tinggi maksimal min(92dvh,100% area tersedia), padding safe-area atas/bawah.
  Footer checkbox+CTA/Saya Paham tidak ikut scroll dan terlihat sejak popup dibuka.
- Media mengisi sisa tinggi setelah caption/footer; object-contain menjaga rasio
  asli dan seluruh poster. Ruang putih samping diperbolehkan ketika diperlukan,
  menggantikan aturan gambar selalu edge-to-edge24Oktober.
- Caption dibatasi30dvh dengan scroll sentuhan/keyboard dan outline fokus2px,
  tanpa mengecilkan teks/kontrol atau menyembunyikan deskripsi panjang.
- Implementasi lokal; bukan bukti deployment atau tes pada perangkat fisik.

## Default kontrol bahasa/mata uang (11 November 2026, implementasi lokal)

- Tanpa cookie valid, tombol langsung memakai bendera Indonesia; radio Bahasa
  Indonesia dan Rupiah (IDR) tercentang, tanpa menunggu deteksi jaringan/wilayah.
- Pilihan manual dan menu, fokus, ukuran44px serta gaya Liquid Glass tetap sama.
  Menggantikan globe/tanpa centang dan default otomatis pada snapshot lama di bawah;
  tidak mengubah bahasa pesanan tersimpan. Deployment belum diverifikasi.
- Chromium lokal1280/390, bahasa browser en-US dan zona AS: default/radio ID+IDR,
  switch manual independen dan reload, Escape mengembalikan fokus, screenshot menu
  desktop/mobile serta tidak ada overflow/pageerror terverifikasi. Aset CSS/JS200.

## Aksi supplier WR/SK/TUNVN (10 November 2026, lokal; belum dipublikasikan)

- SupplierLinkActions mempertahankan panel/warna/fokus existing; Retry/Cek status/
  Batal kini48px untuk ketiga supplier dan type=button agar tidak submit form induk.
  Copy SK membedakan saldo aktual kurang, preflight gagal dan receipt belum lengkap;
  copy status Buff menegaskan polling tanpa membeli lagi. Logika endpoint tidak diganti.
- Chromium komponen aktual + CSS build1280/390: Retry via Tab/Enter, Retry SK dan
  Cek status SK mengarah ke endpoint masing-masing; toast/callback berjalan,
  seluruh tombol48px, tanpa overflow/submit form/pageerror, CSS/JS200.
  Error409 fixture tidak memanggil onChanged; busy menonaktifkan semua tombol lalu
  pulih, fokus3px. Console409 mock disengaja, bukan error aplikasi baru.
  Fixture terisolasi, bukan QA seluruh halaman admin atau sesi/transaksi produksi.

## Label otomatis TUNVN (10 November 2026, lokal)

- Badge varian current memakai "Kirim otomatis" / "Automatic delivery", bukan MBO
  atau janji selesai instan. ETA ID/EN menyebut konfirmasi pembayaran dan kabar selesai.
  Checkout tidak menampilkan callout MBO; status paid memakai panel supplier otomatis.
- Editor varian TUNVN menampilkan keterangan cyan proses otomatis dan mode internal
  manual, bukan selector shared/unique/panel stok kredensial. Override S&K tetap ada.
  Midnight/SF Pro/Liquid Glass, komponen dan fokus existing tidak diganti.
- Chromium dengan API fixture lokal1280/390: input kode/quote checkout tanpa MBO,
  Tab ke email, panel status tanpa MBO, editor accordion/tab dan keterangan otomatis
  wrapping tanpa overflow; screenshot mobile diperiksa. Console tanpa error, route
  dan aset CSS/JS200. Katalog/badge/ETA ID/EN diuji kontrak, bukan QA PDP penuh.
  Tidak membuat order, mengirim email atau memeriksa deployment produksi.

## Status dan retry TUNVN (10 November 2026, lokal)

- Revisi modal dinamis: cost_changed historis menjelaskan pemeriksaan versi lama
  dan Retry memakai harga supplier terkini tanpa ceiling snapshot. Harga invalid
  tetap gangguan katalog/Buff, bukan peringatan kenaikan modal. Layout/fokus tetap.
  Chromium fixture1280/390: copy wrapping tanpa overflow, Retry via Enter dengan
  fokus3px/target48px, rejeksi409 lalu sukses200/processing; CSS/JS200, tanpa
  pageerror (console409 mock disengaja), bukan bukti transaksi/deployment produksi.
- Baris Pesanan/detail dan Ringkasan TUNVN memberi sebab yang terbaca, terutama
  saldo supplier kurang + top-up/Retry; gagal baca saldo bukan saldo habis.
  Pesanan supplier tidak ditampilkan sebagai handover generik. Order pembelian
  otomatis dinonaktifkan berlabel penanganan manual, tanpa Retry/top-up instruction;
  pencatatan handover tetap tersedia, tanpa menyatakan otomatis sudah selesai.
- Pertahankan Midnight/Cyan/SF Pro/Liquid Glass, panel warning merah existing dan
  teks wrapping. Retry/Cek status TUNVN memiliki tinggi48px; fokus cyan global dan
  disabled saat request. Request ditolak/preflight masih gagal tidak bertost sukses.
  Provider ID diketahui baru menampilkan cek status, tanpa blind rebuy/void.
- Chromium admin aktual dengan API fixture tertutup ke produksi,1280/390px:
  warning/detail/retry Enter+busy+error+processing/manual, status batch, empty/error
  dan pulih diperiksa; fokus Tab/Shift+Tab cyan, tanpa overflow/pageerror/CSS-JS gagal.
  Bukan bukti transaksi/notifikasi supplier, sesi admin produksi atau deployment.

## ChatGPT Private / input Muse (10 November 2026, T2A lokal)

Checkpoint akhir PM10November: owner menghentikan QA Gemini. Pemeriksaan Chromium
langsung pada checkout fixture1280/390 mencakup input/quote/error, fokus dan overflow;
layout tetap sesuai Midnight/Cyan/Liquid Glass. QA panel admin menyeluruh belum selesai.
Full suite5518tes dan build Pages lulus; belum merupakan bukti deployment produksi.

- Pertahankan Midnight/Cyan, Liquid Glass, SF Pro dan kontrol existing.
  ChatGPT menjadi satu kartu/PDP bernama ChatGPT Private; pilihan Business
  dan GPay tetap dapat dibedakan, tanpa nama supplier pada label pembeli.
- Quantity Buff1B dibatasi1..30 di PDP/modal/cart, tidak memakai empat bundle.
  Form checkout menampilkan label Kode Invite Muse, petunjuk lokasi Invite
  friends, enam huruf/angka dan case-preserving, serta satu kode per checkout.
  Label terhubung via htmlFor; hint via aria-describedby; autocomplete off,
  autocapitalize none. Quote menunggu kode valid lalu dimuat ulang saat berubah.
- Editor varian memakai select preset opsional + angka maksimum; default
  Tidak ada, bukan builder. Panel TUNVN menampilkan satu kontrol produk bersama
  dan kontrol tiap varian, bukan saklar produk duplikat yang bertentangan.
- Nilai kode hanya ditampilkan di detail order admin setelah GET authenticated
  no-store, tidak pada daftar/tabel massal. Telegram mengumpulkan di private
  chat tanpa mengulang kode dalam notis/callback. QA visual desktop/mobile,
  keyboard/fokus/overflow browser nyata masih paket T3, bukan bukti dari jsdom.

### T2B panel pengiriman (10 November 2026, lokal)

- Ringkasan TUNVN menampilkan100 link terbaru dalam baris responsif/break-all,
  status processing/completed/needs_admin, snapshot biaya, ID tepat dan metadata
  aman; tidak menampilkan invite code atau receipt plaintext pada daftar.
- Tombol Periksa status batch hanya untuk batch Buff diketahui (GET supplier,
  tidak membeli). Receipt privat dibuka lewat POST authenticated/audit ke state
  sementara dengan tombol Tutup; tidak dipersist/cache. Retry pra-beli ditambahkan
  pada revisi di atas, bukan replay setelah send. Busy/error/empty tetap existing.
- Copy pembeli tetap ChatGPT Private/Muse tanpa supplier. Buff selesai bukan
  akun/kredensial; notis tidak mengulang input. Browser desktop/mobile/fokus/
  overflow dan review visual merupakan tugas T3/PM, belum diverifikasi di sini.

## Games HERO-FIX (10 November 2026, lokal)

- Hero Games memakai kelas hero Pedia persis: container1280, padding40/56px atas
  dan16px bawah, grid `lg:[minmax(0,1fr)_auto]`, headline clamp32–40/56/48–62px
  weight700/tracking-0.02em, headline statis dua baris putih (typewriter dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit)), paragraf15px/24px dan CTA44px.
  Tanpa eyebrow AXVARA GAMES atau radial gold; latar memakai glow cyan Pedia.
- Games memakai `PediaOrbit` yang sama (props aditif items/brand/mark): empat game
  registry selalu menjadi planet bertaut, walaupun belum ada SKU enabled. Ring,
  sphere38/42px, ikon22/24px, kaca3D pusat90/102px, perlakuan mark putih, animasi,
  mobile hemat/reduced-motion tidak dibuat ulang. Default Pedia tidak berubah.
  Koreksi 14 Nov 2026: orbit statis `GamesOrbit` (648c9cb5) dihapus dan hero
  kembali ke `PediaOrbit` animasi; planet = empat game pertama katalog DB, art
  game mengisi penuh sphere lewat prop opsional `renderIcon` (GameImage +
  fallback inisial, no-referrer). Headline juga dikembalikan ke §4.1 GAMES
  ("Satu tempat untuk / top up game favorit." statis putih; typewriter dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit));
  (riwayat: copy statis "Top up game favoritmu" dari 648c9cb5 sempat dikembalikan ke typewriter pada 14 Nov karena belum ada keputusan owner; 15 Nov owner memutuskan hero statis).
- Tepat di bawah hero: dua `CrossServicePromo` Market + Pedia dengan utm_source=games,
  dimensi/wrapper CommunityBar Market, tetap dua kolom berdampingan di375px.
- Game registry kosong tetap menampilkan header dan "Nominal segera tersedia"
  (ID/EN), tanpa field pembayaran/cek nickname. Tidak mengarang nominal/aktivasi.

## Brand mark Pedia clean + mark Games analog (10 November 2026; PM final atas delegasi owner)

- Mark Pedia: redraw geometris `public/brand/pedia-mark.svg` (viewBox tetap
  144×128), siluet sama dengan trace Muse — frame (kaki kiri + apex + nub satu
  stroke miter w9, stub kanan w8.5, dua foot pad) + 3 batang seragam (lebar 18,
  gap 7, puncak 89/61/34, baseline 127.5). Sumber byte-identik dari PM.
- Mark Games: stik analog di atas frame Pedia yang sama (`public/brand/games-mark.svg`,
  viewBox 144×128) — ide owner, keputusan PM atas delegasi owner. Navbar Games
  memakai games-mark persis seperti PediaNavbar memakai pedia-mark (36×32,
  `brightness-0 invert`), bukan prisma Market; motif Lucide gamepad-2 sementara
  dihapus. PNG turunan Pedia (favicon 64, icon 192/512, apple-touch 180) tidak
  diregenerasi — turunan lama memuat bg navy + mark putih terpusat dan tetap valid
  untuk siluet baru; Games tidak punya favicon/OG khusus (mengikuti pola Pedia
  yang hanya ada bila dibutuhkan — tidak dibuat).

## AXVARA Games — arah desain (9 November 2026; implementasi beranda lokal, menunggu persetujuan visual)

Chrome Games senada Pedia 1:1 (keputusan PM 9 November 2026): navbar + bottom nav
mengikuti struktur/ukuran/`IosIcon`/shell Pedia; ikon konten Games Lucide 20px
stroke 1.75; H2 seksi 24px Market; chip rentang 44px; bottom nav sembunyi di
`/games/[slug]` (order bar ±64px + safe-area menggantikan).

Detail lengkap: `docs/GAMES.md` §4–§7. Ringkasan:
- S1 lokal: header GamesManager memakai satu baris status teks existing untuk
  jumlah cek nickname/batas modal hari UTC dan7hari kalender; bukan angka settlement.
  Tidak ada kontrol/warna/layout baru; QA browser diteruskan ke PM integrasi.
- Acuan pola UX Oura Store (header game + langkah bernomor + rail ringkasan sticky),
  **tanpa** meniru aset, warna atau teks mereka; identitas tetap token AXVARA
  (midnight, cyan aksi/terpilih, gold nomor langkah & badge, glass, Space Grotesk harga).
- Hero beranda **[DISETUJUI 9 Nov 2026] hybrid** — orbit AXVARA dengan ikon game sebagai
  planet yang bisa diklik + carousel promo tipis di bawahnya hanya bila ada banner aktif.
- Perbaikan atas Oura: tanpa popup saat masuk; nominal dikelompokkan (Spesial,
  Terlaris, Semua dilipat) + chip rentang + cari angka; satu kartu per nominal;
  badge "instan" sekali di header; total per metode termasuk biaya; cek nickname
  sebelum bayar (disetujui); bar bawah mobile satu baris ±64px; tanpa rating fiktif.
- Kartu nominal = radio glass, terpilih border cyan + glow; grid 2 kolom mobile /
  3 desktop; ikon mata uang SVG AXVARA; ikon UI Lucide.

## Ukuran storefront dikembalikan ke proporsi semula (8 November 2026, lokal; belum deploy)
- `CategoryPills` memakai tinggi `h-6` (24px) di mobile dan `sm:h-9` (36px) mulai breakpoint sm, dengan teks `text-[10px]`/`sm:text-sm`, ikon 10px/14px, padding `px-2`/`sm:px-4` dan gap `1`/`sm:gap-1.5` seperti sebelum commit 2e96cd5. Dikembalikan per keputusan owner 8 November 2026 setelah sempat membesar ke `h-11` tanpa catatan; jangan menaikkan tinggi pill tanpa instruksi owner.
- Tombol tutup **modal pilihan varian** (`QuickVariantModal`) dan **pengingat pesanan belum dibayar** (`PendingOrderReminder`) kembali ke ukuran visual 32px (`h-8 w-8`), dengan **area tap tetap 44px** lewat pseudo-elemen `before:absolute before:-inset-1.5 before:content-['']` pada tombol `relative`. Target sentuh tidak berkurang, jadi hover/focus-visible dan aria-label tetap sama.
- Nama toko di navbar disembunyikan hanya di bawah 375px (`max-[374px]:hidden`, sebelumnya `max-[379px]` di commit 2e96cd5), jadi nama tampil mulai 375px dan tersembunyi di Android 360px. Bukti pengukuran Chromium (lead, 8 November 2026): pada 360px dengan nama tampil, tombol keranjang terpotong (`right=361 > 360`); pada 375px dan 390px seluruh navbar muat dengan margin ~14px.
- Footer kartu produk di bawah 375px: label aksi "Keranjang"/"Checkout" tidak boleh meluber, jadi tombol dapat `min-w-0 whitespace-nowrap max-[374px]:gap-0.5 max-[374px]:px-1`, ikon statis dibungkus `max-[374px]:hidden` (spinner checkout saat pending **tetap tampil**), dan baris "N terjual"/"Lihat detail →" memakai sold `min-w-0 truncate whitespace-nowrap` + detail `shrink-0 whitespace-nowrap max-[374px]:hidden` (petunjuk detail dihapus di layar mini karena seluruh kartu sudah tautan). Tinggi `h-8 sm:h-9`, warna, teks, dan handler tidak berubah; ≥375px tampilan identik dengan sebelumnya. Berlaku juga untuk varian kartu compact.
- Kontrol **keranjang** (`CartDrawer`: tutup, kurang/tambah jumlah, hapus) kembali ke visual 32px (`w-8 h-8` + `relative before:absolute before:-inset-1.5`) dengan area tap tetap 44px. Ini menggantikan keputusan 31 Oktober 2026 "kontrol cart 44px" atas instruksi owner 8 November 2026; ikon tetap 12–16px, warna/ikon/aria/handler dan `focus-visible` tidak berubah, dan angka jumlah memakai `min-w-7 text-center` agar kedua hit area tidak menutupinya.
- Nama **AXVARA PEDIA** di navbar Pedia disembunyikan di bawah 344px (`max-[343px]:hidden`): pengukuran Chromium lead 8 November 2026 menunjukkan tombol bahasa berakhir di 325px pada viewport 320px dan 330px pada 330px (meluber hingga ~5px), sedangkan 344px sudah muat.
- Stepper qty **modal** (`QuickVariantModal`) kembali ke 36px visual (`h-9 w-9`) dengan area tap vertikal 44px lewat `before:absolute before:-inset-y-1 before:inset-x-0` (tidak melebar menimpa input secara horizontal), dan kotak "Jumlah" memakai `py-2` (dari `py-2.5`). Stepper **PDP** (`product-detail-client`) tetap 44px karena sejajar CTA `h-11`; varian, CTA, dan tombol `lacak-pesanan` tidak disentuh.

## Nama, S&K, dan email EN — fase 3 (7 November 2026, lokal; verifikasi browser belum)
- Nama produk EN memakai `name_en` admin; tanpa itu, token durasi/tier diterjemahkan saat render ("1 Bulan"→"1 Month", "Akun"→"Account", "Miliar"→"Billion"). Brand/nama tersimpan dan identitas cart/order tidak berubah.
- S&K/aktivasi admin EN memakai format editor yang sama (judul "Package details / Process & delivery / Usage rules / Warranty", baris "- ", langkah bernomor). EN hanya tampil saat salinan admin ID valid.
- Email pembeli EN memakai shell/AXVARA chrome yang sama, CTA "View Order/Invoice →", footer "Need help?"/"Contact us on WhatsApp"; tipografi, warna, dan struktur tidak berubah.

## Konten, badge, dan label EN Market — fase 2 (7 November 2026, lokal; verifikasi browser belum)
- Deskripsi produk EN berasal dari `description_en` milik admin (editor produk) dan memakai format yang sama: paragraf pembuka, baris "- " untuk keunggulan, judul "Terms & Conditions:" / "How to Activate:". Bila kosong, teks ID yang tampil.
- Badge admin diterjemahkan saat render: Terlaris→Best seller, Baru→New, Hemat→Save, "Hemat NN%"→"Save NN%", Paling Dicari→Most wanted, Promo→Promo; kata tak dikenal tetap. Label varian EN menerjemahkan durasi (1 Bulan→1 Month, 3 Bulan→3 Months) dan tier umum; brand/nama produk dan label tersimpan tidak diubah. S&K EN memakai judul bagian "Package details / Process & delivery / Usage rules / Warranty".
- Kategori `bundle-hemat` tampil "Value Bundles" di EN. Token warna, layout, dan komponen tidak berubah.

## Pedia: pemilih metode + panel pembayaran (7 November 2026, lokal; verifikasi browser belum dilakukan)
- Metode pembayaran berada di langkah Kontak sebagai bagian ringkas: baris judul "Metode pembayaran" + tautan "Pilih metode lain". Tanpa membuka tautan, QRIS tetap terpilih dan tidak ada request tambahan. Setelah dibuka, `PaymentMethodPicker` Market dirender apa adanya (kartu QRIS langsung, akordeon Virtual Account/E-Wallet/Transfer lainnya/Crypto, chip logo, biaya dan batas dari server) — tidak ada varian gaya Pedia.
- Pilihan yang hilang/tidak tersedia direkonsiliasi dengan aturan Market: kembali ke QRIS dan menampilkan catatan singkat (ID/EN). Kegagalan rail menampilkan pesan server dan mengembalikan pilihan ke QRIS.
- Halaman pesanan memakai header ringkas yang sama dengan QRIS untuk gateway/crypto pending, lalu `GatewayPaymentPanel` (gateway: satu kartu terpusat chip "Menunggu bayar"/total/hitung mundur/VA/tombol bayar/cek/status otomatis; crypto: dua kolom QR+detail dengan nominal yang dibulatkan tampilannya). Tombol "Batalkan Pesanan" dinonaktifkan saat crypto `confirming`/`manual_review` (dana mungkin sedang berjalan).
- Semua copy picker/panel berasal dari komponen Market sehingga mengikuti `axv_locale`; nominal crypto tetap USD (bukan konversi IDR) dan label jaringan tidak ditebak.

## Cakupan bahasa Market — fase 1 UI (7 November 2026, lokal; verifikasi browser belum dilakukan)
- Saat English dipilih, seluruh chrome pembeli Market berbahasa Inggris: navbar/footer/kartu/PDP/keranjang (`catalogCopy`), nama kategori (`market-categories` by slug; unknown slug → nama DB), halaman pesanan/lacak beserta panel pending/paid/expired/akses/PIN/kredensial/garansi (`order-copy` memakai `order.locale`, atau `axv_locale` untuk form sebelum pesanan diketahui), hero/community/banner, serta reminder/device orders/help.
- Salinan ID dipertahankan byte-identik; EN memakai tone dan hierarki tipografi yang sama. Token Midnight/Cyan/Gold, layout, fokus-visible, dan target sentuh tidak berubah.
- Halaman statis `cara-order`, `garansi-replace`, `artikel`, serta menu lintas-layanan (`ServicesMenu`, `CrossServicePromo`) mengikuti locale yang sama; metadata halaman tetap di `layout.tsx` server.
- Di luar fase ini: konten produk/deskripsi/S&K/aktivasi (fase 2), email pembeli, admin, dan Pedia (dikerjakan terpisah).

## Pedia: bahasa + mata uang tampilan (7 November 2026, lokal; verifikasi browser belum dilakukan)
- Header Pedia memakai `PreferenceControls` Market apa adanya (satu tombol bendera bulat h-11/w-11 + chevron, menu `role="dialog"` dua bagian Bahasa/Mata uang) dengan urutan Market. Desktop: logo/pencarian → Layanan → nav (Katalog/Lacak Pesanan/Artikel) → kontrol bahasa; mobile: logo → Layanan → tombol pencarian → kontrol bahasa. Tidak ada kontrol kedua atau varian gaya baru (Pedia tanpa keranjang). Mobile memakai tombol yang sama (bukan sheet terpisah) sehingga reachability dan fokus identik dengan desktop.
- Teks chrome Pedia (nav, hero, kartu, pemilih layanan, ringkasan, status, refill, bantuan, ketentuan) mengikuti `axv_locale`. Nama layanan tetap tampil sebagai istilah SMM; bagian Indonesia diterjemahkan saat render ("Akun berpostingan" → "Accounts with posts", "Campuran" → "Mixed") tanpa mengubah angka/batas.
- Harga: label mata uang mengikuti pilihan; IDR tetap `Rp38.000` pada kartu/pemilih dan `Rp 38.000` pada ringkasan/QRIS (format existing), USD dirender `US$…` dari server. Saat USD dipilih tetapi FX tidak tersedia, harga kembali Rupiah tanpa badge tambahan selain catatan yang sudah ada di menu preferensi.
- Lebar/rapat: label EN lebih panjang (mis. "Request Refill", "Choose a service"); komponen memakai `break-words`/`min-w-0` existing, tanpa mengubah ukuran chip, grid, atau sticky CTA.

## Nominal crypto tampil dibulatkan ke atas (7 November 2026, lokal; verifikasi browser belum dilakukan)
- Angka koin di panel pesanan (tampilan `crypto-amount` dan nilai tombol "Salin"), hasil lacak, dan instruksi Telegram memakai presisi terpendek (mulai 2 desimal, dibatasi presisi asli) yang kelebihan AKTUAL hasil pembulatan ke atas ≤ US$0,01 menurut rasio USD/koin tersimpan. Contoh: `2.24671004` + US$2.25 → `2.25`; `0.000468` + US$1.05 → `0.00047`; `1.009` + US$10.09 → `1.01`; `0.000503` + US$1.13 tetap `0.000503`; nominal pendek/invalid/zero dibiarkan apa adanya.
- Tanpa badge, tooltip, atau teks penjelasan tambahan; label "Kirim tepat"/"Send exactly" dan peringatan jaringan tetap. Angka yang disimpan/dikirim ke provider tidak berubah, jadi desain tidak menampilkan simbol "≈" pada nominal koin.

## Kanal ShopeePay biasa & copy gangguan (7 November 2026, lokal; verifikasi browser belum dilakukan)
- E-Wallet menampilkan kanal `SHOPEEPAY` biasa dengan label server "ShopeePay" dan (sejak sore 7 November 2026) `DANA_REALTIME` dengan label "DANA" (tanpa kata "Realtime"). `SHOPEEPAY_REALTIME` tetap tidak dirender (dikecualikan exact-ID dengan flag `i`); tidak ada fallback dua arah untuk ShopeePay. Label historis realtime hanya dipakai saat membaca invoice lama.
- Urutan E-Wallet tidak berubah: ShopeePay → DANA → GoPay → OVO (ditentukan LABEL tampilan, bukan kode kanal), lalu sisanya urut server. Kanal tersembunyi tidak ikut dalam urutan/chip logo.
- Copy gangguan untuk kegagalan/ambigu/initializing invoice gateway/crypto di checkout: "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain." / "This payment method is having problems. Please try another payment method." Gaya teks mengikuti komponen error existing; copy persiapan QRIS tidak berubah.

## Hierarki panel pembayaran pending gateway & crypto (7 November 2026, lokal; verifikasi browser belum dilakukan)
- Menyamakan gateway/crypto pending dengan blok QRIS: header halaman ringkas (ikon jam 32/40px berputar saat pending dengan role=status/aria-label sama seperti QRIS, judul "Pembayaran <label>"/"Pembayaran Crypto", kode pesanan mono cyan, tepat satu h1, container `max-w-[760px]`), tanpa ikon 64px/h1 besar/lencana/paragraf lead. State consent/initializing/confirming/preparing tetap memakai header penuh.
- **Gateway pending:** satu kartu terpusat `rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-3 sm:p-4`; urutan chip "Menunggu bayar" → label metode → "Total bayar" + nominal font-display 2xl → satu baris muted Subtotal/Biaya (bila fee>0) → hitung mundur gold berdenyut "Berlaku mm:ss · sebelum HH.MM WIB" → VA (kode + Salin) → tombol utama selebar penuh h-12 cyan "Bayar via <label> ↗" → "Cek Pembayaran" selebar penuh sekunder (border white/15, teks white/80, bukan cyan) → baris spinner status otomatis 10px white/50 aria-live → catatan kunci metode 10px white/40 dipisah `border-t border-white/10`.
- **Crypto pending:** kartu dua kolom `grid items-start gap-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-5`; kiri "Scan alamat" + QR di pelat putih 180px (200px ≥sm) + chip `{SIMBOL} · {jaringan}` gold/30 dengan logo 16px, placeholder skeleton seukuran saat QR belum siap; kanan chip "Menunggu bayar", "Kirim tepat", logo 28px + nominal mono 2xl + tombol "Salin" h-9, satu baris `≈ US$x · termasuk biaya layanan crypto` (label generik sejak 7 November 2026 — biaya bukan persentase lagi; nominal dari server), hitung mundur, label "Alamat tujuan" + `<code>` mono 12px `break-all`, grid 2 kolom [Salin alamat | Cek Pembayaran], baris spinner status, status salin aria-live. Di bawah kedua kolom: callout amber `#FFB800` ⚠ "Hanya <SIMBOL> di jaringan <label>…"; catatan kunci metode border-t. Blok Subtotal/Biaya/TOTAL(USD) dan baris JARINGAN terpisah dihapus; `data-testid` crypto-* dipertahankan (crypto-network pindah ke chip).
- Persetujuan total gateway tetap wajib, tetapi satu klik: sesudah 200 dengan pembayaran pending + tautan https, tab yang sama diarahkan ke provider (tombol berbunyi "Setujui <total> & bayar"); tanpa tautan hanya status dibaca ulang.
- Token Midnight/Cyan/Gold, font, fokus-visible 2px cyan, target sentuh h-11/h-12, dan copy ID/EN lewat `orderPanelCopy` tidak berubah.

## E-Wallet gateway: label tanpa "Realtime" + urutan tetap (6 November 2026; DIGANTI 7 November 2026, lihat bagian teratas; lokal, belum deploy)
- [KOREKSI sore 7 Nov 2026: `DANA_REALTIME` kembali ditampilkan berlabel "DANA"; hanya `SHOPEEPAY_REALTIME` yang disembunyikan.] Label kanal realtime yang tampil ke pembeli: `SHOPEEPAY_REALTIME` → **ShopeePay**, `DANA_REALTIME` → **DANA**. Kata "Realtime" tidak muncul di label pembeli; ID kanal tetap persis untuk routing/fee/consent. Normalisasi label historis hanya untuk dua ID kanal ini (Map ID eksak); nama/label kanal lain — termasuk yang tampak seperti "ShopeePay Realtime" pada ID tak dikenal — tidak diubah. Logo existing (`shopeepay.svg`, `dana.svg`) dipakai tanpa aset baru.
- Urutan baris E-Wallet: ShopeePay → DANA → GoPay → OVO untuk metode yang benar-benar ada (bukan placeholder), disusul metode lain dengan urutan server (tersedia dulu, lalu nonaktif). Metode pertama yang nonaktif/di luar batas tetap berada di posisinya dengan tampilan redup, Min./Maks., radio nonaktif, dan alasan sr-only seperti sebelumnya. Urutan ini juga dipakai chip logo header grup.
- QRIS langsung di atas grup, urutan grup VA · E-Wallet · Lainnya · Crypto, urutan/nonaktif VA/Lainnya/Crypto, biaya/total server, animasi 220 ms, reduced motion, immediate/deselect/inert, dan token Midnight/Cyan/Gold tidak berubah.
- Verifikasi: 2 file fokus/71 tes + integrasi PM final 361/4817; Chromium fixture flag OFF 1280 EN/390 ID: 7 wallet urut ShopeePay→DANA→GoPay→OVO→LinkAja→Virgo→AstraPay tanpa SHOPEEPAY biasa/teks Realtime, ID/fee persis, keyboard panah fokus2px; 360 ShopeePay nonaktif tetap posisi pertama (Min74000/shortfall10000), keyboard native ke DANA; tanpa overflow, CSS/JS200, tanpa error baru. Order mock saja; belum deploy.

## Halaman tes pembayaran admin (6 November 2026, terdeploy; koreksi parser lokal menunggu publikasi)
- `/admin/payments/test` memakai checkout/picker existing, bukan desain pembayaran kedua. Judul ID/EN membedakan tes admin, dengan peringatan terlihat bahwa transaksi nyata dan pesanan lunas tetap diproses/dikirim; tautan kembali admin dan petunjuk keranjang berada di atasnya. Halaman tidak diindeks; flag mati menampilkan notice nonaktif.
- Token visual Midnight/Cyan/Gold, font, urutan metode, validasi dan consent tetap. QA Chromium fixture ID1280/390/360: tanpa overflow/error konsol terkait; radio jaringan eksplisit bisa dipilih dengan keyboard dan outline2px, OVO meminta consent total final sebelum tautan, crypto pending menampilkan jumlah/jaringan/alamat/QR dan bisa dilanjutkan setelah refresh. Ini provider mock, bukan bukti pembayaran produksi.

## Sekalipay gateway di atas Crypto (snapshot lokal 6 November 2026; baseline sudah deploy `e2aa02a`)
- Menggantikan tampilan gateway pada spesifikasi 5 November: QRIS langsung tetap; urutan grup Virtual Account, E-Wallet, Lainnya, Crypto. Judul gateway 14px semibold huruf biasa, caption 12px "Biaya mulai Rp ..." (biaya tersedia termurah dari server), "Tanpa biaya", atau "Belum tersedia untuk nominal ini". Empat ubin logo bank persegi panjang bertumpuk + jumlah sisanya; grup kosong disembunyikan.
- Panel gateway memakai satu daftar kaca: baris min-h 48px, ubin logo 40×26, nama kanal (akhiran VA/Virtual Account dipangkas hanya untuk tampilan), biaya server + radio. Revisi owner 6 November: seluruh 18 label snapshot merchant memiliki logo asli lokal, termasuk BNC (NEO), Permata VA Alternative, Virgo, AstraPay, DANA Realtime dan ShopeePay Realtime. Label tidak dikenal tetap monogram netral, bukan merek lain. Tidak ada kolom pencarian di VA/E-Wallet/Lainnya maupun Crypto; semua metode langsung tersedia saat grup dibuka. Kanal nonaktif redup dengan Min./Maks. dan alasan aksesibel. ID/routing/fee tidak diubah klien.
- Gerak grid 0fr/1fr + opacity 220ms dan chevron existing dipakai ulang, termasuk reduced motion, inert/aria-hidden saat tutup, exclusive-open dan deselect. Ringkasan checkout gateway kini Subtotal, biaya metode, Total dan satu catatan persetujuan total akhir. Panel consent memakai label subtotal/biaya metode/total yang sama; persetujuan dan redaksi tautan tetap.
- Logo BSI existing diperbaiki: hapus metadata guide dengan penutup `sodipodi:namedview` tanpa pembuka yang membuat browser menolak SVG. Path visual asli tetap; test mem-parse seluruh logo gateway sebagai XML, bukan hanya memeriksa isi teks.
- QA revisi logo/tanpa pencarian memakai snapshot katalog merchant 6 November (10 VA/8 E-Wallet, 28 opsi crypto) dengan D1 lokal; bukan aktivasi produksi. Chromium ID/EN pada 1280/390/360: seluruh grup dibuka, tidak ada input pencarian atau monogram kanal dikenal, seluruh logo berhasil decode, tanpa overflow horizontal atau error konsol checkout. Keyboard Enter/Tab/panah/Spasi dengan outline cyan 2px, jaringan crypto eksplisit, exclusive-open/deselect dan inert lulus; reduced-motion menghasilkan `transition-property:none`, mode biasa 220ms. Token Midnight/Cyan/Gold, font, QRIS dan crypto dipertahankan. QA consent invoice mock dari revisi sebelumnya tetap bukti terpisah, tidak diulang untuk perubahan dekoratif ini.

Hasil lacak pesanan lokal: tombol salin kode dan lacak pesanan lain berukuran 73×44px dan 127×44px pada browser fixture 1280/390/360; cakupan aksesibilitas menyeluruh masih menunggu. Fokus kembali ke BODY setelah hasil ditutup dicatat sebagai tindak lanjut review.

Checkout lokal memakai label, ringkasan, validasi, dialog harga/stok, pengiriman dan persetujuan ID/EN mengikuti locale tampilan tanpa mengubah desain atau data pemilik. Browser fixture mengonfirmasi checkout EN pada 1280/390/360; review UI pembeli Opus kemudian menyetujui (5 November 2026, lokal).

## Poles PDP grosir, gerak akordeon pembayaran, dedupe hemat checkout (6 November 2026, implementasi lokal; persetujuan visual owner menunggu)
Menggantikan, hanya pada bagian terkait, bullet "Grosir (BulkPriceTiers)" dan baris "hemat" di bagian 5 November. Konsep BARIS tier R1 dipertahankan; tanpa chip baru, garis berwarna, atau glow. Harga/quote/logika tier tidak berubah.
- **PDP area jumlah:** baris 1 = stepper di kiri + "Sisa 50"/"Stok tersedia" muted (12px, white/40) di kanannya, rata tengah vertikal. Baris 2 (ringkasan 2 bagian, `flex-wrap justify-between`, `mt-3`): kiri "Total **Rp 64.000**" (label white/60, nilai semibold putih; setara USD kecil 11px muted di bawah nilai bila server menyuplai), kanan "Hemat Rp 16.000" hijau `emerald-300/80` yang sama dengan checkout, `whitespace-nowrap`, disembunyikan bila 0 (en: "You save …"). Tidak lagi satu baris "Sisa · Total · hemat".
- **Blok grosir (full):** jarak 16px dari ringkasan; judul "Harga grosir"/"Bulk pricing" huruf biasa 14px semibold white/80 dengan "per pcs" 12px white/45 rata kanan pada baris yang sama (menggantikan "HARGA GROSIR · PER PCS" uppercase). Daftar baris: `min-h-11 px-4`, pemisah 1px `divide-white/[0.06]`, tabular-nums, rentang kiri/harga kanan; tidak aktif white/70 normal, aktif `bg-white/[0.06]` + rentang & harga semibold putih + tanda "· jumlahmu"/"· your qty" 12px white/50 normal; baris tak tercapai tetap redup. Catatan kaki satu baris 12px muted sejajar padding tabel ("Berlaku untuk semua unit varian ini." / "Applies to every unit of this variant."). Tautan upsell di bawahnya (jarak 8px, sejajar padding kiri tabel, min-h 44px): "Tambah 2 pcs lagi ➜ Rp 7.000/pcs" dengan ikon lucide ArrowRight 14px (bukan glyph), teks cyan, hover underline, cincin fokus. Mode compact (keranjang/modal) memakai tautan dan tipografi yang sama.
- **Checkout/ringkasan:** baris item hanya info tier ("Harga grosir 3+" / "Bulk price 3+", tanpa nominal); SATU baris agregat di area total "Hemat grosir Rp 16.000" / "Bulk savings Rp 16.000" (jumlah semua baris grosir dari quote server, hijau, disembunyikan bila 0). Nominal hemat tidak pernah diulang. Laci keranjang tidak punya baris hemat nominal sehingga tidak berubah.
- **Gerak akordeon pembayaran:** semua grup (VA, E-Wallet, Transfer lainnya, Crypto) dan perluasan jaringan USDT/USDC memakai trik grid `grid-template-rows: 0fr → 1fr` (pembungkus dalam `min-h-0 overflow-hidden`) + opacity, 220ms ease-out, buka dan tutup (termasuk pertukaran exclusive-open) beranimasi bersamaan; chevron berputar dengan durasi yang sama; `motion-reduce:transition-none`. Isi tetap terpasang selama animasi tutup; saat tertutup `inert` + `aria-hidden` + `visibility:hidden` (visibility ikut bertransisi sehingga baru menghilang di akhir) agar tidak bisa difokus/dibacakan. `aria-expanded`/`aria-controls` dan semua perilaku (hapus pilihan saat tutup, jaringan eksplisit) tidak berubah.
- **Harga USD tanpa berkedip:** `useDisplayPrices` memakai stale-while-revalidate — nominal yang sudah diketahui (mis. harga dasar "≈ US$0,55") tidak pernah dikosongkan saat qty berubah; hanya nominal yang belum diketahui diminta (debounce tetap); mode USD tidak menampilkan "…" untuk nominal yang sudah diketahui. Cache dikosongkan saat preferensi/version berubah, saat respons membawa effectiveAt/bahasa/mata uang berbeda, atau saat "tidak tersedia" (galat jaringan mempertahankan nilai lama pada lingkup yang sama). Tetap tanpa kurs/perkalian di klien.

## Crypto multi-koin — pemilih koin + panel pesanan (6 November 2026, implementasi lokal; revisi visual-lead 6 Nov; persetujuan visual owner menunggu)
Menggantikan, hanya untuk grup Crypto dan panel crypto halaman pesanan, bagian "kartu per koin" dan catatan crypto di revisi 5 November di bawah. Tak berubah: QRIS langsung tampil, akordeon exclusive-open, menutup grup menghapus pilihan, grup gateway (flag nonaktif di produksi; tak disentuh), tanpa garis kiri/wash/glow cyan, tanpa chip bertumpuk atau paragraf penjelasan, token Midnight #080C1E / Cyan #00E5FF / Gold #FFB800, permukaan kaca `ax-glass-card`.
- **Header tertutup** (tombol native `aria-expanded`/`aria-controls`, min-h 64px, permukaan kaca QRIS): judul "Crypto" bergaya SAMA dengan "QRIS Dinamis" (14px semibold, huruf biasa putih; hanya grup gateway lain yang tetap uppercase), di bawahnya satu keterangan muted 12px "US$12.48 · termasuk biaya layanan crypto" / "US$12.48 · incl. crypto service fee" (total dari server; sejak 7 November 2026 biaya per koin bukan persentase, jadi TIDAK ada angka persen — invoice lama juga memakai label generik; tanpa koin tersedia = tanpa keterangan), lalu empat logo koin BULAT 24px bertumpuk (`-space-x-1.5`, cincin warna latar) BTC, ETH, USDT, USDC (satu per simbol) dan "+N" = jumlah SIMBOL tersisa (12 simbol -> "+8"). `aria-label` tetap "Crypto, N metode".
- **Terbuka — satu baris per SIMBOL** (12 baris, bukan 28 opsi), urutan kurasi: Populer (BTC, ETH, BNB, TRX, LTC, TON) lalu Stablecoin (USDT, USDC, DAI, PYUSD, FDUSD, USDP); di dalam subgrup simbol tersedia dulu, simbol yang semua jaringannya di bawah minimum di akhir. Revisi owner 6 November menghapus pencarian dan filter sepenuhnya; semua simbol ditampilkan dengan dua subjudul tenang 12px muted "Populer"/"Popular" lalu "Stablecoin". Menutup grup mereset perluasan jaringan.
- **Baris simbol satu jaringan** (BTC, ETH, BNB, TRX, LTC, TON, DAI, PYUSD, USDP): radio native langsung (pilih = pilih opsi itu) — `min-h-[48px]` `grid-cols-[24px_minmax(0,1fr)_auto]`: logo 24px bulat | SIMBOL semibold putih + nama jaringan 12px muted | titik radio. Terpilih = cincin dalam `ring-1 ring-inset ring-[#00E5FF]/50` + `bg-white/[0.06]` netral + titik radio terisi (tanpa garis kiri/wash cyan). Di bawah minimum: baris redup (`opacity-55`, `cursor-not-allowed`, `aria-disabled`, radio `disabled` + guard onChange), kanan rata kanan "Min. US$2.25" semibold + "≈ Rp 36.000" muted (padanan IDR hanya bila dikirim server); alasan lengkap hanya untuk pembaca layar.
- **Baris simbol multi-jaringan** (USDT 9, USDC 8, FDUSD 2): tombol native (`aria-expanded`, Enter/Spasi) dengan logo + SIMBOL + teks tenang "9 jaringan"/"9 networks" + chevron. Dibuka → tepat di bawah baris muncul `role="radiogroup"` bernama "Jaringan USDT"/"USDT network" berisi semua chip jaringan yang membungkus (`flex-wrap gap-2`), tiap chip = label radio native sr-only min-h 44px dengan titik radio + nama jaringan (BNB Smart Chain, Tron (TRC20), …); terpilih = border `#00E5FF/50` + `bg-white/[0.06]` + titik terisi. **TANPA jaringan bawaan**: membuka simbol tidak memilih apa pun (pembeli wajib memilih jaringan; keselamatan jaringan crypto) dan menghapus pilihan crypto sebelumnya; CTA tetap pada state "pilih metode" yang ada. Hanya satu simbol terbuka: membuka simbol lain menutup yang sebelumnya dan menghapus jaringan yang dipilih di dalamnya; memilih simbol satu jaringan menutup yang terbuka; menutup simbol (tombolnya lagi) menghapus pilihannya. Jaringan di bawah minimum = chip nonaktif redup dengan "Min. US$x" kecil (+ `title`, alasan sr-only), tak bisa dipilih klik/keyboard. Simbol yang SEMUA jaringannya di bawah minimum = baris nonaktif (tanpa tombol buka) dengan "Min." terendah dari server. Pilihan yang dipulihkan pada simbol multi memperluas simbol itu. Tidak ada perluasan/filter otomatis berbasis pencarian.
- **Ringkasan checkout (rail/ringkasan) — revisi owner 6 Nov, label biaya 7 Nov:** cukup dua baris 13px white/60 di atas total: "Subtotal US$x" dan "Biaya layanan crypto US$y" (label generik sejak biaya per koin 7 November 2026: TIDAK ada persen; nominal dari server; tanpa tanda +), lalu "Total dalam USD US$z". Baris kurs dan catatan biaya jaringan DIHAPUS dari ringkasan (dianggap ruwet); instruksi koin/jaringan tetap di halaman pembayaran. Panel halaman pembayaran memakai label yang sama ("Subtotal", "Biaya layanan crypto"). Catatan amber/paragraf crypto di picker dihapus.
- **Panel pesanan crypto (pending):** rincian subtotal USD + biaya layanan + total; label "Kirim tepat", baris logo koin 32px bulat + nominal mono tebal (`SIMBOL`, teks persis) + tombol "Salin nominal"; baris berlabel "Jaringan | BNB Smart Chain" (nilai semibold, latar `bg-black/25`); "Alamat tujuan": di bawah `sm` QR (SVG lokal 132px, pelat putih, dibuat dengan `qrcode` hanya dari alamat) lalu alamat penuh lalu tombol "Salin alamat" selebar penuh, ≥`sm` QR di kiri dan alamat + tombol di kanan; hitung mundur "Bayar sebelum …" tetap; SATU baris peringatan amber 11px "Hanya USDT di jaringan BNB Smart Chain yang diterima. Koin atau jaringan lain dapat membuat dana hilang." (baris gas/kurang-bayar lama dihapus); tombol Cek Pembayaran dan baris kunci metode tetap. QR tidak dirender selain tahap pending.
- Aset: logo koin `public/payments/coins/<ticker>.svg` (28 berkas, dari tugas aset terpisah; nominatif). Batas bukti: tes perilaku jsdom + build Pages + peninjauan visual lokal (runtime parity profil `owner`); bukan bukti produksi.

## Revisi owner marketplace — akordeon pembayaran, baris grosir, menu bendera (5 November 2026, lokal)
Status: implementasi lokal + tes fokus; **persetujuan visual BARU masih menunggu** (persetujuan 4 November di bawah tidak dibawa ke revisi ini); belum deploy; admin tidak dirender. Menggantikan, hanya pada bagian terkait, spesifikasi R2 (tombol teks + baris footer + bottom sheet) dan R4–R6 (picker 3 grup) di bagian "Revisi visual Opus" berikutnya; R1-layout (baris tier) DIPULIHKAN. Tidak berubah: tanpa garis/wash cyan, anti-AI-slop, token Midnight/Cyan/Gold, inti finansial.
- **Pembayaran (PaymentMethodPicker):** QRIS tampil langsung di atas semua grup sebagai kartu radio native (tanpa header akordeon, chip, chevron, atau panel tersembunyi); badge "Paling cepat"/"Fastest" inline di judul kartu QRIS, satu-satunya badge. Grup lain berurutan Virtual Account · E-Wallet · Transfer lainnya (hanya bila ada; `group` hilang/tak dikenal TIDAK diasumsikan VA) · Crypto; grup kosong tidak dirender. Header grup lain = `<button aria-expanded aria-controls>` min-h 64px berpermukaan kaca QRIS: judul uppercase, hitungan "N tersedia" (hanya yang tersedia; "Tidak tersedia untuk total ini" bila 0) dan baris chip logo `h-8 w-12` (maks 6 + "+N"; ≤420px maks 4 + "+M"; chip tak tersedia `opacity-50`). Terbuka: semua metode quote sebagai kartu satu keluarga (logo | nama + "Biaya est. +Rp X · Min. Rp Y" | "Rp total / est. total" | radio). Grup yang memuat pilihan yang dipulihkan juga terbuka sejak awal (tetap maksimal satu grup terbuka); hanya satu grup terbuka pada satu waktu—membuka grup lain menutup yang sebelumnya dan mengklik grup yang sama menutupnya. Menutup grup yang memuat pilihan menghapus pilihan eksplisit (selectedId null): header tertutup tidak menampilkan ringkasan "Dipilih"/logo kedua, fee/total provider hilang, dan CTA menunggu pilihan baru; QRIS langsung tidak ikut terhapus dan checkout baru tetap default QRIS. Membuka/menutup grup lain tidak mengubah QRIS atau pilihan di grup yang tetap terbuka. Radio di panel tersembunyi tidak bisa difokus (panah hanya pada yang terlihat). Aturan lama "<details> >4" dan "terpilih tak boleh tersembunyi" digantikan oleh deselect eksplisit saat grup terpilih ditutup (tanpa ringkasan terpilih). Catatan: satu baris gateway di bawah picker ("Biaya & total estimasi; total akhir kamu setujui di halaman pesanan.") dan satu baris crypto ("Alamat & nominal tepat muncul di halaman pesanan."); paragraf amber panjang biaya penyedia/gas dihapus (owner) dan diganti caption kartu "+ biaya jaringan"; validasi/consent finansial tidak berubah.
- **Batas min/max (kontrak server, tampilan di kartu):** kanal di luar batas tampil nonaktif — radio native `disabled`, label `aria-disabled`, `cursor-not-allowed`, pelat logo penuh, teks `text-white/60`, meta "Min. Rp X", baris alasan `aria-describedby` ("Tambah Rp N untuk metode ini" dari `shortfall` server, atau "Melebihi maks. Rp M"), tanpa biaya/total. Tersedia lebih dulu lalu nonaktif. Bila quote baru membuat pilihan nonaktif: pilihan pindah ke QRIS seketika dengan satu pemberitahuan "… tidak tersedia untuk total ini — dipilih QRIS." sampai pembeli memilih lagi. Klien tidak berhitung finansial.
- **Grosir (BulkPriceTiers):** daftar BARIS tier (bukan kolom/card grid): rentang inklusif dari min_qty asli ("1–2 pcs", "3–9 pcs", "10+ pcs"; "1 pcs" bila tier berikut di 2; tier terakhir memakai "N+" yang inklusif, bukan "> N") di kiri, harga satuan di kanan, satu baris per tier. Baris aktif netral `bg-white/[0.05]` + rentang & harga `font-semibold` + label terlihat "· jumlahmu"/"· your qty"; tak aktif `font-normal text-white/65`; tak tercapai `opacity-50` + alasan menggantikan harga. Tanpa garis biru kiri/wash cyan/glow/chip persen. Uang panjang tetap utuh (harga `whitespace-nowrap`, baris flex-wrap).
- **Bahasa & mata uang (PreferenceControls):** satu tombol bendera bulat 44px di header semua lebar (setelah pencarian/nav, sebelum Keranjang; caret kecil ≥sm) membuka satu menu popover ringkas (`w-[min(320px,calc(100vw-1.5rem))]`, bukan bottom sheet) dengan dua bagian independen berradio native: Bahasa ([bendera ID] Bahasa Indonesia, [bendera GB] English (UK)) dan Mata uang ("Rp · Rupiah (IDR)", "US$ · US Dollar (USD)"), ✓ pada baris terpilih (bukan warna saja), baris 44px, satu catatan "Pesanan yang sudah dibuat tidak berubah." (+ catatan Rupiah jujur bila USD tak tersedia). Tanpa nilai efektif: ikon globe netral dan tanpa centang (bendera tak pernah ditebak). Memilih bahasa tidak mengubah mata uang; Escape/klik luar menutup dan fokus kembali. Baris footer + bottom sheet dihapus. Panel memakai `role="dialog"` (bukan `menu`) agar radio native tetap valid.
- **Catatan pesanan crypto dipangkas:** dua baris saja di halaman pesanan — amber "Kirim tepat jumlah, aset, dan jaringan di atas. Salah jaringan dapat membuat dana hilang." dan muted "Biaya penyedia & gas di luar nominal; pembayaran kurang/terlambat diperiksa manual." + satu baris "Metode pembayaran tidak bisa diganti…". Persetujuan gateway: intro panel ganda dihapus (subjudul halaman tetap); validasi, redaksi tautan/VA sebelum persetujuan, dan kasus 409 tidak berubah.
- **Aset bendera:** `public/flags/id.svg`, `public/flags/gb.svg` dari flag-icons (MIT; https://github.com/lipis/flag-icons, `flags/1x1/id.svg` dan `gb.svg`, diambil 2026-11-05; SVG tanpa script/href/gambar tertanam; lisensi di `public/flags/LICENSE-flag-icons.txt`). Tanpa CDN/SDK/emoji.
- **Pedoman data (snapshot 5 November):** semua metode/biaya/batas berasal dari quote (API merchant); fixture BCA/OVO dst. hanya data uji. Katalog saat snapshot ini belum terverifikasi; bukti akses 6 November dan QA dengan snapshot katalog ada di bagian teratas, bukan bukti aktivasi produksi.

## Revisi visual Opus — grosir, preferensi, pesanan (4 November 2026, implementasi lokal)
(Riwayat: sebagian spesifikasi di bawah digantikan oleh revisi owner 5 November 2026 di atas — tombol teks/baris footer/bottom sheet, picker 3 grup + <details>; baris tier dipulihkan.)
Status 5 November 2026: disetujui review UI pembeli Opus (kondisi logo QRIS dan preferensi seluler terpenuhi); browser nyata 1280/390/360 pada preview lokal lulus; editor admin tidak dirender dan tidak disetujui; belum deploy.

Arahan owner: "jangan ada desain yang terlihat AI SLOP". Tolak grid kartu generik yang saling bertukar, gradien/glow/kaca di semua tempat, kotak bulat besar berulang, badge/ikon/penjelasan yang berulang, hierarki tipe/jarak lemah, mobile sesak dan animasi sembarang. Token Midnight/Cyan/Gold, SF Pro dan Liquid Glass tetap, dengan pengendalian.
- **Baris tier aktif (R1):** tanpa garis biru kiri dan tanpa wash cyan. Aktif = `bg-white/[0.05]`, rentang + harga `font-semibold`, label terlihat "· jumlahmu"/"· your qty"; tidak aktif `font-normal` putih 65%. Tanpa outline/glow/badge baru; `aria-current` dan live region tetap.
- **Bahasa & mata uang (R2, keputusan owner):** tombol teks polos di grup tautan header (≥sm, setelah Artikel, sebelum Keranjang) "Indonesia · IDR" / "English · USD" + chevron seperti Layanan, h-11, tanpa isian sampai hover (di sm–md singkatan "ID · IDR"). Di bawah sm tombol dihapus dari header; titik masuknya baris pertama footer "Bahasa & mata uang — … [Ubah]" (44px) yang membuka panel yang SAMA sebagai bottom sheet (safe-area, tutup 44px). Panel ±320px: dua grup radio native satu baris (Bahasa, Mata uang); terpilih `bg-white/10` + `font-semibold` + centang (bukan warna saja), tanpa border cyan, tanpa kode ganda di kanan, tanpa Tutup di desktop. "Dipilih otomatis" hanya bila belum ada cookie; satu catatan pesanan lama; catatan Rupiah jujur bila USD dipilih tetapi konversi server tidak ada.
- **Total tidak diulang (R3):** QuickVariantModal tanpa "Total" di bawah Jumlah; footer hanya "hemat …", total di CTA; ringkasan "Lihat harga grosir" memakai chevron disclosure. PDP: meta stok/total/hemat di barisnya sendiri di bawah stepper, segmen uang `whitespace-nowrap`. Footer keranjang hanya "Total final dikonfirmasi di checkout".
- **Halaman pesanan (R7–R9):** alamat crypto selebar blok di bawah sm lalu tombol salin (jaringan tampil "BSC", nilai yang disalin tidak berubah); kalimat konfirmasi dan intro persiapan hanya sekali (subjudul halaman); baris kode kanal mentah (mis. BCA_VA) dihapus; ringkasan/total/tautan/bantuan/catatan kaki mengikuti locale pesanan tersimpan; "Layanan" Market mengikuti locale tampilan (Pedia tidak berubah).
- **Pengingat/perangkat/lacak (R10–R12):** judul pengingat consent "Setujui total pembayaran" tanpa dipotong, tutup 44×44; pil "belum dibayar" satu baris tanpa chip hitungan; "Lacak pesanan lain" memindahkan fokus ke `#track-code` setelah form dirender ulang (kode/kontak tidak direset).
- **Picker checkout (R4–R6, brief Opus berbasis 4 screenshot referensi Sekalipay, lokal):** satu grup radio `checkout-pay`, urutan QRIS (tanpa label, default, satu badge "Paling cepat"/"Fastest") → "Transfer bank & e-wallet" → "Crypto". SEMUA metode memakai satu anatomi kartu kaca QRIS (`PayOptionCard`): `grid-cols-[56px_minmax(0,1fr)_auto_20px]`, min-h 64px, satu kolom di semua lebar; kolom: pelat logo 56×36 | nama (maks 2 baris) + meta | jumlah kanan (nowrap) + caption | titik radio. Terpilih = border `#00E5FF/50` + titik radio saja (tanpa wash/glow/garis kiri); kontainer grup berborder dan grid 2 kolom dihapus. Gateway: nama server, meta "Biaya est. +Rp …", kanan "Rp total" + "est. total"; `sublabel` server tidak dirender. Crypto (multi-koin, 5 November 2026, lokal; label biaya generik 7 November 2026): satu kartu per koin — nama "<simbol> · <label jaringan>" (mis. "USDT · BNB Smart Chain"), meta "Termasuk biaya layanan crypto" (tanpa persen sejak biaya per koin 7 November 2026), kanan "US$<total>" + "+ biaya jaringan", logo koin `/payments/coins/<ticker>.svg`; koin di bawah minimum provider nonaktif dengan "Min. US$…" dan alasan (lantai US$2 AXVARA dihapus 7 November 2026); kurs + baris biaya layanan di ringkasan. Catatan: satu baris di bawah gateway (total akhir disetujui di halaman pesanan), di bawah crypto satu baris amber (biaya penyedia belum diketahui, bukan nol + gas pengirim; terlihat sebelum memilih, tidak pernah di dalam disclosure) + satu baris muted (alamat/nominal final di halaman pesanan). Dihapus: baris hijau metode terpilih, blok crypto 3 paragraf, paragraf gateway ganda, caption CTA crypto. Gateway ≤4: semua kartu; >4: 3 kartu + `<details>` native "Lihat N metode lain" (min-h-11; chip logo hanya untuk logo terverifikasi) yang otomatis terbuka bila pilihan ada di dalamnya. Dari referensi hanya struktur/hierarki/pengenalan logo yang diambil (bukan tema putih, merek, biaya/limit, rail kartu/paylater, atau grid 3 kolom); hanya metode yang ditawarkan server.

### Payment logos (4–6 November 2026)
Logo hanya menghiasi dan mengenali metode; nama teks tetap label aksesibel (`alt=""`, `aria-hidden`). Hanya berkas lokal (tanpa hotlink/SDK), di pelat putih; SVG disanitasi (tanpa script, atribut `on*`, href/url eksternal, gambar tertanam, komentar generator) dan dicek tes. Kode: `src/lib/payments/method-logos.ts`.

**Penyesuaian presentasi:** merek gateway dikenali dari LABEL tampilan server, bukan `payment_code`. Label dinormalisasi (trim, huruf kecil, spasi tunggal) lalu dicocokkan PERSIS dengan daftar berhingga, termasuk label Alternative/Realtime yang terverifikasi pada snapshot merchant 6 November; tanpa fuzzy/substring. Label tidak dikenal/ambigu atau ID yang kebetulan memuat nama bank tetap memakai monogram netral di baris gateway. Ini murni dekorasi: tidak mengubah ID bertanda tangan, routing, atau opsi yang ditawarkan, dan tidak mengaktifkan kanal produksi. Logo koin tetap dari katalog kurasi dengan ID/ticker yang cocok.

| file | merek | sumber/lisensi (baris Commons lama: Public domain) | diambil |
|---|---|---|---|
| `public/brand/qris.svg` | QRIS | aset existing repo (mono putih untuk latar gelap; di pelat putih picker digelapkan dengan `brightness-0` — jangan ubah asetnya, dipakai juga di halaman pesanan gelap) | sebelumnya |
| `public/payments/usdt.png` (96×96, ±5 KB) | Tether USDT | https://commons.wikimedia.org/wiki/File:USDT_Logo.png | 2026-11-04 |
| `public/payments/bca.svg` | BCA | https://commons.wikimedia.org/wiki/File:Bank_Central_Asia.svg | 2026-11-04 |
| `public/payments/bri.svg` | BRI | https://commons.wikimedia.org/wiki/File:BANK_BRI_logo.svg | 2026-11-04 |
| `public/payments/mandiri.svg` | Mandiri | https://commons.wikimedia.org/wiki/File:Bank_Mandiri_logo_2016.svg | 2026-11-04 |
| `public/payments/bni.svg` | BNI | https://commons.wikimedia.org/wiki/File:Bank_Negara_Indonesia_logo_(2004).svg | 2026-11-04 |
| `public/payments/permata.svg` | Permata Bank | https://commons.wikimedia.org/wiki/File:Permata_Bank_(2024).svg | 2026-11-04 |
| `public/payments/cimb-niaga.svg` | CIMB Niaga | https://commons.wikimedia.org/wiki/File:CIMB_Niaga_logo.svg | 2026-11-04 |
| `public/payments/danamon.svg` | Danamon | https://commons.wikimedia.org/wiki/File:Danamon_MUFG.svg | 2026-11-04 |
| `public/payments/bsi.svg` | BSI | https://commons.wikimedia.org/wiki/File:Bank_Syariah_Indonesia.svg | 2026-11-04 |
| `public/payments/seabank.svg` | SeaBank | https://commons.wikimedia.org/wiki/File:SeaBank.svg | 2026-11-04 |
| `public/payments/gopay.svg` | GoPay | https://commons.wikimedia.org/wiki/File:GoPay_logo.svg | 2026-11-04 |
| `public/payments/ovo.svg` | OVO | https://commons.wikimedia.org/wiki/File:Logo_ovo_purple.svg | 2026-11-04 |
| `public/payments/linkaja.svg` | LinkAja | https://commons.wikimedia.org/wiki/File:LinkAja.svg | 2026-11-04 |
| `public/payments/shopeepay.svg` | ShopeePay | Situs resmi: https://shopeepay.co.id/assets/spp-logo-C03WIzdh.svg ; merek pemilik, penggunaan nominatif, salinan SVG tanpa modifikasi | 2026-11-06 |
| `public/payments/dana.svg` | DANA | https://commons.wikimedia.org/wiki/File:Logo_dana_blue.svg ; sumber/author dana.id, unggahan Yellbuck; PD-textlogo dan CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/); salinan SVG tanpa modifikasi | 2026-11-06 |
| `public/payments/bnc.webp` | Bank Neo Commerce (BNC) | Situs resmi: https://www-cms.bankneo.co.id/storage/photos/1/logo/logo_bnc.png ; merek pemilik, penggunaan nominatif | 2026-11-06 |
| `public/payments/virgo.webp` | Virgo | Situs resmi: https://virgoku.id/wp-content/uploads/2021/09/LOGO-VIRGO-FINAL-02-1024x537.png ; merek pemilik, penggunaan nominatif | 2026-11-06 |
| `public/payments/astrapay.webp` | AstraPay | Situs resmi: https://astrapay.com/static-assets/images/logos/logo-colorful.png ; merek pemilik, penggunaan nominatif | 2026-11-06 |

Merek dagang tetap milik pemiliknya dan dipakai nominatif. PNG resmi BNC/Virgo/AstraPay memakai versi berwarna untuk latar putih, dipangkas margin kosong, diperkecil maksimal 256×80, lalu dikonversi WebP lossless (masing-masing <5 KB); bentuk/warna logo tidak digambar ulang. SPayLater, "Bank Transfer Lainnya" dan label ambigu tetap tanpa logo merek lain. Danamon memakai versi `Danamon_MUFG.svg` tanpa gambar raster tertanam.

## Harga grosir dan pembayaran web — integrasi lokal 4 November 2026

Status: kode terintegrasi lokal, belum dipublikasikan atau diterima melalui review Opus; QA browser main memakai D1 lokal dan fixture respons API, bukan bukti flow produksi. Midnight/Cyan/Gold dan komponen Liquid Glass existing tetap dipakai.

- Admin: `BulkTierEditor` di editor varian memakai disclosure, input berlabel, maksimal lima tingkat, validasi, fokus error, konfirmasi hapus tingkat terakhir dan draft yang dipertahankan saat gagal; setting tak disentuh tidak dikirim.
- Pembeli: `BulkPriceTiers` pada PDP/beli cepat dan ringkasan keranjang menampilkan estimasi all-units per varian; stok dan batas unik tetap berlaku. Checkout memakai quote server, `expected_price` tetap harga dasar dan perubahan tier nyata memakai dialog persetujuan harga.
- `PaymentMethodPicker` menampilkan opsi bertanda tangan quote, QRIS default bila tersedia; `GatewayPaymentPanel` dan lookup/resume menampilkan consent fee, nominal dan status server. Link/VA/alamat disembunyikan pada review/expired dan sebelum consent sesuai kontrak view; kontak/PIN/proof tidak ditempatkan di URL.
- `PreferenceControls` mengatur bahasa ID/EN dan mata uang IDR/USD secara independen. Default otomatis diresolusikan server tanpa menulis cookie; pilihan eksplisit disimpan terpisah. `DisplayPreferencesProvider` dan `Price` menggunakan sen USD dari server untuk katalog/PDP/keranjang, batching jumlah; kurs tidak dihitung di klien. FX tidak tersedia → IDR dengan penjelasan jujur. Nama/deskripsi/S&K milik penjual tidak diterjemahkan.
- Radio native, fokus dan kontrol min 44px digunakan pada area terkait; state loading/fallback tidak menghalangi keranjang. QA browser main bersifat parsial; review aksesibilitas dan seluruh UI oleh Opus masih diperlukan.

## Chip layanan Pedia mobile - 3 November 2026

Implementasi lokal; publikasi lewat CI, deployment belum diverifikasi. Keputusan
owner: chip desktop (sm, 640px ke atas) tidak berubah. Di bawah 640px, daftar
layanan (`ServicePicker`, prop `compact` pada `ServiceChips`) dibuat ringkas agar
chip muat satu baris: chip wilayah disembunyikan bila nama layanan sudah memuat
Global/Indonesia, label dipersingkat (`Refill 365 Days` jadi `Refill 365D`,
`Instant Start` jadi `Instant`, `Avg 1 jam 25 menit` jadi `±1j 25m`, `Start 0–2 jam`
jadi `Start 0–2j`, `100% sukses` jadi ikon centang + `100%`), dan baris chip mulai
dari tepi kiri kartu (di bawah radio). Label penuh tetap tersedia untuk pembaca layar
(`max-sm:sr-only`). Bila masih kepanjangan, chip tetap turun baris (tanpa dipotong).
Ringkasan pesanan tetap memakai label penuh.

## Copy layanan Pedia - 3 November 2026

Implementasi lokal; deployment belum diverifikasi. Token, font, dan chip netral
existing dipertahankan. Chip `Instant Start` (ikon petir lucide `Zap`, kelas chip
netral yang sama) muncul di kartu layanan dan ringkasan bila nama layanan memuat
segmen itu; chip waktu tidak ditampilkan meskipun `eta_start` atau fallback tersedia.
Layanan tanpa Instant Start tetap menampilkan chip waktu yang tersedia. Nama layanan
tampil tanpa segmen itu. Info layanan mengikuti kata kualitas dan
keterangan pada nama (Real, Real Look, Real People, Real Human, HQ, Campuran, Akun
berpostingan, Akun lama, Instant Start). Halaman pesanan memakai satu blok Refill
bergaya kartu glass dengan satu tombol utama cyan; tombol nonaktif (opacity45) saat
belum bisa diajukan dan tautan panduan sekunder. Perlu pemeriksaan browser desktop/mobile
pada pohon final.

## Status pesanan Pedia yang jujur — 2 November 2026

Implementasi lokal; deployment belum diverifikasi. Perbaikan, bukan redesain:
token Midnight/Cyan/Gold, font, kartu glass, QRIS, timeline, refill dan batal
tetap. Logika tampilan murni di `src/components/pedia/status-view.ts`.

- Halaman pembeli `/pesanan/[code]` di host Pedia: judul + pill mengikuti status
  Pedia aktual (Pembayaran Diterima, Pesanan Diproses, Pesanan Berjalan, Pesanan
  Selesai, Selesai Sebagian, Dibatalkan, Sedang Dicek) lewat `StatusPill`, bukan pill hijau
  “Lunas — Terdeteksi Otomatis”. Waktu bayar menjadi baris sekunder (tetap tampil bila layanan dibatalkan sesudah bayar; batal pembeli sebelum bayar tanpa baris Lunas)
  `text-[11px] text-white/50` (“Lunas · tanggal WIB”). Pill dibungkus
  `role="status" aria-live="polite"` agar perubahan status diumumkan sekali.
- Ringkasan: Layanan (produk · nama layanan snapshot publik), Jumlah dipesan,
  Link tujuan, Refill. Kartu progres memuat empat sel: Jumlah awal, Dipesan,
  Sisa, Masuk (grid 2 kolom mobile, 4 kolom mulai sm). Angka tidak
  diketahui tampil “Belum dilaporkan”, bukan 0. Bar progres dengan
  `role="progressbar"` hanya ada bila jumlah masuk terkonfirmasi; selain itu
  teks “Jumlah masuk belum dikonfirmasi”. 100% hanya untuk status selesai terkonfirmasi.
- Estimasi hanya `eta_finish`, atau `eta_start` sebelum progres berjalan; tanpa
  hitungan jam dari avg_time/kecepatan. Baris kesegaran `text-[11px] text-white/35`:
  “Diperbarui HH.MM.DD WIB · otomatis tiap N detik” (5/10/30 detik), ditambah
  “pembaruan terakhir gagal” saat refresh gagal tanpa menyembunyikan data
  terakhir; hilang pada status akhir. Tidak ada animasi baru.
- Admin Pesanan: baris Pedia memakai chip “Pedia” (gaya ChannelBadge) dan chip
  status Pedia (hanya pesanan lunas; item belum terbaca = “Status belum diketahui”
  netral; pesanan Pedia pending hanya berlabel “Menunggu pembayaran QRIS” tanpa tombol ACC/Tolak/Batalkan karena API admin menolak kode AXP). Tanpa `FulfillmentBadge`, tombol/dialog Kirim ke pembeli, atau widget
  kredensial/PIN Market. Jumlah memakai quantity Pedia (bukan ×1); needs_check/
  partial/canceled menautkan ke Admin → Pedia → Pesanan (tombol min-h 44px di mobile).
- Pintu masuk Market: `/pesanan/AXP-…` dialihkan ke `pedia.axvara.tech/pesanan/<kode>`
  sebelum fetch; `/lacak-pesanan` mengenali AXP (petunjuk + tautan “Lacak di Pedia →”,
  tanpa lookup Market) dan deep link `?code=AXP-…` dialihkan tanpa kontak. Respons
  lookup bertipe Pedia hanya menampilkan satu kartu penunjuk, tanpa STEPS, garansi
  atau kredensial. Verifikasi browser nyata desktop/mobile menunggu QA final.
- Email lifecycle Pedia (paid/processing/completed) memakai shell Market
  `renderBrandedNotice` yang sama (header Midnight + logo, badge invoice,
  pill STATUS info/success, kotak detail cyan, CTA "Lihat Status Pesanan →",
  blok WA hijau, footer; teks alternatif selalu ada). Field baru
  `status`/`details`/`ctaLabel` bersifat opsional — tanpa opsi, output
  Market byte-identik. Completed memakai istilah `Refill N Days`, bukan
  "masa garansi". Fixture aktual dari renderer produksi ada di artefak tim
  `email-qa/actual-*` (bukti kerja, bukan kontrak repo); QA rendering
  Chromium 320/390/640 lulus 316 pemeriksaan; klien email native belum diuji.

## Varian Market, promosi responsif dan label layanan - 2 November 2026

Implementasi lokal; deployment belum diverifikasi. Midnight/Cyan/Liquid Glass
dan font existing tetap. PDP multi-varian menampilkan identitas pilihan lengkap
tanpa truncate, dengan tombol sekunder Pilih/Ganti varian44px; identitas pilihan
aktif dan tombol sejajar pada mobile agar tidak bersaing dengan CTA beli. Hanya identitas
yang memakai live region polite, bukan keseluruhan S&K panjang. Harga/keranjang/
checkout dan copy mengikuti satu state. Koreksi owner2November: Deskripsi umum
tampil dulu, lalu S&K/aktivasi varian (mobile dan desktop); ketentuan dari
deskripsi tetap berlabel Ketentuan produk.

Koreksi owner2November: kartu promo Market dan Pedia selalu kanan-kiri (dua
kolom) di semua lebar, tidak ditumpuk. Ikon28px mobile/36px mulai sm, padding/
gap mobile dirapatkan dan panah hanya tampil mulai sm agar judul muat; tinggi
minimal64px, judul wrap utuh tanpa elipsis (di320px boleh dua baris).
Produk Serupa memakai lebar156px mobile/260px mulai sm; mulai sm kategori11px,
judul15px/min40px, harga17px, metadata12px dan padding14px. Kartu katalog normal
tidak berubah. Dropdown Market/Pedia menampilkan Layanan satu baris di seluruh
breakpoint, tetap44px, fokus cyan dan nama aksesibel Layanan AXVARA.

Copy pengiriman Jaspay memakai Diproses otomatis dan keterangan waktu mengikuti
antrean, bukan proses admin/manual atau stok instan; visual badge existing tetap.

## Panel informasi Pedia terpadu - 2 November 2026

Implementasi lokal; deployment belum diverifikasi. Pertahankan panel cyan/glass
inline di bawah pilihan, font dan token existing. Urutan: deskripsi karakter,
penjelasan HQ/Real, Refill/drop, Syarat khusus, Pengajuan Refill 7 hari, lalu
disclosure Arti istilah. Revisi 2 Nov: grid angka (dua kolom mobile/tiga mulai sm)
+ satu caption estimasi dipindah ke paling atas kartu, dipisah garis dari judul
Info layanan; teks definisi ringkas tanpa peringatan berulang. Deskripsi di
ringkasan dan kartu Detail layanan terpilih dihapus; copy produk khusus berpindah
ke panel. Sebelum memilih, Tentang layanan hanya untuk copy non-boilerplate.
Tidak ada syarat khusus yang disembunyikan pada mobile. Radio mengacu panel
melalui aria-describedby; summary native dan tautan bantuan memiliki hit area44px,
summary memakai fokus cyan. Persentase refill netral, tanpa label risiko drop.

## Orbit Pedia mobile dan satu tombol hapus — koreksi 31 Oktober 2026

Implementasi lokal untuk publikasi CI, menggantikan orbit desktop-only16Oktober.
Hero Pedia memakai satu orbit: tengah di bawah teks pada mobile/tablet, kanan mulai
lg; jarak tambahan24px sebelum orbit mobile mengikuti Market. Container memotong
dekorasi di tepi tanpa menambah overflow halaman. Mesin lite8planet/24fps serta
reduced-motion existing tetap. Navbar kedua layanan menyembunyikan hanya cancel
bawaan browser pada input search; X putih custom, fokus, semantik searchbox tetap.

## Aksesibilitas storefront dan motion — 31 Oktober 2026

Implementasi lokal untuk publikasi CI. Midnight/Cyan/Gold dan font existing tetap.
Kontrol keranjang tutup/tambah/kurangi/hapus memiliki hit area44px, ring fokus cyan
dan nama aksesibel produk+varian. Label terjual serta harga coret memakai putih65%
(kontras terhitung sekitar7,5–8,1:1 pada gradient kartu existing).
Drawer masuk260ms; drawer, modal varian dan badge keranjang hanya beranimasi pada
motion-safe. Reduced motion meniadakan smooth scroll CSS dan scroll pencarian JS.
Orbit Market/Pedia merespons perubahan preferensi saat terbuka, mempertahankan
posisi statis serta pause offscreen/tab tersembunyi; lite/performance existing tetap.
Anchor katalog berjarak144px mobile (termasuk pencarian terbuka),80px mulai lg.
Gagal harga Pedia tampil inline dengan live status polite dan tombol coba ulang
minimal44px; fokus keyboard dan pilihan pembeli tetap, tanpa dialog baru.

## Form akses kredensial, 28 Oktober 2026

✅ Implementasi lokal untuk publikasi CI. During, ENERGY2/RHYTHM2/MOTION1 mengikuti
Midnight/Cyan AXVARA. Kartu tampilan/salin PIN di atas pembayaran dihapus. Halaman
checkout hanya memuat pembayaran dan status pesanan, tanpa PIN atau salinan PIN.

Form lacak memisahkan invoice, email/WA dan PIN. Kontak wajib untuk status;
teks helper di bawah ketiga field dihapus, pesan validasi tetap tampil saat salah.
Label PIN: "PIN akses (didapat di email yang diisi saat checkout)".
PIN dari email dipakai untuk membuka kredensial, tipe password dan tanpa tombol
salin/reveal. Panel kredensial memakai isian kontak dan PIN dalam satu form yang
mengikuti komponen existing, label terikat input, aksi submit jelas dan dukungan
Enter. Loading, error generik dan status belum siap tetap terlihat. Target44px,
focus cyan, hint/placeholder kontras AA, reflow satu kolom pada ponsel.

Tab checkout asli otomatis menampilkan akun sesudah paid/ready, tanpa tindakan
PIN. Komponen yang sama memakai loading existing lalu isi akun; tidak menambah
kartu, badge atau langkah konfirmasi. Form kontak+PIN tetap untuk akses tanpa
bukti checkout asli, termasuk lewat lacak/perangkat lain.

Email produk siap tetap menampilkan kredensial langsung. PIN ditempatkan ringkas
sebagai informasi akses tambahan dalam struktur email AXVARA existing, tidak
memakai kartu promosi, glow atau panel PIN tersendiri. Logo/token warna existing,
tanpa aset baru. PIN hanya diketik di web oleh pembeli setelah menerima email.

## Invoice WR hilang setelah timeout — 27 Oktober 2026

✅ Implementasi lokal, publikasi CI. Baris supplier WR tanpa invoice pada status
submitted/ordering/claimed memuat form inline berlabel **Invoice WR yang telah
diverifikasi**, tombol **Hubungkan invoice WR**, dan petunjuk memilih invoice
milik pesanan, bukan menebak dari nama/waktu. Midnight/cyan existing, field/tombol
minimal44px, flex-wrap pada mobile, label terikat input, required/pattern/max120,
focus ring cyan dan disabled selama request. Tidak memakai dialog prompt atau
menambah tombol pembelian. Link berinvoice memakai Cek status existing.

## Perbandingan layanan Pedia — 27 Oktober 2026

✅ Implementasi; publikasi melalui CI. [Spesifikasi desain/UX](pedia/purchase-ux-2026-10-27.md)
menggantikan konfigurator20–22 Oktober. ENERGY2/RHYTHM2/MOTION1: Midnight dan cyan
tetap, logo/siluet platform di header serta ringkasan dipertahankan. Area kebutuhan
selebar konten; pill44px, teks13px, ikon15px, aktif cyan tanpa glow ungu. Desktop
membungkus kebutuhan; mobile dapat digulir dan dibuka dengan “Semua kebutuhan”.

Daftar menggunakan baris radius12px, harga sejajar judul, metadata13px; pilihan
aktif latar#101E30/border cyan1px/radio/label Dipilih. Deskripsi panjang berada di
ringkasan, syarat terbuka setelah perbandingan; tidak ada accordion konfigurator.
Grid dua kolom baru mulai1280px agar daftar tidak terjepit pada tablet/laptop
1024px. Rail340px memuat total+CTA dan sticky hanya jika muat tinggi viewport.
Mobile satu kolom, CTA fixed dengan safe-area; viewport≤480px tinggi memakai CTA
dalam alur. Fokus keyboard cyan2px, teks bantu utama65% putih, radio/batas input
diperjelas. Tidak membuat aset atau klaim kualitas layanan baru.

## Panel Siaran dan sambutan WA — 24 Oktober 2026

✅ Menu Konten → Siaran mengikuti Midnight/Cyan/Liquid Glass existing: pustaka
kiri280px dan editor kanan pada desktop, bertumpuk pada mobile. Tombol minimal44px,
input berlabel, pratinjau teks literal, penghitung3000 karakter dan CTA opsional.
Pemilihan tujuan eksplisit memakai checkbox; editor kotor harus disimpan atau
dibatalkan sebelum Tinjau. Panel konfirmasi merinci jumlah penerima dan bot WA.
Tidak ada kanal terpilih otomatis. Template tersimpan bisa disalin/diarsip/restore;
riwayat berupa kartu dengan progres per kanal, status ambigu “Perlu diperiksa”,
refresh manual dan dialog Hentikan. Status subscriber berhenti memakai badge netral.

Sambutan mempertahankan bingkai `━━━━━━━━━━━━━━━━━━━━`, judul perayaan, sapaan
waktu WIB dan nama yang tersedia (tanpa nomor sebagai pengganti nama). Deskripsi
layanan dan blok Order via website / Order via Telegram / Bantuan Admin dipisah
baris kosong serta garis; WhatsApp bold dipakai pada judul/label/nama. Tidak ada
instruksi order WA, ketik list/garansi atau respons otomatis pada chat biasa.

## Pengaturan grup dan akses pesanan admin — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Pengaturan Toko menambah input berlabel
**Link grup WhatsApp** dengan petunjuk satu tautan untuk Footer/Link Bio, memakai
gaya field/glass existing dan satu tombol Simpan Pengaturan existing. Card
notifikasi grup di bawahnya memuat nomor/grup, status koneksi/aktif, pesan error,
kode pairing sementara dan tiga aksi Hubungkan/Cek koneksi/Aktifkan atau Nonaktifkan.
Kode pairing tampil hanya bagi admin, bukan log. Layout flex-wrap responsif,
sentuhan minimal44px, status jeda berwarna amber; tidak mengganti token brand.

Revisi24Oktober: nomor/status/petunjuk pairing mengikuti nomor gateway, bukan teks
tetap. Tombol **Ganti nomor bot** membuka form inline berlabel **Nomor WhatsApp bot
baru**, input tel, contoh628…/08…, penjelasan pemutusan sesi dan aktivasi ulang,
tombol **Simpan nomor bot** serta **Batal ganti nomor**. Form tetap memakai glass,
field midnight dan CTA cyan, lebar maksimalxl, aksi wrap dan tinggi sentuh44px.
Tombol simpan mati untuk input tidak valid/nomor sama/permintaan berjalan; kontrol
bergantung gateway siap. Kode pairing lama dibersihkan saat sesi berubah atau
hasil pergantian belum pasti. Status aktif hanya untuk nomor dan revisi sesi yang
telah diaktifkan; nomor admin toko tidak ikut berubah.
Saat gateway tidak tersedia, nomor ditampilkan belum tersedia dan kode pairing
disembunyikan; nomor aktivasi lama bukan bukti nomor gateway yang sedang dipilih.

Lacak pesanan `admin=1` menampilkan petunjuk sesi admin, tautan masuk panel dan
muat ulang; formulir kontak serta riwayat buyer tidak ditampilkan. Detail/timeline
memakai komponen existing. Ketika sesi ditolak, detail dikosongkan dan pesan login
ditampilkan. Tombol Telegram **Lihat pesanan pembeli** berada bersama aksi admin
existing. Notifikasi publik WA memakai teks ringkas/emoji, status selesai serta
jam WIB, tanpa tombol akses/invoice rahasia.

Obscura1440/390 menguji komponen aktual dengan fixture inert, perubahan dua href
dari satu input, admin lookup+credentials tanpa kontak, sesi401 dan tanpa overflow
atau JS exception. Nilai input/href diperiksa lewat DOM karena renderer tidak
menggambar semua nilai form dalam PNG. QA bukan bukti koneksi bot produksi.

## Carousel info dan panel terang — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Revisi screenshot owner24Oktober:
kartu maksimal448px/lebar viewport, radius14px, tinggi maksimal92dvh dan scroll
internal untuk materi panjang. Gambar block/w-full/h-auto mengikuti rasio aslinya,
memenuhi sisi kiri/kanan tanpa crop/letterbox, bukan panggung dengan tinggi tetap.
Panah lingkaran gelap transparan menumpang pada gambar di75% tinggi, kiri/kanan8px;
sebelumnya hanya sesudah slide pertama, berikutnya hanya sebelum slide terakhir.
Counter1/2 persis di bawah gambar (padding atas12px), lalu judul/deskripsi rata tengah.
Judul memakai tinggi alami tanpa ruang minimum; deskripsi berjarak8px sesudah judul,
termasuk bila judul membungkus menjadi beberapa baris.
Panel bawah putih#FFFFFF, teks midnight/gray500, tanpa garis pemisah. Checkbox kotak
abu dan label dipusatkan di atas CTA biru#315DEA selebar panel, tinggi minimal44px,
radius6px, teks putih16px; bila CTA kosong tombol Saya Paham menutup popup.
Sesuai owner, tidak ada tombol putar/jeda. Gambar hanya memiliki panah dan tutup;
autoplay mengikuti pengaturan admin dan berhenti ketika pembaca berinteraksi.
Pergantian slide memakai dissolve420ms ease-apple dengan blur tipis2px dan geseran
12px sesuai arah. Elemen slide lama tetap sebagai lapisan dasar sampai gambar tujuan siap
dan transisi selesai; tinggi konten ikut bertransisi agar kartu tidak meloncat.
Tidak mengaburkan backdrop atau tombol tutup lebih jauh. Reduced motion meniadakan
animasi/blur transisi serta autoplay.

Admin memakai drag handle/tombol naik-turun, placeholder baris saat drag, overlay dan
transisi sortable existing. Panel pengaturan bersama memakai satuan detik dan input
berlabel. Acuan carousel Sekalipay dari screenshot owner; prinsip kontrol gerak/fokus
mengikuti [W3C carousel](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/) dan
[tutorial animasi](https://www.w3.org/WAI/tutorials/carousels/animations/). Durasi420ms/
interval6detik adalah keputusan desain AXVARA, bukan spesifikasi internal Sekalipay.


## Tindak lanjut Pedia dan pemulihan checkout — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Tahap Kontak tanpa input kredit;
status partial/canceled menampilkan pesan penyelesaian manual dan Hub WA berisi
kode order. Jumlah terkirim unknown ditulis belum dikonfirmasi, bukan 0 terkirim.
Tautan status Pedia yang belum terverifikasi menampilkan form WA/email checkout.
Admin mengganti penerbitan kredit dengan Arsip lama baca-saja, serta catatan
Perlu tindak lanjut/Selesai ditangani. Tetap memakai token Liquid Glass existing,
label/fokus keyboard dan reduced motion. Ketentuan kredit pada snapshot desain
Pedia sebelumnya digantikan [spec 24 Oktober](pedia/manual-resolution-2026-10-24.md).
Lacak memperbarui progres seluruh akun tanpa menggulir ulang pengguna; pemulihan
minimum checkout menyasar varian tepat dan menyediakan jalan kembali yang berfungsi.


Admin menampilkan indikator Memuat untuk section yang diambil saat dibuka.
Dialog minimum menyediakan Sesuaikan ke minimum untuk keranjang dan beli langsung;
Ubah manual tetap di keranjang, Kembali belanja pada beli langsung menuju katalog.

## Status multi-akun dan kesegaran Pedia — 23 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Panel kredensial mempertahankan
Liquid Glass dan menampilkan “N dari M akun siap” untuk pesanan beberapa stok
unik. Setiap akun memiliki label “Akun N dari M” serta tombol Salin akun N;
isi akun tetap literal/escaped. S&K dan aktivasi identik ditampilkan sekali.
Saat unit baru siap, akses token memuat ulang isi tanpa menggulir pengguna
kembali atau membuka informasi tanpa verifikasi. Ringkasan belanja tetap
satu baris per produk/varian dengan qty aslinya. Stepper web/mobile dan
Telegram membatasi total sepuluh akun unik. Pedia memperbarui QR/status
lima/sepuluh detik saat terlihat dan menyusul saat tab dibuka; tampilan, QR,
countdown server dan aturan reduced motion dipertahankan.



## Animasi drag kredensial — 2026-10-23

Revisi mengganti preview native yang hanya menampilkan pegangan. Gunakan kartu penuh mengambang dengan border cyan/shadow; portal body menjaga preview bebas clipping/transform modal. Baris sekitar bergerak via transform 220ms cubic-bezier(0.2,0.8,0.2,1); slot tujuan berupa ghost dashed cyan, garis sisipan dan nomor urutan. Drop bergerak ke slot selama220ms. Auto-scroll hanya list, zona tepi25% vertikal, kecepatan mengikuti kedekatan tepi. Pegangan min27px/touch-action:none; isi tetap dapat digulir normal. Reduced motion mematikan transisi dan animasi drop. Referensi: [dnd-kit Sortable/DragOverlay](https://dndkit.com/legacy/presets/sortable/overview/), [Atlassian design guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines). Detail implementasi/verifikasi: [credential drag motion](admin/credential-drag-motion.md).

## Prioritas kredensial unik — 2026-10-23

Panel Detail akses produk memakai pegangan GripVertical, nomor posisi cyan dan panah naik/turun pada tiap baris stok tersedia. Drag & drop langsung menyimpan urutan; baris yang ditarik meredup dengan latar cyan, kontrol nonaktif selama penyimpanan, panah batas awal/akhir nonaktif. Label aksesibel menyebut aksi dan posisi; panah mendukung keyboard. Teks bantuan menjelaskan bahwa urutan teratas dikirim lebih dulu dan tersimpan langsung. Gagal simpan mengembalikan daftar server serta toast error. Tetap memakai token warna/spacing panel existing; tidak menampilkan kredensial di luar admin.


## Penyederhanaan pilihan layanan Pedia — 22 Oktober 2026

Revisi logo platform 2 November 2026 (glyph dipublikasi CI commit `7774b0c`): kotak huruf Coub/Lazada/Rutube/SnackVideo diganti glyph logo asli dalam SVG satu warna per platform seperti ikon lain, tanpa background aplikasi, badge atau gradasi. Coub/Rutube putih, Lazada oranye, SnackVideo kuning sesuai registri existing. Medium tetap memakai ikon crop wordmark resmi, bukan logo elipsis lama. Website Traffic tetap globe generik karena bukan merek. Ukuran, layout dan nama aksesibel kartu tidak berubah. Pemetaan 34 platform dan sumber aset ada di `PEDIA-DESIGN.md`, bagian Ikon platform.

Koreksi cache sesudah publikasi glyph commit `7774b0c`: `PlatformIcon` memakai `?v=20261102` pada Coub/Lazada/Rutube/SnackVideo agar CDN/browser tidak menampilkan placeholder lama. Warna, bentuk, ukuran dan aksesibilitas tetap; URL logo lain tidak berubah. Perbaikan URL disiapkan untuk publikasi CI.

Revisi chip layanan Pedia 2 November 2026 (implementasi lokal untuk publikasi CI): chip informasi tetap netral, karena warna hanya untuk Refill (cyan), drop, dan success rate. Teks region/Start naik ke white/85, No Refill ke white/75. Indonesia memakai ikon pin lokasi, Global bola dunia. Tanpa data waktu, chip Start disembunyikan (tidak lagi "Start mengikuti antrean").

Koreksi owner 3 November 2026: paket UX sebelumnya dibatalkan; pilihan jumlah, grup Refill/No Refill tanpa Sorotan, chip waktu/warna dan langkah ringkasan kembali seperti sebelum paket tersebut. Redesign panel deskripsi dipertahankan dan dirapatkan. Penghapusan teks Harga acuan serta hitungan layanan di baris judul tetap berlaku. Implementasi untuk publikasi CI; deployment belum diverifikasi.

Revisi visual info layanan order Pedia 3 November 2026 (implementasi lokal untuk publikasi CI; keputusan owner 3 November): panel info layanan di bawah kartu terpilih (`ServiceInfoCard`) menjadi lembar spesifikasi tenang. Kotak netral (border white/8, bg white/2) menggantikan tint cyan; statistik (Start time, Speed, Avg time, Min / Max, Success rate, dan sel "Pengajuan Refill · 7 hari") baris label–nilai sejajar: satu kolom dengan pembatas tipis di mobile, dua kolom tanpa garis antarstatistik mulai sm (640px; koreksi owner untuk garis desktop yang tidak simetris), sehingga enam statistik tidak terjepit dalam satu baris desktop. Padding mobile 14px horizontal/12px vertikal, nilai 13px (14px mulai sm), teks deskripsi 13px/20px (14px/24px mulai sm); jarak bagian dan syarat khusus dirapatkan tanpa memotong isinya. Catatan estimasi lebih redup; tombol Arti istilah tetap memiliki tinggi minimum 44px. Judul bagian (Info layanan, Syarat khusus) memakai satu gaya label kecil uppercase; deskripsi maks 65 karakter per baris. Refill dan Drop menjadi tabel definisi (dt/dd, label Refill tidak lagi cyan; dua kolom di sm+, label di atas penjelasan di mobile) alih-alih kalimat "Istilah — arti"; blok makna fitur inline (HQ, Akun berpostingan, Instant Start) dan kalimat penjelasan Pengajuan Refill dihapus dari badan panel dan hanya ada di "Arti istilah". Syarat khusus berbutir titik kecil tanpa list-disc; pemisah "Arti istilah" lebih tipis. Teks dan istilah SMM Inggris tidak berubah.

Revisi judul daftar layanan Pedia 3 November 2026 (implementasi lokal untuk publikasi CI): hitungan hasil pindah ke baris judul secara redup — "Pilih layanan · 11 layanan", saat filter aktif "· 4 dari 11 layanan" diikuti Reset filter; "· harga untuk N" dan "Kembali ke pilihan" di baris yang sama. Filter Semua/Global/Indonesia/Refill/No Refill tetap di kanan judul (desktop) dan di bawah judul (mobile). Teks "Harga acuan ditampilkan per layanan…" dihapus. Menggantikan "Hitungan … dan Reset filter berada di atas daftar" (1 November) yang dulunya baris terpisah.

Revisi nama layanan Pedia 2 November 2026 (implementasi lokal untuk publikasi CI): nama seragam [Metrik] [Wilayah] [Kualitas], mis. Followers Indonesia Real, Likes Post Global HQ, Views Reels Global; keterangan bermakna (durasi Live, Referrer, Akun berpostingan) ditambahkan sesudah "·". Refill/No Refill dan drop hanya chip; "Ekonomis", "Max N", "Mulai N" dihapus; nama kembar tidak lagi diberi akhiran refill. Migrasi0089 (generator `scripts/curate-pedia-names-20261102.py`, manifest `src/lib/pedia/names-20261102.json`) mengganti nama dengan guard nama lama dan menonaktifkan layanan kembar: satu per (wilayah, masa refill, kualitas, keterangan), pemenang success rate terukur → jumlah order → modal termurah; 431→280 layanan aktif. Produk komentar menampilkan harga nyata untuk 10 komentar (`price_ref`, rumus quote) alih-alih per 1.000. Harga kartu lain tetap per 1.000: harga 100 unit terkena minimum order Rp1.000 pada 156 dari 408 layanan sehingga tidak bisa dibandingkan.

Revisi filter layanan Pedia 1 November 2026 (implementasi lokal untuk publikasi CI): filter kini Semua/Global/Indonesia/Refill/No Refill. Pilihan layanan yang tidak termasuk filter baru dilepas, tanpa disematkan di atas daftar; teks "Pilihanmu tetap disimpan di atas…" dihapus. Hitungan "N dari M layanan" dan Reset filter berada di atas daftar. Menggantikan aturan 22 Oktober "pemilihan kategori tidak mengganti layanan" dan "hitungan sesudah daftar", serta "pilihan aktif tetap terlihat saat difilter" 27 Oktober.

✅ Implementasi; publikasi melalui CI. Koreksi owner22 Oktober: judul “Apa yang ingin ditingkatkan?” kembali ke ukuran24px/bold semula tanpa garis cyan. Yang diperkecil adalah pill kebutuhan Followers/Likes/dll: tinggi32px, teks12px, ikon13px dan padding12px; permukaan gradasi halus dengan highlight inset, pilihan aktif cyan/violet dan glow tipis. Gulir horizontal serta fokus keyboard tetap, scrollbar visual disembunyikan. Label tombol jumlah memakai `k` kecil untuk ribuan (`1k`, `2k`, `2.5k`); angka di bawah 1.000 tetap utuh, nilai input/perhitungan serta teks batas dan harga memakai angka aslinya. Pengantar panjang jumlah dihapus; batas tampil sesuai min/max layanan terpilih (“Layanan terpilih menerima 100–50.000 per pesanan.”), termasuk kelipatan bila perlu; sebelum memilih layanan ada petunjuk singkat tanpa angka asumsi. “Pilih layanan · harga untuk …” berada di kiri dan filter ringkas di kanan saat muat, bertumpuk pada mobile. Kategori **Semua/Global/Indonesia/Refill** memakai satu state eksklusif: tepat satu pill aktif, klik pill aktif mempertahankannya; Refill berarti semua wilayah dengan refill>0. Pemilihan kategori tidak mengganti layanan atau jumlah. Hitungan hasil, Reset filter dan pengaturan jenis akun/urutan berada sesudah daftar. Beranda, data katalog, validasi batas, quote/consent/retry dan pembayaran tetap.

Tipografi harga 22 Oktober mengikuti AXVARA pusat: harga kartu/daftar layanan Inter bold 700, 14px mobile/17px mulai sm, tracking −0.02em dan line-height 1 tanpa tabular-nums; total ringkasan Space Grotesk bold 700/18px, total ringkas mobile 14px; nominal QRIS/pembayaran diterima Space Grotesk bold 700/24px dengan kelas `leading-8`; line-height aktual mengikuti `.font-display` global seperti pusat. Acuan aktual: ProductCard storefront, total checkout pusat dan nominal QRIS pusat. Ini menggantikan ukuran harga pada redesain 20 Oktober; susunan beranda/checkout, nominal dan format jumlah tetap.


## Redesain alur pembelian Pedia — 20 Oktober 2026

✅ Implementasi; publikasi melalui CI. Keputusan owner: **beranda tetap seperti sebelumnya, tanpa jalan pintas**. Sesudah klik layanan/platform, konfigurator mengikuti referensi “Redesign SMM Panel Purchase Flow”: **Layanan → Target → Kontak → Bayar**. Kebutuhan pertama langsung terbuka (deep link mengikuti slug); jumlah/layanan tetap dipilih eksplisit. Tab kebutuhan berikon, perbandingan layanan tetap terbuka, validasi per tahap, ringkasan desktop340px, CTA di dasar panel desktop/fixed mobile dengan safe-area. Link dan checklist produk berada di tahap Target; WA/email, kredit dan consent di tahap Kontak. Kembali mempertahankan isian produk yang sama, tanpa melewati tahap mendatang; setelah POST ambigu semua navigasi langkah terkunci. Preview admin embedded tetap tanpa request harga/order atau kontak.

Halaman pesanan memakai timeline vertikal + progres server dan panel QRIS di kanan desktop/atas mobile (container1000px, rail380px, QR240px), countdown deadline, Simpan QRIS/Cek pembayaran, serta Pesan lagi pada status terminal. Partial/kredit/refill/needs_check dan snapshot lama tetap dilayani. QR/nominal/status berasal dari server, tanpa simulasi atau reset expiry. Kontrak API, quote/consent/retry, supplier IndoSMM untuk order baru, env/cron/ledger tidak berubah. Spesifikasi [redesain pembelian](pedia/purchase-flow-redesign-2026-10-20.md) menggantikan bagian UI checkout/status versi15–19 Oktober di bawah; desain beranda existing dipertahankan.


## Pedia IndoSMM untuk penjualan baru — 20 Oktober 2026

✅ Implementasi; publikasi melalui CI. IndoSMM menjadi supplier tunggal untuk katalog/harga/quote/order baru dan kurasi admin. ProviderSMM dipertahankan untuk retry checkout tersimpan, dispatch/status/refill/recovery historis; quote lama tanpa order perlu memilih ulang sebelum debit/reservasi/invoice. Migrasi 0073 menonaktifkan penjualan ProviderSMM, menambah 53 kebutuhan/61 mapping IndoSMM (termasuk tujuh pengganti) dan 18 platform; owner drafts serta snapshot order lama dipertahankan. Produk premium supplier Canva/Gemini/CapCut dikecualikan. API/description review belum membuktikan kualitas; tanpa order berbayar. Spesifikasi terkini: [IndoSMM 20 Oktober](pedia/indosmm-only-2026-10-20.md).


## Loading dan konfigurator Pedia — 19 Oktober 2026

✅ Implementasi; publikasi melalui CI. `BrandLoader` memakai disk logo tetap, ring cyan di luar yang berputar linear dan pulse lembut seperti referensi ISTA AI. Ring/pulse berhenti pada reduced motion. Ikon kebutuhan mengikuti makna, termasuk repost/quote/bookmark. Alur jumlah → perbandingan → layanan → link/syarat mengurangi total minimum yang sulit dibandingkan; filter ringkas dan rincian pembeda tersedia sebelum pilihan. Tiga pilihan awal, ringkasan desktop/mobile, serta kontak tahap kedua mengikuti [spesifikasi 19 Oktober](pedia/catalog-ux-2026-10-19.md), yang menggantikan konfigurator 16 Oktober. Tab Kurasi memakai pembanding jumlah sama dan draf aman, bukan label mutu yang belum diuji.

## QRIS gateway KlikQRIS — 2026-10-18

Deteksi lunas cepat 2026-10-18: teks "Batas bayar otomatis 15 menit…" di bawah
panel QR halaman pembayaran Market dan Pedia dihapus atas keputusan owner.
Panel tetap menampilkan countdown berlaku, total bayar, tombol Simpan
QRIS/Cek Pembayaran, dan indikator "Mengecek pembayaran otomatis tiap 5 detik"
(Market). Perilaku batas 15 menit dan status kedaluwarsa tidak berubah; tanpa
elemen visual baru.

Koreksi 2026-10-18: order QRIS pending tanpa gambar menampilkan judul **QRIS
belum siap**, penjelasan bahwa pesanan tersimpan dan belum boleh dibayar, serta
CTA cyan **Coba siapkan QRIS** (tinggi 44px, disabled + spinner saat memeriksa).
Respons sukses mengganti panel dengan QR dan total bayar server; respons gagal
mempertahankan pesanan dan menampilkan pesan coba lagi. Kalimat admin akan
memverifikasi bukti tidak dipakai untuk keadaan ini. Tanpa pill/animasi baru.

✅ Diimplementasikan, publikasi melalui CI. Checkout/QR tetap memakai layout AXVARA existing, tanpa overlay atau script Snap pihak ketiga. Banner maintenance disembunyikan pada build rilis `false`. Gambar QR diambil lewat proxy PNG same-origin, Simpan QRIS tetap bekerja. Market/Pedia serta invoice Telegram/WA menjelaskan batas otomatis 15 menit dan pemeriksaan manual bila terlanjur membayar setelah batas. Jangan menyamakan masa QR di gateway (uji 60 menit) dengan batas otomatis AXVARA. Notice dekat QR memakai teks putih 55% berukuran 11–12px/leading relaxed; bukan pill/titik kuning. Countdown dan nominal akhir tetap bersumber ledger server.

Rekonsiliasi admin menambahkan label **KlikQRIS** dan panduan signature + konfirmasi API, dengan URL callback per invoice. Event pembayaran terlambat menampilkan petunjuk penanganan manual; tombol pencocokan nominal DANA/GoPay dan pelunasan paksa tidak ditawarkan untuk event KlikQRIS. Health hanya booleans/nama env, tanpa nilai API key/signature. Riwayat provider lama tetap bisa dibaca dengan label aslinya.

## Pemberitahuan maintenance pembayaran — 2026-10-18

✅ Diimplementasikan, publikasi melalui CI. Banner statis di bawah navbar Market/Pedia memakai latar putih 4%, garis putih 10%, teks putih 80% dan CTA putih **Order manual via WhatsApp**; tanpa titik/pill kuning, animasi, overlay atau countdown. Container 1280px, padding 16px mobile/24–32px desktop, teks dan tombol bertumpuk di mobile dan sejajar mulai `sm`, tap target ≥44px dan fokus cyan. Checkout menampilkan judul **Pembayaran sedang maintenance**, CTA WA serta petunjuk bagi pembeli yang sudah membayar; formulir pembayaran disembunyikan. Pedia tetap mempertahankan daftar jenis layanan dan mengganti formulir sesudah pilihan produk. Banner dan panel menggunakan komponen bersama `shared/PaymentMaintenanceNotice.tsx`; tautan absolut menuju hub WA terpusat agar benar pada kedua host. Bot menampilkan copy yang sama beserta tombol order manual, katalog dan Pesanan saya. Tidak mencantumkan estimasi pemulihan yang belum diketahui.

## Pembaruan Pedia 2026-10-15 — spesifikasi terkini

Revisi konfigurator Pedia 2026-10-16 ✅ implementasi, publikasi melalui CI: header platform bergradasi dari registri publik dengan logo 36/44px, radius 24px; kebutuhan awal berupa kartu berikon, lalu tab pill setelah dipilih. Panel formulir tunggal radius 24px, padding 20/28px, jarak antarbagian 28px; tiga layanan awal berupa baris satu kolom pada mobile/desktop, radio native dengan indikator visual dan fokus cyan, badge rekomendasi emas dari kurasi tersimpan. Pilihan aktif diringkas di semua ukuran. Filter dan detail memakai disclosure; input mobile 16px, kontrol utama minimal 44px. Rail desktop 320px sticky top-24 dengan header brand, total 30px; mobile total+CTA fixed dengan safe-area dan ruang tambahan saat consent. Tidak ada paket otomatis atau klaim kualitas baru.

✅ Implementasi katalog per platform, perluasan dua supplier dan checkout dua tahap tersedia di kode; publikasi melalui push/CI. Spesifikasi serta dasar kurasi lengkap: [Katalog dan checkout Pedia](pedia/catalog-checkout-2026-10-15.md). Bagian berlabel Working-Tree 2026-10-12 di bawah adalah snapshot historis; aturan UI/katalog/checkout terkini mengikuti dokumen rilis ini.

Revisi 2026-10-16: beranda Pedia menampilkan kartu AXVARA Market dan Bot Telegram tepat setelah hero, sebelum katalog platform, pada mobile dan desktop.

Revisi katalog 2026-10-16: teks pengantar di bawah “Pilih platform” dihapus. Pill kategori mengikuti Market (24px mobile/36px mulai `sm`, ikon iOS monokrom, aktif putih/nonaktif glass). Marketplace menampung Shopee, terpisah dari Media sosial. Semua kartu platform memakai logo SVG responsif 48px di mobile/80px mulai `sm` di tengah panel gradasi gelap warna brand seperti GitHub/Website Traffic, membedakan visual Pedia dari tile 3D Market. Berlaku di beranda dan `/pedia/layanan`; gambar legacy R2 di kontrak produk tidak dipakai oleh `PlatformCatalog`.

Revisi skala 2026-10-16 ✅ implementasi, publikasi melalui CI: hero Pedia mengikuti skala Market dengan headline mobile `clamp(32px,9.3vw,40px)` (sekitar 36px pada 390px), tablet 56px dan laptop/desktop `clamp(48px,4.85vw,62px)` agar kolom orbit tetap muat. Container tetap 1280px; padding hero 40/56px atas dan 16px bawah, CTA berjarak 24px dari subjudul, promo tepat sesudah hero dan katalog ber-padding atas 8px. Katalog platform beranda serta `/pedia/layanan` memakai panel 4:3, grid dua kolom sampai tablet/empat mulai 1024px, gap 12px mobile/20px mulai `sm`, radius kartu 16/22px, judul 16/18px dan deskripsi/CTA 12/14px. Orbit tetap hanya desktop; ukuran SVG memakai `PlatformIcon.className` opsional, tanpa perubahan kontrak API, aset atau env produksi.

Revisi animasi desktop 2026-10-16 ✅ implementasi, publikasi melalui CI: layout Pedia memakai `Spotlight` yang sama dengan Market (glow putih/cyan mengikuti cursor), dan beranda Pedia memakai `ScrollRope` yang sama (panjang mengikuti progres scroll, ayunan saat hover/klik). Hook bersama `useDesktopMotion` mengaktifkan keduanya hanya pada lebar ≥768px, `pointer: fine`, `hover: hover` dan tanpa reduced motion. Perubahan media query saat halaman terbuka langsung memperbarui efek; saat nonaktif, kedua dekorasi disembunyikan, listener interaksi/frame dibersihkan dan klik/hover tali tidak dapat menjalankan animasi. Tali tetap khusus beranda; efek menggunakan pembaruan berbasis interaksi dan berhenti setelah ayunan mereda. Perbaikan guard komponen bersama juga berlaku di Market, tanpa env/aset/kontrak API baru. Revisi lapisan 2026-10-16: tali bersama berada pada `z-30`, di belakang navbar sticky `z-50` dan overlay navigasi `z-40`, pada Pedia maupun Market; pangkal tali tertutup navbar, sedangkan bagian di bawahnya tetap mengikuti scroll dan merespons interaksi.

Revisi copy hero 2026-10-16 ✅ implementasi, publikasi melalui CI: headline beranda Pedia menjadi “Satu tempat untuk / optimasi media sosial”, tanpa typewriter (dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit)); headline statis dua baris putih. Baris pendukung di bawah CTA persis “Order cepat tanpa login • Garansi refill • Support WA admin”. Ini perubahan copy atas permintaan owner; kelayakan, masa dan ketentuan refill tetap mengikuti layanan/paket yang dipilih, tanpa perubahan kontrak checkout atau supplier.

Revisi navbar dan lacak 2026-10-16 ✅ implementasi, publikasi melalui CI: hierarki navbar Pedia mengikuti Market: logo → pencarian → Layanan AXVARA → Katalog → Lacak Pesanan → Artikel. Navigasi teks tampil mulai `xl`, dengan pill hover/focus membulat; Artikel menuju URL absolut Market dari `SITE.webUrl`, menggantikan Bantuan di navbar atas. Bantuan tetap tersedia di bottom nav dan footer. `/pedia/lacak` memakai header, kartu form glass, label/hint, tombol loading dan FAQ dengan gaya Market; verifikasi kode AXP + WA/email tetap melalui `POST /api/orders/lookup`, lalu membuka halaman status Pedia setelah berhasil. Riwayat sukses maksimal lima tersimpan lokal di `axp-track-recent` dengan kontak tersamarkan pada UI dan tombol hapus; daftar `axp-orders` maksimal 20 terlipat awal, menyaring entri rusak dan dapat disembunyikan per pesanan. Penyimpanan browser opsional; validasi, timeout jaringan dan penjagaan klik ganda tidak mengubah kontrak server atau supplier. Revisi lanjutan 2026-10-16: pill “WA Admin” dan “Panduan pemesanan” di bawah FAQ lacak dihapus; halaman berakhir pada FAQ sebelum footer bersama.

Katalog terkurasi berisi 38 jenis/131 mapping pada 16 platform, dengan 3 pilihan awal pada mobile/desktop, drop/refill tetap. Pilihan yang sudah dipilih dirangkum dan dapat diganti pada semua ukuran. Target GitHub/website/platform baru didukung parser client/server. Harga jumlah bebas dihitung server; order/job/kredit/ledger atomik D1, retry QR sama, kredit pending kedaluwarsa dikembalikan. Copy ketentuan disimpan ke quote/order. Tidak ada order supplier berbayar atau klaim hasil kualitas/drop teruji dalam verifikasi ini.

**Tema:** Apple Store + Glassmorphism + Premium Vault
**Tagline Visual:** Midnight Navy + Electric Cyan Glow
**Version:** 1.1 (sinkron 2026-09-15: font cross-platform + katalog load-more + foto Telegram)
**Tanggal:** 31 Agustus 2026  

---

## 1. Prinsip Desain

**Pesan produk Telegram — 2026-10-17 ✅ implementasi, publikasi melalui CI:** pertahankan judul 🎁 Produk Siap!, identitas order/produk bila tersedia, dan blok kredensial monospace untuk disalin. Setelahnya tampil judul tebal 📜 Syarat & Ketentuan (kelompok Detail paket/Proses & pengiriman/Aturan pakai/Garansi), 📖 Cara Penggunaan / Aktivasi (langkah bernomor), lalu 🛡 Syarat klaim garansi dari kebijakan bersama Market; penutup berisi catatan simpan dan `/bantuan`/`/garansi`. Data kosong dijelaskan dengan arahan admin. Bagian panjang berlanjut pada pesan berjudul Detail Produk — lanjutan dengan identitas yang sama, maksimal 4096 karakter HTML per pesan, tag utuh, Unicode dan isi kredensial dipertahankan, preview tautan dinonaktifkan. Berlaku pada pengiriman otomatis, serah terima admin berisi detail dan ambil ulang. Ini format pesan bot; tidak menambah UI website.

1. **Apple-level Minimalism** — banyak whitespace, tipografi besar, foto produk jadi hero, tidak ada clutter. Seperti apple.com/store: 1 produk = 1 kartu premium yang bernafas.
2. **Glassmorphism sebagai Signature** — navbar, kartu, drawer keranjang, modal checkout semuanya kaca blur semi-transparan dengan border halus. Kesan mahal & futuristik.
3. **Motion yang Halus (Apple Spring)** — tidak ada animasi kaku. Semua transisi pakai spring/ease-out, 60fps, parallax lembut saat scroll.
4. **Dark Premium Default** — background gelap (midnight) dengan aksen cyan glow dan gold. Terasa seperti vault / lab AI mahal, bukan toko murah.
5. **Mobile-First, Thumb-Friendly** — semua CTA besar, keranjang drawer full-height di mobile, checkout 1 kolom di HP.

---

## 2. Palet Warna

### Core Palette

| Token | Hex | Penggunaan |
|-------|-----|------------|
| `--ax-bg` | `#080C1E` | Background utama (midnight navy) |
| `--ax-bg-2` | `#0F1430` | Section alternating |
| `--ax-bg-3` | `#161D4A` | Kartu elevated |
| `--ax-surface` | `rgba(255,255,255,0.06)` | Glass surface |
| `--ax-surface-2` | `rgba(255,255,255,0.10)` | Glass hover |
| `--ax-cyan` | `#00E5FF` | CTA, link, glow, focus ring |
| `--ax-cyan-soft` | `rgba(0,229,255,0.15)` | Glow background |
| `--ax-gold` | `#FFB800` | Badge premium, harga diskon, accent |
| `--ax-text` | `#F1F5FF` | Teks utama |
| `--ax-text-muted` | `rgba(241,245,255,0.65)` | Teks sekunder |
| `--ax-border` | `rgba(255,255,255,0.10)` | Border glass |
| `--ax-border-strong` | `rgba(255,255,255,0.18)` | Border hover |
| `--ax-success` | `#22C55E` | Lunas / sukses |
| `--ax-warning` | `#F59E0B` | Pending |
| `--ax-danger` | `#EF4444` | Error / batal |

### Gradient Signature

- Hero glow: `radial-gradient(600px 400px at 50% 0%, rgba(0,229,255,0.18), transparent 70%)`
- Card glow hover: `radial-gradient(400px 300px at 50% 0%, rgba(0,229,255,0.10), transparent)`
- Gold shimmer (badge): `linear-gradient(100deg, #FFB800, #FFD666, #FFB800)`

---

## 3. Tipografi

> Status 2026-09-14 (commit `cc8eaa1`): font cross-platform via `next/font`
> self-hosted — Inter (body) + Space Grotesk (display/harga) + JetBrains Mono
> (kode pesanan). 2026-10-12: beralih dari `next/font/google` ke
> `next/font/local` dengan variable font di `public/fonts/` — Google fetch
> saat build gagal di CI bila runner tak bisa akses fonts.googleapis.com.
> Di Chrome Windows tidak lagi jatuh ke Arial tipis;
> `-webkit-font-smoothing: antialiased` hanya untuk WebKit Apple agar teks
> kecil Windows tidak pudar. Tabel di bawah adalah fondasi (dilengkapi webfont
> di `src/app/layout.tsx` + `tailwind.config.ts`).

| Level | Font | Size (desktop) | Weight | Usage |
|-------|------|----------------|--------|-------|
| Display | Space Grotesk / General Sans | 56px / 3.5rem | 700 | Hero headline |
| H1 | Space Grotesk | 36px | 700 | Judul section |
| H2 | Space Grotesk | 24px | 600 | Judul kartu produk |
| H3 | Space Grotesk | 18px | 600 | Label kategori |
| Body | Inter / Satoshi | 16px | 400 | Deskripsi |
| Small | Inter | 14px | 400 | Meta, harga coret |
| Caption | Inter | 12px | 500 | Badge, label |
| Price | Space Grotesk | 20px | 700 | Harga |

**Aturan:**
- Headline tight tracking `-0.02em`, line-height 1.1
- Body line-height 1.6, max 65ch
- Harga pakai Space Grotesk bold, warna `var(--ax-cyan)` atau `var(--ax-text)`

---

## 4. Glassmorphism Spec

```css
.ax-glass {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.10);
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.ax-glass-strong {
  background: rgba(15, 20, 48, 0.75);
  backdrop-filter: blur(24px) saturate(200%);
  -webkit-backdrop-filter: blur(24px) saturate(200%);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
```

**Penerapan:**
- **Navbar:** `ax-glass-strong`, sticky top, blur saat scroll, border-bottom halus
- **Kartu Produk:** `ax-glass`, rounded-2xl (24px), hover → border cyan + glow + lift 4px
- **Drawer Keranjang:** `ax-glass-strong`, slide dari kanan, backdrop dim `rgba(8,12,30,0.6)` + blur
- **Modal Checkout:** `ax-glass-strong`, centered, rounded-3xl
- **Badge Kategori:** glass pill dengan dot cyan

---

## 5. Komponen Utama

### 5.0 Checkout Revamp ala Sekalipay (2026-09-23, live — ganti Batch C 2026-09-19)
- Alur 1 halaman: ① Metode Pembayaran di atas → ② Data Pembeli minimal
  (No WA + Email wajib, tanpa Nama) → S&K → 1 CTA. QRIS auto-select
  selama maintenance (hemat 1 klik). Copy hint: WA = terima produk/info/
  bantuan; Email = detail pesanan & produk dikirim ke email aktif.
- Desktop 2 kolom: kiri = METODE + DATA + S&K mobile + Made By Order bila
  antrean (sub-hint verifikasi otomatis di bawah metode, bukan step
  bernomor). Kanan = `aside` DESKTOP ONLY (`hidden lg:block`) sticky
  `top-[72px]` "Ringkasan dan pembayaran": ringkasan item + total + S&K
  (`renderAgreeBlock("checkout-agree")`) + error + CTA + catatan QRIS
  otomatis. Metode TIDAK lagi di rail.
- S&K SATU fungsi `renderAgreeBlock(id)` dirender 1x per viewport (mobile
  `checkout-agree-mobile` di kiri, desktop `checkout-agree` di rail) —
  satu state `agreed`, tanpa duplikat id.
- 2 tombol submit (rail desktop + sticky mobile) berbagi SATU handler +
  state `ctaDisabled`/`ctaLabel` — tidak ada logika validasi ganda.
- S&K belum dicentang **tidak** menonaktifkan CTA (2026-09-24, audit ronde 4
  W-M3): tombol disabled tidak memanggil `submit()`, jadi pembeli (terutama
  sticky CTA mobile) melihat tombol redup tanpa alasan. Klik kini menampilkan
  "Centang persetujuan…" dan menggulir + memfokuskan checkbox yang terlihat.
- Validasi kontak checkout (2026-10-15): submit invalid menggulir label/input/error pertama ke tengah viewport dan memfokuskan input; scroll-margin atas 7rem/bawah 8rem menghindari navbar/CTA, reduced motion memakai scroll langsung. Sticky CTA menampilkan pesan ringkas "Lengkapi data pembeli untuk melanjutkan." Error terkait input lewat aria-describedby.
- Mobile: accordion "Ringkasan Pesanan" collapsed-able di atas (buka default,
  pola struk 2026-10-01: total tampil 1x per state — header total hanya saat
  accordion TERTUTUP/loading, saat terbuka total pindah ke footer body;
  subline "Qty N × unit" hanya bila qty > 1, qty 1 cukup "Qty 1") + CTA sticky bottom `fixed` (dengan
  `safe-area-inset-bottom`) + spacer 68px agar konten tak tertutup. Rail
  disembunyikan total di mobile agar tidak duplikat (anomali: 2x ringkasan
  + 2x CTA). Sticky
  bottom `lg:hidden`.

### 5.1 Navbar (Apple Style)
- Height 64px, sticky, glass-strong, blur
- Kiri: Logo AXVARA (X sebagai gerbang/vault dengan glow cyan) + wordmark Space Grotesk 700
- Tengah: Search pill glass (icon + placeholder "Cari AI Gateway, ChatGPT Plus...")
- Kanan: Kategori dropdown, Keranjang (icon + badge jumlah baris varian — pola marketplace: 1 baris GSuite min-50 tampil "1", bukan "50"), Admin (icon)
- Scroll: navbar tambah shadow + background lebih opaque

### 5.2 Hero Section
- Full-width, min-h 60vh, midnight gradient + radial cyan glow di atas
- Headline: "Satu tempat untuk semua tools premium." (font-display 700, 42–62px responsif)
- Subheadline (2026-10-01, keputusan owner — penekanan dipindah dari "QRIS otomatis" ke "order cepat tanpa perlu login"): "Berbagai tools AI dan aplikasi premium dengan harga murah. Order cepat dan otomatis tanpa perlu login."
- CTA: Primary "Lihat Katalog" (putih solid) + Secondary "Hubungi Admin" (glass outline, link WA)
- Trust sebaris: "Order cepat tanpa login • Garansi replace • Support WA admin"
- Search besar glass di bawah CTA (seperti Apple Store search)
- Parallax: glow dan headline bergerak halus saat scroll (translateY + opacity)
- **Orbit hemat mobile (2026-09-29, laporan owner HP lag):** hot path animasi WAJIB compositor-only (transform + opacity) — backdrop-blur/blur/drop-shadow per frame dilarang (satu blur kaca = repaint seluruh layer tiap frame di GPU HP). Mobile (pointer coarse / ≤640px): 8 planet dalam, trail SVG + label + shadow dinamis + star dust mati, 24fps; glow hero dihemat (cyan 44px, gold mati). Desktop utuh 12 planet 30fps + trail. Scroll sentuh selalu native (`touch-action: pan-y`, tanpa preventDefault).

### 5.3 Kartu Produk (Apple Card)
- Rounded 24px, glass, aspect 4:3 untuk gambar, padding 20px
- Gambar: object-cover, rounded-xl, hover scale 1.03
- Badge kategori di atas gambar (glass pill + dot)
- Nama produk: H2, 2 baris max, ellipsis
- Harga: besar cyan, harga coret kecil muted jika diskon (dari varian termurah
  yang masih tersedia — bukan varian habis)
- Tombol: "Tambah" (glass → cyan solid saat hover), icon keranjang
- Tombol aksi kartu "Keranjang"/"Checkout" (dan span "Stok Habis") memakai tinggi `h-8` di mobile / `sm:h-9` di desktop (32/36px) — dikembalikan ke ukuran semula per keputusan owner 7 November 2026 setelah sempat membesar ke `h-11` tanpa catatan di commit 2e96cd5. Jangan menaikkan tinggi tombol kartu tanpa instruksi owner.
- Hover: border `rgba(0,229,255,0.35)`, glow radial, lift `translateY(-4px)`, shadow cyan soft
- Grid: 1 col mobile, 2 tablet, 3-4 desktop, gap 20px
- Katalog: 16 produk + tombol **"Tampilkan N produk lagi"** (bukan nomor halaman);
  ganti kategori/search mengembalikan ke 16 awal. Produk habis TETAP tampil di
  akhir (kontrak 2026-10-01, revisi keputusan owner — mengubah kontrak
  2026-09-30 yang menyembunyikan): kartu abu-abu (`grayscale` + overlay gelap +
  pill "STOK HABIS", tanpa tombol beli/keranjang, StockStatus tanpa Compas —
  hanya badge abu) untuk trust + mengurangi komplain "kok kemarin ada, sekarang
  hilang". Urutan: ready → habis → nonaktif (stabil via sortProductsForDisplay)

### 5.3c PDP: Syarat & Ketentuan per Varian + Label Garansi
- Section "Syarat & Ketentuan" terikat **varian terpilih** (fallback varian
  aktif pertama): judul + label varian (`formatVariantLabel`, mis. "Premium
  Legal - 28 Hari"; tanpa label bila S&K berasal dari deskripsi produk non-WR).
- **Satu format untuk WR dan non-WR (2026-09-24, live — permintaan owner):**
  - Deskripsi = paragraf pembuka + daftar keunggulan (ikon check cyan), tanpa
    aturan pakai (aturan hanya di S&K → tidak ada kalimat berulang).
  - S&K dikelompokkan dengan judul `text-[13px] font-semibold text-white` huruf
    biasa (2 Nov, menggantikan uppercase 11px) + titik warna:
    Detail paket (cyan), Proses & pengiriman (cyan/60), Aturan pakai (gold
    `#FFB800`), Garansi (emerald).
  - Cara Aktivasi (2 Nov): satu langkah = paragraf biasa tanpa nomor; nomor hanya
    untuk dua langkah atau lebih. Hanya URL YouTube berlabel singkat; URL lain
    tampil utuh (path membedakan tujuan). Koreksi owner 2 Nov: kotak Cara Aktivasi
    desktop kembali bersarang (`mt-6 rounded-2xl border border-white/10
    bg-white/[0.03] p-5`); judul 13px dan perubahan lain tetap. Langkah bernomor = lingkaran `bg-[#00E5FF]/15`, boleh
    berkelompok berjudul (mis. "Login di aplikasi" / "Login di website"),
    catatan di kotak kecil ber-ikon info.
  - Desktop: kartu glass di kolom kiri (Deskripsi, lalu S&K dengan sub-kartu Cara
    Aktivasi seperti semula). Mobile: deskripsi dilipat dengan mask fade +
    "Lihat Selengkapnya" hanya bila melebihi ±6 baris; **S&K dan Cara Aktivasi
    masing-masing panel terlipat** (`aria-expanded`, chevron, meta "· label
    varian" / "· N langkah"). Label panel boleh membungkus — jangan
    `truncate`/nowrap (teks nowrap melebarkan grid PDP di layar 390px); URL
    panjang dipotong dengan `[overflow-wrap:anywhere]`.
- PDP produk pecundang supplier-pair (2026-10-01, live; Opsi B 2026-10-02):
  bila `slug` yang diminta hidden karena kalah WR vs SK ATAU karena pasangannya
  winner None dan ia sisi SK (`resolveStoreProduct` → 404) TAPI pasangannya
  tampil, PDP 308 ke slug pemenang/wakil
  (`/produk/[slug]/page.tsx`, preserve query) + meta noindex agar mesin cari
  tidak mengindeks URL pecundang. PDP habis (tanpa pasangan tampil) tetap 200
  + badge habis (kontrak trust 2026-10-01).
  - Suara Axvara: sapaan "kamu", kalimat biasa (tanpa HURUF BESAR berteriak),
    tanpa emoji, tanpa tanda seru, tanpa titik di akhir poin, tanpa bahasa gaul
    pemasok; larangan tetap tegas ("Dilarang …", "Wajib …", "Tanpa toleransi …").
    Semua angka, batas, dan larangan pemasok wajib terbawa (dijaga test).
  - Revisi editor produk 2026-10-15: modal desktop maksimal 880px; varian berbentuk accordion dengan nama, harga, status, dan stok pada header. Satu varian terbuka, state input varian lain tetap dipertahankan. Field harga/modal/stok/minimum memakai 2–3 kolom desktop dan 1 kolom mobile dengan tinggi label seragam. Stok unique mengikuti inventory. Bagian pengiriman stok sendiri memisahkan Detail akses produk (link/akun/key) dari textarea S&K bersama dan Cara penggunaan / aktivasi bersama; panduan disimpan bersama Simpan Produk. Impor stok punya aksi dan status tersimpan sendiri. Supplier tetap memakai tinjauan teks khusus di tab Deskripsi & S&K.
  - Panel admin (2026-09-24, live): editor produk punya 4 tab — Produk,
    Varian, **Deskripsi & S&K**, Foto (tablist `max-w-full overflow-x-auto`,
    tab `shrink-0 whitespace-nowrap px-2.5 sm:px-4` agar muat di layar 390px;
    panel `role=tabpanel` + atribut `hidden`; ganti tab menggulir badan modal
    ke atas). Tab Deskripsi & S&K berisi kolom deskripsi (dan deskripsi khusus
    untuk WR) lalu daftar varian; tab diberi pill gold berisi jumlah varian
    aktif yang S&K-nya perlu ditinjau. Tiap varian = panel terlipat berjudul
    nama varian (+ durasi bila label WR sama, pill abu "Nonaktif"), badge status — emerald
    "Disunting admin", cyan "Versi Axvara (otomatis)", gold "Teks WR — belum
    versi Axvara", merah "WR mengubah teks — suntingan dijeda" (+ kotak
    peringatan `role=alert`), abu "Pakai S&K produk" (non-WR tanpa suntingan).
    Dua textarea mono (S&K, Cara Aktivasi) terisi salinan yang sedang tampil,
    `<details>` teks asli WR, tombol sendiri "Simpan S&K varian" / "Tandai
    sudah ditinjau" / "Pakai versi otomatis". Daftar produk: pill gold
    "S&K perlu ditinjau · N varian" di bawah slug (desktop) / kategori (mobile).
  - Revisi 29 Oktober 2026 (implementasi lokal): panel supplier berlaku setara
    WR/SK, textarea memuat override atau salinan otomatis. Override dijeda diberi
    label terpisah dan detail versi pembeli terkini. Detail sumber asli serta
    pratinjau gabungan draft/deskripsi memakai parser dan renderer storefront.
    Empty state tidak mengklaim panduan tersedia. Error simpan tetap inline;
    Muat sumber terbaru mempertahankan draft, Batalkan perubahan mengembalikan
    kolom, Kembali ke versi otomatis menghapus override. Simpan Produk terkunci
    selama draft/simpan teks; X, backdrop, Batal dan Escape meminta konfirmasi
    untuk draft dan diblokir saat simpan. Ganti tab tidak membuang draft.
- Badge pengiriman pembeli fulfillment-aware (2026-09-19, live):
  `buyerDeliveryKind()` — WR ikut `wr_delivery_class` (restock = Kirim
  otomatis, selainnya = Made By Order + estimasi supplier); non-WR ikut
  `fulfillment_mode` milik admin (shared/unique = Kirim otomatis dari stok
  sendiri, manual = Made By Order + kalimat admin tanpa angka supplier).
  Berlaku di kartu varian PDP + badge PDP + QuickVariantModal (badge per
  kartu; kalimat ETA di atas CTA modal dihapus 2026-09-19). Opsi admin "Cara Pengiriman" di ProductVariantRows sinkron 1:1
  dengan `fulfillment_mode` + preview badge; panel konten fulfillment
  (shared/unique) hidup di jalur resmi — bukan hanya VariantEditor mati.
- Nama varian pembeli `formatVariantLabel()` (2026-09-19, revisi malam: HANYA
  WR digabung): varian WR = label + " - durasi" bila belum terkandung
  (case-insensitive); non-WR = label admin apa adanya (kolom duration_*
  non-WR duplikat garansi — ditempel malah jadi "Invite Lifetime - 6 Bulan").
  Latar: sync WR menulis label = nama API verbatim ("Meitu VIP") dan durasi di
  kolom `duration_*` ("7 Hari"); PDP web yang hanya render label kehilangan
  durasi di 88/97 varian aktif, padahal web WR menggabung ("Meitu VIP - 7
  Hari"). Berlaku di kartu varian PDP + QuickVariantModal + displayName quote
  checkout (ringkasan + blok Made By Order). Label yang sudah mengandung durasi
  ("GSuite 1 Hari", "Invite 1 Bulan") tidak digandakan. DB tak tersentuh agar
  sync tetap aman menimpa.
- Label garansi varian SELALU kanonis `Garansi N Unit` ("Garansi 12 Hari") +
  ikon shield — di baris sendiri di BAWAH nama varian (block, bukan inline),
  JANGAN render label mentah ("12 Hari" ambigu dengan durasi).
- Badge pengiriman per varian TANPA emoji (anti AI slop, 2026-09-17; teks
  direvisi 2026-09-18/19): di bawah label varian (block, di atas harga/garansi) —
  restock = pill `emerald-400/25 + emerald-500/10` teks "Kirim otomatis",
  selainnya = pill `gold/25 + gold/10` teks "Made By Order" polos tanpa angka
  jam (2026-09-19; sebelumnya "Made By Order · maks 12 jam").
  "Dikirim admin" dan "Diproses antrean" dibuang (samar / diganti istilah owner
  2026-09-19). Berlaku di kartu varian PDP desktop +
  QuickVariantModal. JANGAN taruh di card deskripsi/S&K (datanya per-varian,
  bukan per-produk) dan JANGAN pakai emoji ⚡/✋.
- Ekspektasi waktu (2026-09-18, revisi kata 2026-09-19, live): kalimat `deliveryEtaForBuyer()` wajib
  tampil SEBELUM pembeli bayar — badge pengiriman PDP (tanpa ikon checklist
  ganda sejak 2026-09-19) + teks di bawahnya, dan blok checkout "Made By Order"
  (border+bg gold `#FFB800/25` + `/[0.07]`; template sejak 2026-09-19:
  "{produk} dibuat setelah pembayaran terkonfirmasi. Umumnya terkirim cepat,
  maksimal 12 jam pada jam layanan"; paragraf
  "Detail akun dikirim ke WhatsApp…Tidak perlu menunggu" dihapus 2026-09-19).
  QuickVariantModal HANYA badge per kartu varian — kalimat ETA di atas CTA
  dihapus 2026-09-19 (keputusan owner). Angka yang dijanjikan hanya PLAFON (maksimal 12
  jam) plus "umumnya lebih cepat"; jangan tampilkan rentang mentah 6–12 jam
  (dibaca sebagai janji minimum) dan jangan tanpa angka (pembeli tetap
  bertanya via support). Nama pemasok tidak pernah muncul di copy pembeli.

### 5.3d Minimum Pembelian per Varian (2026-09-17, live — revisi UX ala marketplace)
- Kolom `product_variants.min_qty` (migrasi 0034, default 1 = bebas; GSuite =
  50). Riset pola Shopee/Tokopedia: (1) qty selector dibuka di minimum dan
  minus tidak turun di bawahnya; (2) info "Min. N" SATU tempat di dekat
  kontrol jumlah — bukan badge di tiap kartu varian (menumpuk bila 7 varian);
  (3) Beli Langsung membawa qty terpilih (tidak selalu 1 → tidak dead-end);
  (4) server authoritative, frontend menjelaskan penyesuaian.
- PDP (desktop + mobile): blok **Jumlah** di bawah varian — stepper
  (−/input ketik/+) dibuka di min, minus tidak turun di bawah min, ketik
  manual bebas (digit saja, maks 3) lalu commit clamp [min, 100] saat
  blur/Enter — tidak bisa di bawah min. Teks "Min. pembelian N" + total
  berjalan untuk min>1. Beli Langsung → `/checkout?buy=&variant=&qty=`;
  Tambah ke Keranjang memakai qty stepper.
- QuickVariantModal: panel SOLID `#0B1025` (konsisten ConfirmDialog /
  ProductEditorModal / dialog checkout — bukan glass transparan) + blok
  Jumlah yang sama (stepper + ketik manual clamp) + tombol aksi menampilkan
  TOTAL (qty × harga).
- QuickVariantModal (revisi lebar desktop 2026-09-18, live): mobile dikunci
  bottom-sheet `max-w-[480px]` (sudah pas); desktop `sm+` panel tengah
  `sm:max-w-[620px] lg:max-w-[660px]` + `sm:p-7`, grid tetap 2 kolom dengan
  `sm:gap-3 + sm:p-4` per kartu, list `sm:max-h-[340px]` agar 4-6 varian
  (kasus GSuite) jarang kena scroll internal, CTA `sm:h-12`. Pola tidak
  berubah: tetap modal fokus, bukan drawer/page baru.
- QuickVariantModal daftar panjang (2026-09-25): lebih dari 6 varian →
  baris ringkas satu kolom (`min-h-[48px]`, label + badge teks + harga +
  sisa stok, `gap-1.5`); lebih dari 10 → kotak "Cari di N varian" di atas
  daftar. Varian terpilih digulir ke dalam pandangan saat panel dibuka. Mode
  select memakai tinggi daftar `max-h-[min(60vh,460px)]` karena tanpa CTA.
- Checkout: keranjang lama di bawah min → dialog solid "Sesuaikan Jumlah
  Pembelian" dengan tombol **Sesuaikan ke minimum** (1 klik menaikkan qty +
  refetch quote), bukan dead-end "kembali belanja".
- Telegram: stepper floor = min; WhatsApp (qty selalu 1): varian min>1
  ditolak jelas + arahan bulk.

### 5.3b Foto Welcome Telegram- File: `public/banners/tg-welcome.webp` (WebP ~31 KB, 1280px) — dikirim via
  `sendPhoto` di `/start` dengan caption sapaan + inline keyboard.
- JANGAN pakai PNG 2,2 MB dari R2 (timeout 10 dtk di edge → foto gagal diam-diam).
  Bila `sendPhoto` gagal: retry 1x, lalu fallback teks + keyboard.
- `/start` TIDAK mengirim pesan teks tambahan apa pun setelah foto
  (reply keyboard persistent sudah terinstal sejak /start pertama).

### 5.3e Katalog dan pesan Telegram (revisi 29 Oktober 2026)
Koreksi owner paling akhir: kembali ke bar ▓░0/40/70/100%, jeda400/500/400/300ms
dan delete existing. Berlaku /start, produk dan memuat QRIS satuan/keranjang;
selesai sebelum langkah berikutnya. Efek pecah/blur penghapusan mengikuti aplikasi
Telegram, bukan efek khusus Bot API. Varian habis: ❌ + nama, tanpa teks Habis;
ketuk memunculkan modal alert agar memilih produk lain. Loading bertitik paralel
pada catatan di bawah adalah histori yang digantikan, hierarki/copy lain tetap.

Implementasi lokal untuk publikasi CI, menggantikan susunan 27 September.
- Katalog → produk sekaligus pilihan varian → jumlah/email → QRIS → status.
  Tombol varian memakai label kanonis dan harga, tanpa menempel durasi/garansi
  metadata berulang. Pilihan habis tetap terlihat, nonaktif dan di akhir.
- Ringkasan jumlah memuat harga satuan/subtotal, email masked, kelas pengiriman
  serta ketentuan relevan; ketentuan lengkap memiliki pagination per klik.
  Stepper dan ForceReply mengikuti minimum, stok efektif, maksimum100/baris
  serta batas10 unit unik. Koreksi lanjutan owner29Oktober: satu bubble loading
  bertitik dikirim langsung bersama pekerjaan /start/produk;
  maksimal3edit berjarak1200ms, terakhir “Masih memuat…”, tanpa persentase.
  Hasil menunggu respons pengiriman awal loading, bukan menunggu putaran animasi.
  Loading tetap bergerak selama pengiriman foto hasil, lalu dihapus setelah
  selesai/gagal. Send/delete memakai timeout transport existing10detik, edit
  maksimal5detik dan edit aktif dibatalkan saat selesai. Tidak membatalkan send
  awal saat data siap karena abort tidak menarik pesan yang sudah diterima Telegram.
  Typing native tetap pada transaksi lain, kegagalan dekorasi tidak menggagalkan hasil.
- Pagination/stepper dan ringkasan konfirmasi dari tombol memakai bubble existing;
  respons email teks, invoice dan kredensial tetap terpisah. Identitas produk,
  kelompok harga/jumlah/subtotal dan email dipisahkan ruang kosong/judul tebal;
  email masked berupa teks biasa, monospace untuk kode/kredensial, bukan tabel.
  Checkout memakai 💳 dan pilih jumlah 🛒, bukan centang yang menyiratkan sukses.
- Email wajib melalui input atau konfirmasi email tersimpan; Ubah Email/Jumlah
  tersedia sebelum invoice. Ringkasan berubah meminta persetujuan baru, bukan
  menerbitkan invoice dengan nilai berbeda secara diam-diam.
- Copy menyebut barang, keadaan, dan tindakan. Tidak memakai slogan/breadcrumb
  Langkah X/4 atau emoji dekoratif berulang. Koreksi owner29Oktober: satu ikon
  semantik pada judul utama/status dan tombol navigasi/aksi penting (🛍 katalog,
  🛒 keranjang, 📧 email, 💳 bayar, 🔄 cek, ✅ lunas, 📦 produk siap, ⚠️ error).
  Label teks tetap lengkap, isi kredensial/ketentuan dan tiap baris produk tidak
  dihias. Bayar QRIS, Cek Pembayaran,
  Detail Pesanan, Ketentuan dan Bantuan menggunakan nama tindakan singkat.
- Pembatalan meminta konfirmasi. Status seluruh item dan tombol ambil ulang
  membedakan belum siap, gagal, serta pengiriman parsial. Kredensial tetap
  monospace, HTML/Unicode utuh, maksimal4096karakter per pesan, diikuti S&K,
  aktivasi dan kebijakan klaim; revisi ini menggantikan judul beremoji pada
  snapshot pesan produk17Oktober, bukan menghapus isi ketentuannya.
- Tidak ada perubahan UI web atau aset. Pemeriksaan memakai pesan/callback
  aktual melalui fixture, bukan screenshot homepage atau pesan produksi.

### 5.3f Daily Promo Telegram (2026-09-27 live, revamp 2026-09-29, format final 2026-10-03)
- Grup admin menerima dua slot bahan promosi09.00/17.00 WIB, seluruh produk ready pada kedua slot (revisi1Oktober; aturan12+12 adalah histori). Setiap slot dua bubble: utama bold HTML Telegram + versi WA siap copy-paste, isi sama dan bold `*` literal tanpa parse_mode. Revisi11November2026 lokal: hanya versi WA memakai pemisah52tanda `-`; utama Telegram tetap66tanda.
- Format (contoh manual owner): judul `🔥 PRODUK AXVARA READY PAGI/SORE INI` + garis `---` + intro dua baris ("Sedia semua kebutuhan aplikasi dan tools premium favorit anda. / Murah, mudah, cepat, dan bergaransi.") + garis `---` + kelompok per kategori (`{ikon} NAMA`, baris `✅ nama — RpX`, blank line antar kategori) + CTA **website dulu baru bot** (Order melalui Website, lalu Order melalui Bot Telegram). Harga tegas varian termurah purchasable — tanpa "Mulai", tanpa footer disclaimer, tanpa klaim termurah/diskon palsu/urgensi stok unlimited.
- Ikon kategori (2026-10-03 fix: Desain & Video sempat 🤖 karena "desain" mengandung substring "ai" — kini cek kategori spesifik dulu, AI pakai batas kata): AI & Chatbot 🤖, Desain & Video 🎨, Streaming & Hiburan 🎬, Produktivitas & Office 🛠️, Developer & Tools 💻, Bundle Hemat 📦.
- CTA final selalu sejajar: **Order melalui Bot Telegram** dan **Order melalui Website**. Jangan memakai label `Katalog lengkap` atau anchor `/#katalog`.
- Link preview dimatikan agar bubble stabil.

### 5.3g Katalog ready grup WA — 11 November 2026 (lokal)
- Satu foto dengan caption lengkap, bukan foto dan pesan teks terpisah: lampiran asli owner "Beli Aplikasi Premium Jadi Lebih Hemat di AXVARA", disimpan WebP1536x1024 di `public/banners/ready-promo.webp` tanpa crop/redraw.
- Judul `🔥 *PRODUK AXVARA READY PAGI/SORE INI*`, dua pemisah52karakter persis `----------------------------------------------------`, intro dua baris dan baris kategori/produk/CTA memakai formatter WA §5.3f. Nama/harga dinamis, bukan daftar contoh statis. Pesan panjang dibuka melalui tampilan caption native WA; tidak menjanjikan seluruh daftar terlihat tanpa "Baca selengkapnya".
- Panel Pengaturan Toko berganti judul menjadi **Katalog ready ke grup WhatsApp**, menjelaskan jadwal09.00/17.00 WIB dan notifikasi pembelian berhasil tidak dikirim. Kontrol koneksi/aktivasi/ganti nomor dan token visual existing tetap. Browser fixture bukan bukti render/pengiriman dalam aplikasi WA yang sesinya terputus.

### 5.4 Keranjang Drawer
- Overlay: `rgba(8,12,30,0.6)` + `backdrop-blur-sm`
- Panel: 420px desktop, full-width mobile, glass-strong, rounded-l-3xl desktop
- Header: "Keranjang (N)" — N = jumlah baris varian (`lineCount()`, 2026-09-19), bukan sum qty — + tombol tutup X
- List item: thumb 64px rounded-xl, nama, qty stepper glass, harga
- Footer sticky glass: subtotal, tombol "Checkout — Rp 89.000" (cyan, full-width, glow)
- Animasi: spring slide `transform: translateX(0)` dengan `cubic-bezier(0.32, 0.72, 0, 1)` 420ms

### 5.5 Halaman Detail Produk
- Layout 2 kolom: galeri kiri (1 besar + 3 thumb), info kanan glass card
- **2026-10-21 — foto tambahan utuh (implementasi, publikasi CI):** cover pertama tetap memakai bingkai 4:3 dan `object-cover`; foto kedua dan seterusnya memakai `w-full h-auto object-contain`, mengikuti rasio asli tanpa crop. Strip thumbnail serta preview admin memakai `object-contain` untuk foto tambahan, sementara cover tetap. Upload cover tetap WebP 1600×900; foto tambahan mempertahankan rasio asli dengan sisi terpanjang maksimal 1920 px. File hasil crop lama harus diunggah ulang dari sumber asli.
- Harga besar + badge diskon gold, stok indicator dot hijau/kuning
- Deskripsi + benefit list (icon check cyan)
- CTA: "Beli Langsung" (cyan solid) + "Tambah ke Keranjang" (glass)
- Animasi: galeri fade + scale saat ganti thumb
- **Mobile: pilih varian lewat panel, bukan daftar panjang (2026-09-25).**
  Desktop tetap daftar kartu varian inline. Di mobile, baris "Varian"
  (glass `white/[0.03]`) menampilkan pilihan aktif: label `text-sm
  semibold`, harga cyan, badge Kirim otomatis / Made By Order, dan teks
  "Ganti ›". Belum memilih: "Pilih varian · N pilihan" cyan. Ketuk membuka
  QuickVariantModal mode **select**: mengetuk varian langsung memilihnya untuk
  halaman lalu menutup panel (tanpa stepper/CTA, tanpa ke checkout). Harga,
  badge, stok, stepper Jumlah, S&K, cara aktivasi, dan tombol Beli Sekarang
  ikut varian itu. Menutup panel tidak membuang pilihan. Judul S&K mobile
  diberi tautan kecil "Ganti varian" (cyan `text-xs`, di bawah judul, di
  luar tombol lipat) hanya bila S&K/cara aktivasi antar varian memang berbeda.

### 5.6 Checkout (1 Halaman, Apple Form — revamp ala Sekalipay 2026-09-23)
- Layout: max-width 1100px, grid `lg:grid-cols-[1fr_380px]`; kiri = ① Metode → ② Data minimal → S&K mobile (+ Made By Order bila antrean), kanan = rail desktop-only
- Step: ① Metode Pembayaran (QRIS auto-select selama maintenance) → ② Data Pembeli (No WA + Email SELALU wajib, tanpa Nama; hint jelas ala Sekalipay) → S&K → 1 CTA
- Input: glass input `bg-white/[0.06] border-white/10 rounded-xl h-48px focus:border-cyan/50 focus:ring-cyan/20`
- Payment selector: 3 kartu (QRIS aktif / E-Wallet + Transfer Bank maintenance 2026-09-17) — kartu maintenance: `opacity-50 cursor-not-allowed`, `aria-disabled`, badge gold "Maintenance", tidak bisa diklik; QRIS selected → border cyan + bg cyan/10
- Jika QRIS: QR + total bayar muncul di halaman pesanan (sub-hint di bawah metode, bukan step bernomor); polling status otomatis
- Upload bukti: disembunyikan total selama maintenance (tidak dirender, bukan disabled)
- Tombol submit: cyan solid, full-width, h-52px, rounded-xl, disabled jika form invalid atau metode bukan QRIS; 2 tombol (rail desktop + sticky mobile) 1 handler
- Ringkasan 1x per viewport: mobile accordion collapsed di atas (`lg:hidden`), desktop rail sticky (`hidden lg:block`); rail disembunyikan total di mobile agar tidak duplikat ringkasan/CTA

### 5.7 Halaman Pembayaran & Status
- **QRIS pending ringkas (2026-10-15, implementasi; publikasi CI):** container
  maksimum 760px, padding halaman 16px mobile/24px desktop; kartu p-4/p-5,
  header ikon 32px mobile/40px desktop + judul 16px/18px dan kode mono
  11px. Judul/kode tepat di tengah kartu pada semua ukuran, dengan kolom
  penyeimbang ikon 32px/40px. Satu pill “Menunggu bayar” di atas Total bayar
  pada mobile maupun desktop. QR hangus tetap memiliki status di header pada semua ukuran. Panel bayar
  desktop dua kolom (QR 240px + info), mobile satu kolom dengan QR 224px;
  bingkai putih 10px, QR utuh `object-contain` tanpa crop, placeholder tetap.
  Kolom QR desktop memiliki ruang 290px untuk judul, QR, dan lockup resmi.
  Nominal 24px, kode unik/countdown 11px, instruksi pendek. Tombol Simpan QRIS
  dan Cek Pembayaran sejajar, tinggi 44px; polling satu baris 10px dan timestamp
  terakhir di `sr-only` agar tidak menambah tinggi. Ringkasan memakai
  `MobileCollapsible` tertutup awal (judul + jumlah produk). Lanjut Belanja/
  Batalkan Pesanan dua tombol ghost selebar sama dalam satu baris sekunder,
  tinggi 44px dengan padding horizontal, label ringkas agar aman di 320px;
  jeda 16px sebelum garis bawah dan padding 12px setelah garis; teks
  “Butuh bantuan?” terlihat di atas tombol WA/Telegram (jarak 8px);
  tanpa Lacak Status saat pending. Identitas QRIS tetap logo resmi + National
  Payment Standard.
- Judul/status mengikuti data server: pending, lunas, dibatalkan, kedaluwarsa
  atau gagal kirim. Setelah lunas, kartu status/detail akun/garansi dan
  auto-scroll tetap memakai alur yang sama. Ketentuan penerbitan ulang serta
  konfirmasi/verifikasi pembatalan tidak berubah.
- Status selain QRIS pending memakai blok tombol 2-tier (revisi proporsi
  2026-09-18, live — fix wrap 2 baris +
  menara 4 tombol di mobile): Tier 1 navigasi ("Lacak Status" + "Lanjut
  Belanja") grid 2 kolom `h-11 text-sm whitespace-nowrap` style glass/ghost;
  Tier 2 bantuan di bawah konteks mikro "Butuh bantuan?" — 2 pill outline
  `border-white/10 h-11 text-[13px]` (brand hanya di ikon
  `whatsapp-circle.svg` / `telegram.svg` + hover border brand 40%, bukan
  background solid full-bleed), label pendek "WA Admin" / "Telegram" agar
  muat 1 baris tanpa wrap. Tap target tetap ≥44px.
- Blok pasca-pembayaran (revisi 2026-09-18, live): satu kartu `ax-glass-card`
  di bawah Ringkasan, isinya bergantung `credentials_ready` dari server.
  Siap → panel "Detail Akun Digital" (input "No. WA atau email checkout" + CTA cyan `Tampilkan`, baris `Terdaftar: …` kontak tersamar `text-[11px] text-white/40`, hasil
  kartu mono emerald). Belum/tidak pernah ada (fulfillment manual) → blok
  informasi "Pengiriman Produk": kalimat tujuan pengiriman dengan email
  checkout tersamar di-highlight `text-white/80` (WA hanya untuk order lama tanpa
  email, 2026-09-25), lalu catatan `text-[11px] text-white/40` sesuai keadaan
  (2026-09-25, revisi copy A/B/C1/C2 2026-10-02, skeleton fase menyiapkan sore
  2026-10-02, copy email 2026-10-07): kirim otomatis stok sendiri yang sedang berjalan (±30 dtk pertama)
  → skeleton TANPA teks pengiriman (tulang `ax-skeleton`: judul + 2 baris + kotak,
  bentuk mirip panel "Detail Akun Digital" supaya peralihan tidak melompat, +
  baris mikro `text-[11px] text-white/40` "Menyiapkan detail produkmu…" dengan
  `InlineSpinner h-3 w-3`, `aria-busy="true"` + `sr-only` "Menyiapkan detail
  produk…");   lewat ±30 dtk → judul "Pengiriman Otomatis" + "Masih mengirim
  otomatis — butuh waktu lebih lama dari biasanya" (tetap tanpa admin/12 jam;
  order ber-email ditambah kalimat email + halaman ini);
  Made By Order (C1, manual by design) → judul "Pesanan Made By Order" tanpa
  alasan stok + "Umumnya kurang dari 1 jam, maksimal 12 jam" (tanpa jam layanan
  spesifik); instan yang diserahkan ke admin / `manual_required` (C2) → judul
  "Pengiriman oleh Admin" + alasan "Stok otomatis habis, jadi admin menyiapkan
  manual" + plafon yang sama — **kedua cabang ini khusus non-supplier sejak
  2026-10-13**: order supplier (WR/SK) yang linknya masih berjalan selalu
  tampil sebagai skeleton menyiapkan / "Pengiriman Otomatis", tidak pernah
  kalimat stok/admin; sudah terkirim tanpa detail →
  order ber-email: "Detail pesanan akan otomatis dikirimkan di email saat order
  dan akan tampil di halaman ini." + cek folder spam/promosi; order lama tanpa
  email: "Produk sudah dikirim ke WhatsApp …" (tanpa cek spam); estimasi 5–15 menit hanya untuk
  produk WR. Judul seksi + `aria-label` mengikuti cabang (`delivery.title`). Kartu memakai `aria-live="polite"`. Isi produk non-WR ikut tampil di panel
  "Detail Akun Digital" dengan label baris pesanan `text-[11px] text-emerald-200/80`
  di atas kartu mono. Prinsipnya: JANGAN pernah tampilkan
  kontrol yang pasti gagal ke pembeli yang baru membayar — form mati lebih
  bikin panik daripada tidak ada form.
  **Auto-scroll 2026-10-15:** saat isi akun terverifikasi muncul, panel
  menggulir sekali setelah commit DOM (frame berikutnya), ke posisi panel
  dikurangi jarak navbar 96px lewat `window.scrollTo`. Gerak halus
  secara default; reduced motion memakai `instant` karena `auto` masih
  mengikuti CSS global smooth. Form verifikasi/respons kosong/gagal tidak
  memicu scroll akun. Rerender/polling/accordion tidak menarik posisi baca
  kembali; frame dibatalkan saat panel dilepas. Berlaku di pesanan dan lacak.
  Hasil "Detail Akun Digital" SELALU multi-baris rapi per field (2026-09-18
  sore, live): `normalizeAccountDetailsForDisplay` mengupas envelope JSON
  (`{product,details}`), menormalisasi `\r\n`, memisah `key: value` /
  `key:: value`, memberi label Indonesia (Akses OTP, Tautan), dan membuang
  label ganda — tidak pernah JSON mentah (bukti prod: link 95FC8669 tampil
  `{"product":...,"details":"email:...\r\npassword:..."}` sebelum ini).
  Bentuk field supplier `{label, value}` (WR, 2026-10-13) dirender
  "Label: nilai" per baris dengan kata kunci mentah dibuang — bukan lagi
  satu baris "Product: … · Label: … · Value: …". Di bawah tiap kartu
  kredensial kini ada panel terlipat `MobileCollapsible` "Syarat &
  Ketentuan" (+ "Cara Aktivasi" bila ada) berisi salinan ter-resolusi yang
  sama dengan PDP — kredensial tetap bersih di kartunya sendiri.
  **Revisi 2026-10-16 ✅ implementasi, publikasi CI:** satu accordion
  **Syarat klaim garansi** berada di dalam kartu **Detail Akun Digital**,
  sesudah seluruh accordion **Cara Penggunaan / Aktivasi** dan sebelum
  catatan simpan detail, pada halaman setelah order dan hasil lacak.
  Jarak 12px, border, latar, radius, judul dan chevron mengikuti accordion
  S&K/aktivasi yang sama. Revisi ukuran 2026-10-16: isi accordion memakai
  `text-xs leading-relaxed` (12px), sama seperti isi panel S&K/aktivasi;
  halaman ketentuan tetap `text-sm leading-6` (14px). Tetap satu untuk beberapa akun; pada form verifikasi
  accordion tetap di dalam kartu. Bila detail akun belum tersedia, accordion
  tetap tampil setelah informasi pengiriman pada order lunas.
  Memakai `MobileCollapsible`, tertutup awal di semua viewport, tombol native
  dengan `aria-expanded/controls` dan region berlabel; style glass mengikuti
  panel lain. Isi diawali **pengajuan garansi hanya untuk produk bergaransi**,
  lalu dua syarat bernomor, Catatan dengan dua bullet (proses
  1–3 hari + solusi refund setelah maksimal 3 hari), dan ucapan terima kasih.
  Halaman ketentuan menampilkan isi yang sama tanpa lipatan; tidak ada
  perubahan masa garansi per produk atau mekanisme refund otomatis.
- **Link di hasil Detail Akun Digital bisa diklik (2026-10-03, laporan
  owner + screenshot /pesanan).** Isi kredensial (`CredentialText` di
  `ProductCopy.tsx`, dipakai `WrCredentialsPanel`) memakai `linkifySegments`
  yang sama dengan PDP/artikel: URL, bare domain, handle bot, dan path
  internal jadi `<a>` cyan-underline + `break-all` (gaya mono dipertahankan);
  internal tanpa `_blank`, eksternal `_blank noreferrer`. Email kredensial
  (`user@mail.com`) SENGAJA tetap teks — bukan link. Berlaku di /pesanan +
  /lacak-pesanan (panel yang sama). Dikunci
  `tests/article-autolink.behavior.test.tsx` (+1: panduan internal tanpa
  `_blank`, mailbox + clearcookies `_blank`, tanpa `mailto:`).

### 5.x Email pembeli bermerek (2026-09-25)
- SEMUA email ke pembeli memakai satu shell (`email-forward.ts`): body terang
  `#f1f5ff`, header Midnight `#080C1E` dengan logo Prism PNG + wordmark
  AXVARA ber-tracking lebar, kartu putih, badge nomor invoice, tombol Cyan
  `#00E5FF` bertuliskan "Lihat Pesanan →", dan blok bantuan dengan tombol WhatsApp
  hijau. Dipakai untuk "Pesanan Siap" (isi produk non-WR, versi gabungan memuat
  kotak "PEMBAYARAN DITERIMA"), tanda terima, pesanan diserahkan, bukti ditolak
  (kotak kuning untuk alasan), bukti menunggu Hook, pengiriman tertunda, dan
  pengingat QRIS. Dulu kabar non-WR memakai HTML polos tanpa logo.
- Isi produk ditampilkan per baris dalam blok mono (mudah disalin) dengan garis
  kiri Cyan, diikuti kotak kuning "Jangan bagikan detail ini". Tanpa emoji dan
  tanpa tanda seru. Semua isi di-escape.
- Panel admin "Kirim ke pembeli": satu textarea mono per item ("Detail untuk
  pembeli · {nama baris}") yang terisi dari template varian, kalimat tujuan
  (email/DM Telegram), dan input "Catatan internal" yang tidak dikirim ke pembeli.
  - PDP varian campuran sebelum dipilih: badge netral `border-white/15
  bg-white/[0.06]` "Tergantung varian", bukan hijau "Kirim otomatis".
- **Link bisa diklik di deskripsi/S&K/cara aktivasi (2026-10-03, permintaan
  owner; revisi internal-link hari yang sama, laporan owner + screenshot PDP
  Netflix).** Semua URL (`https://…`), bare domain (`netflix-codes…/mailbox`,
  `www.netflix.com/clearcookies`, `oliesmail.com`), handle bot Telegram
  (`@…_bot`), DAN path internal (`/artikel/…`, `/produk/…`, `/lacak-pesanan`,
  …) di ketiga badan teks dirender sebagai `<a>` cyan-underline — pembeli
  tidak perlu copy-paste manual. Eksternal pakai `target="_blank"
  rel="noreferrer"`; internal navigasi dalam toko (tanpa `_blank`, tanpa tab
  baru). URL/bare `axvara.tech/…` dinormalisasi jadi path internal.
  Helper murni `linkifySegments()` di `lib/product-copy/text.ts` (tanpa
  `dangerouslySetInnerHTML`, jadi teks supplier tidak bisa menyuntik HTML);
  email kredensial (`user@mail.com`) SENGAJA bukan link; skema
  `javascript:`/`data:` ditolak. Dikunci
  `tests/product-autolink.behavior.test.tsx` (13 + render internal tanpa
  `_blank`).
- **Bottom nav mobile: Kategori gantikan Keranjang (2026-10-03, keputusan
  owner).** Tab Keranjang redundan (drawer yang sama dibuka dari tombol
  Keranjang navbar yang selalu sticky + tiap kartu produk; nav bawah justru
  hidden di PDP/checkout). Susunan: Beranda · Kategori · Pesanan · Bantuan.
  Tab Kategori = `CategorySheet.tsx` (cermin HelpSheet: solid `#0B1025`,
  focus trap + Escape + scroll lock) berisi Semua + 6 taksonomi (fallback
  lokal, lalu `/api/categories`); pilih → event `axvara:category` →
  home-client filter + scroll `#katalog` (dari rute lain via `/?category=`).
  Keranjang tetap milik navbar (badge Gold tidak berubah).
- **Link di artikel bisa diklik (2026-10-03, laporan owner + screenshot).**
  URL di artikel Netflix tampil sebagai `<code>` biru tapi tidak bisa diklik
  (penulis menulis `` `https://…` `` backtick). Render `artikel/[slug]`
  kini: (a) teks polos diautolink via `linkifySegments()` yang sama dengan
  PDP (`ArticleRichText`, aturan konsisten); (b) codespan yang isinya URL
  polos ikut jadi `<a _blank noreferrer break-all>`; codespan   non-URL
  (perintah, kode) tetap `<code>`. Isi artikel Netflix id 23 juga diperbaiki
  langsung di D1 prod (backtick → link markdown + link internal
  Lacak Pesanan). Dikunci `tests/article-autolink.behavior.test.tsx` (4:
  codespan-URL, mailbox+bot, markdown existing, anti-impor-client).
- **Embed YouTube di artikel (2026-10-03, permintaan owner: tutorial
  supplier wajib ada player di antara teks).** Baris tersendiri
  `@youtube:VIDEO_ID` (11 char) di konten Markdown → `YouTubeEmbed` 16:9
  `youtube-nocookie` lazy (`rel=0`, allow fullscreen, strict-origin).
  Dirender sebagai JSX server-only — bukan dari string HTML Markdown (yang
  ditolak `isSafeMarkdown`), jadi konten D1 tidak bisa menyuntik iframe;
  ID tidak valid = paragraf teks polos. CSP `frame-src
  https://www.youtube-nocookie.com` dibuka di `middleware.ts` (satu-satunya
  frame-src baru). Dikunci `tests/article-autolink.behavior.test.tsx` (+2:
  embed valid + ID invalid).
- **Pelajaran 2026-10-03 (artikel 500): server component DILARANG impor modul
  client.** `artikel/[slug]` mengimpor `linkifySegments` dari
  `ProductCopy.tsx` (`"use client"` + `lucide-react`) → `next build` hijau
  tapi edge Pages 500 untuk SEMUA artikel. Solusi: logika murni tinggal di
  `lib/product-copy/text.ts` (tanpa React/lucide), komponen client impor
  dari sana. Test regresi membaca file sumber (bukan snapshot) agar pelanggaran
  ketahuan sebelum deploy. Konten D1 id 23 juga rusak terpisah (52 `\n`
  literal dari UPDATE via shell quoting → 1 heading raksasa): diperbaiki via
  `--file=` (bukan `--command=`).

### 5.x Format Tanggal & Jam (audit 2026-09-20, live)
- Semua tanggal/jam ditulis dalam **WIB** dan dirender lewat satu helper
  kanonis `formatWibDateTime` (`src/lib/utils.ts`) — bukan
  `new Date(nilai).toLocaleString(...)`. D1 menyimpan UTC berformat spasi,
  dan konstruktor `Date` membacanya sebagai waktu lokal sehingga di perangkat
  Indonesia jam tampil mundur 7 jam (order 23.25 tampil 16.25) dan tanggalnya
  ikut salah selepas tengah malam.
- Zona dikunci eksplisit (`timeZone: "Asia/Jakarta"`) supaya admin yang
  bepergian tetap melihat jam operasional toko, bukan jam perangkatnya.
- Locale tetap `id-ID`. Nilai kosong/tak terbaca jatuh ke fallback teks milik
  masing-masing layar (`—`, nilai mentah, atau "Belum disimpan") — jangan
  pernah menampilkan `Invalid Date`.
- **Varian stok < min = tak tersedia (2026-09-20).** Varian yang stoknya di
  bawah minimum (stock < min_qty, stock ≠ -1) tidak bisa dibeli dalam jumlah
  berapa pun — tampilkan sebagai tak tersedia ("STOK < MIN" di PDP,
  "Stok < min" di modal) dan tolak di keranjang, bukan dead-end di checkout.
- **Stok efektif unique (2026-10-02, insiden Head 18 Bulan).** Varian
  `unique` (satu secret per unit) menampilkan `Sisa` = min(kolom stock, unit
  `available` inventory) — bukan kolom mentah. Unit habis (0) = HABIS walau
  kolom masih > 0. Berlaku di kartu varian PDP, teks "Sisa N" stepper, plafon
  qty, auto-pilih varian tunggal, dan quote checkout.
- **Stok TOTAL + mobile paritas (2026-10-02 sore, revisi: "Stok: 21" padahal
  Head HABIS + mobile "Sisa 1").** Angka `Stok:` PDP/kartu = jumlah stok
  EFEKTIF varian yang bisa dibeli — varian unique tanpa unit menyumbang 0
  (0+20=20, bukan 1+20=21). Harga kartu ikut varian yang benar-benar bisa
  dibeli. Panel varian mobile (bottom-sheet QuickVariantModal) memakai aturan
  efektif yang SAMA dengan picker desktop — tidak ada lagi jalur baca kolom
  mentah.

### 5.7a Halaman Lacak Pesanan `/lacak-pesanan` (2026-09-17, live)
- Riset pola marketplace (Shopee/Tokopedia/Apple order tracking): satu form
  hero (kode + WA, tanpa login) → hasil timeline vertikal 3 tahap
  (Dibuat → Pembayaran → Diproses) dengan ikon IosIcon + garis penghubung,
  bukan teks status mentah. Auto-refresh 10 detik hanya saat Pending.
- Konsistensi AXVARA: `ax-glass-card` rounded 24–28px, JetBrains Mono untuk
  kode, badge Pending gold / Lunas emerald / Batal red / Kedaluwarsa muted,
  CTA cyan solid + bantuan tier-2 pill outline + ikon brand (revisi proporsi
  2026-09-18, sama dengan halaman `/pesanan/[code]`: Tier 1 navigasi grid 2
  kolom, Tier 2 "WA Admin"/"Telegram" di bawah "Butuh bantuan?"; tombol
  kondisional primary `Buka Halaman Pembayaran / Buat Pesanan Baru / Lanjut
  Belanja` full-width `col-span-2`), FAQ `<details>` + kartu cara 1-2-3 seperti
  `/cara-order`. Mobile-first max-w 720px, tap target ≥44px.
- Privasi: verifikasi `POST /api/orders/lookup` (kode + WA dinormalisasi
  08/+62/62 atau email checkout huruf kecil, banding `constantTimeEqual`), 404 generik untuk kode-salah
  maupun kontak-tidak-cocok (anti-oracle enumerasi), WA/email tampil mask,
  rate-limit scope `orders:lookup` yang sama dengan lookup lain.
- Nyaman: validasi inline format kode & WA, tombol Salin kode, riwayat lokal
  5 terakhir (`axvara-track-recent`, mask WA), deep-link `?code=&wa=` dari
  chat bot, tautan "Lacak pesanan lain" tanpa reload halaman.
- "Pesanan di perangkat ini" (`DeviceOrders`) tampil DI BAWAH "Terakhir
  dilacak" (2026-09-27, permintaan owner — dulu paling atas menutupi form) +
  accordion `<details>` **collapsed default**: ringkas judul + badge jumlah +
  pil "N belum dibayar", daftar status server hanya dimuat saat dibuka.
  Fetch status tetap lazy per baris non-final (hemat kuota `orders:lookup`).

### 5.7a2 Halaman Link-in-Bio `/link` (2026-09-27, pengganti Linktree bio IG)
- Satu kolom `max-w-[480px]`: logo Prism + `@axvara.tech` + tagline + 3 badge
  trust (Order Tanpa Login / Bergaransi / Fast Respon), lalu 6 tombol
  (Katalog Web → `/`, Bot Telegram `?start=beli`, Grup WA, Lacak Pesanan,
  WA Admin, Telegram Bantuan) + tombol share + footer third-party.
- Ikon AXVARA style: aset brand resmi (`telegram.svg`,
  `whatsapp-circle.svg`) + aset question upload owner
  (`support-wa-question.png` hijau untuk WA Admin,
  `support-telegram-question.png` biru untuk Telegram Bantuan) + glyph SVG
  outline (globe/track) — TANPA emoji.
- Semua 6 pill outline biru glossy tipis seragam (`border-[#00E5FF]/25` +
  `bg-[#00E5FF]/[0.08]` + glow, hover `/50` + `/[0.12]`) — dikembalikan
  2026-09-27 (keputusan owner, versi netral kurang terlihat; ROLLBACK: revert
  commit ini); hint Katalog = "Semua tools premium" (tanpa "checkout QRIS").
- Animasi tipis: `fadeInUp` stagger 60ms per tombol (`ease-apple`), glow
  radial cyan + gold di header, hover border + active scale 0.98. Hormati
  `prefers-reduced-motion` via token global.
- Tombol share: `navigator.share` bila ada, fallback salin `axvara.tech/link`
  via clipboard + toast; ikon berubah centang + label "Tautan disalin".
- Tanpa chrome global: navbar/footer/bottom-nav/reminder disembunyikan di
  `/link` (fokus ala Linktree), masuk sitemap + skeleton `content`.
  Tap target ≥44px (tombol `min-h-[64px]`, share `h-12`).

### 5.7e Bottom Nav Mobile (revisi 2026-10-03; sebelumnya 2026-09-25)
- Empat tab: **Beranda · Kategori · Pesanan · Bantuan** (2026-10-03: Keranjang
  DIHAPUS — drawer yang sama dibuka dari tombol Keranjang navbar yang selalu
  sticky + tiap kartu produk; nav bawah justru hidden di PDP/checkout.
  Riwayat: 2026-09-25 Beranda · Keranjang · Pesanan · Bantuan; sebelumnya
  Beranda, Artikel, Cara Order, Lacak, Katalog). Bar, tinggi, dan gaya aktif
  (cyan + titik glow) tidak berubah. Tersembunyi di `/admin`, `/checkout`,
  `/produk/*`.
- Kategori membuka bottom-sheet solid `#0B1025` (cermin Bantuan): Semua +
  6 taksonomi (fallback lokal → `/api/categories`); pilih → filter katalog
  + scroll `#katalog`. Keranjang tetap milik navbar (badge Gold).
- Pesanan → `/lacak-pesanan` (aktif juga
  di `/pesanan/*`), titik Gold bila ada pesanan perangkat ini yang belum
  dibayar (maks 30 menit — order QRIS mati 15 menit sejak 2026-10-11). Badge/titik baru muncul setelah mount (isi
  localStorage tidak dikenal server).
- Bantuan membuka bottom-sheet solid `#0B1025` (pola QuickVariantModal):
  dua tombol kontak WA Admin + Telegram (ikon brand), lalu daftar Cara Order,
  Garansi & Replace, Artikel (ikon cyan dalam kotak `#00E5FF/10`, judul +
  keterangan satu baris, chevron). Ikon dekoratif `aria-hidden`.
- `/lacak-pesanan` membuka bagian **"Pesanan di perangkat ini"** di atas form
  (maks 5 pesanan 30 hari terakhir): nama produk, kode mono cyan, waktu +
  total, badge status (Menunggu pembayaran Gold, Selesai/Lunas emerald,
  Lunas · sedang diproses cyan, Pengiriman bermasalah merah, Dibatalkan/
  Kedaluwarsa muted), tombol "Bayar sekarang" (cyan solid) atau "Lihat
  pesanan" (outline), dan tombol sembunyikan per pesanan.

### 5.7b Framing QRIS di /pesanan/[code] (2026-09-16, live)
- Urutan vertikal: label **"Scan QRIS"** (font-display 20px bold putih) →
  kotak QR putih `max-w-[330px] rounded-2xl p-3` (QR + quiet zone TIDAK
  tersentuh) → lockup resmi (logo + teks lengkap **"National Payment
  Standard"**, tidak terpotong "...") → Total bayar → kode unik →
  countdown → Download.
- Lockup: `public/brand/qris.svg` (logo resmi QRIS Bank Indonesia versi
  mono putih untuk bg gelap, sumber Wikimedia Commons `Logo_QRIS.svg`
  karya BI) + teks Inter 14px `white/70`, `aria-label="QRIS National
  Payment Standard"`.
- Framing MURNI frontend — generator `src/lib/payments/qris-png.ts` dan
  route `/api/payments/qris/[code]/image` TIDAK disentuh (QR tetap murni
  agar scan + file unduhan tidak rusak). Berlaku hanya di cabang QR aktif;
  state kedaluwarsa/lunas/dibatalkan tidak ikut.

### 5.7c Status "Pengiriman Produk Bermasalah" di /pesanan/[code] (2026-09-24, PR audit ronde 4)
- Order lunas dengan `fulfillment_status='failed'`: ikon silang merah
  (`close-96` + filter merah, sama dengan Dibatalkan), judul "Pengiriman
  Produk Bermasalah", badge merah `border-red-500/25 bg-red-500/15
  text-red-300` "Lunas — Perlu Bantuan", dan panel merah
  (`aria-label="Pengiriman bermasalah"`) berisi langkah hubungi admin yang
  menggantikan panel "Pengiriman Produk" (estimasi 5–15 menit tidak tampil).
  Pola dan teks selaras dengan `/lacak-pesanan` (ronde 3).
- Drawer keranjang: catatan bawah kini "Bayar via QRIS — semua e-wallet &
  m-banking" (dulu "QRIS / DANA / SeaBank", padahal E-Wallet/SeaBank
  maintenance sejak 2026-09-17).

### 5.7d Pengingat Melayang "Pesanan belum dibayar" (2026-09-24, PR storefront)
- Komponen `PendingOrderReminder` (layout root), tampil di seluruh
  storefront kecuali `/checkout`, `/pesanan/*`, `/lacak-pesanan` (sejak
  2026-09-25: daftar "Pesanan di perangkat ini" sudah memuat tombol Bayar), `/admin`.
- Posisi: mobile/tablet `fixed inset-x-3` dengan `bottom: 84px + safe-area`
  (di atas nav bawah & bar beli PDP, jarak ±13px); `lg+` kanan bawah
  `bottom-6 right-6 w-[380px]`. `z-40` (sama dengan nav bawah, di bawah
  navbar/dialog).
- Panel **hampir solid** `bg-[#0B1025]/95` + `backdrop-blur-xl`, border
  Gold `#FFB800/30`, radius 2xl. Kaca `ax-glass-strong` (45%) ditolak:
  ikon orbit hero menembus teks.
- Isi: ikon jam Gold dalam lingkaran `#FFB800/15` → judul 13px semibold
  ("Pesanan belum dibayar" / "QRIS hangus") → sub 12px `white/60`
  ("Bayar dalam" / "Sisa waktu") + timer `font-mono` bold Gold → tombol
  Cyan `#00E5FF` ("Bayar" / "Perpanjang") → ✕ `aria-label="Tutup pengingat"`.
- Timer berada DI LUAR area `truncate`: di layar 390px label boleh
  terpotong, hitung mundur tidak (versi awal menyembunyikan timer di mode
  perpanjang). Timer `aria-live="off"` agar pembaca layar tidak dibanjiri
  tiap detik; container `role="region"`.

### 5.7e Gambar Open Graph (2026-09-24)
- `public/og/axvara-og.png` 1200×630 (±160 KB): Midnight `#080C1E`, glow
  Cyan kanan atas + Gold kiri bawah, mark Prism + wordmark AXVARA,
  headline "Satu Gerbang, / Semua Tools Premium." (baris 2 gradasi Cyan),
  pill kategori + "QRIS otomatis" (Gold), domain di kanan bawah. Dipakai
  preview link WhatsApp/Telegram/Facebook untuk halaman tanpa gambar
  sendiri (produk & artikel memakai gambarnya masing-masing).

### 5.8 Admin UI (Clean, Bukan Glass Berat)
- Sidebar midnight solid, main area `bg-[#080C1E]`
- Kartu stat: glass subtle, angka besar Space Grotesk
- Tabel pesanan: glass row, status badge (Pending kuning, Lunas hijau), foto bukti thumb klik untuk lightbox
- Form produk: 2 kolom, upload drag-drop, preview, kategori select

**Aturan konsistensi admin (2026-09-19, live).**
- **Judul section wajib.** Tiap section punya `h2` + satu baris deskripsi di
  header cardnya. Produk sebelumnya satu-satunya section tanpa judul apa pun.
- **Dialog selalu bertema.** `confirm()`/`alert()` bawaan browser dilarang di
  panel admin — pakai `ConfirmDialog` (hapus) atau toast (error). Dialog OS
  putih-abu di atas panel midnight adalah cacat visual, bukan pilihan.
- **Modal = dialog yang sah.** Setiap overlay wajib `role="dialog"` +
  `aria-modal="true"` + tutup dengan Escape + `body` scroll-lock, mengikuti
  `ConfirmDialog` dan `ProductEditorModal`.
- **Chip filter aktif.** Filter yang sedang menyaring daftar harus terlihat
  sebagai chip yang bisa dilepas (cyan `#00E5FF` untuk Pesanan, amber
  `#FFB800` untuk Stok menipis). Tanpa chip, daftar tersaring terlihat seperti
  data hilang.
- **Satu label = satu satuan.** Metrik dengan nama sama di dua layar wajib
  memakai basis hitung yang sama.
- **Form panjang = tab + aksi sticky (2026-09-20).** Modal yang memuat lebih
  dari satu pekerjaan dipecah dengan tab, dan tombol simpan hidup di footer
  `shrink-0` di luar area scroll. Patokan: tombol simpan tidak boleh berada
  di luar layar saat admin mengedit baris paling bawah.
- **Menu sidebar hanya untuk tempat kerja.** Layar yang diatur sekali
  (token integrasi) atau baca-saja (daftar subscriber) jadi tab di dalam
  Pengaturan, bukan slot sidebar sendiri. Nilai `?section=` lama tetap
  dipertahankan agar tautan/bookmark tidak mati.

---

### 5.9 Ekosistem dan Pedia Compact (Working-Tree 2026-10-12)

**Status:** implementasi lokal, BELUM deployed; tidak ada perubahan flag. Bagian ini menggantikan spesifikasi overhaul 2026-10-11 (semua produk di awal, dua tombol quote/order, footer khusus Pedia). Bukti QA overhaul lama tidak otomatis membuktikan diff terkini; spesifikasi detail ada di `PEDIA-DESIGN.md`.

- Menu `ServicesMenu` di kedua navbar berisi Market/Pedia, ikon/nama/fungsi lengkap, tanpa placeholder AI. Disclosure memakai keyboard native + panah/Home/End, Escape mengembalikan fokus; panel mobile fixed dan desktop absolute. `CrossServicePromo` saling menautkan beranda dengan UTM; CommunityBar Market menjadi Pedia + Bot Telegram Market (2026-10-12: dua kartu kembar compact `min-h-[64px]`, tanpa eyebrow "LAYANAN AXVARA"/"KANAL ORDER MARKET", satu gaya `ax-glass-card` yang sama, panah `ArrowUpRight` yang sama di kedua kartu, `flex-row` berdampingan di mobile; deskripsi `line-clamp-2` agar tinggi sejajar 64px), grup WA tetap footer dan `/link`.
- Satu `Footer` untuk kedua layout: brand ekosistem, sosial + WhatsApp, Layanan AXVARA (Market/Pedia saja), bantuan/ketentuan/pelacakan kedua layanan, newsletter dan pill komunitas. Revisi 2026-10-15: kategori, Semua produk, AI & teknologi serta teks chat/jam layanan dihapus dari footer; detail ikon/pill di §9. Tautan lintas host absolut; tidak ada janji global Bergaransi/Aktivasi 5–15 menit. Padding mobile memperhitungkan bottom nav/sticky CTA dan safe area.
- Hero glass terukur dengan glow cyan statis, judul "Satu tempat untuk / optimasi media sosial." (putih) statis, typewriter dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit). Area suffix stabil, visual aria-hidden dan teks lengkap sr-only; reduced motion statis, timer berhenti saat tab tersembunyi.
- Beranda Pedia 1:1 Market (2026-10-12): container `max-w-[1280px] px-4 sm:px-6 lg:px-8` (layout Pedia, dulu 1120/px-4); hero TANPA card — glow section-level cyan+gold ala Market, h1 `font-display` 700 42/56px tight "Satu tempat untuk / optimasi media sosial." putih statis, typewriter dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit), sub 15px/white-60, tanpa eyebrow AXVARA PEDIA; kartu ganda `PediaServiceCards` (Market + Bot Telegram, kembar compact `min-h-[64px]` `ax-glass-card` + panah sama, `flex-row` mobile); judul katalog `font-display` 20/24px; fallback Jelajahi layanan TANPA sub-teks.
- Form tetap tiga kelompok/radio native/paket-only, tier/jumlah awal null. Harga awal tiap tier menyebut jumlah; ringkasan Belum dipilih sampai memilih. Ganti tier yang tidak mendukung jumlah mengosongkan jumlah, bukan memilih diam-diam. ETA mulai/selesai dan refill bersyarat tetap faktual.
- Satu CTA per viewport Lanjut ke pembayaran meminta quote otomatis; bila total berubah atau kredit dimasukkan, tampil nominal dan Setujui & lanjut ke pembayaran sebelum order. Rail desktop 320px sticky, mobile ringkasan inline + sticky CTA/safe area, bottom nav tersembunyi pada order; invalidasi quote/fokus error/retry token sama tetap ada. Order tutup hanya pesan dekat CTA, tanpa kelompok kontak/kredit/S&K atau banner hero.
- Admin mengikuti shell lama: lima panel, filter provider, buat produk/tingkat nonaktif, editor terpisah dan preview storefront tersimpan terpenuhi memakai `ProductCard` aktual + `OrderClient` embedded dalam mode preview aman. Draf tetap privat; tingkat nonaktif dengan paket layak ikut kurasi, navigasi/pemesanan disabled dan interaksi preview tanpa panggilan API. CTA mobile inline, bukan fixed; input belum disimpan tidak ikut (unsaved live preview di luar scope). Status Terbit/Pilihan AXVARA/Siap diproses terpisah, API refill berbeda dari masa refill kurasi. Saldo/health/pricing/sync tiap provider ada di Pengaturan; partial save/reprice/error jujur. Hasil final aktual MAIN setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau seluruh gate live lulus. Tetap lokal, BELUM deployed; secret/flag tidak diubah, tanpa order supplier nyata. Kurasi awal produksi/approval owner dan bukti currency/rate-unit live tetap pending.

## 6. Animasi — Apple Motion

### Prinsip
- Semua animasi di bawah 500ms, terasa spring bukan linear
- Pakai `transform` dan `opacity` saja (GPU), jangan animate width/height
- Hormati `prefers-reduced-motion: reduce` → matikan parallax & spring

### Token

```css
--ease-apple: cubic-bezier(0.32, 0.72, 0, 1);
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
--duration-fast: 180ms;
--duration-base: 300ms;
--duration-slow: 420ms;
```

### Animasi Spesifik

| Elemen | Animasi |
|--------|---------|
| Hero glow | `parallax: translateY(scrollY * 0.15)` + opacity fade |
| Kartu produk masuk | `fadeInUp: translateY(16px)→0 + opacity 0→1`, stagger 60ms per card, saat masuk viewport (IntersectionObserver) |
| Hover kartu | `translateY(-4px) + border glow` 300ms ease-apple |
| Drawer open/close | `translateX(100%)→0` 420ms ease-apple + overlay fade 300ms |
| Modal checkout | `scale(0.96)→1 + opacity 0→1` 300ms ease-out |
| Badge count | `scale(1.4)→1` 200ms spring saat tambah keranjang |
| Button press | `scale(0.98)` 100ms |
| Toast | `slideUp + fade` 300ms, auto dismiss 3s |
| Page transition | Bar cyan 3px di atas: merayap `scaleX 0.08→0.9` (14 dtk, ease-out) selama menunggu server, penuh + fade 220ms saat rute tampil; skeleton rute tujuan fade-in 150ms (lihat 6.1) |

### 6.2 Performa Mobile Beranda (2026-10-06, PageSpeed mobile 85 vs desktop 99)

LCP 3,9 dtk + Speed Index 4,5 dtk di Moto G Power 4G-throttle. Aturan yang
kini berlaku (tanpa mengubah tampilan):

- 4 kartu pertama `eager + fetchPriority high` (LCP di atas lipatan),
  kartu 5+ `lazy`; kartu ke-9+ `content-visibility: auto` (paint jauh
  dilewati browser).
- Animasi orbit mobile ditunda sampai browser senggang
  (`requestIdleCallback`, fallback 1,2 dtk); desktop langsung jalan.
- JetBrains Mono tidak di-preload (bukan critical path); Inter + Space
  Grotesk tetap preload.

### 6.1 Loading & Jaringan Lambat (2026-09-24, PR loading storefront)

Prinsip: **tidak ada klik yang bisu.** Pembeli di jaringan lambat harus melihat
respons dalam ≤120 ms dan tahu apa yang sedang ditunggu.

| Situasi | Umpan balik |
|---|---|
| Pindah Market ↔ Pedia | Logo aplikasi tujuan tetap, ring cyan di luar disk berputar linear 1 dtk dan pulse logo 2 dtk; overlay segera mengikuti klik, tidak menahan navigasi; Back/pageshow membersihkan overlay. Reduced motion menghentikan ring/pulse. |
| Klik link/kartu/nav internal | Setelah 120 ms (navigasi instan tidak berkedip): bar cyan + skeleton halaman tujuan menutupi halaman lama di bawah navbar. 8 dtk → pil "Koneksi lambat — halaman masih dimuat…" (border gold), 20 dtk → "Halaman belum terbuka. Coba lagi · Batal" |
| Checkout kartu / Beli Langsung / Beli Sekarang / modal varian | Tombol nonaktif + spinner "Membuka checkout…" sampai checkout tampil; modal varian TIDAK menutup sendiri |
| Tombol Bayar | Label bertahap: "Membuat pesanan…" → 4 dtk "Menyiapkan QRIS…" → 12 dtk "Koneksi lambat, tetap di halaman ini…"; sukses → layar "Pesanan dibuat" + kode + "Membuka halaman pembayaran QRIS…" (8 dtk → tautan manual). Putus jaringan → "Koneksi terputus… Tekan Bayar lagi — pesanan yang sama dilanjutkan, tidak dibuat dobel" |
| Harga & metode checkout | Spinner "Memuat harga & metode pembayaran…" + 8 dtk pesan lambat; timeout 25 dtk → pesan + Coba lagi |
| QR di `/pesanan/[code]` | Kotak putih ukuran tetap (aspect-square) + spinner "Memuat QRIS…", fade-in saat gambar siap; gagal → "QRIS gagal dimuat" + "Muat ulang QRIS" |
| Varian PDP | Netral (bukan merah) "Memuat pilihan varian…" + spinner; sticky bar mobile nonaktif "Memuat varian…"; gagal → merah + Coba lagi |

Skeleton memakai `.ax-skeleton` (shimmer 1.6 dtk) dengan bentuk yang sama
antara overlay navigasi dan loading di halaman itu sendiri
(`Skeletons.tsx`), sehingga peralihan tidak melompat. Setiap skeleton punya
`role="status"` sr-only. `prefers-reduced-motion`: bar statis 60%, shimmer
dimatikan.

---

## 7. Responsive Breakpoints

| Breakpoint | Width | Grid Produk | Navbar | Checkout |
|------------|-------|-------------|--------|----------|
| Mobile | 320–640 | 1 col | hamburger + search di bawah | 1 col stack |
| Tablet | 640–1024 | 2 col | search pill tengah | 1 col |
| Desktop | 1024–1280 | 3 col | full | 2 col (form + ringkasan) |
| Wide | 1280+ | 4 col | full + max-width 1280 centered | 2 col |

---

## 8. Aksesibilitas & Detail

- Fokus ring: `0 0 0 3px rgba(0,229,255,0.35)` — selalu terlihat
- Kontras: teks utama 15:1, muted 5.5:1 (WCAG AA)
- Alt text wajib untuk semua gambar produk & QRIS
- Tombol min 44px tap target
- Warna bukan satu-satunya penanda status (ikon + teks)
- QRIS dinamis punya alt text berisi kode order tanpa mengekspos payload mentah sebagai teks

---

## 9. Asset

- **QRIS:** KlikQRIS diproxy sebagai PNG same-origin per order; invoice DANA/GoPay lama dirender dari payload merchant server-only; tidak ada aset QRIS statis publik. Framing (label + lockup) murni frontend di `/pesanan/[code]` — lihat §5.7b
- **Logo QRIS resmi:** `public/brand/qris.svg` (mono putih, sumber resmi BI via Wikimedia Commons; JANGAN ketik ulang dengan font / comot JPG)
- **Logo:** Wordmark "AXVARA" Space Grotesk Bold, X stylized sebagai vault gate (gap di tengah X dengan glow cyan). Versi light di dark bg. SVG.
- **Ikon:** Lucide React (outline, 20px, stroke 1.75)
- **Ikon dan pill footer bersama (2026-10-15, implementasi; publikasi CI):**
  baris ikon berurutan Instagram, Threads, TikTok, Facebook, WhatsApp.
  Empat sosial memakai SVG Simple Icons satu tone `text-white/60`;
  WhatsApp memakai SVG `currentColor` satu tone `text-white/60`, ukuran
  18px dan hover yang sama dengan sosial lain (revisi 2026-10-15).
  Tombol bulat glass `h-11 w-11` (44px), `aria-label` + `title`,
  `_blank noreferrer`; WhatsApp menuju `https://axvara.tech/wa?pesan=Halo%20AXVARA`.
  Di bawahnya pill **Grup WA** hijau `#25D366` dan **Bot Order Telegram**
  biru `#2AABEE`, background transparan 10%, border 25%, teks 11px,
  tinggi minimum 36px, ikon brand WA 18px/Telegram 16px dari aset lokal.
  Pill membungkus bila ruang sempit; label aksesibel bot menyebut Market.
  Navigasi Layanan AXVARA/Bantuan berdampingan di mobile, brand/newsletter
  selebar dua kolom; desktop empat kolom. Tanpa kategori maupun teks jam
  chat. `sameAs` JSON-LD tetap empat sosial + Telegram.
  Dikunci `tests/{footer-social,ecosystem-navigation}.behavior.test.tsx`.
- **Foto produk (standar 2026-09-15, revisi compose):** Muse Image `compose`
  dengan 2 referensi asli pemilik (`canva.webp` + `gsuite.webp`, 1600×900)
  sebagai kunci gaya — BUKAN prompt-only. Hasil: tight close-up tile huge
  ~85% tinggi frame, background navy luminous + glow halo biru, rim cyan
  kiri tebal + magenta kanan tebal, specular putih atas, refleksi lantai
  terang, emblem 3D glossy besar ~75% muka tile, tile NAPAK. Pelajaran:
  generate prompt-only menghasilkan tile kecil distant (~55%, bg gelap, rim
  tipis) yang dinilai pemilik beda style. Output compose 2096×1184 →
  center-crop 16:9 + resize LANCZOS 1600×900, WebP q82 (~19–32 KB). Upload
  ke R2 `axvara-assets/products/<md5>.webp` via `wrangler r2 object put ...
  --remote --jurisdiction default`, lalu `UPDATE products SET
  image_url='/r2/products/<md5>.webp',
  images='["/r2/products/<md5>.webp"]' WHERE slug=...` di D1 remote.
  Live compose 2026-09-15: 12 produk (netflix, spotify, chatgpt, loklok,
  capcut, claude, leonardo, getcontact, apple-music, vidio, viu, zoom);
  youtube diganti manual oleh pemilik (skip).

---

## 10. Referensi Visual

- Apple Store: https://www.apple.com/store — hero, kartu, whitespace
- Linear.app — glass + dark premium + motion
- Vercel.com — grid + tipografi
- Marketku.id — flow fungsional (bukan visual)

## Ringkasan admin — revisi 2026-10-15

Identitas Midnight/Cyan/Gold dipertahankan. Enam metrik di atas; baris berikutnya grid desktop 2:1 berisi grafik omzet/untung responsif dan donat kontribusi omzet. Di bawahnya dua panel batang untung supplier/channel, lalu Top 5 dengan nama membungkus dan rincian modal/margin. Mobile satu kolom. Semua visual mengikuti periode terpilih; grafik mengukur container agar tidak meninggalkan ruang kosong besar, garis nol dan merah menandai rugi, jumlah order memiliki sumbu emas tersendiri. Donat memakai omzet agar persentase tidak ambigu ketika untung negatif. Placeholder/tooltip dan akses titik lewat keyboard tersedia. Panduan pasca-bayar stok sendiri menggunakan komponen accordion ProductCopy yang sama dengan supplier, judul Syarat & Ketentuan serta Cara Penggunaan / Aktivasi, terpisah dari kotak kredensial.

### Admin dan transisi — 2026-10-15

- Ringkasan: grid grafik memakai satu kolom minmax(0,1fr) pada mobile agar lebar intrinsik SVG tidak memicu scroll horizontal. Preset periode di kiri dan pemilih bulan/rentang di kanan dalam satu toolbar tanpa card, catatan batas atau tombol Terapkan. Bulan berubah langsung berlaku; rentang menunggu dua tanggal lengkap/valid. Rentang/WIB/waktu pembuatan sejajar baris sesi admin di atas, membungkus pada mobile. Teks total/pending/stok menipis dan kartu estimasi modal dihilangkan. Saat fetch loading/error, metadata, angka dan unduhan lama disembunyikan. PDF/Excel sejajar di samping pemilih bulan/tanggal pada toolbar yang sama, membungkus saat layar sempit, memakai styling glass yang sama dan state menyiapkan/gagal yang jelas.
- PDF: A4 putih, header Midnight + aksen cyan, tabel berpaginasi dengan header diulang; periode, WIB, modal estimasi dan batas definisi untung dicantumkan. XLSX berisi Ringkasan/Harian/Supplier/Channel/Top Produk, header Midnight, kolom angka numerik dan label membungkus.
- Sakelar banner berada tepat sebelum Edit, track 46×24 px hijau/abu dan knob putih 18 px sama seperti Produk; role switch/aria-checked/aria-busy, fokus keyboard, disabled saat menyimpan dan error terkait tetap tersedia. Di mobile grup aksi turun ke baris sendiri. `AdminStatusSwitch` dipakai Banner dan Pedia.
- Snapshot15Oktober Pedia admin: tabel `ax-glass rounded-[20px]` seperti Produk, header uppercase11px, sel px-4/py-3, divider white/5 dan hover white/3. Struktur tabel mobile/kredit diganti oleh revisi Admin Pedia IndoSMM13November di atas; CTA cyan, Edit putih dan sakelar Market tetap.
- Rekonsiliasi menampilkan konfigurasi provider efektif dan label event-owned; judul netral Rekonsiliasi QRIS, panduan GoBiz untuk GoPay dan QRIS Hook untuk DANA legacy.
- Logo overlay CrossAppTransition memakai brightness-0 invert agar SVG eksternal terlihat putih; filter X menyembunyikan label visual yang mengulang ikon, tetap aria-label X dan target 44px.


## Pengambilan data admin/pesanan — revisi 2026-10-19

✅ Implementasi; publikasi melalui CI. Katalog admin dimuat ketika masuk Produk;
menu lain tidak memunculkan loading/error katalog. Kembali ke Produk memakai
loading/retry existing dan data baru, termasuk navigasi back/forward. Tidak
mengubah layout/token/editor. Polling Market berhenti saat tab tersembunyi dan
mengecek segera saat kembali, selama jatah polling masih ada; countdown dihitung
ulang dari waktu aktual. Indikator interval dan tombol Cek Pembayaran tetap,
tanpa overlay/notifikasi tambahan. Webhook/pengiriman tidak bergantung tab.

## Pengambilan data Ringkasan — 2026-10-16

✅ Implementasi, publikasi melalui CI: section admin selain Ringkasan tidak memuat
laporan keuangan di latar. Masuk Ringkasan atau mengubah periode tetap memakai
skeleton/loading/error existing dan melindungi hasil dari respons terlambat.
Laporan standar berasal dari agregasi bersama. Revisi 2026-10-19: snapshot
keuangan privat maksimal lima menit menampilkan waktu pembuatan aktual;
status operasional Ringkasan memakai cache maksimal 60 detik. Nilai layar dan ekspor memakai
laporan yang sama; layout, token, animasi dan kontrol periode tetap. Katalog
publik memakai cache singkat sesuai PRD; harga/stok divalidasi ulang saat checkout.


### Maintenance kuota D1 — 2026-10-17

✅ Implementasi, publikasi melalui CI. Dokumen mandiri tanpa navbar, keranjang,
JavaScript atau permintaan API. Latar Midnight #080C1E dengan glow cyan statis,
kartu maksimal 560px/radius 28px, logo prism putih dari geometri mark existing,
judul “Kami sedang maintenance” langsung setelah brand tanpa pill status atau
titik kuning (revisi 2026-10-17). Kartu estimasi cyan menampilkan 07.00–08.00 WIB dan tanggal kalender WIB berikutnya
sesuai reset UTC. Teks “pagi nanti” menghindari ambiguitas hari setelah tengah
malam. Tombol utama putih “Order manual via WhatsApp” menuju hub /wa; tombol
kedua “Coba buka toko lagi” memuat beranda. Catatan menyebut estimasi dan bantuan
bagi yang sudah membayar. Hub saat maintenance menampilkan hanya nomor aktif
dari registri kontak existing, support Telegram dan jam layanan; konteks pesan
tetap terbawa. Padding 18px luar/20–32px kartu, kontrol minimal 48px dan outline
fokus cyan; jarak brand ke judul 32px. Layout mengalir dan dapat digulir pada
layar kecil, tanpa animasi atau aset/font jaringan yang dibutuhkan untuk membaca dan memakai tombol.


### Kesegaran katalog dan Ringkasan — 2026-10-17

✅ Implementasi, publikasi CI. Katalog/filter/cari/bestseller Telegram berbagi
snapshot publik 30 detik dengan format pesan dan tombol existing; detail serta
checkout tetap memvalidasi data aktual. Seluruh respons Ringkasan memakai cache
privat maksimal 60 detik setelah auth. Revisi 2026-10-19: data keuangan berbagi
snapshot terenkripsi maksimal lima menit lintas proses per lokasi Cloudflare;
perpindahan periode/proses tidak memperpanjang umur snapshot. Waktu pembuatan
laporan tetap waktu sebenarnya; skeleton/loading/error dan layout/token tetap.
Laporan kuota berkala berada di GitHub Actions summary/artifact, tanpa kontrol
atau polling baru pada layar pelanggan/admin.

## Histori Pedia admin — ringkasan katalog otomatis + resync resumable (12 November 2026)

Snapshot historis, diganti revisi Admin Pedia IndoSMM13November di atas; bukan instruksi menghidupkan kembali UI ini. Pada12November lapisan informasi ditambahkan pada shell admin dengan token Midnight/Cyan/Gold, SF Pro, `ax-glass`/`ax-liquid` existing.

- **Ringkasan katalog otomatis** (`PediaCatalogSummary`, tepat di bawah judul "Pedia"): kartu `rounded-xl border-white/10 bg-white/[0.03]` berisi lima metrik label-nilai (Layanan cermin, Tier otomatis, Aktif dijual hijau, Ditahan amber, Antrean sinkron) memakai `tabular-nums`. Satu baris "Deskripsi resmi diperbarui: …" dan maksimal empat alasan blokir teratas (label manusiawi, bukan kode mentah) dengan angka di kanan. Data tidak tersedia ditulis "Belum tersedia", bukan 0.
- **Tab Layanan Supplier**: kolom baru "Katalog otomatis" menampilkan status Aktif dijual / Ditahan + alasan berlabel + status deskripsi (tersedia / kosong di sumber / terlalu panjang / belum ada). Filter baru "Kelayakan otomatis" (Semua / Aktif dijual / Ditahan / Belum otomatis) berdampingan dengan filter lama; baris non-otomatis diberi label redup "Belum otomatis". Kontrol form native (`label` terasosiasi, `min-h-11`), fokus `outline-[#00E5FF]`, tabel tetap `DataTable` dengan scroll wrapper berlabel.
- **Tarik ulang (resync)**: dialog konfirmasi lama dipertahankan; selama proses muncul status `role="status" aria-live="polite"` berisi progres "x / y" + jumlah diproses, tombol dan aksi dinonaktifkan, dan kegagalan parsial menampilkan pesan amber tanpa klaim sukses. Tidak ada resync otomatis ketika panel dibuka. Final patch 12 November 2026: status progres DIPERTAHANKAN setelah run (tidak lagi mematikan tombol permanen); kegagalan menampilkan tombol "Lanjutkan sinkronisasi" yang melanjutkan dari cursor terakhir supplier yang sama, dan sukses `done` mengaktifkan kembali tombol serta memuat ulang daftar + ringkasan. Cursor malformed/tidak maju tampil sebagai error, bukan "selesai".
- **Editor tingkat otomatis**: field sumber (nama publik, deskripsi, syarat, ID layanan, batas, refill, mapping) ditampilkan `disabled` dengan keterangan singkat bahwa katalog dikelola sinkronisasi; hanya "Jual layanan ini (jeda/hidupkan penjualan)" dan harga (markup/minimum untung/kelompok) yang aktif. Menjeda menulis alasan manusia sehingga sync berikutnya tidak menyalakannya. PSMM-ACCEPTANCE-CLOSE 12 November 2026: mencoba menghidupkan baris yang masih diblokir mesin (mis. `terms_conflict`/`type_unsupported`) ditolak server (409 `managed_ineligible`) dan UI menampilkan pesan galat; jeda/pricing dan unpause sah tetap berhasil. Catatan jujur: select **Supplier utama** pada form adalah pengecualian — kontrolnya masih tampil aktif, tetapi untuk baris otomatis nilainya TIDAK ikut dikirim di payload PUT dan server membuang field sumber sebelum gate (proteksi tetap di server; ini poles UI opsional, bukan perubahan kode).
- **Default filter**: "Kompatibel link + jumlah" default TIDAK dicentang sehingga semua tipe (Custom Comments, tipe terblokir) terlihat; filter Supplier memuat kedua provider agar riwayat lama bisa didiagnosa, tanpa membuka mapping penjualan baru.
- **Buyer**: tanpa perubahan visual baru; kartu/detail/checkout memakai komponen lama. Nama layanan otomatis dibersihkan dari badge superskrip/emoji supplier dan tetap white-label; deskripsi resmi dirender sebagai teks biasa (`white-space: pre-line`, aman dari HTML). Pencarian memakai `pediaMatches` yang ada dan mencakup seluruh hasil (tanpa batas 8/100).
- **Status**: implementasi lokal (bukan live). QA UI aktual pada build terkompilasi (loopback proxy, auth/API mutasi di-mock; tanpa trafik produksi) lulus 1280/390 untuk pembeli dan admin — termasuk resync cursor/retry, filter server-side, payload editor tanpa field sumber, dan komentar custom — dengan batas jujur: guard supplier-saat-busy hanya code/behavior-test, baris riwayat terisi belum dibuktikan di browser, dan select supplier masih tampil aktif tetapi dilindungi server. Belum deploy, bootstrap produksi, atau QA produksi.

## Games detail — kontrak per varian SK (12 November 2026, lokal)

- Langkah Data akun merender field dari **varian SK terpilih** (bukan metadata game): label/keterangan supplier, wajib/opsional, input teks, batas `note` 50 dan `zone_id` 20. Jenis produk (Membership/region) dan deskripsi plain text tampil pada kartu informasi varian.
- Daftar nominal tidak menggabungkan varian dengan nama/nominal sama; identitas `sk:<id>` dan region/tipe tetap terpisah. Baris off/stok habis/admin-disabled tampil redup dengan alasan; open-denom/unsupported nonaktif.
- Mengganti varian mereset interseksi field, quote, dan nickname; POST memakai `buyer_sku_code` varian aktif. Token/visual tetap Midnight+Cyan+Gold, kartu glass, orbit/hero existing. Nickname sukses ditampilkan sebagai deteksi, bukan jaminan kepemilikan.
- **[DIPERBARUI 14 November 2026]** Label field kini dibersihkan dan label generik pemasok ("Catatan"/"Note"/"Keterangan") diganti label mayoritas game untuk key yang sama; label bermakna per varian dipertahankan. Kartu/daftar nominal memakai section kategori + chip tipe/region (lihat delta di bawah).

Status verifikasi (12 November 2026): QA browser nyata publik 1280/390 lulus (katalog>12, search, varian region/tipe, kontrak field per varian, disabled/unsupported, placeholder gambar, tanpa overflow), dan admin statis pada artefak Next lokal 8792 lulus dengan fixture jaringan browser. Desain existing diterima; bukan bukti auth/backend persist/produksi dan belum deploy. `display_order` tetap API-only (tanpa editor UI) meski header admin menyebut "urutan".

## Games storefront + admin delta — Oura+ditopup, frame P14, kategori (14 November 2026, lokal)

> Implementasi lokal di worktree integrasi; belum publikasi CI/deployment. Token tidak berubah:
> midnight `#080C1E`/`#0F1430`, cyan `#00E5FF` (aksi/terpilih/fokus), gold `#FFB800` (nomor
> langkah + badge "Terlaris"), `ax-glass`, Space Grotesk (judul/harga), Inter (body), Lucide
> 20 px stroke 1.75, tanpa emoji dan tanpa warna baru. Detail kontrak: `docs/GAMES.md` §14.

### Storefront

- **Koreksi owner 14 Nov 2026 malam — halaman detail (lokal):** banner full-bleed kiri–kanan
  tapi ramping (190/260/330 px, fade ke midnight), kartu ikon 3D lebih besar (112/176/212 px), miring
  `rotateZ(-4deg)` + tilt pointer, tepi kaca (ikon di-zoom 1.1 agar sudut putih App Store hilang),
  bayangan berlapis + kilau periodik; badge trust jadi pill kaca dengan spotlight bergiliran 2 s
  dalam siklus 6 s (instan → layanan → aman); setiap tahapan = kartu kaca iOS dengan header strip
  (nomor di squircle gradien cyan→biru, judul 17 px, garis pemisah); Data akun ramping (input 44 px,
  Cek ID satu baris dengan input bila hanya satu field, bantuan + "Ingat ID" satu baris);
  "Nominal sedang tidak tersedia" pindah ke kartu nominal; chip tipe bergaya chip beranda/Pedia;
  kartu nominal ramping ±74 px (nama 12–12.5 px, harga 13–14 px, badge INSTAN/Habis kanan atas,
  centang kanan bawah, kaca + highlight 1 px); badge INSTAN = pill kaca cyan ⚡ + kilau, hanya untuk
  varian yang bisa dibeli; ikon item dinormalisasi `GAMES_ITEM_ICON_SCALE` (sqrt(0.42/luas bbox),
  0.7–1.08) sehingga ikon satuan tidak lebih besar dari tumpukan; pembayaran memakai
  `PaymentMethodPicker` persis seperti Market/Pedia tanpa daftar harga mentah tambahan. Semua animasi
  mati pada reduced motion. Revisi lanjutan (malam, owner): badge trust hero kembali lepas tanpa pill/bulatan, hanya animasi
  ikon bergiliran yang dipertahankan; badge INSTAN dikembalikan ke desain asli (bolt + garis kecepatan SVG, "Pengiriman/INSTAN" |
  "Instant/DELIVERY", kilau saat terpilih) di strip bawah kartu nominal (22 px HP / 28 px desktop, border-top tipis; badge mungil ala Oura, ikon 11/14 px, teks 5.5–7.5 / 6.5–9 px; di HP label tipe disembunyikan); animasi badge: idle diam, hover kartu (pointer) = petir menyala sekali 0,6 s + garis kecepatan melesat, kartu terpilih = denyut halus tiap 2,5 s; teks tidak bergerak; mati pada reduced motion;
  stiker GPT Image dibatalkan atas permintaan owner; hover kartu nominal = outline
  cyan tipis + ikon item miring -10° & scale 1.1 (300 ms, pointer hover saja); memilih nominal lewat
  klik/tap men-scroll halus ke "Metode pembayaran" (block start, kontak ikut terlihat), navigasi
  keyboard tidak men-scroll.
- **Koreksi owner 14 Nov 2026 (larut malam, lokal):** (1) kartu lintas layanan beranda Pedia =
  AXVARA Market + AXVARA Games (kartu Bot Telegram dihapus; Telegram tetap di footer); (2) overlay
  `CrossAppTransition` (logo tujuan + cincin putar + "Memuat AXVARA …") kini juga untuk tujuan/asal
  Games dan terpasang di layout Games; (3) "Cara top up" dihapus juga dari halaman detail game
  (komponen `HowToTopUp` + copy langkah dihapus); (4) "Game lainnya" = karusel horizontal
  `GamesRail` (hingga 16 game, yang bisa dibeli dulu; snap per kartu, panah ‹ › desktop redup di
  ujung, fade tepi, ±6 kartu desktop / ±2,5 kartu HP); (5) footer bersama punya baris "Metode
  pembayaran" di atas © (chip putih 28/32 px: QRIS · GoPay, DANA, OVO, ShopeePay, LinkAja · BCA, BNI,
  BRI, Mandiri, Permata · USDT, BTC, ETH; logo lokal yang sama dengan picker; dekoratif).
- **Koreksi owner 14 Nov 2026 (mobile, lokal):** di <640 px bagian Populer = grid 2 kolom
  kartu ringkas (thumbnail 40 px, nama 12 px 2 baris, publisher 10 px; bila jumlah ganjil kartu
  terakhir disembunyikan di HP agar grid genap), katalog potret = 3 kolom (overlay nama 11 px +
  status 9–10 px, publisher hanya ≥sm), baris chip genre mendapat fade tepi kanan
  (mask 78 %→transparan) yang hilang saat di-scroll mentok kanan (`data-at-end`). Desktop tetap. Tipografi & jarak HP ikut ringkas: judul seksi 18 px (sm 24 px), subjudul/jumlah 12 px, ikon api 20 px, chip genre 32 px/12 px, jarak antarseksi 40 px (sm 80 px).
- **Beranda.** **Koreksi owner 14 Nov 2026 malam (lokal; menggantikan bagian terkait di bawah):** (1) orbit
  hero = 8 game tetap `GAMES_ORBIT` (`mobile-legends`, `pubg-mobile`, `free-fire`, `genshin-impact`,
  `honor-of-kings`, `valorant`, `roblox`, `call-of-duty-mobile`; Free Fire MAX dikecualikan),
  ring 0/1/1/1/2/2/3/3 dan sudut awal per ring `GAMES_ORBIT_PHASE` 200/20/50/110 (prop opsional
  `ringPhase` PediaOrbit; default Pedia tidak berubah), slug yang tak ada diisi game katalog
  berikutnya; (2) ikon populer = Microsoft Fluent Emoji 3D "Fire" (MIT,
  `public/brand/games/ui/fire-3d.webp` 96 px) dengan kedip halus `ax-flame` + glow oranye
  berdenyut 2,6 s; (3) thumbnail populer art di-zoom 1.14 (hover 1.2) agar penuh tanpa sudut putih;
  (4) kilau diagonal kiri→kanan hanya saat hover (`ax-card-sheen-hover`, 0,9 s, intensitas putih/cyan ≤20 %;
  kilau otomatis bergelombang dihapus 15 Nov 2026 — keputusan owner: orbit satu-satunya gerak terus-menerus); (5) hover GameCard: ring
  cyan 1,5 px /70 + inset 4 px, scale 1.02, glow lembut, art zoom 1.08 500 ms ease-out; (6) subjudul
  katalog dihapus; (7) chip genre gaya katalog Pedia: aktif putih solid teks midnight, nonaktif
  `ax-glass-card` border white/10, tinggi 36 px, ikon lucide per genre; (8) beranda tanpa Cara top
  up, kartu kepercayaan dan FAQ (detail game tetap memakai HowToTopUp). Semua animasi
  transform/opacity saja dan mati total pada `prefers-reduced-motion`.
  Hero orbit tetap (pusat kaca 3D + mark putih); planet = **4 game pertama urutan API**
  (bisa dijual dulu, lalu `featured_rank`), bukan empat registry statis, tanpa tumpang tindih label
  di 1280/1440/768/390. **14 Nov 2026 koreksi owner (lokal):** hero, promo ekosistem, cara top up,
  kepercayaan dan FAQ tidak berubah. Aturan beranda berikut menggantikan populer minimum 4 /
  maksimum 8, katalog dibatasi 12 dan kartu `opacity-70` sebelumnya.
  - **Populer sekarang:** ikon `Flame` gold kecil, subjudul existing, kartu horizontal 1/2/3 kolom
    (mobile/sm/lg), tile 64/72 px, nama + publisher. `featured_rank` admin terurut naik maks 9;
    bila kosong, urutan `mobile-legends`, `magic-chess-go-go`, `pubg-mobile`, `free-fire`,
    `genshin-impact`, `honor-of-kings`, `valorant`, `roblox`, `honkai-star-rail`, hanya slug yang
    ada di katalog. Termasuk game belum bisa dijual; sembunyi hanya bila hasil kosong. Latar tint
    ikon blur 2xl opacity 75 %/saturasi 150 %, garis diagonal putih 4 % sudut 115° dan gradient
    midnight hanya di area teks (koreksi owner G2b, 14 Nov 2026: tint tiap game lebih jelas) —
    inspirasi struktur Oura, bukan aset/paletnya. Hover pointer-fine/fokus: lift 2 px, border
    cyan/50 + glow lembut, thumbnail zoom 1.05, transisi 300 ms.
  - **Kategori & katalog:** heading "Semua game" + count hasil filter → subjudul → chip → grid.
    Urutan chip Semua · MOBA · Shooter & Battle Royale · RPG & Petualangan · Olahraga & Balap ·
    Strategi · Kasual & Sosial, hanya genre berisi. Mapping statis `src/lib/games/genres.ts`;
    slug baru/tak dipetakan hanya di Semua. Chip 44 px `aria-pressed`, cyan/15 saat aktif,
    scroll horizontal mobile (bukan overflow halaman), wrap mulai sm, ring fokus cyan.
    Semua game hasil filter selalu dirender, tanpa "Tampilkan lainnya". Grid 2/3/4/6 kolom
    (base/sm/md/lg), count live diperbarui; populer tidak ikut filter genre.
  - **Kartu game portrait — koreksi owner G2b, 14 Nov 2026:** rasio **2:3**, radius 16 px,
    artwork portrait 600×900 full-bleed `object-cover` dari aset lokal resmi, tanpa border/frame
    atau teks terlihat saat diam di pointer-fine/hover-capable. Hover/focus-visible: ring cyan
    3 px + gap inset 3 px, glow, scale 1.045; gradient bawah midnight dan overlay nama putih
    maksimal 2 baris + publisher white/70 + harga/status slide/fade masuk, ease-out 300 ms.
    Touch/no-hover selalu menampilkan overlay nama lebih kecil agar tetap terbaca. Accessible
    name tautan selalu nama game + harga/status, tidak bergantung visibilitas overlay.
    `portrait=null`: fallback ikon square utuh di atas fill ikon blur, tidak memotong logo tepi;
    tanpa harga karangan ("Mulai Rp…" hanya varian bisa dijual, selainnya pill "Segera tersedia").
    Shared dengan "Game lainnya" pada detail, **header detail tetap ikon square**, bukan portrait.
    `GameImage` mempertahankan lazy, async, no-referrer dan monogram bila gagal. Reduced-motion
    meniadakan scale/slide/transisi; overlay/ring/fokus tetap muncul.
- **Header game (revisi 14 Nov 2026, `GameHero`).** Banner `aspect-[16/9]` mobile / `aspect-[21/9]`
  ≥sm, maks 440 px, `object-[center_30%]`, gradient bawah ke #0F1430. Ikon square = **kartu 3D
  melayang** 96 px / 152 px (`detail.module.css`: perspective 700, rotateX 5° rotateY −12°, float
  translateY −6 px 6 s, sheen 7 s, bayangan berlapis + glow cyan; pointer-fine tilt ±10° via rAF;
  reduced-motion = miring statis tanpa animasi). Nama Space Grotesk 700, publisher, lalu baris
  trust lega (`gap-x-6`, 13–14 px medium) dengan ikon SVG duotone animasi 24 px: petir gold
  berdenyut + garis kecepatan "Proses instan", gelembung chat cyan dengan titik mengetik
  "Layanan 24/7", segel verifikasi biru bergoyang + centang tergambar ulang "Pembayaran aman".
  *Snapshot lama: banner 200 px, tile 112/72 px, chip lucide `Zap`/`Clock`/`ShieldCheck`.*
- **Langkah.** `1 Data akun → 2 Pilih nominal → 3 Metode pembayaran → 4 Kontak` (angka gold, kartu
  glass). Langkah 1 langsung berisi field varian tersedia termurah kategori `topup` di chip default
  (Indonesia); tanpa varian tersedia, field varian pertama `disabled` + catatan jujur.
- **Chip tipe/region.** Satu baris pill outline yang bisa digulir horizontal, label + count,
  Indonesia dulu, "Lainnya" untuk tipe null, "Semua" terakhir; hanya tampil bila ≥2 grup. Terpilih =
  border cyan + bg cyan/10.
- **Section kategori.** Judul section `text-base` semibold putih + count redup (urutan: Terlaris ·
  Spesial · Promo · Top up pertama · Pass & membership · Paket mingguan/bulanan · Top up · Lainnya),
  hanya section tidak kosong, semua kartu langsung tampil (tanpa "Tampilkan semua", 14 Nov 2026). Dengan chip "Semua" setiap kartu
  menampilkan `type_label` kecil.
- **Kartu nominal (Oura structure, AXVARA skin).** `ax-glass` rounded-2xl; nama penuh membungkus tanpa dipotong;
  nama 12–13 px medium clamp 2 baris; **ikon item game 32/36 px** (diamond MLBB, UC, Genesis
  Crystal, VP, Robux… 3 tier per peringkat harga; pass/member/gift/pack/promo/special; fallback
  ikon lucide) + harga 14–15 px semibold tabular; strip footer lebih gelap dengan **badge
  "Pengiriman / INSTAN"** (petir + garis kecepatan, italic 8/11 px, cyan on white/6, shimmer
  hanya kartu terpilih) pada kartu tersedia, atau label
  redup "Habis"/"Tidak tersedia" dengan harga tetap terlihat; `aria-disabled`; kartu terpilih border
  cyan + glow + centang; badge gold kecil "Terlaris"; grid 2 kolom mobile / 3 kolom ≥md, tinggi
  seragam dengan tinggi minimum 108 px.
- **Rail & mobile.** Rail desktop sticky 360 px: blok varian terpilih (ikon 40 px, nama, "Ganti"
  yang menggulir ke pencarian nominal), baris Tipe · Proses · deskripsi 2 baris + "Selengkapnya"
  (hanya bila benar-benar terpotong), lalu ID/nickname · Harga · Biaya · **Total**; CTA "Bayar
  Rp{total}". Bar mobile satu baris ±66 px (total kiri, CTA kanan) + safe area.
- **State jujur.** Skeleton saat memuat, error + "Coba lagi" aksesibel, empty state pencarian,
  "Habis" tetap terlihat dan tidak dapat dipilih, hint region berupa callout gold (saran, bukan
  blokir), reduced motion menonaktifkan transisi/animation.
- **Frame P14.** Tile radius 16 px, border 1 px `rgba(255,255,255,.1)`, kaca midnight, glow cyan
  `0.12/20px` saat hover; banner generatif = ikon resmi diperbesar 125 % + blur 48 px + gradient
  midnight + grid halus 32 px (tanpa teks di gambar); monogram gradient midnight→cyan/10 untuk ikon
  hilang. Merek pembayaran/logo brand tidak memakai frame ini.
  **Revisi 15 Nov 2026:** 48 portrait diganti gaya Oura (karakter resmi + logo judul resmi terpanggang di gambar, gradien navy seragam; master 1200×1800 di `scripts/games-assets-src/portraits/`, sumber di `docs/games-portrait-sources.md`); kartu ber-portrait tidak lagi menampilkan overlay nama/publisher/harga (desktop maupun touch), nama tetap di aria-label; game belum tersedia memakai pill kecil "Segera tersedia" di pojok kanan atas; overlay teks hanya untuk fallback ikon.
  **Revisi 15 Nov 2026 (owner):** kartu ikon 3D kini kaca TEGAK saat diam (tanpa roll −4°/condong/melayang/kilau otomatis); kedalaman dari bayangan berlapis + tepi kaca + kilap statis; hover desktop condong mengikuti kursor maks ±5° + kilau sekali; HP & reduced-motion diam. Ikon persegi semua game = potongan area karakter dari master portrait (tanpa logo; manifest `icon.source` lokal + `region`, ikon app resmi lama di `icon.official_source`), sehingga ikon, banner dan portrait memakai karakter yang sama.

### Admin Games

- **Anatomi.** `PageHeader` "Games" + satu kalimat, 4 StatCard netral (Sinkron terakhir · Bisa
  dijual n/total · Supplier nonaktif · Markup default), alert warning agregat bila supplier-off
  >50 %, tab URL Game | Varian | Harga, tautan "Lihat pesanan Games" (outline sm).
- **Tab Game.** Tabel desktop / kartu mobile: ikon, nama + publisher redup, "Bisa dijual n/total",
  Mulai, Markup (badge Default/Khusus), Populer, Switch Tampil, Edit. Sheet editor memakai pola
  round-2 (field dikelompokkan, counter ≤600, preview harga contoh, satu primary Simpan, draft guard,
  Esc → konfirmasi buang).
- **Tab Varian.** Kolom Modal · Markup (badge sumber Default/Game/Varian + "+Rp" tetap) · Harga jual ·
  Margin · **Kategori** (Select "Otomatis (label)" + 8 label penuh; tidak truncate; tabel menggulir
  di dalam region fokusnya) · aksi "Atur markup" (Popover % + Rp tetap + reset) · checkbox + bulk
  toolbar (preset 3/5/8/10 %, "Set kategori"). Badge supplier-off sekunder, bukan peringatan per baris.
- **Tab Harga.** Kartu markup default (2 desimal) + pembulatan Rp1/100/500/1.000 + tiga contoh hidup
  (Rp1.502, Rp50.000, Rp321.115) + "Simpan & hitung ulang" dengan konfirmasi jumlah varian + toast
  "{n} harga diperbarui".
- **Status.** Terang/gelap 1280/390 diperiksa dengan fixture; tanpa overflow halaman (scroll hanya di
  region tabel), tanpa error konsol di luar fixture 503 yang disengaja. Bukan sesi admin produksi.

## Favicon per layanan — 14 November 2026 (lokal)

Favicon lama burik: `public/favicon.svg` Market punya `stroke="white"` di level `<svg>` sehingga
kotak latar ikut bergaris tepi putih, garis prisma ±0,7 px di 16 px; Pedia PNG 64 px dengan mark
kecil; Games tidak punya favicon (ikut Market). Kini tiap layanan punya set sendiri di
`public/brand/favicons/{market,pedia,games}/` dengan glyph yang disederhanakan untuk ukuran kecil
(grid 64: Market = prisma lengkap garis 4,6/4 px; Pedia = bingkai + 2 batang; Games = bingkai +
tuas analog), kotak midnight rx 14 bergradien `#141A3D→#070A1E` + glow cyan 16 % di atas + tepi
putih 10 %. Berkas: `favicon.svg`, `favicon.ico` (PNG 16/32/48), `apple-touch-icon.png` 180 (kotak
penuh tanpa sudut, iOS memberi mask), `icon-192.png`, `icon-512.png`; dirujuk lewat
`faviconIcons()` (`src/lib/favicons.ts`) di layout root/Pedia dan `gamesMetadata`. `public/favicon.svg`
dan `public/favicon.ico` root = set Market (fallback).
