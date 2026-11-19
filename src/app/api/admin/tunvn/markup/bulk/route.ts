import { NextRequest } from "next/server";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import {
  bulkJson,
  parseBulkMarkupRequest,
  type BulkMarkupItemFailure,
} from "@/lib/supplier/bulk-markup";
import { isTunvnExcludedProduct } from "@/lib/tunvn/families";
import {
  applyTunvnBuffMarkupUpdate,
  applyTunvnProductMarkupUpdate,
  TUNVN_MIRROR_SELECT,
  TUNVN_VARIANT_OWNERSHIP_SQL,
} from "@/lib/tunvn/markup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const CHUNK_SIZE = 50;
const VARIANT_CHUNK_SIZE = 25;

export async function POST(request: NextRequest) {
  const gate = await parseBulkMarkupRequest(request);
  if (!gate.ok) return gate.response;

  const { db, body } = gate;
  const { ids, markup_percent, reset_manual } = body;

  const numericIds: number[] = [];
  let wantsBuff = false;

  for (const id of ids) {
    if (id === "TUNVN-BUFF-1B") {
      wantsBuff = true;
    } else if (/^[1-9]\d*$/.test(id)) {
      const n = Number(id);
      if (Number.isSafeInteger(n) && n >= 1 && !isTunvnExcludedProduct(n)) {
        numericIds.push(n);
      }
    }
  }

  const mirrorById = new Map<number, Record<string, unknown>>();
  const variantBySupplierId = new Map<number, Record<string, unknown>>();
  const productById = new Map<number, Record<string, unknown>>();

  for (let i = 0; i < numericIds.length; i += CHUNK_SIZE) {
    const chunk = numericIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const mirrors = await db
      .queryAll(`${TUNVN_MIRROR_SELECT} WHERE supplier_product_id IN (${placeholders})`, ...chunk)
      .catch(() => [] as Record<string, unknown>[]);
    for (const m of mirrors) {
      mirrorById.set(Number(m.supplier_product_id), m);
    }
  }

  for (let i = 0; i < numericIds.length; i += VARIANT_CHUNK_SIZE) {
    const chunk = numericIds.slice(i, i + VARIANT_CHUNK_SIZE);
    const idPlaceholders = chunk.map(() => "?").join(",");
    const skus = chunk.map((n) => `TUNVN-${n}`);
    const skuPlaceholders = skus.map(() => "?").join(",");
    const variants = await db
      .queryAll(
        `SELECT v.* FROM product_variants v
         WHERE (v.tunvn_source_product_id IN (${idPlaceholders}) OR v.sku IN (${skuPlaceholders}))
           AND ${TUNVN_VARIANT_OWNERSHIP_SQL}
         ORDER BY v.tunvn_source_product_id IS NULL ASC, v.id ASC`,
        ...chunk,
        ...skus,
      )
      .catch(() => [] as Record<string, unknown>[]);
    for (const v of variants) {
      const srcId =
        v.tunvn_source_product_id != null
          ? Number(v.tunvn_source_product_id)
          : Number(String(v.sku ?? "").replace(/^TUNVN-/, ""));
      if (Number.isSafeInteger(srcId) && srcId > 0 && !variantBySupplierId.has(srcId)) {
        variantBySupplierId.set(srcId, v);
      }
    }
  }

  const neededProductIds = new Set<number>();
  for (const m of mirrorById.values()) {
    const sid = Number(m.supplier_product_id);
    const v = variantBySupplierId.get(sid);
    const pid = v?.product_id ?? m.axvara_product_id;
    if (pid != null && Number(pid) > 0) neededProductIds.add(Number(pid));
  }
  const productIdList = [...neededProductIds];
  for (let i = 0; i < productIdList.length; i += CHUNK_SIZE) {
    const chunk = productIdList.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const products = await db
      .queryAll(`SELECT id, name, archived_at FROM products WHERE id IN (${placeholders})`, ...chunk)
      .catch(() => [] as Record<string, unknown>[]);
    for (const p of products) {
      productById.set(Number(p.id), p);
    }
  }

  let buffRow: Record<string, unknown> | null = null;
  if (wantsBuff) {
    buffRow = await db
      .queryFirst(
        `SELECT v.*, p.archived_at AS p_archived_at
         FROM product_variants v
         JOIN products p ON p.id=v.product_id
         WHERE v.sku='TUNVN-BUFF-1B' AND ${TUNVN_VARIANT_OWNERSHIP_SQL}`,
      )
      .catch(() => null);
  }

  let updated = 0;
  let anyChanged = false;
  const failed: BulkMarkupItemFailure[] = [];

  for (const id of ids) {
    if (id === "TUNVN-BUFF-1B") {
      if (!buffRow) {
        failed.push({ id, error: "not_found" });
        continue;
      }
      const outcome = await applyTunvnBuffMarkupUpdate(
        db,
        buffRow,
        buffRow.p_archived_at ?? null,
        {
          markup_percent,
          admin_price_idr: reset_manual ? null : undefined,
          block_archived: true,
          require_fx_for_formula: true,
          refresh_stock: false,
        },
      );
      if (!outcome.ok) {
        failed.push({ id, error: outcome.error });
        continue;
      }
      updated++;
      if (outcome.changed) anyChanged = true;
      continue;
    }

    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
      failed.push({ id, error: "invalid_id" });
      continue;
    }
    const supplierId = Number(id);
    if (isTunvnExcludedProduct(supplierId)) {
      failed.push({ id, error: "excluded_product" });
      continue;
    }

    const mirror = mirrorById.get(supplierId);
    if (!mirror) {
      failed.push({ id, error: "not_found" });
      continue;
    }

    const variant = variantBySupplierId.get(supplierId) ?? null;
    const resolvedProductId = variant?.product_id ?? mirror.axvara_product_id;
    const product =
      resolvedProductId != null ? (productById.get(Number(resolvedProductId)) ?? null) : null;

    const outcome = await applyTunvnProductMarkupUpdate(db, mirror, variant, product, {
      markup_percent,
      admin_price_idr: reset_manual ? null : undefined,
      block_archived: true,
      require_fx_for_formula: true,
      refresh_stock: false,
    });
    if (!outcome.ok) {
      failed.push({ id, error: outcome.error });
      continue;
    }
    updated++;
    if (outcome.changed) anyChanged = true;
  }

  if (anyChanged) {
    await bumpCatalogRevision("market", db);
  }

  return bulkJson({ ok: true, updated, failed });
}
