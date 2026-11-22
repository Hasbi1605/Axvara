// src/lib/warung-rebahan/sync/sweep.ts — WR premium sweep orchestration
// (3D-6, class E: pure move from sync.ts; MAP-1 (a) section 6 step 6).
//
// syncProducts is split into three thin private stages with a small typed
// handoff (SweepRun): runFetchStage (enable/state/fetch/validate/prefetch;
// returns null on the two early failed returns), runProductLoop (batch
// product loop + checkpoints), runFinalize (applyOnly tail OR
// cursor/generation/sweepComplete/zeroing/log/bump). Statement order, DB
// identity, raiseCeiling cast, errors/returns and budget behavior are
// verbatim. Jaspay engine stays in sync.ts, byte-identical.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { fetchProducts, fetchProductsSlice, isWrSyncEnabled, type WrProduct } from "../client";
import {
  COST_PER_WR_PRODUCT_SYNC,
  COST_PER_WR_VARIANT_SYNC,
  WR_SYNC_CATALOG_BUDGET_EXTRA,
  WR_SYNC_CHECKPOINT_EVERY,
  WR_SYNC_PRODUCTS_PER_RUN,
} from "./constants";
import { isExcluded } from "./exclusion";
import { planLinkedProductWrites, upsertWrProduct } from "./product";
import { prefetchProductRows, prefetchVariantRows } from "./prefetch";
import { logSync, readSyncState, validateCatalogResponse, writeSyncState } from "./state";
import type { Row, SqlWrite, SyncOptions, SyncResult, VariantOutcome } from "./types";
import { insertNewVariant, planExistingVariantWrites, planParentAggregateWrite } from "./variant";
import { runWrites } from "./writes";
import { refreshAllParentAggregates, zeroMissingVariants, zeroVariantsByIds } from "./zeroing";

type SweepRun = {
  started: number;
  db: DatabaseAccess;
  trigger: "manual" | "cron";
  applyOnly: SyncOptions["applyOnly"] | null;
  maxProducts: number;
  hasTimeBudget: boolean;
  timeLeftMs: () => number;
  result: SyncResult;
  state: { cursor: number; generation: string; snapshotComplete: boolean };
  products: WrProduct[];
  slice: Awaited<ReturnType<typeof fetchProductsSlice>>;
  generation: string;
  cachedRules: { pattern: string; reason: string | null }[];
  seenVariantIds: Set<string>;
  ordered: WrProduct[];
  startAt: number;
  variantRows: Map<string, Row>;
  productRows: Map<string, { linked: number; catalogAlive: boolean }>;
  cursor: number;
  processedInRun: number;
  metaChanged: boolean;
};

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
  const run: SweepRun = {
    started, db, trigger, applyOnly, maxProducts, hasTimeBudget, timeLeftMs, result,
    state: { cursor: 0, generation: "", snapshotComplete: false }, products: [], slice: null,
    generation: "", cachedRules: [], seenVariantIds: new Set(), ordered: [], startAt: 0,
    variantRows: new Map(), productRows: new Map(), cursor: 0, processedInRun: 0, metaChanged: false,
  };
  if (!await runFetchStage(run, fetchFn, options)) return result;
  await runProductLoop(run);
  return runFinalize(run, options);
}

async function runFetchStage(run: SweepRun, fetchFn: () => Promise<WrProduct[]>, options: SyncOptions): Promise<boolean> {
  const { db, result, trigger } = run; const started = run.started;
  const { maxProducts, hasTimeBudget, timeLeftMs, applyOnly } = run;
  if (!isWrSyncEnabled()) {
    result.errors.push("warung_rebahan_disabled");
    result.durationMs = Date.now() - started;
    return false;
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
    return false;
  }
  // Guard data mencurigakan SEBELUM menyentuh stok (P0-4).
  const validation = applyOnly
    ? { ok: Array.isArray(products), reason: Array.isArray(products) ? null : "catalog_malformed_not_array" }
    : validateCatalogResponse(products, state.generation, state.snapshotComplete ? Math.max(state.cursor, 1) : 0);
  if (!validation.ok) {
    result.errors.push(validation.reason || "catalog_rejected");
    await logSync({ ...result, status: "failed" }, db, trigger).catch(() => undefined);
    result.durationMs = Date.now() - started;
    return false;
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
  Object.assign(run, { state, products, slice, generation, cachedRules, seenVariantIds, ordered, startAt, variantRows, productRows });
  return true;
}

async function runProductLoop(run: SweepRun): Promise<void> {
  const { db, result } = run;
  const { ordered, startAt, applyOnly, seenVariantIds, variantRows, productRows, cachedRules, hasTimeBudget, started } = run;
  let cursor = startAt;
  let { processedInRun, metaChanged } = run;
  const timeLeftMs = run.timeLeftMs; const maxProducts = run.maxProducts;
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
  Object.assign(run, { cursor, processedInRun, metaChanged });
}

async function runFinalize(run: SweepRun, options: SyncOptions): Promise<SyncResult> {
  const { db, result, started, applyOnly, cursor, ordered, generation, slice, seenVariantIds } = run;
  const metaChanged = run.metaChanged; const trigger = run.trigger; const startAt = run.startAt;
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
