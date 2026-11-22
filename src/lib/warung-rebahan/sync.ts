// src/lib/warung-rebahan/sync.ts — Product sync engine WR → Axvara.
// Idempoten: upsert by wr_product_id / wr_variant_id. Produk yang hilang dari
// respons WR hanya di-nol-kan stoknya (WR bisa hide sementara), tidak dihapus.
//
// BUDGET-AWARE (P0-4): syncProducts menerima maxStatements dan berhenti
// sebelum budget habis, menyimpan cursor di wr_sync_state agar invocation
// berikutnya MELANJUTKAN (bukan mengulang dari awal). Kapasitas order
// diprioritaskan: pemanggil (cron) menjalankan processWrPendingOrders DULU
// sebelum sync produk. Exclusion rules di-cache sekali per run.
// DESTRUCTIVE GUARD: zeroMissingVariants hanya berjalan setelah satu sweep
// PENUH tervalidasi; respons malformed/empty/partial tidak me-zero katalog.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import {
  fetchJaspayProducts,
  fetchProducts,
  fetchProductsSlice,
  isWrSyncEnabled,
  type WrProduct,
} from "./client";
import { JASPAY_LEGACY_PRODUCTS } from "./new-sales";
import {
  COST_PER_WR_PRODUCT_SYNC,
  COST_PER_WR_VARIANT_SYNC,
  PREFETCH_PARAM_CHUNK,
  WR_SYNC_CATALOG_BUDGET_EXTRA,
  WR_SYNC_CHECKPOINT_EVERY,
  WR_SYNC_PRODUCTS_PER_RUN,
} from "./sync/constants";
import { isExcluded } from "./sync/exclusion";
import {
  calculateSellPrice,
  defaultMarkupFixed,
  defaultMarkupPercent,
  generateProductSlug,
  mapWrCategory,
  parseWrDuration,
  parseWrWarranty,
} from "./sync/pricing";
import { planLinkedProductWrites, upsertWrProduct } from "./sync/product";
import type { JaspaySyncResult, Row, SqlWrite, SyncOptions, SyncResult, VariantOutcome } from "./sync/types";
import { chunked, placeholders, runWrites } from "./sync/writes";

export { upsertWrProduct } from "./sync/product";
import { insertNewVariant, planExistingVariantWrites, planParentAggregateWrite, refreshParentAggregates } from "./sync/variant";

export { refreshParentAggregates, upsertWrVariant } from "./sync/variant";

export {
  COST_PER_WR_PRODUCT_SYNC,
  COST_PER_WR_VARIANT_SYNC,
  COST_WR_EXCLUSION_FETCH,
  WR_SYNC_PRODUCTS_PER_RUN,
  WR_SYNC_CATALOG_BUDGET_EXTRA,
  WR_SYNC_MIN_PRODUCTS_GUARD,
  WR_SYNC_CHECKPOINT_EVERY,
} from "./sync/constants";
export type { JaspaySyncResult, SyncOptions, SyncResult, VariantOutcome } from "./sync/types";

export { calculateSellPrice, generateProductSlug, parseWrDuration, parseWrWarranty, mapWrCategory, isExcluded };

/**
 * Ambil SEMUA baris `wr_variants` yang dibutuhkan sweep ini dalam beberapa
 * query `IN (...)`, bukan satu SELECT per varian.
 *
 * Ini separuh penghematan round-trip: sweep lama menembak 1 SELECT per varian
 * (87 round-trip untuk katalog penuh) hanya untuk membaca harga/stok/markup
 * lama sebagai pembanding. Dipotong per 50 id karena D1 menolak query dengan
 * lebih dari 100 bound parameter.
 */
async function prefetchVariantRows(
  wrVariantIds: string[],
  db: DatabaseAccess,
): Promise<Map<string, Row>> {
  const map = new Map<string, Row>();
  if (!wrVariantIds.length) return map;
  for (const chunk of chunked(wrVariantIds, PREFETCH_PARAM_CHUNK)) {
    const rows = await db
      .queryAll(
        // Kolom PERSIS sama dengan SELECT per-varian yang digantikan — jangan
        // tambah kolom. `wr_product_name` sengaja TIDAK diambil (tidak ada
        // pemakai di planner; kelas kini murni dari delivery_mode API).
        `SELECT id, wr_variant_id, wr_variant_name, wr_price, wr_stock, markup_percent,
                markup_fixed, axvara_variant_id, axvara_sell_price
         FROM wr_variants WHERE wr_variant_id IN (${placeholders(chunk.length)})`,
        ...chunk,
      )
      .catch(() => [] as Row[]);
    for (const row of rows) {
      const id = String(row.wr_variant_id || "");
      if (id) map.set(id, row);
    }
  }
  return map;
}

/**
 * Ambil baris registri produk + verifikasi tautan katalognya sekaligus.
 *
 * Menggantikan 2 SELECT berurutan per produk (`wr_products` lalu guard link
 * yatim di `products`). `catalog_id` hanya terisi bila tautannya benar-benar
 * masih hidup — syarat yang sama dengan guard lama
 * (`id=? AND source='warung_rebahan' AND wr_product_id=?`), sehingga tautan
 * yatim tetap jatuh ke jalur pembuatan pasangan baru.
 */
async function prefetchProductRows(
  wrProductIds: string[],
  db: DatabaseAccess,
): Promise<Map<string, { linked: number; catalogAlive: boolean }>> {
  const map = new Map<string, { linked: number; catalogAlive: boolean }>();
  if (!wrProductIds.length) return map;
  for (const chunk of chunked(wrProductIds, PREFETCH_PARAM_CHUNK)) {
    const rows = await db
      .queryAll(
        `SELECT wp.wr_product_id, wp.axvara_product_id, wp.is_excluded, p.id AS catalog_id
         FROM wr_products wp
         LEFT JOIN products p
           ON p.id = wp.axvara_product_id
          AND p.source = 'warung_rebahan'
          AND p.wr_product_id = wp.wr_product_id
         WHERE wp.wr_product_id IN (${placeholders(chunk.length)})`,
        ...chunk,
      )
      .catch(() => [] as Row[]);
    for (const row of rows) {
      const id = String(row.wr_product_id || "");
      if (!id) continue;
      map.set(id, {
        linked: row.axvara_product_id != null ? Number(row.axvara_product_id) : 0,
        catalogAlive: row.catalog_id != null,
      });
    }
  }
  return map;
}

