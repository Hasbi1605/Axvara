// Reservasi stok atomik saat pembuatan order (jalur uang) dipisah dari helper
// transisi agar tiap file tetap di bawah ~400 baris dan lebih mudah diaudit.
// PURE MOVE: seluruh SQL, urutan statement di dalam d1.batch(), pesan error,
// dan komentar penjelas identik dengan src/lib/db.ts lama. State dev
// (getSharedMem/getOrderMem) diimpor dari client.ts sebagai SATU sumber
// tunggal supaya tidak ada salinan store yang desinkron.

import { getD1, getSharedMem, getOrderMem } from "./client";
import { StockReservationError } from "./errors";
import type { D1Statement, AtomicOrderItem } from "./types";

type AtomicOrderInput = {
  code: string;
  quoteId: string;
  customerName: string;
  customerWa: string;
  customerEmail: string | null;
  items: AtomicOrderItem[];
  subtotal: number;
  paymentMethod: string;
  paymentAccount: string;
  proofUrl: string | null;
};

export async function createOrderWithStock(input: AtomicOrderInput): Promise<void> {
  const d1 = getD1();
  if (d1) {
    const guardIds = input.items.map((item) => `${input.quoteId}:stock:${item.variant_id ?? item.product_id}`);
    const statements: D1Statement[] = [];
    input.items.forEach((item, index) => {
      if (item.variant_id) {
        statements.push(
          d1.prepare(
            "INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE id=? AND is_active=1 AND (stock=-1 OR stock>=?)) THEN 1 ELSE 0 END",
          ).bind(guardIds[index], item.variant_id, item.qty),
        );
      } else {
        statements.push(
          d1.prepare(
            "INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM products WHERE id=? AND is_active=1 AND (stock=-1 OR stock>=?)) THEN 1 ELSE 0 END",
          ).bind(guardIds[index], item.product_id, item.qty),
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
    // inventory row per such line inside the same atomic batch (issue #4,
    // review R3): without this, a unique line has variant stock cut but no
    // secret bound to the order, so delivery fails with "No reserved
    // inventory". Rules (explicit, incl. legacy rows without variant_id):
    // - Only lines whose variant row is unique-mode participate (checked
    //   per line BEFORE the claim).
    // - Variant-scoped rows (fi.variant_id = pv.id) belong to that variant
    //   only and are never shared across variants.
    // - Legacy rows (fi.variant_id IS NULL) are a shared pool of last
    //   resort: within ONE order, the first line claims one legacy row and
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
    // batch by the guards below — no separate read that a concurrent
    // checkout could invalidate).
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
             WHERE id=(
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
               ORDER BY CASE WHEN fi.variant_id=pv.id THEN 0 ELSE 1 END, fi.id ASC
               LIMIT 1
             ) AND status='available'`,
          ).bind(input.code, item.variant_id, input.code),
        );
      }
      // Post-claim verification: every UNIQUE-mode line must hold exactly
      // one reservation. A no-op UPDATE (same legacy row picked twice, lost
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
           ) >= (
             SELECT COUNT(*) FROM product_variants pv
             WHERE pv.fulfillment_mode='unique'
               AND pv.id IN (${uniqueLines.map(() => "?").join(",")})
           ) THEN 1 ELSE 0 END`,
        ).bind(
          verifyGuardId, input.code, ...uniqueLines.map((it) => it.variant_id),
          ...uniqueLines.map((it) => it.variant_id),
        ),
      );
      guardIds.push(verifyGuardId);
    }
    statements.push(
      d1.prepare(
        "INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,proof_url,status,sales_channel,variant_id,quote_id,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,'web',?,?,datetime('now','+24 hours'))",
      ).bind(
        input.code,
        input.customerName,
        input.customerWa,
        input.customerEmail,
        JSON.stringify(input.items),
        input.subtotal,
        input.paymentMethod,
        input.paymentAccount,
        input.proofUrl,
        "pending",
        primaryVariantId,
        input.quoteId,
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
    items: JSON.stringify(input.items),
    subtotal: input.subtotal,
    payment_method: input.paymentMethod,
    payment_account: input.paymentAccount,
    proof_url: input.proofUrl,
    status: "pending",
    sales_channel: "web",
    variant_id: input.items.find((it) => it.variant_id)?.variant_id ?? null,
    quote_id: input.quoteId,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}
