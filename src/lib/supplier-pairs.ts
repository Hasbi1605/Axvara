// src/lib/supplier-pairs.ts — Pemenang otomatis WR vs SK per pasangan.
// Keputusan owner 2026-09-30: produk yang sama di dua supplier dipilih
// OTOMATIS mana yang tampil (stok dulu, modal kemudian), bukan manual.
//
// Aturan prioritas (decideWinner):
//   1. STOK DULU: yang stok 0 otomatis kalah. Pemenang = yang berstok.
//      Dua-duanya habis → winner NULL, sisi SK disembunyikan dan WR tampil
//      sebagai wakil 1 kartu (Opsi B, keputusan owner 2026-10-02: 1 barang
//      = 1 kartu, kontrak kartu habis untuk trust tetap utuh). Tetap ada
//      di admin. Dua-duanya berstok → bandingkan modal.
//   2. MODAL KEMUDIAN: modal per-varian-termurah menang (margin % tidak
//      relevan — yang dibandingkan biaya pokok, bukan harga jual).
//   3. PREFER ADMIN: prefer WR/SK mengalahkan selisih modal ≤ prefer_margin
//      (kualitas garansi/S&K yang hanya admin tahu). Selisih > margin →
//      modal tetap menang (uang terlalu besar untuk diabaikan).
//
// Kepemilikan (cermin WR/SK): sync TIDAK PERNAH tulis supplier_pairs.
// decideWinner dipanggil di ekor sync (best-effort) + endpoint admin manual.
// Katalog publik memfilter pecundang via JOIN — is_active milik admin,
// jangan ditimpa.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";

export type PairWinner = "WR" | "SK" | null;

export type PairRow = {
  id: number;
  wr_product_id: number;
  sk_product_id: number;
  winner: PairWinner;
  prefer: "auto" | "WR" | "SK";
  prefer_margin: number;
  decided_at: string | null;
  reason: string | null;
};

type Row = Record<string, unknown>;

/** Angka mentah satu pasangan — hasil SATU query agregat (lihat PAIR_STATS_SQL). */
export type PairStats = {
  wrExists: boolean;
  skExists: boolean;
  wrStock: number;
  skStock: number;
  wrModal: number | null;
  skModal: number | null;
};

// 2026-10-10 (insiden 1102): versi lama menjalankan ±9 query D1 per pasangan
// (eksistensi ×2, stok ×2, modal sampai ×4, UPDATE) → 33 pasangan ≈ 300
// round-trip dalam satu request `/api/supplier-sync {action:"pairs"}`, dan
// request itu rutin dibunuh `exceededCpu` (batas ~10 ms Workers Free).
// Sekarang SEMUA angka diambil lewat subquery berkorelasi dalam satu SELECT;
// keputusan dihitung murni di JS (`decideFromStats`) dan UPDATE hanya untuk
// baris yang winner/reason-nya benar-benar berubah.
//
// Stok agregat = SUM varian aktif berstok; -1 (unlimited) = tak terbatas.
// Modal termurah = MIN harga pokok varian aktif berstok di registry SK,
// fallback WR (produk selalu salah satu, cermin cheapestModal lama).
const stockSql = (col: string) => `(SELECT COALESCE(SUM(CASE WHEN v.stock>0 THEN v.stock ELSE 0 END),0)
    FROM product_variants v WHERE v.product_id=sp.${col} AND v.is_active=1)`;
const unlimitedSql = (col: string) => `(SELECT MAX(CASE WHEN v.stock=-1 THEN 1 ELSE 0 END)
    FROM product_variants v WHERE v.product_id=sp.${col} AND v.is_active=1)`;
const modalSql = (col: string) => `COALESCE(
    (SELECT MIN(s.sk_price) FROM sk_products s JOIN product_variants v ON v.sk_variant_id=s.sk_variant_id
      WHERE v.product_id=sp.${col} AND v.is_active=1 AND s.sk_stock>0),
    (SELECT MIN(w.wr_price) FROM wr_variants w JOIN product_variants v ON v.wr_variant_id=w.wr_variant_id
      WHERE v.product_id=sp.${col} AND v.is_active=1 AND w.wr_stock>0))`;

