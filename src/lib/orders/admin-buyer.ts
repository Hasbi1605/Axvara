/**
 * Privacy-safe buyer summary serializer for supplier admin order queues.
 * Never infers customer_name from raw email and masks short/invalid contacts.
 */
export function maskAdminWa(raw: unknown): string | null {
  const wa = String(raw ?? "").trim();
  if (!wa) return null;
  if (wa.length >= 11) return `${wa.slice(0, 5)}****${wa.slice(-4)}`;
  if (wa.length >= 7) return `${wa.slice(0, 3)}****${wa.slice(-2)}`;
  if (wa.length >= 4) return `${wa.slice(0, 2)}****`;
  return "****";
}

export function maskAdminEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim();
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1 || email.indexOf("@", at + 1) !== -1) {
    return "***";
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).trim();
  if (!domain || /\s/.test(local) || /\s/.test(domain)) return "***";
  if (local.length <= 1) return `***@${domain}`;
  if (local.length <= 3) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local.at(-1)}@${domain}`;
}

export function serializeAdminOrderBuyer(row: Record<string, unknown>) {
  const name = String(row.customer_name ?? "").trim();
  const salesChannel = String(row.sales_channel ?? "").trim();
  return {
    customer_name: name || null,
    customer_wa: maskAdminWa(row.customer_wa),
    customer_email: maskAdminEmail(row.customer_email),
    sales_channel: salesChannel || null,
    purchase_disabled: Number(row.purchase_disabled ?? 0) === 1 ? 1 : 0,
  };
}
