"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ArrowUp, ArrowDown, ImageIcon, Pencil, Save, Trash2, X } from "lucide-react";
import { DEFAULT_BANNER_SETTINGS, type BannerSettings } from "@/lib/banner-config";
import { AdminStatusSwitch } from "./AdminStatusSwitch";
import { ImageDropzone } from "@/components/admin/ImageDropzone";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button, Card, Checkbox, Input, Label } from "./ui";

type Banner = {
  id?: number;
  title: string;
  body?: string;
  image_url?: string;
  cta_label?: string;
  cta_href?: string;
  delay_ms: number;
  max_show_per_session: number;
  sort_order: number;
  is_active: boolean | number;
};

const blankBanner: Banner = {
  title: "",
  body: "",
  image_url: "",
  cta_label: "",
  cta_href: "",
  delay_ms: 1500,
  max_show_per_session: 1,
  sort_order: 0,
  is_active: false,
};

export function BannerManager() {
  const toast = useToast();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [form, setForm] = useState<Banner>(blankBanner);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Banner | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [toggleError, setToggleError] = useState<{ id: number; message: string } | null>(null);
  const writingRef = useRef(false);
  const loadGeneration = useRef(0);
  const [settings, setSettings] = useState<BannerSettings>(DEFAULT_BANNER_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const busy = saving || deleting || toggling !== null || reordering || settingsBusy;

  const load = useCallback(async (refreshSettings = false) => {
    const generation = ++loadGeneration.current;
    try {
      const response = await fetch("/api/banners?all=1", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (generation !== loadGeneration.current) return;
      if (!response.ok) throw new Error(body.error ?? "Banner gagal dimuat");
      setBanners(body.banners ?? []);
      if (refreshSettings) { setSettings(body.settings ?? DEFAULT_BANNER_SETTINGS); setSettingsDirty(false); }
      setLoaded(true); setError(null);
    } catch (cause) {
      if (generation === loadGeneration.current) { setError(cause instanceof Error ? cause.message : "Banner gagal dimuat"); setLoaded(false); }
    }
  }, []);
  useEffect(() => { void load(true); return () => { loadGeneration.current++; }; }, [load]);

  async function reorder(next: Banner[]) {
    if (writingRef.current) return;
    writingRef.current = true; setReordering(true); setError(null);
    const previous = banners;
    setBanners(next);
    try {
      const response = await fetch("/api/banners/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: next.map(b => b.id), expected_ids: previous.map(b => b.id) }) });
      const body = await response.json();
      if (!response.ok) {
        setBanners(previous);
        throw new Error(body.error || "Urutan gagal disimpan");
      }
      setBanners(body.banners);
      toast.success("Urutan banner disimpan.");
    } catch (cause) {
      // A timeout may have committed. Read authoritative state before next drag.
      setBanners(previous);
      await load();
      const message = cause instanceof Error ? cause.message : "Urutan gagal disimpan";
      setError(message); toast.error(message);
    } finally { writingRef.current = false; setReordering(false); }
  }
  const dragEnd = (event: DragEndEvent) => {
    setDragId(null);
    if (!event.over || event.active.id === event.over.id) return;
    const from = banners.findIndex(b => b.id === event.active.id), to = banners.findIndex(b => b.id === event.over!.id);
    if (from >= 0 && to >= 0) void reorder(arrayMove(banners,from,to));
  };
  async function saveSettings() {
    if (writingRef.current || !loaded) return;
    writingRef.current = true; setSettingsBusy(true); setError(null);
    try {
      const response = await fetch("/api/banners/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Pengaturan gagal disimpan");
      setSettings(body.settings); setSettingsDirty(false); toast.success("Pengaturan popup disimpan.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Pengaturan gagal disimpan"); }
    finally { writingRef.current = false; setSettingsBusy(false); }
  }

  const counts = useMemo(
    () => ({
      total: banners.length,
      active: banners.filter((banner) => Boolean(banner.is_active)).length,
      inactive: banners.filter((banner) => !banner.is_active).length,
      withCta: banners.filter((banner) => Boolean(banner.cta_label && banner.cta_href)).length,
    }),
    [banners],
  );

  async function save() {
    if (writingRef.current || !loaded) return;
    writingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(editing ? `/api/banners?id=${editing}` : "/api/banners", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: form.title, body: form.body, image_url: form.image_url, cta_label: form.cta_label, cta_href: form.cta_href, is_active: Boolean(form.is_active) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Banner gagal disimpan");
      setForm(blankBanner);
      setEditing(null);
      await load();
      toast.success(`${editing ? "Perubahan banner disimpan." : "Banner dibuat."} Urutan ${body.sort_order}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Banner gagal disimpan");
    } finally {
      writingRef.current = false;
      setSaving(false);
    }
  }

  async function toggle(banner: Banner) {
    if (!banner.id || writingRef.current) return;
    writingRef.current = true;
    setToggling(banner.id);
    setToggleError(null);
    try {
      const response = await fetch(`/api/banners/${banner.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: !banner.is_active }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.banner) throw new Error(body.error ?? "Status banner gagal disimpan");
      setBanners((current) => current.map((item) => item.id === banner.id ? body.banner : item));
      // Keep unsaved content, but never let a later full save undo the status switch.
      setForm((current) => current.id === banner.id ? { ...current, is_active: Boolean(body.banner.is_active) } : current);
    } catch (error) {
      setToggleError({ id: banner.id, message: error instanceof Error ? error.message : "Status banner gagal disimpan" });
    } finally {
      writingRef.current = false;
      setToggling(null);
    }
  }

  async function remove(banner: Banner) {
    if (writingRef.current) return;
    writingRef.current = true;
    setDeleting(true);
    try {
      const response = await fetch(`/api/banners?id=${banner.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return toast.error(body.error ?? "Banner gagal dihapus");
      if (editing === banner.id) {
        setEditing(null);
        setForm(blankBanner);
      }
      setDeleteTarget(null);
      await load();
      toast.success("Banner dihapus.");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Banner gagal dihapus"); } finally {
      writingRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <section className="mt-4 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total banner", counts.total, "text-admin-fg"],
          ["Aktif", counts.active, "text-admin-success"],
          ["Nonaktif", counts.inactive, "text-admin-muted"],
          ["Dengan CTA", counts.withCta, "text-admin-accent"],
        ].map(([label, value, color]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-sm font-medium text-admin-muted">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
          </Card>
        ))}
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-admin-danger/25 bg-admin-danger/10 p-3 text-sm text-admin-danger"><span>{error}</span>{!loaded && <Button variant="outline" size="sm" onClick={() => void load(true)}>Coba lagi</Button>}</div>}
      <Card className="p-4 sm:p-6">
        <h2 className="text-base font-semibold text-admin-fg">Pengaturan popup</h2>
        <p className="mt-1 text-sm text-admin-muted">Semua banner aktif menjadi satu rangkaian. Pengunjung bisa menggeser atau memakai panah; gambar tetap utuh. Banner nonaktif tidak ikut tampil.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {([["delay_ms", "Jeda sebelum buka (detik)", 0, 10], ["interval_ms", "Ganti slide setiap (detik)", 4, 20], ["max_show_per_session", "Maksimal buka per sesi", 1, 10]] as const).map(([key,label,min,max]) => <Label key={key} className="grid gap-2">{label}<Input type="number" min={min} max={max} step={key === "max_show_per_session" ? 1 : 0.5} disabled={busy || !loaded} value={settings[key] / (key === "max_show_per_session" ? 1 : 1000)} onChange={e => { setSettings(current => ({...current,[key]:Number(e.target.value) * (key === "max_show_per_session" ? 1 : 1000)})); setSettingsDirty(true); }} className="font-normal" /></Label>)}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Label className="flex min-h-10 items-center gap-2 font-normal"><Checkbox checked={settings.autoplay} disabled={busy || !loaded} onCheckedChange={checked => { setSettings(current => ({...current,autoplay:checked === true})); setSettingsDirty(true); }} /> Geser otomatis</Label>
          <Button disabled={busy || !loaded || !settingsDirty} onClick={() => void saveSettings()}>{settingsBusy ? "Menyimpan…" : "Simpan pengaturan"}</Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-admin-muted">Putaran dijeda saat disentuh, dibaca dengan keyboard, atau tab tersembunyi. Preferensi kurangi gerakan menonaktifkan animasi dan putaran otomatis. Frekuensi dihitung per popup, bukan per slide.</p>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-admin-border p-4 sm:px-6">
            <h2 className="text-base font-semibold text-admin-fg">{editing ? "Edit banner" : "Banner baru"}</h2>
            {editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setForm(blankBanner);
                }}
                className="ml-auto"
              >
                <X aria-hidden="true" /> Batal edit
              </Button>
            )}
          </div>
          <fieldset disabled={busy || !loaded} className="grid min-w-0 gap-4 p-4 sm:p-6">
            <div className="grid gap-2"><Label htmlFor="banner-title">Judul</Label><Input id="banner-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Judul banner" /></div>
            <div className="grid gap-2"><Label htmlFor="banner-body">Deskripsi</Label><Input id="banner-body" value={form.body ?? ""} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="Deskripsi singkat" /></div>
            <div className="grid gap-2">
              <ImageDropzone
                area="banners"
                value={form.image_url}
                onUploaded={(image_url) => setForm({ ...form, image_url })}
                onRemove={() => setForm({ ...form, image_url: "" })}
              />
              <p className="text-xs leading-4 text-admin-muted">Ukuran popup mengikuti rasio gambar. Poster vertikal, gambar persegi, dan banner horizontal akan tampil utuh tanpa dipotong.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="banner-cta-label">Label CTA</Label><Input id="banner-cta-label" value={form.cta_label ?? ""} onChange={(event) => setForm({ ...form, cta_label: event.target.value })} placeholder="Label CTA" /></div>
              <div className="grid gap-2"><Label htmlFor="banner-cta-href">Tautan CTA</Label><Input id="banner-cta-href" value={form.cta_href ?? ""} onChange={(event) => setForm({ ...form, cta_href: event.target.value })} placeholder="/promo atau https://…" /></div>
            </div>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox
                disabled={busy || !loaded}
                checked={Boolean(form.is_active)}
                onCheckedChange={(checked) => setForm({ ...form, is_active: checked === true })}
              />
              Aktif di storefront
            </Label>
            <Button onClick={() => void save()} disabled={busy || !loaded} className="w-fit">
              {saving ? "Menyimpan…" : <><Save aria-hidden="true" /> {editing ? "Simpan perubahan" : "Buat banner"}</>}
            </Button>
          </fieldset>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-admin-border p-4 sm:px-6">
            <h2 className="text-base font-semibold text-admin-fg">Daftar banner</h2>
            <span className="ml-auto text-sm text-admin-muted">{reordering ? "Menyimpan urutan…" : `${banners.length} banner`}</span>
          </div>

          {!banners.length ? (
            <p className="p-8 text-center text-sm text-admin-muted">Belum ada banner.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={e => setDragId(Number(e.active.id))} onDragCancel={() => setDragId(null)} onDragEnd={dragEnd}>
            <p className="px-4 pt-3 text-xs text-admin-muted">Tarik pegangan atau pakai panah untuk mengubah urutan. Tersimpan langsung; banner baru ditambahkan paling akhir.</p>
            <SortableContext items={banners.map(b => b.id!)} strategy={verticalListSortingStrategy}>
            <div className="divide-y divide-admin-border">
              {banners.map((banner, position) => (
                <SortableBannerRow key={banner.id} id={banner.id!} title={banner.title} disabled={busy || !loaded}>
                  {banner.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={banner.image_url} alt="" className="h-14 w-20 shrink-0 rounded-md bg-admin-subtle object-contain" />
                  ) : (
                    <div className="flex aspect-video w-20 shrink-0 items-center justify-center rounded-md border border-admin-border bg-admin-subtle text-admin-muted">
                      <ImageIcon className="size-4" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium leading-tight text-admin-fg">{banner.title}</p>
                    <p className="line-clamp-1 text-xs text-admin-muted">
                      {banner.is_active ? "Aktif" : "Nonaktif"} · urutan {position + 1}
                      {banner.cta_label ? ` · CTA: ${banner.cta_label}` : ""}
                    </p>
                    {toggleError && toggleError.id === banner.id && <p id={`banner-status-error-${banner.id}`} role="alert" className="mt-1 text-xs text-admin-danger">{toggleError.message}</p>}
                  </div>
                  <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                    <Button variant="outline" size="icon" disabled={busy || position === 0} onClick={() => void reorder(arrayMove(banners,position,position-1))} aria-label={`Naikkan ${banner.title}`}><ArrowUp aria-hidden="true" /></Button>
                    <Button variant="outline" size="icon" disabled={busy || position === banners.length-1} onClick={() => void reorder(arrayMove(banners,position,position+1))} aria-label={`Turunkan ${banner.title}`}><ArrowDown aria-hidden="true" /></Button>
                    <AdminStatusSwitch checked={Boolean(banner.is_active)} label={`Aktifkan banner ${banner.title}`}
                      busy={toggling === banner.id} disabled={busy || !loaded}
                      describedBy={toggleError?.id === banner.id ? `banner-status-error-${banner.id}` : undefined}
                      onChange={() => void toggle(banner)} />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !loaded}
                      onClick={() => {
                        setForm({ ...banner, is_active: Boolean(banner.is_active) });
                        setEditing(banner.id ?? null);
                      }}
                    >
                      <Pencil aria-hidden="true" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={busy || !loaded}
                      onClick={() => setDeleteTarget(banner)}
                      className="text-admin-danger hover:bg-admin-danger/10 hover:text-admin-danger"
                      aria-label={`Hapus ${banner.title}`}
                      title="Hapus banner"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </SortableBannerRow>
              ))}
            </div>
            </SortableContext>
            <DragOverlay>{dragId !== null && <div className="rounded-md border border-admin-border bg-admin-card p-4 text-sm font-medium text-admin-fg shadow-lg">{banners.find(b => b.id === dragId)?.title}</div>}</DragOverlay>
            </DndContext>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus banner?"
        description={deleteTarget ? `“${deleteTarget.title}” akan dihapus permanen dan langsung berhenti tampil di storefront.` : ""}
        confirmLabel="Hapus banner"
        cancelLabel="Batal"
        variant="danger"
        loading={deleting}
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
      />
    </section>
  );
}

function SortableBannerRow({id,title,disabled,children}: {id:number;title:string;disabled:boolean;children:ReactNode}) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging} = useSortable({id,disabled});
  return <div ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition,opacity:isDragging?0.3:1}} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-admin-subtle/50">
    <Button variant="ghost" size="icon" {...attributes} {...listeners} disabled={disabled} aria-label={`Geser urutan ${title}`} className="h-10 w-7 cursor-grab touch-none text-admin-muted active:cursor-grabbing"><GripVertical aria-hidden="true" /></Button>
    {children}
  </div>;
}
