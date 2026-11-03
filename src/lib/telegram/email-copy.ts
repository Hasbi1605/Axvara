// src/lib/telegram/email-copy.ts — Salinan EMAIL untuk pembeli Telegram (2026-11-04).
//
// Keputusan owner: pembeli Telegram yang pesanannya memuat produk WAJIB-EMAIL
// ikut menerima email AXVARA seperti pembeli web ("Pesanan Siap" + tanda terima
// + kabar pembeli). DM Telegram tetap kanal otoritatif dan TIDAK berubah; email
// hanyalah salinan tambahan best-effort yang idempoten (kunci buyer_notice_log).
//
// Gerbang "produk wajib-email" sengaja ada: Telegram diam-diam menempelkan email
// tersimpan (telegram_users.buyer_email) ke pesanan berikutnya, padahal owner
// hanya menginginkan email untuk produk yang memang meminta email. Aturan wajib
// email SAMA dengan readCheckoutEmail (needsEmailForVariant: wr_type Invite/Link
// atau products.require_email). Gagal baca apa pun = null (fail closed).
import type { DatabaseAccess } from "@/lib/db-access";
import { isValidBuyerEmail } from "@/lib/fulfillment/delivery/buyer-email";
import { parseOrderItems } from "@/lib/fulfillment/delivery/manifest";
import { needsEmailForVariant } from "@/lib/warung-rebahan/delivery-class";

/** Email tujuan salinan, atau null bila pesanan ini tidak berhak menerimanya. */
export async function telegramEmailCopyTarget(orderCode: string, database: DatabaseAccess): Promise<string | null> {
  try {
    const order = await database.queryFirst(
      `SELECT sales_channel, COALESCE(order_kind,'apps') AS order_kind, customer_email, items FROM orders WHERE code=?`,
      orderCode,
    );
    if (!order || String(order.sales_channel || "") !== "telegram") return null;
    if (String(order.order_kind) === "pedia") return null;
    const email = String(order.customer_email ?? "").trim();
    if (!isValidBuyerEmail(email)) return null;

    // Sumber utama = snapshot baris pesanan (ada sejak sebelum bayar, mencakup
    // keranjang multi-baris); cadangan = baris fulfillment bila snapshot kosong.
    let lines = parseOrderItems(order.items).map(line => ({ productId: line.product_id, variantId: Number(line.variant_id ?? 0) }));
    if (!lines.length) {
      const rows = await database.queryAll(
        `SELECT product_id, variant_id FROM fulfillment_items WHERE order_code=?`,
        orderCode,
      );
      lines = rows.map(row => ({ productId: Number(row.product_id), variantId: Number(row.variant_id ?? 0) }));
    }
    if (!lines.length) return null;

    const variantIds = [...new Set(lines.map(line => line.variantId).filter(id => id > 0))];
    const productIds = [...new Set(lines.filter(line => !(line.variantId > 0)).map(line => line.productId).filter(id => id > 0))];
    if (variantIds.length) {
      const rows = await database.queryAll(
        `SELECT pv.id, wv.wr_type, p.require_email
         FROM product_variants pv
         JOIN products p ON p.id=pv.product_id
         LEFT JOIN wr_variants wv ON wv.wr_variant_id=pv.wr_variant_id
         WHERE pv.id IN (${variantIds.map(() => "?").join(",")})`,
        ...variantIds,
      );
      if (rows.some(row => needsEmailForVariant({
        wrType: row.wr_type == null ? null : String(row.wr_type),
        requireEmail: Number(row.require_email ?? 0),
      }))) return email;
    }
    if (productIds.length) {
      // Baris lama tanpa variant_id: hanya toggle produk yang bisa dinilai.
      const rows = await database.queryAll(
        `SELECT require_email FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`,
        ...productIds,
      );
      if (rows.some(row => needsEmailForVariant({ requireEmail: Number(row.require_email ?? 0) }))) return email;
    }
    return null;
  } catch {
    return null;
  }
}
