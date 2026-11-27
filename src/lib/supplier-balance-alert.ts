import { QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { sanitizeSyncError } from "@/lib/sync-status";

export type SupplierBalanceKey = "tunvn" | "aivault" | "storebat" | "mirai" | "pixelverif";

export interface CheckSupplierLowBalanceOptions {
  supplier: SupplierBalanceKey;
  label: string;
  fetchBalance: () => Promise<number | null>;
  threshold: number;
  step: number;
  format: (n: number) => string;
  now?: number;
}

export interface SupplierBalanceCheckResult {
  checked: boolean;
  balance?: number;
  alerted?: boolean;
  error?: string;
}

export const SUPPLIER_BALANCE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const SUPPLIER_BALANCE_ALERT_STEP_DEFAULT = 2;
export const TUNVN_BALANCE_ALERT_USDT_DEFAULT = 5;
export const AIVAULT_BALANCE_ALERT_USD_DEFAULT = 5;
export const STOREBAT_BALANCE_ALERT_USD_DEFAULT = 5;
export const MIRAI_BALANCE_ALERT_USDT_DEFAULT = 5;

export function parseBalanceThreshold(rawValue: string | undefined, fallback: number): number {
  const text = (rawValue ?? "").trim();
  if (!text) return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function tunvnBalanceAlertThreshold(): number {
  return parseBalanceThreshold(process.env.TUNVN_BALANCE_ALERT_USDT, TUNVN_BALANCE_ALERT_USDT_DEFAULT);
}

export function aivaultBalanceAlertThreshold(): number {
  return parseBalanceThreshold(process.env.AIVAULT_BALANCE_ALERT_USD, AIVAULT_BALANCE_ALERT_USD_DEFAULT);
}

export function storebatBalanceAlertThreshold(): number {
  return parseBalanceThreshold(process.env.STOREBAT_BALANCE_ALERT_USD, STOREBAT_BALANCE_ALERT_USD_DEFAULT);
}

export function miraiBalanceAlertThreshold(): number {
  return parseBalanceThreshold(process.env.MIRAI_BALANCE_ALERT_USDT, MIRAI_BALANCE_ALERT_USDT_DEFAULT);
}

export const PIXELVERIF_BALANCE_ALERT_CREDITS_DEFAULT = 5;

export function pixelverifBalanceAlertThreshold(): number {
  return parseBalanceThreshold(process.env.PIXELVERIF_BALANCE_ALERT_CREDITS, PIXELVERIF_BALANCE_ALERT_CREDITS_DEFAULT);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const formatUsdt = (n: number): string => `${formatNumber(n)} USDT`;
const formatUsd = (n: number): string => `$${formatNumber(n)}`;

/**
 * Cek saldo supplier secara bounded (<= 5 statement D1 per run) dengan
 * checkpoint 5 menit sebelum panggilan API. Alert Telegram dikirim sekali
 * saat pertama turun di bawah ambang (tidak mengulang bila saldo stagnan),
 * lalu berbunyi lagi hanya jika saldo turun >= step atau setelah pulih
 * (>= ambang, marker direset otomatis) lalu menipis kembali — via CAS store_settings.
 */
export async function checkSupplierLowBalance(
  db: DatabaseAccess,
  opts: CheckSupplierLowBalanceOptions,
): Promise<SupplierBalanceCheckResult> {
  if (!db) return { checked: false, error: "db_unavailable" };

  const now = opts.now ?? Date.now();
  const checkedKey = `${opts.supplier}_balance_checked_at`;
  const errorKey = `${opts.supplier}_balance_error`;
  const lastOkKey = `${opts.supplier}_balance_last_ok_at`;
  const alertKey = `${opts.supplier}_balance_alert_at`;
  const { parseExpiry } = await import("@/lib/expiry");

  const settingsRows = await db.queryAll(
    `SELECT key, value FROM store_settings WHERE key IN (?, ?, ?)`,
    checkedKey,
    errorKey,
    alertKey,
  );
  const lastRaw = settingsRows.find((r) => r.key === checkedKey)?.value;
  const lastCheckedMs = parseExpiry(lastRaw);
  if (lastCheckedMs !== null && now - lastCheckedMs < SUPPLIER_BALANCE_CHECK_INTERVAL_MS) {
    return { checked: false };
  }
  const prevAlertRaw = String(settingsRows.find((r) => r.key === alertKey)?.value ?? "").trim();
  let prevStreak = 0;
  const prevErrRaw = settingsRows.find((r) => r.key === errorKey)?.value;
  if (typeof prevErrRaw === "string" && prevErrRaw.trim()) {
    try {
      const parsed = JSON.parse(prevErrRaw) as { streak?: unknown };
      if (Number.isInteger(parsed?.streak) && Number(parsed.streak) > 0) {
        prevStreak = Number(parsed.streak);
      }
    } catch {
      prevStreak = 1;
    }
  }

  // Tulis checkpoint sebelum panggilan API agar upstream lambat/gagal tidak dipukul tiap menit.
  await db.execRun(
    `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
    checkedKey,
    new Date(now).toISOString(),
  );

  const recordBalanceFailure = async (errMsg: string) => {
    if (!db.canSpend(1)) return;
    await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
      errorKey,
      JSON.stringify({
        at: new Date(now).toISOString(),
        error: sanitizeSyncError(errMsg),
        streak: prevStreak + 1,
      }),
    ).catch(() => undefined);
  };

  let balance: number | null;
  try {
    balance = await opts.fetchBalance();
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    const errMsg = error instanceof Error && error.message ? error.message.slice(0, 60) : "balance_failed";
    await recordBalanceFailure(errMsg);
    return {
      checked: true,
      alerted: false,
      error: errMsg,
    };
  }

  if (balance === null || !Number.isFinite(balance) || balance < 0) {
    await recordBalanceFailure("balance_unavailable");
    return { checked: true, alerted: false, error: "balance_unavailable" };
  }

  // Sukses fetch: simpan timestamp sukses terakhir, nilai terakhir, + kosongkan error/streak (1 statement).
  // Bila saldo pulih (>= ambang) sesudah sempat rendah, sekalian reset marker alert agar episode berikutnya tetap mengabari.
  const lastValueKey = `${opts.supplier}_balance_last_value`;
  const clearRecoveredAlert = !(balance < opts.threshold) && prevAlertRaw !== "";
  if (clearRecoveredAlert) {
    await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now')), (?, '', datetime('now')), (?, ?, datetime('now')), (?, '', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
      lastOkKey,
      String(now),
      errorKey,
      lastValueKey,
      String(balance),
      alertKey,
    );
  } else {
    await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now')), (?, '', datetime('now')), (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
      lastOkKey,
      String(now),
      errorKey,
      lastValueKey,
      String(balance),
    );
  }

  if (!(balance < opts.threshold)) {
    return { checked: true, balance, alerted: false };
  }

  const chatId = (process.env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
  if (!chatId || process.env.TELEGRAM_BOT_ENABLED !== "true") {
    return { checked: true, balance, alerted: false };
  }

  try {
    const row = await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, alertKey);
    const raw = row ? String(row.value ?? "") : "";
    const claim = (value: string) =>
      db.execRun(
        `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
         WHERE COALESCE(store_settings.value, '')=?`,
        alertKey,
        value,
        raw,
      );

    let lastBalance = NaN;
    let lastMs = parseExpiry(raw) ?? NaN;
    if (raw.includes("|")) {
      const [b, t] = raw.split("|");
      lastBalance = Number(b);
      lastMs = Number(t);
    }

    if (Number.isFinite(lastMs)) {
      if (!Number.isFinite(lastBalance)) {
        await claim(`${balance}|${lastMs}`);
        return { checked: true, balance, alerted: false };
      }
      const droppedEnough = opts.step > 0 && lastBalance - balance >= opts.step - 1e-9;
      if (!droppedEnough) {
        return { checked: true, balance, alerted: false };
      }
    }

    const reserved = await claim(`${balance}|${now}`);
    if (reserved.changes !== 1) {
      return { checked: true, balance, alerted: false };
    }
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    return { checked: true, balance, alerted: false };
  }

  const label = escapeHtml(opts.label);
  const { sendMessage } = await import("@/lib/telegram/api");
  const result = await sendMessage({
    chat_id: chatId,
    text: `💰 <b>Saldo ${label} menipis</b>\nSisa ${escapeHtml(opts.format(balance))} (ambang ${escapeHtml(opts.format(opts.threshold))}). Top up agar auto-order ${label} tidak tertahan.`,
    parse_mode: "HTML",
  }).catch(() => null);

  return { checked: true, balance, alerted: result?.ok === true };
}

export async function checkTunvnLowBalance(
  db: DatabaseAccess,
  now?: number,
): Promise<SupplierBalanceCheckResult> {
  const { isTunvnConfigured, fetchTunvnBalance } = await import("@/lib/tunvn/client");
  if (!isTunvnConfigured()) return { checked: false };
  return checkSupplierLowBalance(db, {
    supplier: "tunvn",
    label: "TUNVN",
    fetchBalance: async () => {
      const res = await fetchTunvnBalance();
      if (res.kind !== "ok") throw new Error(res.kind);
      return res.balance_usdt;
    },
    threshold: tunvnBalanceAlertThreshold(),
    step: SUPPLIER_BALANCE_ALERT_STEP_DEFAULT,
    format: formatUsdt,
    now,
  });
}

export async function checkAivaultLowBalance(
  db: DatabaseAccess,
  now?: number,
): Promise<SupplierBalanceCheckResult> {
  const { isAivaultConfigured, fetchAivaultBalance, parseAivaultBalance } = await import("@/lib/aivault/client");
  if (!isAivaultConfigured()) return { checked: false };
  return checkSupplierLowBalance(db, {
    supplier: "aivault",
    label: "AIVault",
    fetchBalance: async () => {
      const res = await fetchAivaultBalance();
      if (res.kind !== "ok") throw new Error(res.kind);
      const parsed = parseAivaultBalance(res.json);
      if (!parsed) throw new Error("balance_shape");
      return parsed.balance;
    },
    threshold: aivaultBalanceAlertThreshold(),
    step: SUPPLIER_BALANCE_ALERT_STEP_DEFAULT,
    format: formatUsd,
    now,
  });
}

export async function checkStorebatLowBalance(
  db: DatabaseAccess,
  now?: number,
): Promise<SupplierBalanceCheckResult> {
  const { isStorebatConfigured, fetchStorebatBalance, parseStorebatBalance } = await import("@/lib/storebat/client");
  if (!isStorebatConfigured()) return { checked: false };
  return checkSupplierLowBalance(db, {
    supplier: "storebat",
    label: "StoreBat",
    fetchBalance: async () => {
      const res = await fetchStorebatBalance();
      if (res.kind !== "ok") throw new Error(res.kind);
      const parsed = parseStorebatBalance(res.json);
      if (!parsed) throw new Error("balance_shape");
      return parsed.balance;
    },
    threshold: storebatBalanceAlertThreshold(),
    step: SUPPLIER_BALANCE_ALERT_STEP_DEFAULT,
    format: formatUsd,
    now,
  });
}

export async function checkMiraiLowBalance(
  db: DatabaseAccess,
  now?: number,
): Promise<SupplierBalanceCheckResult> {
  const { checkMiraiLowBalance: run } = await import("@/lib/mirai/balance");
  return run(db, now);
}

export async function checkPixelverifLowBalance(
  db: DatabaseAccess,
  now?: number,
): Promise<SupplierBalanceCheckResult> {
  const { checkPixelverifLowBalance: run } = await import("@/lib/pixelverif/balance");
  return run(db, now);
}
