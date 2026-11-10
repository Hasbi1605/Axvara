// Reservasi stok atomik saat pembuatan order (jalur uang) dipisah dari helper
// transisi agar tiap file tetap di bawah ~400 baris dan lebih mudah diaudit.
// PURE MOVE: seluruh SQL, urutan statement di dalam d1.batch(), pesan error,
// dan komentar penjelas identik dengan src/lib/db.ts lama. State dev
// (getSharedMem/getOrderMem) diimpor dari client.ts sebagai SATU sumber
// tunggal supaya tidak ada salinan store yang desinkron.

import { getD1, getSharedMem, getOrderMem } from "./client";
import { StockReservationError } from "./errors";
import { assertSameBuyerCode, buyerSnapshotMatches, tunvnEligibility, validateBuyerFields } from "@/lib/buyer-fields";
import type { D1Statement, AtomicOrderItem } from "./types";
import { markUniqueUnitLines } from "@/lib/fulfillment/units";
import { assertOrderAccessConfigured } from "@/lib/order-access";
import { bulkOwnerFromJoinedRow, bulkOwnerFromProductRow, isManualProductForBulk, resolveBulkPriceForProduct } from "@/lib/bulk-pricing";

type AtomicOrderInput = {
  code: string;
  quoteId: string;
  customerName: string;
  customerWa: string;
  customerEmail: string | null;
  items: (AtomicOrderItem & { base_price?: number; applied_tier_min_qty?: number })[];
  subtotal: number;
  paymentMethod: string;
  paymentAccount: string;
  proofUrl: string | null;
  locale?: "id" | "en";
  adminPaymentTest?: boolean;
};

