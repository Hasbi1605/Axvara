import { queryAll, queryFirst } from "@/lib/db";
import { needsEmailForVariant } from "@/lib/warung-rebahan/delivery-class";

export async function checkoutEmailFingerprint(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`telegram-checkout-email:${email}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Missing catalog rows or failed reads must never authorize an email-less order. */
export async function readCheckoutEmail(
  userId: string,
  lines: readonly { productId: number; variantId: number }[],
  emailSnapshot?: string | null,
): Promise<{ required: boolean; email: string | null }> {
  if (!lines.length || lines.length > 20) throw new Error("invalid_checkout_lines");
  const rows = await queryAll(
    `SELECT pv.id, pv.product_id, wv.wr_type, p.require_email
     FROM product_variants pv
     JOIN products p ON p.id=pv.product_id
     LEFT JOIN wr_variants wv ON wv.wr_variant_id=pv.wr_variant_id
     WHERE pv.id IN (${lines.map(() => "?").join(",")})`,
    ...lines.map(line => line.variantId),
  );
  if (lines.some(line => !rows.some(row => Number(row.id) === line.variantId && Number(row.product_id) === line.productId))) {
    throw new Error("checkout_email_catalog_missing");
  }
  const required = rows.some(row => needsEmailForVariant({
    wrType: row.wr_type == null ? null : String(row.wr_type),
    requireEmail: Number(row.require_email ?? 0),
  }));
  const saved = emailSnapshot === undefined
    ? (await queryFirst("SELECT buyer_email FROM telegram_users WHERE user_id=?", userId))?.buyer_email
    : emailSnapshot;
  const email = typeof saved === "string" ? saved.trim() : "";
  return { required, email: email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null };
}
