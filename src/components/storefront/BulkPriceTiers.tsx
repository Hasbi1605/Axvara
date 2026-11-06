"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { BulkTier } from "@/lib/bulk-pricing";
import {
  activeTier,
  bulkCopy,
  bulkRows,
  nextReachableTier,
  tierLimitReason,
  type BulkLocale,
} from "@/lib/bulk-display";
import { formatRupiah } from "@/lib/utils";

type Props = {
  /** `full` = daftar lengkap di PDP; `compact` = baris aktif + tier berikut + daftar di <details>. */
  mode: "full" | "compact";
  basePrice: number;
  /** Tier yang SUDAH divalidasi (lihat usableBulkTiers). Kosong = tidak merender apa pun. */
  tiers: BulkTier[];
  minQty: number;
  /** Jumlah terpilih saat ini untuk varian ini. */
  qty: number;
  /** Batas beli efektif (min dari stok efektif, plafon unik/baris). */
  maxQty: number;
  /** Stok efektif (-1 = tak terbatas) dan plafon per pesanan: hanya untuk alasan tier tak tercapai. */
  stockMax: number;
  capMax: number;
  /** Aksi tombol tier berikutnya; pemanggil meng-clamp ke batas yang sudah ada. */
  onSetQty: (qty: number) => void;
  /** Id input qty: fokus pindah ke sini bila tombol hilang setelah ditekan. */
  qtyInputId?: string;
  locale?: BulkLocale;
  format?: (idr: number) => string;
};

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]";

/**
 * Rincian harga grosir sebagai BARIS tier (R1): rentang jumlah inklusif dari min_qty asli + harga satuan, satu daftar baris. Baris aktif
 * netral `bg-white/[0.05]` dengan label terlihat "· jumlahmu"/"· your qty"; tanpa garis/wash cyan, glow, atau chip persen. Matematika
 * harga, agregasi, stok dan plafon tidak diubah di sini.
 */
function TierList({ base, tiers, minQty, qty, maxQty, stockMax, capMax, locale, format }: {
  base: number; tiers: BulkTier[]; minQty: number; qty: number; maxQty: number; stockMax: number; capMax: number;
  locale: BulkLocale; format: (idr: number) => string;
}) {
  const copy = bulkCopy(locale);
  const rows = bulkRows(base, tiers, minQty);
  return (
    <ul aria-label={copy.list} className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      {rows.map((row) => {
        const active = qty >= row.start && (row.end === null || qty <= row.end);
        const unreachable = row.kind === "tier" && row.threshold > maxQty;
        const reason = row.kind === "tier" && unreachable ? tierLimitReason({ min_qty: row.threshold, unit_price: row.price }, { stockMax, capMax }) : null;
        return (
          <li
            key={`${row.kind}-${row.start}`}
            aria-current={active ? "true" : undefined}
            className={`flex min-h-11 flex-wrap items-center justify-between gap-x-3 px-4 py-2 text-[13px] tabular-nums ${active ? "bg-white/[0.06] text-white" : "font-normal text-white/70"} ${unreachable ? "opacity-50" : ""}`}
          >
            <span className={`min-w-0 ${active ? "font-semibold" : "font-normal"}`}>
              {copy.range(row.start, row.end)}
              {active && <span className="ml-1 text-[12px] font-normal text-white/50">{" "}· {copy.activeMark.toLowerCase()}</span>}
            </span>
            <span className="shrink-0 whitespace-nowrap">
              {unreachable ? (
                <span className="text-[11px] text-white/55">{reason === "stock" ? copy.unreachStock : copy.unreachCap(capMax)}</span>
              ) : (
                <span className={active ? "font-semibold" : "font-normal"}>{format(row.price)}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function BulkPriceTiers({ mode, basePrice, tiers, minQty, qty, maxQty, stockMax, capMax, onSetQty, qtyInputId, locale = "id", format = formatRupiah }: Props) {
  const copy = bulkCopy(locale);
  const hintRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  // Setelah tombol ditekan: fokus tetap di tombol; bila tier berikutnya
  // hilang (tombol dilepas), fokus pindah ke input jumlah.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (hintRef.current) hintRef.current.focus();
    else if (qtyInputId) document.getElementById(qtyInputId)?.focus();
  });

  if (tiers.length === 0) return null;

  const current = activeTier(tiers, qty);
  const unit = current ? current.unit_price : basePrice;
  const next = nextReachableTier(tiers, qty, maxQty);
  // Satu pengumuman sopan; teksnya hanya berubah saat tier aktif berganti,
  // bukan di setiap ketukan jumlah.
  const announcement = current ? copy.liveOn(format(unit)) : copy.liveOff(format(unit));

  const hint = next ? (
    <button
      ref={hintRef}
      type="button"
      onClick={() => { refocus.current = true; onSetQty(next.min_qty); }}
      className={`inline-flex min-h-11 items-center gap-1.5 text-left text-xs font-semibold text-[#00E5FF] hover:underline ${FOCUS}`}
    >
      <span>{copy.nextLead(next.min_qty - qty)}</span>{" "}
      <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="tabular-nums">{format(next.unit_price)}/pcs</span>
    </button>
  ) : null;

  const list = <TierList base={basePrice} tiers={tiers} minQty={minQty} qty={qty} maxQty={maxQty} stockMax={stockMax} capMax={capMax} locale={locale} format={format} />;

  if (mode === "compact") {
    return (
      <div data-testid="bulk-compact">
        <p className="text-xs tabular-nums text-white/70">{current ? copy.unitGrosir(format(unit), current.min_qty) : `${format(unit)}/pcs`}</p>
        {hint}
        <details className="group">
          <summary className={`flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-white/60 hover:text-white ${FOCUS}`}>{copy.disclosure}<ChevronDown aria-hidden className="ml-1 h-3 w-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
          <div className="pb-2">{list}</div>
        </details>
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      </div>
    );
  }

  return (
    <div className="mt-4" data-testid="bulk-full">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-[14px] font-semibold leading-5 text-white/80">{copy.heading}</h4>
        <span className="text-[12px] text-white/45">{copy.perUnit}</span>
      </div>
      <div className="mt-2">{list}</div>
      <p className="mt-2 px-4 text-[12px] leading-4 text-white/45">{copy.footnote}</p>
      {hint && <div className="mt-2 px-4">{hint}</div>}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  );
}
