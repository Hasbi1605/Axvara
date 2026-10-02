// src/lib/sekalipay/saldo.ts — Monitor saldo Sekalipay + throttle notif admin.
// Cermin WR saldo.ts (check + log + alert ambang default Rp250.000) +
// MUTASI SALDO khas SK (GET /v1/balance/mutations) yang tidak dimiliki WR:
// audit credit/debit + balance_before/after per invoice.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { fetchSkBalance, fetchSkBalanceMutations, isSkEnabled, type SkBalanceMutation } from "./client";

export function skSaldoAlertThreshold(): number {
  const raw = Number(process.env.SEKALIPAY_SALDO_ALERT_THRESHOLD ?? 250000);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 250000;
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
  if (isLow) {
    // Throttle anti-spam 1:1 WR (2026-10-03, sesi ses_f029e — SK spam 24x/hari
    // vs WR 4x/hari karena throttle SK cuma 1 jam + state di sk_saldo_log yang
    // CHECK-constraint source-nya rapuh). State di sk_sync_state
    // (key='low_saldo_notified', format 'amount|timestamp_ms', tabel sudah ada
    // dari migrasi 0049) agar survive restart/isolate. Kirim ulang hanya bila
    // (a) belum pernah kirim dalam 6 jam terakhir, atau (b) saldo TURUN
    // melewati kelipatan Rp5.000. Threshold + gate cek 1x/jam di cron TIDAK
    // berubah — yang diubah hanya gate NOTIF-nya.
    const shouldNotify = await db.queryFirst(
      `SELECT value FROM sk_sync_state WHERE key='low_saldo_notified'`,
    ).then((row) => {
      const value = (row as { value?: unknown } | null)?.value;
      if (value == null || String(value) === "") return true;
      const [lastBalanceStr, lastTsStr] = String(value).split("|");
      const lastBalance = Number(lastBalanceStr);
      const lastTs = Number(lastTsStr);
      if (!Number.isFinite(lastBalance) || !Number.isFinite(lastTs)) return true;
      if (lastTs < Date.now() - 6 * 60 * 60 * 1000) return true;
      return balance <= Math.floor(lastBalance / 5000) * 5000 - 5000;
    }).catch(() => true);
    if (shouldNotify) {
      await db
        .execRun(`INSERT INTO sk_saldo_log (balance, source, note) VALUES (?,'low_alert',?)`, balance, `threshold ${threshold}`)
        .catch(() => undefined);
      await db
        .execRun(`INSERT INTO sk_sync_state (key, value) VALUES ('low_saldo_notified',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
        `${balance}|${Date.now()}`,
        )
        .catch(() => undefined);
      const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
      if (adminChatId && process.env.TELEGRAM_BOT_ENABLED === "true") {
        try {
          const { sendMessage } = await import("@/lib/telegram/api");
          await sendMessage({
            chat_id: adminChatId,
            text: `💰 <b>Saldo Sekalipay menipis</b>\nSisa Rp${balance.toLocaleString("id-ID")} (ambang Rp${threshold.toLocaleString("id-ID")}). Top up agar auto-order SK tidak tertahan.`,
            parse_mode: "HTML",
          });
        } catch {
          /* best-effort */
        }
      }
    }
  }
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

/**
 * Mutasi saldo SK untuk audit (fitur khas SK — WR tidak punya endpoint ini).
 * Langsung dari API (bukan DB lokal) agar jejak kredit/debit + before/after
 * per invoice selalu segar. Gagal API = [] (panel tetap menampilkan saldo).
 */
export async function getSkBalanceMutations(params?: {
  page?: number;
  perPage?: number;
  direction?: "credit" | "debit";
  type?: string;
}): Promise<{ mutations: SkBalanceMutation[]; meta: Record<string, unknown> }> {
  try {
    const res = await fetchSkBalanceMutations({
      page: params?.page ?? 1,
      perPage: Math.max(1, Math.min(params?.perPage ?? 10, 100)),
      direction: params?.direction,
      type: params?.type,
    });
    return { mutations: Array.isArray(res.data) ? res.data : [], meta: res.meta ?? {} };
  } catch {
    return { mutations: [], meta: {} };
  }
}
