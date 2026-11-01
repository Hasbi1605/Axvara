"use client";

import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, Clock, Globe2, ShieldCheck } from "lucide-react";
import type { PediaCatalogProduct, PediaCatalogTier } from "@/app/api/pedia/catalog/route";
import { DROP_LABEL, refillLabel } from "@/lib/pedia/terms";

const rupiah = (v: number) => `Rp${v.toLocaleString("id-ID")}`;
const REGION_LABEL: Record<string, string> = { indonesia: "Indonesia", global: "Global", mixed: "Campuran" };
export function serviceDisplayName(productName: string, t: PediaCatalogTier) { return t.public_name ?? t.label_note ?? productName; }
// 2026-11-01 (owner): nama di daftar dibuat pendek. Wilayah, Refill/No Refill dan
// label drop sudah tampil sebagai chip, jadi tidak diulang di nama. Nama lengkap
// tetap dipakai di ringkasan/snapshot pesanan.
const CHIP_PART = /^(?:Refill\s+(?:\d+\s+(?:hari|Days)|Lifetime)|No Refill|Tanpa refill|No Drop|Less Drop|High Drop)$/i;
export function shortServiceName(productName: string, metric: string, t: PediaCatalogTier) {
  const full = serviceDisplayName(productName, t);
  const parts = full.split(/\s*·\s*/).filter((p) => !CHIP_PART.test(p.trim()));
  const lead = (parts[0] ?? "").replace(new RegExp(`^(?:${metric}|${productName.split(" ")[0]})\\s+`, "i"), "");
  const short = [lead, ...parts.slice(1)].filter(Boolean).join(" · ").trim();
  return short || full;
}
function comparisonName(productName: string, t: PediaCatalogTier) {
  return serviceDisplayName(productName, t).replace(/\s*·\s*Refill\s+\d+\s+(hari|Days)\s*$/i, "");
}
// 2026-11-01 (owner): istilah SMM dipertahankan (Refill 30 Days, No Refill, No Drop, …).
const DROP_CHIP: Record<string, string> = { no_drop: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200", less_drop: "border-amber-300/25 bg-amber-300/10 text-amber-200", high_drop: "border-red-300/30 bg-red-400/10 text-red-200" };
export function ServiceChips({ t, eta = false, className = "" }: { t: PediaCatalogTier; eta?: boolean; className?: string }) {
  const start = t.eta_start ? `Start ${t.eta_start}` : t.speed_note ? t.speed_note.replace(/^Mulai\b/i, "Start") : t.avg_time ? `Avg ${t.avg_time}` : "Start mengikuti antrean";
  const chip = "inline-flex min-h-5 items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-1.5 text-[11px] leading-4";
  const drop = t.drop_label && t.drop_label !== "unknown" ? t.drop_label : null;
  return <span className={`flex flex-wrap gap-1 ${className}`}>
    <span className={`${chip} text-white/75`}><Globe2 size={11} aria-hidden="true" />{REGION_LABEL[t.region ?? "global"]}</span>
    <span className={`${chip} ${t.refill_days > 0 ? "border-[#00E5FF]/25 bg-[#00E5FF]/10 text-[#00E5FF]" : "text-white/60"}`}><ShieldCheck size={11} aria-hidden="true" />{refillLabel(t.refill_days)}</span>
    {drop && <span className={`${chip} ${DROP_CHIP[drop]}`}>{DROP_LABEL[drop]}</span>}
    {eta && <span className={`${chip} text-white/75`}><Clock size={11} aria-hidden="true" />{start}</span>}
    {t.success_pct != null && <span className={`${chip} ${t.success_pct >= 95 ? "text-emerald-200" : t.success_pct >= 85 ? "text-amber-200" : "text-red-200"}`}>{Math.round(t.success_pct)}% sukses</span>}
  </span>;
}

function incompatReason(product: PediaCatalogProduct, t: PediaCatalogTier, qty: number): string {
  const min = t.min_qty ?? 1;
  const max = t.max_qty ?? Infinity;
  const step = t.quantity_step ?? product.step;
  if (qty < min) return `Min. ${min.toLocaleString("id-ID")} untuk layanan ini`;
  if (qty > max) return `Maks. ${max.toLocaleString("id-ID")} untuk layanan ini`;
  if (qty % step !== 0) return `Kelipatan ${step.toLocaleString("id-ID")} untuk layanan ini`;
  return "";
}

export function ServicePicker({ product, tierId, onSelect, qty, prices = {}, pricesSettled = false, locked = false, expanded = false, info }: {
  product: PediaCatalogProduct; tierId: number | null; onSelect: (id: number) => void; qty: number | null;
  prices?: Record<number, number>; pricesSettled?: boolean; locked?: boolean; expanded?: boolean;
  /** 2026-11-01: info layanan dirender tepat di bawah kartu yang dipilih. */
  info?: (t: PediaCatalogTier) => ReactNode;
}) {
  const [compare, setCompare] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [category, setCategory] = useState("");
  const tiers = product.tiers;
  const count = (id: string) => tiers.filter((t) => id === "" || (id === "refill" ? t.refill_days > 0 : (t.region ?? "global") === id)).length;
  const categories = tiers.length > 1 ? [
    { id: "", label: "Semua" },
    ...["global", "indonesia", ...(tiers.some((t) => t.region === "mixed") ? ["mixed"] : [])].map((id) => ({ id, label: REGION_LABEL[id] })),
    { id: "refill", label: "Refill" },
  ] : [];
  const filtersActive = !!category;
  const validQuantity = useCallback((t: PediaCatalogTier) => qty != null && Number.isSafeInteger(qty) && qty >= (t.min_qty ?? 1) && qty <= (t.max_qty ?? Infinity) && qty % (t.quantity_step ?? product.step) === 0, [qty, product.step]);
  const relevant = useMemo(() => {
    const list = tiers.filter((t) => (!category || (category === "refill" ? t.refill_days > 0 : (t.region ?? "global") === category)));
    // 2026-11-01: dikelompokkan Refill (bergaransi) lalu No Refill, masing-masing termurah dulu.
    const price = (t: PediaCatalogTier) => (qty != null && validQuantity(t) ? prices[t.id] ?? t.prices[String(qty)] : undefined) ?? t.price_per_1k ?? Math.min(...Object.values(t.prices), Infinity);
    return [...list].sort((a, b) => Number(b.refill_days > 0) - Number(a.refill_days > 0)
      || Number(validQuantity(b)) - Number(validQuantity(a))
      || price(a) - price(b));
  }, [tiers, category, validQuantity, qty, prices]);
  const picked = tiers.find((t) => t.id === tierId);
  const stripped = tiers.map((t) => comparisonName(product.name, t));
  void stripped;
  const shorts = tiers.map((t) => shortServiceName(product.name, product.metric, t));
  // Nama pendek kembar → nama lengkap agar tetap bisa dibedakan.
  const withRefill = tiers.map((t, i) => `${shorts[i]} · ${refillLabel(t.refill_days)}`);
  const nameOf = (t: PediaCatalogTier) => {
    const i = tiers.indexOf(t), n = shortServiceName(product.name, product.metric, t);
    if (shorts.filter((x) => x === n).length <= 1) return n;
    const r = i >= 0 ? withRefill[i] : `${n} · ${refillLabel(t.refill_days)}`;
    return withRefill.filter((x) => x === r).length <= 1 ? r : comparisonName(product.name, t);
  };
  const compact = !expanded && !!picked && !compare;
  const visible = compact && picked ? [picked] : expanded || showAll ? [...relevant] : relevant.slice(0, 3);
  if (!compact && picked && relevant.includes(picked) && !visible.includes(picked)) visible.push(picked);
  const selectedOutsideFilter = !compact && picked && !relevant.includes(picked);
  if (selectedOutsideFilter) visible.unshift(picked);
  const resetFilters = () => { setCategory(""); setShowAll(false); };

  return <fieldset id="pedia-tier" className="min-w-0" disabled={locked}>
    <legend className="sr-only">{compact ? "Layanan pilihanmu" : "Pilih layanan"}</legend>
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[15px] leading-6">
        <span aria-hidden="true" className="font-semibold text-white">{compact ? "Layanan pilihanmu" : "Pilih layanan"}</span>
        {!compact && qty != null && <span className="text-white/65">· harga untuk {qty.toLocaleString("id-ID")}</span>}
      </div>
      {categories.length > 1 && <div role="group" aria-label="Kategori layanan" className="flex max-w-full gap-1.5 overflow-x-auto">
  {categories.map((option) => { const empty = count(option.id) === 0; return <button key={option.id} type="button" disabled={empty} aria-pressed={category === option.id} onClick={() => { setCategory(option.id); setShowAll(false); }} className={`min-h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-9 ${category === option.id ? "pedia-pill-active text-[#00E5FF]" : "ax-glass-card border-white/10 text-white/70 hover:bg-white/10 hover:text-white"}`}>{option.label}</button>; })}
      </div>}
      {compact && picked && <button type="button" onClick={() => setCompare(true)} aria-expanded={false} className="min-h-11 shrink-0 whitespace-nowrap text-sm font-medium text-[#00E5FF] disabled:opacity-40">Ganti layanan</button>}
    </div>
    {!compact && <>
      {qty == null && <p className="mt-1 text-[13px] leading-5 text-white/65">Harga acuan ditampilkan per layanan. Isi jumlah untuk membandingkan totalnya.</p>}
    </>}
    {compact && <p className="mt-1 text-xs leading-5 text-white/50">Jumlah, target, dan filter tetap tersimpan saat ganti layanan.</p>}
    {selectedOutsideFilter && <p className="mt-3 text-[13px] leading-5 text-[#00E5FF]">Pilihanmu tetap disimpan di atas, meski tidak termasuk filter ini.</p>}
    <div className="mt-3 space-y-2">
      {visible.map((t, index) => {
        const group = t.refill_days > 0 ? "Refill (bergaransi)" : "No Refill";
        const prevGroup = index > 0 ? (visible[index - 1].refill_days > 0 ? "Refill (bergaransi)" : "No Refill") : null;
        const showGroup = !compact && visible.some((v) => v.refill_days > 0) && visible.some((v) => v.refill_days <= 0) && group !== prevGroup;
        const entries = Object.entries(t.prices).filter(([, price]) => price > 0).map(([q, price]) => ({ qty: Number(q), price })).sort((a, b) => a.qty - b.qty);
        const cheapest = entries.sort((a, b) => a.price - b.price || a.qty - b.qty)[0];
        const valid = validQuantity(t);
        const benchmarkValid = 1000 >= (t.min_qty ?? 1) && 1000 <= (t.max_qty ?? Infinity) && 1000 % (t.quantity_step ?? product.step) === 0;
        const disabled = qty != null && !valid && t.id !== tierId;
        const exact = qty != null && valid ? prices[t.id] ?? t.prices[String(qty)] : undefined;
        const name = nameOf(t);
        const reason = qty != null && !valid ? incompatReason(product, t, qty) : "";
        const selected = t.id === tierId;
        const priceText = qty != null ? !valid ? "Jumlah tidak tersedia" : exact != null ? rupiah(exact) : pricesSettled ? "Harga belum tersedia" : "Memeriksa harga…" : benchmarkValid && t.price_per_1k != null && t.price_per_1k > 0 ? rupiah(t.price_per_1k) : cheapest ? `Mulai ${rupiah(cheapest.price)}` : "Lihat harga";
        const priceNote = qty != null && valid ? `untuk ${qty.toLocaleString("id-ID")}` : qty != null ? "Ubah jumlah" : benchmarkValid && t.price_per_1k != null && t.price_per_1k > 0 ? "per 1.000" : cheapest ? `minimum ${cheapest.qty.toLocaleString("id-ID")}` : `Min. ${(t.min_qty ?? 1).toLocaleString("id-ID")}`;
        return <Fragment key={t.id}>{showGroup && <p className={`${index ? "pt-3" : ""} text-[12px] font-semibold uppercase tracking-[0.08em] text-white/50`}>{group}</p>}<label style={{ animationDelay: `${Math.min(index, 6) * 35}ms` }} className={`pedia-service-row pedia-rise ax-liquid relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 rounded-[14px] px-3.5 py-3 transition sm:flex sm:items-center duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#00E5FF] ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:-translate-y-0.5"} ${selected ? "pedia-tier-selected" : "ax-glass-card ax-glass-cyan"}`}>
          <input type="radio" name="pedia-tier" value={t.id} checked={selected} disabled={disabled} onChange={() => { if (disabled || locked) return; onSelect(t.id); setCompare(false); setShowAll(false); }} className="sr-only" aria-describedby={reason ? `pedia-tier-${t.id}-reason` : undefined} />
          <span aria-hidden="true" className={`row-start-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${selected ? "border-[#00E5FF] bg-[#00E5FF] text-[#080C1E]" : "border-white/40"}`}>{selected && <Check size={12} strokeWidth={3} />}</span>
          <span className="contents sm:flex sm:min-w-0 sm:flex-1 sm:flex-col sm:gap-1.5">
            <span className="col-start-2 block break-words text-[13px] font-semibold leading-[1.3] tracking-[-0.01em] text-white sm:text-sm"><span className="align-middle">{name}</span>{selected && <span className="sr-only"> (Dipilih)</span>}</span>
            <ServiceChips t={t} eta className="col-span-2 col-start-2" />
            {reason && <span id={`pedia-tier-${t.id}-reason`} className="col-span-2 col-start-2 text-xs leading-5 text-amber-200">{qty?.toLocaleString("id-ID")} tidak tersedia di sini: {reason.toLowerCase()}.</span>}
          </span>
          <span className="col-start-3 row-start-1 max-w-36 shrink-0 text-right">
            <span className={`block text-[14px] font-bold leading-none tracking-[-0.02em] text-white sm:text-[17px] ${qty != null && valid && exact == null && !pricesSettled ? "animate-pulse" : ""}`}>{priceText}</span>
            <span className="mt-1 block text-[11px] leading-4 text-white/65">{priceNote}</span>
          </span>
        </label>{selected && info && <div className="pedia-rise -mt-1 pl-1">{info(t)}</div>}</Fragment>;
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
