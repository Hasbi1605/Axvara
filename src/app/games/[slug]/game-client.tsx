"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BadgePercent, Check, Clock, Flame, Gem, Gift, Info, Package, ShieldCheck, Sparkles, Star, Ticket, Zap } from "lucide-react";
import { GameImage } from "@/components/games/GameImage";
import { GameCard, HowToTopUp, gamesFocus as focus } from "@/components/games/storefront";
import { PaymentMethodPicker } from "@/components/storefront/PaymentMethodPicker";
import { useDisplayLocale, useDisplayPrices } from "@/hooks/useDisplayPrices";
import { gamesCopy } from "@/lib/games/copy";
import type { GamesCatalogGame, GamesDetail, GamesDetailProduct } from "@/lib/games/catalog";
import { GAMES_CATEGORY_ORDER, cleanGamesFieldLabel, regionCodeFromNickname } from "@/lib/games/variant-kind";
import { parsePayOptions, type PayOption } from "@/lib/payment-ui";
import { rememberPediaContact } from "@/lib/pedia/buyer-session";
import { SITE, waHubLink } from "@/lib/site";

type Product = GamesDetailProduct;
type ProductField = NonNullable<Product["fields"]>[number];
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Validasi sama dengan server: trim, kontrol ditolak, panjang kontrak. */
function fieldInvalid(field: ProductField, raw: string | undefined): boolean {
  const value = (raw ?? "").trim();
  if (value === "") return Boolean(field.required);
  if (CONTROL.test(value)) return true;
  return value.length < field.min || value.length > field.max;
}
const inputClass = `h-12 w-full rounded-xl border border-white/15 bg-white/[.04] px-4 text-white ${focus}`;
const categoryIcons = { topup: Gem, pass: Ticket, first_topup: Sparkles, pack: Package, promo: BadgePercent, bestseller: Flame, special: Star, other: Gift };
function firstVariant(products: Product[], type: string) {
  const inType = products.filter((p) => type === "all" || (p.type_label ?? "other") === type);
  const available = inType.filter((p) => p.available);
  const topups = available.filter((p) => p.category === "topup").sort((a, b) => a.price - b.price);
  return topups[0] ?? available.sort((a, b) => GAMES_CATEGORY_ORDER.indexOf(a.category) - GAMES_CATEGORY_ORDER.indexOf(b.category) || a.price - b.price)[0] ?? inType[0] ?? products[0];
}

