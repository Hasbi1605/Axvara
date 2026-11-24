import { isD1Mode, queryAll } from "@/lib/db";
import { effectiveVariantStock, isPurchasableStock, purchasableStockSql } from "@/lib/catalog-availability";

export type ProductLiveStatus = "live" | "hidden_loser" | "hidden_soldout" | "off";

export type ProductLiveStatusInfo = {
  status: ProductLiveStatus;
  reason: string;
};

export type VariantLiveStatus = ProductLiveStatus | "hidden_nocatalog";

export type VariantLiveStatusInfo = {
  status: VariantLiveStatus;
  reason: string;
};

export type GroupLoserInfo = { winnerId: number; winner: string; merged?: boolean };

export type SlotLoserInfo = {
  slotName: string;
  winnerVariantId: number;
  winnerLabel: string;
  winnerProductId: number;
};

export type GroupLoserMap = Map<number, GroupLoserInfo> & {
  slotLosers?: Map<number, SlotLoserInfo>;
};

export type VariantLiveStatusInput = {
  supplier_active?: unknown;
  axvara_product_id?: unknown;
  variant_id?: unknown;
  variant_active?: unknown;
  product_active?: unknown;
  product_archived?: unknown;
  stock?: unknown;
  supplier_stock?: unknown;
  min_qty?: unknown;
  fulfillment_mode?: unknown;
  inventory_available?: unknown;
  parent_is_loser?: unknown;
};

export type LiveStatusProductInput = {
  id?: unknown;
  is_active?: unknown;
  stock?: unknown;
};

const PRODUCT_GROUP_LOSERS_SQL = `SELECT gm.product_id AS loser, g.winner_product_id AS winner_id, wp.name AS winner_name,
         COALESCE(g.mode, 'winner') AS group_mode
  FROM product_group_members gm
  JOIN product_groups g ON g.id=gm.group_id
  LEFT JOIN products wp ON wp.id=g.winner_product_id
  WHERE g.winner_product_id IS NOT NULL AND gm.product_id<>g.winner_product_id`;

const PRODUCT_GROUP_SLOT_LOSERS_SQL = `SELECT sm.variant_id AS loser_vid, gs.name AS slot_name,
         gs.winner_variant_id AS winner_vid, wv.label AS winner_label, wv.product_id AS winner_pid
  FROM product_group_slot_members sm
  JOIN product_group_slots gs ON gs.id=sm.slot_id
  JOIN product_groups g ON g.id=gs.group_id
  LEFT JOIN product_variants wv ON wv.id=gs.winner_variant_id
  WHERE g.mode='merge_variants'
    AND gs.winner_variant_id IS NOT NULL
    AND sm.variant_id<>gs.winner_variant_id`;

/** Load product-group loser -> winner map (plus variant-slot losers) using the caller's query runner or D1. */
export async function loadProductGroupLosers(
  runQueryAll: (sql: string, ...params: unknown[]) => Promise<Record<string, unknown>[]> = queryAll,
): Promise<GroupLoserMap> {
  const loserToWinner: GroupLoserMap = new Map<number, GroupLoserInfo>();
  const [pairRows, slotRows] = await Promise.all([
    runQueryAll(PRODUCT_GROUP_LOSERS_SQL).catch(() => [] as Record<string, unknown>[]),
    runQueryAll(PRODUCT_GROUP_SLOT_LOSERS_SQL).catch(() => [] as Record<string, unknown>[]),
  ]);
  for (const r of pairRows) {
    const loser = Number(r.loser ?? 0);
    const winnerId = Number(r.winner_id ?? 0);
    if (Number.isInteger(loser) && loser > 0 && Number.isInteger(winnerId) && winnerId > 0) {
      const merged = String(r.group_mode ?? "winner") === "merge_variants";
      loserToWinner.set(loser, {
        winnerId,
        winner: String(r.winner_name ?? `produk #${winnerId}`),
        ...(merged ? { merged: true } : {}),
      });
    }
  }
  const slotLosers = new Map<number, SlotLoserInfo>();
  for (const r of slotRows) {
    const loserVid = Number(r.loser_vid ?? 0);
    const winnerVid = Number(r.winner_vid ?? 0);
    if (Number.isInteger(loserVid) && loserVid > 0 && Number.isInteger(winnerVid) && winnerVid > 0) {
      slotLosers.set(loserVid, {
        slotName: String(r.slot_name ?? "Slot"),
        winnerVariantId: winnerVid,
        winnerLabel: String(r.winner_label ?? `varian #${winnerVid}`),
        winnerProductId: Number(r.winner_pid ?? 0),
      });
    }
  }
  if (slotLosers.size > 0) loserToWinner.slotLosers = slotLosers;
  return loserToWinner;
}

