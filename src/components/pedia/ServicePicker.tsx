"use client";

// src/components/pedia/ServicePicker.tsx — Daftar layanan terkurasi per produk
// (rebuild 2026-10-14): rekomendasi tampil utama, sisanya dibuka bertahap,
// dengan filter wilayah/garansi/kualitas + urutan. Nama & chip memakai
// bahasa manusia (atribut kurasi 0062), bukan nama mentah supplier.

import { useMemo, useState } from "react";
import type { PediaCatalogProduct, PediaCatalogTier } from "@/app/api/pedia/catalog/route";

const rupiah = (v: number) => `Rp${v.toLocaleString("id-ID")}`;

const REGION_LABEL: Record<string, string> = { indonesia: "Indonesia", global: "Global", mixed: "Campuran" };
const QUALITY_LABEL: Record<string, string> = { ekonomis: "Ekonomis", standar: "Standar", hq: "Berkualitas (HQ)", real: "Akun Real" };
const DROP_LABEL: Record<string, string> = { rendah: "Risiko drop rendah", sedang: "Risiko drop sedang", tinggi: "Risiko drop tinggi" };

export function serviceDisplayName(productName: string, t: PediaCatalogTier): string {
  return t.public_name ?? t.label_note ?? productName;
}

export function ServiceChips({ t }: { t: PediaCatalogTier }) {
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      <span className="rounded-md bg-white/[0.07] px-2 py-1 text-[11px] text-white/75">{REGION_LABEL[t.region ?? "global"]}</span>
      <span className="rounded-md bg-white/[0.07] px-2 py-1 text-[11px] text-white/75">{QUALITY_LABEL[t.quality ?? "standar"]}</span>
      <span className={`rounded-md px-2 py-1 text-[11px] ${t.refill_days > 0 ? "bg-[#00E5FF]/10 text-[#00E5FF]" : "bg-[#FFB800]/10 text-[#FFB800]"}`}>
        {t.refill_days > 0 ? `Refill ${t.refill_days} hari` : "Tanpa refill"}
      </span>
      {(t.speed_note ?? t.eta_start) && <span className="rounded-md bg-white/[0.07] px-2 py-1 text-[11px] text-white/75">{t.speed_note ?? t.eta_start}</span>}
      <span className="rounded-md bg-white/[0.07] px-2 py-1 text-[11px] text-white/60">{DROP_LABEL[t.drop_risk ?? "sedang"]}</span>
    </span>
  );
}

type Filters = { region: string; refill: string; quality: string; sort: string };

