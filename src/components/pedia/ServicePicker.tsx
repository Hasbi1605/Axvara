"use client";

import { useCallback, useMemo, useState } from "react";
import type { PediaCatalogProduct, PediaCatalogTier } from "@/app/api/pedia/catalog/route";

const rupiah = (v: number) => `Rp${v.toLocaleString("id-ID")}`;
const REGION_LABEL: Record<string, string> = { indonesia: "Indonesia", global: "Global", mixed: "Campuran" };
export function serviceDisplayName(productName: string, t: PediaCatalogTier) { return t.public_name ?? t.label_note ?? productName; }
function comparisonName(productName: string, t: PediaCatalogTier) {
  return serviceDisplayName(productName, t).replace(/\s*·\s*Refill\s+\d+\s+hari\s*$/i, "");
}
export function ServiceChips({ t }: { t: PediaCatalogTier }) {
  return <span className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] leading-5">
    <span className="text-white/65">{REGION_LABEL[t.region ?? "global"]}</span>
    <span className={t.refill_days > 0 ? "text-[#00E5FF]" : "text-white/60"}>{t.refill_days > 0 ? `Refill ${t.refill_days} hari` : "Tanpa refill"}</span>
  </span>;
}

const QUALITY_LABEL: Record<string, string> = { ekonomis: "Ekonomis", standar: "Standar", hq: "Dengan foto/postingan", real: "Akun aktif" };

function incompatReason(product: PediaCatalogProduct, t: PediaCatalogTier, qty: number): string {
  const min = t.min_qty ?? 1;
  const max = t.max_qty ?? Infinity;
  const step = t.quantity_step ?? product.step;
  if (qty < min) return `Min. ${min.toLocaleString("id-ID")} untuk layanan ini`;
  if (qty > max) return `Maks. ${max.toLocaleString("id-ID")} untuk layanan ini`;
  if (qty % step !== 0) return `Kelipatan ${step.toLocaleString("id-ID")} untuk layanan ini`;
  return "";
}

