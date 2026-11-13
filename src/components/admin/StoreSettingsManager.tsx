"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/site";
import { WhatsAppNotifications } from "./WhatsAppNotifications";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { publishStoreSettings } from "@/hooks/useStoreSettings";
import { useAdminDraft } from "./AdminWorkspace";

const inputClass = "mt-1.5 h-11 w-full rounded-xl border border-admin-border bg-admin-card px-3.5 text-sm text-admin-fg placeholder:text-admin-muted focus:border-admin-accent/45 focus:outline-none";

export function StoreSettingsManager() {
  const toast = useToast();
  const [form, setForm] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [initial, setInitial] = useState(JSON.stringify(DEFAULT_STORE_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useAdminDraft(dirty || saving, saving);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/store-settings", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Pengaturan toko gagal dimuat");
        const next = { ...DEFAULT_STORE_SETTINGS, ...(body.settings ?? {}) };
        setForm(next);
        setInitial(JSON.stringify(next));
      })
      .catch((loadError) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) setError(loadError instanceof Error ? loadError.message : "Pengaturan toko gagal dimuat");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const set = (key: keyof StoreSettings, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Pengaturan toko gagal disimpan");
      const next = { ...form, ...(body.settings ?? {}) };
      setForm(next);
      setInitial(JSON.stringify(next));
      publishStoreSettings(next);
      toast.success("Pengaturan toko disimpan.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Pengaturan toko gagal disimpan";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-4 space-y-4">
      <header>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-admin-accent/70">Sistem</p>
          <h1 className="mt-0.5 text-xl font-bold text-admin-fg">Pengaturan Toko</h1>
          <p className="mt-0.5 text-sm text-admin-muted">Identitas dan kontak ini dipakai konsisten di storefront. Perubahan tidak mengubah data pesanan lama.</p>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-admin-danger">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="admin-surface rounded-[22px] p-4 sm:p-6">
          {loading ? <div className="flex min-h-64 items-center justify-center"><Spinner size={26} /></div> : <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-admin-muted">Nama toko
              <input value={form.name} maxLength={40} onChange={(event) => set("name", event.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-admin-muted">Nomor WhatsApp admin
              <input value={form.whatsappNumber} maxLength={22} inputMode="tel" onChange={(event) => set("whatsappNumber", event.target.value)} placeholder="08… atau +62…" className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-admin-muted sm:col-span-2">Tagline
              <input value={form.tagline} maxLength={160} onChange={(event) => set("tagline", event.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-admin-muted sm:col-span-2">Link grup WhatsApp
              <input type="url" value={form.whatsappGroupUrl} maxLength={300} onChange={(event) => set("whatsappGroupUrl", event.target.value)} placeholder="https://chat.whatsapp.com/…" className={inputClass} />
              <span className="mt-1.5 block text-xs font-normal leading-5 text-admin-muted">Satu tautan untuk semua tombol grup di storefront, termasuk footer dan halaman link.</span>
            </label>
            <label className="block text-xs font-semibold text-admin-muted">Jam layanan
              <input value={form.supportHours} maxLength={60} onChange={(event) => set("supportHours", event.target.value)} placeholder="09.00–23.00 WIB" className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-admin-muted">Logo gambar (opsional)
              <input value={form.logoUrl} maxLength={600} onChange={(event) => set("logoUrl", event.target.value)} placeholder="/brand/logo.svg atau https://…" className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-admin-muted sm:col-span-2">Keterangan legal di footer
              <textarea value={form.footerText} maxLength={300} rows={4} onChange={(event) => set("footerText", event.target.value)} className="mt-1.5 w-full resize-y rounded-xl border border-admin-border bg-admin-card px-3.5 py-3 text-sm leading-6 text-admin-fg placeholder:text-admin-muted focus:border-admin-accent/45 focus:outline-none" />
            </label>
          </div>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-admin-border pt-4">
            <p className={`text-xs ${dirty ? "text-admin-warning" : "text-admin-muted"}`}>{dirty ? "Ada perubahan yang belum disimpan." : "Semua perubahan sudah tersimpan."}</p>
            <button type="button" onClick={save} disabled={loading || saving || !dirty} className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-admin-primary px-5 text-sm font-bold text-admin-inverse transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? <><Spinner size={15} className="mr-2 border-[#07101f]/20 border-t-[#07101f]" /> Menyimpan…</> : "Simpan Pengaturan"}
            </button>
          </div>
        </div>

        <aside className="admin-surface h-fit rounded-[22px] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-admin-muted">Pratinjau identitas</p>
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-admin-border bg-admin-card p-4">
            {form.logoUrl ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.logoUrl} alt="" className="h-12 w-12 rounded-xl object-contain" />
            </> : <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/axvara-mark-prism.svg" alt="" className="h-12 w-12 object-contain" />
            </>}
            <div className="min-w-0"><p className="truncate font-display text-lg tracking-[0.12em] text-admin-fg">{form.name || "Nama toko"}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-admin-muted">{form.tagline || "Tagline toko"}</p></div>
          </div>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between gap-4"><dt className="text-admin-muted">WhatsApp</dt><dd className="text-right text-admin-muted">{form.whatsappNumber || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-admin-muted">Layanan</dt><dd className="text-right text-admin-muted">{form.supportHours || "—"}</dd></div>
          </dl>
          <p className="mt-5 rounded-xl border border-[#FFB800]/15 bg-[#FFB800]/[0.06] px-3 py-2.5 text-xs leading-5 text-admin-warning/80">Konfigurasi Telegram, WhatsApp Baileys, dan QRIS Hook tetap dikelola di menu operasionalnya—bukan di sini.</p>
        </aside>
      </div>
      <WhatsAppNotifications />
    </section>
  );
}
