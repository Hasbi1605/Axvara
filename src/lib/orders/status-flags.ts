// src/lib/orders/status-flags.ts — Readiness-flag SQL shared by the two public
// status routes (3B-1, class E: pure move, no behavior change).
//
// BEFORE: the `WITH lines …` readiness query (creds/queued/instant +
// supplier_owned/supplier_running) and the post-refresh re-query lived twice:
//   - src/app/api/orders/route.ts GET (≈:758-849)
//   - src/app/api/orders/lookup/route.ts (≈:110-157)
// AFTER: both routes call readStatusFlags() + maybeRefreshStatusFlags() here.
// Leaf module: only imports the DB access layer + unit/progress helpers.
// Never imports route files, NextResponse, or provider reconcile code, so the
// refactor cannot create a lib/orders ↔ lib/db cycle and the edge bundle is
// unchanged. Dynamic `await import()` stays at the route layer call sites
// that already had it (db-access, supplier-refresh, progress, unit-progress).

import type { DatabaseAccess } from "@/lib/db-access";

export type StatusRow = Record<string, unknown>;

export type StatusFlags = {
  credentialsReady: boolean;
  queuedDelivery: boolean;
  instantDelivery: boolean;
  supplierOwned: boolean;
  supplierRunning: boolean;
  hasAutomaticProgress: boolean;
  /** Folded in by the post-refresh re-query when it advances. Not part of
   * the flags query result; the routes initialize it from the row. */
  fulfillmentStatus?: unknown;
};

export type StatusFlagsQuery = {
  queryFirst: (query: string, ...params: unknown[]) => Promise<StatusRow | null | undefined>;
};

export const EMPTY_STATUS_FLAGS: StatusFlags = {
  credentialsReady: false,
  queuedDelivery: false,
  instantDelivery: false,
  supplierOwned: false,
  supplierRunning: false,
  hasAutomaticProgress: false,
};

/**
 * The one big `WITH lines …` readiness query. Verbatim move of the GET query
 * in src/app/api/orders/route.ts:758-807 (params: purchase-disabled flag,
 * items JSON ×2, then order code for every remaining placeholder). `.catch(() => null)` is preserved:
 * old D1 databases without the WR/SK tables (pre-0027/0049) resolve all
 * flags to false instead of 500.
 */
