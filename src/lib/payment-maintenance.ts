import { SITE, waHubLink } from "./site";

// Public build-time switch: CI sets this for the complete Pages artifact.
// Keep the same value in client UI and server guards; no database reads.
export function isPaymentMaintenanceEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PAYMENTS_MAINTENANCE === "true";
}

export const PAYMENT_MAINTENANCE_MESSAGE = "Pembayaran otomatis sedang maintenance. Untuk sementara, silakan order manual lewat WhatsApp.";
export const PAYMENT_MANUAL_ORDER_URL = `${SITE.webUrl}${waHubLink("Halo AXVARA, saya ingin order manual selama pembayaran maintenance.")}`;

export function paymentMaintenanceResponse(): Response {
  return Response.json({
    error: PAYMENT_MAINTENANCE_MESSAGE,
    reason: "payment_maintenance",
    manual_order_url: PAYMENT_MANUAL_ORDER_URL,
  }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
}

export function assertPaymentsAvailable(): void {
  if (isPaymentMaintenanceEnabled()) throw new Error("payment_maintenance");
}
