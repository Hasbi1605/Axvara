"use client";

import { useCallback, useMemo, useState } from "react";
import type { PediaCatalogProduct, PediaCatalogTier } from "@/app/api/pedia/catalog/route";

const rupiah = (v: number) => `Rp${v.toLocaleString("id-ID")}`;
const REGION_LABEL: Record<string, string> = { indonesia: "Indonesia", global: "Global", mixed: "Campuran" };
// Nama pendek untuk pembanding: konteks produk sudah jelas dari judul kebutuhan,
// sehingga pengulangan kata pertama produk pada tiap baris dihilangkan bila aman.
export function serviceDisplayName(productName: string, t: PediaCatalogTier) {
  const raw = t.public_name ?? t.label_note ?? productName;
  const first = productName.split(/\s+/)[0];
  if (first.length > 2 && raw.startsWith(`${first} `) && !raw.startsWith(`${first} ·`) && raw.slice(first.length + 1).trim()) {
    return raw.slice(first.length + 1).trim();
  }
  return raw;
}
export function ServiceChips({ t }: { t: PediaCatalogTier }) {
  return <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs leading-5">
    <span className="text-white/65">{REGION_LABEL[t.region ?? "global"]}</span>
    <span aria-hidden="true" className="text-white/30">·</span>
    <span className={t.refill_days > 0 ? "text-[#00E5FF]" : "text-white/70"}>{t.refill_days > 0 ? `Refill ${t.refill_days} hari` : "Tanpa refill"}</span>
    {(t.speed_note || t.eta_start) && <>
      <span aria-hidden="true" className="text-white/30">·</span>
      <span className="text-white/65">{t.speed_note || (t.eta_start ? `Mulai ${t.eta_start}` : "")}</span>
    </>}
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
  const visible = compact && picked ? [picked] : expanded || showAll ? relevant.slice() : relevant.slice(0, 3);
  const pickedExcluded = !compact && !!picked && !relevant.includes(picked);
  // Pilihan aktif selalu dipertahankan dalam daftar agar radio tetap
  // terjangkau keyboard dan pembanding tidak kehilangan konteks.
  if (!compact && picked && !pickedExcluded && !visible.includes(picked)) visible.push(picked);
  const resetFilters = () => { setCategory(""); setQuality(""); setSort("recommended"); setShowAll(false); };

  return <fieldset id="pedia-tier" className="min-w-0" disabled={locked}>
    <legend className="sr-only">{compact ? "Layanan pilihanmu" : "Pilih layanan"}</legend>
    {/* Toolbar sebelum daftar: judul, konteks harga, kategori, dan urutan. */}
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[15px] leading-6">
        <span aria-hidden="true" className="font-semibold text-white">{compact ? "Layanan pilihanmu" : "Pilih layanan"}</span>
        {!compact && <span className="text-white/60">· harga untuk {qty != null ? qty.toLocaleString("id-ID") : "…"}</span>}
      </div>
      {compact && picked ? <button type="button" onClick={() => setCompare(true)} aria-expanded={false} className="min-h-11 shrink-0 whitespace-nowrap text-xs font-medium text-[#00E5FF] disabled:opacity-40">Ganti layanan</button> : <div role="group" aria-label="Kategori layanan" className="flex min-w-0 flex-wrap items-center gap-1">
        {([{ id: "", label: "Semua" }, { id: "global", label: "Global" }, { id: "indonesia", label: "Indonesia" }, { id: "refill", label: "Refill" }] as const).map((option) => <button key={option.id} type="button" aria-pressed={category === option.id} onClick={() => { setCategory(option.id); setShowAll(false); }} className={`min-h-11 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition sm:min-h-9 ${category === option.id ? "bg-[#F1F5FF] text-[#080C1E]" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>{option.label}</button>)}
      </div>}
    </div>
    {!compact && qualities.length > 1 && <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
      <label htmlFor="pedia-quality" className="text-xs text-white/60">Jenis akun</label>
      <select id="pedia-quality" aria-label="Filter jenis akun" value={quality} onChange={(e) => { setQuality(e.target.value); setShowAll(false); }} className="min-h-11 min-w-0 rounded-lg border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="">Semua jenis akun</option>{qualities.map((q) => <option key={q} value={q}>{QUALITY_LABEL[q] ?? q}</option>)}</select>
      <label htmlFor="pedia-sort" className="text-xs text-white/60">Urutkan</label>
      <select id="pedia-sort" aria-label="Urutkan layanan" value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-11 min-w-0 rounded-lg border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="recommended">Pilihan AXVARA</option><option value="cheapest" disabled={!qty}>Harga jumlah pilihan</option></select>
    </div>}
    {!compact && qualities.length <= 1 && <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
      <label htmlFor="pedia-sort" className="text-xs text-white/60">Urutkan</label>
      <select id="pedia-sort" aria-label="Urutkan layanan" value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-11 min-w-0 rounded-lg border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="recommended">Pilihan AXVARA</option><option value="cheapest" disabled={!qty}>Harga jumlah pilihan</option></select>
    </div>}
    {compact && <p className="mt-1 text-xs leading-5 text-white/55">Jumlah, target, dan filter tetap tersimpan saat ganti layanan.</p>}
    <div className="mt-3 space-y-2.5">
      {/* Pilihan aktif tetap terlihat walau di luar filter, tanpa mengganti pilihan. */}
      {pickedExcluded && picked && <div className="rounded-2xl border border-[#00E5FF]/40 bg-[#00E5FF]/[0.06] p-4">
        <p className="text-xs font-semibold text-white">Pilihanmu berada di luar filter: {serviceDisplayName(product.name, picked)}</p>
        <p className="mt-1 text-xs leading-5 text-white/60">Filter tidak mengubah pesanan. <button type="button" onClick={resetFilters} className="min-h-11 font-medium text-[#00E5FF]">Tampilkan pilihanmu</button></p>
      </div>}
      {visible.map((t) => {
        const entries = Object.entries(t.prices).filter(([, price]) => price > 0).map(([q, price]) => ({ qty: Number(q), price })).sort((a, b) => a.qty - b.qty);
        const cheapest = [...entries].sort((a, b) => a.price - b.price || a.qty - b.qty)[0];
        const valid = validQuantity(t);
        const benchmarkValid = 1000 >= (t.min_qty ?? 1) && 1000 <= (t.max_qty ?? Infinity) && 1000 % (t.quantity_step ?? product.step) === 0;
        const disabled = qty != null && !valid && t.id !== tierId;
        const exact = qty != null && valid ? prices[t.id] ?? t.prices[String(qty)] : undefined;
        const name = serviceDisplayName(product.name, t);
        const reason = qty != null && !valid ? incompatReason(product, t, qty) : "";
        const selected = t.id === tierId;
        return <label key={t.id} className={`relative flex min-w-0 cursor-pointer gap-3 rounded-2xl border p-4 transition focus-within:ring-2 focus-within:ring-[#00E5FF]/60 ${disabled ? "cursor-not-allowed border-white/5 bg-white/[0.008] opacity-70" : ""} ${selected ? "pedia-tier-selected" : "border-white/10 bg-white/[0.025] hover:border-[#00E5FF]/40"}`}>
          <input type="radio" name="pedia-tier" value={t.id} checked={selected} disabled={disabled} onChange={() => { if (disabled || locked) return; onSelect(t.id); setCompare(false); setShowAll(false); }} className="sr-only" aria-describedby={reason ? `pedia-tier-${t.id}-reason` : undefined} />
          <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-[#00E5FF]" : "border-white/25"}`}>{selected && <span className="h-2.5 w-2.5 rounded-full bg-[#00E5FF]" />}</span>
          <span className="min-w-0 flex-1 sm:flex sm:items-start sm:justify-between sm:gap-5">
            <span className="block min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold leading-5 text-white"><span>{name}</span>{selected && <span className="rounded-full border border-[#00E5FF]/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#00E5FF]">Dipilih</span>}</span>
              {t.recommended && <span className="mt-1 inline-block text-[10px] font-semibold text-[#FFB800]">★ Pilihan AXVARA</span>}
              <ServiceChips t={t} />
              {t.recommendation_note && <span className="mt-1 block text-xs leading-5 text-white/60">{t.recommendation_note}</span>}
              {reason && <span id={`pedia-tier-${t.id}-reason`} className="mt-1 block text-xs leading-5 text-amber-200/90">{qty?.toLocaleString("id-ID")} tidak tersedia di sini, {reason.toLowerCase()}.</span>}
            </span>
            <span className="mt-2 block sm:mt-0 sm:w-44 sm:shrink-0 sm:text-right">
              <span className="block font-bold text-[14px] sm:text-[17px] text-white tracking-[-0.02em] leading-none">{qty != null ? !valid ? "Jumlah tidak tersedia" : exact != null ? rupiah(exact) : pricesSettled ? "Harga belum tersedia" : "Memeriksa harga…" : benchmarkValid && t.price_per_1k != null && t.price_per_1k > 0 ? `${rupiah(t.price_per_1k)} /1.000` : cheapest ? `Mulai ${rupiah(cheapest.price)}` : "Lihat harga"}</span>
              <span className="mt-1 block text-xs leading-5 text-white/60">{qty != null && valid ? `untuk ${qty.toLocaleString("id-ID")}` : qty != null ? `Min. ${(t.min_qty ?? 1).toLocaleString("id-ID")} · Maks. ${(t.max_qty ?? 0).toLocaleString("id-ID")}${(t.quantity_step ?? product.step) > 1 ? ` · kelipatan ${t.quantity_step ?? product.step}` : ""}` : benchmarkValid && t.price_per_1k != null && t.price_per_1k > 0 ? "Acuan per 1.000 · total mengikuti jumlah" : cheapest ? `harga min. ${cheapest.qty.toLocaleString("id-ID")} · bukan pembanding antar layanan` : `Min. ${(t.min_qty ?? 1).toLocaleString("id-ID")} · Maks. ${(t.max_qty ?? 0).toLocaleString("id-ID")}`}</span>
            </span>
          </span>
        </label>;
      })}
    </div>
    {!visible.length && !pickedExcluded && <p className="mt-3 rounded-xl border border-white/10 p-4 text-sm text-white/65">Tidak ada pilihan yang cocok untuk filter ini ({relevant.length} dari {tiers.length} layanan).</p>}
    {!expanded && !compact && !showAll && relevant.length > 3 && <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-white/10 px-3 text-sm text-[#00E5FF] transition hover:bg-white/[0.03]" onClick={() => setShowAll(true)}>Lihat semua {relevant.length} layanan</button>}
    {!compact && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
      <span role="status" data-testid="pedia-filter-count">{relevant.length} dari {tiers.length} layanan</span>
      {filtersActive && <button type="button" onClick={resetFilters} className="min-h-11 px-1 font-medium text-[#00E5FF]">Reset filter</button>}
      {!expanded && picked && <button type="button" onClick={() => setCompare(false)} className="min-h-11 text-[#00E5FF]">Kembali ke pilihan</button>}
    </div>}
  </fieldset>;
}
