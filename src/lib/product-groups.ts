// src/lib/product-groups.ts — Grup produk lintas supplier (16 November 2026).
//
// Menggantikan pasangan WR vs SK: satu grup berisi 2..10 produk dari supplier
// apa pun (WR, SK, TUNVN, AIVault, Manual). Katalog publik hanya menampilkan
// satu anggota (winner) per grup.
//
// Aturan keputusan (keputusan owner 16 Nov 2026):
//   0. Produk MANUAL yang live SELALU menang atas supplier. Beberapa manual
//      live → stok (∞ = -1), lalu modal per 30 hari termurah, lalu position.
//   1. Anggota nonaktif/arsip tidak boleh menahan anggota aktif.
//   2. STOK dulu: anggota tanpa stok yang bisa dibeli kalah.
//   3. MODAL PER 30 HARI termurah menang. Normalisasi memakai
//      product_variants.duration_value/unit (day→N, month→N*30, year→N*365;
//      lifetime/custom/NULL = apa adanya). WR wajib lolos wrNewSaleSql.
//   4. PREFER admin mengalahkan selisih modal ≤ prefer_margin (semantik lama).
//   5. Semua habis → wakil 1 kartu: prefer aktif → manual aktif → position
//      terkecil. Tanpa anggota aktif sama sekali → winner NULL.
//
// Statistik diambil SATU query agregat (insiden CPU 1102): satu baris per
// (grup, anggota), keputusan murni di JS, UPDATE hanya baris berubah.
import { wrNewSaleSql } from "@/lib/warung-rebahan/new-sales";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { effectiveVariantStockSql } from "@/lib/catalog-availability";

type Row = Record<string, unknown>;
export type ProductGroupSupplier = "WR" | "SK" | "TUNVN" | "AIVault" | "StoreBat" | "Mirai" | "Manual";

export type GroupMemberStats = {
  productId: number;
  name: string;
  slug: string | null;
  image: string | null;
  supplier: ProductGroupSupplier;
  position: number;
  exists: boolean;
  isActive: boolean;
  archived: boolean;
  stock: number;
  modal: number | null;
};

export type GroupStats = {
  id: number;
  name: string;
  preferProductId: number | null;
  preferMargin: number;
  winnerProductId: number | null;
  reason: string | null;
  decidedAt: string | null;
  members: GroupMemberStats[];
};

export type GroupDecision = { winnerProductId: number | null; reason: string };

export type GroupMemberView = {
  product_id: number;
  name: string;
  slug: string | null;
  image: string | null;
  supplier: ProductGroupSupplier;
  is_active: boolean;
  archived: boolean;
  live: boolean;
  stock: number;
  modal_per_30d: number | null;
  position: number;
};

export type GroupView = {
  id: number;
  name: string;
  prefer_product_id: number | null;
  prefer_margin: number;
  winner_product_id: number | null;
  reason: string | null;
  decided_at: string | null;
  members: GroupMemberView[];
};

const FX = "CASE WHEN CAST(cm.fx_rate_text AS REAL)>0 THEN CAST(cm.fx_rate_text AS REAL) END";
const VARIANT_FROM = `FROM product_variants v
  LEFT JOIN wr_variants wr ON wr.wr_variant_id=v.wr_variant_id
  LEFT JOIN sk_products sk ON sk.sk_variant_id=v.sk_variant_id
  LEFT JOIN tunvn_products tp ON tp.supplier_product_id=COALESCE(v.tunvn_source_product_id, CASE WHEN v.sku LIKE 'TUNVN-%' THEN CAST(substr(v.sku,7) AS INTEGER) END)
  LEFT JOIN aivault_products av ON av.service_id=v.aivault_service_id`;
// Local reservations are authoritative too; -1 removes only that side's cap.
const SUPPLIER_STOCK = `(CASE WHEN v.sk_variant_id IS NOT NULL THEN CASE WHEN sk.is_active=1 THEN sk.sk_stock ELSE 0 END
  WHEN v.wr_variant_id IS NOT NULL THEN CASE WHEN wr.is_active=1 THEN wr.wr_stock ELSE 0 END ELSE -1 END)`;
