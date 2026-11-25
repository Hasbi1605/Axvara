// src/lib/telegram/order-summary.ts — Ringkasan & metadata order lintas 3 lini
// (Market `apps`, AXVARA Games `games`, AXVARA Pedia `pedia`) untuk Bot Telegram.
// Dipakai bersama oleh invoice, retry, status, reminder, expiry, dan /orders.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import type { Locale } from "@/lib/i18n/locale";
import { gamesVariantName } from "@/lib/games/display-name";
import { gamesBuyerStatus, isGamesManualRefundRequired, type GamesBuyerStatus } from "@/lib/games/status";
import { invoiceItemSummary } from "@/lib/telegram/messages/format";
import { readPediaServiceCopy } from "@/lib/pedia/service-copy";
import { pediaServiceName } from "@/lib/pedia/copy";
import { whiteLabel } from "@/lib/pedia/terms";
import { pediaRefillState, type PediaRefillState } from "@/lib/pedia/refill-policy";

export type TelegramOrderKind = "apps" | "games" | "pedia";

export function telegramOrderKindOf(row: { order_kind?: unknown; code?: unknown } | null | undefined): TelegramOrderKind {
  const explicit = String(row?.order_kind ?? "").trim().toLowerCase();
  if (explicit === "games" || explicit === "pedia") return explicit;
  if (explicit === "apps") return "apps";
  const code = String(row?.code ?? "").trim().toUpperCase();
  if (code.startsWith("AXG-")) return "games";
  if (code.startsWith("AXP-")) return "pedia";
  return "apps";
}

export function telegramOrderIcon(kind: TelegramOrderKind): string {
  if (kind === "games") return "🎮";
  if (kind === "pedia") return "📈";
  return "📋";
}

export interface GamesOrderDetailInfo {
  kind: "games";
  summary: string;
  gameSlug: string;
  gameName: string;
  packageName: string;
  productId: number;
  buyerSkuCode: string;
  customerNo: string;
  customerNickname: string | null;
  itemStatus: string;
  buyerStatus: GamesBuyerStatus;
  manualRefundRequired: boolean;
  sn: string | null;
}

export interface PediaOrderDetailInfo {
  kind: "pedia";
  summary: string;
  productId: number;
  tierId: number;
  productName: string;
  serviceName: string;
  quantity: number;
  target: string;
  itemStatus: string;
  startCount: number | null;
  remains: number | null;
  done: number | null;
  etaStart: string | null;
  etaFinish: string | null;
  refill: PediaRefillState;
}

export interface AppsOrderDetailInfo {
  kind: "apps";
  summary: string;
}

export type TelegramOrderDetailInfo = GamesOrderDetailInfo | PediaOrderDetailInfo | AppsOrderDetailInfo;

