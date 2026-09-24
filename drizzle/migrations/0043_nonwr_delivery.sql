-- 0043_nonwr_delivery.sql — Pengiriman produk non-WR ke pembeli web + isi
-- serah terima admin (permintaan owner 2026-09-25).
--
-- 1. fulfillment_items.delivered_ciphertext / delivered_iv: salinan
--    TERENKRIPSI dari isi yang benar-benar dikirim ke pembeli. Untuk mode
--    shared/unique ini ciphertext pesan bersama / unit stok yang
--    didekripsi saat kirim (disalin apa adanya, tanpa enkripsi ulang).
--    Untuk serah terima admin, isi "Detail untuk pembeli" dienkripsi dengan
--    kunci yang sama (FULFILLMENT_ENCRYPTION_KEY). Halaman pesanan membaca
--    kolom ini setelah pembeli lolos verifikasi WA/token, sehingga isinya
--    tetap bisa dibuka lagi walau pesan bersama varian diganti kemudian.
-- 2. product_variants.handover_template: template pesan serah terima per
--    varian Made By Order non-WR. Milik ADMIN; sync WR tidak pernah
--    menulisnya, dan satu-satunya penulis adalah POST /api/admin/fulfillment
--    (action set_handover_template).
--
-- Tanpa perubahan data: NULL = perilaku lama (tidak ada isi tersimpan).

ALTER TABLE fulfillment_items ADD COLUMN delivered_ciphertext TEXT;
ALTER TABLE fulfillment_items ADD COLUMN delivered_iv TEXT;
ALTER TABLE product_variants ADD COLUMN handover_template TEXT;