function isTruthyArchived(value: unknown): boolean {
  if (value === true) return true;
  if (value == null || value === false || value === 0 || value === "0") return false;
  if (typeof value === "string") return value.trim().length > 0;
  return Number(value) !== 0;
}

/**
 * Compute variant storefront visibility status using the shared hierarchy:
 *   off (archived / manual inactive) > hidden_loser > hidden_nocatalog > hidden_soldout (effective stock/min) > live.
 */
export function computeVariantLiveStatus(
  input: VariantLiveStatusInput,
  loserToWinner: ReadonlyMap<number, GroupLoserInfo>,
): VariantLiveStatusInfo {
  if (isTruthyArchived(input.product_archived)) {
    return { status: "off", reason: "Produk diarsipkan" };
  }

  const supplierActive = input.supplier_active == null ? true : Number(input.supplier_active) === 1;
  if (!supplierActive) {
    return { status: "off", reason: "Nonaktif manual" };
  }

  const hasVariant = input.variant_id != null && input.variant_id !== "";
  if (hasVariant && input.variant_active != null && Number(input.variant_active) !== 1) {
    return { status: "off", reason: "Nonaktif manual" };
  }
  if (input.product_active != null && Number(input.product_active) !== 1) {
    return { status: "off", reason: "Nonaktif manual" };
  }

  const pid = Number(input.axvara_product_id ?? 0);
  const loseInfo = Number.isInteger(pid) && pid > 0 ? loserToWinner.get(pid) : undefined;
  if (loseInfo && !loseInfo.merged) {
    return {
      status: "hidden_loser",
      reason: `Kalah vs ${loseInfo.winner} #${loseInfo.winnerId}`,
    };
  }
  if (!loseInfo && Number(input.parent_is_loser ?? 0) === 1) {
    return { status: "hidden_loser", reason: "Kalah di grup produk" };
  }

  const vid = Number(input.variant_id ?? 0);
  const slotLose = Number.isInteger(vid) && vid > 0
    ? (loserToWinner as GroupLoserMap).slotLosers?.get(vid)
    : undefined;
  if (slotLose) {
    return {
      status: "hidden_loser",
      reason: `Kalah slot "${slotLose.slotName}" vs ${slotLose.winnerLabel}`,
    };
  }

  if (!hasVariant) {
    return { status: "hidden_nocatalog", reason: "Tanpa pasangan katalog — tidak tampil" };
  }

  const rawStock = Number(input.stock ?? 0);
  const fulfillmentMode = String(input.fulfillment_mode ?? "manual");
  const invAvail = input.inventory_available == null ? null : Number(input.inventory_available);
  let effective = effectiveVariantStock({
    stock: Number.isFinite(rawStock) ? rawStock : 0,
    fulfillment_mode: fulfillmentMode,
    inventory_available: invAvail,
  });

  if (input.supplier_stock != null) {
    const supStock = Number(input.supplier_stock);
    if (Number.isFinite(supStock)) {
      if (effective === -1) effective = supStock;
      else if (supStock !== -1) effective = Math.min(effective, supStock);
    }
  }

  const minQty = Math.max(1, Number(input.min_qty ?? 1) || 1);
  if (!isPurchasableStock(effective, minQty)) {
    return {
      status: "hidden_soldout",
      reason: effective > 0 && effective < minQty
        ? `Stok (${effective}) di bawah min. beli (${minQty})`
        : "Stok habis · restok otomatis tampil",
    };
  }

  if (loseInfo?.merged) {
    return { status: "live", reason: `Gabung di ${loseInfo.winner} #${loseInfo.winnerId}` };
  }

  return { status: "live", reason: "Tampil di storefront" };
}

/**
 * Hitung status tampil toko per produk ("live", "hidden_loser",
 * "hidden_soldout", "off") dengan satu sumber kebenaran untuk /api/products
 * admin dan POST /api/products/reorder.
 *
 * Hierarki cermin katalog publik:
 *   nonaktif manual > kalah grup > tanpa varian beli > live.
 */
