import {
  createMiraiOrder,
  getMiraiOrder,
  validMiraiPackageCode,
  type MiraiRawResponse,
} from "./client";

export type MiraiEligibility = {
  version: 1;
  package_code: string;
  mirai_family: string;
  sku: string;
  source_variant_id: number;
  quantity: number;
  cost_usdt?: number;
};

/** Server-only opt-in marker stamped on NEW orders for Mirai variants. */
export function miraiEligibility(row: Record<string, unknown>, qty: number): MiraiEligibility | undefined {
  const pkg = row.mirai_package_code;
  const family = row.mirai_family;
  if (
    !validMiraiPackageCode(pkg) ||
    typeof family !== "string" ||
    !family.trim() ||
    row.sku !== `MR-${pkg}` ||
    !Number.isSafeInteger(Number(row.id)) ||
    Number(row.id) < 1 ||
    !Number.isSafeInteger(qty) ||
    qty < 1 ||
    qty > 100
  ) {
    return undefined;
  }
  const cost = Number(row.mirai_source_cost_usdt ?? row.mirai_cost_usdt);
  return {
    version: 1,
    package_code: pkg,
    mirai_family: family.trim(),
    sku: `MR-${pkg}`,
    source_variant_id: Number(row.id),
    quantity: qty,
    ...(Number.isFinite(cost) && cost > 0 ? { cost_usdt: Math.round(cost * qty * 1_000_000) / 1_000_000 } : {}),
  };
}

/** Internal dispatcher only. Always replay the exact durable external_order_id + Idempotency-Key. */
export async function buyMiraiPackage(
  packageCode: string,
  quantity: number,
  externalOrderId: string,
  idempotencyKey = externalOrderId,
): Promise<MiraiRawResponse> {
  return createMiraiOrder(
    {
      external_order_id: externalOrderId,
      package_code: packageCode,
      quantity,
    },
    idempotencyKey,
  );
}

export { createMiraiOrder, getMiraiOrder };