const LOCAL_STOCK = effectiveVariantStockSql("v");
const EFFECTIVE_STOCK = `(CASE WHEN ${LOCAL_STOCK}=-1 THEN ${SUPPLIER_STOCK}
  WHEN ${SUPPLIER_STOCK}=-1 THEN ${LOCAL_STOCK} ELSE MIN(${LOCAL_STOCK},${SUPPLIER_STOCK}) END)`;
const BUYABLE_VARIANT = `${wrNewSaleSql("v")} AND (${EFFECTIVE_STOCK}=-1 OR ${EFFECTIVE_STOCK}>=MAX(1,COALESCE(v.min_qty,1)))`;
const VARIANT_COST = `CASE
  WHEN v.sk_variant_id IS NOT NULL THEN sk.sk_price
  WHEN v.wr_variant_id IS NOT NULL THEN wr.wr_price
  WHEN v.storebat_product_id IS NOT NULL THEN v.storebat_cost_usd * COALESCE(NULLIF(v.storebat_fx_idr_per_usd,0), ${FX})
  WHEN v.mirai_package_code IS NOT NULL THEN v.mirai_cost_usdt * COALESCE(NULLIF(v.mirai_fx_idr_per_usdt,0), ${FX})
  WHEN v.aivault_service_id IS NOT NULL THEN av.unit_price_usd * COALESCE(NULLIF(av.fx_idr_per_usd,0), ${FX})
  WHEN v.tunvn_buff_quantity_b IS NOT NULL OR v.sku LIKE 'TUNVN-BUFF%' THEN v.tunvn_cost_usdt * COALESCE(NULLIF(v.tunvn_fx_idr_per_usdt,0), ${FX})
  WHEN v.tunvn_source_product_id IS NOT NULL OR v.sku LIKE 'TUNVN-%' THEN tp.price_usdt * COALESCE(NULLIF(tp.fx_idr_per_usdt,0), ${FX})
  ELSE v.manual_cost END`;
const NORMALIZE_30D = `CASE
  WHEN v.duration_unit='day' AND v.duration_value>0 THEN 30.0/v.duration_value
  WHEN v.duration_unit='month' AND v.duration_value>0 THEN 30.0/(v.duration_value*30.0)
  WHEN v.duration_unit='year' AND v.duration_value>0 THEN 30.0/(v.duration_value*365.0)
  ELSE 1.0 END`;

const MEMBER_STOCK_SQL = `(SELECT CASE WHEN MAX(CASE WHEN ${EFFECTIVE_STOCK}=-1 THEN 1 ELSE 0 END)=1 THEN -1
    ELSE COALESCE(SUM(CASE WHEN ${EFFECTIVE_STOCK}>0 THEN ${EFFECTIVE_STOCK} ELSE 0 END),0) END
  ${VARIANT_FROM}
  WHERE v.product_id=m.product_id AND v.is_active=1 AND ${BUYABLE_VARIANT})`;
const MEMBER_MODAL_SQL = `(SELECT MIN((${VARIANT_COST}) * (${NORMALIZE_30D}))
  ${VARIANT_FROM}
  WHERE v.product_id=m.product_id AND v.is_active=1 AND ${BUYABLE_VARIANT})`;

const GROUP_STATS_SELECT = `SELECT g.id AS group_id, g.name AS group_name, g.prefer_product_id, g.prefer_margin,
    g.winner_product_id, g.reason AS group_reason, g.decided_at, m.product_id, m.position,
    p.id AS p_id, p.name AS p_name, p.slug AS p_slug, p.image_url AS p_image,
    p.is_active AS p_active, p.archived_at AS p_archived,
    p.source AS p_source, p.wr_product_id AS p_wr, p.sk_product_id AS p_sk,
    p.tunvn_family AS p_tunvn, p.aivault_family AS p_aivault, p.storebat_family AS p_storebat, p.mirai_family AS p_mirai,
    ${MEMBER_STOCK_SQL} AS st_stock,
    ${MEMBER_MODAL_SQL} AS st_modal`;
const GROUP_STATS_FROM = `FROM product_groups g
  LEFT JOIN product_group_members m ON m.group_id=g.id
  LEFT JOIN products p ON p.id=m.product_id
  LEFT JOIN crypto_market_snapshot cm ON cm.id=1`;

