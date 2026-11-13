"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IosIcon } from "@/components/admin/AdminIcon";

/**
 * Editor harga grosir per varian (admin, Bahasa Indonesia).
 *
 * Komponen presentasional terkontrol: state draft hidup di VariantEditor, jadi
 * dirty/simpan/duplikasi mengikuti alur yang sudah ada. Validasi di sini hanya
 * cermin UX dari kontrak server (`src/lib/bulk-pricing.ts` + route admin);
 * server tetap otoritatif dan tidak pernah memakai harga dari klien sebagai
 * override.
 */

export const MAX_BULK_TIERS = 5;
const UNIQUE_ORDER_CAP = 10;
const LINE_QTY_CAP = 100;

export type BulkRowDraft = { key: string; qty: string; price: string; saved: boolean };
export type BulkDraft = {
  enabled: boolean;
  rows: BulkRowDraft[];
  /** Admin pernah mengubah konfigurasi ini. Bila belum, payload MENGHILANGKAN bulk_pricing agar server mempertahankannya. */
  touched: boolean;
  /** Disclosure terbuka (UI saja, bukan dirty). */
  open: boolean;
  /** Konfigurasi tersimpan rusak (server menandai); tampil sebagai peringatan perbaikan, tidak diubah diam-diam. */
  storedInvalid: boolean;
};
export type BulkApiConfig = { enabled?: unknown; tiers?: unknown } | null | undefined;
export type BulkContext = { base: number; minQty: number; stock: number; mode: string };
export type BulkTierPayload = { min_qty: number; unit_price: number };
export type BulkFieldMessages = Record<string, { qty?: string; price?: string }>;
export type BulkValidation = {
  errors: BulkFieldMessages;
  warnings: BulkFieldMessages;
  groupError?: string;
  notes: string[];
  errorCount: number;
  /** Target fokus pertama saat simpan ditolak. */
  firstInvalid: { rowKey: string; field: "qty" | "price" } | "group" | null;
  payload: { enabled: boolean; tiers: BulkTierPayload[] } | null;
  /** Baris ber-qty valid, terurut naik (untuk preview/ringkasan). */
  sorted: { key: string; qty: number; price: number | null }[];
};

/**
 * Harga grosir hanya untuk produk manual (keputusan owner 2026-11-08).
 * Produk WR (`wrManaged`) dan produk supplier (`supplier` WR/SK) tidak
 * pernah menampilkan maupun menyimpan konfigurasi ini.
 */
export function isBulkEligibleForm(form: { wrManaged?: boolean; supplier?: string | null }): boolean {
  return !form.wrManaged && (form.supplier ?? "Manual") === "Manual";
}

/** Awalan id unik per varian; dipakai editor dan validasi fokus di form. */
export function variantBulkPrefix(variant: { id?: number } | undefined, index: number) {
  return `bulk-${variant?.id ?? `new${index}`}`;
}

export const SINGLE_BULK_PREFIX = "bulk-single";

let rowCounter = 0;
export function newBulkRowKey() {
  rowCounter += 1;
  return `bt${rowCounter}`;
}

export function emptyBulkDraft(): BulkDraft {
  return { enabled: false, rows: [], touched: false, open: false, storedInvalid: false };
}

export function bulkDraftFromApi(config: BulkApiConfig, corrupt?: boolean): BulkDraft {
  const draft = emptyBulkDraft();
  draft.storedInvalid = Boolean(corrupt);
  if (!config || typeof config !== "object" || !Array.isArray(config.tiers)) return draft;
  draft.enabled = config.enabled === true;
  draft.rows = (config.tiers as unknown[]).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [{ key: newBulkRowKey(), qty: String(row.min_qty ?? ""), price: String(row.unit_price ?? ""), saved: true }];
  });
  return draft;
}

/** Salinan untuk Duplikasi: tier valid ikut, ditandai dirty; konfigurasi rusak/kosong tidak diwariskan. */
export function cloneBulkDraft(source: BulkDraft | undefined): BulkDraft {
  if (!source || source.storedInvalid && !source.touched || (!source.enabled && source.rows.length === 0)) return emptyBulkDraft();
  return {
    enabled: source.enabled,
    rows: source.rows.map((row) => ({ ...row, key: newBulkRowKey(), saved: false })),
    touched: true,
    open: false,
    storedInvalid: false,
  };
}