export async function createOrderWithStock(input: AtomicOrderInput): Promise<void> {
  assertOrderAccessConfigured();
  const supplierMinutes = input.paymentMethod.startsWith("sekalipay_gateway:") ? 30 : 60;
  const d1 = getD1();
  if (d1) {
    const productIds = [...new Set(input.items.map(item => item.product_id))];
    const owners = (await d1.prepare(`SELECT id,source,wr_product_id,wr_auto_managed,sk_product_id,sk_auto_managed FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`).bind(...productIds).all()).results as Record<string, unknown>[];
    if (owners.length !== productIds.length) throw new StockReservationError();
    const minutes = owners.some(row => isManualProductForBulk(bulkOwnerFromProductRow(row))) ? 15 : supplierMinutes;
    const ids = [...new Set(input.items.map(item => item.variant_id).filter((id): id is number => id != null))];
    const modes = (ids.length ? (await d1.prepare(`SELECT pv.id,pv.sku,pv.buyer_field_key,pv.max_qty,pv.tunvn_buff_quantity_b,pv.tunvn_cost_usdt,(SELECT price_usdt FROM tunvn_products WHERE supplier_product_id=CAST(substr(pv.sku,7) AS INTEGER)) AS tunvn_source_cost_usdt,p.slug AS product_slug,pv.fulfillment_mode,pv.price,pv.bulk_pricing_enabled,pv.bulk_pricing_tiers,
        p.source AS p_source, p.wr_product_id AS p_wr_product_id, p.wr_auto_managed AS p_wr_auto_managed,
        p.sk_product_id AS p_sk_product_id, p.sk_auto_managed AS p_sk_auto_managed
      FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id IN (${ids.map(()=>"?").join(",")})`).bind(...ids).all()).results : []) as Record<string,unknown>[];
    const byId = new Map(modes.map(row => [Number(row.id), String(row.fulfillment_mode)]));
    const uniqueIds = new Set(modes.filter(row => row.fulfillment_mode === "unique").map(row => Number(row.id)));
    let orderItems: AtomicOrderItem[];
    try { orderItems = markUniqueUnitLines(input.items, uniqueIds); } catch { throw new StockReservationError(); }
    const guardIds = input.items.map((item) => `${input.quoteId}:stock:${item.variant_id ?? item.product_id}`);
    // Qty agregat per varian (keranjang bisa membawa baris ganda varian sama)
    // untuk batas maksimum Jaspay di guard atomik di bawah.
    const qtyByVariant = new Map<number, number>();
    for (const item of input.items) {
      if (item.variant_id) qtyByVariant.set(item.variant_id, (qtyByVariant.get(item.variant_id) ?? 0) + item.qty);
    }
    const bulkById = new Map(modes.map((row) => [Number(row.id), row]));
    try {
      assertSameBuyerCode(input.items);
      orderItems = orderItems.map(item => {
        const row = item.variant_id ? bulkById.get(item.variant_id) : {};
        if (!row) throw new Error("missing");
        validateBuyerFields(row, item.buyer_fields, qtyByVariant.get(item.variant_id ?? 0) ?? item.qty);
        if (!buyerSnapshotMatches(item, { buyer_field_key: (row.buyer_field_key ?? null) as "muse_invite_code" | null, max_qty: row.max_qty == null ? null : Number(row.max_qty), buyer_fields: item.buyer_fields })) throw new Error("stale");
        const clean = { ...item } as typeof item & { tunvn_eligibility?: unknown };
        delete clean.tunvn_eligibility;
        const eligibility = input.adminPaymentTest ? undefined : tunvnEligibility(row, item.qty);
        return { ...clean, ...(eligibility ? { tunvn_eligibility: eligibility } : {}) };
      });
    } catch { throw new StockReservationError(); }
    for (const item of input.items) {
      if (!item.variant_id) continue;
      const row = bulkById.get(item.variant_id);
      if (!row) throw new StockReservationError();
      try {
        const effective = resolveBulkPriceForProduct(Number(row.price), qtyByVariant.get(item.variant_id)!, row.bulk_pricing_enabled, row.bulk_pricing_tiers, bulkOwnerFromJoinedRow(row));
        if (effective.price !== item.price || effective.tier !== item.applied_tier_min_qty || (item.base_price !== undefined && item.base_price !== Number(row.price))) throw new Error("stale");
      } catch { throw new StockReservationError(); }
    }
    const statements: D1Statement[] = [];
    for (const owner of owners) {
      const guardId = `${input.quoteId}:owner:${owner.id}`;
      guardIds.push(guardId);
      statements.push(d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN EXISTS(
        SELECT 1 FROM products WHERE id=? AND source IS ? AND wr_product_id IS ? AND wr_auto_managed IS ? AND sk_product_id IS ? AND sk_auto_managed IS ?
      ) THEN 1 ELSE 0 END`).bind(guardId, owner.id, owner.source, owner.wr_product_id, owner.wr_auto_managed, owner.sk_product_id, owner.sk_auto_managed));
    }
    input.items.forEach((item, index) => {
      if (item.variant_id) {
        // Guard stok + guard minimum pembelian (migrasi 0034) dalam SATU
        // operation_guards: race/toctou client (quote lolos, DB berubah)
        // menggagalkan SELURUH batch — tanpa order, tanpa potong stok.
        // COALESCE(min_qty,1): baris fixture lama tanpa kolom tetap valid.
        statements.push(
          d1.prepare(
            `INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(
              SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id
              WHERE pv.id=? AND pv.product_id=? AND p.is_active=1 AND pv.is_active=1
                AND pv.price=? AND pv.bulk_pricing_enabled=? AND pv.bulk_pricing_tiers=? AND pv.fulfillment_mode=? AND (pv.stock=-1 OR pv.stock>=?)
                AND ? >= COALESCE(pv.min_qty,1)
                AND pv.buyer_field_key IS ? AND pv.max_qty IS ?
                AND (pv.max_qty IS NULL OR ? <= pv.max_qty)
                 AND pv.sku IS ? AND pv.tunvn_buff_quantity_b IS ? AND p.slug IS ?
                 AND pv.tunvn_cost_usdt IS ? AND (SELECT price_usdt FROM tunvn_products WHERE supplier_product_id=CAST(substr(pv.sku,7) AS INTEGER)) IS ?
                -- WR3 Jaspay: cap wajib ada dan >= qty agregat varian ini;
                -- cap hilang/invalid = tolak (fail-closed), dicek atomik di
                -- batch yang sama dengan reservasi (tahan race perubahan cap).
                AND (COALESCE(pv.wr_variant_id,'') NOT LIKE 'jaspay:%' OR EXISTS(
                  SELECT 1 FROM wr_variants wv WHERE wv.wr_variant_id=pv.wr_variant_id
                    AND wv.wr_max_quantity IS NOT NULL AND wv.wr_max_quantity >= ?))) THEN 1 ELSE 0 END`,
          ).bind(guardIds[index], item.variant_id, item.product_id, Number(bulkById.get(item.variant_id)?.price), Number(bulkById.get(item.variant_id)?.bulk_pricing_enabled), String(bulkById.get(item.variant_id)?.bulk_pricing_tiers), byId.get(item.variant_id) ?? "manual", item.qty, item.qty,
            item.buyer_field_key ?? null,item.max_qty ?? null,qtyByVariant.get(item.variant_id) ?? item.qty,
             bulkById.get(item.variant_id)?.sku ?? null,bulkById.get(item.variant_id)?.tunvn_buff_quantity_b ?? null,bulkById.get(item.variant_id)?.product_slug ?? null,
             bulkById.get(item.variant_id)?.tunvn_cost_usdt ?? null,bulkById.get(item.variant_id)?.tunvn_source_cost_usdt ?? null,
            qtyByVariant.get(item.variant_id) ?? item.qty),
        );
      } else {
        statements.push(
          d1.prepare(
            "INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM products WHERE id=? AND is_active=1 AND price=? AND (stock=-1 OR stock>=?)) THEN 1 ELSE 0 END",
          ).bind(guardIds[index], item.product_id, item.price, item.qty),
        );
      }
    });
    input.items.forEach((item) => {
      if (item.variant_id) {
        statements.push(
          d1.prepare(
            "UPDATE product_variants SET stock=CASE WHEN stock=-1 THEN -1 ELSE stock-? END, updated_at=datetime('now') WHERE id=?",
          ).bind(item.qty, item.variant_id),
        );
      } else {
        statements.push(
          d1.prepare(
            "UPDATE products SET stock=CASE WHEN stock=-1 THEN -1 ELSE stock-? END WHERE id=?",
          ).bind(item.qty, item.product_id),
        );
      }
    });
    const primaryVariantId = input.items.find((it) => it.variant_id)?.variant_id ?? null;
    // Web orders may contain unique-fulfillment lines. Reserve one
    // inventory row per requested unit inside the same atomic batch (issue #4,
    // review R3): without this, a unique line has variant stock cut but no
    // secret bound to the order, so delivery fails with "No reserved
    // inventory". Rules (explicit, incl. legacy rows without variant_id):
    // - Only lines whose variant row is unique-mode participate (checked
    //   per line BEFORE the claim).
    // - Variant-scoped rows (fi.variant_id = pv.id) belong to that variant
    //   only and are never shared across variants.
    // - Legacy rows (fi.variant_id IS NULL) are a shared pool of last
    //   resort: within ONE order, each line claims its quantity of rows and
    //   later lines in the same batch must see it as gone. The batch aborts
    //   (guard + post-claim verification) unless every unique line holds a
    //   reservation afterwards — no order, no stock cut, no partial claim.
    const uniqueItems = input.items.filter((it) => it.variant_id != null);
    // Which input lines actually NEED a secret is decided by the database
    // itself (pv.fulfillment_mode='unique'): the pre-guard admits only
    // unique-mode variants, the claims are no-ops for any other mode, and
    // the verify guard counts reservations only against unique-mode lines.
    // A shared/manual line with a variant_id therefore neither consumes
    // inventory nor inflates the required reservation count (review R3).
    const uniqueLines = uniqueItems;
    // Unique-mode variant ids among this order's lines (resolved inside the
    // batch by the mode guards below; the earlier mode read is fenced).
    if (uniqueLines.length > 0) {
      const uniqueGuardId = `${input.quoteId}:unique-inventory`;
      statements.push(
        d1.prepare(
          `INSERT INTO operation_guards (operation_id,valid)
           SELECT ?, CASE WHEN NOT EXISTS(
             SELECT 1 FROM product_variants pv
             WHERE pv.fulfillment_mode='unique'
               AND pv.id IN (${uniqueLines.map(() => "?").join(",")})
               AND NOT EXISTS(
                 SELECT 1 FROM fulfillment_inventory fi
                 WHERE fi.product_id=pv.product_id AND fi.status='available'
                   AND (fi.variant_id=pv.id OR fi.variant_id IS NULL)
               )
           ) THEN 1 ELSE 0 END`,
        ).bind(uniqueGuardId, ...uniqueLines.map((it) => it.variant_id)),
      );
      guardIds.push(uniqueGuardId);
      for (const item of uniqueLines) {
        statements.push(
          d1.prepare(
            `UPDATE fulfillment_inventory
             SET status='reserved', order_code=?, reserved_at=datetime('now')
             WHERE id IN (
               SELECT fi.id FROM fulfillment_inventory fi
               JOIN product_variants pv ON pv.id=?
               WHERE fi.product_id=pv.product_id AND fi.status='available'
                 AND (fi.variant_id=pv.id OR fi.variant_id IS NULL)
                 AND pv.fulfillment_mode='unique'
                 AND NOT EXISTS(
                   SELECT 1 FROM fulfillment_inventory taken
                   WHERE taken.status='reserved' AND taken.order_code=?
                     AND taken.id=fi.id
                 )
               ORDER BY CASE WHEN fi.variant_id=pv.id THEN 0 ELSE 1 END, COALESCE(fi.sort_order,fi.id), fi.id ASC
               LIMIT ?
             ) AND status='available'`,
          ).bind(input.code, item.variant_id, input.code, item.qty),
        );
      }
      // Post-claim verification: every UNIQUE-mode line must hold exactly
      // qty reservations. A no-op UPDATE (same legacy row picked twice, lost
      // race, mode flipped mid-batch) would otherwise slip through the
      // pre-check and leave the order short of secrets. Non-unique lines
      // are excluded from the required count via the mode join, so a
      // shared/manual line never demands a reservation (review R3).
      // Legacy pool rows (variant_id IS NULL) are shared across variants,
      // so they are counted once per reservation — not joined per variant
      // (a cross join would multiply one row by the number of variants).
      const verifyGuardId = `${input.quoteId}:unique-inventory-verify`;
      statements.push(
        d1.prepare(
          `INSERT INTO operation_guards (operation_id,valid)
           SELECT ?, CASE WHEN (
             SELECT COUNT(*) FROM fulfillment_inventory fi
             WHERE fi.order_code=? AND fi.status='reserved'
               AND (
                 fi.variant_id IN (
                   SELECT pv.id FROM product_variants pv
                   WHERE pv.fulfillment_mode='unique'
                     AND pv.id IN (${uniqueLines.map(() => "?").join(",")})
                 )
                 OR fi.variant_id IS NULL
               )
           ) >= ? THEN 1 ELSE 0 END`,
        ).bind(
          verifyGuardId, input.code, ...uniqueLines.map((it) => it.variant_id),
          uniqueLines.reduce((n, item) => n + (uniqueIds.has(Number(item.variant_id)) ? item.qty : 0), 0),
        ),
      );
      guardIds.push(verifyGuardId);
    }
    statements.push(
      d1.prepare(
        `INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,proof_url,status,sales_channel,variant_id,quote_id,expires_at,locale,buyer_access_version,buyer_access_format,supplier_purchase_disabled) VALUES (?,?,?,?,?,?,?,?,?,?,'web',?,?,datetime('now','+${minutes} minutes'),?,1,'pin6',?)`,
      ).bind(
        input.code,
        input.customerName,
        input.customerWa,
        input.customerEmail,
        JSON.stringify(orderItems),
        input.subtotal,
        input.paymentMethod,
        input.paymentAccount,
        input.proofUrl,
        "pending",
        primaryVariantId,
        input.quoteId,
        input.locale === "en" ? "en" : "id",
        input.adminPaymentTest ? 1 : 0,
      ),
    );
    guardIds.forEach((guardId) => {
      statements.push(d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId));
    });

    try {
      await d1.batch(statements);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/operation_guards|CHECK constraint/i.test(message)) throw new StockReservationError();
      throw error;
    }
  }

  const products = getSharedMem();
  for (const item of input.items) {
    const product = products.find((row) => Number(row.id) === item.product_id);
    const stock = Number(product?.stock ?? -1);
    if (!product || Number(product.is_active) === 0 || (stock !== -1 && stock < item.qty)) {
      throw new StockReservationError();
    }
  }
  const orders = getOrderMem();
  if (orders.some((order) => order.quote_id === input.quoteId || order.code === input.code)) {
    throw new Error("UNIQUE constraint failed: orders.quote_id");
  }
  for (const item of input.items) {
    const product = products.find((row) => Number(row.id) === item.product_id)!;
    if (Number(product.stock) !== -1) product.stock = Number(product.stock) - item.qty;
  }
  orders.push({
    id: Math.max(0, ...orders.map((order) => Number(order.id) || 0)) + 1,
    code: input.code,
    customer_name: input.customerName,
    customer_wa: input.customerWa,
    customer_email: input.customerEmail,
    locale: input.locale === "en" ? "en" : "id",
    buyer_access_version: 1, buyer_access_format: "pin6",
    items: JSON.stringify(input.items),
    subtotal: input.subtotal,
    payment_method: input.paymentMethod,
    payment_account: input.paymentAccount,
    proof_url: input.proofUrl,
    status: "pending",
    sales_channel: "web",
    variant_id: input.items.find((it) => it.variant_id)?.variant_id ?? null,
    quote_id: input.quoteId,
    expires_at: new Date(Date.now() + (input.items.some(item => isManualProductForBulk(bulkOwnerFromProductRow(products.find(row => Number(row.id) === item.product_id) as unknown as Record<string, unknown> | undefined))) ? 15 : supplierMinutes) * 60_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}
