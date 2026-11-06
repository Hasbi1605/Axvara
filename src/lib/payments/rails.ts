// Public rails default off. Admin-test scope is passed only after session
// authorization; it never changes the public/bot flags or saved-invoice reads.
export const NOWPAYMENTS_PROVIDER = "nowpayments" as const;
export const SEKALIPAY_GATEWAY_PROVIDER = "sekalipay_gateway" as const;

export function isNowpaymentsEnabled(): boolean {
  return process.env.NOWPAYMENTS_ENABLED === "true";
}



export function isPaymentAdminTestEnabled(): boolean {
  return process.env.PAYMENT_ADMIN_TEST_ENABLED === "true";
}

export function isNowpaymentsConfigured(adminTest = false): boolean {
  return (
    (adminTest ? isPaymentAdminTestEnabled() : isNowpaymentsEnabled()) &&
    Boolean(process.env.NOWPAYMENTS_API_KEY?.trim()) &&
    Boolean(process.env.NOWPAYMENTS_IPN_SECRET?.trim())
  );
}

// Read path untuk invoice TERSIMPAN (reconcile/IPN GET): tetap jalan walau
// flag pembuatan baru off — hanya butuh API key, bukan enabled. Creation
// gate (isNowpaymentsConfigured) tidak tersentuh.
export function isNowpaymentsReadable(): boolean {
  return Boolean(process.env.NOWPAYMENTS_API_KEY?.trim());
}

export function isSekalipayGatewayConfigured(adminTest = false): boolean {
  return (adminTest ? isPaymentAdminTestEnabled() : isSekalipayGatewayEnabled()) && Boolean(process.env.SEKALIPAY_GATEWAY_API_KEY?.trim()) && Boolean(process.env.SEKALIPAY_GATEWAY_SECRET_KEY?.trim());
}

export function isSekalipayGatewayEnabled(): boolean {
  return process.env.SEKALIPAY_GATEWAY_ENABLED === "true";
}
