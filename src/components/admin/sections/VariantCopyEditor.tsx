"use client";
import { Badge, Button, Label, Textarea } from "@/components/admin/ui";
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
  if (entry.adminStale) return { label: `${entry.supplier ?? "Supplier"} mengubah teks — tinjau ulang`, className: "border-admin-danger/30 bg-admin-danger/10 text-admin-danger" };
  if (entry.reviewKind === "changed") return { label: `${entry.supplier ?? "Supplier"} mengubah teks — tinjau ulang`, className: "border-admin-danger/30 bg-admin-danger/10 text-admin-danger" };
  if (entry.reviewed) return { label: `Teks ${entry.supplier ?? "supplier"} — sudah ditinjau`, className: "border-admin-border bg-admin-subtle text-admin-muted" };
  if (entry.status === "admin") return { label: "Disunting admin", className: "border-admin-success/25 bg-admin-success/10 text-admin-success" };
  if (entry.status === "axvara") return { label: "Versi Axvara (otomatis)", className: "border-admin-accent/25 bg-admin-primary/10 text-admin-accent" };
  if (entry.status === "pemasok") return { label: `Teks ${entry.supplier ?? "supplier"} — belum versi Axvara`, className: "border-admin-warning/30 bg-admin-warning/10 text-admin-warning" };
  return { label: "Belum ada teks varian", className: "border-admin-border bg-admin-subtle text-admin-muted" };
}