/**
 * Varian WR yang hilang dari respons API: set stock=0 (bukan delete).
 * WR bisa hide/unhide sementara; sync berikutnya memulihkan otomatis.
 *
 * WR3: baris `jaspay:%` TIDAK PERNAH disentuh sweep premium (sync Jaspay
 * punya seen-set sendiri). Filter eksplisit agar feed premium yang tak
 * membawa Jaspay tidak me-nol-kan katalog Jaspay.
 */
export async function zeroMissingVariants(
  seenVariantIds: Set<string>,
  db: DatabaseAccess,
): Promise<number> {
  const { queryAll, execRun } = db;
  const rows = await queryAll(
    // Hanya baris yang masih punya stok (registry atau katalog) — yang sudah
    // 0 tidak ditulis ulang tiap sweep (hemat tulis D1 + durasi potongan).
    `SELECT w.wr_variant_id, w.axvara_variant_id FROM wr_variants w
     LEFT JOIN product_variants pv ON pv.id = w.axvara_variant_id
     WHERE w.is_active=1 AND w.wr_variant_id NOT LIKE 'jaspay:%'
       AND (w.wr_stock > 0 OR COALESCE(pv.stock, 0) > 0)`,
  ).catch(() => [] as Row[]);
  let zeroed = 0;
  for (const row of rows) {
    const id = String(row.wr_variant_id || "");
    if (!id || seenVariantIds.has(id)) continue;
    await execRun(
      `UPDATE wr_variants SET wr_stock=0, last_synced_at=?, updated_at=?
       WHERE wr_variant_id=?`,
      new Date().toISOString(),
      new Date().toISOString(),
      id,
    );
    const axvaraVariantId =
      row.axvara_variant_id != null ? Number(row.axvara_variant_id) : 0;
    if (axvaraVariantId > 0) {
      await execRun(
        `UPDATE product_variants SET stock=0, updated_at=datetime('now') WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND id=?`,
        axvaraVariantId,
      ).catch(() => ({ changes: 0 }));
    }
    zeroed++;
  }
  return zeroed;
}

/** Baca state sync durable (cursor/generation). Aman bila tabel belum ada. */
export async function readSyncState(
  db: DatabaseAccess,
): Promise<{ cursor: number; generation: string; snapshotComplete: boolean }> {
  const out = { cursor: 0, generation: "", snapshotComplete: false };
  try {
    const rows = await db.queryAll(`SELECT key, value FROM wr_sync_state`);
    for (const row of rows) {
      const key = String(row.key || "");
      if (key === "products_cursor") out.cursor = Math.max(0, Number(row.value || 0));
      else if (key === "products_generation") out.generation = String(row.value || "");
      else if (key === "products_snapshot_complete") out.snapshotComplete = String(row.value) === "1";
    }
  } catch {
    /* DB pre-0029: mulai dari awal */
  }
  return out;
}

async function writeSyncState(db: DatabaseAccess, key: string, value: string): Promise<void> {
  try {
    await db.execRun(
      `INSERT INTO wr_sync_state (key, value, updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
       WHERE wr_sync_state.value IS NOT excluded.value`,
      key,
      value,
    );
  } catch {
    /* DB pre-0029: cursor best-effort */
  }
}

/**
 * Validasi respons katalog upstream (P0-4): tolak data mencurigakan SEBELUM
 * menyentuh stok lokal.
 * - bukan array / null / object → malformed (jangan zero apa pun).
 * - array kosong padahal generasi sebelumnya punya produk → suspicious
 *   (upstream error / akun kena suspend) — JANGAN zero seluruh katalog.
 * Mengembalikan { ok, reason } — reason null bila aman diproses.
 */
export function validateCatalogResponse(
  products: unknown,
  previousGeneration: string,
  previousCount: number,
): { ok: boolean; reason: string | null } {
  if (!Array.isArray(products)) return { ok: false, reason: "catalog_malformed_not_array" };
  if (products.length === 0 && previousCount > 0) {
    return { ok: false, reason: "catalog_suspicious_empty" };
  }
  return { ok: true, reason: null };
}