export function GameClient({ detail, orderingOpen, otherGames = [] }: { detail: GamesDetail; orderingOpen: boolean; otherGames?: GamesCatalogGame[] }) {
  const game = detail.game;
  const locale = useDisplayLocale();
  const t = gamesCopy(locale);
  const router = useRouter();
  // Semua varian/region/tipe tetap baris terpisah; tidak ada penggabungan nominal.
  const products: Product[] = detail.products;
  const defaultType = products.some((p) => p.type_label === "Indonesia") ? "Indonesia" : "all";
  const [activeType, setActiveType] = useState(defaultType);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [touched, setTouched] = useState(false);
  const [nickname, setNickname] = useState<{ state: "idle" | "checking" | "ok" | "unavailable" | "invalid"; value?: string }>({ state: "idle" });
  const [sku, setSku] = useState<string | null>(() => firstVariant(products, defaultType)?.buyer_sku_code ?? null);
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionClamped, setDescriptionClamped] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [checkSequence, setCheckSequence] = useState(0);
  const manualCheck = useRef(false);
  const [search, setSearch] = useState("");
  const [wa, setWa] = useState(""); const [email, setEmail] = useState("");
  const [quote, setQuote] = useState<{ token: string; total: number; options: PayOption[]; key: string; expires: number } | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [retry, setRetry] = useState(0); const [busy, setBusy] = useState(false);
  const [failedMethod, setFailedMethod] = useState<{ key: string; id: string } | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false); const [error, setError] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const inFlight = useRef(false); const attempted = useRef<{ token: string; method: string; wa: string; email: string } | null>(null);
  const selected = products.find((p) => p.buyer_sku_code === sku);
  const contract = selected?.fields ?? [];
  const contractReady = Boolean(selected?.available && selected.unsupported_reason == null && contract.length > 0);
  const valid = contractReady && contract.every((field) => !fieldInvalid(field, fields[field.key]));
  const valuesKey = JSON.stringify(fields);
  const quoteKey = JSON.stringify([game.slug, sku, fields, nickname.state === "ok" ? nickname.value : null, locale]);
  const displayPrices = useDisplayPrices([...(selected ? [selected.price] : []), ...(quote ? [quote.total, ...quote.options.flatMap((p) => p.kind === "gateway" && p.totalIdr !== null && p.feeIdr !== null ? [p.totalIdr, p.feeIdr] : [])] : []), ...products.map((p) => p.price), 0]);
  const prices = { ...displayPrices, text: (amount: number) => displayPrices.text(amount).replace(/^Rp\s+/, "Rp") };
  const option = quote?.options.find((p) => p.id === method);
  const total = option?.kind === "gateway" ? option.totalIdr : quote?.total;
  const totalText = option?.kind === "crypto" ? `US$${option.usdText}` : total != null ? prices.text(total) : selected && selected.price > 0 ? prices.text(selected.price) : "—";
  const feeText = option?.kind === "gateway" ? option.feeIdr === null ? "—" : prices.text(option.feeIdr) : option?.kind === "qris" ? prices.text(0) : option?.kind === "crypto" && option.surchargeText ? `US$${option.surchargeText}` : "—";

  // Pilih varian SK yang tersedia lebih dulu; kontrak field mengikuti varian ini.
  useEffect(() => {
    if (sku && products.some((product) => product.buyer_sku_code === sku)) return;
    const next = firstVariant(products, defaultType)?.buyer_sku_code ?? null;
    if (next !== sku) setSku(next);
  }, [products, sku, defaultType]);

  // Muat ID tersimpan hanya untuk key kontrak varian terpilih (interseksi aman).
  useEffect(() => {
    const keys = new Set<string>(contract.map((field) => field.key));
    try {
      const saved = localStorage.getItem(`games-id:${game.slug}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          const next: Record<string, string> = {};
          for (const field of keys) if (typeof (parsed as Record<string, unknown>)[field] === "string") next[field] = String((parsed as Record<string, unknown>)[field]);
          if (Object.keys(next).length > 0) { setFields(next); setRemember(true); }
        }
      }
    } catch { /* storage tidak wajib */ }
    setStorageReady(true);
  // Snapshot field kontrak menentukan key yang boleh dipulihkan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.slug, selected?.buyer_sku_code]);

  // Ganti varian = kontrak/target lama tidak boleh terbawa.
  useEffect(() => {
    const keys = new Set<string>(contract.map((field) => field.key));
    setFields((previous) => {
      const next: Record<string, string> = {};
      for (const key of Object.keys(previous)) if (keys.has(key)) next[key] = previous[key];
      return next;
    });
    setNickname({ state: "idle" });
    setDescriptionExpanded(false);
    setQuote(null); setMethod(null); setError("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.buyer_sku_code]);

  useEffect(() => { if (!storageReady) return; try { if (remember) localStorage.setItem(`games-id:${game.slug}`, valuesKey); else localStorage.removeItem(`games-id:${game.slug}`); } catch {} }, [remember, valuesKey, game.slug, storageReady]);

  // Nickname hanya untuk varian SK terpilih yang tersedia + kontrak didukung.
  useEffect(() => {
    if (!contractReady || !selected?.available || !valid || selected.validation_available === false) { setNickname({ state: "idle" }); return; }
    const controller = new AbortController();
    const delay = manualCheck.current ? 0 : 600;
    manualCheck.current = false;
    const timer = setTimeout(async () => {
      setNickname({ state: "checking" });
      try {
        const res = await fetch("/api/games/nickname", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: game.slug, buyer_sku_code: selected.buyer_sku_code, fields: JSON.parse(valuesKey) }), signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok || !["ok", "invalid", "unavailable"].includes(data.status)) throw new Error();
        if (data.status === "ok" && typeof data.nickname === "string") setNickname({ state: "ok", value: data.nickname });
        else setNickname({ state: data.status === "invalid" ? "invalid" : "unavailable", value: typeof data.message === "string" ? data.message : undefined });
      } catch { if (!controller.signal.aborted) setNickname({ state: "unavailable" }); }
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [contractReady, valid, valuesKey, game.slug, selected?.buyer_sku_code, selected?.available, selected?.validation_available, checkSequence]);

  useEffect(() => {
    if (attempted.current) return;
    setQuote(null); setMethod(null); setQuoteBusy(false);
    if (!orderingOpen || !valid || !selected || !selected.available) return;
    const controller = new AbortController(); setQuoteBusy(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/games/quote", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ slug: game.slug, buyer_sku_code: selected.buyer_sku_code, fields: JSON.parse(valuesKey), ...(nickname.state === "ok" ? { nickname: nickname.value } : {}), locale }) });
        const data = await res.json(); const options = parsePayOptions(data.paymentMethods);
        if (!res.ok || typeof data.quote_token !== "string" || !Number.isSafeInteger(data.total) || data.total <= 0 || !options.length) throw new Error(data.message || data.error || t.quoteError);
        if (!controller.signal.aborted) setQuote({ token: data.quote_token, total: data.total, options: options.map((p) => failedMethod?.key === quoteKey && p.id === failedMethod.id ? { ...p, available: false } : p), key: quoteKey, expires: Date.now() + 29 * 60_000 });
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t.quoteError); }
      finally { if (!controller.signal.aborted) setQuoteBusy(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  // quoteKey contains the values used in the request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, orderingOpen, valid, retry]);

  const types = Array.from(new Set(products.map((p) => p.type_label ?? "other"))).map((type) => ({ type, count: products.filter((p) => (p.type_label ?? "other") === type).length }))
    .sort((a, b) => a.type === "Indonesia" ? -1 : b.type === "Indonesia" ? 1 : a.type === "other" ? 1 : b.type === "other" ? -1 : b.count - a.count || a.type.localeCompare(b.type));
  const visible = products.filter((p) => (activeType === "all" || (p.type_label ?? "other") === activeType) && p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const countryTypes = new Set(products.map((p) => p.region_code).filter((code) => code && code !== "GLOBAL"));
  const detectedRegion = nickname.state === "ok" ? regionCodeFromNickname(nickname.value) : null;
  const selectedRegion = selected?.region_code;
  const mismatch = detectedRegion && selectedRegion && selectedRegion !== "GLOBAL" && detectedRegion !== selectedRegion;
  const detectedName = detectedRegion ? t.regionNames[detectedRegion] ?? detectedRegion : "";
  const detectedType = products.find((p) => p.region_code === detectedRegion);
  const related = otherGames.filter((other) => other.slug !== game.slug && other.sellable_count > 0).slice(0, 6);
  const plainDescription = (selected?.description ?? "").replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]+/gu, "").trim();
  useEffect(() => {
    const text = descriptionRef.current;
    if (!text) { setDescriptionClamped(false); return; }
    const measure = () => setDescriptionClamped(text.scrollHeight > parseFloat(getComputedStyle(text).lineHeight) * 2 + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [plainDescription, locale]);
  const scrollTo = (id: string) => { const el = document.getElementById(id); el?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }); (el?.querySelector("input:not(:disabled),button:not(:disabled)") as HTMLElement | null)?.focus({ preventScroll: true }); };
  const nominalKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "game-sku" || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", " "].includes(event.key)) return;
    event.preventDefault();
    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input[name="game-sku"]:not(:disabled)'));
    const delta = event.key === " " ? 0 : ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
    const next = radios[(radios.indexOf(target) + delta + radios.length) % radios.length];
    if (next) { setSku(next.value); next.focus(); }
  };
  const pay = async () => {
    if (!orderingOpen || inFlight.current) return;
    if (!valid) { setTouched(true); scrollTo("game-account"); return; }
    if (!selected || !selected.available) { scrollTo("game-nominal"); return; }
    if (!quote || (!attempted.current && (quote.key !== quoteKey || quote.expires < Date.now())) || !method || !option?.available) { setError(t.methodRequired); scrollTo("game-payment"); return; }
    if (!/^(\+62|62|0)8\d{8,13}$/.test(wa.replace(/[\s-]/g, "")) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(t.contactError); scrollTo("game-contact"); return; }
    inFlight.current = true; setBusy(true); setError("");
    const payload = attempted.current ?? { token: quote.token, method, wa: wa.trim(), email: email.trim() }; attempted.current = payload;
    try {
      const res = await fetch("/api/games/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote_token: payload.token, payment_method: payload.method, whatsapp: payload.wa, email: payload.email }) });
      const data = await res.json();
      if (!res.ok) {
        if (res.status >= 500 && typeof data.code === "string" && /^AXG-\d{8}-[A-Z0-9]{8}$/.test(data.code)) { setRecoveryCode(data.code); rememberPediaContact(data.code, payload.email); }
        if (res.status === 503 && data.error_code === "payment_method_unavailable") { attempted.current = null; setFailedMethod({ key: quoteKey, id: payload.method }); setQuote(null); setMethod(null); setRetry((n) => n + 1); }
        else if (res.status < 500 && ![408, 429].includes(res.status)) { attempted.current = null; if (["quote_expired", "quote_stale"].includes(data.error_code ?? data.error ?? data.code)) { setQuote(null); setMethod(null); setRetry((n) => n + 1); } }
        throw new Error(data.message || data.error || t.orderError);
      }
      if (typeof data.code !== "string" || !/^AXG-\d{8}-[A-Z0-9]{8}$/.test(data.code)) throw new Error(t.orderError);
      rememberPediaContact(data.code, payload.email); router.push(`/games/pesanan/${data.code}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.orderError); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const nicknameText = nickname.state === "checking" ? t.nicknameChecking
    : nickname.state === "ok" ? `${t.nicknameFound}: ${nickname.value} · ${t.nicknameNote}`
    : nickname.state === "invalid" ? nickname.value || t.nicknameInvalid
    : nickname.state === "unavailable" ? t.nicknameUnavailable : "";
  const chooseType = (type: string) => {
    setActiveType(type); setExpandedSections([]);
    if (!selected?.available || (type !== "all" && (selected.type_label ?? "other") !== type)) setSku(firstVariant(products, type)?.buyer_sku_code ?? null);
  };
  const payLabel = !orderingOpen ? t.opensSoon : busy ? t.processing : option ? `${t.payAmount} ${totalText}` : t.pay;
  const payDisabled = !orderingOpen || busy || !selected?.available;
  const payClass = `min-h-12 rounded-xl bg-[#00E5FF] px-4 text-sm font-bold text-[#080C1E] disabled:opacity-40 ${focus}`;
  return <div className="mx-auto max-w-[1280px] px-4 pb-24 pt-4 sm:px-6 lg:px-8">
    {!orderingOpen && <p role="status" className="mb-4 rounded-xl border border-white/10 bg-white/[.03] p-3 text-center text-sm text-white/70">{t.notice}</p>}
    <header data-game-header className="relative overflow-hidden rounded-3xl bg-[#0F1430]">
      <div className="relative h-[100px] sm:h-[180px] lg:h-[200px]">
        <GameImage src={game.banner} fallbackSrc={game.icon} banner name={game.name} className="h-full w-full text-4xl" eager />
        <div className="absolute inset-0 bg-gradient-to-t from-[#080C1E] via-[#080C1E]/30 to-transparent" />
      </div>
      <div className="relative -mt-9 flex items-end gap-3 px-4 pb-4 sm:-mt-14 sm:gap-5 sm:px-6">
        <GameImage src={game.icon} name={game.name} className="h-[72px] w-[72px] text-2xl sm:h-28 sm:w-28" eager />
        <div className="min-w-0 pb-1"><h1 className="font-display text-2xl font-bold leading-tight sm:text-4xl">{game.name}</h1>{game.publisher && <p className="mt-1 text-xs text-white/60 sm:text-sm">{game.publisher}</p>}</div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 pb-4 text-[11px] text-white/70 sm:px-6 sm:text-xs">{[[Zap, t.instant], [Clock, t.timeChip], [ShieldCheck, t.secureChip]].map(([Icon, text]) => { const Glyph = Icon as typeof Zap; return <span key={text as string} className="flex items-center gap-1.5"><Glyph size={20} strokeWidth={1.75} className="text-[#00E5FF]" />{text as string}</span>; })}</div>
    </header>
    {!products.length ? <p role="status" className="mt-6 rounded-2xl border border-white/10 bg-white/[.03] p-8 text-center text-white/60">{t.nominalSoon}</p> : <>
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0 space-y-5">
      <section id="game-account" className="ax-glass rounded-2xl border border-white/10 p-5"><h2 className="font-display text-xl font-bold"><span className="mr-3 rounded-lg bg-[#FFB800]/15 px-3 py-1 text-[#FFB800]">1</span>{t.account}</h2>
        {!selected?.available && <p role="status" className="mt-4 text-sm text-white/60">{t.unavailableAmount}</p>}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">{contract.map((field) => {
          const invalid = touched && fieldInvalid(field, fields[field.key]);
          return <div key={field.key}><label htmlFor={`game-field-${field.key}`} className="text-sm text-white/80">{cleanGamesFieldLabel(field.label)}{!field.required && <span className="ml-1 text-xs text-white/40">({t.optional})</span>}</label><input id={`game-field-${field.key}`} disabled={!selected?.available || !!attempted.current} className={`${inputClass} mt-2 disabled:opacity-50`} inputMode={field.input} maxLength={field.max} value={fields[field.key] ?? ""} onBlur={() => setTouched(true)} onChange={(e) => { setNickname({ state: "idle" }); setFields({ ...fields, [field.key]: e.target.value }); }} aria-invalid={invalid} aria-describedby={invalid ? `game-error-${field.key}` : undefined} />{invalid && <p id={`game-error-${field.key}`} className="mt-1 text-xs text-[#EF4444]">{t.invalidId}</p>}</div>;
        })}</div>
        <p className="mt-3 text-xs leading-6 text-white/60">{game.id_guide || (contract.some((field) => /hp|phone|nomor/i.test(field.label)) ? t.phoneHelp : t.profileHelp)}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"><label className="flex min-h-11 items-center gap-2 text-xs text-white/70 sm:text-sm"><input type="checkbox" checked={remember} disabled={!selected?.available || !!attempted.current} onChange={(e) => setRemember(e.target.checked)} className={`h-4 w-4 accent-[#00E5FF] ${focus}`} />{t.remember}</label>
          {selected?.validation_available !== false && <button type="button" disabled={!selected?.available || nickname.state === "checking" || !!attempted.current} onClick={() => { if (!valid) { setTouched(true); scrollTo("game-account"); return; } manualCheck.current = true; setCheckSequence((n) => n + 1); }} className={`min-h-11 rounded-xl border border-white/20 px-4 text-sm text-white/85 disabled:opacity-40 ${focus}`}>{nickname.state === "checking" ? t.nicknameChecking : t.checkId}</button>}
        </div><p aria-live="polite" className="text-sm leading-6 text-white/70">{nicknameText}</p>
        {mismatch && <div role="status" className="mt-3 rounded-xl border border-[#FFB800]/40 bg-[#FFB800]/[.04] p-3 text-sm leading-6 text-white/80"><p>{t.regionDetected} {detectedName}. {t.regionSelected} {selected?.type_label}. {t.chooseRegion} {detectedName} {t.regionChoose}</p>{detectedType && <button type="button" disabled={!!attempted.current} onClick={() => { chooseType(detectedType.type_label ?? "other"); scrollTo("game-nominal"); }} className={`min-h-11 text-[#00E5FF] ${focus}`}>{t.showRegion} {detectedName}</button>}</div>}
      </section>
      <section id="game-nominal" onKeyDown={nominalKeys} className="ax-glass scroll-mt-24 rounded-2xl border border-white/10 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-3 font-display text-xl font-bold"><span className="rounded-lg bg-[#FFB800]/15 px-3 py-1 text-[#FFB800]">2</span>{t.nominal}</h2><span className="text-xs text-white/50">{products.length} {t.variants}</span></div>
        <input aria-label={t.searchAmount} placeholder={t.searchNominal} value={search} onChange={(e) => { setSearch(e.target.value); setExpandedSections([]); }} className={`${inputClass} mt-5`} />
        {countryTypes.size >= 2 && <p className="mt-4 text-xs leading-6 text-white/55">{t.regionHelp}</p>}
        {types.length >= 2 && <div aria-label={t.typeLabel} className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 py-2">{[...types, { type: "all", count: products.length }].map(({ type, count }) => <button key={type} type="button" disabled={!!attempted.current} onClick={() => chooseType(type)} aria-pressed={activeType === type} className={`min-h-11 shrink-0 rounded-full border px-4 text-xs ${activeType === type ? "border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/15 text-white/70"} ${focus}`}>{type === "all" ? t.allTypes : type === "other" ? t.categories.other : type} <span className="ml-1 opacity-60">({count})</span></button>)}</div>}
        {!visible.length && <p role="status" className="py-8 text-center text-sm text-white/60">{t.noAmountMatch}</p>}
        {GAMES_CATEGORY_ORDER.map((category) => {
          const items = visible.filter((p) => p.category === category).sort((a, b) => Number(b.available) - Number(a.available) || a.price - b.price);
          if (!items.length) return null;
          const Icon = categoryIcons[category];
          const expanded = expandedSections.includes(category);
          return <div key={category} className="mt-6"><h3 className="flex items-baseline gap-2 text-base font-semibold text-white">{t.categories[category]}<span className="text-xs font-normal text-white/45">{items.length}</span></h3>
            <div role="radiogroup" aria-label={t.categories[category]} className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">{(expanded ? items : items.slice(0, 12)).map((p) => <label key={p.buyer_sku_code} aria-disabled={!p.available} className={`ax-glass relative flex min-h-[128px] min-w-0 flex-col overflow-hidden rounded-2xl border transition duration-[160ms] motion-reduce:transition-none has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#00E5FF] ${sku === p.buyer_sku_code && p.available ? "border-[#00E5FF] bg-[#00E5FF]/10 shadow-[0_0_20px_rgba(0,229,255,.12)]" : "border-white/10"} ${!p.available ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              <input type="radio" name="game-sku" value={p.buyer_sku_code} checked={sku === p.buyer_sku_code && p.available} disabled={!p.available || !!attempted.current} onChange={() => setSku(p.buyer_sku_code)} className="sr-only" />
              {category === "bestseller" && <span className="self-start rounded-br-lg bg-[#FFB800]/15 px-2 py-1 text-[10px] font-semibold text-[#FFB800]">{t.bestseller}</span>}
              <span className="flex flex-1 flex-col px-3 pb-3 pt-3"><span className="block break-words pr-2 text-[13px] font-semibold leading-5 text-white sm:text-sm">{p.name}</span>{activeType === "all" && p.type_label && <span className="mt-1 text-[11px] text-white/45">{p.type_label}</span>}<span className="mt-auto flex items-center gap-1.5 pt-3"><Icon aria-hidden="true" size={18} strokeWidth={1.75} className="shrink-0 text-[#00E5FF]/80" /><span className="font-display text-base font-bold tabular-nums sm:text-lg">{p.price > 0 ? prices.text(p.price) : "—"}</span></span></span>
              <span className="flex min-h-8 justify-end bg-[#080C1E]/35 px-2 py-1.5">{p.available ? <span className="inline-flex items-center gap-1 rounded-full bg-[#00E5FF]/10 px-2 py-0.5 text-[10px] font-semibold text-[#00E5FF] sm:text-[11px]"><Zap aria-hidden="true" size={12} strokeWidth={1.75} />{t.instant}</span> : <span className="text-[11px] text-white/55">{["stock_empty", "supplier_off"].includes(p.availability_reason ?? "") ? t.soldOut : t.notAvailable}</span>}</span>
              {sku === p.buyer_sku_code && p.available && <Check aria-hidden="true" size={16} strokeWidth={1.75} className="absolute right-2 top-2 text-[#00E5FF]" />}
            </label>)}</div>
            {!expanded && items.length > 12 && <button type="button" onClick={() => setExpandedSections((previous) => [...previous, category])} className={`mt-3 min-h-11 rounded-xl px-2 text-sm text-[#00E5FF] ${focus}`}>{t.showSection} ({items.length})</button>}
          </div>;
        })}
      </section>
      <section id="game-payment" className="ax-glass scroll-mt-24 rounded-2xl border border-white/10 p-5"><h2 className="font-display text-xl font-bold"><span className="mr-3 rounded-lg bg-[#FFB800]/15 px-3 py-1 text-[#FFB800]">3</span>{t.payment}</h2><div className="mt-5">{quote ? <><PaymentMethodPicker options={quote.options} selectedId={method} onSelect={setMethod} locale={locale} disabled={!!attempted.current} /><ul className="mt-4 space-y-1 text-xs text-white/65">{quote.options.filter((p) => p.available).map((p) => <li key={p.id}>{p.label}: {p.kind === "crypto" ? `US$${p.usdText}` : prices.text(p.kind === "gateway" ? p.totalIdr! : quote.total)}</li>)}</ul></> : quoteBusy ? <div role="status" aria-label={t.loading} className="space-y-3 motion-safe:animate-pulse"><div className="h-14 rounded-xl bg-white/5" /><div className="h-14 rounded-xl bg-white/5" /><span className="sr-only">{t.loading}</span></div> : <p className="text-sm text-white/60">{!orderingOpen ? t.previewPayment : t.paymentHint}</p>}</div></section>
      <section id="game-contact" className="ax-glass rounded-2xl border border-white/10 p-5"><h2 className="font-display text-xl font-bold"><span className="mr-3 rounded-lg bg-[#FFB800]/15 px-3 py-1 text-[#FFB800]">4</span>{t.contact}</h2><p className="mt-4 text-sm text-white/60">{t.contactHint}</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm">{t.whatsappLabel}<input type="tel" autoComplete="tel" disabled={!!attempted.current} className={`${inputClass} mt-2`} value={wa} onChange={(e) => setWa(e.target.value)} /></label><label className="text-sm">{t.emailLabel}<input type="email" autoComplete="email" disabled={!!attempted.current} className={`${inputClass} mt-2`} value={email} onChange={(e) => setEmail(e.target.value)} /></label></div></section>
      {error && <div role="alert" className="rounded-xl border border-[#EF4444]/30 p-4 text-sm text-white/80">{error}{!quote && !quoteBusy && <button type="button" onClick={() => { setError(""); setRetry((n) => n + 1); }} className={`ml-3 min-h-11 text-[#00E5FF] ${focus}`}>{t.retry}</button>}</div>}
      {recoveryCode && <Link href={`/games/pesanan/${recoveryCode}`} className="inline-flex min-h-11 items-center text-sm text-[#00E5FF]">{t.recoveryOrder} · {recoveryCode}</Link>}
    </div><aside className="ax-glass rounded-2xl border border-white/10 p-5 lg:sticky lg:top-24 lg:p-6">
      <h2 className="font-display text-xl font-bold">{t.summary}</h2>
      {selected && <><div className="mt-5 flex items-start gap-3"><GameImage src={game.icon} name={game.name} className="h-10 w-10 text-sm" /><div className="min-w-0 flex-1"><p className="text-xs text-white/45">{game.name}</p><p className="mt-1 break-words text-sm font-semibold leading-6">{selected.name}</p></div></div><button type="button" disabled={!!attempted.current} onClick={() => scrollTo("game-nominal")} className={`min-h-11 text-sm text-[#00E5FF] ${focus}`}>{t.change}</button>
        <dl className="space-y-2 border-t border-white/10 pt-4 text-xs"><div className="flex justify-between gap-4"><dt className="text-white/50">{t.typeLabel}</dt><dd>{selected.type_label ?? t.categories.other}</dd></div><div className="flex justify-between gap-4"><dt className="text-white/50">{t.process}</dt><dd>{t.auto}</dd></div></dl>
        {plainDescription && <div className="mt-3 text-xs leading-6 text-white/60"><p ref={descriptionRef} className={descriptionExpanded ? "" : "line-clamp-2"}>{plainDescription}</p>{descriptionClamped && <button type="button" onClick={() => setDescriptionExpanded(!descriptionExpanded)} aria-expanded={descriptionExpanded} className={`min-h-11 text-[#00E5FF] ${focus}`}>{descriptionExpanded ? t.detailsLess : t.detailsMore}</button>}</div>}
      </>}
      <dl className="mt-4 space-y-4 border-t border-white/10 pt-5 text-sm"><div className="flex justify-between gap-4"><dt className="shrink-0 text-white/55">{t.accountId}</dt><dd className="min-w-0 break-words text-right">{contract.map((field) => fields[field.key]).filter(Boolean).join(" / ") || "—"}{nickname.state === "ok" && <span className="mt-1 block text-xs text-white/60">{nickname.value}</span>}</dd></div><div className="flex justify-between gap-4"><dt className="text-white/55">{t.method}</dt><dd className="text-right">{option?.label ?? "—"}</dd></div><div className="flex justify-between gap-4"><dt className="text-white/55">{t.price}</dt><dd className="font-display tabular-nums">{selected && selected.price > 0 ? prices.text(selected.price) : "—"}</dd></div><div className="flex justify-between gap-4"><dt className="text-white/55">{t.fee}</dt><dd className="font-display tabular-nums">{feeText}</dd></div><div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4"><dt className="font-semibold">{t.total}</dt><dd className="font-display text-xl font-bold tabular-nums">{totalText}</dd></div></dl>
      <button onClick={pay} disabled={payDisabled} className={`mt-5 hidden w-full lg:block ${payClass}`}>{payLabel}</button><a href={SITE.webUrl + waHubLink()} className={`mt-3 flex min-h-11 items-center justify-center gap-2 text-sm text-white/60 ${focus}`}><Info size={18} strokeWidth={1.75} />{t.whatsapp}</a>
    </aside></div>
    <div data-game-bottom-bar className="ax-glass-strong fixed inset-x-0 bottom-0 z-30 flex min-h-16 items-center gap-3 border-t border-white/10 px-4 pb-[env(safe-area-inset-bottom)] lg:hidden"><div className="min-w-0 flex-1"><p className="text-xs text-white/55">{t.total}</p><p className="font-display text-base font-bold tabular-nums">{totalText}</p></div><button onClick={pay} disabled={payDisabled} className={`my-2 max-w-[65%] ${payClass}`}>{payLabel}</button></div>
    </>}
    <div className="mt-14 space-y-14">{game.description && <section><h2 className="font-display text-2xl font-bold">{t.about} {game.name}</h2><p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-7 text-white/60">{game.description}</p></section>}<HowToTopUp t={t} />{related.length > 0 && <section><h2 className="font-display text-2xl font-bold">{t.otherGames}</h2><div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">{related.map((other) => <GameCard key={other.slug} game={other} t={t} />)}</div></section>}</div>
  </div>;
}
