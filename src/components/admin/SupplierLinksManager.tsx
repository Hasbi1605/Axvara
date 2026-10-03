"use client";

// Link Supplier: shortlink internal axvara.tech/go/:slug (2026-10-03).
// Pembungkus link supplier + artikel panjang. CRUD penuh admin: tambah slug,
// ubah tujuan/judul, toggle aktif, hapus. Supplier ganti URL → ubah 1 baris
// di sini, semua PDP/email/panel ikut tanpa edit kurasi + redeploy.

import { useCallback, useEffect, useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type SupplierLink = {
  id: number;
  slug: string;
  destination: string;
  title: string;
  is_active: boolean;
  click_count: number;
  last_clicked_at: string | null;
};

type LinkForm = { slug: string; destination: string; title: string };

const emptyForm = (): LinkForm => ({ slug: "", destination: "", title: "" });

export function SupplierLinksManager() {
  const toast = useToast();
  const [list, setList] = useState<SupplierLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SupplierLink | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<LinkForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SupplierLink | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/supplier-links", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Link gagal dimuat");
      setList(body.links ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Link gagal dimuat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!showForm) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) setShowForm(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [showForm, saving]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setError(null);
    setShowForm(true);
  };

  const openEdit = (link: SupplierLink) => {
    setEditing(link);
    setForm({ slug: link.slug, destination: link.destination, title: link.title });
    setError(null);
    setShowForm(true);
  };

  const save = async () => {
    if (!editing && form.slug.trim().length < 2) { setError("Slug minimal 2 karakter (huruf/angka/dash)."); return; }
    if (!form.destination.trim()) { setError("Tujuan wajib diisi."); return; }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/supplier-links", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editing
          ? { id: editing.id, destination: form.destination.trim(), title: form.title.trim() }
          : { slug: form.slug.trim().toLowerCase(), destination: form.destination.trim(), title: form.title.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const hints: Record<string, string> = {
          slug_tidak_valid_atau_dipesan: "Slug tidak valid atau dipesan (admin/api/produk/artikel/…).",
          tujuan_tidak_valid: "Tujuan tidak valid — pakai path /artikel/… atau https://….",
          slug_sudah_ada: "Slug sudah dipakai link lain.",
        };
        throw new Error(hints[String(body.error)] ?? "Link gagal disimpan");
      }
      toast.success(editing ? "Link diperbarui." : "Link ditambahkan.");
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Link gagal disimpan");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (link: SupplierLink) => {
    setToggling(link.id);
    try {
      const response = await fetch("/api/admin/supplier-links", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: link.id, is_active: link.is_active ? 0 : 1 }),
      });
      if (!response.ok) throw new Error("Gagal mengubah status");
      toast.success(link.is_active ? "Link dinonaktifkan." : "Link diaktifkan.");
      await load();
    } catch (toggleError) {
      toast.error(toggleError instanceof Error ? toggleError.message : "Gagal mengubah status");
    } finally {
      setToggling(null);
    }
  };

  const remove = async (link: SupplierLink) => {
    setDeleteTarget(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/supplier-links?id=${link.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Link gagal dihapus");
      toast.success("Link dihapus.");
      await load();
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Link gagal dihapus");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="mt-4">
      <div className="ax-glass rounded-[20px] overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Link Supplier</h2>
            <p className="text-xs text-white/40">Shortlink axvara.tech/go/… — supplier ganti URL? Ubah 1 baris di sini.</p>
          </div>
          <button type="button" onClick={openNew} className="ml-auto inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-[#00E5FF] px-5 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8]"><IosIcon name="plus" size={14} tint="black" /> Link Baru</button>
        </div>

        {error && !showForm && <p className="mx-4 mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200 sm:mx-5">{error}</p>}
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-white/50"><Spinner size={18} /> Memuat link…</div>
        ) : list.length === 0 ? (
          <p className="p-8 text-center text-sm text-white/40">Belum ada link. Tambahkan slug pertama.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {list.map((link) => (
              <div key={link.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.03] sm:px-5">
                <button
                  type="button"
                  onClick={() => void toggle(link)}
                  disabled={toggling === link.id}
                  aria-pressed={link.is_active}
                  title={link.is_active ? "Nonaktifkan (redirect jadi 404)" : "Aktifkan"}
                  className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition ${link.is_active ? "bg-emerald-500/80" : "bg-white/15"} disabled:opacity-50`}
                >
                  <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${link.is_active ? "translate-x-5" : ""}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    <span className="text-[#00E5FF]">go/{link.slug}</span>
                    {!link.is_active && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/50">NONAKTIF</span>}
                  </p>
                  <p className="truncate text-xs text-white/40">→ {link.destination}{link.title ? ` · ${link.title}` : ""}</p>
                  <p className="text-[11px] text-white/30">{link.click_count} klik{link.last_clicked_at ? ` · terakhir ${link.last_clicked_at}` : ""}</p>
                </div>
                <button type="button" onClick={() => openEdit(link)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-xs font-bold text-[#080C1E] transition hover:bg-white/90"><IosIcon name="edit" size={12} tint="black" /> Edit</button>
                <button type="button" onClick={() => setDeleteTarget(link)} aria-label={`Hapus go/${link.slug}`} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_2px_10px_rgba(239,68,68,0.35)] transition hover:bg-red-600"><IosIcon name="trash" size={16} tint="white" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !saving && setShowForm(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="supplier-link-form-title" className="ax-glass-strong max-h-[92dvh] w-full max-w-[560px] overflow-y-auto rounded-t-3xl border border-white/10 p-6 shadow-[0_24px_64px_rgba(0,0,0,0.6)] sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3"><div><h3 id="supplier-link-form-title" className="text-lg font-bold text-white">{editing ? "Edit Link" : "Link Baru"}</h3><p className="mt-0.5 text-xs text-white/45">axvara.tech/go/slug → tujuan. Slug permanen setelah dibuat.</p></div>
              <button type="button" onClick={() => setShowForm(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15" aria-label="Tutup form link"><IosIcon name="close" size={14} tint="white" /></button>
            </div>
            {!editing && <label className="mt-4 grid gap-1.5"><span className="text-xs font-semibold text-white/60">Slug (go/…)</span><input value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} maxLength={64} autoFocus placeholder="mis. otp-sengare" className="h-11 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" /></label>}
            {editing && <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"><p className="text-[11px] text-white/40">Slug permanen</p><code className="text-sm text-[#00E5FF]">go/{editing.slug}</code></div>}
            {error && <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
            <label className="mt-4 grid gap-1.5"><span className="text-xs font-semibold text-white/60">Tujuan</span><input value={form.destination} onChange={(event) => setForm((current) => ({ ...current, destination: event.target.value }))} maxLength={2048} placeholder="/artikel/… atau https://…" className="h-11 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" /></label>
            <label className="mt-4 grid gap-1.5"><span className="text-xs font-semibold text-white/60">Judul (untuk admin)</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} maxLength={160} placeholder="mis. Mailbox OTP Sengare" className="h-11 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" /></label>
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} disabled={saving} className="h-10 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm text-white/70 transition hover:bg-white/10 disabled:opacity-50">Batal</button><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#00E5FF] px-5 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8] disabled:opacity-50">{saving ? <Spinner size={14} className="border-[#080C1E]/20 border-t-[#080C1E]" /> : <IosIcon name="checked" size={14} tint="black" />}{saving ? "Menyimpan…" : "Simpan Link"}</button></div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus link?"
        description={deleteTarget ? `“go/${deleteTarget.slug}” akan dihapus permanen — PDP/email yang masih menampilkannya jadi teks biasa (bukan 404 halaman).` : ""}
        confirmLabel="Hapus link"
        cancelLabel="Batal"
        variant="danger"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
      />
    </section>
  );
}