function supplierOf(row: Row): ProductGroupSupplier {
  if (row.p_tunvn != null) return "TUNVN";
  if (row.p_storebat != null) return "StoreBat";
  if (row.p_mirai != null) return "Mirai";
  if (row.p_aivault != null) return "AIVault";
  if (row.p_sk != null) return "SK";
  if (String(row.p_source ?? "") === "warung_rebahan" || row.p_wr != null) return "WR";
  return "Manual";
}

function memberFromRow(row: Row): GroupMemberStats {
  const exists = row.p_id != null;
  const stock = Number(row.st_stock ?? 0) === -1 ? -1 : Number(row.st_stock ?? 0);
  return {
    productId: Number(row.product_id),
    name: String(row.p_name ?? `Produk #${row.product_id}`),
    slug: row.p_slug == null ? null : String(row.p_slug),
    image: row.p_image == null ? null : String(row.p_image),
    supplier: supplierOf(row),
    position: Number(row.position ?? 0),
    exists,
    isActive: exists && Number(row.p_active ?? 0) !== 0,
    archived: exists && row.p_archived != null,
    stock,
    modal: row.st_modal == null ? null : Number(row.st_modal),
  };
}

function groupFromRows(rows: Row[]): GroupStats[] {
  const groups = new Map<number, GroupStats>();
  for (const row of rows) {
    const id = Number(row.group_id);
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name: String(row.group_name ?? `Grup ${id}`),
        preferProductId: row.prefer_product_id == null ? null : Number(row.prefer_product_id),
        preferMargin: Number(row.prefer_margin ?? 2000),
        winnerProductId: row.winner_product_id == null ? null : Number(row.winner_product_id),
        reason: row.group_reason == null ? null : String(row.group_reason),
        decidedAt: row.decided_at == null ? null : String(row.decided_at),
        members: [],
      };
      groups.set(id, group);
    }
    if (row.product_id != null) group.members.push(memberFromRow(row));
  }
  for (const group of groups.values()) group.members.sort((a, b) => a.position - b.position || a.productId - b.productId);
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

function byPosition(a: GroupMemberStats, b: GroupMemberStats): number {
  return a.position - b.position || a.productId - b.productId;
}

function buyable(member: GroupMemberStats): boolean {
  return member.exists && member.isActive && !member.archived && (member.stock === -1 || member.stock > 0);
}

function stockLabel(stock: number): string {
  return stock === -1 ? "∞" : String(Math.max(0, stock));
}