function safeInt(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Baca detail & ringkasan item order untuk Games / Pedia / Market secara aman. */
export async function readTelegramOrderDetail(
  order: { code?: unknown; order_kind?: unknown; items?: unknown; status?: unknown; payment_status?: unknown },
  locale: Locale = "id",
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<TelegramOrderDetailInfo> {
  const kind = telegramOrderKindOf(order);
  const en = locale === "en";
  const code = String(order.code ?? "").toUpperCase();

  if (kind === "games") {
    const row = await database.queryFirst(
      `SELECT gi.product_id, gi.buyer_sku_code, gi.customer_no, gi.customer_nickname, gi.status, gi.sn,
              gi.supplier, gi.last_error,
              gp.product_name, gp.game_brand, gp.sk_product_name, gp.game_slug,
              gm.display_name AS game_display_name
         FROM games_order_items gi
         LEFT JOIN games_products gp ON gp.id=gi.product_id
         LEFT JOIN games_meta gm ON gm.slug=gp.game_slug
        WHERE gi.order_code=?`,
      code,
    ).catch(() => null);
    if (!row) {
      return {
        kind: "games",
        summary: en ? "Games Top Up" : "Top Up Games",
        gameSlug: "",
        gameName: "Games",
        packageName: en ? "Top Up" : "Top Up",
        productId: 0,
        buyerSkuCode: "",
        customerNo: "",
        customerNickname: null,
        itemStatus: "awaiting_payment",
        buyerStatus: gamesBuyerStatus(order.status, "awaiting_payment"),
        manualRefundRequired: false,
        sn: null,
      };
    }
    const gameSlug = String(row.game_slug ?? "").trim();
    const gameName = String(row.game_display_name || row.sk_product_name || row.game_brand || "Games").trim().slice(0, 120);
    const packageName = (gamesVariantName(String(row.product_name ?? ""), { name: gameName, slug: gameSlug }) || (en ? "Top Up" : "Top Up")).slice(0, 140);
    const itemStatus = String(row.status ?? "awaiting_payment");
    return {
      kind: "games",
      summary: `${gameName} — ${packageName}`,
      gameSlug,
      gameName,
      packageName,
      productId: Number(row.product_id) || 0,
      buyerSkuCode: String(row.buyer_sku_code ?? ""),
      customerNo: String(row.customer_no ?? ""),
      customerNickname: row.customer_nickname ? String(row.customer_nickname).trim() : null,
      itemStatus,
      buyerStatus: gamesBuyerStatus(order.status, itemStatus),
      manualRefundRequired: isGamesManualRefundRequired(
        { status: order.status, payment_status: order.payment_status },
        row,
      ),
      sn: itemStatus === "success" && row.sn ? String(row.sn).trim() : null,
    };
  }

  if (kind === "pedia") {
    const row = await database.queryFirst(
      `SELECT i.*, p.name AS product_name, t.tier AS tier_name, t.label_note, t.public_name,
              t.refill_days, t.eta_start, t.eta_finish, COALESCE(s.api_refill,0) AS api_refill
         FROM pedia_order_items i
         JOIN pedia_products p ON p.id=i.product_id
         LEFT JOIN pedia_tiers t ON t.id=i.tier_id
         LEFT JOIN pedia_supplier_services s ON s.supplier=i.supplier AND s.service_id=i.supplier_service_id
        WHERE i.order_code=?`,
      code,
    ).catch(() => null);
    if (!row) {
      const fallback = invoiceItemSummary(order.items, en);
      return {
        kind: "pedia",
        summary: fallback || (en ? "Pedia Order" : "Pesanan Pedia"),
        productId: 0,
        tierId: 0,
        productName: fallback || (en ? "Pedia Service" : "Layanan Pedia"),
        serviceName: fallback || (en ? "Pedia Service" : "Layanan Pedia"),
        quantity: 0,
        target: "",
        itemStatus: "queued",
        startCount: null,
        remains: null,
        done: null,
        etaStart: null,
        etaFinish: null,
        refill: pediaRefillState({}, {}, false),
      };
    }
    let snapshot: Record<string, unknown> = {};
    try { snapshot = JSON.parse(String(row.snapshot_json ?? "{}")) ?? {}; } catch { /* legacy */ }
    const copy = readPediaServiceCopy(snapshot.service_copy);
    const rawProductName = whiteLabel(String(copy?.product_name ?? row.product_name ?? "Pedia")).trim().slice(0, 120);
    const rawServiceName = whiteLabel(String(copy?.service_name ?? row.public_name ?? row.label_note ?? row.tier_name ?? rawProductName)).trim().slice(0, 160);
    const productName = en ? pediaServiceName(rawProductName, "en") : rawProductName;
    const serviceName = en ? pediaServiceName(rawServiceName, "en") : rawServiceName;
    const qty = Math.max(0, Number(row.quantity) || 0);
    const startCount = safeInt(row.start_count);
    const rawRemains = safeInt(row.remains);
    const remains = rawRemains !== null && rawRemains <= qty ? rawRemains : null;
    const itemStatus = String(row.status ?? "queued");
    const done = itemStatus === "completed" ? qty : remains !== null ? qty - remains : null;
    const refill = pediaRefillState(row, snapshot, Number(row.api_refill) === 1);
    const qtyText = qty.toLocaleString(en ? "en-US" : "id-ID");
    return {
      kind: "pedia",
      summary: qty > 0 ? `${productName} · ${qtyText}` : productName,
      productId: Number(row.product_id) || 0,
      tierId: Number(row.tier_id) || 0,
      productName,
      serviceName,
      quantity: qty,
      target: String(row.target_normalized ?? row.target_raw ?? "").slice(0, 160),
      itemStatus,
      startCount,
      remains,
      done,
      etaStart: row.eta_start ? String(row.eta_start) : null,
      etaFinish: row.eta_finish ? String(row.eta_finish) : null,
      refill,
    };
  }

  return {
    kind: "apps",
    summary: invoiceItemSummary(order.items, en),
  };
}

/** Ringkasan 1-baris/multi-baris yang konsisten untuk invoice, retry, expiry, dan status. */
export async function telegramOrderItemSummary(
  order: { code?: unknown; order_kind?: unknown; items?: unknown; status?: unknown; payment_status?: unknown },
  locale: Locale = "id",
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<string> {
  const detail = await readTelegramOrderDetail(order, locale, database);
  return detail.summary;
}
