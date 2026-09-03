// src/lib/payments/types.ts — Payment provider contract

export type PaymentProviderMode = "sandbox" | "inhouse" | "mypg";

export interface CreateInvoiceRequest {
  orderId: string;
  amount: number; // integer Rupiah
  merchantId: string;
  keterangan?: string;
  callbackUrl?: string;
}

export interface CreateInvoiceResponse {
  success: boolean;
  providerOrderId: string;
  merchantId: string;
  requestedAmount: number;
  payableAmount: number; // total_amount — includes unique code, ALWAYS show this to buyer
  signature: string;
  qrisUrl: string | null; // HTTPS URL to QR image (PNG)
  qrisImage: string | null; // data:image/png;base64 (fallback if qris_url empty)
  directUrl: string | null; // payment page URL
  expiresAt: string; // "2026-09-04 00:54:51" format from provider
  expiresMinutes: number;
  raw?: unknown;
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
  totalAmount?: number;
  signature?: string;
  paidAt?: string;
}

export interface PaymentProvider {
  mode: PaymentProviderMode;
  createInvoice(req: CreateInvoiceRequest): Promise<CreateInvoiceResponse>;
  checkStatus(orderId: string, merchantId: string): Promise<CheckStatusResponse>;
  parseCallback(body: unknown): CallbackPayload | null;
}
