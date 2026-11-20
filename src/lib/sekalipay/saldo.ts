// src/lib/sekalipay/saldo.ts — Monitor saldo Sekalipay + throttle notif admin.
// Cermin WR saldo.ts (check + log + alert ambang default Rp250.000).

import { createDatabaseAccess, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { fetchSkBalance, isSkEnabled } from "./client";

const LOW_SALDO_REPEAT_MS = 6 * 60 * 60 * 1000;
const LOW_SALDO_STEP_IDR = 5000;

export function skSaldoAlertThreshold(): number {
  const raw = Number(process.env.SEKALIPAY_SALDO_ALERT_THRESHOLD ?? 250000);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 250000;
}

/** Policy tetap: kirim ulang hanya bila belum pernah kirim dalam 6 jam, atau
 * saldo TURUN melewati kelipatan Rp5.000. State rusak/kosong = due. */
function skLowSaldoDue(raw: string, balance: number, now: number): boolean {
  if (!raw) return true;
  const [lastBalanceStr, lastTsStr] = raw.split("|");
  const lastBalance = Number(lastBalanceStr);
  const lastTs = Number(lastTsStr);
  if (!Number.isFinite(lastBalance) || !Number.isFinite(lastTs)) return true;
  if (lastTs < now - LOW_SALDO_REPEAT_MS) return true;
  return balance <= Math.floor(lastBalance / LOW_SALDO_STEP_IDR) * LOW_SALDO_STEP_IDR - LOW_SALDO_STEP_IDR;
}

/**
 * Alert saldo rendah admin — fail closed. State `sk_sync_state.low_saldo_notified`
 * WAJIB terbaca dan diklaim atomik (CAS) SEBELUM Telegram; error baca/tulis,
 * kalah CAS, atau state dalam masa tenang = tidak kirim. Reservasi tetap
 * dipertahankan walau Telegram gagal/ambigu agar tick berikutnya tidak
 * mengirim ulang salinan.
 */
async function alertSkLowSaldo(db: DatabaseAccess, balance: number, threshold: number): Promise<void> {
  const adminChatId = (process.env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
  if (!adminChatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return;
  try {
    const row = await db.queryFirst(`SELECT value FROM sk_sync_state WHERE key='low_saldo_notified'`);
    const raw = row ? String(row.value ?? "") : "";
    const now = Date.now();
    if (!skLowSaldoDue(raw, balance, now)) return;
    const reserved = await db.execRun(
      `INSERT INTO sk_sync_state (key, value) VALUES ('low_saldo_notified',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
       WHERE COALESCE(sk_sync_state.value,'')=?`,
      `${balance}|${now}`,
      raw,
    );
    if (reserved.changes !== 1) return;
    await db
      .execRun(`INSERT INTO sk_saldo_log (balance, source, note) VALUES (?,'low_alert',?)`, balance, `threshold ${threshold}`)
      .catch(() => undefined);
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    return;
  }
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    await sendMessage({
      chat_id: adminChatId,
      text: `💰 <b>Saldo Sekalipay menipis</b>\nSisa Rp${balance.toLocaleString("id-ID")} (ambang Rp${threshold.toLocaleString("id-ID")}). Top up agar auto-order SK tidak tertahan.`,
      parse_mode: "HTML",
    });
  } catch {
    /* best-effort: reservasi tetap dipertahankan */
  }
}

export async function checkAndLogSkSaldo(database?: DatabaseAccess): Promise<{
  balance: number;
  isLow: boolean;
  threshold: number;
}> {
  const db = database ?? createDatabaseAccess();
  if (!isSkEnabled()) throw new Error("sekalipay_disabled");
  const data = await fetchSkBalance();
  const balance = Math.floor(Number(data.balance ?? 0) || 0);
  const threshold = skSaldoAlertThreshold();
  const isLow = balance < threshold;
  await db
    .execRun(`INSERT INTO sk_saldo_log (balance, source, note) VALUES (?,'api_check',NULL)`, balance)
    .catch(() => undefined);
  if (isLow) await alertSkLowSaldo(db, balance, threshold);
  return { balance, isLow, threshold };
}

export async function estimateSkOrderCapacity(database?: DatabaseAccess): Promise<{
  balance: number;
  avgOrderCost: number;
  estimatedOrders: number;
}> {
  const db = database ?? createDatabaseAccess();
  const last = await db
    .queryFirst(`SELECT balance FROM sk_saldo_log WHERE source='api_check' ORDER BY id DESC LIMIT 1`)
    .catch(() => null);
  const balance = Math.floor(Number(last?.balance ?? 0) || 0);
  const avg = await db
    .queryFirst(`SELECT AVG(sk_cost) AS avg_cost FROM sk_order_links WHERE status='completed'`)
    .catch(() => null);
  const avgOrderCost = Math.max(1, Math.floor(Number(avg?.avg_cost ?? 5000) || 5000));
  return { balance, avgOrderCost, estimatedOrders: Math.floor(balance / avgOrderCost) };
}

export async function getSkSaldoHistory(
  limit = 10,
  database?: DatabaseAccess,
): Promise<{ balance: number; created_at: string }[]> {
  const db = database ?? createDatabaseAccess();
  const rows = await db
    .queryAll(`SELECT balance, created_at FROM sk_saldo_log ORDER BY id DESC LIMIT ?`, Math.max(1, Math.min(limit, 50)))
    .catch(() => []);
  return rows.map((r) => ({ balance: Number(r.balance || 0), created_at: String(r.created_at || "") }));
}