const PAIR_STATS_SQL = `SELECT sp.*,
    EXISTS(SELECT 1 FROM products p WHERE p.id=sp.wr_product_id) AS st_wr_exists,
    EXISTS(SELECT 1 FROM products p WHERE p.id=sp.sk_product_id) AS st_sk_exists,
    ${stockSql("wr_product_id")} AS st_wr_stock,
    ${unlimitedSql("wr_product_id")} AS st_wr_unl,
    ${stockSql("sk_product_id")} AS st_sk_stock,
    ${unlimitedSql("sk_product_id")} AS st_sk_unl,
    ${modalSql("wr_product_id")} AS st_wr_modal,
    ${modalSql("sk_product_id")} AS st_sk_modal
  FROM supplier_pairs sp`;

function statsFromRow(row: Row): PairStats {
  const stock = (s: unknown, unl: unknown) => (Number(unl ?? 0) === 1 ? Number.MAX_SAFE_INTEGER : Number(s ?? 0));
  const modal = (m: unknown) => (m == null ? null : Number(m));
  return {
    wrExists: Number(row.st_wr_exists ?? 0) === 1,
    skExists: Number(row.st_sk_exists ?? 0) === 1,
    wrStock: stock(row.st_wr_stock, row.st_wr_unl),
    skStock: stock(row.st_sk_stock, row.st_sk_unl),
    wrModal: modal(row.st_wr_modal),
    skModal: modal(row.st_sk_modal),
  };
}

/** Keputusan murni (tanpa DB) — aturan prioritas di header file. */
export function decideFromStats(pair: Pick<PairRow, "prefer" | "prefer_margin">, stats: PairStats): { winner: PairWinner; reason: string } {
  // Guard pasangan yatim (cermin WR 2026-09-11): produk dihapus manual →
  // pasangan tidak diputuskan (winner NULL), dibersihkan admin belakangan.
  if (!stats.wrExists || !stats.skExists) return { winner: null, reason: "pasangan_yatim" };
  const { wrStock, skStock, wrModal, skModal } = stats;
  const wrHas = wrStock > 0;
  const skHas = skStock > 0;
  // 1. STOK DULU.
  if (wrHas && !skHas) return { winner: "WR", reason: `stok SK habis (WR ${wrStock})` };
  if (skHas && !wrHas) return { winner: "SK", reason: `stok WR habis (SK ${skStock})` };
  if (!wrHas && !skHas) return { winner: null, reason: "dua-duanya habis" };
  // 2. MODAL KEMUDIAN (dua-duanya berstok).
  if (wrModal == null && skModal == null) return { winner: null, reason: "modal tak terbaca" };
  if (wrModal == null) return { winner: "SK", reason: "modal WR tak terbaca" };
  if (skModal == null) return { winner: "WR", reason: "modal SK tak terbaca" };
  if (wrModal === skModal) {
    // Seri modal → prefer menang, tanpa prefer → WR (inkumben lama).
    if (pair.prefer === "SK") return { winner: "SK", reason: `modal seri (${wrModal}), prefer SK` };
    return { winner: "WR", reason: `modal seri (${wrModal})` };
  }
  const cheaper: "WR" | "SK" = wrModal < skModal ? "WR" : "SK";
  const diff = Math.abs(wrModal - skModal);
  // 3. PREFER ADMIN mengalahkan selisih kecil.
  if (pair.prefer !== "auto" && pair.prefer !== cheaper && diff <= pair.prefer_margin) {
    return { winner: pair.prefer, reason: `prefer ${pair.prefer} (selisih ${diff} ≤ margin ${pair.prefer_margin})` };
  }
  const loser = cheaper === "WR" ? "SK" : "WR";
  return { winner: cheaper, reason: `modal ${cheaper} ${Math.min(wrModal, skModal)} < ${loser} ${Math.max(wrModal, skModal)}` };
}

/**
 * Tentukan pemenang satu pasangan (endpoint admin). Satu query statistik
 * untuk pasangan produk ini, tanpa menulis DB.
 */
