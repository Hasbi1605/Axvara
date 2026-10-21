-- Ringkas copy sesuai koreksi owner; hanya revisi awal 07:45:29 yang diganti.
UPDATE products SET description = 'Muse AI membantu coding, riset, analisis, pembuatan konten, dan penjadwalan dengan 1 miliar token tambahan.

- VPS bawaan: 2 vCPU, RAM ±7,7 GB, storage 100 GB sebagai spesifikasi referensi
- Tugas latar belakang 24 jam tanpa menyewa VPS tambahan, sesuai kuota layanan
- Browser bawaan dan kendali melalui WhatsApp native
- Konektor ke Google Workspace, GitHub, Canva, dan layanan lainnya
- Akun siap pakai tanpa kartu kredit, setup VPS, atau VPN saat akses awal', updated_at = datetime('now')
WHERE id=112 AND slug='muse-ai-1-miliar-token' AND source='manual'
  AND admin_description_override IS NULL AND updated_at='2026-10-21 07:45:29';

UPDATE product_variants SET admin_terms = 'Detail paket:
- Akun Free dengan 1 miliar token tambahan, bukan unlimited

Aturan pakai:
- Fitur, kapasitas VPS, dan kerja 24 jam mengikuti kuota serta ketersediaan Muse
- WhatsApp dan konektor perlu ditautkan; langganan layanan pihak ketiga tidak termasuk
- Wajib ganti ke email pribadi dan rahasiakan kode OTP

Garansi:
- Tanpa garansi; kendala akses awal dapat ditanyakan ke admin',
admin_activation = '1. Siapkan email akun dan tautan web OTP dari detail pesanan
2. Buka https://muse.ai dan masuk menggunakan email akun tersebut
3. Ambil kode login dari web OTP, lalu masukkan ke Muse
4. Buka Settings, General, lalu Meta Account untuk mengganti email ke email pribadi; selesaikan verifikasi email baru sebelum keluar',
admin_copy_fingerprint='', updated_at=datetime('now')
WHERE id=248 AND product_id=112 AND sku='DEFAULT-MUSE-AI-1-MILIAR-TOKEN'
  AND wr_variant_id IS NULL AND sk_variant_id IS NULL
  AND COALESCE(admin_copy_fingerprint,'')='' AND updated_at='2026-10-21 07:45:29'
  AND EXISTS (SELECT 1 FROM products WHERE id=112 AND slug='muse-ai-1-miliar-token' AND source='manual');