function parseInteger(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

export function formatRupiah(value: number) {
  return `Rp${value.toLocaleString("id-ID")}`;
}

export function validateBulkDraft(draft: BulkDraft, context: BulkContext): BulkValidation {
  const result: BulkValidation = { errors: {}, warnings: {}, notes: [], errorCount: 0, firstInvalid: null, payload: null, sorted: [] };
  // Konfigurasi rusak yang tidak disentuh: payload dihilangkan, tidak divalidasi.
  if (draft.storedInvalid && !draft.touched) return result;

  const { base, minQty, stock, mode } = context;
  const baseOk = Number.isSafeInteger(base) && base >= 0;
  const enabled = draft.enabled;
  const setError = (key: string, field: "qty" | "price", message: string) => {
    result.errors[key] = { ...result.errors[key], [field]: message };
  };
  const setWarning = (key: string, field: "qty" | "price", message: string) => {
    if (result.errors[key]?.[field] || result.warnings[key]?.[field]) return;
    result.warnings[key] = { ...result.warnings[key], [field]: message };
  };

  const parsed = draft.rows.map((row) => ({ key: row.key, qty: parseInteger(row.qty), price: parseInteger(row.price), rawQty: row.qty, rawPrice: row.price }));

  for (const row of parsed) {
    if (!row.rawQty.trim()) setError(row.key, "qty", "Isi jumlah, minimal 2.");
    else if (row.qty === null) setError(row.key, "qty", "Isi bilangan bulat tanpa titik, koma, atau huruf, minimal 2.");
    else if (row.qty < 2) setError(row.key, "qty", "Jumlah minimal 2.");
    if (!row.rawPrice.trim()) setError(row.key, "price", "Isi harga lebih dari 0.");
    else if (row.price === null) setError(row.key, "price", "Isi harga bilangan bulat tanpa titik, koma, atau huruf.");
    else if (row.price <= 0) setError(row.key, "price", "Isi harga lebih dari 0.");
  }

  const counts = new Map<number, number>();
  for (const row of parsed) if (row.qty !== null && row.qty >= 2) counts.set(row.qty, (counts.get(row.qty) ?? 0) + 1);
  for (const row of parsed) {
    if (row.qty !== null && (counts.get(row.qty) ?? 0) > 1) setError(row.key, "qty", `Jumlah ${row.qty} sudah dipakai.`);
  }

  const ordered = parsed
    .filter((row): row is typeof row & { qty: number } => row.qty !== null && row.qty >= 2 && counts.get(row.qty) === 1)
    .sort((a, b) => a.qty - b.qty);
  result.sorted = ordered.map((row) => ({ key: row.key, qty: row.qty, price: row.price !== null && row.price > 0 ? row.price : null }));

  let previous: { qty: number; price: number } | null = null;
  let stalePrice = false;
  for (const row of ordered) {
    if (row.price === null || row.price <= 0) continue;
    if (baseOk && row.price > base) {
      if (enabled) setError(row.key, "price", `Tidak boleh lebih mahal dari harga dasar (${formatRupiah(base)}).`);
      else stalePrice = true;
    }
    if (!result.errors[row.key]?.price && previous && row.price > previous.price) {
      setError(row.key, "price", `Harus ≤ harga tingkat ${previous.qty} pcs (${formatRupiah(previous.price)}).`);
    }
    if (enabled && !result.errors[row.key]?.price && row.price === (previous ? previous.price : base)) {
      setWarning(row.key, "price", "Sama dengan tingkat sebelumnya, jadi tidak ada potongan.");
    }
    previous = { qty: row.qty, price: row.price };
  }
  if (!enabled && stalePrice) {
    result.notes.push(`Ada harga tingkat di atas harga dasar saat ini (${formatRupiah(base)}). Tidak dicegah selagi nonaktif, tetapi harus diperbaiki sebelum diaktifkan lagi.`);
  }

  if (enabled) {
    const cap = mode === "unique" ? UNIQUE_ORDER_CAP : LINE_QTY_CAP;
    for (const row of ordered) {
      if (row.qty > cap) setWarning(row.key, "qty", `Melebihi batas ${cap} per pesanan, jadi tingkat ini tidak bisa tercapai.`);
      else if (stock >= 0 && row.qty > stock) setWarning(row.key, "qty", `Stok saat ini ${stock}. Tingkat berlaku bila stok cukup.`);
      else if (row.qty < minQty) setWarning(row.key, "qty", `Di bawah Min. beli (${minQty}), jadi tingkat ini langsung berlaku untuk semua pesanan.`);
    }
    if (!baseOk || !Number.isSafeInteger(base)) result.groupError = "Harga jual harus bilangan bulat untuk memakai harga grosir.";
    else if (parsed.length === 0) result.groupError = "Tambahkan minimal satu tingkat, atau matikan harga grosir.";
  }

  for (const row of parsed) {
    const fields = result.errors[row.key];
    if (!fields) continue;
    result.errorCount += Number(Boolean(fields.qty)) + Number(Boolean(fields.price));
  }
  if (result.groupError) result.errorCount += 1;
  for (const row of parsed) {
    const fields = result.errors[row.key];
    if (fields?.qty) { result.firstInvalid = { rowKey: row.key, field: "qty" }; break; }
    if (fields?.price) { result.firstInvalid = { rowKey: row.key, field: "price" }; break; }
  }
  if (!result.firstInvalid && result.groupError) result.firstInvalid = "group";

  if (result.errorCount === 0) {
    result.payload = {
      enabled,
      tiers: ordered.map((row) => ({ min_qty: row.qty, unit_price: row.price as number })),
    };
  }
  return result;
}

type Props = {
  /** Awalan id unik per varian untuk label/fokus. */
  idPrefix: string;
  draft: BulkDraft;
  validation: BulkValidation;
  basePrice: number;
  minQty: number;
  disabled?: boolean;
  onChange: (next: BulkDraft) => void;
};

const fieldClass = "h-11 w-full min-w-0 rounded-xl border bg-admin-subtle px-3 text-sm tabular-nums text-admin-fg outline-none transition placeholder:text-admin-muted focus:bg-admin-subtle disabled:opacity-50";
const microLabel = "text-xs font-semibold uppercase tracking-[0.08em] text-admin-muted";

export function bulkFieldId(idPrefix: string, rowKey: string, field: "qty" | "price") {
  return `${idPrefix}-${rowKey}-${field}`;
}
export function bulkToggleId(idPrefix: string) { return `${idPrefix}-enabled`; }

function previewText(sorted: BulkValidation["sorted"], key: string, base: number) {
  const index = sorted.findIndex((row) => row.key === key);
  if (index < 0) return "—";
  const row = sorted[index];
  const next = sorted[index + 1];
  const range = next ? `${row.qty}–${next.qty - 1} pcs` : `${row.qty}+ pcs`;
  if (row.price === null || !Number.isSafeInteger(base) || base <= 0) return range;
  const percent = Math.round(((base - row.price) / base) * 100);
  return percent > 0 ? `${range} · hemat ${percent}%` : range;
}

export function BulkTierEditor({ idPrefix, draft, validation, basePrice, minQty, disabled, onChange }: Props) {
  const [confirmRow, setConfirmRow] = useState<string | null>(null);
  const focusAfterRender = useRef<string | null>(null);
  const bodyId = `${idPrefix}-body`;
  const hasRows = draft.rows.length > 0;
  const invalid = validation.errorCount > 0 || (draft.storedInvalid && !draft.touched);

  useEffect(() => {
    if (!focusAfterRender.current) return;
    document.getElementById(focusAfterRender.current)?.focus();
    focusAfterRender.current = null;
  });

  const commit = (patch: Partial<BulkDraft>) => onChange({ ...draft, ...patch, touched: true });
  const addRow = (open = true) => {
    const row: BulkRowDraft = { key: newBulkRowKey(), qty: "", price: "", saved: false };
    focusAfterRender.current = bulkFieldId(idPrefix, row.key, "qty");
    commit({ rows: [...draft.rows, row], open });
  };
  const editRow = (key: string, field: "qty" | "price", value: string) => {
    commit({ rows: draft.rows.map((row) => row.key === key ? { ...row, [field]: value } : row) });
  };
  const removeRow = (key: string) => {
    const index = draft.rows.findIndex((row) => row.key === key);
    const rows = draft.rows.filter((row) => row.key !== key);
    const previous = rows[Math.max(0, index - 1)];
    focusAfterRender.current = previous && index > 0 ? `${idPrefix}-${previous.key}-delete` : `${idPrefix}-add`;
    if (rows.length === 0) focusAfterRender.current = `${idPrefix}-add`;
    commit({ rows });
  };
  const requestRemove = (row: BulkRowDraft) => {
    const lastSaved = row.saved && draft.rows.filter((item) => item.saved).length === 1;
    if (lastSaved) setConfirmRow(row.key);
    else removeRow(row.key);
  };
  const toggleEnabled = (checked: boolean) => {
    if (checked && draft.rows.length === 0) {
      const row: BulkRowDraft = { key: newBulkRowKey(), qty: "", price: "", saved: false };
      focusAfterRender.current = bulkFieldId(idPrefix, row.key, "qty");
      commit({ enabled: true, rows: [row], open: true });
      return;
    }
    commit({ enabled: checked, open: checked ? true : draft.open });
  };

  const firstQty = validation.sorted[0]?.qty;
  const baseRange = firstQty === undefined ? `${minQty}+ pcs` : firstQty - 1 >= minQty ? `${minQty}–${firstQty - 1} pcs` : "tidak terpakai (tingkat pertama mulai di Min. beli)";
  const summary = validation.sorted.filter((row) => row.price !== null).map((row) => `${row.qty}+ ${formatRupiah(row.price as number)}`).join(" · ");
  const chip = invalid
    ? { text: "Perlu diperbaiki", className: "border-red-400/25 bg-red-500/10 text-admin-danger" }
    : draft.enabled
      ? { text: `${draft.rows.length} tingkat`, className: "border-emerald-400/25 bg-emerald-400/10 text-admin-success" }
      : { text: "Nonaktif", className: "border-admin-border bg-admin-subtle text-admin-muted" };

  return (
    <section className="mt-4 rounded-xl border border-admin-border bg-admin-subtle p-3 sm:p-4" aria-label="Harga grosir">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
            <input
              id={bulkToggleId(idPrefix)}
              type="checkbox"
              checked={draft.enabled}
              disabled={disabled}
              onChange={(event) => toggleEnabled(event.target.checked)}
              className="h-5 w-5 shrink-0 accent-admin-accent"
              aria-describedby={`${idPrefix}-status`}
            />
            <span className={microLabel}>Harga grosir</span>
          </label>
          <span id={`${idPrefix}-status`} className={`inline-flex h-6 items-center rounded-md border px-2.5 text-xs font-semibold ${chip.className}`}>{chip.text}</span>
        </div>
        <button
          type="button"
          aria-expanded={draft.open}
          aria-controls={bodyId}
          onClick={() => onChange({ ...draft, open: !draft.open })}
          className="inline-flex h-11 items-center rounded-md border border-admin-border bg-admin-subtle px-4 text-xs font-semibold text-admin-muted transition hover:bg-admin-subtle hover:text-admin-fg"
        >
          {draft.open ? "Tutup" : "Atur"}
          <span className="sr-only"> harga grosir</span>
        </button>
      </div>

      {!draft.open && (
        <p className="mt-1 text-xs tabular-nums text-admin-muted" data-testid={`${idPrefix}-summary`}>
          {invalid
            ? (draft.storedInvalid && !draft.touched ? "Konfigurasi tersimpan tidak valid. Buka untuk memperbaiki." : `${validation.errorCount} isian perlu diperbaiki.`)
            : draft.enabled
              ? (summary || "Belum ada tingkat.")
              : hasRows ? "Pengaturan disimpan; harga grosir tidak berlaku." : "Harga grosir belum diatur."}
        </p>
      )}

      <div id={bodyId} hidden={!draft.open}>
        {draft.open && (
          <div className="mt-3 space-y-3">
            {draft.storedInvalid && !draft.touched && (
              <p role="status" className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs leading-5 text-admin-danger">
                Konfigurasi harga grosir yang tersimpan tidak valid, jadi tidak dipakai pembeli. Selama tidak diubah di sini, data tersebut tidak disentuh saat Simpan Semua. Atur ulang tingkat lalu simpan untuk memperbaikinya.
              </p>
            )}
            {!draft.enabled && hasRows && (
              <p role="status" className="rounded-lg border border-admin-border bg-admin-subtle px-3 py-2 text-xs leading-5 text-admin-muted">
                Pengaturan disimpan; harga grosir tidak berlaku. Semua tingkat tetap tersimpan dan bisa diaktifkan lagi.
              </p>
            )}
            {validation.notes.map((note) => <p key={note} className="rounded-lg border border-[#FFB800]/25 bg-[#FFB800]/10 px-3 py-2 text-xs leading-5 text-admin-warning">{note}</p>)}
            {validation.groupError && <p id={`${idPrefix}-group-error`} role="alert" className="text-xs text-admin-danger">{validation.groupError}</p>}

            <p className="text-xs tabular-nums text-admin-muted">
              Harga dasar · {baseRange} · {Number.isFinite(basePrice) ? formatRupiah(basePrice) : "—"}/pcs
              <span className="block text-admin-muted">Ubah di field Harga jual di atas.</span>
            </p>

            <ul className="space-y-3" aria-label="Tingkat harga grosir">
              {draft.rows.map((row, index) => {
                const errors = validation.errors[row.key] ?? {};
                const warnings = validation.warnings[row.key] ?? {};
                const qtyId = bulkFieldId(idPrefix, row.key, "qty");
                const priceId = bulkFieldId(idPrefix, row.key, "price");
                const qtyMessage = errors.qty ?? warnings.qty;
                const priceMessage = errors.price ?? warnings.price;
                const label = row.qty.trim() || "baru";
                return (
                  <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-start gap-2 sm:grid-cols-[minmax(0,140px)_minmax(0,180px)_minmax(0,1fr)_44px] sm:gap-3">
                    <div className="min-w-0">
                      <label htmlFor={qtyId} className={`${microLabel} ${index > 0 ? "sm:sr-only" : ""}`}>Min. jumlah<span className="sr-only"> tingkat {index + 1}</span></label>
                      <div className="relative mt-1.5">
                        <input
                          id={qtyId}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          value={row.qty}
                          disabled={disabled}
                          placeholder="10"
                          aria-invalid={errors.qty ? true : undefined}
                          aria-describedby={qtyMessage ? `${qtyId}-msg` : undefined}
                          onChange={(event) => editRow(row.key, "qty", event.target.value)}
                          className={`${fieldClass} pr-10 ${errors.qty ? "border-red-400/60" : "border-admin-border focus:border-admin-accent/50"}`}
                        />
                        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-admin-muted">pcs</span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={priceId} className={`${microLabel} ${index > 0 ? "sm:sr-only" : ""}`}>Harga / pcs<span className="sr-only"> tingkat {index + 1}</span></label>
                      <div className="relative mt-1.5">
                        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-admin-muted">Rp</span>
                        <input
                          id={priceId}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          value={row.price}
                          disabled={disabled}
                          placeholder="9000"
                          aria-invalid={errors.price ? true : undefined}
                          aria-describedby={priceMessage ? `${priceId}-msg` : undefined}
                          onChange={(event) => editRow(row.key, "price", event.target.value)}
                          className={`${fieldClass} pl-9 ${errors.price ? "border-red-400/60" : "border-admin-border focus:border-admin-accent/50"}`}
                        />
                      </div>
                    </div>
                    <button
                      id={`${idPrefix}-${row.key}-delete`}
                      type="button"
                      disabled={disabled}
                      aria-label={`Hapus tingkat ${label} pcs`}
                      onClick={() => requestRemove(row)}
                      className={`mt-[26px] ${index > 0 ? "sm:mt-1.5" : ""} flex h-11 w-11 items-center justify-center rounded-xl border border-red-400/25 bg-red-500/10 transition hover:bg-red-500/20 disabled:opacity-40 sm:col-start-4 sm:row-start-1`}
                    >
                      <IosIcon name="trash" size={14} tint="#F87171" />
                    </button>
                    <p className={`col-span-3 min-w-0 text-xs tabular-nums text-admin-muted sm:col-span-1 sm:col-start-3 sm:row-start-1 ${index > 0 ? "sm:mt-1.5" : "sm:mt-[26px]"} sm:flex sm:h-11 sm:items-center`}>
                      {previewText(validation.sorted, row.key, basePrice)}
                    </p>
                    {(qtyMessage || priceMessage) && (
                      <div className="col-span-3 -mt-1 space-y-0.5 sm:col-span-4">
                        {qtyMessage && <p id={`${qtyId}-msg`} className={`text-xs ${errors.qty ? "text-admin-danger" : "text-admin-warning"}`}>{errors.qty ? "Jumlah: " : ""}{qtyMessage}</p>}
                        {priceMessage && <p id={`${priceId}-msg`} className={`text-xs ${errors.price ? "text-admin-danger" : "text-admin-warning"}`}>{errors.price ? "Harga: " : ""}{priceMessage}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center gap-3">
              {draft.rows.length < MAX_BULK_TIERS ? (
                <button
                  id={`${idPrefix}-add`}
                  type="button"
                  disabled={disabled}
                  onClick={() => addRow()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-admin-accent/25 bg-admin-primary/10 px-4 text-xs font-bold text-admin-accent transition hover:bg-admin-primary/20 disabled:opacity-40"
                >
                  <IosIcon name="plus" size={12} tint="#00E5FF" /> Tambah tingkat
                </button>
              ) : (
                <p id={`${idPrefix}-add`} tabIndex={-1} className="text-xs text-admin-muted">Maksimal {MAX_BULK_TIERS} tingkat</p>
              )}
              <p className="text-xs text-admin-muted">Harga tingkat tertinggi yang tercapai berlaku untuk semua unit di baris itu.</p>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        title="Hapus tingkat terakhir?"
        description="Tingkat harga grosir yang tersimpan akan dihapus saat Anda menekan Simpan Semua. Pesanan lama tidak berubah."
        confirmLabel="Hapus tingkat"
        onClose={() => setConfirmRow(null)}
        onConfirm={() => { if (confirmRow) removeRow(confirmRow); setConfirmRow(null); }}
      />
    </section>
  );
}
