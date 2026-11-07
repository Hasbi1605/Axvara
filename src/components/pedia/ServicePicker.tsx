"use client";

import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, Clock, Globe2, MapPin, ShieldCheck, Zap } from "lucide-react";
import type { PediaCatalogProduct, PediaCatalogTier } from "@/app/api/pedia/catalog/route";
import { hasInstantStart, pediaDropLabel, refillLabel } from "@/lib/pedia/terms";
import { useDisplayLocale, useDisplayPrices } from "@/hooks/useDisplayPrices";
import { fill, pediaCopy, pediaNumber, pediaRegionLabel, pediaServiceName } from "@/lib/pedia/copy";

const rupiah = (v: number, locale: "id" | "en" = "id") => `Rp${v.toLocaleString(locale === "en" ? "en-US" : "id-ID")}`;
export function serviceDisplayName(productName: string, t: PediaCatalogTier, locale: "id" | "en" = "id") {
  return pediaServiceName(t.public_name ?? t.label_note ?? productName, locale);
}
// 2026-11-02 (owner): nama seragam [Metrik] [Wilayah] [Kualitas], mis.
// "Followers Indonesia Real", "Views Reels Global". Refill/No Refill dan label
// drop hanya tampil sebagai chip; sisa label itu pada nama lama dibuang.
const CHIP_PART = /^(?:Refill\s+(?:\d+\s+(?:hari|Days)|Lifetime)|No Refill|Tanpa refill|Instant Start|No Drop|Less Drop|High Drop)$/i;
export function shortServiceName(productName: string, _metric: string, t: PediaCatalogTier, locale: "id" | "en" = "id") {
  const full = serviceDisplayName(productName, t, locale);
  const short = full.split(/\s*·\s*/).filter((p) => !CHIP_PART.test(p.trim())).join(" · ").trim();
  return short || full;
}
// 2026-11-01 (owner): istilah SMM dipertahankan (Refill 30 Days, No Refill, No Drop, …).
const DROP_CHIP: Record<string, string> = { no_drop: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200", less_drop: "border-amber-300/25 bg-amber-300/10 text-amber-200", high_drop: "border-red-300/30 bg-red-400/10 text-red-200" };
// 2026-11-03 (owner): di mobile (<sm) daftar layanan terasa bertumpuk. Mode
// `compact` hanya mengubah tampilan <640px: chip region disembunyikan bila nama
// sudah memuat wilayahnya, label dipersingkat (Refill 365D, Instant, ±1j 25m,
// 100%) agar muat satu baris. Desktop tetap label penuh.
const shortTime = (s: string) => s.replace(/^Avg\s+/i, "±").replace(/\s*jam\b/gi, "j").replace(/\s*menit\b/gi, "m").replace(/\s*hari\b/gi, "h");
function Label({ full, short, compact }: { full: string; short: string; compact: boolean }) {
  if (!compact || full === short) return <>{full}</>;
  return <><span aria-hidden="true" className="sm:hidden">{short}</span><span className="max-sm:sr-only">{full}</span></>;
}
export function ServiceChips({ t, eta = false, className = "", productName = "", compact = false }: { t: PediaCatalogTier; eta?: boolean; className?: string; productName?: string; compact?: boolean }) {
  const locale = useDisplayLocale();
  const copy = pediaCopy(locale);
  // "Instant Start" datang dari nama layanan (fakta sumber); rentang tidak dikarang.
  // Chip Instant Start menggantikan chip waktu, tanpa mengubah data ETA.
  const instant = hasInstantStart(serviceDisplayName(productName, t));
  const start = instant ? null : t.eta_start ? `Start ${t.eta_start}` : t.speed_note ? t.speed_note.replace(/^Mulai\b/i, "Start") : t.avg_time ? `Avg ${t.avg_time}` : null;
  // 2026-11-02 (owner): chip informasi tetap netral (warna hanya untuk refill/drop/
  // sukses), teks dinaikkan agar terbaca; Indonesia memakai pin lokasi; tanpa
  // data waktu chip Start tidak ditampilkan.
  const RegionIcon = t.region === "indonesia" ? MapPin : Globe2;
  const chip = "inline-flex min-h-5 items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-1.5 text-[11px] leading-4";
  const drop = t.drop_label && t.drop_label !== "unknown" ? t.drop_label : null;
  const region = pediaRegionLabel(t.region ?? "global", locale);
  const regionInName = compact && new RegExp(`\\b${region}\\b`, "i").test(serviceDisplayName(productName, t));
  const refill = refillLabel(t.refill_days);
  return <span className={`flex flex-wrap gap-1 ${className}`}>
    <span className={`${chip} text-white/85 ${regionInName ? "max-sm:hidden" : ""}`}><RegionIcon size={11} aria-hidden="true" />{region}</span>
    <span className={`${chip} ${t.refill_days > 0 ? "border-[#00E5FF]/25 bg-[#00E5FF]/10 text-[#00E5FF]" : "text-white/75"}`}><ShieldCheck size={11} aria-hidden="true" /><Label compact={compact} full={refill} short={refill.replace(/^Refill (\d+) Days$/, "Refill $1D")} /></span>
    {drop && <span className={`${chip} ${DROP_CHIP[drop]}`}>{pediaDropLabel(drop, locale)}</span>}
    {instant && <span className={`${chip} text-white/85`}><Zap size={11} aria-hidden="true" /><Label compact={compact} full="Instant Start" short="Instant" /></span>}
    {eta && start && <span className={`${chip} text-white/85`}><Clock size={11} aria-hidden="true" /><Label compact={compact} full={start} short={shortTime(start)} /></span>}
    {t.success_pct != null && <span className={`${chip} ${t.success_pct >= 95 ? "text-emerald-200" : t.success_pct >= 85 ? "text-amber-200" : "text-red-200"}`}>{compact && <Check size={11} aria-hidden="true" className="sm:hidden" />}<Label compact={compact} full={fill(copy.chipSuccess, { pct: Math.round(t.success_pct) })} short={`${Math.round(t.success_pct)}%`} /></span>}
  </span>;
}

function incompatReason(t: PediaCatalogTier, product: PediaCatalogProduct, qty: number, locale: "id" | "en"): string {
  const copy = pediaCopy(locale);
  const min = t.min_qty ?? 1;
  const max = t.max_qty ?? Infinity;
  const step = t.quantity_step ?? product.step;
  if (qty < min) return fill(copy.reasonMin, { qty: pediaNumber(min, locale) });
  if (qty > max) return fill(copy.reasonMax, { qty: pediaNumber(max, locale) });
  if (qty % step !== 0) return fill(copy.reasonStep, { step: pediaNumber(step, locale) });
  return "";
}

export function ServicePicker({ product, tierId, onSelect, onClear, qty, prices = {}, pricesSettled = false, locked = false, expanded = false, info }: {
  product: PediaCatalogProduct; tierId: number | null; onSelect: (id: number) => void; onClear?: () => void; qty: number | null;
  prices?: Record<number, number>; pricesSettled?: boolean; locked?: boolean; expanded?: boolean;
  /** 2026-11-01: info layanan dirender tepat di bawah kartu yang dipilih. */
  info?: (t: PediaCatalogTier) => ReactNode;
}) {
  const [compare, setCompare] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [category, setCategory] = useState("");
  const locale = useDisplayLocale();
  const t = pediaCopy(locale);
  const tiers = product.tiers;
  // 2026-11-01 (owner): filter Refill/No Refill + wilayah. Pilihan yang tidak
  // termasuk filter baru dilepas (tidak lagi disematkan di atas daftar).
  const matches = (tier: PediaCatalogTier, id: string) => id === "" || (id === "refill" ? tier.refill_days > 0 : id === "norefill" ? tier.refill_days <= 0 : (tier.region ?? "global") === id);
  const count = (id: string) => tiers.filter((tier) => matches(tier, id)).length;
  const categories = tiers.length > 1 ? [
    { id: "", label: t.groupAll },
    ...["global", "indonesia", ...(tiers.some((tier) => tier.region === "mixed") ? ["mixed"] : [])].map((id) => ({ id, label: pediaRegionLabel(id, locale) })),
    { id: "refill", label: "Refill" },
    { id: "norefill", label: "No Refill" },
  ] : [];
  const filtersActive = !!category;
  const validQuantity = useCallback((tier: PediaCatalogTier) => qty != null && Number.isSafeInteger(qty) && qty >= (tier.min_qty ?? 1) && qty <= (tier.max_qty ?? Infinity) && qty % (tier.quantity_step ?? product.step) === 0, [qty, product.step]);
  const relevant = useMemo(() => {
    const list = tiers.filter((tier) => matches(tier, category));
    // 2026-11-01: dikelompokkan Refill (bergaransi) lalu No Refill, masing-masing termurah dulu.
    const price = (tier: PediaCatalogTier) => (qty != null && validQuantity(tier) ? prices[tier.id] ?? tier.prices[String(qty)] : undefined) ?? tier.price_per_1k ?? Math.min(...Object.values(tier.prices), Infinity);
    return [...list].sort((a, b) => Number(b.refill_days > 0) - Number(a.refill_days > 0)
      || Number(validQuantity(b)) - Number(validQuantity(a))
      || price(a) - price(b));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiers, category, validQuantity, qty, prices]);
  const picked = tiers.find((tier) => tier.id === tierId);
  // Nama yang sama dibedakan oleh chip (Refill N Days/drop) di kartu yang sama.
  const nameOf = (tier: PediaCatalogTier) => shortServiceName(product.name, product.metric, tier, locale);
  const compact = !expanded && !!picked && !compare;
  const visible = compact && picked ? [picked] : expanded || showAll ? [...relevant] : relevant.slice(0, 3);
  if (!compact && picked && relevant.includes(picked) && !visible.includes(picked)) visible.push(picked);
  const resetFilters = () => { setCategory(""); setShowAll(false); };

  // Nominal tampilan (IDR apa adanya; USD hanya saat mata uang tampilan = USD).
  const amounts: number[] = [];
  for (const tier of visible) {
    const ref = tier.price_ref?.price ?? 0;
    if (ref > 0) amounts.push(ref);
    const per1k = tier.price_per_1k ?? 0;
    if (per1k > 0) amounts.push(per1k);
    if (qty != null) {
      for (const price of Object.values(tier.prices)) if (price > 0) amounts.push(price);
    }
  }
  const display = useDisplayPrices(amounts);
  const money = (value: number) => (display.currency === "USD" ? display.text(value) : rupiah(value, locale));

  return <fieldset id="pedia-tier" className="min-w-0" disabled={locked}>
    <legend className="sr-only">{compact ? t.pickerLegendSelected : t.pickerLegend}</legend>
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[15px] leading-6">
        <span aria-hidden="true" className="font-semibold text-white">{compact ? t.pickerSelectedTitle : t.pickerTitle}</span>
        {!compact && <span role="status" data-testid="pedia-filter-count" className="text-[13px] text-white/55">· {filtersActive ? fill(t.pickerCountOf, { shown: relevant.length, total: tiers.length }) : fill(t.pickerCountOne, { count: relevant.length })}</span>}
        {!compact && qty != null && <span className="text-[13px] text-white/55">· {fill(t.pickerForQty, { qty: pediaNumber(qty, locale) })}</span>}
        {!compact && filtersActive && <button type="button" onClick={resetFilters} className="-my-2.5 min-h-11 px-1 text-[13px] font-medium text-[#00E5FF]">{t.pickerResetFilter}</button>}
        {!compact && !expanded && picked && <button type="button" onClick={() => setCompare(false)} className="-my-2.5 min-h-11 px-1 text-[13px] font-medium text-[#00E5FF]">{t.pickerBack}</button>}
      </div>
      {categories.length > 1 && <div role="group" aria-label={t.pickerCategoryAria} className="flex max-w-full gap-1.5 overflow-x-auto">
  {categories.map((option) => { const empty = count(option.id) === 0; return <button key={option.id} type="button" disabled={empty} aria-pressed={category === option.id} onClick={() => { setCategory(option.id); setShowAll(false); if (picked && !matches(picked, option.id)) { onClear?.(); setCompare(false); } }} className={`min-h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-9 ${category === option.id ? "pedia-pill-active text-[#00E5FF]" : "ax-glass-card border-white/10 text-white/70 hover:bg-white/10 hover:text-white"}`}>{option.label}</button>; })}
      </div>}
      {compact && picked && <button type="button" onClick={() => setCompare(true)} aria-expanded={false} className="min-h-11 shrink-0 whitespace-nowrap text-sm font-medium text-[#00E5FF] disabled:opacity-40">{t.pickerChange}</button>}
    </div>
    {compact && <p className="mt-1 text-xs leading-5 text-white/50">{t.pickerKeep}</p>}
    <div className="mt-3 space-y-2">
      {visible.map((tier, index) => {
        const group = tier.refill_days > 0 ? t.groupRefill : t.groupNoRefill;
        const prevGroup = index > 0 ? (visible[index - 1].refill_days > 0 ? t.groupRefill : t.groupNoRefill) : null;
        const showGroup = !compact && visible.some((v) => v.refill_days > 0) && visible.some((v) => v.refill_days <= 0) && group !== prevGroup;
        const entries = Object.entries(tier.prices).filter(([, price]) => price > 0).map(([q, price]) => ({ qty: Number(q), price })).sort((a, b) => a.qty - b.qty);
        const cheapest = entries.sort((a, b) => a.price - b.price || a.qty - b.qty)[0];
        const valid = validQuantity(tier);
        const benchmarkValid = 1000 >= (tier.min_qty ?? 1) && 1000 <= (tier.max_qty ?? Infinity) && 1000 % (tier.quantity_step ?? product.step) === 0;
        const disabled = qty != null && !valid && tier.id !== tierId;
        const exact = qty != null && valid ? prices[tier.id] ?? tier.prices[String(qty)] : undefined;
        const name = nameOf(tier);
        const reason = qty != null && !valid ? incompatReason(tier, product, qty, locale) : "";
        const selected = tier.id === tierId;
        const ref = qty == null && tier.price_ref && tier.price_ref.price > 0 ? tier.price_ref : null;
        const priceText = ref ? money(ref.price) : qty != null ? !valid ? t.qtyUnavailable : exact != null ? money(exact) : pricesSettled ? t.priceUnavailable : t.priceChecking : benchmarkValid && tier.price_per_1k != null && tier.price_per_1k > 0 ? money(tier.price_per_1k) : cheapest ? `${t.priceFrom} ${money(cheapest.price)}` : t.seePrice;
        const priceNote = ref ? fill(t.forComments, { qty: pediaNumber(ref.qty, locale) }) : qty != null && valid ? fill(t.forQty, { qty: pediaNumber(qty, locale) }) : qty != null ? t.changeQty : benchmarkValid && tier.price_per_1k != null && tier.price_per_1k > 0 ? t.per1kNote : cheapest ? fill(t.minimumQty, { qty: pediaNumber(cheapest.qty, locale) }) : fill(t.minQty, { qty: pediaNumber(tier.min_qty ?? 1, locale) });
        return <Fragment key={tier.id}>{showGroup && <p className={`${index ? "pt-3" : ""} text-[12px] font-semibold uppercase tracking-[0.08em] text-white/50`}>{group}</p>}<label style={{ animationDelay: `${Math.min(index, 6) * 35}ms` }} className={`pedia-service-row pedia-rise ax-liquid relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 rounded-[14px] px-3.5 py-3 transition sm:flex sm:items-center duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#00E5FF] ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:-translate-y-0.5"} ${selected ? "pedia-tier-selected" : "ax-glass-card ax-glass-cyan"}`}>
          <input type="radio" name="pedia-tier" value={tier.id} checked={selected} disabled={disabled} onChange={() => { if (disabled || locked) return; onSelect(tier.id); setCompare(false); setShowAll(false); }} className="sr-only" aria-describedby={[reason ? `pedia-tier-${tier.id}-reason` : "", selected && info ? `pedia-tier-${tier.id}-info` : ""].filter(Boolean).join(" ") || undefined} />
          <span aria-hidden="true" className={`row-start-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${selected ? "border-[#00E5FF] bg-[#00E5FF] text-[#080C1E]" : "border-white/40"}`}>{selected && <Check size={12} strokeWidth={3} />}</span>
          <span className="contents sm:flex sm:min-w-0 sm:flex-1 sm:flex-col sm:gap-1.5">
            <span className="col-start-2 block break-words text-[13px] font-semibold leading-[1.3] tracking-[-0.01em] text-white sm:text-sm"><span className="align-middle">{name}</span>{selected && <span className="sr-only">{t.selectedSr}</span>}</span>
            <ServiceChips t={tier} eta compact productName={product.name} className="col-span-3 col-start-1" />
            {reason && <span id={`pedia-tier-${tier.id}-reason`} className="col-span-2 col-start-2 text-xs leading-5 text-amber-200">{fill(t.rowReason, { qty: pediaNumber(qty ?? 0, locale), reason: reason.toLowerCase() })}</span>}
          </span>
          <span className="col-start-3 row-start-1 max-w-36 shrink-0 text-right">
            <span className={`block text-[14px] font-bold leading-none tracking-[-0.02em] text-white sm:text-[17px] ${qty != null && valid && exact == null && !pricesSettled ? "animate-pulse" : ""}`}>{priceText}</span>
            <span className="mt-1 block text-[11px] leading-4 text-white/65">{priceNote}</span>
          </span>
        </label>{selected && info && <div id={`pedia-tier-${tier.id}-info`} className="pedia-rise -mt-1 pl-1">{info(tier)}</div>}</Fragment>;
      })}
    </div>
    {!relevant.length && <p className="mt-3 rounded-xl border border-white/10 p-4 text-sm text-white/65">{fill(t.pickerNoMatch, { shown: relevant.length, total: tiers.length })}</p>}
    {!expanded && !compact && !showAll && relevant.length > 3 && <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-white/10 px-3 text-sm text-[#00E5FF] transition hover:bg-white/[0.03]" onClick={() => setShowAll(true)}>{fill(t.pickerSeeAll, { count: relevant.length })}</button>}
  </fieldset>;
}