export function ServicePicker({ product, tierId, onSelect, qty, prices = {}, pricesSettled = false, locked = false, expanded = false }: {
  product: PediaCatalogProduct; tierId: number | null; onSelect: (id: number) => void; qty: number | null;
  prices?: Record<number, number>; pricesSettled?: boolean; locked?: boolean; expanded?: boolean;
}) {
  const [compare, setCompare] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [category, setCategory] = useState("");
  const [quality, setQuality] = useState("");
  const [sort, setSort] = useState("recommended");
  const tiers = product.tiers;
  const qualities = [...new Set(tiers.map((t) => t.quality ?? "standar"))];
  const regions = [...new Set(tiers.map((t) => t.region ?? "global"))];
  const categories = [
    { id: "", label: "Semua" },
    ...(regions.length > 1 ? regions.map((id) => ({ id, label: REGION_LABEL[id] ?? id })) : []),
    ...(tiers.some((t) => t.refill_days > 0) && tiers.some((t) => !t.refill_days) ? [{ id: "refill", label: "Refill" }] : []),
  ];
  const filtersActive = !!(category || quality || sort !== "recommended");
  const validQuantity = useCallback((t: PediaCatalogTier) => qty != null && Number.isSafeInteger(qty) && qty >= (t.min_qty ?? 1) && qty <= (t.max_qty ?? Infinity) && qty % (t.quantity_step ?? product.step) === 0, [qty, product.step]);
  const relevant = useMemo(() => {
    const list = tiers.filter((t) => (!category || (category === "refill" ? t.refill_days > 0 : (t.region ?? "global") === category)) && (!quality || (t.quality ?? "standar") === quality));
    return [...list].sort((a, b) => {
      const eligible = Number(validQuantity(b)) - Number(validQuantity(a));
      if (eligible) return eligible;
      return sort === "cheapest" && qty
        ? (prices[a.id] ?? a.prices[qty] ?? Infinity) - (prices[b.id] ?? b.prices[qty] ?? Infinity)
        : Number(!!b.recommended) - Number(!!a.recommended);
    });
  }, [tiers, category, quality, sort, prices, qty, validQuantity]);
  const picked = tiers.find((t) => t.id === tierId);
  const compact = !expanded && !!picked && !compare;
  const visible = compact && picked ? [picked] : expanded || showAll ? [...relevant] : relevant.slice(0, 3);
  if (!compact && picked && relevant.includes(picked) && !visible.includes(picked)) visible.push(picked);
  const selectedOutsideFilter = !compact && picked && !relevant.includes(picked);
  if (selectedOutsideFilter) visible.unshift(picked);
  const resetFilters = () => { setCategory(""); setQuality(""); setSort("recommended"); setShowAll(false); };

  return <fieldset id="pedia-tier" className="min-w-0" disabled={locked}>
    <legend className="sr-only">{compact ? "Layanan pilihanmu" : "Pilih layanan"}</legend>
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[15px] leading-6">
        <span aria-hidden="true" className="font-semibold text-white">{compact ? "Layanan pilihanmu" : "Pilih layanan"}</span>
        {!compact && qty != null && <span className="text-white/65">· harga untuk {qty.toLocaleString("id-ID")}</span>}
      </div>
      {compact && picked && <button type="button" onClick={() => setCompare(true)} aria-expanded={false} className="min-h-11 shrink-0 whitespace-nowrap text-sm font-medium text-[#00E5FF] disabled:opacity-40">Ganti layanan</button>}
    </div>
    {!compact && <>
      {qty == null && <p className="mt-1 text-[13px] leading-5 text-white/65">Harga acuan ditampilkan per layanan. Isi jumlah untuk membandingkan totalnya.</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {categories.length > 1 && <div role="group" aria-label="Kategori layanan" className="flex flex-wrap items-center gap-1">
          {categories.map((option) => <button key={option.id} type="button" aria-pressed={category === option.id} onClick={() => { setCategory(option.id); setShowAll(false); }} className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold transition ${category === option.id ? "bg-[#F1F5FF] text-[#080C1E]" : "text-white/65 hover:bg-white/5 hover:text-white"}`}>{option.label}</button>)}
        </div>}
        {tiers.length > 1 && <div className="flex min-w-0 flex-wrap gap-2">
          {tiers.length > 6 && qualities.length > 1 && <select aria-label="Filter jenis akun" value={quality} onChange={(e) => { setQuality(e.target.value); setShowAll(false); }} className="min-h-11 max-w-full rounded-lg border border-white/15 bg-[#0F1430] px-2 text-[13px] text-white/80"><option value="">Semua jenis akun</option>{qualities.map((q) => <option key={q} value={q}>{QUALITY_LABEL[q] ?? q}</option>)}</select>}
          <label className="flex items-center gap-2 text-[13px] text-white/65">Urutkan<select aria-label="Urutkan layanan" value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-11 min-w-0 rounded-lg border border-white/15 bg-[#0F1430] px-2 text-[13px] text-white/80"><option value="recommended">Pilihan AXVARA</option><option value="cheapest" disabled={!qty}>Harga jumlah pilihan</option></select></label>
        </div>}
      </div>
    </>}
    {compact && <p className="mt-1 text-xs leading-5 text-white/50">Jumlah, target, dan filter tetap tersimpan saat ganti layanan.</p>}
    {selectedOutsideFilter && <p className="mt-3 text-[13px] leading-5 text-[#00E5FF]">Pilihanmu tetap disimpan di atas, meski tidak termasuk filter ini.</p>}
    <div className="mt-3 space-y-2.5">
      {visible.map((t) => {
        const entries = Object.entries(t.prices).filter(([, price]) => price > 0).map(([q, price]) => ({ qty: Number(q), price })).sort((a, b) => a.qty - b.qty);
        const cheapest = entries.sort((a, b) => a.price - b.price || a.qty - b.qty)[0];
        const valid = validQuantity(t);
        const benchmarkValid = 1000 >= (t.min_qty ?? 1) && 1000 <= (t.max_qty ?? Infinity) && 1000 % (t.quantity_step ?? product.step) === 0;
        const disabled = qty != null && !valid && t.id !== tierId;
        const exact = qty != null && valid ? prices[t.id] ?? t.prices[String(qty)] : undefined;
        const name = comparisonName(product.name, t);
        const reason = qty != null && !valid ? incompatReason(product, t, qty) : "";
        return <label key={t.id} className={`pedia-service-row relative flex min-w-0 gap-3 rounded-xl border p-3.5 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#00E5FF] ${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${t.id === tierId ? "pedia-tier-selected" : "border-white/15 bg-white/[0.025] hover:border-white/35"}`}>
          <input type="radio" name="pedia-tier" value={t.id} checked={t.id === tierId} disabled={disabled} onChange={() => { if (disabled || locked) return; onSelect(t.id); setCompare(false); setShowAll(false); }} className="sr-only" aria-describedby={reason ? `pedia-tier-${t.id}-reason` : undefined} />
          <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${t.id === tierId ? "border-[#00E5FF]" : "border-white/45"}`}>{t.id === tierId && <span className="h-2.5 w-2.5 rounded-full bg-[#00E5FF]" />}</span>
          <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(90px,auto)] items-start gap-x-3 gap-y-2">
            <span className="min-w-0 break-words text-sm font-semibold leading-5 text-white">{name}
              {t.id === tierId ? <span className="mt-1 block text-xs font-medium text-[#00E5FF]">Dipilih</span> : t.recommended && <span className="mt-1 block text-xs font-medium text-[#FFCF55]">Pilihan AXVARA</span>}
            </span>
            <span className="max-w-36 text-right">
              <span className="block text-sm font-bold leading-5 tracking-tight text-white sm:text-base">{qty != null ? !valid ? "Jumlah tidak tersedia" : exact != null ? rupiah(exact) : pricesSettled ? "Harga belum tersedia" : "Memeriksa harga…" : benchmarkValid && t.price_per_1k != null && t.price_per_1k > 0 ? rupiah(t.price_per_1k) : cheapest ? `Mulai ${rupiah(cheapest.price)}` : "Lihat harga"}</span>
              <span className="mt-1 block text-xs leading-5 text-white/65">{qty != null && valid ? `untuk ${qty.toLocaleString("id-ID")}` : qty != null ? "Ubah jumlah" : benchmarkValid && t.price_per_1k != null && t.price_per_1k > 0 ? "per 1.000" : cheapest ? `minimum ${cheapest.qty.toLocaleString("id-ID")}` : `Min. ${(t.min_qty ?? 1).toLocaleString("id-ID")}`}</span>
            </span>
            <span className="col-span-2 flex flex-wrap gap-x-3 gap-y-1"><ServiceChips t={t} /><span className="text-[13px] leading-5 text-white/65">{t.speed_note || (t.eta_start ? `Mulai ${t.eta_start}` : "Mulai mengikuti antrean")}</span></span>
            {reason && <span id={`pedia-tier-${t.id}-reason`} className="col-span-2 text-[13px] leading-5 text-amber-200">{qty?.toLocaleString("id-ID")} tidak tersedia di sini: {reason.toLowerCase()}.</span>}
          </span>
        </label>;
      })}
    </div>
    {!relevant.length && <p className="mt-3 rounded-xl border border-white/10 p-4 text-sm text-white/65">Tidak ada pilihan yang cocok untuk filter ini ({relevant.length} dari {tiers.length} layanan).</p>}
    {!expanded && !compact && !showAll && relevant.length > 3 && <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-white/10 px-3 text-sm text-[#00E5FF] transition hover:bg-white/[0.03]" onClick={() => setShowAll(true)}>Lihat semua {relevant.length} layanan</button>}
    {!compact && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/65">
      <span role="status" data-testid="pedia-filter-count">{relevant.length} dari {tiers.length} layanan</span>
      {filtersActive && <button type="button" onClick={resetFilters} className="min-h-11 px-1 font-medium text-[#00E5FF]">Reset filter</button>}
      {!expanded && picked && <button type="button" onClick={() => setCompare(false)} className="min-h-11 text-[#00E5FF]">Kembali ke pilihan</button>}
    </div>}
  </fieldset>;
}
