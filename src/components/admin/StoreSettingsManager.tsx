"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/site";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { publishStoreSettings } from "@/hooks/useStoreSettings";

const inputClass = "mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-[#11162b] px-3.5 text-sm text-white placeholder:text-white/25 focus:border-[#00E5FF]/45 focus:outline-none";

export function StoreSettingsManager() {
  const toast = useToast();
  const [form, setForm] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [initial, setInitial] = useState(JSON.stringify(DEFAULT_STORE_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);

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

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
    <section className="mt-5 space-y-4">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#00E5FF]/70">Sistem</p>
        <h1 className="mt-1 text-xl font-bold text-white">Pengaturan Toko</h1>
        <p className="mt-1 text-sm text-white/45">Identitas dan kontak ini dipakai konsisten di storefront. Perubahan tidak mengubah data pesanan lama.</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="ax-glass rounded-[22px] p-4 sm:p-6">
          {loading ? <div className="flex min-h-64 items-center justify-center"><Spinner size={26} /></div> : <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-white/55">Nama toko
              <input value={form.name} maxLength={40} onChange={(event) => set("name", event.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-white/55">Nomor WhatsApp admin
              <input value={form.whatsappNumber} maxLength={22} inputMode="tel" onChange={(event) => set("whatsappNumber", event.target.value)} placeholder="08… atau +62…" className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-white/55 sm:col-span-2">Tagline
              <input value={form.tagline} maxLength={160} onChange={(event) => set("tagline", event.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-white/55">Jam layanan
              <input value={form.supportHours} maxLength={60} onChange={(event) => set("supportHours", event.target.value)} placeholder="09.00–23.00 WIB" className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-white/55">Logo gambar (opsional)
              <input value={form.logoUrl} maxLength={600} onChange={(event) => set("logoUrl", event.target.value)} placeholder="/brand/logo.svg atau https://…" className={inputClass} />
            </label>
            <label className="block text-xs font-semibold text-white/55 sm:col-span-2">Keterangan legal di footer
              <textarea value={form.footerText} maxLength={300} rows={4} onChange={(event) => set("footerText", event.target.value)} className="mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-[#11162b] px-3.5 py-3 text-sm leading-6 text-white placeholder:text-white/25 focus:border-[#00E5FF]/45 focus:outline-none" />
            </label>
          </div>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <p className={`text-xs ${dirty ? "text-[#FFCF55]" : "text-white/35"}`}>{dirty ? "Ada perubahan yang belum disimpan." : "Semua perubahan sudah tersimpan."}</p>
            <button type="button" onClick={save} disabled={loading || saving || !dirty} className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full bg-[#00E5FF] px-5 text-sm font-bold text-[#07101f] transition hover:bg-[#5cefff] disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? <><Spinner size={15} className="mr-2 border-[#07101f]/20 border-t-[#07101f]" /> Menyimpan…</> : "Simpan Pengaturan"}
            </button>
          </div>
        </div>

        <aside className="ax-glass h-fit rounded-[22px] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/35">Pratinjau identitas</p>
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#090e25] p-4">
            {form.logoUrl ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.logoUrl} alt="" className="h-12 w-12 rounded-xl object-contain" />
            </> : <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/axvara-mark-prism.svg" alt="" className="h-12 w-12 object-contain" />
            </>}
            <div className="min-w-0"><p className="truncate font-display text-lg tracking-[0.12em] text-white">{form.name || "Nama toko"}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{form.tagline || "Tagline toko"}</p></div>
          </div>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between gap-4"><dt className="text-white/35">WhatsApp</dt><dd className="text-right text-white/65">{form.whatsappNumber || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-white/35">Layanan</dt><dd className="text-right text-white/65">{form.supportHours || "—"}</dd></div>
          </dl>
          <p className="mt-5 rounded-xl border border-[#FFB800]/15 bg-[#FFB800]/[0.06] px-3 py-2.5 text-[11px] leading-5 text-[#FFDA72]/80">Konfigurasi Telegram, WhatsApp Baileys, dan QRIS Hook tetap dikelola di menu operasionalnya—bukan di sini.</p>
        </aside>
      </div>
    </section>
  );
}
