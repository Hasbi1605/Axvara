"use client";

import { useMemo, useState } from "react";
import type { PediaCatalogProduct, PediaCatalogTier } from "@/app/api/pedia/catalog/route";

const rupiah = (v: number) => `Rp${v.toLocaleString("id-ID")}`;
const REGION_LABEL: Record<string, string> = { indonesia: "Indonesia", global: "Global", mixed: "Campuran" };
export function serviceDisplayName(productName: string, t: PediaCatalogTier) { return t.public_name ?? t.label_note ?? productName; }
export function ServiceChips({ t }: { t: PediaCatalogTier }) {
  return <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-5">
    <span className="text-white/55">{REGION_LABEL[t.region ?? "global"]}</span>
    <span className={t.refill_days > 0 ? "text-[#00E5FF]" : "text-white/60"}>{t.refill_days > 0 ? `Refill ${t.refill_days} hari` : "Tanpa refill"}</span>
    {(t.speed_note ?? t.eta_start) && <span className="text-white/55">{t.speed_note ?? t.eta_start}</span>}
  </span>;
}

export function ServicePicker({ product, tierId, onSelect, qty, prices = {}, pricesSettled = false, locked = false }: {
  product: PediaCatalogProduct; tierId: number | null; onSelect: (id: number) => void; qty: number | null;
  prices?: Record<number, number>; pricesSettled?: boolean; locked?: boolean;
}) {
  const [compare, setCompare] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [region, setRegion] = useState("");
  const [quality, setQuality] = useState("");
  const [refill, setRefill] = useState("");
  const [sort, setSort] = useState("recommended");
  const tiers = product.tiers;
  const qualities = [...new Set(tiers.map((t) => t.quality ?? "standar"))];
  const qualityLabels = { ekonomis: "Ekonomis", standar: "Standar", hq: "Dengan foto/postingan", real: "Akun aktif" };
  const regions = [...new Set(tiers.map((t) => t.region ?? "global"))];
  const validQuantity = (t: PediaCatalogTier) => qty != null && Number.isSafeInteger(qty) && qty >= (t.min_qty ?? 1) && qty <= (t.max_qty ?? Infinity) && qty % (t.quantity_step ?? product.step) === 0;
  const relevant = useMemo(() => {
    const list = tiers.filter((t) => (!region || (t.region ?? "global") === region) && (!quality || (t.quality ?? "standar") === quality) && (!refill || (refill === "yes" ? t.refill_days > 0 : t.refill_days === 0)));
    return [...list].sort((a, b) => sort === "cheapest" && qty
      ? (prices[a.id] ?? a.prices[qty] ?? Infinity) - (prices[b.id] ?? b.prices[qty] ?? Infinity)
      : Number(!!b.recommended) - Number(!!a.recommended));
  }, [tiers, region, quality, refill, sort, prices, qty]);
  const picked = tiers.find((t) => t.id === tierId);
  const compact = !!picked && !compare;
  const visible = picked && !compare ? [picked] : showAll ? relevant : relevant.slice(0, 3);
  if (!compact && picked && relevant.includes(picked) && !visible.includes(picked)) visible.push(picked);

  return <fieldset id="pedia-tier" className="min-w-0" disabled={locked}>
    <legend className="sr-only">{compact ? "Layanan pilihanmu" : "Pilih layanan"}</legend>
    <div className="flex items-center justify-between gap-3">
      <span aria-hidden="true" className="text-base font-semibold text-white">{compact ? "Layanan pilihanmu" : "Pilih layanan"}</span>
      {picked && <button type="button" onClick={() => setCompare(!compare)} aria-expanded={compare} className="min-h-11 shrink-0 whitespace-nowrap text-xs font-medium text-[#00E5FF] disabled:opacity-40 sm:text-sm">{compact ? "Ganti layanan" : "Kembali ke pilihan"}</button>}
    </div>
    <p className="mt-1 text-xs leading-5 text-white/50">{compact ? "Lanjutkan dengan jumlah dan link tujuan di bawah." : `${tiers.length} pilihan · Bandingkan refill, wilayah, dan harga.`}</p>
    {!compact && tiers.length > 3 && <details className="mt-2 rounded-xl border border-white/10 px-3">
      <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-white/65">Filter & urutkan layanan{region || quality || refill || sort !== "recommended" ? " · aktif" : ""}</summary>
      <div className="grid gap-2 pb-3 sm:grid-cols-2" aria-label="Filter layanan">
        {regions.length > 1 && <select aria-label="Filter wilayah" value={region} onChange={(e) => { setRegion(e.target.value); setShowAll(false); }} className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="">Semua wilayah</option>{regions.map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}</select>}
        {qualities.length > 1 && <select aria-label="Filter jenis akun" value={quality} onChange={(e) => { setQuality(e.target.value); setShowAll(false); }} className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="">Semua jenis akun</option>{qualities.map((q) => <option key={q} value={q}>{qualityLabels[q]}</option>)}</select>}
        <select aria-label="Filter garansi refill" value={refill} onChange={(e) => { setRefill(e.target.value); setShowAll(false); }} className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="">Semua refill</option><option value="yes">Dengan refill</option><option value="no">Tanpa refill</option></select>
        <select aria-label="Urutkan layanan" value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0F1430] px-3 text-sm text-white/80"><option value="recommended">Pilihan AXVARA</option><option value="cheapest" disabled={!qty}>Harga jumlah pilihan</option></select>
      </div>
    </details>}
    <div className="mt-3 space-y-2.5">
      {visible.map((t) => {
        const initial = Object.entries(t.prices).filter(([, price]) => price > 0).map(([q, price]) => ({ qty: Number(q), price })).sort((a, b) => a.price - b.price || a.qty - b.qty)[0];
        const valid = validQuantity(t);
        const exact = qty != null && valid ? prices[t.id] ?? t.prices[String(qty)] : undefined;
        const name = serviceDisplayName(product.name, t);
        return <label key={t.id} className={`relative flex min-w-0 cursor-pointer gap-3 rounded-2xl border p-4 transition focus-within:ring-2 focus-within:ring-[#00E5FF]/60 ${t.id === tierId ? "border-[#00E5FF]/45 bg-[#00E5FF]/[0.045]" : "border-white/10 bg-white/[0.015] hover:border-white/25"}`}>
          <input type="radio" name="pedia-tier" value={t.id} checked={t.id === tierId} onChange={() => { onSelect(t.id); setCompare(false); setShowAll(false); }} className="sr-only" />
          <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${t.id === tierId ? "border-[#00E5FF]" : "border-white/25"}`}>{t.id === tierId && <span className="h-2.5 w-2.5 rounded-full bg-[#00E5FF]" />}</span>
          <span className="min-w-0 flex-1 sm:flex sm:items-start sm:justify-between sm:gap-5">
            <span className="block min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-5 text-white">{name}</span>
              {t.recommended && <span className="mt-1.5 inline-block text-[10px] font-semibold text-[#FFB800]">★ Pilihan AXVARA</span>}
              <ServiceChips t={t} />
              {compact && t.recommendation_note && <span className="mt-2 block text-xs leading-5 text-white/55">{t.recommendation_note}</span>}
            </span>
            <span className="mt-3 block sm:mt-0 sm:w-40 sm:shrink-0 sm:text-right">
              <span className="block text-base font-semibold tabular-nums text-white">{qty != null ? !valid ? "Jumlah tidak tersedia" : exact != null ? rupiah(exact) : pricesSettled ? "Harga belum tersedia" : "Memeriksa harga…" : initial ? `Mulai ${rupiah(initial.price)}` : "Lihat harga"}</span>
              <span className="mt-1 block text-xs leading-5 text-white/50">{qty != null && valid ? `untuk ${qty.toLocaleString("id-ID")}` : qty == null && initial ? `untuk ${initial.qty.toLocaleString("id-ID")}` : `Min. ${(t.min_qty ?? 1).toLocaleString("id-ID")} · Maks. ${(t.max_qty ?? 0).toLocaleString("id-ID")}${(t.quantity_step ?? product.step) > 1 ? ` · kelipatan ${t.quantity_step ?? product.step}` : ""}`}</span>
            </span>
          </span>
        </label>;
      })}
    </div>
    {!visible.length && <p className="mt-3 rounded-xl border border-white/10 p-4 text-sm text-white/65">Tidak ada pilihan yang cocok. <button type="button" className="min-h-11 text-[#00E5FF]" onClick={() => { setRegion(""); setQuality(""); setRefill(""); }}>Reset filter</button></p>}
    {!compact && !showAll && relevant.length > 3 && <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-white/10 text-sm text-[#00E5FF] transition hover:bg-white/[0.03]" onClick={() => setShowAll(true)}>Lihat semua {relevant.length} layanan</button>}
  </fieldset>;
}
