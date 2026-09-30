// src/components/admin/SupplierPairsManager.tsx — Tab "WR vs SK".
// Pemetaan pasangan + pemenang otomatis (keputusan owner 2026-09-30):
// produk yang sama di dua supplier dipilih OTOMATIS mana yang tampil
// (stok dulu, modal kemudian), bukan manual.
//
// Admin di sini: lihat 28 pasangan + pemenang + alasan, atur prefer
// (auto/WR/SK + margin), hitung ulang manual. Pembeli tidak pernah
// melihat tab ini — mereka hanya melihat pemenangnya di katalog.

"use client";

import { useCallback, useEffect, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/ui/IosIcon";
import { useToast } from "@/components/ui/Toast";

type PairRow = {
  id: number;
  wr_product_id: number;
  wr_name: string;
  wr_stock: number;
  wr_modal: number | null;
  wr_active: boolean;
  sk_product_id: number;
  sk_name: string;
  sk_stock: number;
  sk_modal: number | null;
  sk_active: boolean;
  winner: "WR" | "SK" | null;
  prefer: "auto" | "WR" | "SK";
  prefer_margin: number;
  decided_at: string | null;
  reason: string | null;
};

export function SupplierPairsManager() {
  const toast = useToast();
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/supplier-pairs", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat pasangan");
      setPairs(body.pairs || []);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat pasangan");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const decideAll = async () => {
    setDeciding(true);
    try {
      const res = await fetch("/api/admin/supplier-pairs/decide", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menghitung");
      toast.success(`Pemenang dihitung: ${body.decided} pasangan, ${body.changed} berubah.`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menghitung");
    } finally {
      setDeciding(false);
    }
  };

  const savePrefer = async (pair: PairRow, prefer: string, margin: number) => {
    setSaving(pair.id);
    try {
      const res = await fetch("/api/admin/supplier-pairs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pair.id, prefer, prefer_margin: margin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menyimpan");
      toast.success("Preferensi disimpan + pemenang dihitung ulang.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menyimpan");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <section className="ax-glass overflow-hidden rounded-[20px]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Pemenang otomatis WR vs SK</h2>
            <p className="mt-0.5 text-xs text-white/40">
              Stok dulu, modal kemudian. Dihitung ulang tiap sweep cron dari data live.
              Pecundang + produk habis disembunyikan dari katalog publik (tetap ada di admin).
            </p>
          </div>
          <button onClick={() => void decideAll()} disabled={deciding || loading} className="ml-auto inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
            {deciding ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="black" />} Hitung ulang
          </button>
        </header>
        {loading ? (
          <p className="p-10 text-center text-sm text-white/40">Memuat pasangan…</p>
        ) : !pairs.length ? (
          <p className="p-10 text-center text-sm text-white/40">Belum ada pasangan.</p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {pairs.map((pair) => (
              <PairCard key={pair.id} pair={pair} saving={saving === pair.id} onSave={savePrefer} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PairCard({ pair, saving, onSave }: {
  pair: PairRow;
  saving: boolean;
  onSave: (pair: PairRow, prefer: string, margin: number) => void;
}) {
  const [prefer, setPrefer] = useState<"auto" | "WR" | "SK">(pair.prefer);
  const [margin, setMargin] = useState(String(pair.prefer_margin));
  const winnerLabel = pair.winner == null
    ? "Belum ada pemenang"
    : pair.winner === "WR" ? `🏆 ${pair.wr_name} (WR)` : `🏆 ${pair.sk_name} (SK)`;
  return (
    <article className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${pair.winner === "WR" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/[0.04] text-white/45"}`}>
            WR · stok {pair.wr_stock}{pair.wr_modal != null ? ` · modal ${formatRupiah(pair.wr_modal)}` : ""}{pair.wr_active ? "" : " · nonaktif"}
          </span>
          <span className="text-[11px] text-white/60">{pair.wr_name}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${pair.winner === "SK" ? "border-[#00E5FF]/30 bg-[#00E5FF]/10 text-[#5cefff]" : "border-white/10 bg-white/[0.04] text-white/45"}`}>
            SK · stok {pair.sk_stock}{pair.sk_modal != null ? ` · modal ${formatRupiah(pair.sk_modal)}` : ""}{pair.sk_active ? "" : " · nonaktif"}
          </span>
          <span className="text-[11px] text-white/60">{pair.sk_name}</span>
        </div>
        <p className="mt-1.5 text-xs font-semibold text-white">{winnerLabel}</p>
        {pair.reason && <p className="mt-0.5 font-mono text-[10px] text-white/35">{pair.reason}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <select value={prefer} onChange={(e) => setPrefer(e.target.value as "auto" | "WR" | "SK")} aria-label="Preferensi kualitas" title="Preferensi kualitas (mengalahkan selisih modal kecil)" className="h-9 rounded-lg border border-white/10 bg-black/20 px-2 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none">
          <option value="auto">Auto</option>
          <option value="WR">Utamakan WR</option>
          <option value="SK">Utamakan SK</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-white/55">±Rp<input value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="numeric" className="h-9 w-24 rounded-lg border border-white/10 bg-black/20 px-2 text-right text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none" /></label>
        <button onClick={() => onSave(pair, prefer, Math.max(0, Math.floor(Number(margin) || 0)))} disabled={saving} className="inline-flex h-9 items-center rounded-xl bg-white px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-white/90 disabled:opacity-40">
          {saving ? <Spinner size={13} /> : "Simpan"}
        </button>
      </div>
    </article>
  );
}
