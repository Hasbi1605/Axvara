"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { isAvailableGateway, payCopy, type CryptoOption, type GatewayOption, type PayLocale, type PayOption, type QrisOption } from "@/lib/payment-ui";
import { methodLogo } from "@/lib/payments/method-logos";
import { getCryptoAsset } from "@/lib/payments/crypto-assets";
import { formatRupiah } from "@/lib/utils";

/**
 * Pemilih metode pembayaran checkout (props saja, tanpa fetch). Hanya merender opsi yang dikirim server; angka (biaya, total, USD,
 * batas, kekurangan) ditampilkan apa adanya dari quote dan tidak pernah dihitung ulang di sini.
 *
 * QRIS selalu tampil langsung di atas grup lain sebagai kartu radio native, tanpa header akordeon, chip, chevron, atau panel
 * tersembunyi; badge "Paling cepat" berada di judul kartu QRIS. Grup lain (Virtual Account · E-Wallet · Transfer lainnya · Crypto;
 * grup kosong tidak dirender) tetap akordeon: header = tombol native (`aria-expanded`/`aria-controls`) berisi baris chip logo;
 * membuka grup menampilkan semua metode yang ditawarkan dengan logo, biaya, dan batas. Hanya satu grup terbuka pada satu waktu:
 * membuka grup lain menutup yang sebelumnya, dan mengklik grup yang sama menutupnya; membuka/menutup tidak mengubah pilihan.
 * Menutup grup yang memuat pilihan menghapus pilihan eksplisit (selectedId null); header tertutup tidak menampilkan
 * ringkasan "Dipilih"/logo kedua. Grup Crypto memakai header khusus (judul + total USD + chip logo bulat) dan panel `CryptoPanel`
 * (pencarian bila >8 koin, subgrup Populer/Stablecoin, baris logo+simbol+jaringan; koin di bawah minimum nonaktif dengan "Min. US$x").
 * Satu grup radio native (`name="checkout-pay"`): radio di panel tersembunyi tidak bisa difokus.
 */
type Props = {
  options: PayOption[];
  selectedId: string | null;
  /** ID metode, atau null untuk deselect eksplisit (mis. menutup grup terpilih). */
  onSelect: (id: string | null) => void;
  locale?: PayLocale;
  /** Mengunci semua radio (mis. saat submit atau setelah submit ambigu). */
  disabled?: boolean;
  /** Teks status di bawah picker (mis. pemberitahuan pergantian ke QRIS atau kunci metode). */
  notice?: string | null;
  describedBy?: string;
};

type Copy = ReturnType<typeof payCopy>;
type GroupKey = "va" | "ewallet" | "other" | "crypto";

const FOCUS = "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#00E5FF]";
const HEADER_FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]";
const SURFACE = "ax-glass-card rounded-2xl border";
const MAX_CHIPS = 6;
const MAX_CHIPS_NARROW = 4;

function RadioDot({ checked }: { checked: boolean }) {
  return <span aria-hidden className={`h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center ${checked ? "border-[#00E5FF] bg-[#00E5FF]" : "border-white/20"}`}>{checked && <span className="h-2 w-2 rounded-full bg-[#080C1E]" />}</span>;
}

/**
 * Buka/tutup mulus (grid-template-rows 0fr -> 1fr + opacity, 220ms ease-out; buka dan tutup beranimasi bersamaan saat exclusive-open bertukar).
 * Isi TETAP terpasang selama animasi tutup; saat tertutup `inert` + `aria-hidden` + `visibility:hidden` (setelah transisi) sehingga tidak
 * bisa difokus dan tidak dibacakan. React 18 belum mengenal prop `inert`, jadi atributnya diatur lewat ref.
 */
