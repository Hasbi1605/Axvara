// The alias `pt` denotes the current payment_transactions row in every caller.
// Keep the read-time check and the atomic paid guard on the same history.
//
// Berlaku untuk SEMUA rail QRIS (dana + gopay): history ber-provider sehingga
// nominal yang pernah dipakai rail lain tidak saling mengotori. Matcher WAJIB
// filter provider sebelum memakai predikat ini (lihat webhook dana/gopay).
export const DANA_AMOUNT_REUSED_SQL = `(EXISTS (
  SELECT 1 FROM payment_invoice_history history
  WHERE history.provider=pt.provider AND history.payable_amount=pt.payable_amount
    AND history.order_code<>pt.order_code
) OR EXISTS (
  SELECT 1 FROM dana_qris_legacy_ranges legacy
  WHERE pt.provider='dana' AND pt.payable_amount BETWEEN legacy.min_amount AND legacy.max_amount
))`;
