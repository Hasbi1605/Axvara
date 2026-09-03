const fixtures = [
  ["cara-memilih-ai-untuk-kuliah", "Cara Memilih AI untuk Kuliah", "Panduan praktis memilih tool AI untuk riset, menulis, dan presentasi."],
  ["workflow-content-creator", "Workflow Content Creator yang Lebih Cepat", "Rangka kerja sederhana untuk merencanakan, membuat, dan mengevaluasi konten."],
  ["hemat-token-ai", "Cara Hemat Token Saat Pakai AI", "Langkah kecil untuk menjaga biaya penggunaan AI tetap terkendali."],
  ["cek-fakta-jawaban-ai", "Cara Cek Fakta Jawaban AI", "AI membantu memulai riset, tetapi bukan pengganti verifikasi."],
  ["prompt-untuk-desain", "Prompt Desain yang Jelas", "Struktur prompt untuk menghasilkan brief desain yang mudah dieksekusi."],
  ["notion-untuk-freelancer", "Notion untuk Freelancer", "Atur proyek dan klien dengan dashboard yang tidak berlebihan."],
  ["persiapan-presentasi", "Persiapan Presentasi Lebih Rapi", "Cara menyiapkan presentasi singkat yang tetap meyakinkan."],
  ["belajar-coding-dengan-ai", "Belajar Coding dengan AI", "Gunakan AI sebagai teman diskusi, bukan mesin salin-tempel."],
  ["manajemen-file-kreator", "Manajemen File untuk Kreator", "Struktur folder sederhana agar aset mudah ditemukan."],
  ["pilih-tool-produktivitas", "Memilih Tool Produktivitas", "Tool terbaik adalah yang dipakai rutin oleh tim."],
  ["dasar-keamanan-akun", "Dasar Keamanan Akun Digital", "Kebiasaan kecil untuk menjaga akun premium tetap aman."],
  ["riset-produk-digital", "Riset Sebelum Membeli Produk Digital", "Pertanyaan yang perlu dijawab sebelum memilih langganan digital."],
  ["brief-desain-yang-baik", "Membuat Brief Desain yang Baik", "Brief yang jelas mengurangi putaran revisi."],
  ["otomasi-tugas-berulang", "Otomasi Tugas Berulang", "Identifikasi tugas kecil yang aman untuk diotomasi."],
  ["menulis-copy-produk", "Menulis Copy Produk yang Jujur", "Copy yang baik menjelaskan manfaat tanpa klaim berlebihan."],
  ["strategi-belajar-mandiri", "Strategi Belajar Mandiri", "Cara membangun ritme belajar yang realistis setiap minggu."],
  ["review-tool-sebelum-renew", "Review Tool Sebelum Renew", "Evaluasi langganan sebelum memperpanjangnya."],
  ["kolaborasi-tim-kecil", "Kolaborasi Tim Kecil", "Praktik sederhana untuk menjaga pekerjaan tim tetap jelas."],
  ["dasar-analitik-konten", "Dasar Analitik Konten", "Metrik sederhana untuk menilai apakah konten membantu audiens."],
  ["checklist-launch-proyek", "Checklist Launch Proyek", "Checklist ringkas sebelum halaman atau produk baru dipublikasikan."],
] as const;

export const articleSeedRows = fixtures.map(([slug, title, excerpt], index) => {
  const timestamp = new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString();
  return {
    id: index + 1,
    slug,
    title,
    excerpt,
    cover_url: null,
    content: `## ${title}\n\n${excerpt}\n\nGunakan panduan ini sebagai titik awal, lalu sesuaikan dengan kebutuhan dan verifikasi kembali informasi penting sebelum mengambil keputusan.`,
    status: "draft",
    author_type: "seed",
    author_name: "AXVARA Editorial",
    source_urls: "[]",
    is_published: 0,
    published_at: null,
    scheduled_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
});
