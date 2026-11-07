"use client";
// Editor S&K + cara aktivasi per varian (migrasi 0041). Disimpan lewat
// PUT /api/admin/variant-copy dengan tombol sendiri — bukan bagian form
// produk — agar menyimpan foto/badge tidak ikut menandai suntingan yang
// dijeda (supplier mengubah teks) sebagai sudah ditinjau.
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Loading";
import { mergeProductCopy, parseAdminVariantCopy, parseProductDescription, VARIANT_COPY_MAX_CHARS, type VariantCopyEntry } from "@/lib/product-copy/format";
import { ActivationBody, TermsBody } from "@/components/storefront/ProductCopy";

export function useVariantCopyEntries(productId?: number | string) {
  const pid = Number(productId);
  const [entries, setEntries] = useState<Map<number, VariantCopyEntry>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { dirty: boolean; saving: boolean }>>({});
  const report = useCallback((id: number, dirty: boolean, saving: boolean) => {
    setDrafts((prev) => prev[id]?.dirty === dirty && prev[id]?.saving === saving ? prev : { ...prev, [id]: { dirty, saving } });
  }, []);

  const load = useCallback(async () => {
    if (!Number.isInteger(pid) || pid <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/variant-copy?product_id=${pid}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as { variants?: VariantCopyEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || `S&K varian gagal dimuat (${res.status})`);
      setEntries(new Map((data.variants ?? []).map((entry) => [entry.variantId, entry])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "S&K varian gagal dimuat");
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { void load(); }, [load]);

  const update = useCallback((entry: VariantCopyEntry) => {
    setEntries((prev) => new Map(prev).set(entry.variantId, entry));
  }, []);

  return { entries, loading, error, reload: load, update, report, dirty: Object.values(drafts).some(d => d.dirty), saving: Object.values(drafts).some(d => d.saving) };
}

export type VariantCopyState = ReturnType<typeof useVariantCopyEntries>;

function statusBadge(entry: VariantCopyEntry): { label: string; className: string } {
  if (entry.adminStale) return { label: `${entry.supplier ?? "Supplier"} mengubah teks — suntingan dijeda`, className: "border-red-400/30 bg-red-500/10 text-red-200" };
  if (entry.status === "admin") return { label: "Disunting admin", className: "border-emerald-400/25 bg-emerald-500/10 text-emerald-300" };
  if (entry.status === "axvara") return { label: "Versi Axvara (otomatis)", className: "border-[#00E5FF]/25 bg-[#00E5FF]/10 text-[#5cefff]" };
  if (entry.status === "pemasok") return { label: `Teks ${entry.supplier ?? "supplier"} — belum versi Axvara`, className: "border-[#FFB800]/30 bg-[#FFB800]/10 text-[#FFCF55]" };
  return { label: "Belum ada teks varian", className: "border-white/10 bg-white/[0.05] text-white/70" };
}

const textareaClass = "mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-[#080C1E]/65 p-3 font-mono text-xs leading-5 text-white outline-none placeholder:text-white/25 focus:border-[#00E5FF]/40";

export function VariantCopyEditor({
  variantId,
  entry,
  loading,
  error,
  onSaved,
  title,
  inactive = false,
  description,
  onStateChange,
  onReload,
}: {
  variantId?: number;
  entry?: VariantCopyEntry;
  loading: boolean;
  error: string | null;
  onSaved: (entry: VariantCopyEntry) => void;
  /** Nama varian di daftar tab Deskripsi & S&K; default judul generik. */
  title?: string;
  inactive?: boolean;
  description?: string | null;
  onStateChange?: (id: number, dirty: boolean, saving: boolean) => void;
  onReload?: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState("");
  const [activation, setActivation] = useState("");
  const [termsEn, setTermsEn] = useState("");
  const [activationEn, setActivationEn] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const preserveDraft = useRef(false);

  const initialTerms = entry ? (entry.hasOverride ? entry.adminTerms : entry.autoTerms) : "";
  const initialActivation = entry ? (entry.hasOverride ? entry.adminActivation : entry.autoActivation) : "";
  const initialTermsEn = entry?.adminTermsEn ?? "";
  const initialActivationEn = entry?.adminActivationEn ?? "";
  useEffect(() => {
    if (preserveDraft.current) return;
    setTerms(initialTerms);
    setActivation(initialActivation);
    setTermsEn(initialTermsEn);
    setActivationEn(initialActivationEn);
  }, [initialTerms, initialActivation, initialTermsEn, initialActivationEn]);
  const dirty = terms !== initialTerms || activation !== initialActivation || termsEn !== initialTermsEn || activationEn !== initialActivationEn;
  useEffect(() => {
    preserveDraft.current = dirty;
    if (variantId) onStateChange?.(variantId, dirty, saving);
  }, [variantId, dirty, saving, onStateChange]);
  const preview = mergeProductCopy(parseAdminVariantCopy(terms, activation) ?? parseAdminVariantCopy(entry?.autoTerms, entry?.autoActivation), parseProductDescription(description));

  if (!variantId) {
    return (
      <p className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3 text-xs text-white/40">
        {title && <span className="font-semibold text-white/70">{title}: </span>}
        Simpan produk terlebih dahulu, lalu buka Edit untuk menyunting S&amp;K varian ini.
      </p>
    );
  }

  const badge = entry ? statusBadge(entry) : null;

  const save = async (nextTerms: string, nextActivation: string, successMessage: string, nextTermsEn = termsEn, nextActivationEn = activationEn) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/variant-copy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant_id: variantId, terms: nextTerms, activation: nextActivation, terms_en: nextTermsEn, activation_en: nextActivationEn, supplier_key: entry?.supplierKey }),
      });
      const data = await res.json().catch(() => ({})) as { variant?: VariantCopyEntry; error?: string };
      if (!res.ok || !data.variant) throw new Error(data.error || `Gagal menyimpan (${res.status})`);
      preserveDraft.current = false;
      setTerms(data.variant.hasOverride ? data.variant.adminTerms : data.variant.autoTerms);
      setActivation(data.variant.hasOverride ? data.variant.adminActivation : data.variant.autoActivation);
      setTermsEn(data.variant.adminTermsEn ?? "");
      setActivationEn(data.variant.adminActivationEn ?? "");
      onSaved(data.variant);
      toast.success(successMessage);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Gagal menyimpan S&K";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-white">{title ?? "Syarat & Ketentuan · Cara Aktivasi"}</span>
          {inactive && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-white/45">Nonaktif</span>}
          {loading && !entry ? <Spinner size={12} /> : badge && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.className}`}>{badge.label}</span>
          )}
        </span>
        <span className="text-[11px] font-semibold text-[#5cefff]">{open ? "Tutup" : "Sunting"}</span>
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 pb-4 pt-3">
          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
          {entry && (
            <>
              {entry.adminStale && (
                <p role="alert" className="mb-3 rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2.5 text-xs leading-5 text-red-100">
                  {entry.supplier ?? "Supplier"} mengubah teks. Pembeli melihat versi otomatis terbaru; kolom di bawah berisi suntingan admin yang dijeda. Bandingkan sebelum menyimpan ulang.
                </p>
              )}
              {entry.status === "pemasok" && !entry.adminStale && (
                <p className="mb-3 rounded-xl border border-[#FFB800]/25 bg-[#FFB800]/10 px-3 py-2.5 text-xs leading-5 text-[#FFE3A3]">
                  Pembeli melihat teks {entry.supplier ?? "supplier"} yang dirapikan otomatis. Kamu bisa langsung menyunting teks di bawah.
                </p>
              )}
              {!entry.autoTerms && !entry.autoActivation && !entry.hasOverride && <p className="mb-3 text-xs text-white/70">Supplier belum menyediakan panduan varian. Bagian dari deskripsi produk, jika ada, tetap tampil di pratinjau.</p>}
              {entry.adminStale && <details className="mb-3 text-xs text-white/80"><summary className="cursor-pointer py-2">Yang dilihat pembeli sekarang (versi otomatis)</summary><pre className="whitespace-pre-wrap break-words font-sans">{entry.effectiveTerms}{"\n\n"}{entry.effectiveActivation}</pre></details>}
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Syarat &amp; Ketentuan</span>
                <textarea
                  value={terms}
                  disabled={saving}
                  onChange={(e) => setTerms(e.target.value)}
                  rows={8}
                  maxLength={VARIANT_COPY_MAX_CHARS}
                  placeholder={"Detail paket:\n- Berupa akun siap pakai\nAturan pakai:\n- Dilarang mengganti password\nGaransi:\n- Garansi 20 hari"}
                  className={textareaClass}
                />
              </label>
              <label className="mt-3 block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Cara Aktivasi</span>
                <textarea
                  value={activation}
                  disabled={saving}
                  onChange={(e) => setActivation(e.target.value)}
                  rows={6}
                  maxLength={VARIANT_COPY_MAX_CHARS}
                  placeholder={"1. Buka aplikasi\n2. Login dengan akun yang dikirim\nCatatan:\n- Hubungi admin bila gagal login"}
                  className={textareaClass}
                />
              </label>
              <label className="mt-3 block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Syarat &amp; Ketentuan (English)</span>
                <textarea
                  value={termsEn}
                  disabled={saving}
                  onChange={(e) => setTermsEn(e.target.value)}
                  rows={6}
                  maxLength={VARIANT_COPY_MAX_CHARS}
                  placeholder={"Package details:\n- Ready-to-use account\nUsage rules:\n- Do not change the password\nWarranty:\n- 20-day warranty"}
                  className={textareaClass}
                />
              </label>
              <label className="mt-3 block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Cara Aktivasi (English)</span>
                <textarea
                  value={activationEn}
                  disabled={saving}
                  onChange={(e) => setActivationEn(e.target.value)}
                  rows={5}
                  maxLength={VARIANT_COPY_MAX_CHARS}
                  placeholder={"1. Open the app\n2. Log in with the account we send"}
                  className={textareaClass}
                />
              </label>
              <p className="mt-2 text-[11px] leading-4 text-white/35">
                S&amp;K: judul &quot;Detail paket:&quot;, &quot;Proses &amp; pengiriman:&quot;, &quot;Aturan pakai:&quot;, &quot;Garansi:&quot;, lalu baris &quot;- &quot; (baris tanpa judul dikelompokkan otomatis). Cara aktivasi: baris bernomor; judul bebas untuk kelompok langkah, &quot;Catatan:&quot; untuk catatan.
                {!entry.supplier && " S&K yang berlaku untuk semua varian cukup ditulis sekali di kolom Deskripsi di atas (judul “Syarat & Ketentuan:”)."}
              </p>
               {(entry.supplierTerms || entry.supplierActivation) && (
                <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                  <summary className="cursor-pointer py-2 text-xs font-semibold text-white/75">Teks asli {entry.supplier ?? "supplier"} (pembanding)</summary>
                  {entry.supplierTerms && <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-4 text-white/50">{entry.supplierTerms}</p>}
                  {entry.supplierActivation && (
                    <>
                      <p className="mt-2 text-xs font-semibold text-white/70">Cara aktivasi {entry.supplier ?? "supplier"}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-4 text-white/50">{entry.supplierActivation}</p>
                    </>
                  )}
                </details>
               )}
              <details className="mt-3 text-xs text-white/80">
                <summary className="cursor-pointer py-3 font-semibold">Pratinjau setelah disimpan</summary>
                <p className="mb-3 text-white/70">Menggabungkan draft varian dengan deskripsi produk di form. Deskripsi tetap perlu Simpan Produk. Catatan transaksi supplier tidak diubah.</p>
                {!preview.sections.length && !preview.activation.length && !preview.notes.length ? <p>Belum ada S&amp;K atau panduan.</p> : <div className="space-y-4"><TermsBody sections={preview.sections} size="xs" locale="id" /><ActivationBody groups={preview.activation} notes={preview.notes} size="xs" /></div>}
              </details>
              {saveError && <div role="alert" className="mt-3 text-xs text-red-200"><p>{saveError}</p>{onReload && <button type="button" disabled={saving || loading} className="min-h-11 underline" onClick={() => { preserveDraft.current = true; onReload(); }}>Muat sumber terbaru (pertahankan draft)</button>}</div>}
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {dirty && <span className="mr-auto text-[11px] text-[#FFCF55]">Belum disimpan</span>}
                {dirty && <button type="button" disabled={saving} className="min-h-11 px-3 text-xs text-white/80" onClick={() => { preserveDraft.current = false; setTerms(initialTerms); setActivation(initialActivation); setTermsEn(initialTermsEn); setActivationEn(initialActivationEn); setSaveError(null); }}>Batalkan perubahan</button>}
                {entry.hasOverride && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save("", "", "S&K varian kembali ke versi otomatis.", "", "")}
                    className="inline-flex min-h-11 items-center rounded-xl border border-white/15 px-3 text-xs font-semibold text-white/70 transition hover:bg-white/[0.06] disabled:opacity-40"
                  >
                    Kembali ke versi otomatis
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving || (!dirty && !entry.adminStale)}
                  onClick={() => void save(terms, activation, entry.adminStale && !dirty ? "Suntingan ditinjau dan dipakai lagi." : "S&K varian disimpan.")}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#00E5FF] px-4 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40"
                >
                  {saving && <Spinner size={13} />} {entry.adminStale && !dirty ? "Tandai sudah ditinjau" : "Simpan S&K varian"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
