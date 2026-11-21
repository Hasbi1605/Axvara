// src/lib/warung-rebahan/saldo.ts — Monitor saldo WR + estimasi kapasitas order.
// Dipanggil cron (tiap 1 jam) dan admin (refresh manual).

import { createDatabaseAccess, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { fetchBalance, isWrEnabled } from "./client";

export type SaldoCheckResult = {
  balance: number;
  currency: string;
  isLow: boolean;
  threshold: number;
};

// Default ambang peringatan saldo. Dinaikkan 50.000 → 250.000 pada
// 2026-09-18 bersama pembukaan auto-order kelas antrean: varian termahal
// bermodal Rp200.000, jadi ambang 50.000 memberi rasa aman palsu — alert
// menyala saat saldo 45.000 sementara order 200.000 sudah pasti gagal.
// Ambang di atas modal termahal membuat peringatan datang SEBELUM ada
// pesanan yang tidak bisa dibayar.
const SALDO_THRESHOLD_DEFAULT = 250_000;

export function getSaldoThreshold(): number {
  const rawText = (process.env.WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD ?? "").trim();
  if (!rawText) return SALDO_THRESHOLD_DEFAULT;
  const raw = Number(rawText);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : SALDO_THRESHOLD_DEFAULT;
}

const LOW_SALDO_REPEAT_MS = 6 * 60 * 60 * 1000;
const LOW_SALDO_STEP_IDR = 5000;

/** Policy tetap: kirim ulang hanya bila belum pernah kirim dalam 6 jam, atau
 * saldo TURUN melewati kelipatan Rp5.000. State rusak/kosong = due. */
function lowSaldoDue(raw: string, balance: number, now: number): boolean {
  if (!raw) return true;
  const [lastBalanceStr, lastTsStr] = raw.split("|");
  const lastBalance = Number(lastBalanceStr);
  const lastTs = Number(lastTsStr);
  if (!Number.isFinite(lastBalance) || !Number.isFinite(lastTs)) return true;
  if (lastTs < now - LOW_SALDO_REPEAT_MS) return true;
  return balance <= Math.floor(lastBalance / LOW_SALDO_STEP_IDR) * LOW_SALDO_STEP_IDR - LOW_SALDO_STEP_IDR;
}

/**
 * Alert saldo rendah admin — fail closed. State `wr_sync_state.low_saldo_notified`
 * WAJIB terbaca dan diklaim atomik (CAS) SEBELUM Telegram; error baca/tulis,
 * kalah CAS, atau state dalam masa tenang = tidak kirim. Reservasi tetap
 * dipertahankan walau Telegram gagal/ambigu agar tick berikutnya tidak
 * mengirim ulang salinan.
 */
async function alertLowSaldo(db: DatabaseAccess, balance: number, threshold: number): Promise<void> {
  const adminChatId = (process.env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
  if (!adminChatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return;
  try {
    const row = await db.queryFirst(`SELECT value FROM wr_sync_state WHERE key='low_saldo_notified'`);
    const raw = row ? String(row.value ?? "") : "";
    const now = Date.now();
    if (!lowSaldoDue(raw, balance, now)) return;
    const reserved = await db.execRun(
      `INSERT INTO wr_sync_state (key, value) VALUES ('low_saldo_notified',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
       WHERE COALESCE(wr_sync_state.value,'')=?`,
      `${balance}|${now}`,
      raw,
    );
    if (reserved.changes !== 1) return;
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    return;
  }
  try {
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
  } catch {
    /* best-effort: reservasi tetap dipertahankan */
  }
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
  if (isLow) await alertLowSaldo(db, amount, threshold);
  await db.execRun(
    `INSERT INTO wr_sync_log (sync_type, status, saldo_amount, duration_ms)
     VALUES ('saldo','success',?,0)`,
    amount,
  ).catch(() => undefined);
  return { balance: amount, currency: currency || "IDR", isLow, threshold };
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
