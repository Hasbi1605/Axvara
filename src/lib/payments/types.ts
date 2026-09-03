// src/lib/payments/types.ts — Payment provider contract

export type PaymentProviderMode = "sandbox" | "mypg";

export interface CreateInvoiceRequest {
  orderId: string;
  amount: number; // integer Rupiah
  merchantId: string;
}

export interface CreateInvoiceResponse {
  success: boolean;
  providerOrderId: string;
  merchantId: string;
  requestedAmount: number;
  payableAmount: number; // may include unique code
  signature: string;
  qrisUrl: string | null; // HTTPS URL to QR image
  directUrl: string | null; // payment page URL
  expiresAt: string; // ISO datetime
  raw?: unknown; // redacted provider response for debugging
}

export interface CheckStatusResponse {
  success: boolean;
  providerOrderId: string;
  status: "pending" | "paid" | "expired" | "failed";
  amountPaid?: number;
  paidAt?: string;
  raw?: unknown;
}

export interface CallbackPayload {
  providerOrderId: string;
  merchantId: string;
  status: "paid" | "expired" | "failed";
  amountPaid?: number;
  signature?: string;
  paidAt?: string;
}

export interface PaymentProvider {
  mode: PaymentProviderMode;
  createInvoice(req: CreateInvoiceRequest): Promise<CreateInvoiceResponse>;
  checkStatus(orderId: string, merchantId: string): Promise<CheckStatusResponse>;
  parseCallback(body: unknown): CallbackPayload | null;
}
