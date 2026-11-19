"use client";

// Isi kartu "Sync terakhir" WR/SK (2026-10-04). Sejak diff VPS aktif ada
// dua jalur sync otomatis: diff tiap 3 menit (hanya yang berubah, tercatat di
// state — bukan *_sync_log) dan sweep penuh berpotongan (pengaman 60 menit,
// tercatat di *_sync_log per potongan). Kartu menampilkan keduanya terpisah
// agar delta 1 varian / heartbeat 0/0 tidak terbaca sebagai sync penuh.

import { formatWibDateTime } from "@/lib/utils";

const syncStatusLabel = {
  success: "Berhasil",
  partial: "Sebagian berhasil",
  failed: "Gagal",
};

export type SupplierSyncLogRow = {
  sync_type: string;
  status: keyof typeof syncStatusLabel;
  products_total: number | null;
  products_synced: number | null;
  variants_synced: number | null;
  products_excluded: number | null;
  trigger?: string;
  created_at: string;
};

export type SupplierDiffStatus = {
  last_at: string | null;
  healthy: boolean;
  last_change_at: string | null;
  last_change: { products?: number; variants?: number; stock?: number; price?: number; removed?: number } | null;
  last_error: { at?: string; error?: string } | null;
  full_sweep_at: string | null;
} | null;

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return formatWibDateTime(value, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) ?? String(value);
}

export function describeDiffChange(change: NonNullable<SupplierDiffStatus>["last_change"]): string {
  if (!change) return "";
  const parts = [`${change.variants ?? 0} varian`];
  const detail: string[] = [];
  if (change.stock) detail.push(`${change.stock} stok`);
  if (change.price) detail.push(`${change.price} harga`);
  if (change.removed) detail.push(`${change.removed} dihapus supplier`);
  if (detail.length) parts.push(`(${detail.join(", ")})`);
  return parts.join(" ");
}

/** Satu baris ringkas untuk StatCard "Sinkron terakhir" (WR/SK & TUNVN). */
export function syncCompactValue(logs: SupplierSyncLogRow[], diff: SupplierDiffStatus): string {
  if (diff?.last_at) return fmt(diff.last_at);
  const products = logs.filter((l) => l.sync_type === "products");
  const row = products.find((l) => l.trigger === "cron") ?? products[0];
  return row ? fmt(row.created_at) : "Belum pernah";
}

export function SupplierSyncStatus({
  logs,
  diff,
  excludedLabel,
  loading = false,
}: {
  logs: SupplierSyncLogRow[];
  diff: SupplierDiffStatus;
  excludedLabel: string;
  /** D6: selama sync-log dimuat, jangan tampilkan "Belum pernah"/status tebakan. */
  loading?: boolean;
}) {
  const products = logs.filter((l) => l.sync_type === "products");
  const lastManual = products.find((l) => l.trigger !== "cron") ?? null;
  const lastSweep = products.find((l) => l.trigger === "cron") ?? null;
  const diffKnown = Boolean(diff?.last_at);
  const errorRecent = diff?.last_error?.at && diff.last_at && diff.last_error.at >= diff.last_at;

  if (loading) return <p role="status" className="mt-1 text-sm font-semibold text-admin-muted">Memuat status sinkron…</p>;
  return (
    <>
      {diffKnown ? (
        <>
          <p className={`mt-1 text-sm font-semibold tabular-nums ${diff?.healthy ? "text-admin-fg" : "text-admin-warning"}`}>
            {diff?.healthy ? "Diff VPS aktif" : "Diff VPS berhenti"}
          </p>
          {diff?.last_change_at && <p className="mt-1 text-xs text-admin-muted">
            Perubahan terakhir {fmt(diff.last_change_at)} · {describeDiffChange(diff.last_change)}
          </p>}
          {!diff?.healthy && (
            <p className="mt-1 text-xs text-admin-warning">Sinkron penuh berjalan tiap 15 menit.</p>
          )}
          {errorRecent && <p className="mt-1 text-xs text-admin-danger">Error diff: {diff?.last_error?.error}</p>}
        </>
      ) : (
        <>
          <p className="mt-1 text-sm font-semibold text-admin-fg">Sinkron katalog</p>
          {(lastSweep || lastManual) && <p className="mt-1 text-xs text-admin-muted">Diff VPS belum aktif. Sinkron penuh tiap 15 menit.</p>}
        </>
      )}
      {(lastManual || lastSweep) && (
        <div className="mt-2 space-y-1 border-t border-admin-border pt-2 text-xs text-admin-muted">
          {lastSweep && <p>
            Sinkron penuh · {syncStatusLabel[lastSweep.status] ?? lastSweep.status} · {fmt(lastSweep.created_at)} · {lastSweep.products_total ?? lastSweep.products_synced ?? 0} produk
          </p>}
          {lastManual && <p>
            Manual · {syncStatusLabel[lastManual.status] ?? lastManual.status} · {fmt(lastManual.created_at)} · {lastManual.products_synced ?? 0} produk / {lastManual.variants_synced ?? 0} varian · {lastManual.products_excluded ?? 0} {excludedLabel}
          </p>}
        </div>
      )}
    </>
  );
}
