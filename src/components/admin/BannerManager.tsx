"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageDropzone } from "@/components/admin/ImageDropzone";
import { useToast } from "@/components/ui/Toast";
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
  const [error, setError] = useState<string | null>(null);

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
      toast.success(editing ? "Perubahan banner disimpan." : "Banner dibuat.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Banner gagal disimpan");
    } finally {
      setSaving(false);
    }
  }

  async function remove(banner: Banner) {
    if (!window.confirm(`Hapus banner “${banner.title}”?`)) return;
    const response = await fetch(`/api/banners?id=${banner.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(body.error ?? "Banner gagal dihapus");
    if (editing === banner.id) {
      setEditing(null);
      setForm(blankBanner);
    }
    await load();
    toast.success("Banner dihapus.");
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
            <p className={`text-2xl font-display font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Form — seragam card header + padding seperti laman Produk */}
        <div className="ax-glass rounded-[20px] overflow-hidden">
          <div className="flex items-center gap-2.5 p-4 sm:p-5 border-b border-white/10">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/5">
              <IosIcon name="image" size={16} tint="white" />
            </span>
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
                checked={Boolean(form.is_active)}
                onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
                className="h-4 w-4 rounded accent-[#00E5FF]"
              />
              Aktif di storefront
            </label>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="mt-1 inline-flex h-10 w-fit items-center gap-2 rounded-full bg-[#00E5FF] px-5 text-sm font-bold text-[#070a1e] hover:bg-[#00D0E8] transition disabled:opacity-50"
            >
              {saving ? "Menyimpan…" : editing ? "Simpan perubahan" : "Buat banner"}
            </button>
          </div>
        </div>

        {/* Daftar — ax-glass rounded-[20px] overflow-hidden + rows seperti Produk/Artikel */}
        <div className="ax-glass rounded-[20px] overflow-hidden">
          <div className="flex items-center gap-2.5 p-4 sm:p-5 border-b border-white/10">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/5">
              <IosIcon name="full-image" size={16} tint="white" />
            </span>
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
                  className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition"
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
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        setForm({ ...banner, is_active: Boolean(banner.is_active) });
                        setEditing(banner.id ?? null);
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-xs font-bold text-[#080C1E] hover:bg-white/90 transition"
                    >
                      <IosIcon name="edit" size={12} tint="black" /> Edit
                    </button>
                    <button
                      onClick={() => void remove(banner)}
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
    </section>
  );
}
