// src/lib/pedia/ops-config.ts — Satu sumber nilai operasional Pedia.
//
// `store_settings` hanya menyimpan preferensi tampilan/admin; jalur uang
// (quote/orders/catalog/prices), guard margin, dan alert saldo SELALU memakai
// env produksi. Helper ini menjaga pembacaan yang sama di semua pemanggil dan
// di GET admin settings (nilai efektif, bukan nilai tersimpan).

import { PEDIA_MIN_ORDER_RP_DEFAULT } from "@/lib/pedia/pricing";

export const PEDIA_BALANCE_ALERT_RP_DEFAULT = 100_000;

/** Minimum order efektif yang dipakai quote, order, katalog, dan reprice. */
export function pediaMinOrderRp(): number {
  return Number(process.env.PEDIA_MIN_ORDER_RP || PEDIA_MIN_ORDER_RP_DEFAULT) || PEDIA_MIN_ORDER_RP_DEFAULT;
}

/** Ambang saldo efektif yang memicu alert admin dari cron. */
export function pediaBalanceAlertRp(): number {
  return Number(process.env.PEDIA_BALANCE_ALERT_RP || PEDIA_BALANCE_ALERT_RP_DEFAULT) || PEDIA_BALANCE_ALERT_RP_DEFAULT;
}
