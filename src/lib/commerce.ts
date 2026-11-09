// src/lib/commerce.ts — Channel-agnostic commerce operations
// Shared between web, Telegram, and WhatsApp for order creation,
// stock reservation, and payment management.

import {
  queryFirst,
  queryAll,
  execRun,
  isD1Mode,
  getD1,
  StockReservationError,
  D1Statement,
} from "@/lib/db";
import { getActiveVariant, type VariantSummary, formatDuration, buyerWarrantyLabel } from "@/lib/catalog";
import { bulkOwnerFromJoinedRow, bulkOwnerFromProductRow, isManualProductForBulk, resolveBulkPriceForProduct, type BulkProductOwner } from "@/lib/bulk-pricing";
import { generateOrderCode } from "@/lib/security";
import { assertOrderAccessConfigured } from "@/lib/order-access";
import { QRIS_ORDER_WINDOW_MINUTES } from "@/lib/payments/dana-qris";
import { markUniqueUnitLines, MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";

export type ChannelOrderInput = {
  salesChannel: "web" | "telegram" | "whatsapp";
  productId: number;
  productName: string;
  variantId: number;
  variant: VariantSummary;
  customerId: string; // member_id for WA, user_id for TG, customer_name for web
  customerName: string;
  customerWa?: string;
  customerEmail?: string;
  conversationId?: string; // group/chat ID
  idempotencyKey: string; // deterministic key, e.g. wa:pay:<conversationId>:<memberId>:<variantId>
  paymentMethod?: string;
  paymentAccount?: string;
};

export type PendingOrder = {
  code: string;
  orderId: number;
  subtotal: number;
  isExisting?: boolean;
};

/**
 * Masa hidup ORDER QRIS = masa hidup QR (15 menit, keputusan owner
 * 2026-10-11). Definisi kanonisnya ada di modul pembayaran bersama batas
 * reissue.
 */
export { QRIS_ORDER_WINDOW_MINUTES, MAX_QRIS_REISSUES } from "@/lib/payments/dana-qris";

/** Satu baris pesanan (satu varian dengan qty-nya). */
export type ChannelOrderLine = {
  productId: number;
  variantId: number;
  qty: number;
  /** Mode fulfillment varian: unique | shared | manual. */
  fulfillmentMode: string;
  /** Stok varian saat dibaca; -1 berarti unlimited. */
  stock: number;
};

export type AtomicChannelOrderInput = {
  orderCode: string;
  /** Disimpan di orders.quote_id; membuat percobaan ulang idempoten. */
  idempotencyKey?: string | null;
  lines: ChannelOrderLine[];
  /** Sudah dibentuk pemanggil agar format snapshot per kanal tidak berubah. */
  items: unknown[];
  variantSnapshot: string;
  subtotal: number;
  /** TG2b: locale immutable pesanan TG (owned saved user). Non-TG default id. */
  locale?: "id" | "en";
  primaryVariantId: number;
  customerName: string;
  customerWa?: string;
  customerEmail?: string | null;
  salesChannel: "web" | "telegram" | "whatsapp";
  telegramChatId?: string | null;
  telegramUserId?: string | null;
  conversationId?: string | null;
  channelMemberId?: string | null;
  paymentMethod: string;
  paymentAccount: string;
  fulfillmentStatus: string;
  orderWindowMinutes?: number;
};

/**
 * Reservasi stok + reservasi inventory unik + INSERT order dalam SATU
 * `d1.batch()`, sehingga tidak ada jendela di mana stok sudah terpotong
 * tetapi order belum ada.
 *
 * Kenapa ini ada: jalur Telegram dulu menjalankan `reserveInventory()`,
 * `UPDATE product_variants`, dan `INSERT INTO orders` sebagai tiga statement
 * terpisah dengan rollback manual di blok catch. Rollback itu hanya berjalan
 * untuk error yang dilempar — bila isolate Cloudflare dihentikan di tengah
 * (batas CPU, eviction), stok sudah berkurang tanpa order apa pun yang bisa
 * memulihkannya, dan cron expiry tidak menemukan apa-apa untuk dikembalikan.
 * Web dan WhatsApp sudah atomik; ini menyatukan kanal ketiga ke pola yang sama.
 *
 * Pola single-winner mengikuti `createPendingChannelOrder`: guard row
 * `operation_guards` dengan CHECK(valid=1) membatalkan seluruh batch bila
 * prasyarat tidak lagi terpenuhi, jadi kalah-race = tidak ada efek samping.
 */
export async function createChannelOrderAtomic(
  input: AtomicChannelOrderInput,
): Promise<PendingOrder> {
  assertOrderAccessConfigured();
  if (!input.lines.length) throw new Error("empty_order_lines");
  const uniqueLines = input.lines.filter(line => line.fulfillmentMode === "unique");
  if (uniqueLines.reduce((n,line)=>n+line.qty,0) > MAX_UNIQUE_UNITS_PER_ORDER) throw new StockReservationError();
  if (input.salesChannel === "telegram") {
    // TG2b correction1 (A): line/item cardinality + qty safety SEBELUM efek
    // samping. items dipasangkan ke lines berdasarkan indeks (format
    // snapshot TG per kanal); payload yang tidak konsisten (panjang beda,
    // qty beda/nol/negatif/pecahan, agregat overflow) ditolak sebelum
    // SELECT/batch/provider. Snapshot pemanggil (base/applied tier) tetap
    // dibandingkan ke hasil validasi di bawah, bukan dipercaya.
    if (!Array.isArray(input.items) || input.items.length !== input.lines.length) throw new StockReservationError();
    for (const [lineIndex, line] of input.lines.entries()) {
      const item = (input.items as { qty?: unknown }[])[lineIndex];
      if (!Number.isSafeInteger(line.qty) || line.qty < 1) throw new StockReservationError();
      if (!item || Number(item.qty) !== line.qty || !Number.isSafeInteger(item.qty) || Number(item.qty) < 1) throw new StockReservationError();
    }
    const aggregateCheck = new Map<number, number>();
    for (const line of input.lines) {
      const next = (aggregateCheck.get(line.variantId) ?? 0) + line.qty;
      if (!Number.isSafeInteger(next)) throw new StockReservationError();
      aggregateCheck.set(line.variantId, next);
    }
  }
  let orderItems: unknown[];
  try { orderItems = markUniqueUnitLines(input.items as {variant_id?:unknown;qty?:unknown}[], new Set(uniqueLines.map(line=>line.variantId))); }
  catch { throw new StockReservationError(); }
  if (input.lines.some(line => !Number.isSafeInteger(line.qty) || line.qty < 1)) throw new StockReservationError();

  const d1 = getD1();
  let orderMinutes = input.orderWindowMinutes ?? QRIS_ORDER_WINDOW_MINUTES;
  let owners: (Record<string, unknown> | undefined)[] = [];
  if (input.salesChannel === "telegram") {
    const productIds = [...new Set(input.lines.map(line => line.productId))];
    owners = await Promise.all(productIds.map(id => queryFirst("SELECT id,source,wr_product_id,wr_auto_managed,sk_product_id,sk_auto_managed FROM products WHERE id=?", id)));
    if (owners.some(owner => !owner)) throw new StockReservationError();
    orderMinutes = owners.some(owner => isManualProductForBulk(bulkOwnerFromProductRow(owner))) ? 15 : 60;
  }
  if (!d1 || !isD1Mode()) {
    // Fallback pengembangan tanpa D1: store in-memory tidak punya transaksi,
    // jadi tidak ada atomicity untuk diperjuangkan — tetapi order HARUS tetap
    // tercipta agar alur dev identik dengan produksi.
    const windowMinutesDev = orderMinutes;
    const localeDev: "id" | "en" = input.salesChannel === "telegram"
      ? (input.locale === "en" ? "en" : "id")
      : "id";
    // Paritas dev: alur unique tetap mereservasi unit di store in-memory,
    // seperti sebelum reservasi dipindah ke dalam batch D1.
    // TG2b correction1: non-D1 tetap menolak payload tak-konsisten (cek di
    // atas sudah berjalan SEBELUM cabang ini) — bukan ceiling diam-diam.
    // Perilaku idempoten/retry existing dipertahankan (early return quote).
    for (const line of input.lines) {
      if (line.fulfillmentMode !== "unique") continue;
      const { reserveInventory } = await import("@/lib/fulfillment/inventory");
      for (let unit=0; unit<line.qty; unit++) {
        const reserved = await reserveInventory(line.productId, input.orderCode, line.variantId);
        if (reserved === null) throw new StockReservationError();
      }
    }
    await execRun(
      `INSERT INTO orders (
         code, customer_name, customer_wa, customer_email, items, subtotal,
         payment_method, payment_account, proof_url, status, sales_channel,
         channel_conversation_id, channel_member_id, telegram_chat_id, telegram_user_id,
         payment_status, fulfillment_status, variant_id, variant_snapshot,
         quote_id, expires_at, locale, buyer_access_version, buyer_access_format
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'pin6')`,
      input.orderCode,
      input.customerName,
      input.customerWa || "",
      input.customerEmail ?? null,
      JSON.stringify(orderItems),
      input.subtotal,
      input.paymentMethod,
      input.paymentAccount,
      null,
      "pending",
      input.salesChannel,
      input.conversationId ?? null,
      input.channelMemberId ?? null,
      input.telegramChatId ?? null,
      input.telegramUserId ?? null,
      "pending",
      input.fulfillmentStatus,
      input.primaryVariantId,
      input.variantSnapshot,
      input.idempotencyKey ?? null,
      new Date(Date.now() + windowMinutesDev * 60_000).toISOString(),
      localeDev,
    );
    return { code: input.orderCode, orderId: 1, subtotal: input.subtotal, isExisting: false };
  }

  if (input.idempotencyKey) {
    const existing = await queryFirst(
      `SELECT id, code, subtotal FROM orders WHERE quote_id=?`,
      input.idempotencyKey,
    );
    if (existing) {
      return {
        code: String(existing.code),
        orderId: Number(existing.id),
        subtotal: Number(existing.subtotal),
        isExisting: true,
      };
    }
  }

  const guardIds: string[] = [];
  const statements: D1Statement[] = [];
  for (const owner of owners) {
    if (!owner) throw new StockReservationError();
    const guardId = `${input.orderCode}:owner:${owner.id}`;
    guardIds.push(guardId);
    statements.push(d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN EXISTS(
      SELECT 1 FROM products WHERE id=? AND source IS ? AND wr_product_id IS ? AND wr_auto_managed IS ? AND sk_product_id IS ? AND sk_auto_managed IS ?
    ) THEN 1 ELSE 0 END`).bind(guardId, owner.id, owner.source, owner.wr_product_id, owner.wr_auto_managed, owner.sk_product_id, owner.sk_auto_managed));
  }

  if (input.salesChannel === "telegram" && input.telegramChatId) {
    const guardId = `${input.orderCode}:telegram-pending`;
    guardIds.push(guardId);
    statements.push(d1.prepare(`INSERT INTO operation_guards(operation_id,valid)
      SELECT ?, CASE WHEN NOT EXISTS(SELECT 1 FROM orders WHERE sales_channel='telegram'
        AND telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))) THEN 1 ELSE 0 END`)
      .bind(guardId, input.telegramChatId));
  }

  // TG2b: untuk Telegram, pin base + konfigurasi bulk aktif SEBELUM batch
  // agar kuantitas agregat per varian (alias ikut) dihitung dari snapshot
  // yang sama dengan guard atomik. Non-TG mempertahankan perilaku lama.
  const tgBulk = new Map<number, { price: number; enabled: number; tiers: string; owner: BulkProductOwner }>();
  const tgQtyByVariant = new Map<number, number>();
  if (input.salesChannel === "telegram") {
    const variantIds = [...new Set(input.lines.map((line) => line.variantId))];
    const rows = (variantIds.length
      ? (await d1.prepare(`SELECT pv.id, pv.price, pv.bulk_pricing_enabled, pv.bulk_pricing_tiers,
          p.source AS p_source, p.wr_product_id AS p_wr_product_id, p.wr_auto_managed AS p_wr_auto_managed,
          p.sk_product_id AS p_sk_product_id, p.sk_auto_managed AS p_sk_auto_managed
        FROM product_variants pv JOIN products p ON p.id = pv.product_id
        WHERE pv.id IN (${variantIds.map(() => "?").join(",")})`).bind(...variantIds).all()).results
      : []) as Record<string, unknown>[];
    for (const row of rows) {
      if (!Number.isSafeInteger(Number(row.price))) throw new StockReservationError();
      tgBulk.set(Number(row.id), {
        price: Number(row.price),
        enabled: Number(row.bulk_pricing_enabled ?? 0),
        tiers: String(row.bulk_pricing_tiers ?? "[]"),
        owner: bulkOwnerFromJoinedRow(row) ?? {},
      });
    }
    for (const line of input.lines) {
      if (!Number.isSafeInteger(line.qty) || line.qty < 1) throw new StockReservationError();
      tgQtyByVariant.set(line.variantId, (tgQtyByVariant.get(line.variantId) ?? 0) + line.qty);
    }
  }

  for (const [lineIndex, line] of input.lines.entries()) {
    const item = input.items[lineIndex] as {
      price?: unknown; product_id?: unknown; variant_id?: unknown;
      base_price?: unknown; applied_tier_min_qty?: unknown;
    } | undefined;
    // TG2b: harga efektif dipin dari base + konfigurasi tier aktual
    // (agregat per varian) dan dibandingkan dengan harga/field tier yang
    // diklaim pemanggil — klaim bulk yang dirusak tidak dipakai.
    if (!item || !Number.isSafeInteger(item.price) || Number(item.price) < 0
      || Number(item.product_id) !== line.productId || Number(item.variant_id) !== line.variantId) throw new StockReservationError();
    if (input.salesChannel === "telegram") {
      const live = tgBulk.get(line.variantId);
      if (!live || !Number.isSafeInteger(Number(item.price))) throw new StockReservationError();
      // Guard menunggu klaim item; validasi penuh dilakukan di bawah
      // memakai `resolveBulkPrice` impor-statis (bukan kepercayaan klaim).
      if (item.base_price !== undefined && !Number.isSafeInteger(item.base_price)) throw new StockReservationError();
      if (item.applied_tier_min_qty !== undefined && !(item.applied_tier_min_qty === null || Number.isSafeInteger(item.applied_tier_min_qty))) throw new StockReservationError();
      void live;
    }
    const guardId = `${input.orderCode}:stock:${line.variantId}:${lineIndex}`;
    guardIds.push(guardId);
    // Prasyarat per baris: varian aktif, stok cukup (atau unlimited),
    // qty memenuhi minimum pembelian (migrasi 0034, COALESCE agar baris
    // lama tanpa kolom tetap valid), dan untuk mode shared secret-nya
    // benar-benar terkonfigurasi.
    if (input.salesChannel === "telegram") {
      // TG2b: pin base + bulk config + HARGA EFEKTIF klaim. pv.price harus
      // sama dengan base yang diamati; konfigurasi bulk aktif harus sama
      // persis (mencegah baca basi/konfigurasi dirusak); harga efektif yang
      // diklaim harus sama dengan pemecahan server per agregat varian.
      // Non-TG mempertahankan guard lama (price == pv.price).
      const live = tgBulk.get(line.variantId);
      let effective: number | null = null;
      let tier: number | undefined;
      if (!live) throw new StockReservationError();
      try {
        const resolved = resolveBulkPriceForProduct(live.price, tgQtyByVariant.get(line.variantId) ?? line.qty, live.enabled, live.tiers, live.owner);
        effective = resolved.price;
        tier = resolved.tier;
      } catch { throw new StockReservationError(); }
      if (effective === null || Number(item.price) !== effective) throw new StockReservationError();
      if (Number(live.price) !== (item.base_price === undefined ? live.price : Number(item.base_price))) throw new StockReservationError();
      if (tier !== undefined) {
        if (Number(item.applied_tier_min_qty) !== tier) throw new StockReservationError();
      } else if (item.applied_tier_min_qty !== undefined && item.applied_tier_min_qty !== null) throw new StockReservationError();
      statements.push(
        d1.prepare(
          `INSERT INTO operation_guards (operation_id, valid)
           SELECT ?, CASE WHEN EXISTS(
             SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id
             WHERE pv.id=? AND pv.product_id=? AND pv.price=? AND pv.bulk_pricing_enabled=? AND pv.bulk_pricing_tiers=?
               AND p.is_active=1 AND p.telegram_enabled=1
               AND pv.fulfillment_mode=? AND pv.is_active=1 AND (pv.stock=-1 OR pv.stock>=?)
               AND ? >= COALESCE(pv.min_qty,1)
               AND (
                 pv.fulfillment_mode!='shared'
                 OR (pv.shared_secret_ciphertext IS NOT NULL AND pv.shared_secret_iv IS NOT NULL)
               )
           ) THEN 1 ELSE 0 END`,
        ).bind(guardId, line.variantId, line.productId, live.price, live.enabled, live.tiers, line.fulfillmentMode, line.qty, line.qty),
      );
    } else {
      statements.push(
        d1.prepare(
          `INSERT INTO operation_guards (operation_id, valid)
           SELECT ?, CASE WHEN EXISTS(
             SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id
             WHERE pv.id=? AND pv.product_id=? AND pv.price=? AND p.is_active=1
               AND (? != 'telegram' OR p.telegram_enabled=1)
               AND pv.fulfillment_mode=? AND pv.is_active=1 AND (pv.stock=-1 OR pv.stock>=?)
               AND ? >= COALESCE(pv.min_qty,1)
               AND (
                 pv.fulfillment_mode!='shared'
                 OR (pv.shared_secret_ciphertext IS NOT NULL AND pv.shared_secret_iv IS NOT NULL)
               )
           ) THEN 1 ELSE 0 END`,
        ).bind(guardId, line.variantId, line.productId, item.price, input.salesChannel, line.fulfillmentMode, line.qty, line.qty),
      );
    }
    // Klausa `(stock=-1 OR stock>=?)` di UPDATE bersifat defense-in-depth:
    // guard di atas sudah menjamin, tetapi tanpa klausa ini korektnes
    // bergantung pada guard dan update berada di batch yang sama. Bila suatu
    // saat keduanya terpisah, stok gagal-tertutup alih-alih menjadi negatif.
    statements.push(
      d1.prepare(
        `UPDATE product_variants
         SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock-? END,
             updated_at = datetime('now')
         WHERE id=? AND is_active=1 AND (stock=-1 OR stock>=?)`,
      ).bind(line.qty, line.variantId, line.qty),
    );
  }

  // Statement berurutan di dalam satu batch melihat efek statement
  // sebelumnya, sehingga `status='available'` otomatis tidak memilih ulang
  // unit yang baru saja direservasi baris sebelumnya.
  for (const line of uniqueLines) {
    statements.push(
      d1.prepare(
        `UPDATE fulfillment_inventory
         SET status='reserved', order_code=?, variant_id=COALESCE(variant_id, ?), reserved_at=datetime('now')
         WHERE id IN (
           SELECT id FROM fulfillment_inventory
           WHERE product_id=? AND status='available' AND (variant_id=? OR variant_id IS NULL)
           ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, COALESCE(sort_order,id), id ASC
           LIMIT ?
         ) AND status='available'`,
      ).bind(input.orderCode, line.variantId, line.productId, line.variantId, line.variantId, line.qty),
    );
  }

  if (uniqueLines.length > 0) {
    // Verifikasi pasca-klaim: UPDATE yang tidak mengenai baris apa pun TIDAK
    // melempar, jadi tanpa guard ini order bisa terbit dengan inventory unik
    // yang kurang dari jumlah baris.
    const verifyGuardId = `${input.orderCode}:inventory-claimed`;
    guardIds.push(verifyGuardId);
    statements.push(
      d1.prepare(
        `INSERT INTO operation_guards (operation_id, valid)
         SELECT ?, CASE WHEN (
           SELECT COUNT(*) FROM fulfillment_inventory
           WHERE order_code=? AND status='reserved'
         ) >= ? THEN 1 ELSE 0 END`,
      ).bind(verifyGuardId, input.orderCode, uniqueLines.reduce((n,line)=>n+line.qty,0)),
    );
  }

  // TG2b: subtotal konsisten internal — jumlahkan harga efektif klaim ×
  // qty per baris sebelum INSERT (menolak total yang dimanipulasi).
  if (input.salesChannel === "telegram") {
    const internalSubtotal = (input.items as { price?: unknown; qty?: unknown }[]).reduce((sum, item) => {
      if (!Number.isSafeInteger(item.price) || !Number.isSafeInteger(item.qty)) throw new StockReservationError();
      const add = Number(item.price) * Number(item.qty);
      if (!Number.isSafeInteger(sum + add)) throw new StockReservationError();
      return sum + add;
    }, 0);
    if (internalSubtotal !== input.subtotal) throw new StockReservationError();
  }

  const windowMinutes = orderMinutes;
  // ISO UTC, bukan `datetime('now','+N minutes')`. SQLite menghasilkan format
  // spasi ("YYYY-MM-DD HH:MM:SS") yang oleh `Date.parse` di JS ditafsirkan
  // sebagai waktu LOKAL — di WIB itu menggeser expiry 7 jam lebih awal untuk
  // setiap pembacaan sisi JS (isFutureIso, isReusablePendingOrder). SQLite
  // tetap menerima ISO dengan T/Z, sehingga predikat SQL `datetime(expires_at)`
  // tidak terpengaruh.
  const expiresAtIso = new Date(Date.now() + windowMinutes * 60_000).toISOString();
  const orderInsertIndex = statements.length;
  const orderLocale: "id" | "en" = input.salesChannel === "telegram"
    ? (input.locale === "en" ? "en" : "id")
    : "id";
  statements.push(
    d1.prepare(
      `INSERT INTO orders (
         code, customer_name, customer_wa, customer_email, items, subtotal,
         payment_method, payment_account, proof_url, status, sales_channel,
         channel_conversation_id, channel_member_id, telegram_chat_id, telegram_user_id,
         payment_status, fulfillment_status, variant_id, variant_snapshot,
         quote_id, expires_at, locale, buyer_access_version, buyer_access_format
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'pin6')`,
    ).bind(
      input.orderCode,
      input.customerName,
      input.customerWa || "",
      input.customerEmail ?? null,
      JSON.stringify(orderItems),
      input.subtotal,
      input.paymentMethod,
      input.paymentAccount,
      null,
      "pending",
      input.salesChannel,
      input.conversationId ?? null,
      input.channelMemberId ?? null,
      input.telegramChatId ?? null,
      input.telegramUserId ?? null,
      "pending",
      input.fulfillmentStatus,
      input.primaryVariantId,
      input.variantSnapshot,
      input.idempotencyKey ?? null,
      expiresAtIso,
      orderLocale,
    ),
  );

  for (const guardId of guardIds) {
    statements.push(d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId));
  }

  try {
    const results = await d1.batch(statements);
    const orderId = results[orderInsertIndex]?.meta?.last_row_id ?? 0;
    return { code: input.orderCode, orderId, subtotal: input.subtotal, isExisting: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.salesChannel === "telegram" && input.telegramChatId && /operation_guards|CHECK constraint/i.test(message)) {
      const winner = await queryFirst(`SELECT id,code,subtotal FROM orders WHERE sales_channel='telegram'
        AND telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now')) ORDER BY id DESC LIMIT 1`, input.telegramChatId);
      if (winner) return { code: String(winner.code), orderId: Number(winner.id), subtotal: Number(winner.subtotal), isExisting: true };
    }
    if (input.idempotencyKey && /UNIQUE|operation_guards|CHECK constraint/i.test(message)) {
      const raceWinner = await queryFirst(
        `SELECT id, code, subtotal FROM orders WHERE quote_id=?`,
        input.idempotencyKey,
      );
      if (raceWinner) {
        return {
          code: String(raceWinner.code),
          orderId: Number(raceWinner.id),
          subtotal: Number(raceWinner.subtotal),
          isExisting: true,
        };
      }
    }
    if (/operation_guards|CHECK constraint/i.test(message)) throw new StockReservationError();
    throw error;
  }
}

