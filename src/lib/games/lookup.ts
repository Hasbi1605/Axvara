// src/lib/games/lookup.ts — lacak order Games via kode + kontak checkout.
// Pola lookup Pedia/Market: respons generik anti-oracle dan tanpa data
// modal/seller/kode cadangan.
import { NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  buyerOrderAccessMatches, createBuyerAccessSession, newOrderAccessFailure,
  orderAccessDenied, requiresOrderAccessCode,
} from "@/lib/order-access";
import { deriveNameFromEmail } from "@/lib/utils";
import { gamesGameForBrand } from "./registry";
import { gamesBuyerStatus } from "./status";

const QRIS_PROVIDERS = new Set(["dana", "gopay", "klikqris"]);

export type GamesOrderRow = Record<string, unknown>;
export type GamesItemRow = Record<string, unknown>;
export type GamesPaymentRow = Record<string, unknown>;

export async function loadGamesOrder(code: string): Promise<{
  db: ReturnType<typeof createDatabaseAccess>;
  order: GamesOrderRow;
  item: GamesItemRow;
  tx: GamesPaymentRow | null;
} | null> {
  const db = createDatabaseAccess();
  const order = await db.queryFirst(
    `SELECT * FROM orders WHERE code=? AND order_kind='games'`, code,
  ).catch(() => null);
  if (!order) return null;
  const item = await db.queryFirst(
    `SELECT i.*, p.product_name, p.game_brand
       FROM games_order_items i LEFT JOIN games_products p ON p.id=i.product_id
      WHERE i.order_code=?`, code,
  ).catch(() => null);
  if (!item) return null;
  const tx = await db.queryFirst(
    `SELECT provider,requested_amount,payable_amount,unique_code,qris_url,expires_at,status
       FROM payment_transactions WHERE order_code=? ORDER BY id DESC LIMIT 1`, code,
  ).catch(() => null);
  return { db, order, item, tx };
}

export function gamesQrisBlock(tx: GamesPaymentRow | null) {
  if (!tx || !QRIS_PROVIDERS.has(String(tx.provider))) return null;
  return {
    payable_amount: tx.payable_amount,
    unique_code: tx.unique_code,
    image_url: tx.qris_url,
    expires_at: tx.expires_at,
    status: tx.status,
  };
}

export function maskedContact(order: GamesOrderRow) {
  const wa = String(order.customer_wa ?? "");
  const email = String(order.customer_email ?? "");
  return {
    customer_wa: wa.length >= 7 ? `${wa.slice(0, 5)}****${wa.slice(-4)}` : wa ? `${wa.slice(0, 3)}****` : "",
    customer_email: email.includes("@") ? email.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : email ? "***" : null,
  };
}

/** Lookup publik (POST /api/games/lookup). `request` wajib untuk bukti kontak. */
export async function lookupGamesOrder(code: string, contactRaw: string, request?: Request) {
  const loaded = await loadGamesOrder(code);
  if (!loaded) return orderAccessDenied();
  const { order, item, tx } = loaded;
  if (request) {
    const failure = await newOrderAccessFailure(request, order, contactRaw, { allowAdmin: false });
    if (failure) return failure;
  }
  if (!requiresOrderAccessCode(order) && !(await buyerOrderAccessMatches(contactRaw, order))) return orderAccessDenied();
  const game = gamesGameForBrand(item.game_brand);
  const status = gamesBuyerStatus(order.status, item.status);
  const success = status === "success";
  const storedName = String(order.customer_name ?? "").trim();
  return NextResponse.json({
    buyer_access_session: await createBuyerAccessSession(order),
    order: {
      code: order.code,
      order_kind: "games",
      customer_name: storedName || deriveNameFromEmail(String(order.customer_email ?? "")),
      ...maskedContact(order),
      items: [{
        name: `${game?.name ?? String(item.game_brand ?? "Game")} · ${String(item.product_name ?? "")}`.trim().slice(0, 200),
        price: Number(item.total),
        qty: Number(item.quantity) || 1,
      }],
      subtotal: order.subtotal,
      payment_method: order.payment_method,
      payment_account: order.payment_account ?? null,
      payment_status: order.payment_status ?? null,
      paid_at: order.paid_at != null ? String(order.paid_at) : null,
      status: order.status,
      games_status: status,
      games_status_raw: item.status,
      game: game ? { slug: game.slug, name: game.name, publisher: game.publisher } : null,
      customer_no: String(item.customer_no ?? ""),
      customer_nickname: item.customer_nickname != null ? String(item.customer_nickname) : null,
      quantity: Number(item.quantity) || 1,
      unit_price: Number(item.unit_price),
      total: Number(item.total),
      sn: success && item.sn != null ? String(item.sn) : null,
      supplier_message: success && item.supplier_message != null ? String(item.supplier_message) : null,
      created_at: order.created_at,
      expires_at: order.expires_at,
      locale: String(order.locale ?? "id"),
      qris: gamesQrisBlock(tx),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