export async function syncProducts(
  database?: DatabaseAccess,
  fetchFn: () => Promise<WrProduct[]> = fetchProducts,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const started = Date.now();
  const db = database ?? createDatabaseAccess();
  const trigger = options.trigger ?? "manual";
  const applyOnly = options.applyOnly ?? null;
  const maxProducts = applyOnly
    ? Math.max(1, applyOnly.products.length)
    : Math.max(1, Math.min(options.maxProducts ?? WR_SYNC_PRODUCTS_PER_RUN, 48));
  // Deadline sweep: 0/undefined = tanpa batas (Force Sync admin lewat route
  // sendiri, bukan invocation cron yang dibunuh platform).
  const timeBudgetMs = Number(options.timeBudgetMs ?? 0);
  const hasTimeBudget = Number.isFinite(timeBudgetMs) && timeBudgetMs > 0;
  const timeLeftMs = () => timeBudgetMs - (Date.now() - started);
  const result: SyncResult = {
    total: 0,
    synced: 0,
    excluded: 0,
    newProducts: 0,
    newVariants: 0,
    variantsSynced: 0,
    stockChanges: 0,
    priceChanges: 0,
    errors: [],
    durationMs: 0,
    budgetYielded: false,
    snapshotComplete: false,
  };
  if (!isWrSyncEnabled()) {
    result.errors.push("warung_rebahan_disabled");
    result.durationMs = Date.now() - started;
    return result;
  }
  // Cursor durable: lanjutkan dari posisi run sebelumnya (P0-4).
  const state = applyOnly
    ? { cursor: 0, generation: "", snapshotComplete: false }
    : await readSyncState(db);
  // Opsi A: longgarkan plafon KHUSUS sync katalog agar 48 produk tuntas
  // satu sweep. Hanya bila db menyediakan hook-nya (BudgetedDatabase cron);
  // DatabaseAccess polos (admin/test) canSpend-nya selalu true.
  (db as unknown as { raiseCeilingForCatalogSync?: (n: number) => void })
    .raiseCeilingForCatalogSync?.(WR_SYNC_CATALOG_BUDGET_EXTRA);
  let products: WrProduct[];
  // Mode potongan proxy: `ordered` dibangun dari potongan (posisi lain kosong)
  // + total/id generasi dari meta; `sliceAllIds` = seluruh id varian upstream
  // (hanya potongan terakhir) untuk zero-missing lintas potongan.
  let slice: Awaited<ReturnType<typeof fetchProductsSlice>> = null;
  try {
    if (!applyOnly && options.useProxySlices && fetchFn === fetchProducts) {
      slice = await fetchProductsSlice(state.cursor, maxProducts, hasTimeBudget ? timeLeftMs() : undefined);
    }
    products = applyOnly
      ? applyOnly.products
      : slice ? new Array<WrProduct>(slice.total) : await fetchFn();
    if (slice) slice.products.forEach((p, k) => { products[slice!.offset + k] = p; });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message.slice(0, 300));
    await logSync({ ...result, status: "failed" }, db, trigger).catch(() => undefined);
    result.durationMs = Date.now() - started;
    return result;
  }
  // Guard data mencurigakan SEBELUM menyentuh stok (P0-4).
  const validation = applyOnly
    ? { ok: Array.isArray(products), reason: Array.isArray(products) ? null : "catalog_malformed_not_array" }
    : validateCatalogResponse(products, state.generation, state.snapshotComplete ? Math.max(state.cursor, 1) : 0);
  if (!validation.ok) {
    result.errors.push(validation.reason || "catalog_rejected");
    await logSync({ ...result, status: "failed" }, db, trigger).catch(() => undefined);
    result.durationMs = Date.now() - started;
    return result;
  }
  result.total = products.length;
  // Generasi berubah (jumlah produk upstream berubah drastis) → catat, tapi
  // tetap proses (bukan tolak): penambahan/penghapusan massal yang sah
  // tetap harus tersync; yang dilarang hanya ZERO buta (di bawah).
  const generation = slice
    ? `${slice.total}:${slice.firstId.slice(0, 8)}`
    : `${products.length}:${products[0] ? String((products[0] as WrProduct).id || "").slice(0, 8) : ""}`;
  // Cache exclusion rules sekali per run (P0-4): 1 query, bukan N.
  const cachedRules = (await db
    .queryAll(`SELECT pattern, reason FROM wr_exclusions`)
    .catch(() => [] as Row[])) as { pattern: string; reason: string | null }[];
  const seenVariantIds = new Set<string>();
  // Urutan stabil agar cursor bermakna lintas run.
  // Mode potongan: proxy sudah mengurutkan dengan aturan yang sama.
  const ordered = slice ? products : [...products].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const startAt = slice ? slice.offset : state.cursor >= ordered.length ? 0 : state.cursor;
  // Prefetch baris varian untuk potongan yang AKAN dikerjakan run ini saja
  // (`maxProducts` dari cursor), bukan seluruh katalog: sweep parsial tidak
  // boleh membayar pembacaan produk yang tidak disentuhnya.
  const plannedSlice = ordered.slice(startAt, startAt + maxProducts);
  const variantRows = await prefetchVariantRows(
    plannedSlice
      .flatMap((product) => (product.variants || []).map((variant) => String(variant?.id || "")))
      .filter((id) => id.length > 0),
    db,
  );
  const productRows = await prefetchProductRows(
    plannedSlice.map((product) => String(product.id || "")).filter((id) => id.length > 0),
    db,
  );
  let cursor = startAt;
  let processedInRun = 0;
  let metaChanged = false;
  for (let i = startAt; i < ordered.length; i++) {
    const product = ordered[i];
    // Mode potongan: di luar potongan yang diambil = belum diunduh → yield.
    if (!product) {
      result.budgetYielded = true;
      break;
    }
    // Admission biaya aktual (P0-4): berhenti SEBELUM budget habis.
    // Biaya konservatif per produk = upsert produk + varian-variannya +
    // agregat induk + margin tulis log.
    const variantCount = Array.isArray(product.variants) ? product.variants.length : 0;
    const cost =
      COST_PER_WR_PRODUCT_SYNC + variantCount * COST_PER_WR_VARIANT_SYNC + 2;
    if (!db.canSpend(cost + 4)) {
      result.budgetYielded = true;
      break;
    }
    // Admission WAKTU, sejajar dengan admission budget di atas. Biaya satu
    // produk = (1 + varian) × RTT D1 yang bisa 10x lebih lambat saat D1
    // sedang buruk, jadi sisa waktu diukur ulang TIAP iterasi memakai
    // latensi terukur run ini sendiri — bukan konstanta optimistis.
    if (hasTimeBudget && processedInRun > 0) {
      const msPerProductSoFar = (Date.now() - started) / processedInRun;
      if (timeLeftMs() < msPerProductSoFar) {
        result.budgetYielded = true;
        break;
      }
    }
    if (processedInRun >= maxProducts) {
      result.budgetYielded = true;
      break;
    }
    try {
      const exclude = await isExcluded(String(product.name || ""), db, cachedRules);
      if (exclude.excluded) {
        result.excluded++;
        await upsertWrProduct(product, exclude, db);
        cursor = i + 1;
        processedInRun++;
        continue;
      }
      // Tulis SATU produk dikumpulkan lalu dikirim sebagai satu batch:
      // seluruh varian + agregat induk = 1 round-trip, bukan 4 per varian + 1.
      const pendingWrites: SqlWrite[] = [];
      const now = new Date().toISOString();
      // Jalur terpanas: produk sudah terdaftar dengan pasangan katalog hidup
      // (48/48 pada sweep normal). Tulisnya ikut batch produk, jadi tidak ada
      // round-trip sebelum batch. Sisanya (baru/yatim/excluded) tetap lewat
      // upsertWrProduct yang berurutan.
      const registry = productRows.get(String(product.id || ""));
      let axvaraProductId: number;
      if (registry && registry.catalogAlive && registry.linked > 0) {
        axvaraProductId = registry.linked;
        pendingWrites.push(...planLinkedProductWrites(product, registry.linked, now));
        result.synced++;
      } else {
        const upserted = await upsertWrProduct(product, { excluded: false, reason: null }, db);
        axvaraProductId = upserted.axvaraProductId;
        if (upserted.isNew) result.newProducts++;
        if (upserted.descriptionChanged) metaChanged = true;
        result.synced++;
      }
      for (const variant of product.variants || []) {
        if (!variant?.id) continue;
        seenVariantIds.add(String(variant.id));
        const existing = variantRows.get(String(variant.id));
        let outcome: VariantOutcome;
        if (existing) {
          const planned = planExistingVariantWrites(variant, existing, now);
          pendingWrites.push(...planned.writes);
          outcome = planned.outcome;
        } else {
          // Varian baru butuh lastInsertRowid untuk menautkan barisnya, jadi
          // ia tetap berurutan. Tulis yang sudah terkumpul dikirim DULU agar
          // urutan efek ke DB tidak bergeser dari jalur lama.
          if (await runWrites(pendingWrites.splice(0), db)) metaChanged = true;
          outcome = await insertNewVariant(variant, product.id, axvaraProductId, db, now);
        }
        result.variantsSynced++;
        if (outcome.isNew) result.newVariants++;
        if (outcome.stockChanged) result.stockChanges++;
        if (outcome.priceChanged) result.priceChanges++;
      }
      if (axvaraProductId) pendingWrites.push(planParentAggregateWrite(axvaraProductId));
      if (await runWrites(pendingWrites, db)) metaChanged = true;
    } catch (error) {
      result.errors.push(
        `${String(product?.name || product?.id).slice(0, 80)}: ${
          error instanceof Error ? error.message : String(error)
        }`.slice(0, 300),
      );
    }
    cursor = i + 1;
    processedInRun++;
    // Checkpoint tahan-potong: simpan posisi + kemajuan tiap N produk agar
    // run yang dibunuh platform/deploy menyisakan jejak dan run berikut
    // melanjutkan (bukan mengulang 48 dari awal). writeSyncState best-effort
    // (try/catch di dalam) — checkpoint gagal tak menghentikan sweep.
    if (!applyOnly && processedInRun % WR_SYNC_CHECKPOINT_EVERY === 0 && cursor < ordered.length) {
      await writeSyncState(db, "products_cursor", String(cursor));
      await writeSyncState(db, "products_progress_at", new Date().toISOString());
    }
  }
  if (applyOnly) {
    // Mode diff: tanpa cursor/generasi/snapshot. Varian yang dihapus upstream
    // (dilaporkan VPS) di-nol-kan + agregat induknya disegarkan.
    try {
      result.stockChanges += await zeroVariantsByIds(applyOnly.removedVariantIds, db);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
    result.snapshotComplete = true;
    // Penanda diff VPS sehat: cron memakai ini untuk menjarangkan sweep
    // pengaman berpotongan (60 mnt) selama diff berjalan.
    const nowIso = new Date().toISOString();
    result.durationMs = Date.now() - started;
    const status = result.errors.length === 0 ? "success" : result.synced > 0 ? "partial" : "failed";
    if (status !== "failed") {
      await writeSyncState(db, "diff_last_at", nowIso);
    }
    // Kiriman diff TIDAK ditulis ke *_sync_log (2026-10-04): heartbeat 0/0 dan
    // delta 1–4 varian sempat menutupi kartu "Sync terakhir" admin (dibaca
    // sebagai sync penuh). Log kini khusus sweep penuh/manual; diff tercatat
    // di state `diff_last_at` / `diff_last_change*` / `diff_last_error`.
    const removedCount = applyOnly.removedVariantIds.length;
    if (result.synced > 0 || result.stockChanges > 0 || result.priceChanges > 0 || removedCount > 0) {
      await writeSyncState(db, "diff_last_change_at", nowIso);
      await writeSyncState(db, "diff_last_change", JSON.stringify({
        products: result.synced, variants: result.variantsSynced,
        stock: result.stockChanges, price: result.priceChanges, removed: removedCount, status,
      }));
    }
    if (result.errors.length) {
      await writeSyncState(db, "diff_last_error", JSON.stringify({ at: nowIso, error: result.errors[0].slice(0, 200) }));
    } else {
      await writeSyncState(db, "diff_last_error", "");
    }
    if (result.newProducts > 0 || result.newVariants > 0 || result.stockChanges > 0 || result.priceChanges > 0 || metaChanged) {
      const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
      await bumpCatalogRevision("market", db);
    }
    return result;
  }
  const sweepComplete = cursor >= ordered.length;
  // Sweep dianggap PENUH hanya bila run ini memulai dari awal daftar. Tanpa
  // syarat startAt===0, run yang melanjutkan cursor (mis. 30→47) juga lolos
  // sebagai "complete" padahal seenVariantIds hanya berisi varian dari potongan
  // itu — zeroMissingVariants lalu me-nol-kan stok ~60 varian yang tidak
  // pernah dilihat run ini. Komentar guard di bawah sudah menyebut "dalam run
  // ini"; kondisinya yang belum menegakkan (ditutup 2026-09-18).
  const fullSweepInThisRun = sweepComplete && startAt === 0;
  // Simpan cursor + generasi (durable, lintas invocation).
  await writeSyncState(db, "products_cursor", String(sweepComplete ? 0 : cursor));
  await writeSyncState(db, "products_generation", generation);
  if (sweepComplete) {
    await writeSyncState(db, "products_snapshot_complete", "1");
    // Penanda sweep PENUH terakhir: gerbang pengaman berkala cron saat diff
    // VPS sehat (log diff ikut menyegarkan wr_sync_log, jadi tak bisa dipakai).
    await writeSyncState(db, "products_full_sweep_at", new Date().toISOString());
    result.snapshotComplete = true;
  } else {
    // Sweep berhenti di tengah (budget query/waktu habis). Penanda WAJIB
    // turun ke '0': cron membacanya untuk memutuskan "lanjutkan SEGERA"
    // alih-alih menunggu interval 30 menit. Tanpa reset ini penanda macet
    // di '1' sejak sweep penuh terakhir, dan sisa katalog baru tersentuh
    // setengah jam kemudian — saat D1 lambat, katalog 48 produk butuh ~90
    // menit padahal kerjanya hanya ~2 menit CPU.
    await writeSyncState(db, "products_snapshot_complete", "0");
    result.snapshotComplete = false;
  }
  if (sweepComplete) {
    // DESTRUCTIVE GUARD (P0-4): zero-missing HANYA setelah sweep penuh
    // tervalidasi dalam run ini. Sweep parsial/budget-yield/lanjutan-cursor
    // TIDAK BOLEH me-zero varian yang belum terlihat.
    // Mode potongan: sweep tuntas lintas request + potongan terakhir membawa
    // SELURUH id varian upstream saat ini → zero-missing aman memakai daftar
    // otoritatif itu (bukan seenVariantIds run ini yang hanya 1 potongan).
    const sliceAllIds = slice?.allVariantIds ?? null;
    if (options.allowZeroMissing !== false && (fullSweepInThisRun || sliceAllIds)) {
      try {
        result.stockChanges += await zeroMissingVariants(sliceAllIds ? new Set(sliceAllIds) : seenVariantIds, db);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
      // Refresh agregat induk setelah zero (P0-4): stok parent harus
      // mencerminkan varian yang baru di-nol-kan.
      try {
        await refreshAllParentAggregates(db);
      } catch {
        /* best-effort */
      }
    }
  } else if (!result.budgetYielded) {
    result.budgetYielded = true;
  }
  result.durationMs = Date.now() - started;
  const status = result.errors.length === 0 ? "success" : result.synced > 0 ? "partial" : "failed";
  await logSync({ ...result, status }, db, trigger).catch(() => undefined);
  if (result.newProducts > 0 || result.newVariants > 0 || result.stockChanges > 0 || result.priceChanges > 0 || metaChanged) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
  }
  return result;
}

