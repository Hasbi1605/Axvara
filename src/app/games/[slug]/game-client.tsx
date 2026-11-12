"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Clock, Info, ShieldCheck, Zap } from "lucide-react";
import { PaymentMethodPicker } from "@/components/storefront/PaymentMethodPicker";
import { useDisplayLocale, useDisplayPrices } from "@/hooks/useDisplayPrices";
import { gamesCopy } from "@/lib/games/copy";
import type { GamesDetail } from "@/lib/games/catalog";
import { parsePayOptions, type PayOption } from "@/lib/payment-ui";
import { rememberPediaContact } from "@/lib/pedia/buyer-session";
import { SITE, waHubLink } from "@/lib/site";

type Product = GamesDetail["products"][number];
type ProductField = NonNullable<Product["fields"]>[number];
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Placeholder inisial; tidak pernah mengirim <img src="">. */
function gameInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "G";
}
function amount(name: string) { const match = name.match(/\d[\d.,]*/); return match ? Number(match[0].replace(/[.,]/g, "")) : null; }
function nominal(name: string, bonus: string) {
  const match = name.match(/^(\d[\d.,]*)\s*(diamonds?|uc)\b/i);
  const extra = name.match(/\((\d+)\s*\+\s*(\d+)\)/);
  return { main: match?.[1] ?? name, unit: match?.[2] ?? "", extra: extra ? `${extra[1]} + ${extra[2]} ${bonus}` : "" };
}
/** Validasi sama dengan server: trim, kontrol ditolak, panjang kontrak. */
function fieldInvalid(field: ProductField, raw: string | undefined): boolean {
  const value = (raw ?? "").trim();
  if (value === "") return Boolean(field.required);
  if (CONTROL.test(value)) return true;
  return value.length < field.min || value.length > field.max;
}
function availabilityLabel(product: Product, t: ReturnType<typeof gamesCopy>): string {
  switch (product.availability_reason) {
    case "supplier_off": return t.reasonOff;
    case "stock_empty": return t.reasonStock;
    case "min_order": return t.reasonMinOrder;
    case "admin_disabled": return t.reasonAdmin;
    case "no_price": return t.reasonNoPrice;
    case "unsupported":
    case "open_denom":
    case "unknown_field":
    case "missing_note":
    case "missing_zone":
    case "invalid_min_order":
    case "order_process":
    case "malformed_required_fields":
    case "malformed_validation":
    case "invalid_contract": return t.reasonUnsupported;
    default: return t.reasonOff;
  }
}
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]";
const inputClass = `h-12 w-full rounded-xl border border-white/15 bg-white/[.04] px-4 text-white ${focus}`;
function CurrencyIcon({ currency }: { currency: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" className="shrink-0"><defs><linearGradient id="games-gem" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d9ffff" /><stop offset="1" stopColor="#00a9df" /></linearGradient></defs>{currency === "uc" ? <><circle cx="12" cy="12" r="10" fill="#ffb800" /><circle cx="12" cy="12" r="7.5" fill="#172239" /><path d="M7 8v6a2 2 0 0 0 4 0V8m6 0a3 3 0 0 0 0 8" fill="none" stroke="#ffca54" strokeWidth="1.5" /></> : <><path fill="url(#games-gem)" d="M3 9 7 4h10l4 5-9 11L3 9Z" /><path d="M3 9h18M7 4l5 16 5-16" fill="none" stroke="#087b9b" strokeWidth=".7" /></>}</svg>;
}

export function GameClient({ detail, orderingOpen }: { detail: GamesDetail; orderingOpen: boolean }) {
  const { game } = detail;
  const locale = useDisplayLocale();
  const t = gamesCopy(locale);
  const router = useRouter();
  // Semua varian/region/tipe tetap baris terpisah; tidak ada penggabungan nominal.
  const products = detail.products;
  const [fields, setFields] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [touched, setTouched] = useState(false);
  const [nickname, setNickname] = useState<{ state: "idle" | "checking" | "ok" | "unavailable" | "invalid"; value?: string }>({ state: "idle" });
  const [sku, setSku] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(!products.some((p) => p.group === "bestseller"));
  const [range, setRange] = useState(0);
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
  const prices = useDisplayPrices([...(selected ? [selected.price] : []), ...(quote ? [quote.total, ...quote.options.flatMap((p) => p.kind === "gateway" && p.totalIdr !== null ? [p.totalIdr] : [])] : []), ...products.map((p) => p.price)]);
  const option = quote?.options.find((p) => p.id === method);
  const total = option?.kind === "gateway" ? option.totalIdr : quote?.total;
  const totalText = option?.kind === "crypto" ? `US$${option.usdText}` : total != null ? prices.text(total) : selected ? prices.text(selected.price) : "—";

  // Pilih varian SK yang tersedia lebih dulu; kontrak field mengikuti varian ini.
  useEffect(() => {
    if (sku && products.some((product) => product.buyer_sku_code === sku && product.available)) return;
    const next = products.find((product) => product.available && product.fields && product.fields.length > 0)?.buyer_sku_code ?? null;
    if (next !== sku) setSku(next);
  }, [products, sku]);

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
    setQuote(null); setMethod(null); setError("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.buyer_sku_code]);

  useEffect(() => { if (!storageReady) return; try { if (remember) localStorage.setItem(`games-id:${game.slug}`, valuesKey); else localStorage.removeItem(`games-id:${game.slug}`); } catch {} }, [remember, valuesKey, game.slug, storageReady]);

  // Nickname hanya untuk varian SK terpilih yang tersedia + kontrak didukung.
  useEffect(() => {
    if (!contractReady || !selected?.available || !valid) { setNickname({ state: "idle" }); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setNickname({ state: "checking" });
      try {
        const res = await fetch("/api/games/nickname", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: game.slug, buyer_sku_code: selected.buyer_sku_code, fields: JSON.parse(valuesKey) }), signal: controller.signal });
        const data = await res.json();
        if (!res.ok || !["ok", "invalid", "unavailable"].includes(data.status)) throw new Error();
        if (data.status === "ok" && typeof data.nickname === "string") setNickname({ state: "ok", value: data.nickname });
        else setNickname({ state: data.status === "invalid" ? "invalid" : "unavailable", value: typeof data.message === "string" ? data.message : undefined });
      } catch { if (!controller.signal.aborted) setNickname({ state: "unavailable" }); }
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [contractReady, valid, valuesKey, game.slug, selected?.buyer_sku_code, selected?.available]);

  useEffect(() => {
    if (attempted.current) return;
    setQuote(null); setMethod(null);
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

  const visible = products.filter((p) => {
    const n = amount(p.name); if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (range && (n === null || !(range === 1 ? n <= 100 : range === 2 ? n > 100 && n <= 500 : range === 3 ? n > 500 && n <= 2000 : n > 2000))) return false;
    return true;
  });
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
  const groups = [["special", t.special], ["bestseller", t.bestseller], ["all", t.all]] as const;
  const nicknameText = nickname.state === "checking" ? t.nicknameChecking
    : nickname.state === "ok" ? `${t.nicknameFound}: ${nickname.value} · ${t.nicknameNote}`
    : nickname.state === "invalid" ? nickname.value || t.nicknameInvalid
    : nickname.state === "unavailable" ? t.nicknameUnavailable : "";
  return <div className="mx-auto max-w-[1280px] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
    {!orderingOpen && <p role="status" className="mb-4 rounded-xl border border-[#FFB800]/20 bg-[#FFB800]/[.07] p-3 text-center text-sm text-[#ffe2a1]">{t.notice}</p>}
    <header className="relative overflow-hidden rounded-3xl bg-[#0F1430]"><div className="relative aspect-[2.5/1] sm:aspect-[5/1]">{game.banner
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={game.banner} alt="" className="h-full w-full object-cover" />
      : <div aria-hidden className="h-full w-full bg-[radial-gradient(circle_at_25%_30%,rgba(0,229,255,.16),transparent_60%),radial-gradient(circle_at_80%_20%,rgba(255,184,0,.10),transparent_55%)]" />}<div className="absolute inset-0 bg-gradient-to-t from-[#080C1E] via-[#080C1E]/30 to-transparent" /></div><div className="relative -mt-12 flex items-end gap-4 px-4 pb-5 sm:px-8">{game.icon
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={game.icon} alt="" className="h-20 w-20 rounded-2xl border border-white/20 object-cover sm:h-28 sm:w-28" />
      : <div aria-hidden className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/20 bg-[#0F1430] font-display text-2xl font-bold tracking-[0.08em] text-white/80 sm:h-28 sm:w-28">{gameInitials(game.name)}</div>}<div><h1 className="font-display text-2xl font-bold sm:text-4xl">{game.name}</h1><p className="mt-1 text-sm text-white/60">{game.publisher}</p></div></div><div className="flex flex-wrap gap-x-5 gap-y-2 px-4 pb-5 text-xs text-white/70 sm:px-8">{[[Zap, t.automaticChip], [Clock, t.timeChip], [ShieldCheck, t.secureChip]].map(([Icon, text]) => { const Glyph = Icon as typeof Zap; return <span key={text as string} className="flex items-center gap-2"><Glyph size={20} strokeWidth={1.75} className="text-[#00E5FF]" />{text as string}</span>; })}</div></header>
    {!products.length ? <p role="status" className="mt-6 rounded-2xl border border-white/10 bg-white/[.03] p-8 text-center text-white/60">{t.nominalSoon}</p> : <>
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"><div className="space-y-5">
      <section id="game-account" className="ax-glass rounded-2xl border border-white/10 p-5"><h2 className="font-display text-xl font-bold"><span className="mr-3 rounded-lg bg-[#FFB800]/15 px-3 py-1 text-[#FFB800]">1</span>{t.account}</h2>
        {selected && (selected.product_type_name || selected.description) && <div className="mt-4 rounded-xl border border-white/10 bg-white/[.03] p-3 text-sm text-white/65"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">{t.productInfo}</p>{selected.product_type_name && <p className="mt-1 font-semibold text-white/85">{t.typeLabel}: {selected.product_type_name}</p>}{selected.description && <p className="mt-1 leading-6">{t.descriptionLabel}: {selected.description}</p>}</div>}
        {contract.length === 0 ? <p className="mt-4 text-sm text-white/60" role="status">{t.fieldsHint}</p> : <div className="mt-5 grid gap-4 sm:grid-cols-2">{contract.map((field) => {
          const invalid = touched && fieldInvalid(field, fields[field.key]);
          return <label key={field.key} className="text-sm text-white/80">{field.label}{!field.required && <span className="ml-1 text-xs text-white/40">({t.optional})</span>}<input disabled={!!attempted.current} className={`${inputClass} mt-2`} inputMode={field.input} maxLength={field.max} value={fields[field.key] ?? ""} onBlur={() => setTouched(true)} onChange={(e) => { setNickname({ state: "idle" }); setFields({ ...fields, [field.key]: e.target.value }); }} aria-invalid={invalid} />{invalid && <span className="mt-1 block text-xs text-red-300">{t.invalidId}</span>}</label>;
        })}</div>}
        <details className="mt-4 text-sm text-[#00E5FF]"><summary className={`flex min-h-11 cursor-pointer items-center gap-2 ${focus}`}><Info size={18} />{t.idHelp}</summary><p className="pb-3 text-white/65">{t.idHelpBody}</p></details><label className="flex min-h-11 items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />{t.remember}</label><p aria-live="polite" className="text-sm text-white/70">{nicknameText}</p></section>
      <section id="game-nominal" onKeyDown={nominalKeys} className="ax-glass rounded-2xl border border-white/10 p-5"><h2 className="font-display text-xl font-bold"><span className="mr-3 rounded-lg bg-[#FFB800]/15 px-3 py-1 text-[#FFB800]">2</span>{t.nominal}</h2><div className="mt-5 flex flex-wrap gap-2">{[t.allRanges, "≤100", "100–500", "500–2.000", ">2.000"].map((value, i) => <button key={value} type="button" onClick={() => setRange(i)} aria-pressed={range === i} className={`min-h-11 rounded-full border px-3 text-xs ${range === i ? "border-[#00E5FF] text-[#00E5FF]" : "border-white/15 text-white/70"} ${focus}`}>{value}</button>)}</div><input aria-label={t.searchAmount} placeholder={t.searchAmount} value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} mt-4`} />{groups.map(([group, title]) => { const items = visible.filter((p) => p.group === group); if (!items.length) return null; return <div key={group} className="mt-6"><h3 className="font-display font-bold">{title}</h3>{group === "all" && !showAll ? <button className={`mt-3 min-h-11 text-sm text-[#00E5FF] ${focus}`} onClick={() => setShowAll(true)}>{t.showAll} ({items.length})</button> : <div role="radiogroup" aria-label={title} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{items.map((p) => <label key={p.buyer_sku_code} className={`relative flex min-h-[72px] cursor-pointer gap-2 rounded-xl border px-2 py-2 transition duration-[160ms] motion-reduce:transition-none has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#00E5FF] ${sku === p.buyer_sku_code ? "border-[#00E5FF] bg-[#00E5FF]/10 shadow-[0_0_20px_rgba(0,229,255,.15)]" : "border-white/10 bg-white/[.03]"} ${!p.available ? "cursor-not-allowed opacity-60" : ""}`}><input type="radio" name="game-sku" value={p.buyer_sku_code} checked={sku === p.buyer_sku_code} disabled={!p.available || !!attempted.current} onChange={() => setSku(p.buyer_sku_code)} className="sr-only" /><CurrencyIcon currency={game.currency} /><span className="min-w-0 flex-1"><span className="line-clamp-2 text-sm font-semibold leading-4">{nominal(p.name, t.bonus).main} <span className="text-[10px] font-normal text-white/65">{nominal(p.name, t.bonus).unit}</span></span>{p.product_type_name && <span className="mt-0.5 block truncate text-[10px] text-white/50">{p.product_type_name}</span>}{nominal(p.name, t.bonus).extra && <span className="block text-[10px] leading-3 text-white/60">{nominal(p.name, t.bonus).extra}</span>}<span className="mt-1 block font-display text-xs font-bold leading-4">{p.available ? prices.text(p.price) : availabilityLabel(p, t)}</span>{p.group === "bestseller" && p.available && <span className="block text-[9px] leading-3 text-[#FFB800]">{t.bestseller}</span>}</span>{sku === p.buyer_sku_code && <Check size={16} className="ml-auto shrink-0 text-[#00E5FF]" />}</label>)}</div>}</div>; })}</section>
      <section id="game-payment" className="ax-glass rounded-2xl border border-white/10 p-5"><h2 className="font-display text-xl font-bold"><span className="mr-3 rounded-lg bg-[#FFB800]/15 px-3 py-1 text-[#FFB800]">3</span>{t.payment}</h2><div className="mt-5">{quote ? <><PaymentMethodPicker options={quote.options} selectedId={method} onSelect={setMethod} locale={locale} disabled={!!attempted.current} /><ul className="mt-4 space-y-1 text-xs text-white/65">{quote.options.filter((p) => p.available).map((p) => <li key={p.id}>{p.label}: {p.kind === "crypto" ? `US$${p.usdText}` : prices.text(p.kind === "gateway" ? p.totalIdr! : quote.total)}</li>)}</ul></> : <p className="text-sm text-white/60">{!orderingOpen ? t.previewPayment : quoteBusy ? t.loading : t.paymentHint}</p>}</div></section>
      <section id="game-contact" className="ax-glass rounded-2xl border border-white/10 p-5"><h2 className="font-display text-xl font-bold"><span className="mr-3 rounded-lg bg-[#FFB800]/15 px-3 py-1 text-[#FFB800]">4</span>{t.contact}</h2><p className="mt-4 text-sm text-white/60">{t.contactHint}</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm">{t.whatsappLabel}<input type="tel" autoComplete="tel" disabled={!!attempted.current} className={`${inputClass} mt-2`} value={wa} onChange={(e) => setWa(e.target.value)} /></label><label className="text-sm">{t.emailLabel}<input type="email" autoComplete="email" disabled={!!attempted.current} className={`${inputClass} mt-2`} value={email} onChange={(e) => setEmail(e.target.value)} /></label></div></section>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {recoveryCode && <Link href={`/games/pesanan/${recoveryCode}`} className="inline-flex min-h-11 items-center text-sm text-[#00E5FF]">{t.recoveryOrder} · {recoveryCode}</Link>}
    </div><aside className="hidden lg:block"><div className="ax-glass sticky top-24 rounded-2xl border border-white/10 p-6"><h2 className="font-display text-xl font-bold">{t.summary}</h2><p className="mt-5">{game.name}</p><p className="mt-2 text-sm text-white/60">{t.accountId}: {contract.map((field) => fields[field.key]).filter(Boolean).join(" / ") || t.noSelection}{nickname.state === "ok" && ` · ${nickname.value}`}</p><p className="mt-2 text-sm text-white/60">{t.amountLabel}: {selected ? `${nominal(selected.name, t.bonus).main} ${nominal(selected.name, t.bonus).unit}` : t.noSelection}</p><p className="mt-2 text-sm text-white/60">{t.method}: {option?.label ?? t.noSelection}</p><p className="mt-5 font-display text-lg font-bold">{option ? t.total : t.subtotal}: {totalText}</p><button onClick={pay} disabled={!orderingOpen || busy || !selected || !selected.available} className={`mt-5 min-h-12 w-full rounded-xl bg-[#00E5FF] font-bold text-[#080C1E] disabled:opacity-40 ${focus}`}>{!orderingOpen ? t.opensSoon : busy ? t.processing : !selected ? t.choose : t.pay}</button><a href={SITE.webUrl + waHubLink()} className="mt-4 block text-center text-sm text-[#00E5FF]">{t.whatsapp}</a></div></aside></div>
    <div className="ax-glass-strong fixed inset-x-0 bottom-0 z-30 flex min-h-16 items-center gap-3 border-t border-white/10 px-4 pb-[env(safe-area-inset-bottom)] lg:hidden"><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/60">{selected ? `${nominal(selected.name, t.bonus).main} ${nominal(selected.name, t.bonus).unit}` : t.noSelection}</p><p className="font-display font-bold">{totalText}</p></div><button onClick={pay} disabled={!orderingOpen || busy || !selected || !selected.available} className={`min-h-11 rounded-xl bg-[#00E5FF] px-5 text-sm font-bold text-[#080C1E] disabled:opacity-40 ${focus}`}>{!orderingOpen ? t.opensSoon : busy ? t.processing : !selected ? t.choose : t.pay}</button></div>
    </>}
  </div>;
}