type PendingOrderState = {
  status?: unknown;
  payment_status?: unknown;
  expires_at?: unknown;
};

export type PaymentDisplaySnapshot = {
  productName: string;
  variantLabel: string;
  duration: string;
  warranty: string;
};

/** Read immutable buyer-facing labels captured when the order was created. */
export function parsePaymentDisplaySnapshot(raw: unknown): PaymentDisplaySnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    const variantLabel = String(parsed.label || "").trim();
    if (!variantLabel) return null;
    return {
      productName: String(parsed.product_name || "").trim(),
      variantLabel,
      duration: String(parsed.duration_label || "").trim(),
      warranty: String(parsed.warranty_label || "").trim(),
    };
  } catch {
    return null;
  }
}

/**
 * One gateway inbox event maps to one order attempt. A later payment-method
 * message gets a different inbox id, so the same member can buy it again.
 */
export function buildWhatsAppOrderIdempotencyKey(
  conversationId: string,
  memberId: string,
  inboxId: string,
  variantId: number,
): string {
  const eventId = inboxId.trim();
  if (!eventId) throw new Error("missing_whatsapp_inbox_id");
  return ["wa", "order", conversationId, memberId, eventId, String(variantId)]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

export function isReusablePendingOrder(order: PendingOrderState, now = Date.now()): boolean {
  if (String(order.status || "") !== "pending") return false;
  if (!["unpaid", "pending"].includes(String(order.payment_status || ""))) return false;
  if (!order.expires_at) return true;
  const expiresAt = Date.parse(String(order.expires_at));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/**
 * Creates a pending channel order with atomic stock reservation.
 * If an order already exists with the same idempotency key (stored in quote_id),
 * it returns the existing order idempotently without re-decrementing stock.
 */
export async function createPendingChannelOrder(input: ChannelOrderInput): Promise<PendingOrder> {
  assertOrderAccessConfigured();
  // 1. Idempotency check: look for existing pending or active order with this key
  if (isD1Mode()) {
    const existing = await queryFirst(
      `SELECT id, code, subtotal, status FROM orders WHERE quote_id=?`,
      input.idempotencyKey,
    );
    if (existing) {
      return {
        code: String(existing.code),
        orderId: Number(existing.id),
        subtotal: Number(existing.subtotal),
        isExisting: true,
      };
    }
  }

  // 2. Re-validate variant against D1
  const variant = await getActiveVariant(input.variantId);
  if (!variant) throw new Error("variant_unavailable");
  if (variant.stock === 0) throw new Error("out_of_stock");
  if (variant.price !== input.variant.price) throw new Error("price_changed");
  if (variant.product_id !== input.productId) throw new Error("variant_product_mismatch");

  const orderCode = generateOrderCode();
  const items = [
    {
      product_id: input.productId,
      variant_id: input.variantId,
      name: `${input.productName} — ${variant.label}`,
      variant_label: variant.label,
      price: variant.price,
      qty: 1,
    },
  ];

  const variantSnapshot = JSON.stringify({
    product_name: input.productName,
    variant_id: input.variantId,
    sku: variant.sku,
    label: variant.label,
    duration_value: variant.duration_value,
    duration_unit: variant.duration_unit,
    duration_label: formatDuration(variant),
    warranty_type: variant.warranty_type,
    warranty_value: variant.warranty_value,
    warranty_unit: variant.warranty_unit,
    warranty_label: buyerWarrantyLabel(variant),
    price: variant.price,
    fulfillment_mode: variant.fulfillment_mode,
  });

  const d1 = getD1();
  if (d1) {
    const guardId = `${input.idempotencyKey}:stock:${input.variantId}`;
    const needsUniqueInventory = variant.fulfillment_mode === "unique";
    const statements: D1Statement[] = [
      // 1. Guard check: variant stock and, for unique delivery, one matching
      // encrypted inventory item must both be available.
      // Migrasi 0034: qty (+ batas minimum pembelian) ikut dipagar atomik.
      d1.prepare(
        `INSERT INTO operation_guards (operation_id, valid)
         SELECT ?, CASE WHEN EXISTS(
           SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id
           WHERE pv.id=? AND pv.product_id=? AND pv.price=? AND p.is_active=1
             AND pv.fulfillment_mode=? AND pv.is_active=1 AND (pv.stock=-1 OR pv.stock>=1)
             AND 1 >= COALESCE(pv.min_qty,1)
             AND (
               pv.fulfillment_mode!='shared'
               OR (pv.shared_secret_ciphertext IS NOT NULL AND pv.shared_secret_iv IS NOT NULL)
             )
         ) AND (
           ? != 'unique' OR EXISTS(
             SELECT 1 FROM fulfillment_inventory
             WHERE product_id=? AND status='available' AND (variant_id=? OR variant_id IS NULL)
           )
         ) THEN 1 ELSE 0 END`,
      ).bind(guardId, input.variantId, input.productId, variant.price, variant.fulfillment_mode, variant.fulfillment_mode, input.productId, input.variantId),

      // 2. Decrement variant stock
      d1.prepare(
        `UPDATE product_variants
         SET stock = CASE WHEN stock=-1 THEN -1 ELSE stock-1 END,
             updated_at = datetime('now')
         WHERE id=?`,
      ).bind(input.variantId),

    ];

    if (needsUniqueInventory) {
      statements.push(
        d1.prepare(
          `UPDATE fulfillment_inventory
           SET status='reserved', order_code=?, reserved_at=datetime('now')
           WHERE id=(
             SELECT id FROM fulfillment_inventory
             WHERE product_id=? AND status='available' AND (variant_id=? OR variant_id IS NULL)
             ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, COALESCE(sort_order,id), id ASC
             LIMIT 1
           ) AND status='available'`,
        ).bind(orderCode, input.productId, input.variantId, input.variantId),
      );
    }

    const orderInsertIndex = statements.length;
    statements.push(
      // 3. Insert order
      d1.prepare(
        `INSERT INTO orders (
           code, customer_name, customer_wa, customer_email, items, subtotal,
           payment_method, payment_account, proof_url, status, sales_channel,
           channel_conversation_id, channel_member_id, telegram_chat_id, telegram_user_id,
           payment_status, fulfillment_status, variant_id, variant_snapshot,
           quote_id, expires_at, buyer_access_version, buyer_access_format
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+24 hours'),1,'pin6')`,
      ).bind(
        orderCode,
        input.customerName,
        input.customerWa || "",
        input.customerEmail || null,
        JSON.stringify(items),
        variant.price,
        input.paymentMethod || "pending",
        input.paymentAccount || "",
        null,
        "pending",
        input.salesChannel,
        input.conversationId || null,
        input.customerId,
        input.salesChannel === "telegram" ? input.conversationId || null : null,
        input.salesChannel === "telegram" ? input.customerId : null,
        "pending",
        needsUniqueInventory ? "reserved" : "not_required",
        input.variantId,
        variantSnapshot,
        input.idempotencyKey,
      ),
      // 4. Cleanup guard
      d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
    );

    try {
      const results = await d1.batch(statements);
      const orderInsertResult = results[orderInsertIndex];
      const orderId = orderInsertResult?.meta?.last_row_id ?? 0;

      return {
        code: orderCode,
        orderId,
        subtotal: variant.price,
        isExisting: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A concurrent retry can collide on either the order quote or the stock
      // guard. Check for its committed winner before classifying the error.
      if (/UNIQUE|operation_guards|CHECK constraint/i.test(message)) {
        const raceWinner = await queryFirst(
          `SELECT id, code, subtotal FROM orders WHERE quote_id=?`,
          input.idempotencyKey,
        );
        if (raceWinner) {
          return {
            code: String(raceWinner.code),
            orderId: Number(raceWinner.id),
            subtotal: Number(raceWinner.subtotal),
            isExisting: true,
          };
        }
      }
      if (/operation_guards|CHECK constraint/i.test(message)) {
        throw new StockReservationError();
      }
      throw error;
    }
  }

  // In-memory fallback (development without D1)
  return {
    code: orderCode,
    orderId: 1,
    subtotal: variant.price,
    isExisting: false,
  };
}

// Fetch active payment methods for WhatsApp / Web display
export async function getActivePaymentMethods(): Promise<{
  qris: { name: string } | null;
  seabank: { account: string; name: string } | null;
  ewallet: { account: string; name: string } | null;
}> {
  const methods = await queryAll(`SELECT * FROM payment_methods WHERE is_active=1 ORDER BY sort_order ASC`);

  const qris = methods.find((m) => String(m.id) === "qris");
  const seabank = methods.find((m) => String(m.id) === "seabank");
  const ewallet = methods.find((m) => String(m.id) === "ewallet");

  return {
    qris: qris ? { name: String(qris.account_name || "DANA Business") } : null,
    seabank: seabank?.account_number ? { account: String(seabank.account_number), name: String(seabank.account_name || "") } : null,
    ewallet: ewallet?.account_number ? { account: String(ewallet.account_number), name: String(ewallet.account_name || "") } : null,
  };
}