function money(value: number): string {
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

/** Anggota yang tetap tampil saat semua habis: prefer aktif → manual aktif → position. */
function representative(active: GroupMemberStats[], group: Pick<GroupStats, "preferProductId">): GroupMemberStats {
  const prefer = group.preferProductId == null ? null : active.find((m) => m.productId === group.preferProductId);
  if (prefer) return prefer;
  const manual = active.filter((m) => m.supplier === "Manual").sort(byPosition);
  return manual[0] ?? [...active].sort(byPosition)[0];
}

/**
 * Keputusan murni (tanpa DB). `members` sudah berisi stok/modal per 30 hari.
 * Alasan dibatasi 300 karakter agar cocok dengan kolom audit.
 */
export function decideGroupFromStats(
  group: Pick<GroupStats, "preferProductId" | "preferMargin">,
  members: GroupMemberStats[],
): GroupDecision {
  const active = members.filter((m) => m.exists && m.isActive && !m.archived);
  // Anggota nonaktif manual/arsip SELALU keluar dari persaingan: tidak pernah
  // winner maupun wakil "semua habis", termasuk bila ditunjuk prefer.
  if (!active.length) return { winnerProductId: null, reason: "semua anggota nonaktif manual" };

  // 0. Manual live selalu menang atas supplier.
  const manualLive = active.filter((m) => m.supplier === "Manual" && buyable(m));
  if (manualLive.length) {
    const maxStock = Math.max(...manualLive.map((m) => (m.stock === -1 ? Number.POSITIVE_INFINITY : m.stock)));
    let pool = manualLive.filter((m) => (m.stock === -1 ? Number.POSITIVE_INFINITY : m.stock) === maxStock);
    const readable = pool.filter((m) => m.modal != null && Number.isFinite(m.modal));
    if (readable.length) {
      const min = Math.min(...readable.map((m) => Number(m.modal)));
      pool = readable.filter((m) => Number(m.modal) === min);
    }
    const chosen = [...pool].sort(byPosition)[0];
    return { winnerProductId: chosen.productId, reason: `Manual live (${chosen.name} #${chosen.productId})`.slice(0, 300) };
  }

  // 2-3. Stok dulu, lalu modal per 30 hari.
  const available = active.filter(buyable);
  if (available.length) {
    const readable = available.filter((m) => m.modal != null && Number.isFinite(m.modal));
    if (!readable.length) {
      const rep = representative(available, group);
      return { winnerProductId: rep.productId, reason: `modal tak terbaca — wakil ${rep.name} #${rep.productId} (stok ${stockLabel(rep.stock)})`.slice(0, 300) };
    }
    const min = Math.min(...readable.map((m) => Number(m.modal)));
    const cheapest = readable.filter((m) => Number(m.modal) === min).sort(byPosition);
    const prefer = group.preferProductId == null ? null : readable.find((m) => m.productId === group.preferProductId);
    if (prefer && prefer.modal != null && Math.abs(Number(prefer.modal) - min) <= group.preferMargin) {
      return {
        winnerProductId: prefer.productId,
        reason: `prefer ${prefer.name} (selisih ${money(Math.abs(Number(prefer.modal) - min))} ≤ margin ${money(group.preferMargin)})`.slice(0, 300),
      };
    }
    const chosen = cheapest.length > 1 && prefer && cheapest.some((m) => m.productId === prefer.productId) ? prefer : cheapest[0];
    const runner = readable.filter((m) => m.productId !== chosen.productId).sort((a, b) => Number(a.modal) - Number(b.modal) || byPosition(a, b))[0];
    const reason = runner
      ? `modal/30 hari ${chosen.supplier} ${money(min)} < ${runner.supplier} ${money(Number(runner.modal))}`
      : `modal/30 hari ${chosen.supplier} ${money(min)} termurah`;
    return { winnerProductId: chosen.productId, reason: reason.slice(0, 300) };
  }

  // 5. Semua habis → wakil 1 kartu.
  const rep = representative(active, group);
  return { winnerProductId: rep.productId, reason: `semua habis — wakil ${rep.name} #${rep.productId} (stok ${stockLabel(rep.stock)})`.slice(0, 300) };
}

async function loadGroupStats(db: DatabaseAccess, options: { groupId?: number; dirtyOnly?: boolean; productId?: number; limit?: number } = {}): Promise<{ groups: GroupStats[]; dirty: Map<number, string | null> }> {
  const dirtyCol = options.dirtyOnly ? "dirty.version" : "(SELECT version FROM product_group_dirty WHERE group_id=g.id)";
  const conditions: string[] = [];
  const params: unknown[] = [];
  let from = GROUP_STATS_FROM;
  if (options.dirtyOnly) {
    // Limit GROUPS before joining members: a row limit can decide a partial
    // group and acknowledge work without ever considering its last members.
    from += `\n  JOIN (SELECT * FROM product_group_dirty WHERE pending=1
      ${options.productId === undefined ? "" : "AND group_id IN (SELECT group_id FROM product_group_members WHERE product_id=?)"}
      ORDER BY group_id LIMIT ${options.limit ?? 10}) dirty ON dirty.group_id=g.id`;
    if (options.productId !== undefined) params.push(options.productId);
  }
  if (options.groupId !== undefined) { conditions.push("g.id=?"); params.push(options.groupId); }
  if (options.productId !== undefined && !options.dirtyOnly) {
    conditions.push("g.id IN (SELECT gm.group_id FROM product_group_members gm WHERE gm.product_id=?)");
    params.push(options.productId);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const source = await db.queryAll(
    `${GROUP_STATS_SELECT}, ${dirtyCol} AS dirty_version ${from}${where} ORDER BY g.id, m.position, m.product_id`,
    ...params,
  );
  const groups = groupFromRows(source);
  const dirty = new Map<number, string | null>();
  for (const row of source) dirty.set(Number(row.group_id), row.dirty_version == null ? null : String(row.dirty_version));
  return { groups, dirty };
}

async function updateGroupDecision(db: DatabaseAccess, group: GroupStats, dirtyVersion: string | null, ackDirty: boolean): Promise<boolean> {
  const decision = decideGroupFromStats(group, group.members);
  const now = new Date().toISOString();
  const changed = decision.winnerProductId !== group.winnerProductId || decision.reason !== group.reason;
  let winnerChanged = false;
  if (changed) {
    const result = await db.execRun(
      `UPDATE product_groups SET winner_product_id=?, reason=?, decided_at=?, updated_at=?
       WHERE id=? AND (winner_product_id IS NOT ? OR reason IS NOT ?)
         AND (SELECT version FROM product_group_dirty WHERE group_id=product_groups.id) IS ?`,
      decision.winnerProductId, decision.reason, now, now, group.id, decision.winnerProductId, decision.reason, dirtyVersion,
    );
    winnerChanged = Boolean(result.changes) && decision.winnerProductId !== group.winnerProductId;
  }
  if (ackDirty && dirtyVersion != null) {
    await db.execRun("UPDATE product_group_dirty SET pending=0 WHERE group_id=? AND version=? AND pending=1", group.id, dirtyVersion);
  }
  return winnerChanged;
}

/** Hitung ulang seluruh grup (endpoint admin + cron sweep). */
export async function decideAllGroups(database?: DatabaseAccess): Promise<{ decided: number; changed: number }> {
  const db = database ?? createDatabaseAccess();
  const { groups, dirty } = await loadGroupStats(db);
  let changed = 0;
  for (const group of groups) if (await updateGroupDecision(db, group, dirty.get(group.id) ?? null, false)) changed++;
  if (changed > 0) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
  }
  return { decided: groups.length, changed };
}

/** Drain grup yang ditandai trigger. `productId` mempersempit ke grup anggota itu. */
export async function decideDirtyGroups(database?: DatabaseAccess, productId?: number): Promise<{ decided: number; changed: number }> {
  const db = database ?? createDatabaseAccess();
  const { groups, dirty } = await loadGroupStats(db, { dirtyOnly: true, productId, limit: 10 });
  let decided = 0;
  let changed = 0;
  for (const group of groups) {
    // A changed decision must still be able to invalidate the catalog rev.
    if (!db.canSpend(3)) break;
    if (await updateGroupDecision(db, group, dirty.get(group.id) ?? null, true)) changed++;
    decided++;
  }
  if (changed > 0) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
  }
  return { decided, changed };
}