const COLLAPSE_MOTION = "transition-[grid-template-rows,opacity,visibility] duration-[220ms] ease-out motion-reduce:transition-none";
function Collapse({ open, id, children }: { open: boolean; id?: string; children: React.ReactNode }) {
  // Atribut `inert` diatur lewat ref: React 18 membuang prop tak dikenal ber-nilai kosong pada build produksi.
  const setInert = (el: HTMLDivElement | null) => {
    if (!el) return;
    if (open) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  };
  return (
    <div ref={setInert} id={id} data-collapse={open ? "open" : "closed"} aria-hidden={open ? undefined : true} className={`grid ${COLLAPSE_MOTION} ${open ? "grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0"}`}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
const CHEVRON_MOTION = "transition-transform duration-[220ms] ease-out motion-reduce:transition-none";

const glyphOf = (option: PayOption) => (option.kind === "crypto" ? "wallet-48.png" : "bank-building-48.png");

/** Pelat logo 56×36. Logo terverifikasi di pelat putih; tanpa logo = pelat netral + glyph generik (bukan merek, huruf, atau emoji). */
function LogoPlate({ option }: { option: PayOption }) {
  const logo = methodLogo(option);
  if (logo) {
    return (
      <span aria-hidden className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo.src} alt="" aria-hidden width={44} height={24} className={`h-6 max-w-[44px] object-contain${logo.darken ? " brightness-0" : ""}`} draggable={false} />
      </span>
    );
  }
  return (
    <span aria-hidden data-logo-fallback className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md bg-white/10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/icons/ios11/${glyphOf(option)}`} alt="" aria-hidden width={20} height={20} className="h-5 w-5 object-contain brightness-0 invert opacity-70" draggable={false} />
    </span>
  );
}

/** Chip logo header grup (h-8 w-12). Metode tidak tersedia: redup. */
function LogoChip({ option, ring = false }: { option: PayOption; ring?: boolean }) {
  const logo = methodLogo(option);
  const dim = !option.available && !ring ? " opacity-50" : "";
  return (
    <span aria-hidden data-logo-chip className={`flex h-8 w-12 shrink-0 items-center justify-center rounded-md ${logo ? "bg-white" : "bg-white/10"}${ring ? " ring-1 ring-[#00E5FF]/60" : ""}${dim}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo ? logo.src : `/icons/ios11/${glyphOf(option)}`} alt="" aria-hidden width={36} height={20} className={logo ? `h-5 max-w-[36px] object-contain${logo.darken ? " brightness-0" : ""}` : "h-4 w-4 object-contain brightness-0 invert opacity-70"} draggable={false} />
    </span>
  );
}

type CardProps = {
  option: PayOption;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  name: React.ReactNode;
  meta: React.ReactNode;
  amount?: React.ReactNode;
  caption?: React.ReactNode;
  reason?: string;
};

