/** Hanya copy publik yang boleh disalin ke quote dan respons pesanan. */
export type PediaServiceCopy = {
  product_name: string;
  service_name: string;
  description: string;
  terms: string;
  instructions: string;
};

export function capturePediaServiceCopy(product: Record<string, unknown>, tier: Record<string, unknown>): PediaServiceCopy {
  return {
    product_name: String(product.name ?? "").slice(0, 120),
    service_name: String(tier.public_name || tier.label_note || product.name || "").slice(0, 200),
    description: String(tier.description_md ?? "").slice(0, 3000),
    terms: String(tier.terms_md ?? "").slice(0, 3000),
    instructions: String(tier.instructions_md ?? "").slice(0, 3000),
  };
}

export function readPediaServiceCopy(value: unknown): PediaServiceCopy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const copy = value as Record<string, unknown>;
  const limits = { product_name: 120, service_name: 200, description: 3000, terms: 3000, instructions: 3000 };
  if (Object.entries(limits).some(([key, max]) => typeof copy[key] !== "string" || (copy[key] as string).length > max)) return null;
  // Whitelist fields even when reading historical snapshots.
  return Object.fromEntries(Object.keys(limits).map((key) => [key, copy[key]])) as PediaServiceCopy;
}