export async function readStatusFlags(
  code: string,
  row: StatusRow,
  query: StatusFlagsQuery,
): Promise<StatusFlags> {
  const flags = await query
    .queryFirst(
      `WITH lines AS (
            SELECT CAST(json_extract(je.value,'$.variant_id') AS INTEGER) AS variant_id,
                   (((json_extract(je.value,'$.aivault_eligibility.version')=1 AND json_extract(je.value,'$.aivault_eligibility.cost_usd')>0) OR (json_extract(je.value,'$.storebat_eligibility.version')=1 AND json_extract(je.value,'$.storebat_eligibility.cost_usd')>0) OR (json_extract(je.value,'$.mirai_eligibility.version')=1 AND json_extract(je.value,'$.mirai_eligibility.cost_usdt')>0) OR (json_extract(je.value,'$.pixelverif_eligibility.version')=1 AND json_extract(je.value,'$.pixelverif_eligibility.cost_usd')>0) OR (json_extract(je.value,'$.tunvn_eligibility.version')=1
                    AND json_extract(je.value,'$.tunvn_eligibility.kind') IN ('account','buff')
                    AND json_extract(je.value,'$.tunvn_eligibility.cost_usdt')>0))
                    AND ?=0) AS automatic
           FROM json_each(CASE WHEN json_valid(?) THEN ? ELSE '[]' END) je
         )
          SELECT
           (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND wr_variant_id LIKE 'jaspay:%')
            OR EXISTS(SELECT 1 FROM pixelverif_order_links WHERE order_code=?)) AS has_automatic_progress,
           (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed'
                    AND wr_account_details IS NOT NULL)
           OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=? AND status='delivered'
                    AND delivered_ciphertext IS NOT NULL)) AS creds,
           (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=?)
             OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=?)
             OR EXISTS(SELECT 1 FROM lines WHERE automatic=1)) AS supplier_owned,
           (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))
            OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))
            OR EXISTS(SELECT 1 FROM pixelverif_order_links WHERE order_code=? AND (status='processing' OR (status='claimed' AND request_sent_at IS NOT NULL)))) AS supplier_running,
          EXISTS(SELECT 1 FROM lines l
                 JOIN product_variants pv ON pv.id = l.variant_id
                 LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
                 LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
                  WHERE CASE WHEN l.automatic=1 THEN 0
                             WHEN pv.wr_variant_id IS NOT NULL
                            THEN COALESCE(wv.wr_delivery_class,'made_by_order') <> 'restock'
                            WHEN pv.sk_variant_id IS NOT NULL
                            THEN COALESCE(sp.sk_order_process,'manual') <> 'auto'
                            ELSE pv.fulfillment_mode = 'manual' END) AS queued,
          (EXISTS(SELECT 1 FROM lines)
           AND NOT EXISTS(SELECT 1 FROM lines l
                          LEFT JOIN product_variants pv ON pv.id = l.variant_id
                          LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
                          WHERE pv.id IS NULL
                             OR pv.wr_variant_id IS NOT NULL
                             OR (pv.sk_variant_id IS NOT NULL AND COALESCE(sp.sk_order_process,'manual') <> 'auto')
                             OR (pv.wr_variant_id IS NULL AND pv.sk_variant_id IS NULL
                                 AND COALESCE(pv.fulfillment_mode,'manual') NOT IN ('shared','unique')))) AS instant`,
      Number(row.supplier_purchase_disabled ?? 0),
      String(row.items ?? "[]"),
      String(row.items ?? "[]"),
      code,
      code,
      code,
      code,
      code,
      code,
      code,
      code,
      code,
    )
    .catch(() => null);
  return {
    hasAutomaticProgress: Number(flags?.has_automatic_progress ?? 0) === 1,
    credentialsReady: Number(flags?.creds ?? 0) === 1,
    queuedDelivery: Number(flags?.queued ?? 0) === 1,
    instantDelivery: Number(flags?.instant ?? 0) === 1,
    supplierOwned: Number((flags as Record<string, unknown> | null)?.supplier_owned ?? 0) === 1,
    supplierRunning: Number((flags as Record<string, unknown> | null)?.supplier_running ?? 0) === 1,
  };
}

/**
 * Compact lookup-side credentials/ownership/running read. Verbatim move of
 * the query in src/app/api/orders/lookup/route.ts:110-126 (params: order
 * code ×6, purchase-disabled flag, items JSON, order code ×3). Same
 * `.catch(() => null)` → all-false contract.
 */
