"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ArrowUp, ArrowDown } from "lucide-react";
import { DEFAULT_BANNER_SETTINGS, type BannerSettings } from "@/lib/banner-config";
import { AdminStatusSwitch } from "./AdminStatusSwitch";
import { ImageDropzone } from "@/components/admin/ImageDropzone";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IosIcon } from "@/components/ui/IosIcon";

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
    <section className="mt-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-2">
        {[
          ["Total banner", counts.total, "text-white"],
          ["Aktif", counts.active, "text-[#22C55E]"],
          ["Nonaktif", counts.inactive, "text-white/70"],
          ["Dengan CTA", counts.withCta, "text-[#00E5FF]"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="ax-glass rounded-2xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-white/50">{label}</p>
            <p className={`mt-1 text-2xl font-display font-bold tabular-nums ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {error && <div role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200">{error} {!loaded && <button onClick={() => void load(true)} className="ml-3 underline">Coba lagi</button>}</div>}
      <div className="ax-glass mt-5 rounded-[20px] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">Pengaturan popup</h2>
        <p className="mt-1 text-xs leading-5 text-white/50">Semua banner aktif menjadi satu rangkaian. Pengunjung bisa menggeser atau memakai panah; gambar tetap utuh. Banner nonaktif tidak ikut tampil.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {([["delay_ms", "Jeda sebelum buka (detik)", 0, 10], ["interval_ms", "Ganti slide setiap (detik)", 4, 20], ["max_show_per_session", "Maksimal buka per sesi", 1, 10]] as const).map(([key,label,min,max]) => <label key={key} className="grid gap-1 text-xs text-white/65">{label}<input type="number" min={min} max={max} step={key === "max_show_per_session" ? 1 : 0.5} disabled={busy || !loaded} value={settings[key] / (key === "max_show_per_session" ? 1 : 1000)} onChange={e => { setSettings(current => ({...current,[key]:Number(e.target.value) * (key === "max_show_per_session" ? 1 : 1000)})); setSettingsDirty(true); }} className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white" /></label>)}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm text-white/75"><input type="checkbox" checked={settings.autoplay} disabled={busy || !loaded} onChange={e => { setSettings(current => ({...current,autoplay:e.target.checked})); setSettingsDirty(true); }} className="h-4 w-4 accent-[#00E5FF]" /> Geser otomatis</label>
          <button disabled={busy || !loaded || !settingsDirty} onClick={() => void saveSettings()} className="h-10 rounded-full bg-[#00E5FF] px-4 text-xs font-bold text-[#080C1E] disabled:opacity-40">{settingsBusy ? "Menyimpan…" : "Simpan pengaturan"}</button>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-white/40">Putaran dijeda saat disentuh, dibaca dengan keyboard, atau tab tersembunyi. Preferensi kurangi gerakan menonaktifkan animasi dan putaran otomatis. Frekuensi dihitung per popup, bukan per slide.</p>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Form — seragam card header + padding seperti laman Produk */}
        <div className="ax-glass min-w-0 rounded-[20px] overflow-hidden">
          <div className="flex items-center gap-2.5 p-4 sm:p-5 border-b border-white/10">
            <h2 className="font-semibold text-white text-sm">{editing ? "Edit banner" : "Banner baru"}</h2>
            {editing && (
              <button
                onClick={() => {
                  setEditing(null);
                  setForm(blankBanner);
                }}
                className="ml-auto inline-flex h-7 items-center gap-1 rounded-full bg-white/5 px-3 text-xs font-semibold text-white/60 hover:bg-white/10 hover:text-white"
              >
                <IosIcon name="close" size={12} tint="white" /> Batal edit
              </button>
            )}
          </div>
          <fieldset disabled={busy || !loaded} className="min-w-0 p-4 sm:p-5 grid gap-3">
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Judul banner"
              className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40"
            />
            <input
              value={form.body ?? ""}
              onChange={(event) => setForm({ ...form, body: event.target.value })}
              placeholder="Deskripsi singkat"
              className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40"
            />
            <ImageDropzone
              area="banners"
              value={form.image_url}
              onUploaded={(image_url) => setForm({ ...form, image_url })}
              onRemove={() => setForm({ ...form, image_url: "" })}
            />
            <p className="-mt-1 text-[11px] leading-4 text-white/35">Ukuran popup mengikuti rasio gambar. Poster vertikal, gambar persegi, dan banner horizontal akan tampil utuh tanpa dipotong.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={form.cta_label ?? ""}
                onChange={(event) => setForm({ ...form, cta_label: event.target.value })}
                placeholder="Label CTA"
                className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40"
              />
              <input
                value={form.cta_href ?? ""}
                onChange={(event) => setForm({ ...form, cta_href: event.target.value })}
                placeholder="/promo atau https://…"
                className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                disabled={busy || !loaded}
                checked={Boolean(form.is_active)}
                onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
                className="h-4 w-4 rounded accent-[#00E5FF]"
              />
              Aktif di storefront
            </label>
            <button
              onClick={() => void save()}
              disabled={busy || !loaded}
              className="mt-1 inline-flex h-10 w-fit items-center gap-2 rounded-full bg-[#00E5FF] px-5 text-sm font-bold text-[#070a1e] hover:bg-[#00D0E8] transition disabled:opacity-50"
            >
              {saving ? "Menyimpan…" : <><IosIcon name="checked" size={14} tint="black" /> {editing ? "Simpan perubahan" : "Buat banner"}</>}
            </button>
          </fieldset>
        </div>

        {/* Daftar — ax-glass rounded-[20px] overflow-hidden + rows seperti Produk/Artikel */}
        <div className="ax-glass min-w-0 rounded-[20px] overflow-hidden">
          <div className="flex items-center gap-2.5 p-4 sm:p-5 border-b border-white/10">
            <h2 className="font-semibold text-white text-sm">Daftar banner</h2>
            <span className="ml-auto text-xs text-white/40">{reordering ? "Menyimpan urutan…" : `${banners.length} banner`}</span>
          </div>

          {!banners.length ? (
            <p className="p-8 text-center text-sm text-white/40">Belum ada banner.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={e => setDragId(Number(e.active.id))} onDragCancel={() => setDragId(null)} onDragEnd={dragEnd}>
            <p className="px-4 pt-3 text-[11px] text-white/45">Tarik pegangan atau pakai panah untuk mengubah urutan. Tersimpan langsung; banner baru ditambahkan paling akhir.</p>
            <SortableContext items={banners.map(b => b.id!)} strategy={verticalListSortingStrategy}>
            <div className="divide-y divide-white/5">
              {banners.map((banner, position) => (
                <SortableBannerRow key={banner.id} id={banner.id!} title={banner.title} disabled={busy || !loaded}>
                  {banner.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={banner.image_url} alt="" className="h-14 w-20 shrink-0 rounded-xl bg-black/20 object-contain" />
                  ) : (
                    <div className="flex aspect-video w-20 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/5">
                      <IosIcon name="image" size={16} tint="white" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-semibold text-white leading-tight">{banner.title}</p>
                    <p className="text-xs text-white/40 line-clamp-1">
                      {banner.is_active ? "Aktif" : "Nonaktif"} · urutan {position + 1}
                      {banner.cta_label ? ` · CTA: ${banner.cta_label}` : ""}
                    </p>
                    {toggleError && toggleError.id === banner.id && <p id={`banner-status-error-${banner.id}`} role="alert" className="mt-1 text-xs text-red-300">{toggleError.message}</p>}
                  </div>
                  <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                    <button disabled={busy || position === 0} onClick={() => void reorder(arrayMove(banners,position,position-1))} aria-label={`Naikkan ${banner.title}`} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-white/70 disabled:opacity-25"><ArrowUp size={15} /></button>
                    <button disabled={busy || position === banners.length-1} onClick={() => void reorder(arrayMove(banners,position,position+1))} aria-label={`Turunkan ${banner.title}`} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-white/70 disabled:opacity-25"><ArrowDown size={15} /></button>
                    <AdminStatusSwitch checked={Boolean(banner.is_active)} label={`Aktifkan banner ${banner.title}`}
                      busy={toggling === banner.id} disabled={busy || !loaded}
                      describedBy={toggleError?.id === banner.id ? `banner-status-error-${banner.id}` : undefined}
                      onChange={() => void toggle(banner)} />
                    <button
                      disabled={busy || !loaded}
                      onClick={() => {
                        setForm({ ...banner, is_active: Boolean(banner.is_active) });
                        setEditing(banner.id ?? null);
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-xs font-bold text-[#080C1E] hover:bg-white/90 transition"
                    >
                      <IosIcon name="edit" size={12} tint="black" /> Edit
                    </button>
                    <button
                      disabled={busy || !loaded}
                      onClick={() => setDeleteTarget(banner)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 shadow-[0_2px_10px_rgba(239,68,68,0.35)] transition"
                      aria-label={`Hapus ${banner.title}`}
                      title="Hapus banner"
                    >
                      <IosIcon name="trash" size={16} tint="white" />
                    </button>
                  </div>
                </SortableBannerRow>
              ))}
            </div>
            </SortableContext>
            <DragOverlay>{dragId !== null && <div className="rounded-xl border border-[#00E5FF]/50 bg-[#18213E] p-4 text-sm font-semibold text-white shadow-2xl">{banners.find(b => b.id === dragId)?.title}</div>}</DragOverlay>
            </DndContext>
          )}
        </div>
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
  return <div ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition,opacity:isDragging?0.3:1}} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
    <button {...attributes} {...listeners} disabled={disabled} aria-label={`Geser urutan ${title}`} className="flex h-11 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-white/50 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#00E5FF] active:cursor-grabbing"><GripVertical size={17} /></button>
    {children}
  </div>;
}
