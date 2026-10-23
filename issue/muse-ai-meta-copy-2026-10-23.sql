-- Revisi deskripsi sesuai arahan owner; guard melindungi suntingan admin berikutnya.
-- Patch data sekali jalan, bukan migrasi schema; hanya description + updated_at.
UPDATE products SET description = 'Muse AI adalah AI agent otonom dari Meta, perusahaan di balik WhatsApp, Instagram, Threads, dan Facebook. Berada dalam ekosistem yang sama, Muse cocok menjadi asisten untuk promosi dan pembuatan konten media sosial, mulai dari riset ide, menyusun caption dan materi promosi, hingga merencanakan kalender konten.

Muse dapat berjalan 24 jam dan memiliki mesin virtual sendiri, dapat digunakan untuk membantu coding, riset, analisis, pembuatan konten, dan scheduling. Muse juga multimodal model yang dapat membaca teks, gambar, video, hingga audio. Dapat juga digunakan untuk generate gambar dan generate video.

Kelebihannya:
- VPS bawaan: 2 vCPU, RAM ±7,7 GB, storage 100 GB
- Tugas latar belakang 24 jam tanpa menyewa VPS tambahan
- Browser bawaan dan kendali / chat langsung melalui WhatsApp
- Konektor ke Google Workspace, GitHub, Canva, instagram, threads, dan layanan lainnya
- Akun siap pakai tanpa kartu kredit, tanpa VPN', updated_at = datetime('now')
WHERE id=112 AND slug='muse-ai-1-miliar-token' AND source='manual'
  AND admin_description_override IS NULL AND updated_at='2026-10-23 04:38:56'
  AND description = 'Muse AI adalah agent autonomus yang dapat berjalan 24 jam dan memiliki mesin virtual sendiri, dapat digunakan untuk membantu coding, riset, analisis, pembuatan konten, dan scheduling. Muse juga multimodal model yang dapat membaca teks, gambar, video, hingga audio. Dapat juga digunakan untuk generate gambar dan generate video.

Kelebihannya:
- VPS bawaan: 2 vCPU, RAM ±7,7 GB, storage 100 GB
- Tugas latar belakang 24 jam tanpa menyewa VPS tambahan
- Browser bawaan dan kendali / chat langsung melalui WhatsApp
- Konektor ke Google Workspace, GitHub, Canva, instagram, threads, dan layanan lainnya
- Akun siap pakai tanpa kartu kredit, tanpa VPN';
