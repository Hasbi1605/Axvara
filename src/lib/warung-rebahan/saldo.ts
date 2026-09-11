// src/lib/warung-rebahan/saldo.ts — Monitor saldo WR + estimasi kapasitas order.
// Dipanggil cron (tiap 1 jam) dan admin (refresh manual).

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { fetchBalance, isWrEnabled } from "./client";

export type SaldoCheckResult = {
  balance: number;
  currency: string;
  isLow: boolean;
  threshold: number;
};

export function getSaldoThreshold(): number {
  const rawText = (process.env.WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD ?? "").trim();
  if (!rawText) return 50000;
  const raw = Number(rawText);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 50000;
}

export async function checkAndLogSaldo(
  database?: DatabaseAccess,
): Promise<SaldoCheckResult> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) throw new Error("warung_rebahan_disabled");
  const { balance, currency } = await fetchBalance();
  const amount = Math.floor(Number(balance) || 0);
  await db.execRun(
    `INSERT INTO wr_saldo_log (balance, source, note) VALUES (?,'api_check',NULL)`,
    amount,
  );
  const threshold = getSaldoThreshold();
  const isLow = amount < threshold;
  if (isLow) {
    await notifyLowSaldo(amount, threshold).catch(() => undefined);
  }
  await db.execRun(
    `INSERT INTO wr_sync_log (sync_type, status, saldo_amount, duration_ms)
     VALUES ('saldo','success',?,0)`,
    amount,
  ).catch(() => undefined);
  return { balance: amount, currency: currency || "IDR", isLow, threshold };
}

async function notifyLowSaldo(
  balance: number,
  threshold: number,
): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return;
  const { sendMessage } = await import("@/lib/telegram/api");
  const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
  await sendMessage({
    chat_id: adminChatId,
    text:
      `💰 <b>Saldo Warung Rebahan rendah</b>\n` +
      `Saldo: <b>${rupiah(balance)}</b> (batas: ${rupiah(threshold)})\n` +
      `Segera top up agar auto-order tidak macet.`,
    parse_mode: "HTML",
  });
}

export async function getSaldoHistory(
  limit = 20,
  database?: DatabaseAccess,
): Promise<{ balance: number; source: string; note: string | null; created_at: string }[]> {
  const db = database ?? createDatabaseAccess();
  const rows = await db
    .queryAll(`SELECT balance, source, note, created_at FROM wr_saldo_log ORDER BY id DESC LIMIT ?`, limit)
    .catch(() => []);
  return rows.map((r) => ({
    balance: Number(r.balance || 0),
    source: String(r.source || "api_check"),
    note: r.note ? String(r.note) : null,
    created_at: String(r.created_at || ""),
  }));
}

/** Estimasi berapa order lagi yang bisa diproses dengan saldo saat ini. */
export async function estimateOrderCapacity(
  database?: DatabaseAccess,
): Promise<{ balance: number; avgOrderCost: number; estimatedOrders: number }> {
  const db = database ?? createDatabaseAccess();
  const last = await db
    .queryFirst(`SELECT balance FROM wr_saldo_log ORDER BY id DESC LIMIT 1`)
    .catch(() => null);
  const balance = last ? Number(last.balance || 0) : 0;
  const avg = await db
    .queryFirst(
      `SELECT AVG(wr_cost) AS avg_cost FROM wr_order_links WHERE status='completed'`,
    )
    .catch(() => null);
  const avgOrderCost = Math.floor(Number(avg?.avg_cost || 0));
  const estimatedOrders = avgOrderCost > 0 ? Math.floor(balance / avgOrderCost) : 0;
  return { balance, avgOrderCost, estimatedOrders };
}