/** Keputusan satu grup secara sinkron (mutasi admin). */
export async function decideGroup(groupId: number, database?: DatabaseAccess): Promise<GroupDecision> {
  const db = database ?? createDatabaseAccess();
  const { groups, dirty } = await loadGroupStats(db, { groupId });
  const group = groups[0];
  if (!group) return { winnerProductId: null, reason: "grup tidak ditemukan" };
  const decision = decideGroupFromStats(group, group.members);
  const winnerChanged = await updateGroupDecision(db, group, dirty.get(group.id) ?? null, true);
  if (winnerChanged) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
  }
  return decision;
}

/** Id anggota yang disembunyikan katalog (semua anggota grup selain winner). */
export async function loserProductIds(database?: DatabaseAccess): Promise<Set<number>> {
  const db = database ?? createDatabaseAccess();
  const rows = await db.queryAll(`SELECT m.product_id FROM product_group_members m
    JOIN product_groups g ON g.id=m.group_id
    WHERE g.winner_product_id IS NOT NULL AND m.product_id<>g.winner_product_id`).catch(() => [] as Row[]);
  return new Set(rows.map((row) => Number(row.product_id ?? 0)).filter((id) => Number.isInteger(id) && id > 0));
}

/** Fragmen SQL "produk ini bukan pecundang grup" (tanpa bind). */
export function notLoserProductSql(productAlias = "p"): string {
  return `NOT EXISTS (SELECT 1 FROM product_group_members gm
    JOIN product_groups gg ON gg.id=gm.group_id
    WHERE gm.product_id=${productAlias}.id AND gg.winner_product_id IS NOT NULL
      AND gg.winner_product_id<>gm.product_id)`;
}

