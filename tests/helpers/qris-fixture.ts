import { createHmac } from "node:crypto";
import type { createD1Fixture } from "./d1-fixture";
import { NextRequest } from "next/server";
import { calculateCrc16, makeDynamicQris, parseDbTimeUtc } from "@/lib/payments/qris";

export function seedLegacyDanaInvoice(sql: ReturnType<typeof createD1Fixture>["sql"], code: string, amount: number, payableAmount = amount + 42) {
  const qrisUrl = `https://axvara.tech/api/payments/qris/${encodeURIComponent(code)}/image`;
  const deadline = parseDbTimeUtc(sql.prepare("SELECT expires_at FROM orders WHERE code=?").get(code)?.expires_at);
  const expiresAt = new Date(Math.min(Date.now() + 900_000, Number.isFinite(deadline) ? deadline : Infinity)).toISOString();
  const base = "00020101021153033605802ID6304";
  const qrisPayload = makeDynamicQris(base + calculateCrc16(base), payableAmount);
  sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,
    requested_amount,payable_amount,unique_code,status,qris_payload,qris_url,expires_at)
    VALUES(?,'dana','dynamic-qris',?,'dana-business',?,?,?,'pending',?,?,?)`)
    .run(code, code, amount, payableAmount, payableAmount - amount, qrisPayload, qrisUrl, expiresAt);
  sql.prepare(`UPDATE orders SET payment_method='qris',payment_account='DANA Business',payment_status='pending',
    expires_at=COALESCE(expires_at,?) WHERE code=?`).run(expiresAt, code);
  return { payableAmount, expiresAt, qrisPayload, qrisUrl };
}

export function gopaySettlement(code: string, amount: number, event: string, secret = "fixture-secret") {
  const body = JSON.stringify({ order_code: code, amount, event_id: event, merchant_id: "G111111111", currency: "IDR", transaction_status: "settlement", paid_at: new Date().toISOString() });
  return new NextRequest("https://axvara.test/api/webhook/gopay", {
    method: "POST", body, headers: { "content-type": "application/json", "x-poller-secret": secret, "x-poller-signature": createHmac("sha256", secret).update(body).digest("hex") },
  });
}
