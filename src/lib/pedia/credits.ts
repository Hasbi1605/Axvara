// Historical credit types/hashing only. Issuance and redemption retired by owner
// 24 Oct 2026. Tables remain an immutable accounting archive; no wallet exists.
export const PEDIA_CREDIT_TTL_DAYS = 180;
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
export type IssueCreditArgs = { email: string; amount: number; sourceOrderCode?: string | null; sourceKind: "partial" | "canceled" | "admin" };
export async function issuePediaCredit(_db: unknown, _args: IssueCreditArgs): Promise<{code:string;id:number}> { void _db; void _args; throw new Error("credits_retired"); }
export async function checkPediaCredit(_db: unknown, _code: string): Promise<{remaining:number}|null> { void _db; void _code; return null; }
export async function consumePediaCredit(_db: unknown, _code: string, _orderCode: string, _maxAmount: number): Promise<{used:number;remaining:number}> { void _db; void _code; void _orderCode; void _maxAmount; throw new Error("credits_retired"); }