/** Bila `productId` pecundang, kembalikan id winner grupnya; null = bukan pecundang. */
export async function winnerForLoserProduct(productId: number, database?: DatabaseAccess): Promise<number | null> {
  const db = database ?? createDatabaseAccess();
  const row = await db.queryFirst(`SELECT g.winner_product_id AS shown FROM product_group_members m
    JOIN product_groups g ON g.id=m.group_id
    WHERE m.product_id=? AND g.winner_product_id IS NOT NULL AND g.winner_product_id<>m.product_id
    LIMIT 1`, productId).catch(() => null);
  const shown = Number(row?.shown ?? 0);
  return Number.isInteger(shown) && shown > 0 && shown !== productId ? shown : null;
}

// ---- API admin: baca & mutasi grup ----

export class ProductGroupError extends Error {
  constructor(public code: string, message: string, public status = 400, public groupId?: number) {
    super(message);
    this.name = "ProductGroupError";
  }
}

export async function listProductGroups(database?: DatabaseAccess, groupId?: number): Promise<GroupView[]> {
  const db = database ?? createDatabaseAccess();
  const { groups } = await loadGroupStats(db, groupId === undefined ? {} : { groupId });
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    prefer_product_id: group.preferProductId,
    prefer_margin: group.preferMargin,
    winner_product_id: group.winnerProductId,
    reason: group.reason,
    decided_at: group.decidedAt,
    members: group.members.map((m) => ({
      product_id: m.productId,
      name: m.name,
      slug: m.slug,
      image: m.image,
      supplier: m.supplier,
      is_active: m.isActive,
      archived: m.archived,
      live: buyable(m),
      stock: m.stock,
      modal_per_30d: m.modal,
      position: m.position,
    })),
  }));
}

async function assertProducts(db: DatabaseAccess, productIds: number[]): Promise<void> {
  const ids = [...new Set(productIds)];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.queryAll(`SELECT id, archived_at FROM products WHERE id IN (${placeholders})`, ...ids);
  const found = new Map(rows.map((row) => [Number(row.id), row]));
  if (found.size !== ids.length) throw new ProductGroupError("invalid_products", "Sebagian produk tidak ditemukan", 400);
  if ([...found.values()].some((row) => row.archived_at != null)) throw new ProductGroupError("archived_product", "Produk arsip tidak boleh masuk grup", 400);
  const grouped = await db.queryAll(`SELECT product_id, group_id FROM product_group_members WHERE product_id IN (${placeholders})`, ...ids);
  if (grouped.length) throw new ProductGroupError("already_grouped", "Produk sudah ada di grup lain", 409, Number(grouped[0].group_id));
}

export async function createProductGroup(input: { name: string; productIds: number[] }, database?: DatabaseAccess): Promise<GroupView> {
  const db = database ?? createDatabaseAccess();
  const name = input.name.trim();
  const ids = [...new Set(input.productIds.map(Number))].filter((id) => Number.isInteger(id) && id > 0);
  if (!name || name.length > 120) throw new ProductGroupError("invalid_name", "Nama grup wajib 1..120 karakter", 400);
  if (ids.length < 2 || ids.length > 10 || ids.length !== input.productIds.length) throw new ProductGroupError("invalid_products", "Grup berisi 2..10 produk unik", 400);
  await assertProducts(db, ids);
  const d1 = db.getD1();
  if (!d1) throw new ProductGroupError("database_unavailable", "Butuh database D1", 503);
  // D1 batch rolls the header AND all members back together on conflict.
  // MAX(id) refers to this batch's header: no other writer can interleave.
  const inserted = await d1.batch([
    d1.prepare("INSERT INTO product_groups(name) VALUES(?)").bind(name),
    ...ids.map((productId, position) => d1.prepare("INSERT INTO product_group_members(group_id,product_id,position) VALUES((SELECT MAX(id) FROM product_groups),?,?)").bind(productId, position)),
  ]).catch(async error => {
    await assertProducts(db, ids);
    throw error;
  });
  const groupId = Number(inserted[0].meta.last_row_id ?? 0);
  if (!groupId) throw new ProductGroupError("create_failed", "Grup gagal dibuat", 500);
  const decision = await decideGroup(groupId, db);
  // Satu grup = satu slot: seluruh anggota berbagi category_id + sort_order milik anchor.
  const anchorId = decision.winnerProductId ?? ids[0];
  const placeholders = ids.map(() => "?").join(",");
  const slotRows = await db.queryAll(
    `SELECT id, category_id, sort_order FROM products WHERE id IN (${placeholders})`,
    ...ids,
  );
  const anchorRow = slotRows.find((r) => Number(r.id) === anchorId);
  if (anchorRow) {
    const targetCategoryId = anchorRow.category_id == null ? null : Number(anchorRow.category_id);
    const targetSortOrder = anchorRow.sort_order == null ? 0 : Number(anchorRow.sort_order);
    const toSync = slotRows.filter((r) => {
      const catId = r.category_id == null ? null : Number(r.category_id);
      const sortOrder = r.sort_order == null ? 0 : Number(r.sort_order);
      return Number(r.id) !== anchorId && (catId !== targetCategoryId || sortOrder !== targetSortOrder);
    });
    if (toSync.length > 0) {
      await d1.batch(
        toSync.map((r) =>
          d1.prepare("UPDATE products SET category_id=?, sort_order=?, updated_at=datetime('now') WHERE id=?")
            .bind(targetCategoryId, targetSortOrder, Number(r.id)),
        ),
      );
      if (decision.winnerProductId == null) {
        const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
        await bumpCatalogRevision("market", db);
      }
    }
  }
  return (await listProductGroups(db, groupId))[0];
}