export async function computeProductLiveStatusMap(
  rows: readonly LiveStatusProductInput[],
): Promise<Map<string, ProductLiveStatusInfo>> {
  const result = new Map<string, ProductLiveStatusInfo>();
  if (rows.length === 0) return result;

  const loserToWinner = new Map<number, GroupLoserInfo>();
  const mergedMembersByWinner = new Map<number, number[]>();
  const hasBuyable = new Set<number>();

  if (isD1Mode()) {
    // Anggota grup yang bukan winner = pecundang (mode winner) atau varian
    // digabung ke kartu winner (mode merge_variants). Alasan admin memakai nama
    // produk winner (grup lintas supplier).
    const pairRows = await queryAll(
      `SELECT gm.product_id AS loser, g.winner_product_id AS winner_id, wp.name AS winner_name,
              COALESCE(g.mode, 'winner') AS group_mode,
              mp.is_active AS loser_active, mp.archived_at AS loser_archived
       FROM product_group_members gm
       JOIN product_groups g ON g.id=gm.group_id
       LEFT JOIN products wp ON wp.id=g.winner_product_id
       LEFT JOIN products mp ON mp.id=gm.product_id
       WHERE g.winner_product_id IS NOT NULL AND gm.product_id<>g.winner_product_id`,
    ).catch(() => [] as Record<string, unknown>[]);
    for (const r of pairRows) {
      const loser = Number(r.loser ?? 0);
      const winnerId = Number(r.winner_id ?? 0);
      if (Number.isInteger(loser) && loser > 0 && Number.isInteger(winnerId) && winnerId > 0) {
        const merged = String(r.group_mode ?? "winner") === "merge_variants";
        loserToWinner.set(loser, {
          winnerId,
          winner: String(r.winner_name ?? `produk #${winnerId}`),
          ...(merged ? { merged: true } : {}),
        });
        if (merged && Number(r.loser_active ?? 0) === 1 && r.loser_archived == null) {
          const list = mergedMembersByWinner.get(winnerId) ?? [];
          list.push(loser);
          mergedMembersByWinner.set(winnerId, list);
        }
      }
    }

    const buyableSql = purchasableStockSql("pvx");
    const buyableRows = await queryAll(
      `SELECT DISTINCT product_id FROM product_variants pvx WHERE pvx.is_active=1 AND ${buyableSql}`,
    ).catch(() => [] as Record<string, unknown>[]);
    for (const r of buyableRows) {
      const pid = Number(r.product_id ?? 0);
      if (Number.isInteger(pid) && pid > 0) hasBuyable.add(pid);
    }
    for (const [winnerId, memberIds] of mergedMembersByWinner) {
      if (memberIds.some((memberId) => hasBuyable.has(memberId))) {
        hasBuyable.add(winnerId);
      }
    }
  } else {
    // Dev fallback tanpa D1: tidak ada tabel varian/grup; nilai dari kolom stok produk.
    for (const r of rows) {
      const pid = Number(r.id ?? 0);
      const stock = Number(r.stock ?? -1);
      if (Number.isInteger(pid) && pid > 0 && (stock === -1 || stock > 0)) {
        hasBuyable.add(pid);
      }
    }
  }

  for (const r of rows) {
    const pid = Number(r.id ?? 0);
    const key = String(r.id ?? "");
    const isActive = typeof r.is_active === "boolean" ? r.is_active : Number(r.is_active ?? 1) !== 0;
    if (!isActive) {
      result.set(key, { status: "off", reason: "Nonaktif manual" });
      continue;
    }
    const loseInfo = loserToWinner.get(pid);
    if (loseInfo) {
      result.set(key, {
        status: "hidden_loser",
        reason: loseInfo.merged
          ? `Varian digabung di ${loseInfo.winner} #${loseInfo.winnerId}`
          : `Kalah vs ${loseInfo.winner} #${loseInfo.winnerId}`,
      });
      continue;
    }
    if (!hasBuyable.has(pid)) {
      result.set(key, { status: "hidden_soldout", reason: "Stok habis · restok otomatis tampil" });
      continue;
    }
    result.set(key, { status: "live", reason: "Tampil di storefront" });
  }

  return result;
}
