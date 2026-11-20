// Use the same admission predicate in both cron routes and their atomic guard.
// These rails have a separate, recoverable invoice lifecycle.
export const FAST_EXPIRY_RAILS_SQL = `NOT (pt.provider='nowpayments' AND pt.provider_payment_id IS NOT NULL)
  AND pt.provider!='sekalipay_gateway'`;
export const STALE_INITIALIZING_SQL = `pt.status='initializing'
  AND julianday(pt.created_at)<julianday('now','-5 minutes') AND ${FAST_EXPIRY_RAILS_SQL}`;