export async function readLookupFlags(
  code: string,
  row: StatusRow,
  query: StatusFlagsQuery,
): Promise<Pick<StatusFlags, "credentialsReady" | "supplierOwned" | "supplierRunning" | "hasAutomaticProgress">> {
  const cred = await query
    .queryFirst(
      `SELECT
        (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND wr_variant_id LIKE 'jaspay:%')
            OR EXISTS(SELECT 1 FROM pixelverif_order_links WHERE order_code=?)) AS has_automatic_progress,
        (EXISTS(SELECT 1 FROM wr_order_links
           WHERE order_code=? AND status='completed' AND wr_account_details IS NOT NULL)
         OR EXISTS(SELECT 1 FROM fulfillment_items
           WHERE order_code=? AND status='delivered' AND delivered_ciphertext IS NOT NULL)) AS creds,
        (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=?)
          OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=?)
          OR (?=0 AND EXISTS(SELECT 1 FROM json_each(?) je
            WHERE (json_extract(je.value,'$.aivault_eligibility.version')=1 AND json_extract(je.value,'$.aivault_eligibility.cost_usd')>0) OR (json_extract(je.value,'$.storebat_eligibility.version')=1 AND json_extract(je.value,'$.storebat_eligibility.cost_usd')>0) OR (json_extract(je.value,'$.mirai_eligibility.version')=1 AND json_extract(je.value,'$.mirai_eligibility.cost_usdt')>0) OR (json_extract(je.value,'$.pixelverif_eligibility.version')=1 AND json_extract(je.value,'$.pixelverif_eligibility.cost_usd')>0) OR (json_extract(je.value,'$.tunvn_eligibility.version')=1
              AND json_extract(je.value,'$.tunvn_eligibility.kind') IN ('account','buff')
              AND json_extract(je.value,'$.tunvn_eligibility.cost_usdt')>0)))) AS supplier_owned,
        (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))
         OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))
         OR EXISTS(SELECT 1 FROM pixelverif_order_links WHERE order_code=? AND (status='processing' OR (status='claimed' AND request_sent_at IS NOT NULL)))) AS supplier_running`,
      code,
      code,
      code,
      code,
      code,
      code,
      Number(row.supplier_purchase_disabled ?? 0),
      String(row.items ?? "[]"),
      code,
      code,
      code,
    )
    .catch(() => null);
  return {
    hasAutomaticProgress: Number(cred?.has_automatic_progress ?? 0) === 1,
    credentialsReady: Number(cred?.creds ?? 0) === 1,
    supplierOwned: Number((cred as Record<string, unknown> | null)?.supplier_owned ?? 0) === 1,
    supplierRunning: Number((cred as Record<string, unknown> | null)?.supplier_running ?? 0) === 1,
  };
}

export type SupplierRefreshAccess = {
  maybeRefresh: (code: string, db: DatabaseAccess) => Promise<{ refreshed: boolean }>;
  createAccess: () => DatabaseAccess;
};

/**
 * Post-flag supplier refresh. Verbatim move of the shared block in
 * src/app/api/orders/route.ts:822-849 and
 * src/app/api/orders/lookup/route.ts:134-157: when a link is still running,
 * pull the vendor status now (throttled, best-effort), then recompute creds
 * + running from the post-refresh re-query (verbatim SQL) and fold a fresh
 * fulfillment_status into the row. Same try/catch silence, same mutations.
 */
export async function maybeRefreshStatusFlags(
  code: string,
  row: StatusRow,
  flags: {
    credentialsReady: boolean;
    supplierRunning: boolean;
    fulfillmentStatus?: unknown;
  },
  access: SupplierRefreshAccess,
): Promise<void> {
  if (String(row.status) !== "lunas" || !flags.supplierRunning) return;
  try {
    const refreshDb = access.createAccess();
    const { refreshed } = await access.maybeRefresh(code, refreshDb);
    if (refreshed) {
      const after = await refreshDb
        .queryFirst(
          `SELECT fulfillment_status,
                  (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed' AND wr_account_details IS NOT NULL)
                   OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=? AND status='delivered' AND delivered_ciphertext IS NOT NULL)) AS creds,
                  (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))
                   OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))
                   OR EXISTS(SELECT 1 FROM pixelverif_order_links WHERE order_code=? AND (status='processing' OR (status='claimed' AND request_sent_at IS NOT NULL)))) AS running
           FROM orders WHERE code=?`,
          code,
          code,
          code,
          code,
          code,
          code,
        )
        .catch(() => null);
      if (after) {
        flags.credentialsReady = Number(after.creds ?? 0) === 1;
        flags.supplierRunning = Number(after.running ?? 0) === 1;
        if (after.fulfillment_status != null) {
          row.fulfillment_status = after.fulfillment_status;
          flags.fulfillmentStatus = after.fulfillment_status;
        }
      }
    }
  } catch {
    /* penyegaran best-effort; status lama tetap sah */
  }
}
