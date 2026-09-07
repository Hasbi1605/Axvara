-- 0016_revenue_paid_at.sql — Waktu pembayaran tetap untuk laporan pendapatan (issue #12).
--
-- Masalah: revenue hari/bulan memakai `orders.updated_at` (berubah setiap ada
-- pengiriman, catatan admin, retry notifikasi) dalam zona UTC, sehingga
-- pendapatan berpindah hari/bulan sendiri dan tidak mengikuti WIB.
--
-- Perbaikan:
-- 1. Tambah `orders.paid_at` — ditulis sekali saat transisi lunas via
--    COALESCE-guard (tidak pernah diubah lagi); semua jalur lunas
--    (QRIS webhook, retry admin, approval bukti manual, konfirmasi admin)
--    mengisinya dalam batch yang sama dengan flip status.
-- 2. Backfill satu kali untuk data lama: QRIS dari
--    `payment_transactions.paid_at`, manual dari `payment_proofs.reviewed_at`
--    terbaru, sisa lunas dari `updated_at` (hanya order lunas/paid — order
--    lain tetap NULL).
--
-- Idempoten dan aman diulang: ADD COLUMN sederhana (D1 gagal halus bila
-- kolom sudah ada saat rerun? TIDAK — jaga dengan hanya dijalankan sekali
-- via journal migrasi CI seperti migrasi 0012–0015); UPDATE hanya menyentuh
-- baris lunas yang paid_at-nya masih NULL.

ALTER TABLE orders ADD COLUMN paid_at TEXT;

-- Backfill QRIS: waktu otoritatif dari ledger (sudah COALESCE-safe di writer).
UPDATE orders
SET paid_at=(
  SELECT pt.paid_at FROM payment_transactions pt
  WHERE pt.order_code=orders.code AND pt.paid_at IS NOT NULL
)
WHERE status='lunas' AND payment_status='paid' AND paid_at IS NULL
  AND EXISTS(
    SELECT 1 FROM payment_transactions pt
    WHERE pt.order_code=orders.code AND pt.paid_at IS NOT NULL
  );

-- Backfill manual: waktu admin mencocokkan mutasi (reviewed_at terbaru).
UPDATE orders
SET paid_at=(
  SELECT MAX(pp.reviewed_at) FROM payment_proofs pp
  WHERE pp.order_code=orders.code AND pp.status='approved' AND pp.reviewed_at IS NOT NULL
)
WHERE status='lunas' AND payment_status='paid' AND paid_at IS NULL
  AND EXISTS(
    SELECT 1 FROM payment_proofs pp
    WHERE pp.order_code=orders.code AND pp.status='approved' AND pp.reviewed_at IS NOT NULL
  );

-- Backfill sisa lunas tanpa jejak waktu pembayaran: pakai updated_at terakhir
-- sebagai aproksimasi eksplisit (terdokumentasi, bukan diam-diam UTC).
UPDATE orders
SET paid_at=updated_at
WHERE status='lunas' AND payment_status='paid' AND paid_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_paid_at
  ON orders(status, paid_at);
