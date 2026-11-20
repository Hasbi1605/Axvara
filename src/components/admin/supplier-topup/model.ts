import { fetchAdminAuth } from "@/lib/admin-auth-fetch";
import type { SupplierTopupStatus, SupplierTopupSupplier } from "@/lib/supplier/topup";

type Currency = "IDR" | "USD" | "USDT";
type BalanceId = SupplierTopupSupplier | "warung" | "aivault" | "storebat" | "mirai" | "pedia";

export const TOPUPS = "/api/admin/supplier-topups";
export const SUPPLIER_NAMES = { sekalipay: "Sekalipay", tunvn: "TUNVN" };
export const BALANCE_CARDS = [
  { id: "warung", name: "Warung Rebahan", path: "warung/saldo", currency: "IDR" },
  { id: "sekalipay", name: SUPPLIER_NAMES.sekalipay, path: "sekalipay/saldo", currency: "IDR" },
  { id: "tunvn", name: SUPPLIER_NAMES.tunvn, path: "tunvn/balance", currency: "USDT" },
  { id: "aivault", name: "AIVault", path: "aivault/balance", currency: "USD" },
  { id: "storebat", name: "StoreBat", path: "storebat/balance", currency: "USD" },
  { id: "mirai", name: "Mirai", path: "mirai/balance", currency: "USDT" },
  { id: "pedia", name: "IndoSMM", path: "pedia/overview", currency: "IDR" },
] as const satisfies ReadonlyArray<{ id: BalanceId; name: string; path: string; currency: Currency }>;

export const STATUS = {
  creating: ["Menunggu", "warning"], pending: ["Menunggu", "warning"], paid: ["Lunas", "success"],
  expired: ["Kedaluwarsa", "warning"], failed: ["Gagal", "destructive"], unknown: ["Perlu dicek", "warning"],
} as const satisfies Record<SupplierTopupStatus, readonly [string, string]>;

const idr = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
// USDT TUNVN memakai exact_amount unik (mis. 10.1234): jangan dibulatkan ke 2 desimal.
const usdt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
export const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

export function money(amount: number | null, currency: Currency) {
  if (amount === null) return "—";
  if (currency === "IDR") return `Rp ${idr.format(amount)}`;
  if (currency === "USD") return usd.format(amount);
  return `${usdt.format(amount)} USDT`;
}

export function httpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export const TOPUP_INACTIVE = "Topup belum aktif untuk supplier ini";
export function actionError(code: string, action: "create" | "refresh") {
  switch (code) {
    case "too_many_pending": return "Masih ada 3 topup menunggu. Selesaikan atau tunggu kedaluwarsa.";
    case "too_soon": return "Tunggu beberapa detik";
    case "sekalipay_unavailable": case "tunvn_unavailable": return TOPUP_INACTIVE;
    case "topup_daily_limit": case "trx_daily_limit": return "Batas topup harian Sekalipay tercapai";
    default: return `${action === "create" ? "Gagal membuat topup" : "Gagal mengecek status"} (${code})`;
  }
}

export async function topupRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchAdminAuth(path, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) {
    const code = data?.error;
    throw new Error(typeof code === "string" && /^[a-z0-9_]{1,100}$/i.test(code) ? code : "request_failed");
  }
  return data;
}

export async function readBalance(card: (typeof BALANCE_CARDS)[number], signal: AbortSignal) {
  type BalanceResponse = { balance?: number | { value?: number | null; stale?: boolean }; current?: { balance?: number }; stale?: boolean };
  const data = await topupRequest<BalanceResponse>(`/api/admin/${card.path}`, { signal });
  const pedia = typeof data.balance === "object" ? data.balance : null;
  const value = card.id === "pedia" ? pedia?.value : card.id === "warung" || card.id === "sekalipay" ? data.current?.balance : data.balance;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("balance_unavailable");
  return { value, stale: data.stale === true || (card.id === "pedia" && pedia?.stale === true) };
}
