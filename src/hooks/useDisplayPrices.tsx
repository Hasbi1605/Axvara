"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CHANGE_EVENT, readExplicitPreferences } from "@/hooks/usePreferences";
import type { DisplayCurrency, Locale } from "@/lib/i18n/locale";
import { formatUsdCentsText } from "@/lib/payment-ui";
import { formatRupiah } from "@/lib/utils";

/**
 * Tampilan katalog: bahasa + mata uang dan harga USD hasil konversi SERVER.
 *
 * - Cookie eksplisit valid (axv_locale / axv_currency) selalu menang segera.
 *   Tanpa cookie, selalu Indonesia/IDR tanpa request deteksi atau menulis cookie.
 * - Harga USD = `usdCents` dari POST /api/display-prices; tiap angka IDR yang
 *   perlu tampil (satuan, total baris, subtotal, hemat) dikirim sebagai
 *   masukan sendiri. Tidak pernah mengalikan USD satuan dengan qty dan tidak
 *   ada kurs/FX di klien.
 * - Preferensi hanya mengubah tampilan: quote, pesanan, invoice dan rel
 *   pembayaran yang sudah ada tidak disentuh.
 */
const ENDPOINT = "/api/display-prices";
const MAX_CHUNK = 64;
const TIMEOUT_MS = 8000;
const DEBOUNCE_MS = 200;

type DisplayContextValue = {
  locale: Locale;
  currency: DisplayCurrency;
  /** Default tetap, tanpa deteksi browser atau wilayah. */
  resolvedLocale: Locale | null;
  resolvedCurrency: DisplayCurrency | null;
  /** Cookie klien sudah dibaca: aman memuat harga. */
  settled: boolean;
  /** Naik tiap preferensi eksplisit berubah: harga harus diambil ulang. */
  version: number;
};

const DEFAULT_CONTEXT: DisplayContextValue = { locale: "id", currency: "IDR", resolvedLocale: "id", resolvedCurrency: "IDR", settled: true, version: 0 };
const DisplayContext = createContext<DisplayContextValue>(DEFAULT_CONTEXT);

export function useDisplayContext(): DisplayContextValue { return useContext(DisplayContext); }
export function useDisplayLocale(): Locale { return useContext(DisplayContext).locale; }

function isLocale(value: unknown): value is Locale { return value === "id" || value === "en"; }
function isCurrency(value: unknown): value is DisplayCurrency { return value === "IDR" || value === "USD"; }

type Parsed = { locale: Locale; currency: DisplayCurrency; effectiveAt: string | null; available: boolean; cents: Array<{ idr: number; usdCents: string | null }> };

