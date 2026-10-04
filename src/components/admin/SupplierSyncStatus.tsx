"use client";

// Isi kartu "Sync terakhir" WR/SK (2026-10-04). Sejak diff VPS aktif ada
// dua jalur sync otomatis: diff tiap 3 menit (hanya yang berubah, tercatat di
// state — bukan *_sync_log) dan sweep penuh berpotongan (pengaman 60 menit,
// tercatat di *_sync_log per potongan). Kartu menampilkan keduanya terpisah
// agar delta 1 varian / heartbeat 0/0 tidak terbaca sebagai sync penuh.

import { formatWibDateTime } from "@/lib/utils";

export type SupplierSyncLogRow = {
  sync_type: string;
  status: string;
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

export function SupplierSyncStatus({
  logs,
  diff,
  excludedLabel,
}: {
  logs: SupplierSyncLogRow[];
  diff: SupplierDiffStatus;
  excludedLabel: string;
}) {
  const products = logs.filter((l) => l.sync_type === "products");
  const lastManual = products.find((l) => l.trigger !== "cron") ?? null;
  const lastSweep = products.find((l) => l.trigger === "cron") ?? null;
  const diffKnown = Boolean(diff?.last_at);
  const errorRecent = diff?.last_error?.at && diff.last_at && diff.last_error.at >= diff.last_at;

  return (
    <>
      {diffKnown ? (
        <>
          <p className={`mt-1 text-sm font-semibold ${diff?.healthy ? "text-white" : "text-amber-300"}`}>
            {diff?.healthy ? "Diff VPS aktif" : "Diff VPS berhenti"} · cek {fmt(diff?.last_at)}
          </p>
          <p className="mt-1 text-[11px] text-white/40">
            {diff?.last_change_at
              ? `Perubahan terakhir ${fmt(diff.last_change_at)} · ${describeDiffChange(diff.last_change)}`
              : "Belum ada perubahan sejak diff aktif."}
          </p>
          {!diff?.healthy && (
            <p className="mt-1 text-[11px] text-amber-300/80">Sync penuh otomatis kembali tiap 15 menit.</p>
          )}
          {errorRecent && <p className="mt-1 text-[11px] text-red-300">Error diff: {diff?.last_error?.error}</p>}
        </>
      ) : lastSweep || lastManual ? (
        <>
          <p className="mt-1 text-sm font-semibold text-white">{(lastSweep ?? lastManual)!.status} · {fmt((lastSweep ?? lastManual)!.created_at)}</p>
          <p className="mt-1 text-[11px] text-white/40">Diff VPS belum aktif — sync penuh tiap 15 menit.</p>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm font-semibold text-white">Belum pernah</p>
          <p className="mt-1 text-[11px] text-white/40">Tekan Force Sync untuk sync pertama.</p>
        </>
      )}
      {(lastManual || lastSweep) && (
        <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[11px] text-white/40">
          <p>
            🟢 Sync penuh: {lastSweep
              ? `${lastSweep.status} · ${fmt(lastSweep.created_at)} · ${lastSweep.products_total ?? lastSweep.products_synced ?? 0} produk`
              : "—"}
            {diff?.healthy ? " (cadangan tiap 60 mnt)" : ""}
          </p>
          <p>
            🔵 Manual: {lastManual
              ? `${lastManual.status} · ${fmt(lastManual.created_at)} · ${lastManual.products_synced ?? 0}p/${lastManual.variants_synced ?? 0}v · ${lastManual.products_excluded ?? 0} ${excludedLabel}`
              : "—"}
          </p>
        </div>
      )}
    </>
  );
}
