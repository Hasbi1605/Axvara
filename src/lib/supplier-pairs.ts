// src/lib/supplier-pairs.ts — Pemenang otomatis WR vs SK per pasangan.
// Keputusan owner 2026-09-30: produk yang sama di dua supplier dipilih
// OTOMATIS mana yang tampil (stok dulu, modal kemudian), bukan manual.
//
// Aturan prioritas (decideWinner):
//   1. STOK DULU: yang stok 0 otomatis kalah. Pemenang = yang berstok.
//      Dua-duanya habis → winner NULL (dua-duanya disembunyikan dari publik,
//      tetap ada di admin). Dua-duanya berstok → bandingkan modal.
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

/** Stok agregat produk = SUM varian aktif berstok (cermin agregat sync). */
async function productStock(productId: number, db: DatabaseAccess): Promise<number> {
  const row = await db
    .queryFirst(
      `SELECT COALESCE(SUM(CASE WHEN stock>0 THEN stock ELSE 0 END),0) AS s,
              MAX(CASE WHEN stock=-1 THEN 1 ELSE 0 END) AS unl
       FROM product_variants WHERE product_id=? AND is_active=1`,
      productId,
    )
    .catch(() => null);
  if (!row) return 0;
  if (Number(row.unl ?? 0) === 1) return Number.MAX_SAFE_INTEGER;
  return Number(row.s ?? 0);
}

/** Modal termurah = MIN harga pokok varian aktif (registry supplier). */
async function cheapestModal(productId: number, db: DatabaseAccess): Promise<number | null> {
  // SK: sk_price. WR: wr_price. Produk selalu salah satu (bukan keduanya).
  const sk = await db
    .queryFirst(
      `SELECT MIN(s.sk_price) AS m FROM sk_products s
       JOIN product_variants v ON v.sk_variant_id=s.sk_variant_id
       WHERE v.product_id=? AND v.is_active=1 AND s.sk_stock>0`,
      productId,
    )
    .catch(() => null);
  if (sk?.m != null) return Number(sk.m);
  const wr = await db
    .queryFirst(
      `SELECT MIN(w.wr_price) AS m FROM wr_variants w
       JOIN product_variants v ON v.wr_variant_id=w.wr_variant_id
       WHERE v.product_id=? AND v.is_active=1 AND w.wr_stock>0`,
      productId,
    )
    .catch(() => null);
  if (wr?.m != null) return Number(wr.m);
  return null;
}

/**
 * Tentukan pemenang satu pasangan. Murni fungsi baca + tulis baris pairs —
 * murah (4 query ringan), aman dipanggil tiap sweep untuk semua pasangan.
 */
export async function decideOneWinner(pair: PairRow, db: DatabaseAccess): Promise<{ winner: PairWinner; reason: string }> {
  // Guard pasangan yatim (cermin WR 2026-09-11): produk dihapus manual →
  // pasangan tidak diputuskan (winner NULL), dibersihkan admin belakangan.
  const wrExists = await db.queryFirst(`SELECT id FROM products WHERE id=?`, pair.wr_product_id).catch(() => null);
  const skExists = await db.queryFirst(`SELECT id FROM products WHERE id=?`, pair.sk_product_id).catch(() => null);
  if (!wrExists || !skExists) {
    return { winner: null, reason: "pasangan_yatim" };
  }
  const [wrStock, skStock] = await Promise.all([
    productStock(pair.wr_product_id, db),
    productStock(pair.sk_product_id, db),
  ]);
  const wrHas = wrStock > 0;
  const skHas = skStock > 0;
  // 1. STOK DULU.
  if (wrHas && !skHas) return { winner: "WR", reason: `stok SK habis (WR ${wrStock})` };
  if (skHas && !wrHas) return { winner: "SK", reason: `stok WR habis (SK ${skStock})` };
  if (!wrHas && !skHas) return { winner: null, reason: "dua-duanya habis" };
  // 2. MODAL KEMUDIAN (dua-duanya berstok).
  const [wrModal, skModal] = await Promise.all([
    cheapestModal(pair.wr_product_id, db),
    cheapestModal(pair.sk_product_id, db),
  ]);
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
 * Hitung ulang semua pasangan. Best-effort: 1 pasangan gagal tidak
 * menghentikan yang lain (cermin batch per-produk WR 22 Sep).
 */
export async function decideAllWinners(database?: DatabaseAccess): Promise<{ decided: number; changed: number }> {
  const db = database ?? createDatabaseAccess();
  const pairs = (await db.queryAll(`SELECT * FROM supplier_pairs`).catch(() => [] as Row[])) as unknown as PairRow[];
  let decided = 0;
  let changed = 0;
  const now = new Date().toISOString();
  for (const pair of pairs) {
    try {
      const { winner, reason } = await decideOneWinner(pair, db);
      decided++;
      if (winner !== pair.winner) changed++;
      await db
        .execRun(
          `UPDATE supplier_pairs SET winner=?, decided_at=?, reason=?, updated_at=?
           WHERE id=? AND (winner IS NOT ? OR reason IS NOT ?)`,
          winner, now, reason.slice(0, 300), now, pair.id, winner, reason.slice(0, 300),
        )
        .catch(() => ({ changes: 0 }));
    } catch {
      /* pasangan gagal = lewati, sweep berikut retry */
    }
  }
  return { decided, changed };
}

/** Id pecundang (disembunyikan dari katalog publik) per semua pasangan. */
export async function loserProductIds(database?: DatabaseAccess): Promise<Set<number>> {
  const db = database ?? createDatabaseAccess();
  const pairs = (await db.queryAll(`SELECT * FROM supplier_pairs WHERE winner IS NOT NULL`).catch(() => [] as Row[])) as unknown as PairRow[];
  const losers = new Set<number>();
  for (const pair of pairs) {
    losers.add(pair.winner === "WR" ? Number(pair.sk_product_id) : Number(pair.wr_product_id));
  }
  return losers;
}