/**
 * Nol-kan varian WR tertentu (mode diff: dihapus upstream). Hanya baris yang
 * masih berstok; agregat induk produk terdampak disegarkan.
 *
 * WR3: ID `jaspay:%` diabaikan di sini (milik sync Jaspay); ID premium di
 * sync Jaspay diabaikan di sana. Tidak ada zero lintas-famili.
 */
export async function zeroVariantsByIds(ids: string[], db: DatabaseAccess): Promise<number> {
  const unique = [...new Set(ids.map(String).filter((id) => id.length > 0 && !id.startsWith("jaspay:")))].slice(0, 200);
  if (!unique.length) return 0;
  const rows: Row[] = [];
  for (const part of chunked(unique, PREFETCH_PARAM_CHUNK)) {
    const chunkRows = await db.queryAll(
      `SELECT w.wr_variant_id, w.axvara_variant_id, pv.product_id FROM wr_variants w
       LEFT JOIN product_variants pv ON pv.id = w.axvara_variant_id
       WHERE w.is_active=1 AND w.wr_variant_id IN (${placeholders(part.length)})
         AND (w.wr_stock > 0 OR COALESCE(pv.stock, 0) > 0)`,
      ...part,
    );
    rows.push(...chunkRows);
  }
  const now = new Date().toISOString();
  const parents = new Set<number>();
  for (const row of rows) {
    await db.execRun(
      `UPDATE wr_variants SET wr_stock=0, last_synced_at=?, updated_at=? WHERE wr_variant_id=?`,
      now, now, String(row.wr_variant_id),
    );
    const vid = row.axvara_variant_id != null ? Number(row.axvara_variant_id) : 0;
    if (vid > 0) {
      await db.execRun(
        `UPDATE product_variants SET stock=0, updated_at=datetime('now') WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND id=?`,
        vid,
      );
    }
    if (row.product_id != null) parents.add(Number(row.product_id));
  }
  for (const productId of parents) {
    if (productId > 0) await refreshParentAggregates(productId, db).catch(() => undefined);
  }
  return rows.length;
}

