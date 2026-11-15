import { getTunvnApiKey,getTunvnBaseUrl,isTunvnConfigured,TUNVN_DEFAULT_TIMEOUT_MS } from "./client";

// Internal only: response bodies can contain credentials. The dispatcher seals
// every readable purchase response before interpreting it, including errors.
export type PurchaseResponse = { status:number; text:string };
export async function tunvnRequest(path:"buy"|"buff/order"|"buff/check"|"buff/status",body?:Record<string,unknown>,batchId?:string):Promise<PurchaseResponse> {
  if (!isTunvnConfigured()) throw new Error("not_configured");
  if (path === "buff/status" && !/^[A-Za-z0-9_-]{1,100}$/.test(batchId ?? "")) throw new Error("invalid_batch_id");
  const response = await fetch(`${getTunvnBaseUrl()}/api/${path}${path === "buff/status" ? `?batch_id=${encodeURIComponent(batchId!)}` : ""}`,{
    method:body ? "POST" : "GET",headers:{ "x-api-key":getTunvnApiKey(),"content-type":"application/json",accept:"application/json" },
    ...(body ? { body:JSON.stringify(body) } : {}),redirect:"manual",signal:AbortSignal.timeout(TUNVN_DEFAULT_TIMEOUT_MS),
  });
  return { status:response.status,text:await response.text() };
}

export function buyTunvnProduct(productId:number,quantity:number):Promise<PurchaseResponse> {
  // #60 (API TEST) tidak pernah boleh dibeli; id lain divalidasi lagi oleh
  // snapshot eligibility/identitas varian sebelum fence.
  if (!Number.isSafeInteger(productId) || productId<1 || productId>1_000_000 || productId===60
    || !Number.isSafeInteger(quantity) || quantity<1 || quantity>100) throw new Error("invalid_purchase");
  return tunvnRequest("buy",{ product_id:productId,quantity,currency:"usdt" });
}
export function tunvnBuffText(code:string,quantity:number):string {
  if (!/^[A-Za-z0-9]{6}$/.test(code) || !Number.isSafeInteger(quantity) || quantity<1 || quantity>30) throw new Error("invalid_buff");
  return `${code} ${quantity}`;
}
export function orderTunvnBuff(code:string,quantity:number):Promise<PurchaseResponse> {
  return tunvnRequest("buff/order",{ orders_text:tunvnBuffText(code,quantity),currency:"usdt" });
}

export function parseTunvnResponse(text:string):Record<string,unknown> {
  const value:unknown=JSON.parse(text);
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("invalid_receipt");
  return value as Record<string,unknown>;
}
export const tunvnProviderId = (value:unknown):string|null => typeof value==="string" && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;

// ponytail: docs describe 409 in prose, not an exact machine error body.
// No automatic replay until the provider publishes a verifiable no-charge code.
