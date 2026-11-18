import { isD1Mode, queryAll } from "@/lib/db";
import { purchasableStockSql } from "@/lib/catalog-availability";

export type ProductLiveStatus = "live" | "hidden_loser" | "hidden_soldout" | "off";

export type ProductLiveStatusInfo = {
  status: ProductLiveStatus;
  reason: string;
};

export type LiveStatusProductInput = {
  id?: unknown;
  is_active?: unknown;
  stock?: unknown;
};

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

  const loserToWinner = new Map<number, { winnerId: number; winner: string }>();
  const hasBuyable = new Set<number>();

  if (isD1Mode()) {
    // Anggota grup yang bukan winner = pecundang. Alasan admin memakai nama
    // produk winner (grup lintas supplier).
    const pairRows = await queryAll(
      `SELECT gm.product_id AS loser, g.winner_product_id AS winner_id, wp.name AS winner_name
       FROM product_group_members gm
       JOIN product_groups g ON g.id=gm.group_id
       LEFT JOIN products wp ON wp.id=g.winner_product_id
       WHERE g.winner_product_id IS NOT NULL AND gm.product_id<>g.winner_product_id`,
    ).catch(() => [] as Record<string, unknown>[]);
    for (const r of pairRows) {
      const loser = Number(r.loser ?? 0);
      const winnerId = Number(r.winner_id ?? 0);
      if (Number.isInteger(loser) && loser > 0 && Number.isInteger(winnerId) && winnerId > 0) {
        loserToWinner.set(loser, { winnerId, winner: String(r.winner_name ?? `produk #${winnerId}`) });
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
        reason: `Kalah vs ${loseInfo.winner} #${loseInfo.winnerId}`,
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