/** Kartu metode: permukaan kaca QRIS yang sama untuk semua metode. Terpilih = border + titik radio saja. */
function PayOptionCard({ option, selected, disabled, onSelect, name, meta, amount, caption, reason }: CardProps) {
  const unavailable = !option.available;
  const reasonId = `pay-reason-${option.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return (
    <div>
      <label aria-disabled={unavailable || undefined} className={`grid min-h-[64px] grid-cols-[56px_minmax(0,1fr)_auto_20px] items-center gap-3 px-3 py-3 text-left transition ${SURFACE} ${FOCUS} ${selected ? "border-[#00E5FF]/50" : "border-white/10"} ${unavailable ? "cursor-not-allowed" : `cursor-pointer ${selected ? "" : "hover:bg-white/10"}`} ${!unavailable && disabled ? "opacity-60" : ""}`}>
        <input type="radio" name="checkout-pay" value={option.id} checked={selected} disabled={disabled || unavailable} onChange={onSelect} aria-describedby={unavailable && reason ? reasonId : undefined} className="sr-only" />
        <LogoPlate option={option} />
        <span className="min-w-0">
          <span className={`line-clamp-2 break-words text-[14px] font-semibold leading-5 ${unavailable ? "text-white/70" : "text-white"}`}>{name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-white/60">{meta}</span>
        </span>
        <span className="text-right tabular-nums whitespace-nowrap">
          {amount != null && <span className="block text-[14px] font-semibold leading-5 text-white">{amount}</span>}
          {caption != null && <span className="block text-[11px] leading-4 text-white/60">{caption}</span>}
        </span>
        <RadioDot checked={selected} />
      </label>
      {unavailable && reason && <p id={reasonId} className="px-3 pt-1 text-[12px] leading-4 text-[#FFD66B]">{reason}</p>}
    </div>
  );
}

type Shared = { selectedId: string | null; onSelect: (id: string | null) => void; disabled: boolean; copy: Copy };

function QrisCard({ option, selectedId, onSelect, disabled, copy, badge }: Shared & { option: QrisOption; badge?: string }) {
  return (
    <PayOptionCard
      option={option} selected={selectedId === option.id} disabled={disabled} onSelect={() => onSelect(option.id)} reason={copy.unavailable}
      name={<span className="inline-flex flex-wrap items-center gap-2">{option.label}{badge && <>{" "}<span className="rounded-full bg-[#00E5FF] px-2 py-0.5 text-[10px] font-bold leading-4 text-[#080C1E]">{badge}</span></>}</span>}
      meta={<span>{copy.qrisSub}</span>}
    />
  );
}

function gatewayReason(option: GatewayOption, copy: Copy): string {
  if (option.unavailableReason === "below_min" && option.shortfall !== null) return copy.shortfallReason(option.shortfall);
  if (option.unavailableReason === "above_max" && option.limits?.max != null) return copy.aboveMaxReason(option.limits.max);
  return copy.unavailable;
}

function GatewayCard({ option, selectedId, onSelect, disabled, copy }: Shared & { option: GatewayOption }) {
  // `sublabel` server (teks ID tetap) sengaja tidak dirender; angka apa adanya dari quote.
  const showMin = option.limits !== null && option.limits.min > 1;
  const available = isAvailableGateway(option);
  return (
    <PayOptionCard
      option={option} selected={selectedId === option.id} disabled={disabled} onSelect={() => onSelect(option.id)}
      reason={available ? undefined : gatewayReason(option, copy)}
      name={option.label}
      meta={<>
        {available && option.feeIdr > 0 ? <><span>{copy.gatewayFeeLabel}</span><span className="whitespace-nowrap">{copy.gatewayFeeAmount(option.feeIdr)}</span></> : null}
        {available && option.feeIdr > 0 && showMin ? <span aria-hidden>·</span> : null}
        {showMin ? <span className="whitespace-nowrap">{copy.minAmount(option.limits!.min)}</span> : null}
      </>}
      amount={available ? copy.gatewayTotal(option.totalIdr) : undefined}
      caption={available ? copy.gatewayTotalCaption : undefined}
    />
  );
}

/** Nama kripto: simbol + label jaringan dari server (tanpa mengulang bila sama), mis. "USDT · BNB Smart Chain". */
function cryptoName(option: CryptoOption): string {
  const network = (option.sublabel ?? "").trim();
  return network && network.toUpperCase() !== option.label.toUpperCase() ? `${option.label} · ${network}` : option.label;
}

function cryptoReason(option: CryptoOption, copy: Copy): string {
  return option.unavailableReason === "below_min" && option.minTotalText ? copy.cryptoMinReason(option.minTotalText, option.minIdr) : copy.unavailable;
}

/** Logo koin bulat (berkas lokal kurasi); tanpa logo = lingkaran netral + glyph dompet (bukan huruf/emoji). */
function CoinLogo({ option, size = 24, ring = false }: { option: CryptoOption; size?: 24 | 20; ring?: boolean }) {
  const logo = methodLogo(option);
  const box = size === 24 ? "h-6 w-6" : "h-5 w-5";
  return (
    <span aria-hidden data-coin-logo className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-full ${logo ? "" : "bg-white/10"}${ring ? " ring-2 ring-[#0B1228]" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo ? logo.src : "/icons/ios11/wallet-48.png"} alt="" aria-hidden width={size} height={size} className={logo ? `${box} object-contain` : "h-3.5 w-3.5 object-contain brightness-0 invert opacity-70"} draggable={false} />
    </span>
  );
}

const PREVIEW_SYMBOLS = ["BTC", "ETH", "USDT", "USDC"];
/** Chip header tertutup: BTC, ETH, USDT, USDC bila ada (satu per simbol), selebihnya urutan server; sisanya "+N". */
function previewCoins(options: CryptoOption[]): CryptoOption[] {
  const picked: CryptoOption[] = [];
  for (const symbol of PREVIEW_SYMBOLS) {
    const hit = options.find((option) => option.label.toUpperCase() === symbol);
    if (hit) picked.push(hit);
  }
  for (const option of options) {
    if (picked.length >= PREVIEW_SYMBOLS.length) break;
    if (!picked.includes(option)) picked.push(option);
  }
  return picked;
}

const SEARCH_THRESHOLD = 8;
const normalizeQuery = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
function coinHaystack(option: CryptoOption): string {
  const asset = getCryptoAsset(option.payCurrency);
  return normalizeQuery([option.label, option.sublabel, asset?.name, asset?.networkLabel, option.network, option.payCurrency].filter(Boolean).join(" "));
}

/** Satu baris per SIMBOL (urutan kemunculan = urutan kurasi server). Simbol dengan >1 jaringan diperluas menjadi pilihan jaringan. */
type SymbolEntry = { key: string; symbol: string; group: CryptoOption["group"]; options: CryptoOption[]; multi: boolean; anyAvailable: boolean };
function symbolEntries(options: CryptoOption[]): SymbolEntry[] {
  const map = new Map<string, SymbolEntry>();
  for (const option of options) {
    const key = option.label.trim().toUpperCase();
    const entry = map.get(key);
    if (entry) entry.options.push(option);
    else map.set(key, { key, symbol: option.label, group: option.group, options: [option], multi: false, anyAvailable: false });
  }
  return [...map.values()].map((entry) => ({ ...entry, multi: entry.options.length > 1, anyAvailable: entry.options.some((option) => option.available) }));
}

/** Teks "Min." terendah dari server untuk simbol yang semua jaringannya di bawah minimum (hanya memilih teks, bukan berhitung). */
function lowestMin(options: CryptoOption[]): CryptoOption | null {
  let best: CryptoOption | null = null;
  for (const option of options) {
    if (!option.minTotalText) continue;
    if (!best || Number(option.minTotalText) < Number(best.minTotalText)) best = option;
  }
  return best;
}

function MinLabel({ option, copy, id }: { option: CryptoOption | null; copy: Copy; id?: string }) {
  if (!option) return null;
  return (
    <span className="text-right text-[12px] leading-4 text-white/70">
      {option.minTotalText && <span className="block whitespace-nowrap font-semibold tabular-nums">{copy.cryptoMin(option.minTotalText)}</span>}
      {option.minIdr !== null && <span className="block whitespace-nowrap tabular-nums text-white/50">{copy.cryptoMinApprox(formatRupiah(option.minIdr))}</span>}
      {id && <span id={id} className="sr-only">{cryptoReason(option, copy)}</span>}
    </span>
  );
}

const reasonIdOf = (option: CryptoOption) => `pay-reason-${option.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
const ROW = "grid min-h-[48px] w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-left transition";

/** Simbol satu jaringan: radio langsung (memilih opsi itu). Di bawah minimum: baris nonaktif dengan "Min.". */
function SingleRow({ option, selected, disabled, onSelect, copy }: { option: CryptoOption; selected: boolean; disabled: boolean; onSelect: () => void; copy: Copy }) {
  const unavailable = !option.available;
  const reasonId = reasonIdOf(option);
  const network = (option.sublabel ?? "").trim();
  const showNetwork = network !== "" && network.toUpperCase() !== option.label.toUpperCase();
  return (
    <label
      aria-disabled={unavailable || undefined}
      className={`${ROW} ${FOCUS} ${selected ? "bg-white/[0.06] ring-1 ring-inset ring-[#00E5FF]/50" : ""} ${unavailable ? "cursor-not-allowed opacity-55" : `cursor-pointer ${selected ? "" : "hover:bg-white/[0.06]"}`} ${!unavailable && disabled ? "opacity-60" : ""}`}
    >
      <input type="radio" name="checkout-pay" value={option.id} checked={selected} disabled={disabled || unavailable} onChange={() => { if (!unavailable && !disabled) onSelect(); }} aria-describedby={unavailable ? reasonId : undefined} className="sr-only" />
      <CoinLogo option={option} />
      <span className="min-w-0 text-[14px] leading-5">
        <span className="font-semibold text-white">{option.label}</span>
        {showNetwork && <>{" "}<span className="ml-1 break-words text-[12px] font-normal text-white/60">{network}</span></>}
      </span>
      {unavailable ? <MinLabel option={option} copy={copy} id={reasonId} /> : <RadioDot checked={selected} />}
    </label>
  );
}

/** Simbol multi-jaringan: tombol buka/tutup (tanpa jaringan bawaan; pembeli harus memilih jaringan). Semua jaringan di bawah minimum: nonaktif. */
function ExpandRow({ entry, open, disabled, onToggle, copy, panelId }: { entry: SymbolEntry; open: boolean; disabled: boolean; onToggle: () => void; copy: Copy; panelId: string }) {
  const blocked = !entry.anyAvailable;
  const min = blocked ? lowestMin(entry.options) : null;
  const reasonId = `pay-reason-sym-${entry.key}`;
  return (
    <button
      type="button" disabled={disabled || blocked} aria-expanded={blocked ? undefined : open} aria-controls={blocked ? undefined : panelId} aria-describedby={blocked && min ? reasonId : undefined} onClick={onToggle}
      className={`${ROW} ${HEADER_FOCUS} ${blocked ? "cursor-not-allowed opacity-55" : `cursor-pointer ${open ? "bg-white/[0.06]" : "hover:bg-white/[0.06]"}`} ${!blocked && disabled ? "opacity-60" : ""}`}
    >
      <CoinLogo option={entry.options[0]} />
      <span className="min-w-0 text-[14px] leading-5">
        <span className="font-semibold text-white">{entry.symbol}</span>
        {" "}<span className="ml-1 text-[12px] font-normal text-white/60">{copy.cryptoNetworks(entry.options.length)}</span>
      </span>
      {blocked ? <MinLabel option={min} copy={copy} id={reasonId} /> : <ChevronDown aria-hidden className={`h-4 w-4 text-white/70 ${CHEVRON_MOTION} ${open ? "rotate-180" : ""}`} />}
    </button>
  );
}

/** Chip jaringan (radio native sr-only). Terpilih = border cyan + titik radio; di bawah minimum = nonaktif dengan "Min. US$x". */
function NetworkChip({ option, selected, disabled, onSelect, copy }: { option: CryptoOption; selected: boolean; disabled: boolean; onSelect: () => void; copy: Copy }) {
  const unavailable = !option.available;
  const reasonId = reasonIdOf(option);
  return (
    <label
      aria-disabled={unavailable || undefined} title={unavailable ? cryptoReason(option, copy) : undefined}
      className={`inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-[13px] leading-4 transition ${FOCUS} ${selected ? "border-[#00E5FF]/50 bg-white/[0.06] font-semibold text-white" : "border-white/10 text-white/85"} ${unavailable ? "cursor-not-allowed opacity-55" : `cursor-pointer ${selected ? "" : "hover:bg-white/[0.06]"}`} ${!unavailable && disabled ? "opacity-60" : ""}`}
    >
      <input type="radio" name="checkout-pay" value={option.id} checked={selected} disabled={disabled || unavailable} onChange={() => { if (!unavailable && !disabled) onSelect(); }} aria-describedby={unavailable ? reasonId : undefined} className="sr-only" />
      <RadioDot checked={selected} />
      <span className="min-w-0 break-words">
        {(option.sublabel ?? "").trim() || option.label}
        {unavailable && option.minTotalText && <span className="block text-[11px] font-normal text-white/60">{copy.cryptoMin(option.minTotalText)}</span>}
        {unavailable && <span id={reasonId} className="sr-only">{cryptoReason(option, copy)}</span>}
      </span>
    </label>
  );
}

function CryptoPanel({ options, shared, open }: { options: CryptoOption[]; shared: Shared; open: boolean }) {
  const { copy, selectedId, onSelect, disabled } = shared;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [closedAuto, setClosedAuto] = useState<ReadonlySet<string>>(new Set());
  const searchId = "pay-crypto-search";
  const entries = symbolEntries(options);
  const selectedOption = options.find((option) => option.id === selectedId) ?? null;
  const selectedKey = selectedOption ? selectedOption.label.trim().toUpperCase() : null;

  // Tutup grup = reset pencarian dan perluasan (daftar bersih saat dibuka lagi).
  useEffect(() => { if (!open) { setQuery(""); setExpanded(null); setClosedAuto(new Set()); } }, [open]);
  useEffect(() => { setClosedAuto(new Set()); }, [query]);
  // Pilihan dipulihkan pada simbol multi-jaringan: perluas simbol itu agar pilihan tidak tersembunyi.
  const selectedEntry = entries.find((entry) => entry.key === selectedKey) ?? null;
  const restoreKey = selectedEntry?.multi ? selectedEntry.key : null;
  useEffect(() => { if (restoreKey) setExpanded((current) => current ?? restoreKey); }, [restoreKey]);

  const searchable = entries.length > SEARCH_THRESHOLD;
  const tokens = searchable ? normalizeQuery(query).split(" ").filter(Boolean) : [];
  const matches = (option: CryptoOption) => { const hay = coinHaystack(option); return tokens.every((token) => hay.includes(token)); };
  const view = entries
    .map((entry) => {
      const visible = tokens.length === 0 ? entry.options : entry.options.filter(matches);
      const narrowed = tokens.length > 0 && entry.multi && visible.length < entry.options.length;
      return { entry, visible, narrowed };
    })
    .filter((item) => item.visible.length > 0);
  const isOpen = (item: (typeof view)[number]) => item.entry.multi && item.entry.anyAvailable && (expanded === item.entry.key || (item.narrowed && !closedAuto.has(item.entry.key)));

  const toggle = (item: (typeof view)[number]) => {
    const { entry } = item;
    if (isOpen(item)) {
      if (selectedKey === entry.key) onSelect(null); // menutup simbol menghapus jaringan yang dipilih di dalamnya
      if (expanded === entry.key) setExpanded(null);
      if (item.narrowed) setClosedAuto((current) => new Set(current).add(entry.key));
    } else {
      if (selectedOption) onSelect(null); // tanpa jaringan bawaan: membuka simbol lain menghapus pilihan crypto sebelumnya
      setExpanded(entry.key);
      setClosedAuto((current) => { const next = new Set(current); next.delete(entry.key); return next; });
    }
  };
  const pickSingle = (option: CryptoOption) => { setExpanded(null); onSelect(option.id); };

  // Urutan: subgrup Populer lalu Stablecoin (urutan kurasi server); di dalamnya simbol tersedia dulu, lalu yang semuanya di bawah minimum.
  const sorted = (items: typeof view) => [...items.filter((item) => item.entry.anyAvailable), ...items.filter((item) => !item.entry.anyAvailable)];
  const sections = ([
    { key: "popular", title: copy.cryptoSubPopular, items: sorted(view.filter((item) => item.entry.group === "popular")) },
    { key: "stable", title: copy.cryptoSubStable, items: sorted(view.filter((item) => item.entry.group === "stable")) },
  ]).filter((section) => section.items.length > 0);

  return (
    <div className="space-y-3">
      {searchable && (
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">{copy.cryptoSearchLabel}</label>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
          <input
            id={searchId} type="text" inputMode="search" autoComplete="off" autoCapitalize="none" spellCheck={false} value={query} disabled={disabled}
            onChange={(event) => setQuery(event.target.value)} placeholder={copy.cryptoSearchPlaceholder}
            className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-11 text-[14px] text-white outline-none placeholder:text-white/40 focus-visible:border-[#00E5FF]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF] disabled:opacity-60"
          />
          {query !== "" && (
            <button type="button" aria-label={copy.cryptoSearchClear} onClick={() => setQuery("")} className={`absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-white/70 hover:text-white ${HEADER_FOCUS}`}>
              <X aria-hidden className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {sections.map((section) => (
        <div key={section.key} role="group" aria-label={section.title}>
          <p aria-hidden className="px-1 pb-1.5 text-[12px] font-medium leading-4 text-white/50">{section.title}</p>
          <div className={`grid gap-0.5 p-1.5 ${SURFACE} border-white/10`}>
            {section.items.map((item) => {
              const { entry } = item;
              if (!entry.multi) {
                const option = entry.options[0];
                return <SingleRow key={entry.key} option={option} selected={selectedId === option.id} disabled={disabled} onSelect={() => pickSingle(option)} copy={copy} />;
              }
              const panelId = `pay-net-${entry.key}`;
              const openNow = isOpen(item);
              return (
                <div key={entry.key}>
                  <ExpandRow entry={entry} open={openNow} disabled={disabled} onToggle={() => toggle(item)} copy={copy} panelId={panelId} />
                  <Collapse open={openNow} id={panelId}>
                    <div role="radiogroup" aria-label={copy.cryptoNetworkGroup(entry.symbol)} className="flex flex-wrap gap-2 px-3 pb-2 pt-1">
                      {item.visible.map((option) => (
                        <NetworkChip key={option.id} option={option} selected={selectedId === option.id} disabled={disabled} onSelect={() => onSelect(option.id)} copy={copy} />
                      ))}
                    </div>
                  </Collapse>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {sections.length === 0 && <p role="status" className="px-1 text-[13px] text-white/60">{copy.cryptoSearchEmpty}</p>}
    </div>
  );
}

/** Ringkasan satu baris metode terpilih untuk header grup tertutup (angka dari quote). */
function selectedSummary(option: PayOption, copy: Copy): string {
  if (option.kind === "gateway") return isAvailableGateway(option) ? `${option.label} · est. ${copy.gatewayTotal(option.totalIdr)}` : option.label;
  if (option.kind === "crypto") return cryptoName(option);
  return option.label;
}

type Group = { key: GroupKey; title: string; options: PayOption[] };

function GroupSection({ group, open, onToggle, selected, shared }: { group: Group; open: boolean; onToggle: () => void; selected: PayOption | null; shared: Shared }) {
  const { copy, disabled } = shared;
  const panelId = `pay-group-${group.key}`;
  const total = group.options.length;
  const availableCount = group.options.filter((option) => option.available).length;
  const gatewayGroup = group.key === "va" || group.key === "ewallet" || group.key === "other";
  const chips = group.options.slice(0, MAX_CHIPS);
  const cryptoGroup = group.key === "crypto";
  const cryptoOptions = cryptoGroup ? (group.options as CryptoOption[]) : [];
  const symbolCount = new Set(cryptoOptions.map((option) => option.label.trim().toUpperCase())).size;
  // Total USD identik untuk semua koin (angka server apa adanya); tanpa koin tersedia tidak ada keterangan jumlah.
  const firstCoin = cryptoOptions.find((option) => option.available);
  const caption = firstCoin ? copy.cryptoCaption(firstCoin.usdText, firstCoin.surchargeBps) : null;
  const summary = !open && selected ? selectedSummary(selected, copy) : null;
  const countText = gatewayGroup ? (availableCount === 0 ? copy.noneAvailable : copy.availableCount(availableCount)) : null;
  const name = [group.title, copy.methodsCount(total), countText, summary ? `${copy.selectedPrefix}: ${summary}` : null].filter(Boolean).join(", ");
  return (
    <section>
      <button
        type="button" disabled={disabled} aria-expanded={open} aria-controls={panelId} aria-label={name} onClick={onToggle}
        className={`flex min-h-[64px] w-full flex-col gap-2 px-3 py-3 text-left transition hover:bg-white/10 disabled:opacity-60 ${SURFACE} ${selected ? "border-[#00E5FF]/50" : "border-white/10"} ${HEADER_FOCUS}`}
      >
        <span className="flex w-full items-start gap-2">
          <span className="min-w-0">
            <span className={cryptoGroup ? "block text-[14px] font-semibold leading-5 text-white" : "block text-[13px] font-semibold uppercase tracking-[0.06em] text-white/80"}>{group.title}</span>
            {caption && <span data-crypto-caption className="mt-0.5 block text-[12px] font-normal leading-4 text-white/60">{caption}</span>}
          </span>
          {countText && <span className={`ml-auto text-[12px] leading-4 ${availableCount === 0 ? "text-[#FFD66B]" : "text-white/60"}`}>{countText}</span>}
          <ChevronDown aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 text-white/70 ${CHEVRON_MOTION} ${countText ? "" : "ml-auto"} ${open ? "rotate-180" : ""}`} />
        </span>
        {cryptoGroup ? (
          <span data-coin-chips className="flex w-full items-center">
            <span className="flex items-center -space-x-1.5">
              {previewCoins(cryptoOptions).map((option) => <CoinLogo key={option.id} option={option} ring />)}
            </span>
            {symbolCount > previewCoins(cryptoOptions).length && <span aria-hidden className="ml-2 text-[12px] text-white/60">{copy.moreChips(symbolCount - previewCoins(cryptoOptions).length)}</span>}
          </span>
        ) : (
          <span className="flex w-full flex-wrap items-center gap-1.5">
            {chips.map((option, index) => (
              <span key={option.id} className={index >= MAX_CHIPS_NARROW ? "max-[420px]:hidden" : undefined}><LogoChip option={option} /></span>
            ))}
            {total > MAX_CHIPS && <span aria-hidden className="text-[12px] text-white/60 max-[420px]:hidden">{copy.moreChips(total - MAX_CHIPS)}</span>}
            {total > MAX_CHIPS_NARROW && <span aria-hidden className="hidden text-[12px] text-white/60 max-[420px]:inline">{copy.moreChips(total - MAX_CHIPS_NARROW)}</span>}
          </span>
        )}
        {summary && selected && (
          <span data-selected-summary className="flex w-full items-center gap-2 text-[12px] leading-4 text-white">
            {selected.kind === "crypto" ? <CoinLogo option={selected} /> : <LogoChip option={selected} ring />}
            <span className="min-w-0">{copy.selectedPrefix}: {summary}</span>
          </span>
        )}
      </button>
      <Collapse open={open} id={panelId}>
        <div className="space-y-2 pt-2">
          {cryptoGroup ? <CryptoPanel options={cryptoOptions} shared={shared} open={open} /> : group.options.map((option) => (
            option.kind === "qris" ? <QrisCard key={option.id} option={option} {...shared} />
              : option.kind === "gateway" ? <GatewayCard key={option.id} option={option} {...shared} />
              : null
          ))}
        </div>
      </Collapse>
    </section>
  );
}

export function PaymentMethodPicker({ options, selectedId, onSelect, locale = "id", disabled = false, notice = null, describedBy }: Props) {
  const copy = payCopy(locale);
  const [openGroup, setOpenGroup] = useState<GroupKey | null>(null);
  const seeded = useRef(false);

  const qris = options.filter((option): option is QrisOption => option.kind === "qris");
  const gateways = options.filter((option): option is GatewayOption => option.kind === "gateway");
  const cryptos = options.filter((option): option is CryptoOption => option.kind === "crypto");
  // Urutan: tersedia dulu (urutan server), lalu tidak tersedia (urutan server).
  const ordered = <T extends PayOption>(list: T[]): T[] => [...list.filter((option) => option.available), ...list.filter((option) => !option.available)];
  const groups: Group[] = ([
    { key: "va", title: copy.groupVa, options: ordered(gateways.filter((option) => option.group === "va")) },
    { key: "ewallet", title: copy.groupEwallet, options: ordered(gateways.filter((option) => option.group === "ewallet")) },
    { key: "other", title: copy.groupOther, options: ordered(gateways.filter((option) => option.group === "other")) },
    { key: "crypto", title: copy.groupCrypto, options: cryptos }, // urutan kurasi server; CryptoPanel mengelompokkan per simbol
  ] as Group[]).filter((group) => group.options.length > 0);

  const selected = options.find((option) => option.id === selectedId) ?? null;
  const groupOf = (option: PayOption | null): GroupKey | "qris" | null => (!option ? null : option.kind === "qris" ? "qris" : option.kind === "crypto" ? "crypto" : option.group);
  const selectedGroup = groupOf(selected);

  // Awal: satu grup non-QRIS yang memuat pilihan terbuka (mis. pilihan dipulihkan dari quote). QRIS selalu terlihat, tanpa state buka.
  useEffect(() => {
    if (seeded.current || !selectedGroup || selectedGroup === "qris") return;
    seeded.current = true;
    setOpenGroup(selectedGroup);
  }, [selectedGroup]);

  if (options.length === 0) {
    return <p role="status" className="rounded-2xl border border-white/10 p-4 text-sm text-white/65">{copy.noOptions}</p>;
  }

  // Menutup grup (langsung atau karena membuka grup lain) menghapus pilihan yang ada di grup itu; QRIS tidak tersentuh.
  const toggleGroup = (key: GroupKey) => {
    if (disabled) return;
    if (openGroup !== null && selectedGroup === openGroup) onSelect(null);
    setOpenGroup((current) => (current === key ? null : key));
  };

  const shared: Shared = { selectedId, onSelect, disabled, copy };
  return (
    <div>
      <fieldset aria-describedby={describedBy} className="grid gap-3 border-0 p-0">
        <legend className="sr-only">{copy.legendMethod}</legend>
        {qris.length > 0 && (
          <div className="grid gap-2">
            {qris.map((option, index) => (
              <QrisCard key={option.id} option={option} {...shared} badge={index === 0 ? copy.fastest : undefined} />
            ))}
          </div>
        )}
        {groups.map((group) => (
          <GroupSection
            key={group.key} group={group} shared={shared}
            open={openGroup === group.key}
            onToggle={() => toggleGroup(group.key)}
            selected={selectedGroup === group.key ? selected : null}
          />
        ))}
        {gateways.length > 0 && <p className="text-[12px] leading-4 text-white/60">{copy.gatewayNote}</p>}
      </fieldset>
      {notice && <p role="status" aria-live="polite" className="mt-3 rounded-xl border border-[#FFB800]/25 bg-[#FFB800]/10 px-3 py-2 text-xs text-[#FFD66B]">{notice}</p>}
    </div>
  );
}