export async function updateProductGroup(id: number, input: { name?: string; prefer_product_id?: number | null; prefer_margin?: number }, database?: DatabaseAccess): Promise<GroupView> {
  const db = database ?? createDatabaseAccess();
  const group = (await listProductGroups(db, id))[0];
  if (!group) throw new ProductGroupError("not_found", "Grup tidak ditemukan", 404);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name || name.length > 120) throw new ProductGroupError("invalid_name", "Nama grup wajib 1..120 karakter", 400);
    sets.push("name=?"); params.push(name);
  }
  if (input.prefer_product_id !== undefined) {
    const prefer = input.prefer_product_id == null ? null : Number(input.prefer_product_id);
    if (prefer != null && !group.members.some((m) => m.product_id === prefer)) throw new ProductGroupError("invalid_prefer", "Prefer harus anggota grup", 400);
    sets.push("prefer_product_id=?"); params.push(prefer);
  }
  if (input.prefer_margin !== undefined) {
    const margin = Number(input.prefer_margin);
    if (!Number.isInteger(margin) || margin < 0 || margin > 1_000_000) throw new ProductGroupError("invalid_margin", "Margin prefer 0..1.000.000", 400);
    sets.push("prefer_margin=?"); params.push(margin);
  }
  if (sets.length) {
    params.push(id);
    await db.execRun(`UPDATE product_groups SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?`, ...params);
  }
  await decideGroup(id, db);
  return (await listProductGroups(db, id))[0];
}

export async function deleteProductGroup(id: number, database?: DatabaseAccess): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const group = await db.queryFirst("SELECT id, winner_product_id FROM product_groups WHERE id=?", id);
  if (!group) throw new ProductGroupError("not_found", "Grup tidak ditemukan", 404);
  // FK cascades delete members/dirty atomically, never partially dissolve it.
  await db.execRun("DELETE FROM product_groups WHERE id=?", id);
  if (group.winner_product_id != null) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
  }
  return true;
}

