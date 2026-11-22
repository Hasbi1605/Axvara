// src/lib/warung-rebahan/sync/jaspay-catalog.ts — WR Jaspay catalog
// engine (3D-7, class E: pure move from sync.ts; MAP-1 (a) section 6 step 7).
//
// Verbatim bodies: jaspaySku, upsertJaspayProduct, syncJaspayCatalog.
// Budget/cursor, validation/legacy mapping, isolated Jaspay zeroing,
// revision/meters/error sequencing unchanged. Only leaf imports; no cycle.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import { fetchJaspayProducts, isWrSyncEnabled, type WrProduct } from "../client";
import { JASPAY_LEGACY_PRODUCTS } from "../new-sales";
import { isExcluded } from "./exclusion";
import { calculateSellPrice, defaultMarkupFixed, defaultMarkupPercent, parseWrDuration } from "./pricing";
import { upsertWrProduct } from "./product";
import { refreshParentAggregates } from "./variant";
import type { JaspaySyncResult, Row } from "./types";

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
  const { normalizeJaspayCatalog, jaspayVariantId, jaspayMirrorStock } = await import("../jaspay");
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