export async function decideOneWinner(pair: PairRow, db: DatabaseAccess): Promise<{ winner: PairWinner; reason: string }> {
  const row = await db
    .queryFirst(
      `SELECT * FROM (${PAIR_STATS_SQL.replace("FROM supplier_pairs sp", "FROM (SELECT ? AS wr_product_id, ? AS sk_product_id) sp")})`,
      pair.wr_product_id,
      pair.sk_product_id,
    )
    .catch(() => null);
  if (!row) return { winner: null, reason: "pasangan_yatim" };
  return decideFromStats(pair, statsFromRow(row));
}

/**
 * Hitung ulang semua pasangan: 1 SELECT agregat + UPDATE hanya untuk baris
 * yang berubah. Best-effort: 1 UPDATE gagal tidak menghentikan yang lain.
 */
export async function decideAllWinners(database?: DatabaseAccess): Promise<{ decided: number; changed: number }> {
  const db = database ?? createDatabaseAccess();
  const rows = await db.queryAll(PAIR_STATS_SQL).catch(() => [] as Row[]);
  let decided = 0;
  let changed = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const pair = row as unknown as PairRow;
    const { winner, reason } = decideFromStats(pair, statsFromRow(row));
    const shortReason = reason.slice(0, 300);
    decided++;
    if (winner !== (pair.winner ?? null)) changed++;
    if (winner === (pair.winner ?? null) && shortReason === (pair.reason ?? null)) continue;
    await db
      .execRun(
        `UPDATE supplier_pairs SET winner=?, decided_at=?, reason=?, updated_at=?
         WHERE id=? AND (winner IS NOT ? OR reason IS NOT ?)`,
        winner, now, shortReason, now, pair.id, winner, shortReason,
      )
      .catch(() => ({ changes: 0 }));
  }
  return { decided, changed };
}

/** Id pecundang (disembunyikan dari katalog publik) per semua pasangan.
 *  Opsi B (2026-10-02): winner None → sisi SK disembunyikan, WR tampil
 *  sebagai wakil 1 kartu (1 barang = 1 kartu, katalog stabil). */
export async function loserProductIds(database?: DatabaseAccess): Promise<Set<number>> {
  const db = database ?? createDatabaseAccess();
  const pairs = (await db.queryAll(`SELECT * FROM supplier_pairs`).catch(() => [] as Row[])) as unknown as PairRow[];
  const losers = new Set<number>();
  for (const pair of pairs) {
    losers.add(pair.winner === "WR" || pair.winner == null ? Number(pair.sk_product_id) : Number(pair.wr_product_id));
  }
  return losers;
}

/**
 * Fragmen SQL "produk ini BUKAN pecundang pasangan" untuk kanal bot
 * (Telegram, 2026-10-04 — paritas Web). Aturan sama dengan
 * `loserProductIds` + filter `/api/products` + promo digest (Opsi B: winner
 * NULL → SK disembunyikan). Tanpa parameter bind, aman disisipkan ke WHERE.
 */
export function notLoserProductSql(productAlias = "p"): string {
  return `NOT EXISTS (
    SELECT 1 FROM supplier_pairs pair
    WHERE ${productAlias}.id = CASE WHEN pair.winner IS NULL OR pair.winner='WR'
      THEN pair.sk_product_id ELSE pair.wr_product_id END
  )`;
}

/**
 * Bila `productId` adalah pecundang pasangan, kembalikan id pemenangnya
 * (wakil yang tampil). Dipakai detail produk bot agar tombol lama yang
 * menunjuk pecundang tidak menampilkan produk dobel — cermin redirect 308
 * PDP web. null = bukan pecundang.
 */
export async function winnerForLoserProduct(productId: number, database?: DatabaseAccess): Promise<number | null> {
  const db = database ?? createDatabaseAccess();
  const row = await db
    .queryFirst(
      `SELECT CASE WHEN winner IS NULL OR winner='WR' THEN wr_product_id ELSE sk_product_id END AS shown
       FROM supplier_pairs
       WHERE ? = CASE WHEN winner IS NULL OR winner='WR' THEN sk_product_id ELSE wr_product_id END
       LIMIT 1`,
      productId,
    )
    .catch(() => null);
  const shown = Number(row?.shown ?? 0);
  return Number.isInteger(shown) && shown > 0 && shown !== productId ? shown : null;
}
