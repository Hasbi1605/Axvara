import type { createBudgetedDatabase, DatabaseAccess } from "@/lib/db-access";
import type { CronPhase } from "./phase-state";

// Frozen phase contract: the result object and deferred array are shared, not copied.
export type OperationsContext = Readonly<{
  budget: ReturnType<typeof createBudgetedDatabase>;
  database: DatabaseAccess;
  results: Record<string, unknown>;
  deferredOut: CronPhase[];
  activePhases: ReadonlySet<CronPhase>;
  hasTime: (needMs: number) => boolean;
  timeLeftMs: () => number;
  step: (name: string) => void;
  counts: Readonly<{
    pendingExpiry: number;
    pendingExpiryAny: number;
    pendingExpiryManualWa: number;
    pendingJobs: number;
    pendingStale: number;
    pendingNotify: number;
    pendingCreated: number;
    pendingPaid: number;
    pendingPaidAdmin: number;
    pendingPaidAdminWeb: number;
    pendingPinEmail: number;
    pendingQrisNotice: number;
    pendingStaleWa: number;
    pendingWa: number;
    waWorkPending: number;
    pendingWrAny: number;
    pendingWrDue: number;
    pendingSkAny: number;
    pendingSkDue: number;
  }>;
  flags: Readonly<{
    forcedPhase: CronPhase | null;
    part: "orders" | "sync" | null;
    syncOnly: boolean;
    ordersOnly: boolean;
    wrTablesReady: boolean;
    skTablesReady: boolean;
  }>;
}>;

export function createOperationsContext(input: Omit<OperationsContext, "hasTime">): OperationsContext {
  const { timeLeftMs } = input;
  // Use the route's wall clock, including all time already spent before phase dispatch.
  return { ...input, hasTime: (needMs) => timeLeftMs() >= needMs };
}

// Keep insertion order: later response fields are appended by the route and phases.
export function createOperationsResults(): OperationsContext["results"] {
  return {
    stale_initializing: 0,
    expired_payments: 0,
    repaired_legacy_expiry: 0,
    due_jobs_processed: 0,
    fulfillment_items_backfilled: 0,
    fulfillment_orphans_healed: 0,
    stale_locks_released: 0,
    expired_manual_whatsapp_orders: 0,
    telegram_order_notifications_retried: 0,
    telegram_paid_notifications_retried: 0,
    telegram_paid_admin_notifications_retried: 0,
    telegram_invoice_retried: 0,
    telegram_pending_reminders_sent: 0,
    whatsapp_outbox_sent: 0,
    whatsapp_outbox_dead: 0,
    whatsapp_outbox_recovered: 0,
    whatsapp_outbox_claim_errors: 0,
    whatsapp_outbox_paused: 0,
    whatsapp_rows_cleaned: 0,
    wr_products_synced: 0,
    // Observability sync (issue wr-sync-observability, 2026-09-19): alasan
    // skip sweep dilaporkan jujur — tanpa ini `synced:0 + skipped:null`
    // ambigu untuk 4 kondisi berbeda (fase tak aktif / interval belum tempo /
    // switch mati / tabel belum siap) dan gap 3 jam tak terlihat. Nilai:
    // "disabled" | "phase_inactive" | "interval" | "sync_disabled" |
    // "budget_yielded" | "attempted_failed" | "deadline" | "query_budget".
    wr_sync_skipped: null as string | null,
    // `created_at` sweep products terakhir (atau null) — respons tunggal
    // cukup untuk diagnosa tanpa query D1 tambahan.
    wr_last_sync_at: null as string | null,
    wr_orders_processed: 0,
    wr_orders_succeeded: 0,
    wr_saldo_balance: null as number | null,
    wr_saldo_low: false,
    sk_products_synced: 0,
    // Observability SK cermin WR (0049): nilai skipped yang sama.
    sk_sync_skipped: null as string | null,
    sk_last_sync_at: null as string | null,
    sk_orders_processed: 0,
    sk_orders_succeeded: 0,
    sk_saldo_balance: null as number | null,
    sk_saldo_low: false,
  };
}
