import type { DatabaseAccess } from "@/lib/db-access";
import { queryFirst as defaultQueryFirst } from "@/lib/db";
import { computeFingerprint } from "@/lib/fulfillment/crypto";

/**
 * README supplier: ACTIVATION_ITEM_NOT_AVAILABLE = "Do NOT resubmit this Gmail
 * for this offer (blacklisted). But you can try other validity offer."
 * The offer is keyed by validity, so the block applies to both flows of it.
 */
export const PIXELVERIF_BLOCKING_ERRORS: ReadonlySet<string> = new Set(["ACTIVATION_ITEM_NOT_AVAILABLE"]);

export const PIXELVERIF_BLOCKED_EMAIL_MESSAGE =
  "Gmail ini sebelumnya ditolak supplier untuk penawaran Google AI Pro 3 bulan dan tidak bisa dipesan ulang. Gunakan Gmail lain.";

/** Gmail ignores dots and +tags in the local part; one account = one key. */
export function normalizePixelverifGmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 1) return lower;
  const local = lower.slice(0, at).split("+")[0].replace(/\./g, "");
  return `${local}@${lower.slice(at + 1)}`;
}

export async function pixelverifEmailHash(email: string): Promise<string> {
  return computeFingerprint(`pixelverif-block:v1:${normalizePixelverifGmail(email)}`);
}

type QueryFirst = (sql: string, ...params: unknown[]) => Promise<Record<string, unknown> | null | undefined>;

/** Fail-open on read errors: the supplier still refunds; checkout must not break. */
export async function isPixelverifEmailBlocked(email: string, validity = 3, queryFirst: QueryFirst = defaultQueryFirst): Promise<boolean> {
  if (!email) return false;
  try {
    const row = await queryFirst(
      "SELECT 1 AS hit FROM pixelverif_blocked_emails WHERE email_hash=? AND validity=?",
      await pixelverifEmailHash(email),
      validity,
    );
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function recordPixelverifEmailBlock(db: DatabaseAccess, email: string, validity: number, errorCode: string, orderCode: string): Promise<void> {
  await db.execRun(
    "INSERT OR IGNORE INTO pixelverif_blocked_emails(email_hash,validity,error_code,order_code) VALUES(?,?,?,?)",
    await pixelverifEmailHash(email),
    validity,
    errorCode,
    orderCode,
  );
}