/** Refresh agregat semua produk WR (dipanggil setelah zero-missing). */
async function refreshAllParentAggregates(db: DatabaseAccess): Promise<void> {
  const rows = await db
    .queryAll(`SELECT DISTINCT product_id FROM product_variants WHERE wr_auto_managed=1`)
    .catch(() => [] as Row[]);
  for (const row of rows) {
    const productId = Number(row.product_id || 0);
    if (productId > 0 && db.canSpend(2)) {
      await refreshParentAggregates(productId, db);
    }
  }
}

async function logSync(
  result: SyncResult & { status: "success" | "partial" | "failed" },
  db: DatabaseAccess,
  trigger: "manual" | "cron" = "manual",
): Promise<void> {
  await db.execRun(
    `INSERT INTO wr_sync_log
      (sync_type, status, products_total, products_synced, products_excluded,
        products_new, variants_synced, stock_changes, price_changes,
        error_message, duration_ms, trigger)
      VALUES ('products',?,?,?,?,?,?,?,?,?,?,?)`,
    result.status,
    result.total,
    result.synced,
    result.excluded,
    result.newProducts,
    result.variantsSynced,
    result.stockChanges,
    result.priceChanges,
    result.errors.length ? result.errors.slice(0, 5).join(" | ").slice(0, 1000) : null,
    result.durationMs,
    trigger,
  );
}

// ── WR3: sync katalog Jaspay milik Pages (terpisah dari sweep premium) ──
//
// Pages fetch `/jaspay/products` (via wrFetch; proxy menggabung ke
// `/wr/jaspay/products`), normalisasi via jaspay.ts, lalu mirror ke
// tabel WR EXISTING dengan ID `jaspay:` + cap wr_max_quantity.
// - Nama display ditulis SEKALI saat create (seperti premium), tak pernah
//   rewrite legacy; tidak ada remap MBO lama by name.
// - max_quantity invalid/missing => varian DITOLAK (fail-closed, bukan
//   unlimited, bukan stok finite palsu).
// - Stok mirror: -1 bila product && package available, else 0 (kuota lewat
//   wr_max_quantity yang ditegakkan quote/orders/dispatch).
// - seen-set Jaspay sendiri; zero-missing Jaspay TIDAK menyentuh premium.

