"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/site";
import { WhatsAppNotifications } from "./WhatsAppNotifications";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { publishStoreSettings } from "@/hooks/useStoreSettings";
import { useAdminDraft } from "./AdminWorkspace";
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Label, Textarea } from "./ui";

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

  const field = (id: string, label: string, input: React.ReactNode, hint?: string, wide = false) => (
    <div className={`grid gap-2 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {input}
      {hint ? <p className="text-xs text-admin-muted">{hint}</p> : null}
    </div>
  );

  return (
    <section className="mt-4 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-admin-fg">Pengaturan Toko</h1>
        <p className="mt-1 text-sm text-admin-muted">Identitas dan kontak ini dipakai konsisten di storefront. Perubahan tidak mengubah data pesanan lama.</p>
      </header>

      {error && <div role="alert" className="rounded-md border border-admin-danger/25 bg-admin-danger/10 px-4 py-3 text-sm text-admin-danger">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Identitas toko</CardTitle>
            <CardDescription>Nama, kontak, dan teks footer storefront.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <div className="flex min-h-64 items-center justify-center"><Spinner size={26} /></div> : <div className="grid gap-4 sm:grid-cols-2">
              {field("store-name", "Nama toko", <Input id="store-name" value={form.name} maxLength={40} onChange={(event) => set("name", event.target.value)} />)}
              {field("store-wa", "Nomor WhatsApp admin", <Input id="store-wa" value={form.whatsappNumber} maxLength={22} inputMode="tel" onChange={(event) => set("whatsappNumber", event.target.value)} placeholder="08… atau +62…" />)}
              {field("store-tagline", "Tagline", <Input id="store-tagline" value={form.tagline} maxLength={160} onChange={(event) => set("tagline", event.target.value)} />, undefined, true)}
              {field("store-group", "Link grup WhatsApp", <Input id="store-group" type="url" value={form.whatsappGroupUrl} maxLength={300} onChange={(event) => set("whatsappGroupUrl", event.target.value)} placeholder="https://chat.whatsapp.com/…" />, "Satu tautan untuk semua tombol grup di storefront, termasuk footer dan halaman link.", true)}
              {field("store-hours", "Jam layanan", <Input id="store-hours" value={form.supportHours} maxLength={60} onChange={(event) => set("supportHours", event.target.value)} placeholder="09.00–23.00 WIB" />)}
              {field("store-logo", "Logo gambar (opsional)", <Input id="store-logo" value={form.logoUrl} maxLength={600} onChange={(event) => set("logoUrl", event.target.value)} placeholder="/brand/logo.svg atau https://…" />)}
              {field("store-footer", "Keterangan legal di footer", <Textarea id="store-footer" value={form.footerText} maxLength={300} rows={4} onChange={(event) => set("footerText", event.target.value)} className="resize-y" />, undefined, true)}
            </div>}
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border pt-4">
            <p className={`text-sm ${dirty ? "text-admin-warning" : "text-admin-muted"}`}>{dirty ? "Ada perubahan yang belum disimpan." : "Semua perubahan sudah tersimpan."}</p>
            <Button type="button" onClick={save} disabled={loading || saving || !dirty}>
              {saving ? <><Loader2 className="animate-spin" aria-hidden="true" /> Menyimpan…</> : <><Save aria-hidden="true" /> Simpan Pengaturan</>}
            </Button>
          </CardFooter>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Pratinjau identitas</CardTitle>
            <CardDescription>Tampilan ringkas di storefront.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 rounded-md border border-admin-border bg-admin-subtle p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.logoUrl || "/brand/axvara-mark-prism.svg"} alt="" className="size-12 rounded-md object-contain" />
              <div className="min-w-0"><p className="truncate font-display text-lg tracking-[0.12em] text-admin-fg">{form.name || "Nama toko"}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-admin-muted">{form.tagline || "Tagline toko"}</p></div>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-admin-muted">WhatsApp</dt><dd className="text-right text-admin-fg">{form.whatsappNumber || "—"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-admin-muted">Layanan</dt><dd className="text-right text-admin-fg">{form.supportHours || "—"}</dd></div>
            </dl>
            <p className="mt-5 rounded-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-2.5 text-xs leading-5 text-admin-warning">Konfigurasi Telegram, WhatsApp Baileys, dan QRIS Hook tetap dikelola di menu operasionalnya—bukan di sini.</p>
          </CardContent>
        </Card>
      </div>
      <WhatsAppNotifications />
    </section>
  );
}
