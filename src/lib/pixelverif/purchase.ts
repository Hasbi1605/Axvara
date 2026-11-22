import { z } from "zod";
import { createPixelverifOrder, getPixelverifOrder, findPixelverifOrderByEmail } from "./client";

export type PixelverifEligibility = {
  version: 1;
  flow_type: "normal" | "full";
  validity: 3;
  sku: string;
  source_variant_id: number;
  cost_usd?: number;
};

/** Server-only opt-in marker stamped on NEW orders for Pixel Verification variants. */
export function pixelverifEligibility(row: Record<string, unknown>, qty: number): PixelverifEligibility | undefined {
  const flow = row.pixelverif_flow_type;
  const sku = flow === "normal" ? "PV-NORMAL-3" : flow === "full" ? "PV-FULL-3" : null;
  if (
    !sku || row.sku !== sku || Number(row.pixelverif_validity) !== 3 ||
    !Number.isSafeInteger(Number(row.id)) || Number(row.id) < 1 ||
    !Number.isSafeInteger(qty) || qty !== 1
  ) return undefined;
  const cost = Number(row.pixelverif_cost_usd);
  return {
    version: 1,
    flow_type: flow as "normal" | "full",
    validity: 3,
    sku,
    source_variant_id: Number(row.id),
    ...(Number.isFinite(cost) && cost > 0 ? { cost_usd: Math.round(cost * 1e8) / 1e8 } : {}),
  };
}

const gmailSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/, "Email harus alamat @gmail.com yang valid.");
const passwordSchema = z.string().min(1, "Password Gmail wajib diisi.").max(200);
const totpSchema = z.string().trim().transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
  .refine((s) => /^[A-Z2-7]{16,64}={0,6}$/.test(s), "Kunci setup 2FA (TOTP secret) tidak valid.");

export const pixelverifInputSchema = z.object({
  pv_email: gmailSchema,
  pv_password: passwordSchema,
  pv_totp_secret: totpSchema,
}).strict();
export type PixelverifInput = z.infer<typeof pixelverifInputSchema>;

/** Parse buyer-supplied Pixel credentials. Error messages never echo values. */
export function parsePixelverifInput(fields: unknown): PixelverifInput {
  const parsed = pixelverifInputSchema.safeParse(fields ?? {});
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Data akun Google tidak valid.");
  return parsed.data;
}

export function maskPixelverifEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 2) return "***@gmail.com";
  return `${email.slice(0, 2)}***@gmail.com`;
}

/** Internal dispatcher only. Idempotency key replays the exact same provider order. */
export { createPixelverifOrder, getPixelverifOrder, findPixelverifOrderByEmail };
