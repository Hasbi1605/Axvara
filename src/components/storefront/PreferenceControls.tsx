"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { usePreferences } from "@/hooks/usePreferences";
import { useDisplayContext, useDisplayPrices } from "@/hooks/useDisplayPrices";
import { catalogCopy } from "@/lib/i18n/catalog-copy";
import type { DisplayCurrency, Locale } from "@/lib/i18n/locale";

/**
 * Kontrol bahasa + mata uang tampilan: SATU tombol bendera bulat di header (semua lebar) yang membuka SATU menu ringkas dengan dua bagian
 * yang SALING BEBAS (pola Amazon): Bahasa (Indonesia / English UK) dan Mata uang (Rupiah / US Dollar), masing-masing grup radio native.
 * Memilih salah satu hanya menulis cookie preferensi itu (lihat usePreferences) lalu me-refresh komponen server; tidak mengubah quote,
 * pesanan, rel pembayaran, atau bukti akses; memilih bahasa TIDAK mengubah mata uang. Mata uang tetap terlihat di setiap harga ("Rp"/"US$").
 * Tanpa konversi di klien: USD hanya tampil bila server menyuplai angka terkonversi. Belum ada nilai eksplisit/otomatis (null) =
 * ikon globe netral dan tanpa centang; bendera tidak pernah ditebak.
 */
const OPTIONS = {
  locale: [
    { value: "id", name: "Indonesia", display: { id: "Bahasa Indonesia", en: "Bahasa Indonesia" }, flag: "/flags/id.svg" },
    { value: "en", name: "English (UK)", display: { id: "English (UK)", en: "English (UK)" }, flag: "/flags/gb.svg" },
  ] as const,
  currency: [
    { value: "IDR", name: "Rupiah (IDR)", symbol: "Rp", display: "Rupiah (IDR)" },
    { value: "USD", name: "US Dollar (USD)", symbol: "US$", display: "US Dollar (USD)" },
  ] as const,
};

function dict(locale: Locale) {
  const id = locale === "id";
  return {
    button: id ? "Bahasa dan mata uang" : "Language and currency",
    language: id ? "Bahasa" : "Language",
    currency: id ? "Mata uang" : "Currency",
    unset: id ? "belum dipilih" : "not chosen yet",
    orders: id ? "Pesanan yang sudah dibuat tidak berubah." : "Existing orders don't change.",
  };
}

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]";
const OPTION_FOCUS = "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#00E5FF]";

/** Catatan jujur bila USD dipilih tetapi konversi server tidak tersedia (hook harga yang sama, tanpa FX di klien). */
function FxFallbackNote({ locale }: { locale: Locale }) {
  const prices = useDisplayPrices([0]);
  if (prices.status !== "unavailable") return null;
  return <p>{catalogCopy(locale).pricesInIdr}</p>;
}

function Row({ name, checked, onSelect, children }: { name: string; checked: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm ${OPTION_FOCUS} ${checked ? "text-white" : "text-white/75 hover:bg-white/[0.06] hover:text-white"}`}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
      {checked ? <Check aria-hidden className="ml-auto h-4 w-4 shrink-0" /> : <span aria-hidden className="ml-auto h-4 w-4 shrink-0" />}
    </label>
  );
}

export function PreferenceControls() {
  const { locale, currency, setLocale, setCurrency } = usePreferences();
  const { resolvedLocale, resolvedCurrency } = useDisplayContext();
  const effectiveLocale = locale ?? resolvedLocale;
  const effectiveCurrency = currency ?? resolvedCurrency;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const t = dict(effectiveLocale ?? "id");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [open]);

  const localeOption = OPTIONS.locale.find((option) => option.value === effectiveLocale);
  const currencyOption = OPTIONS.currency.find((option) => option.value === effectiveCurrency);
  const accessibleName = `${t.button}: ${localeOption ? localeOption.name : `${t.language} ${t.unset}`}, ${currencyOption ? currencyOption.name : `${t.currency} ${t.unset}`}`;
  const lang = effectiveLocale ?? "id";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={accessibleName}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-11 w-11 items-center justify-center gap-1 rounded-full transition hover:bg-white/10 sm:w-14 ${FOCUS}`}
      >
        {localeOption ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={localeOption.flag} alt="" aria-hidden width={24} height={24} data-flag className="h-6 w-6 rounded-full object-cover ring-1 ring-white/20" draggable={false} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/icons/ios11/globe-48.png" alt="" aria-hidden width={24} height={24} data-globe className="h-6 w-6 object-contain brightness-0 invert opacity-80" draggable={false} />
        )}
        <ChevronDown aria-hidden className={`hidden h-3 w-3 text-white/70 transition-transform motion-reduce:transition-none sm:block ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t.button}
          className="fixed right-3 top-[72px] z-[60] w-[min(320px,calc(100vw-1.5rem))] rounded-2xl border border-white/10 bg-[#0B1025] p-2 text-left shadow-[0_24px_64px_rgba(0,0,0,0.6)] sm:absolute sm:right-0 sm:top-[calc(100%+8px)]"
        >
          <fieldset className="border-0 p-0">
            <legend className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">{t.language}</legend>
            {OPTIONS.locale.map((option) => (
              <Row key={option.value} name="axv-pref-locale" checked={effectiveLocale === option.value} onSelect={() => setLocale(option.value as Locale)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={option.flag} alt="" aria-hidden width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-white/20" draggable={false} />
                <span>{option.display[lang]}</span>
              </Row>
            ))}
          </fieldset>
          <div aria-hidden className="my-1 h-px bg-white/10" />
          <fieldset className="border-0 p-0">
            <legend className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">{t.currency}</legend>
            {OPTIONS.currency.map((option) => (
              <Row key={option.value} name="axv-pref-currency" checked={effectiveCurrency === option.value} onSelect={() => setCurrency(option.value as DisplayCurrency)}>
                <span aria-hidden className="w-9 shrink-0 text-center text-[13px] font-semibold text-white/80">{option.symbol}</span>
                <span>{option.display}</span>
              </Row>
            ))}
          </fieldset>
          <div className="mt-1 space-y-1 px-2 pb-1 pt-2 text-[11px] leading-4 text-white/60" role="status">
            {effectiveCurrency === "USD" && <FxFallbackNote locale={lang} />}
            <p>{t.orders}</p>
          </div>
        </div>
      )}
    </div>
  );
}
