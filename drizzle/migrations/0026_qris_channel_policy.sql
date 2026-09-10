ALTER TABLE payment_transactions ADD COLUMN expiry_notice_state TEXT;
UPDATE payment_transactions SET expiry_notice_state='terminal' WHERE status!='pending';
UPDATE orders SET expires_at=(
  SELECT CASE WHEN orders.expires_at IS NULL OR julianday(pt.expires_at)<julianday(orders.expires_at)
    THEN pt.expires_at ELSE orders.expires_at END
  FROM payment_transactions pt WHERE pt.order_code=orders.code AND pt.provider='dana'
) WHERE status='pending' AND (sales_channel='whatsapp' OR qris_reissue_count>=1)
  AND EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=orders.code AND pt.provider='dana' AND pt.status='pending');