async function jaspaySku(variantId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(variantId));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `WR-J${hex.slice(0, 28).toUpperCase()}`;
}

async function upsertJaspayProduct(key: string, product: WrProduct, db: DatabaseAccess): Promise<void> {
  const legacyId = JASPAY_LEGACY_PRODUCTS[key];
  if (legacyId) {
    const parent = await db.queryFirst(
      "SELECT id FROM products WHERE source='warung_rebahan' AND wr_product_id=? AND (is_active=1 OR archived_at IS NOT NULL)", legacyId);
    if (parent) {
      // Only a new registry is attached. Never remap existing variants/orders, or
      // overwrite the parent image, name, slug, EN copy or admin activation.
      await db.execRun(`INSERT INTO wr_products(wr_product_id,wr_product_name,wr_description,axvara_product_id)
        VALUES(?,?,?,?) ON CONFLICT(wr_product_id) DO UPDATE SET
        wr_product_name=excluded.wr_product_name,wr_description=excluded.wr_description,
        axvara_product_id=COALESCE(wr_products.axvara_product_id,excluded.axvara_product_id),
        is_excluded=0,exclude_reason=NULL`,
        product.id, product.name, product.description, Number(parent.id));
      return;
    }
  }
  const created = await upsertWrProduct(product, { excluded: false, reason: null }, db);
  if (legacyId && created.axvaraProductId > 0) {
    // Owner 14-Nov: inherit the original MBO imagery even if the old parent
    // is inactive. Only fill empty images; admin changes on the new parent win.
    await db.execRun(`UPDATE products SET
      image_url=COALESCE(NULLIF(image_url,''),(SELECT image_url FROM products WHERE source='warung_rebahan' AND wr_product_id=?)),
      images=CASE WHEN images IS NULL OR images IN ('','[]') THEN
        (SELECT images FROM products WHERE source='warung_rebahan' AND wr_product_id=?) ELSE images END
      WHERE products.archived_at IS NULL AND id=? AND (image_url IS NULL OR image_url='' OR images IS NULL OR images IN ('','[]'))`,
      legacyId, legacyId, created.axvaraProductId);
  }
}

