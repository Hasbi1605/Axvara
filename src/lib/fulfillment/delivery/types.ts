// src/lib/fulfillment/delivery/types.ts — Tipe, konstanta, dan state bersama outbox.
//
// MENGAPA dipisah: seluruh modul delivery (claim, send, process, reconcile,
// handover) berbagi kontrak tipe yang sama (Row, JobUnitResult,
// ManualHandoverResult, dst) dan konstanta jadwal retry/budget. Menaruhnya di
// satu modul netral tanpa dependensi ke logika lain mencegah import melingkar
// antar file yang dipecah dan menjadikan "kamus" kontrak yang dibaca semua
// bagian. NOL perubahan perilaku: nilai dan bentuk tipe identik dengan asal.

export type Row = Record<string, unknown>;

export type FulfillmentOrderItem = {
  product_id: number;
  variant_id?: number | null;
  qty?: number | null;
  fulfillment_mode?: unknown;
};

export type FulfillmentRecipient = {
  channel: "web" | "telegram" | "whatsapp";
  target: string;
};

// In-memory fallback for dev
export function getJobsMem(): Row[] {
  const g = process as unknown as { __AXVARA_FULFILLMENT_JOBS?: Row[] };
  if (!g.__AXVARA_FULFILLMENT_JOBS) g.__AXVARA_FULFILLMENT_JOBS = [];
  return g.__AXVARA_FULFILLMENT_JOBS;
}

// Retry schedule in minutes
export const RETRY_DELAYS = [1, 5, 15, 60];
export const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

/**
 * Hasil mutasi job berpagar (RR4-05): bukan void buta, melainkan status
 * yang menyatakan apakah worker masih berwenang dan transisi mana yang
 * terjadi. Pemanggil WAJIB memakai hasil ini sebelum menyentuh agregat
 * order — jeda antara mutasi job dan agregasi harus diproteksi ulang.
 */
export type FencedJobMutation =
  | { owned: true; transition: "retry" | "failed" }
  | { owned: false };

/** Conservative admission reserve for item claims, inventory repair, retries,
 * cursor writes and settlement. The scoped database enforces the actual cap. */
export const COST_PER_DELIVERY_ITEM = 12;
/** Claim/read plus final reconciliation, including the atomic outcome batch. */
export const COST_PER_JOB_FRAME = 6;

/**
 * Hasil pemrosesan per-item (RR4-01): berapa item yang selesai diupayakan,
 * apakah masih ada sisa, dan apakah worker masih pemilik.
 */
export type JobUnitResult =
  | { done: true; attempted: number; finished: boolean }
  | { done: false; reason: "not_owned" | "not_paid" | "no_work" | "item_failed" | "budget_yield"; attempted: number; finished: boolean };

export const COST_PER_ORPHAN_LIGHT = 3;

/**
 * Hasil handover yang jujur (RR3-02/07): bukan boolean buta, melainkan
 * status yang membedakan "item tercatat" dari "seluruh order tuntas" dan
 * dari "manifest belum lengkap".
 *
 * RR4-03: tambah `reconcile_failed` — item sudah delivered tetapi penulisan
 * lanjutan (agregat/audit) masih gagal SETELAH dicoba ulang. Cabang
 * delivered dan kalah-CAS WAJIB mempropagasi ini (bukan void healed).
 */
export type ManualHandoverResult =
  | { ok: true; complete: boolean }
  | { ok: false; reason: "not_found" | "not_paid" | "bad_state" | "incomplete_manifest" | "storage_error" | "reconcile_failed" };

export type FulfillmentLineMismatch = { index: number; kind: "missing" | "identity" | "quantity" | "unexpected"; expectedQty: number; actualQty: number };