export function ServicePicker({ product, tierId, onSelect, qty }: {
  product: PediaCatalogProduct;
  tierId: number | null;
  onSelect: (id: number) => void;
  qty: number | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const [filters, setFilters] = useState<Filters>({ region: "", refill: "", quality: "", sort: "recommended" });
  const tiers = product.tiers;
  const recommended = useMemo(() => tiers.filter((t) => t.recommended), [tiers]);
  const hasFilters = !!(filters.region || filters.refill || filters.quality);

  const visible = useMemo(() => {
    let list = tiers.filter((t) =>
      (!filters.region || t.region === filters.region)
      && (!filters.refill || (filters.refill === "ada" ? t.refill_days > 0 : t.refill_days === 0))
      && (!filters.quality || t.quality === filters.quality));
    if (filters.sort === "cheapest") list = [...list].sort((a, b) => (a.price_per_1k ?? Infinity) - (b.price_per_1k ?? Infinity));
    else if (filters.sort === "refill") list = [...list].sort((a, b) => b.refill_days - a.refill_days || (a.price_per_1k ?? Infinity) - (b.price_per_1k ?? Infinity));
    if (!showAll && !hasFilters) {
      // Daftar pendek (<=5) tampil penuh: tombol "lihat semua" hanya untuk
      // katalog besar; rekomendasi tetap terurut pertama.
      const head = list.length <= 5 ? list : (recommended.length ? recommended : list.slice(0, 3));
      // Layanan terpilih selalu terlihat walau di luar rekomendasi.
      const picked = list.find((t) => t.id === tierId);
      const merged = [...head];
      if (picked && !merged.some((t) => t.id === picked.id)) merged.push(picked);
      return merged;
    }
    return list;
  }, [tiers, filters, showAll, hasFilters, recommended, tierId]);

  const initialHead = tiers.length <= 5 ? tiers.length : (recommended.length || Math.min(3, tiers.length));
  const hiddenCount = tiers.length - initialHead;

  const estimate = (t: PediaCatalogTier) => {
    if (!qty || !t.price_per_1k) return null;
    return Math.max(1000, Math.round((t.price_per_1k * qty) / 1000));
  };

  const selectCls = "min-h-[40px] rounded-lg border border-white/15 bg-white/[0.04] px-2.5 text-[13px] text-white/80 focus:border-[#00E5FF]/50 focus:outline-none";

  return (
    <fieldset id="pedia-tier" className="mt-4">
      <legend className="mb-3 text-sm text-white/70">
        Layanan terkurasi <span className="text-white/40">({tiers.length} pilihan)</span>
      </legend>

      <div className="mb-3 flex flex-wrap gap-2" aria-label="Filter layanan">
        <select aria-label="Filter wilayah" value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value })} className={selectCls}>
          <option value="">Semua wilayah</option>
          <option value="indonesia">Indonesia</option>
          <option value="global">Global</option>
          <option value="mixed">Campuran</option>
        </select>
        <select aria-label="Filter garansi refill" value={filters.refill} onChange={(e) => setFilters({ ...filters, refill: e.target.value })} className={selectCls}>
          <option value="">Semua garansi</option>
          <option value="ada">Ada refill</option>
          <option value="tanpa">Tanpa refill</option>
        </select>
        <select aria-label="Filter kualitas" value={filters.quality} onChange={(e) => setFilters({ ...filters, quality: e.target.value })} className={selectCls}>
          <option value="">Semua kualitas</option>
          <option value="ekonomis">Ekonomis</option>
          <option value="standar">Standar</option>
          <option value="hq">Berkualitas (HQ)</option>
          <option value="real">Akun Real</option>
        </select>
        <select aria-label="Urutkan layanan" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })} className={selectCls}>
          <option value="recommended">Rekomendasi AXVARA</option>
          <option value="cheapest">Termurah</option>
          <option value="refill">Refill terlama</option>
        </select>
      </div>

      <div className="space-y-2">
        {visible.map((t) => {
          const est = estimate(t);
          return (
            <label key={t.id} className={`grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-2xl border bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-4 transition-colors sm:grid-cols-[20px_minmax(0,1fr)_150px] ${t.id === tierId ? "border-[#00E5FF]/60 shadow-[0_0_20px_rgba(0,229,255,0.06)]" : "border-white/15 hover:border-white/30"}`}>
              <input type="radio" name="pedia-tier" value={t.id} checked={t.id === tierId} className="mt-1 h-4 w-4 accent-[#00E5FF]" onChange={() => onSelect(t.id)} />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{serviceDisplayName(product.name, t)}</span>
                  {t.recommended && <span className="rounded-full bg-[#FFB800]/15 px-2 py-0.5 text-[10px] font-bold text-[#FFB800]">★ Direkomendasikan</span>}
                </span>
                <ServiceChips t={t} />
                <span className="mt-2 block text-xs text-white/50">Min. {(t.min_qty ?? 1).toLocaleString("id-ID")} · Maks. {(t.max_qty ?? 0).toLocaleString("id-ID")}</span>
              </span>
              <span className="col-start-2 text-sm text-white/75 sm:col-start-3 sm:text-right">
                {t.price_per_1k ? <span className="block font-semibold tabular-nums text-white">{rupiah(t.price_per_1k)}<span className="text-xs font-normal text-white/55"> /1.000</span></span> : <span className="block font-semibold text-white">Lihat harga</span>}
                {est ? <span className="mt-1 block text-xs text-white/60">≈ {rupiah(est)} untuk {qty?.toLocaleString("id-ID")}</span> : <span className="mt-1 block text-xs text-white/45">Isi jumlah untuk estimasi</span>}
              </span>
            </label>
          );
        })}
        {!visible.length && <p className="rounded-xl border border-white/12 p-4 text-sm text-white/60">Tidak ada layanan yang cocok dengan filter ini. Longgarkan filter untuk melihat pilihan lain.</p>}
      </div>

      {!showAll && !hasFilters && hiddenCount > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className="mt-3 min-h-[44px] w-full rounded-xl border border-[#00E5FF]/25 bg-[#00E5FF]/5 px-4 text-sm font-medium text-[#00E5FF] transition hover:bg-[#00E5FF]/10">
          Lihat semua {tiers.length} pilihan layanan
        </button>
      )}
      {(showAll || hasFilters) && tiers.length > visible.length && (
        <p className="mt-2 text-center text-xs text-white/45">Menampilkan {visible.length} dari {tiers.length} layanan</p>
      )}
    </fieldset>
  );
}
