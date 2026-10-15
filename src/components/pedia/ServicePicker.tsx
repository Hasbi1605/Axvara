"use client";

import { useMemo, useState } from "react";
import type { PediaCatalogProduct, PediaCatalogTier } from "@/app/api/pedia/catalog/route";

const rupiah = (v: number) => `Rp${v.toLocaleString("id-ID")}`;
const REGION_LABEL: Record<string, string> = { indonesia: "Indonesia", global: "Global", mixed: "Campuran" };
export function serviceDisplayName(productName: string, t: PediaCatalogTier) { return t.public_name ?? t.label_note ?? productName; }
export function ServiceChips({ t }: { t: PediaCatalogTier }) {
  return <span className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
    <span className="rounded-md bg-white/[0.06] px-2 py-1 text-white/65">{REGION_LABEL[t.region ?? "global"]}</span>
    <span className={`rounded-md px-2 py-1 ${t.refill_days > 0 ? "bg-[#00E5FF]/10 text-[#00E5FF]" : "bg-white/[0.06] text-white/60"}`}>{t.refill_days > 0 ? `Refill ${t.refill_days} hari` : "Tanpa refill"}</span>
    {(t.speed_note ?? t.eta_start) && <span className="rounded-md bg-white/[0.06] px-2 py-1 text-white/65">{t.speed_note ?? t.eta_start}</span>}
  </span>;
}