export async function addGroupMember(id: number, productId: number, database?: DatabaseAccess): Promise<GroupView> {
  const db = database ?? createDatabaseAccess();
  const group = (await listProductGroups(db, id))[0];
  if (!group) throw new ProductGroupError("not_found", "Grup tidak ditemukan", 404);
  if (group.members.length >= 10) throw new ProductGroupError("too_many_members", "Maksimal 10 anggota", 400);
  if (group.members.some((m) => m.product_id === productId)) throw new ProductGroupError("already_member", "Produk sudah anggota grup ini", 409);
  await assertProducts(db, [productId]);
  const nextPosition = Math.max(-1, ...group.members.map((m) => m.position)) + 1;
  // Anchor sebelum penambahan: winner aktif saat ini, atau anggota ber-position terkecil.
  const anchorId = group.winner_product_id ?? group.members[0]?.product_id;
  const slotRows = anchorId != null
    ? await db.queryAll("SELECT id, category_id, sort_order FROM products WHERE id IN (?, ?)", anchorId, productId)
    : [];
  const anchorRow = anchorId != null ? slotRows.find((r) => Number(r.id) === anchorId) : undefined;
  const newRow = slotRows.find((r) => Number(r.id) === productId);
  const targetCategoryId = anchorRow?.category_id == null ? null : Number(anchorRow.category_id);
  const targetSortOrder = anchorRow?.sort_order == null ? 0 : Number(anchorRow.sort_order);
  const needsSlotSync = Boolean(
    anchorRow && newRow && (
      (newRow.category_id == null ? null : Number(newRow.category_id)) !== targetCategoryId
      || (newRow.sort_order == null ? 0 : Number(newRow.sort_order)) !== targetSortOrder
    ),
  );
  const d1 = db.getD1();
  if (d1 && needsSlotSync) {
    await d1.batch([
      d1.prepare("INSERT INTO product_group_members(group_id,product_id,position) VALUES(?,?,?)").bind(id, productId, nextPosition),
      d1.prepare("UPDATE products SET category_id=?, sort_order=?, updated_at=datetime('now') WHERE id=?").bind(targetCategoryId, targetSortOrder, productId),
    ]).catch(async error => {
      await assertProducts(db, [productId]);
      if (String(error).includes("group_full")) throw new ProductGroupError("too_many_members", "Maksimal 10 anggota", 400);
      throw error;
    });
  } else {
    await db.execRun("INSERT INTO product_group_members(group_id,product_id,position) VALUES(?,?,?)", id, productId, nextPosition).catch(async error => {
      await assertProducts(db, [productId]);
      if (String(error).includes("group_full")) throw new ProductGroupError("too_many_members", "Maksimal 10 anggota", 400);
      throw error;
    });
    if (needsSlotSync) {
      await db.execRun("UPDATE products SET category_id=?, sort_order=?, updated_at=datetime('now') WHERE id=?", targetCategoryId, targetSortOrder, productId);
    }
  }
  await decideGroup(id, db);
  // Even if winner_product_id stayed the same, the newly added member may now be hidden as a loser.
  const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
  await bumpCatalogRevision("market", db);
  return (await listProductGroups(db, id))[0];
}

export async function removeGroupMember(id: number, productId: number, database?: DatabaseAccess): Promise<{ group: GroupView | null; deleted: boolean }> {
  const db = database ?? createDatabaseAccess();
  const group = (await listProductGroups(db, id))[0];
  if (!group) throw new ProductGroupError("not_found", "Grup tidak ditemukan", 404);
  if (!group.members.some((m) => m.product_id === productId)) throw new ProductGroupError("not_member", "Produk bukan anggota grup", 404);
  const d1 = db.getD1();
  if (!d1) throw new ProductGroupError("database_unavailable", "Butuh database D1", 503);
  await d1.batch([
    d1.prepare("DELETE FROM product_group_members WHERE group_id=? AND product_id=?").bind(id, productId),
    d1.prepare("DELETE FROM product_groups WHERE id=? AND (SELECT COUNT(*) FROM product_group_members WHERE group_id=?)<2").bind(id, id),
  ]);
  if (!(await db.queryFirst("SELECT id FROM product_groups WHERE id=?", id))) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
    return { group: null, deleted: true };
  }
  await decideGroup(id, db);
  const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
  await bumpCatalogRevision("market", db);
  return { group: (await listProductGroups(db, id))[0], deleted: false };
}

/**
 * SQL scalar: angka "terjual" yang tampil ke pembeli. Produk anggota grup
 * menampilkan JUMLAH sold_count semua anggota grup (termasuk nonaktif/arsip);
 * produk tanpa grup memakai sold_count sendiri. Tidak mengubah products.sold_count.
 * Satu subquery berkorelasi (batas kedalaman ekspresi D1).
 */
export function displaySoldCountSql(alias = "p"): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("invalid_sql_alias");
  return `COALESCE((SELECT SUM(COALESCE(x.sold_count,0)) FROM product_group_members gm JOIN product_group_members om ON om.group_id=gm.group_id JOIN products x ON x.id=om.product_id WHERE gm.product_id=${alias}.id), ${alias}.sold_count)`;
}