export async function syncJaspayCatalog(
  database?: DatabaseAccess,
  fetchFn: () => Promise<unknown[]> = fetchJaspayProducts,
  options: { maxProducts?: number } = {},
): Promise<JaspaySyncResult> {
  const started = Date.now();
  const db = database ?? createDatabaseAccess();
  const result: JaspaySyncResult = {
    total: 0, synced: 0, rejected: 0, variantsSynced: 0,
    stockChanges: 0, priceChanges: 0, errors: [], durationMs: 0,
  };
  if (!isWrSyncEnabled()) {
    result.errors.push("warung_rebahan_disabled");
    result.durationMs = Date.now() - started;
    return result;
  }
  let raw: unknown[];
  try {
    raw = await fetchFn();
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    result.errors.push(message);
    await recordSyncError(db, "jaspay_catalog", message);
    result.durationMs = Date.now() - started;
    return result;
  }
  if (!Array.isArray(raw) || !raw.length) {
    const err = Array.isArray(raw) ? "catalog_empty" : "catalog_malformed_not_array";
    result.errors.push(err);
    await recordSyncError(db, "jaspay_catalog", err);
    result.durationMs = Date.now() - started;
    return result;
  }
  const { normalizeJaspayCatalog, jaspayVariantId, jaspayMirrorStock } = await import("./jaspay");
  const products = normalizeJaspayCatalog(raw);
  result.total = products.length;
  const cachedRules = (await db
    .queryAll(`SELECT pattern, reason FROM wr_exclusions`)
    .catch(() => [] as Row[])) as { pattern: string; reason: string | null }[];
  const seen = new Set(products.flatMap(p => p.packages.map(k => jaspayVariantId(p.productKey, k.packageId))));
  const bounded = options.maxProducts != null;
  let work = products;
  if (bounded) {
    const cursor = await db.queryFirst("SELECT value FROM wr_sync_state WHERE key='jaspay_catalog_cursor'");
    const sorted = [...products].sort((a, b) => a.productId.localeCompare(b.productId));
    const next = sorted.findIndex(p => p.productId.localeCompare(String(cursor?.value ?? "")) > 0);
    // Owner 16-Nov: rotate with wrap-around so one tick can cover several
    // products (budget-bound) without revisiting any product twice.
    const start = next < 0 ? 0 : next;
    work = [...sorted.slice(start), ...sorted.slice(0, start)].slice(0, Math.max(1, options.maxProducts!));
  }
  const checkpoint = async (id: string) => {
    if (bounded) await db.execRun("INSERT INTO wr_sync_state(key,value,updated_at) VALUES('jaspay_catalog_cursor',?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", id);
  };
  // Zero-missing hanya boleh memakai seen-set LENGKAP: feed sukses dan tidak
  // ada produk yang error. Mode bounded memakai seen-set feed penuh; berhenti
  // karena budget SETELAH >=1 produk tersinkron adalah batas tick normal
  // (cursor melanjutkan), bukan kegagalan. Sisakan budget untuk zero-missing + penanda sukses.
  const ZERO_MISSING_RESERVE = 5;
  let complete = true;
  let catalogChanged = false;
  for (const product of work) {
    const cost = 12 + product.packages.length * 6;
    if (bounded && result.synced > 0 && !db.canSpend(cost + ZERO_MISSING_RESERVE)) break;
    if (!db.canSpend(cost)) {
      complete = false;
      result.errors.push(`catalog_budget_exceeded:${product.productId}`);
      if (bounded && db.canSpend(1)) await checkpoint(product.productId);
      if (!db.canSpend(12)) break;
      continue;
    }
    try {
      const exclude = await isExcluded(product.name, db, cachedRules);
      if (exclude.excluded) {
        await upsertWrProduct(
          { id: product.productId, name: product.name, category: "", description: product.description ?? "", variants: [] },
          exclude,
          db,
        );
        await checkpoint(product.productId);
        continue;
      }
      // Upsert produk Jaspay lewat jalur premium (registry + pasangan
      // katalog + slug anti-bentrok yang sama).
      await upsertJaspayProduct(product.productKey,
        { id: product.productId, name: product.name, category: "Productivity", description: product.description ?? "", variants: [] }, db);
      const reg = await db.queryFirst(
        `SELECT axvara_product_id FROM wr_products WHERE wr_product_id=?`,
        product.productId,
      ).catch(() => null);
      const axvaraProductId = reg?.axvara_product_id != null ? Number(reg.axvara_product_id) : 0;
      const now = new Date().toISOString();
      for (const pkg of product.packages) {
        const variantId = jaspayVariantId(product.productKey, pkg.packageId);
        seen.add(variantId);
        // Cap invalid/missing => tidak bisa dijual (stok 0), bukan unlimited.
        const capValid = product.maxQuantity != null;
        if (!capValid) result.rejected++;
        const stock = capValid ? jaspayMirrorStock(product.available, pkg.available) : 0;
        const existing = await db.queryFirst(
          `SELECT id, wr_variant_name, wr_price, wr_stock, markup_percent, markup_fixed,
                  axvara_variant_id, axvara_sell_price, wr_max_quantity
           FROM wr_variants WHERE wr_variant_id=?`,
          variantId,
        ).catch(() => null);
        const markupPercent = existing?.markup_percent != null ? Number(existing.markup_percent) : defaultMarkupPercent();
        const markupFixed = existing?.markup_fixed != null ? Number(existing.markup_fixed) : defaultMarkupFixed();
        const sellPrice = calculateSellPrice(pkg.price, markupPercent, markupFixed);
        const packageDuration = product.duration || /(?:^|[|])duration=(\d+)(?:[|]|$)/.exec(pkg.packageId)?.[1]?.concat(" Hari") || /(\d+)\s*hari/i.exec(pkg.packageName)?.[0] || null;
        const duration = parseWrDuration(packageDuration);
        if (!existing) {
          if (product.maxQuantity == null) {
            // Cap invalid/missing: varian baru TIDAK dibuat (fail-closed;
            // sudah dihitung rejected di atas).
            continue;
          }
          // SKU deterministik + tahan tabrakan (SHA-256 dari ID varian
          // ber-namespace), bukan potongan ID yang bisa sama untuk paket lain.
          const sku = await jaspaySku(variantId);
          let newVariantId = 0;
          // Fail-closed pra-0091: kolom wr_max_quantity BELUM ada di DB
          // (migrasi belum diterapkan) => JANGAN buat varian Jaspay sama
          // sekali (cap NULL = tak boleh jual). Bukan fallback tanpa cap.
          const hasCapColumn = await db.queryFirst(
            `SELECT wr_max_quantity FROM wr_variants LIMIT 1`,
          ).then(() => true).catch(() => false);
          if (!hasCapColumn) {
            result.rejected++;
            continue;
          }
          try {
            const created = await db.execRun(
              `INSERT INTO product_variants (product_id, sku, label, duration_value, duration_unit, duration_label,
                 warranty_type, warranty_value, warranty_unit, warranty_label,
                 price, stock, fulfillment_mode, is_active, sort_order,
                 wr_variant_id, wr_auto_managed, created_at, updated_at) WITH archive_candidate(product_id, sku, label, duration_value, duration_unit, duration_label,
                 warranty_type, warranty_value, warranty_unit, warranty_label,
                 price, stock, fulfillment_mode, is_active, sort_order,
                 wr_variant_id, wr_auto_managed, created_at, updated_at) AS (VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?)) SELECT * FROM archive_candidate WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=archive_candidate.product_id AND archive_parent.archived_at IS NULL)`,
              axvaraProductId,
              sku,
              pkg.packageName,
              duration.value,
              duration.unit,
              duration.label || null,
              "none",
              null,
              null,
              null,
              sellPrice,
              stock,
              "manual",
              1,
              product.defaultPackage != null && pkg.packageId === product.defaultPackage ? -1 : 0,
              variantId,
              1,
              now,
              now,
            );
            newVariantId = Number((created as { lastInsertRowid?: number }).lastInsertRowid ?? 0);
          } catch {
            // Hanya pakai ulang baris yang identitasnya SAMA (insert sebelumnya
            // terputus). SKU milik varian lain = konflik identitas: tolak,
            // jangan remap wr_variant_id baris lama.
            const conflict = await db.queryFirst(
              `SELECT id, wr_variant_id FROM product_variants WHERE sku=?`,
              sku,
            ).catch(() => null);
            if (!conflict || String(conflict.wr_variant_id ?? "") !== variantId) {
              result.rejected++;
              result.errors.push(`jaspay_sku_identity_conflict:${sku}`);
              continue;
            }
            newVariantId = Number(conflict.id);
          }
          try {
            await db.execRun(
              `INSERT OR IGNORE INTO wr_variants
                (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_duration,
                 wr_type, wr_warranty, wr_stock, wr_terms, wr_delivery_terms,
                 axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price,
                 is_active, last_synced_at, wr_delivery_class, wr_delivery_source, wr_delivery_mode,
                 wr_max_quantity)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`,
              variantId,
              product.productId,
              pkg.packageName,
              pkg.price,
              packageDuration,
              null,
              null,
              stock,
              product.description ?? null,
              product.afterNote ?? null,
              newVariantId || null,
              markupPercent,
              markupFixed,
              sellPrice,
              now,
              "made_by_order",
              "api",
              "manual",
              product.maxQuantity,
            );
            // Kolom ada (cek di atas) => INSERT gagal = konflik nyata.
            // Tanpa catch-fallback: diam-diam menulis tanpa cap dilarang.
          } catch {
            result.rejected++;
            continue;
          }
          if (newVariantId > 0) {
            // Bind hanya bila baris belum milik varian lain.
            await db.execRun(
              `UPDATE product_variants SET wr_variant_id=?, wr_auto_managed=1, updated_at=datetime('now')
               WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND id=? AND (wr_variant_id IS NULL OR wr_variant_id=?)`,
              variantId,
              newVariantId,
              variantId,
            ).catch(() => ({ changes: 0 }));
          }
          result.variantsSynced++;
          result.stockChanges++;
          result.priceChanges++;
          catalogChanged = true;
        } else {
          const previousSupplierName =
            existing.wr_variant_name != null ? String(existing.wr_variant_name) : null;
          const stockChanged = Number(existing.wr_stock ?? -1) !== stock;
          const priceChanged = Number(existing.wr_price ?? -1) !== pkg.price
            || Number(existing.axvara_sell_price ?? -1) !== sellPrice;
          await db.execRun(
            `UPDATE wr_variants SET wr_variant_name=?, wr_price=?, wr_duration=?,
               wr_stock=?, wr_terms=?, wr_delivery_terms=?, axvara_sell_price=?,
               wr_delivery_class='made_by_order', wr_delivery_source='api', wr_delivery_mode='manual',
               wr_max_quantity=?, last_synced_at=?, updated_at=?
             WHERE wr_variant_id=?
               AND (wr_variant_name IS NOT ? OR wr_price IS NOT ? OR wr_duration IS NOT ?
                    OR wr_stock IS NOT ? OR wr_terms IS NOT ? OR wr_delivery_terms IS NOT ? OR axvara_sell_price IS NOT ?
                    OR wr_delivery_class IS NOT 'made_by_order' OR wr_max_quantity IS NOT ?)`,
            pkg.packageName,
            pkg.price,
            packageDuration,
            stock,
            product.description ?? null,
            product.afterNote ?? null,
            sellPrice,
            capValid ? product.maxQuantity : existing.wr_max_quantity ?? null,
            now,
            now,
            variantId,
            pkg.packageName,
            pkg.price,
            packageDuration,
            stock,
            product.description ?? null,
            product.afterNote ?? null,
            sellPrice,
            capValid ? product.maxQuantity : existing.wr_max_quantity ?? null,
          );
          const axId = existing.axvara_variant_id != null ? Number(existing.axvara_variant_id) : 0;
          if (axId > 0) {
            const updateRes = await db.execRun(
              `UPDATE product_variants SET
                 label=CASE WHEN label IS NULL OR label='' OR label IS ? THEN ? ELSE label END,
                 price=?, stock=?,
                 compare_price=CASE WHEN compare_price <= ? THEN NULL ELSE compare_price END,
                 duration_value=?, duration_unit=?, duration_label=?,
                 updated_at=datetime('now')
               WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND id=?
                 AND (((label IS NULL OR label='' OR label IS ?) AND label IS NOT ?)
                      OR price IS NOT ? OR stock IS NOT ? OR duration_value IS NOT ?
                      OR duration_unit IS NOT ? OR duration_label IS NOT ?)`,
              previousSupplierName,
              pkg.packageName,
              sellPrice,
              stock,
              sellPrice,
              duration.value,
              duration.unit,
              duration.label || null,
              axId,
              previousSupplierName,
              pkg.packageName,
              sellPrice,
              stock,
              duration.value,
              duration.unit,
              duration.label || null,
            );
            if (Number(updateRes?.changes ?? 0) > 0) catalogChanged = true;
          }
          result.variantsSynced++;
          if (stockChanged) { result.stockChanges++; catalogChanged = true; }
          if (priceChanged) { result.priceChanges++; catalogChanged = true; }
        }
      }
      if (axvaraProductId > 0 && db.canSpend(2)) {
        await refreshParentAggregates(axvaraProductId, db).catch(() => undefined);
      }
      await checkpoint(product.productId);
      result.synced++;
    } catch (error) {
      complete = false;
      result.errors.push(
        `${product.name.slice(0, 80)}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      );
    }
  }
  if (!complete) {
    if (result.errors.length === 0) {
      result.errors.push("catalog_budget_exceeded");
    }
    await recordSyncError(db, "jaspay_catalog", result.errors[0]);
    if (catalogChanged) {
      const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
      await bumpCatalogRevision("market", db);
    }
    result.durationMs = Date.now() - started;
    return result;
  }
  // Zero-missing KHUSUS Jaspay: varian `jaspay:%` yang masih bisa dijual
  // (stok -1 tak hingga ATAU >0) tapi tak terlihat di feed lengkap ini => 0.
  // Premium tak tersentuh (filter LIKE eksplisit).
  try {
    const rows = await db.queryAll(
      `SELECT w.wr_variant_id, w.axvara_variant_id FROM wr_variants w
       LEFT JOIN product_variants pv ON pv.id = w.axvara_variant_id
       WHERE w.is_active=1 AND w.wr_variant_id LIKE 'jaspay:%'
         AND (w.wr_stock != 0 OR COALESCE(pv.stock, 0) != 0)`,
    ).catch(() => [] as Row[]);
    for (const row of rows) {
      const id = String(row.wr_variant_id || "");
      if (!id || seen.has(id)) continue;
      if (!db.canSpend(3)) break;
      const now = new Date().toISOString();
      await db.execRun(
        `UPDATE wr_variants SET wr_stock=0, last_synced_at=?, updated_at=? WHERE wr_variant_id=?`,
        now,
        now,
        id,
      );
      const vid = row.axvara_variant_id != null ? Number(row.axvara_variant_id) : 0;
      if (vid > 0) {
        const zeroRes = await db.execRun(`UPDATE product_variants SET stock=0, updated_at=datetime('now') WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND id=?`, vid).catch(
          () => ({ changes: 0 }),
        );
        if (Number(zeroRes?.changes ?? 0) > 0) catalogChanged = true;
      }
      result.stockChanges++;
      catalogChanged = true;
    }
  } catch (error) {
    result.errors.push((error instanceof Error ? error.message : String(error)).slice(0, 300));
  }
  if (result.errors.length) {
    await recordSyncError(db, "jaspay_catalog", result.errors[0]);
  } else if (db.canSpend(1)) {
    await recordSyncSuccess(db, "jaspay_catalog");
  }
  if (catalogChanged) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
  }
  result.durationMs = Date.now() - started;
  return result;
}