const textareaClass = "mt-1.5 w-full resize-y rounded-xl border border-admin-border bg-admin-card/65 p-3 font-mono text-xs leading-5 text-admin-fg outline-none placeholder:text-admin-muted focus:border-admin-accent/40";

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
      <p className="rounded-xl border border-admin-border bg-admin-subtle px-3 py-3 text-xs text-admin-muted">
        {title && <span className="font-semibold text-admin-muted">{title}: </span>}
        Simpan produk terlebih dahulu, lalu buka Edit untuk menyunting S&amp;K varian ini.
      </p>
    );
  }

  const badge = entry ? statusBadge(entry) : null;

  const save = async (nextTerms: string, nextActivation: string, successMessage: string, nextTermsEn = termsEn, nextActivationEn = activationEn, action?: "acknowledge" | "unacknowledge") => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/variant-copy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action
          ? { variant_id: variantId, supplier_key: entry?.supplierKey, action }
          : { variant_id: variantId, terms: nextTerms, activation: nextActivation, terms_en: nextTermsEn, activation_en: nextActivationEn, supplier_key: entry?.supplierKey }),
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
    <div className="rounded-xl border border-admin-border bg-admin-subtle">
      <Button variant="ghost"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-admin-fg">{title ?? "Syarat & Ketentuan · Cara Aktivasi"}</span>
          {inactive && <Badge variant="outline" className="rounded-md bg-admin-subtle px-2 py-0.5 text-xs font-semibold text-admin-muted">Nonaktif</Badge>}
          {loading && !entry ? <Spinner size={12} /> : badge && (
            <Badge variant="outline" className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</Badge>
          )}
        </span>
        <span className="text-xs font-semibold text-admin-accent">{open ? "Tutup" : "Sunting"}</span>
      </Button>

      {open && (
        <div className="border-t border-admin-border px-4 pb-4 pt-3">
          {error && <p role="alert" className="rounded-xl border border-admin-danger/20 bg-admin-danger/10 px-3 py-2 text-xs text-admin-danger">{error}</p>}
          {entry && (
            <>
              {entry.adminStale && (
                <p role="alert" className="mb-3 rounded-xl border border-admin-danger/25 bg-admin-danger/10 px-3 py-2.5 text-xs leading-5 text-admin-danger">
                  {entry.supplier ?? "Supplier"} mengubah teks. Pembeli masih melihat suntinganmu; bandingkan dengan teks supplier terbaru lalu simpan ulang atau tandai sudah ditinjau.
                </p>
              )}
              {entry.status === "pemasok" && !entry.adminStale && !entry.reviewed && (
                <p className="mb-3 rounded-xl border border-admin-warning/25 bg-admin-warning/10 px-3 py-2.5 text-xs leading-5 text-admin-warning">
                  Pembeli melihat teks {entry.supplier ?? "supplier"}. Kalau teks supplier sudah layak, tandai oke; kalau perlu dirapikan, kamu bisa langsung menyunting teks di bawah.
                </p>
              )}
              {!entry.autoTerms && !entry.autoActivation && !entry.hasOverride && <p className="mb-3 text-xs text-admin-muted">Supplier belum menyediakan panduan varian. Bagian dari deskripsi produk, jika ada, tetap tampil di pratinjau.</p>}
              {entry.adminStale && <details className="mb-3 text-xs text-admin-muted"><summary className="cursor-pointer py-2">Versi otomatis terbaru dari teks supplier (tidak tampil ke pembeli)</summary><pre className="whitespace-pre-wrap break-words font-sans">{entry.autoTerms}{"\n\n"}{entry.autoActivation}</pre></details>}
              <Label className="block">
                <span className="text-sm font-medium text-admin-muted">Syarat &amp; Ketentuan</span>
                <Textarea
                  value={terms}
                  disabled={saving}
                  onChange={(e) => setTerms(e.target.value)}
                  rows={8}
                  maxLength={VARIANT_COPY_MAX_CHARS}
                  placeholder={"Detail paket:\n- Berupa akun siap pakai\nAturan pakai:\n- Dilarang mengganti password\nGaransi:\n- Garansi 20 hari"}
                  className={textareaClass}
                />
              </Label>
              <Label className="mt-3 block">
                <span className="text-sm font-medium text-admin-muted">Cara Aktivasi</span>
                <Textarea
                  value={activation}
                  disabled={saving}
                  onChange={(e) => setActivation(e.target.value)}
                  rows={6}
                  maxLength={VARIANT_COPY_MAX_CHARS}
                  placeholder={"1. Buka aplikasi\n2. Login dengan akun yang dikirim\nCatatan:\n- Hubungi admin bila gagal login"}
                  className={textareaClass}
                />
              </Label>
              <Label className="mt-3 block">
                <span className="text-sm font-medium text-admin-muted">Syarat &amp; Ketentuan (English)</span>
                <Textarea
                  value={termsEn}
                  disabled={saving}
                  onChange={(e) => setTermsEn(e.target.value)}
                  rows={6}
                  maxLength={VARIANT_COPY_MAX_CHARS}
                  placeholder={"Package details:\n- Ready-to-use account\nUsage rules:\n- Do not change the password\nWarranty:\n- 20-day warranty"}
                  className={textareaClass}
                />
              </Label>
              <Label className="mt-3 block">
                <span className="text-sm font-medium text-admin-muted">Cara Aktivasi (English)</span>
                <Textarea
                  value={activationEn}
                  disabled={saving}
                  onChange={(e) => setActivationEn(e.target.value)}
                  rows={5}
                  maxLength={VARIANT_COPY_MAX_CHARS}
                  placeholder={"1. Open the app\n2. Log in with the account we send"}
                  className={textareaClass}
                />
              </Label>
              <p className="mt-2 text-xs leading-4 text-admin-muted">
                S&amp;K: judul &quot;Detail paket:&quot;, &quot;Proses &amp; pengiriman:&quot;, &quot;Aturan pakai:&quot;, &quot;Garansi:&quot;, lalu baris &quot;- &quot; (baris tanpa judul dikelompokkan otomatis). Cara aktivasi: baris bernomor; judul bebas untuk kelompok langkah, &quot;Catatan:&quot; untuk catatan.
                {!entry.supplier && " S&K yang berlaku untuk semua varian cukup ditulis sekali di kolom Deskripsi di atas (judul “Syarat & Ketentuan:”)."}
              </p>
               {(entry.supplierTerms || entry.supplierActivation) && (
                <details className="mt-3 rounded-xl border border-admin-border bg-admin-subtle px-3 py-2">
                  <summary className="cursor-pointer py-2 text-xs font-semibold text-admin-muted">Teks asli {entry.supplier ?? "supplier"} (pembanding)</summary>
                  {entry.supplierTerms && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-4 text-admin-muted">{entry.supplierTerms}</p>}
                  {entry.supplierActivation && (
                    <>
                      <p className="mt-2 text-xs font-semibold text-admin-muted">Cara aktivasi {entry.supplier ?? "supplier"}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-4 text-admin-muted">{entry.supplierActivation}</p>
                    </>
                  )}
                </details>
               )}
              <details className="mt-3 text-xs text-admin-muted">
                <summary className="cursor-pointer py-3 font-semibold">Pratinjau setelah disimpan</summary>
                <p className="mb-3 text-admin-muted">Menggabungkan draft varian dengan deskripsi produk di form. Deskripsi tetap perlu Simpan Produk. Catatan transaksi supplier tidak diubah.</p>
                {!preview.sections.length && !preview.activation.length && !preview.notes.length ? <p>Belum ada S&amp;K atau panduan.</p> : <div className="space-y-4"><TermsBody sections={preview.sections} size="xs" locale="id" /><ActivationBody groups={preview.activation} notes={preview.notes} size="xs" /></div>}
              </details>
              {saveError && <div role="alert" className="mt-3 text-xs text-admin-danger"><p>{saveError}</p>{onReload && <Button variant="ghost" type="button" disabled={saving || loading} className="min-h-9 underline" onClick={() => { preserveDraft.current = true; onReload(); }}>Muat sumber terbaru (pertahankan draft)</Button>}</div>}
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {dirty && <span className="mr-auto text-xs text-admin-warning">Belum disimpan</span>}
                {dirty && <Button variant="ghost" type="button" disabled={saving} className="min-h-9 px-3 text-xs text-admin-muted" onClick={() => { preserveDraft.current = false; setTerms(initialTerms); setActivation(initialActivation); setTermsEn(initialTermsEn); setActivationEn(initialActivationEn); setSaveError(null); }}>Batalkan perubahan</Button>}
                {!dirty && (entry.reviewKind === "raw" || (entry.reviewKind === "changed" && !entry.hasOverride)) && <Button variant="outline" type="button" disabled={saving || loading} className="min-h-9 text-xs" onClick={() => void save(terms, activation, "Ditandai sudah ditinjau. Teks tetap ikut update supplier.", termsEn, activationEn, "acknowledge")}>
                  {entry.reviewKind === "changed" ? "Teks baru sudah oke" : "Teks supplier sudah oke"}
                </Button>}
                {!dirty && entry.reviewed && <Button variant="ghost" type="button" disabled={saving || loading} className="min-h-9 text-xs text-admin-muted underline" onClick={() => void save(terms, activation, "Tanda tinjauan dibatalkan.", termsEn, activationEn, "unacknowledge")}>Batalkan tanda</Button>}
                {entry.hasOverride && (
                  <Button variant="outline"
                    type="button"
                    disabled={saving}
                    onClick={() => void save("", "", "S&K varian kembali ke versi otomatis.", "", "")}
                    className="inline-flex min-h-9 items-center rounded-xl border border-admin-border px-3 text-xs font-semibold text-admin-muted transition hover:bg-admin-subtle disabled:opacity-40"
                  >
                    Kembali ke versi otomatis
                  </Button>
                )}
                <Button variant="default"
                  type="button"
                  disabled={saving || (!dirty && !entry.adminStale)}
                  onClick={() => void save(terms, activation, entry.adminStale && !dirty ? "Suntingan ditinjau dan dipakai lagi." : "S&K varian disimpan.")}
                  className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-admin-primary px-4 text-xs font-semibold text-admin-inverse transition hover:bg-admin-primary disabled:opacity-40"
                >
                  {saving && <Spinner size={13} />} {entry.adminStale && !dirty ? "Tandai sudah ditinjau" : "Simpan S&K varian"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