async function postAmounts(amounts: number[], signal: AbortSignal): Promise<Parsed> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amounts }),
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new Error(`display_prices_${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  const fx = (data.fx ?? {}) as Record<string, unknown>;
  const items = data.items;
  if (!isLocale(data.locale) || !isCurrency(data.currency) || !Array.isArray(items) || items.length !== amounts.length) throw new Error("display_prices_shape");
  return {
    locale: data.locale,
    currency: data.currency,
    available: fx.available === true,
    effectiveAt: typeof fx.effectiveAt === "string" ? fx.effectiveAt : null,
    cents: items.map((item) => {
      const row = item as Record<string, unknown>;
      return { idr: Number(row.idr), usdCents: typeof row.usdCents === "string" ? row.usdCents : null };
    }),
  };
}

/** Request dengan batas waktu; membatalkan juga bila `signal` luar dibatalkan. */
async function postWithTimeout(amounts: number[], signal: AbortSignal): Promise<Parsed> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await postAmounts(amounts, controller.signal); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
}

export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const [explicit, setExplicit] = useState<{ locale: Locale | null; currency: DisplayCurrency | null }>({ locale: null, currency: null });
  const [mounted, setMounted] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const sync = () => { setExplicit(readExplicitPreferences()); setVersion((value) => value + 1); };
    setExplicit(readExplicitPreferences());
    setMounted(true);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const locale = explicit.locale ?? "id";
  const currency = explicit.currency ?? "IDR";

  useEffect(() => {
    if (mounted && document.documentElement.lang !== locale) document.documentElement.lang = locale;
  }, [mounted, locale]);

  const value = useMemo<DisplayContextValue>(() => ({
    locale, currency, settled: mounted, version,
    resolvedLocale: "id",
    resolvedCurrency: "IDR",
  }), [locale, currency, mounted, version]);
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

export type PriceStatus = "idle" | "loading" | "ready" | "unavailable";

export type DisplayPrices = {
  locale: Locale;
  currency: DisplayCurrency;
  status: PriceStatus;
  /** Teks harga utama dalam mata uang pilihan (IDR bila USD belum/tidak tersedia). Memuat = "…". */
  text: (idr: number) => string;
  /** Setara dalam mata uang lain ("≈ US$…" / "≈ Rp…"), hanya bila server sudah menyuplai. */
  equivalent: (idr: number) => string | null;
};

/** Nominal IDR > 0 yang membulat ke 0 sen tidak boleh terlihat gratis. */
export function usdText(cents: string, idr: number, locale: Locale): string {
  if (cents === "0" && idr > 0) return locale === "en" ? "< US$0.01" : "< US$0,01";
  return formatUsdCentsText(cents, locale) ?? formatRupiah(idr);
}

/** Pembantu murni: potong daftar jadi kelompok <= 64 tanpa mengubah urutan. */
export function chunkAmounts(amounts: readonly number[], size = MAX_CHUNK): number[][] {
  const out: number[][] = [];
  for (let index = 0; index < amounts.length; index += size) out.push(amounts.slice(index, index + size));
  return out;
}

const validAmount = (value: number) => Number.isSafeInteger(value) && value >= 0;

/**
 * Cache sen USD (stale-while-revalidate). `ctxKey` = (version, bahasa, mata uang) saat ditulis; cache hanya dipakai bila masih sama.
 * `fx*` = lingkup respons server terakhir: respons dengan effectiveAt/bahasa/mata uang berbeda MENGGANTI cache (tidak digabung).
 * `failedKey` = daftar nominal terakhir yang gagal/tidak tersedia (tidak diminta ulang terus-menerus; status "unavailable").
 */
type Store = { ctxKey: string; effectiveAt: string | null; locale: Locale; currency: DisplayCurrency; cents: Record<number, string>; failedKey: string | null };

/**
 * Satu pemilik async per koleksi/halaman/keranjang. `amounts` = semua nominal
 * IDR (sudah diskon) yang akan ditampilkan; dedupe, <= 64 per request.
 * Nominal yang sudah diketahui TIDAK pernah dikosongkan saat daftar berubah
 * (mis. qty +/-): hanya nominal yang belum diketahui yang diminta (debounce
 * seperti biasa) dan digabung ke cache selama lingkupnya sama. Perubahan
 * preferensi (version), respons dengan lingkup berbeda, atau "tidak tersedia"
 * mengosongkan cache. Status "loading" hanya selama ada nominal diminta yang
 * belum diketahui. Klien tidak pernah mengalikan/menghitung USD.
 */
export function useDisplayPrices(amounts: readonly number[], options: { secondary?: boolean; debounce?: boolean } = {}): DisplayPrices {
  const ctx = useDisplayContext();
  const wantsUsd = ctx.settled && (ctx.currency === "USD" || options.secondary === true);
  const unique = Array.from(new Set(amounts.filter(validAmount)));
  const key = unique.join(",");
  const ctxKey = `${ctx.version}|${ctx.locale}|${ctx.currency}`;
  const [store, setStore] = useState<Store | null>(null);
  const requested = useRef(false);

  const valid = store && store.ctxKey === ctxKey ? store : null;
  const missing = wantsUsd ? unique.filter((idr) => valid?.cents[idr] === undefined) : [];
  const failed = valid !== null && valid.failedKey === key;
  const fetchKey = wantsUsd && !failed ? missing.join(",") : "";

  useEffect(() => {
    if (fetchKey === "") return;
    const list = fetchKey.split(",").map(Number);
    const controller = new AbortController();
    let live = true;
    const run = async () => {
      let parsed: { scope: { effectiveAt: string | null; locale: Locale; currency: DisplayCurrency }; map: Record<number, string> } | "unavailable" | "error";
      try {
        const chunks = chunkAmounts(list);
        const responses = await Promise.all(chunks.map((chunk) => postWithTimeout(chunk, controller.signal)));
        const first = responses[0];
        const consistent = responses.every((r) => r.available === first.available && r.effectiveAt === first.effectiveAt && r.locale === first.locale && r.currency === first.currency);
        parsed = "unavailable";
        if (consistent && first.available) {
          const map: Record<number, string> = {};
          let complete = true;
          responses.forEach((response, chunkIndex) => response.cents.forEach((item, index) => {
            if (item.idr !== chunks[chunkIndex][index] || item.usdCents === null || !/^\d{1,15}$/.test(item.usdCents)) complete = false;
            else map[item.idr] = item.usdCents;
          }));
          if (complete) parsed = { scope: { effectiveAt: first.effectiveAt, locale: first.locale, currency: first.currency }, map };
        }
      } catch { parsed = "error"; }
      if (!live) return;
      setStore((previous) => {
        const same = previous && previous.ctxKey === ctxKey ? previous : null;
        if (parsed === "error") return { ctxKey, effectiveAt: same?.effectiveAt ?? null, locale: same?.locale ?? ctx.locale, currency: same?.currency ?? ctx.currency, cents: same?.cents ?? {}, failedKey: key }; // galat jaringan: nilai lama dipertahankan bila lingkup sama
        if (parsed === "unavailable") return { ctxKey, effectiveAt: null, locale: ctx.locale, currency: ctx.currency, cents: {}, failedKey: key }; // FX hilang/tak konsisten: kosongkan
        const sameScope = same !== null && same.effectiveAt === parsed.scope.effectiveAt && same.locale === parsed.scope.locale && same.currency === parsed.scope.currency;
        return { ctxKey, ...parsed.scope, cents: sameScope ? { ...same.cents, ...parsed.map } : parsed.map, failedKey: null };
      });
    };
    // Pengambilan pertama langsung; ubahan berikutnya (qty/ketik) di-debounce.
    const delay = options.debounce && requested.current ? DEBOUNCE_MS : 0;
    requested.current = true;
    const timer = setTimeout(run, delay);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, ctxKey]);

  const status: PriceStatus = !wantsUsd || key === "" ? "idle" : missing.length === 0 ? "ready" : failed ? "unavailable" : "loading";
  const centsOf = (idr: number) => (wantsUsd ? valid?.cents[idr] ?? null : null);

  return {
    locale: ctx.locale,
    currency: ctx.currency,
    status,
    text: (idr) => {
      if (ctx.currency !== "USD") return formatRupiah(idr);
      const cents = centsOf(idr);
      if (cents !== null) return usdText(cents, idr, ctx.locale);
      return status === "loading" ? "…" : formatRupiah(idr);
    },
    equivalent: (idr) => {
      const cents = centsOf(idr);
      if (cents === null) return null;
      return ctx.currency === "USD" ? `≈ ${formatRupiah(idr)}` : `≈ ${usdText(cents, idr, ctx.locale)}`;
    },
  };
}

/** Bentuk IDR murni untuk pemanggil tanpa koleksi harga (mis. kartu di luar toko). */
export const IDR_PRICES: DisplayPrices = {
  locale: "id", currency: "IDR", status: "idle",
  text: (idr) => formatRupiah(idr),
  equivalent: () => null,
};
