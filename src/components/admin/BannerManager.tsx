"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  const load = useCallback(async () => {
    const response = await fetch("/api/banners?all=1", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(body.error ?? "Banner gagal dimuat");
    setBanners(body.banners ?? []);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

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
    if (writingRef.current) return;
    writingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(editing ? `/api/banners?id=${editing}` : "/api/banners", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, is_active: Boolean(form.is_active) }),
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
    } finally {
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

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Form — seragam card header + padding seperti laman Produk */}
        <div className="ax-glass rounded-[20px] overflow-hidden">
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
          {error && (
            <p className="mx-4 mt-4 sm:mx-5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <div className="p-4 sm:p-5 grid gap-3">
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
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-white/50">Delay (ms)</span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={form.delay_ms}
                  onChange={(event) => setForm({ ...form, delay_ms: Number(event.target.value) })}
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:border-[#00E5FF]/40"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-white/50">Maks/sesi</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.max_show_per_session}
                  onChange={(event) => setForm({ ...form, max_show_per_session: Number(event.target.value) })}
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:border-[#00E5FF]/40"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-white/50">Urutan</span>
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={form.sort_order}
                  onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) })}
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:outline-none focus:border-[#00E5FF]/40"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                disabled={saving || toggling !== null}
                checked={Boolean(form.is_active)}
                onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
                className="h-4 w-4 rounded accent-[#00E5FF]"
              />
              Aktif di storefront
            </label>
            <button
              onClick={() => void save()}
              disabled={saving || deleting || toggling !== null}
              className="mt-1 inline-flex h-10 w-fit items-center gap-2 rounded-full bg-[#00E5FF] px-5 text-sm font-bold text-[#070a1e] hover:bg-[#00D0E8] transition disabled:opacity-50"
            >
              {saving ? "Menyimpan…" : <><IosIcon name="checked" size={14} tint="black" /> {editing ? "Simpan perubahan" : "Buat banner"}</>}
            </button>
          </div>
        </div>

        {/* Daftar — ax-glass rounded-[20px] overflow-hidden + rows seperti Produk/Artikel */}
        <div className="ax-glass rounded-[20px] overflow-hidden">
          <div className="flex items-center gap-2.5 p-4 sm:p-5 border-b border-white/10">
            <h2 className="font-semibold text-white text-sm">Daftar banner</h2>
            <span className="ml-auto text-xs text-white/40">{banners.length} banner</span>
          </div>

          {!banners.length ? (
            <p className="p-8 text-center text-sm text-white/40">Belum ada banner.</p>
          ) : (
            <div className="divide-y divide-white/5">
              {banners.map((banner) => (
                <div
                  key={banner.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition"
                >
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
                      {banner.is_active ? "Aktif" : "Nonaktif"} · urutan {banner.sort_order} · delay{" "}
                      {banner.delay_ms} ms
                      {banner.cta_label ? ` · CTA: ${banner.cta_label}` : ""}
                    </p>
                    {toggleError && toggleError.id === banner.id && <p id={`banner-status-error-${banner.id}`} role="alert" className="mt-1 text-xs text-red-300">{toggleError.message}</p>}
                  </div>
                  <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                    <AdminStatusSwitch checked={Boolean(banner.is_active)} label={`Aktifkan banner ${banner.title}`}
                      busy={toggling === banner.id} disabled={saving || deleting || toggling !== null}
                      describedBy={toggleError?.id === banner.id ? `banner-status-error-${banner.id}` : undefined}
                      onChange={() => void toggle(banner)} />
                    <button
                      disabled={saving || deleting || toggling !== null}
                      onClick={() => {
                        setForm({ ...banner, is_active: Boolean(banner.is_active) });
                        setEditing(banner.id ?? null);
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-xs font-bold text-[#080C1E] hover:bg-white/90 transition"
                    >
                      <IosIcon name="edit" size={12} tint="black" /> Edit
                    </button>
                    <button
                      disabled={saving || deleting || toggling !== null}
                      onClick={() => setDeleteTarget(banner)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 shadow-[0_2px_10px_rgba(239,68,68,0.35)] transition"
                      aria-label={`Hapus ${banner.title}`}
                      title="Hapus banner"
                    >
                      <IosIcon name="trash" size={16} tint="white" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