export function ServicePicker({ product, tierId, onSelect, qty, prices = {}, locked = false }: {
  product: PediaCatalogProduct; tierId: number | null; onSelect: (id: number) => void; qty: number | null;
  prices?: Record<number, number>; locked?: boolean;
}) {
  const [compare, setCompare] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [region, setRegion] = useState("");
  const [quality, setQuality] = useState("");
  const [refill, setRefill] = useState("");
  const [sort, setSort] = useState("recommended");
  const tiers = product.tiers;
  const qualities = [...new Set(tiers.map((t) => t.quality ?? "standar"))];
  const qualityLabels = { ekonomis:"Ekonomis", standar:"Standar", hq:"Dengan foto/postingan", real:"Akun aktif" };
  const regions = [...new Set(tiers.map((t) => t.region ?? "global"))];
  const relevant = useMemo(() => {
    const list = tiers.filter((t) => (!region || t.region === region) && (!quality || t.quality === quality) && (!refill || (refill === "yes" ? t.refill_days > 0 : t.refill_days === 0)));
    return [...list].sort((a, b) => sort === "cheapest" && qty
      ? (prices[a.id] ?? a.prices[qty] ?? Infinity) - (prices[b.id] ?? b.prices[qty] ?? Infinity)
      : Number(b.recommended) - Number(a.recommended));
  }, [tiers, region, quality, refill, sort, prices, qty]);
  const visible = showAll ? relevant : relevant.slice(0, 5);
  const picked = relevant.find((t) => t.id === tierId);
  if (picked && !visible.some((t) => t.id === picked.id)) visible.push(picked);
  return <fieldset id="pedia-tier" className="mt-4" disabled={locked}>
    <legend className="text-sm font-medium text-white/80">Pilih layanan <span className="font-normal text-white/40">· {tiers.length} pilihan</span></legend>
    {tiers.length > 5 && <div className={`mt-3 flex-wrap items-center gap-2 ${tierId && !compare ? "hidden sm:flex" : "flex"}`} aria-label="Filter layanan">
      {regions.length > 1 && <select aria-label="Filter wilayah" value={region} onChange={(e) => { setRegion(e.target.value); setShowAll(false); }} className="min-h-11 rounded-xl border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="">Semua wilayah</option>{regions.map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}</select>}
      {qualities.length > 1 && <select aria-label="Filter jenis akun" value={quality} onChange={(e) => { setQuality(e.target.value); setShowAll(false); }} className="min-h-11 rounded-xl border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="">Semua jenis akun</option>{qualities.map((q) => <option key={q} value={q}>{qualityLabels[q]}</option>)}</select>}
      <select aria-label="Filter garansi refill" value={refill} onChange={(e) => { setRefill(e.target.value); setShowAll(false); }} className="min-h-11 rounded-xl border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="">Semua refill</option><option value="yes">Dengan refill</option><option value="no">Tanpa refill</option></select>
      <select aria-label="Urutkan layanan" value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-11 rounded-xl border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="recommended">Pilihan AXVARA</option><option value="cheapest" disabled={!qty}>Harga jumlah pilihan</option></select>
    </div>}
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {visible.map((t, index) => {
        const initial = Object.entries(t.prices).map(([q, price]) => ({ qty: Number(q), price })).sort((a, b) => a.price - b.price || a.qty - b.qty)[0];
        const valid = qty && qty >= (t.min_qty ?? 1) && qty <= (t.max_qty ?? Infinity);
        const exact = qty ? prices[t.id] : undefined;
        return <label key={t.id} className={`${((tierId && !compare && t.id !== tierId) || (!showAll && index >= 3 && t.id !== tierId)) ? "hidden sm:flex" : "flex"} min-w-0 cursor-pointer gap-3 rounded-2xl border p-3.5 transition sm:p-4 ${t.id === tierId ? "border-[#00E5FF]/60 bg-[#00E5FF]/[0.06]" : "border-white/12 bg-white/[0.025] hover:border-white/25"}`}>
          <input type="radio" name="pedia-tier" value={t.id} checked={t.id === tierId} onChange={() => { onSelect(t.id); setCompare(false); }} className="mt-1 h-4 w-4 shrink-0 accent-[#00E5FF]" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-5 text-white">{serviceDisplayName(product.name, t)}</span>
            {t.recommended && <span className="mt-1.5 inline-block text-[10px] font-semibold text-[#FFB800]">★ Pilihan AXVARA</span>}
            {t.recommendation_note && <span className="mt-1 block text-xs leading-5 text-white/55">{t.recommendation_note}</span>}
            <ServiceChips t={t} />
            <span className="mt-3 block font-semibold tabular-nums text-white">{exact != null ? rupiah(exact) : initial ? rupiah(initial.price) : "Lihat harga"}<span className="ml-1 text-xs font-normal text-white/55">{exact != null ? `untuk ${qty?.toLocaleString("id-ID")}` : initial ? `untuk ${initial.qty.toLocaleString("id-ID")}` : ""}</span></span>
            <span className="mt-1 block text-[11px] leading-4 text-white/45">{qty && !valid ? `Jumlah tersedia: ${(t.min_qty ?? 1).toLocaleString("id-ID")}–${(t.max_qty ?? 0).toLocaleString("id-ID")}` : qty && exact == null ? "Harga jumlah pilihan diperiksa setelah layanan dipilih" : `Min. ${(t.min_qty ?? 1).toLocaleString("id-ID")} · Maks. ${(t.max_qty ?? 0).toLocaleString("id-ID")}`}</span>
          </span>
        </label>;
      })}
    </div>
    {!visible.length && <p className="mt-3 rounded-xl border border-white/10 p-4 text-sm text-white/65">Tidak ada pilihan yang cocok. <button type="button" className="min-h-11 text-[#00E5FF]" onClick={() => { setRegion(""); setQuality(""); setRefill(""); }}>Reset filter</button></p>}
    {tierId && !compare && <button type="button" onClick={() => setCompare(true)} className="mt-3 min-h-11 w-full rounded-xl border border-white/15 text-sm text-[#00E5FF] sm:hidden">Ganti layanan</button>}
    {(!tierId || compare) && !showAll && relevant.length > 3 && <button type="button" className={`mt-3 min-h-11 w-full rounded-xl border border-white/15 text-sm text-[#00E5FF] ${relevant.length <= visible.length ? "sm:hidden" : ""}`} onClick={() => setShowAll(true)}>Lihat pilihan lainnya</button>}
  </fieldset>;
}
