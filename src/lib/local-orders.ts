// src/lib/local-orders.ts — Salinan lokal pesanan yang dibuat di perangkat ini
// (`localStorage["axvara-orders"]`, ditulis checkout TANPA WA/email).
//
// Dipakai pengingat "pesanan belum dibayar", titik penanda tab Pesanan di
// bottom nav, dan daftar "Pesanan di perangkat ini" di /lacak-pesanan. Status
// lokal hanya petunjuk: status sebenarnya selalu dari `GET /api/orders?code=`,
// lalu dicatat balik lewat settleLocalOrder agar tidak dicek ulang.

export const LOCAL_ORDERS_KEY = "axvara-orders";
/** Event di tab yang sama; event `storage` hanya menyala di tab lain. */
export const LOCAL_ORDERS_EVENT = "axvara-orders-changed";
/** Order QRIS mati paling lambat 60 menit setelah dibuat; sisanya cadangan jam perangkat. */
export const PENDING_MAX_AGE_MS = 75 * 60_000;

export type LocalOrder = {
  code?: string;
  status?: string;
  createdAt?: string;
  items?: { name?: string; price?: number; qty?: number }[];
  subtotal?: number;
  method?: string;
};

export function readLocalOrders(): LocalOrder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_ORDERS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((o) => o && typeof o === "object") : [];
  } catch {
    return [];
  }
}

function writeLocalOrders(next: LocalOrder[]) {
  try {
    localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(LOCAL_ORDERS_EVENT));
  } catch { /* storage penuh/diblokir: tampilan cukup memakai data server */ }
}

/** Catat status akhir dari server ke salinan lokal. */
export function settleLocalOrder(code: string, status: string) {
  const list = readLocalOrders();
  const current = list.find((o) => o.code === code);
  if (!current || current.status === (status || "closed")) return;
  writeLocalOrders(list.map((o) => (o.code === code ? { ...o, status: status || "closed" } : o)));
}

export function removeLocalOrder(code: string) {
  writeLocalOrders(readLocalOrders().filter((o) => o.code !== code));
}

/** Pesanan lokal berstatus pending yang masih mungkin hidup, terbaru dulu. */
export function freshPendingCodes(now: number, exclude: Set<string> = new Set()): string[] {
  return readLocalOrders()
    .filter((o) => o.code && o.status === "pending" && !exclude.has(String(o.code)))
    .map((o) => ({ code: String(o.code), created: Date.parse(String(o.createdAt || "")) }))
    .filter((o) => Number.isFinite(o.created) && now - o.created < PENDING_MAX_AGE_MS)
    .sort((a, b) => b.created - a.created)
    .map((o) => o.code);
}
