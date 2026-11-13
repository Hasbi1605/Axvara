"use client";
import { Button, Card, Input, Label, PageHeader } from "@/components/admin/ui";

import { useCallback, useEffect, useState } from "react";
import { CATEGORY_ICON_OPTIONS, IosIcon, categoryIcon, resolveCategoryIconName } from "@/components/admin/AdminIcon";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Cat = { id: number; name: string; slug: string; icon?: string | null; sort_order: number; product_count?: number };
type CategoryForm = { name: string; icon: string; sort_order: number };

const emptyForm = (sortOrder = 1): CategoryForm => ({ name: "", icon: "star", sort_order: sortOrder });

export function CategoryManager() {
  const toast = useToast();
  const [list, setList] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cat | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CategoryForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Cat | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/categories?all=1", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Kategori gagal dimuat");
      setList(body.categories ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Kategori gagal dimuat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Modal kategori dulu bukan dialog yang sah: halaman di belakangnya masih
  // bisa di-scroll dan Escape tidak menutup apa pun, padahal modal produk dan
  // ConfirmDialog sudah punya keduanya.


  const openNew = () => {
    const nextOrder = Math.max(0, ...list.map((category) => Number(category.sort_order) || 0)) + 1;
    setEditing(null);
    setForm(emptyForm(nextOrder));
    setError(null);
    setShowForm(true);
  };

  const openEdit = (category: Cat) => {
    setEditing(category);
    setForm({ name: category.name, icon: resolveCategoryIconName(category.icon, category.slug), sort_order: Number(category.sort_order) || 0 });
    setError(null);
    setShowForm(true);
  };

  const save = async () => {
    if (form.name.trim().length < 2) { setError("Nama kategori minimal 2 karakter."); return; }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(editing ? `/api/categories?id=${editing.id}` : "/api/categories", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, name: form.name.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Kategori gagal disimpan");
      toast.success(editing ? "Kategori diperbarui." : "Kategori ditambahkan.");
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Kategori gagal disimpan");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (category: Cat) => {
    if ((category.product_count ?? 0) > 0) return;
    setDeleteTarget(null);
    setDeleting(category.id);
    try {
      const response = await fetch(`/api/categories?id=${category.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Kategori gagal dihapus");
      toast.success("Kategori dihapus.");
      await load();
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Kategori gagal dihapus");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="mt-4 space-y-6">
      <PageHeader title="Kategori" description="Nama, ikon, dan urutan dipakai bersama oleh katalog dan footer." />
      <div className="space-y-4">
      <div className="flex justify-end" role="group" aria-label="Aksi kategori"><Button type="button" onClick={openNew}><IosIcon name="plus" size={16} tint="currentColor" /> Kategori Baru</Button></div>
      <Card className="admin-surface rounded-xl overflow-hidden">

        {error && !showForm && <p className="mx-4 mt-4 rounded-xl border border-admin-danger/20 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger sm:mx-5">{error}</p>}
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-admin-muted"><Spinner size={18} /> Memuat kategori…</div>
        ) : list.length === 0 ? (
          <p className="p-8 text-center text-sm text-admin-muted">Belum ada kategori.</p>
        ) : (
          <div className="divide-y divide-admin-border">
            {list.map((category) => {
              const hasProducts = (category.product_count ?? 0) > 0;
              return (
                <div key={category.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-admin-subtle sm:px-5">
                  <span className="flex h-9 w-10 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-admin-subtle"><IosIcon name={categoryIcon(category.slug, category.icon)} size={18} tint="currentColor" /></span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-admin-fg">{category.name}</p><p className="text-xs text-admin-muted">/{category.slug} · urutan {category.sort_order ?? 0} · {category.product_count ?? 0} produk</p></div>
                  <Button variant="default" size="sm" type="button" onClick={() => openEdit(category)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-admin-primary px-3 text-xs font-semibold text-admin-inverse transition hover:bg-admin-subtle"><IosIcon name="edit" size={12} tint="currentColor" /> Edit</Button>
                  <Button variant="outline" size="icon" type="button" onClick={() => setDeleteTarget(category)} disabled={hasProducts || deleting === category.id} title={hasProducts ? "Pindahkan semua produk sebelum menghapus kategori" : "Hapus kategori"} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-admin-danger text-admin-fg shadow-sm transition hover:bg-admin-danger disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Hapus ${category.name}`}><IosIcon name="trash" size={16} tint="currentColor" /></Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      </div>

      {showForm && (
        <Dialog title={editing ? "Edit Kategori" : "Kategori Baru"} onClose={() => !saving && setShowForm(false)} busy={saving} className="w-[560px]">
            <div className="flex items-center justify-between gap-3"><div><h3 id="category-form-title" className="text-lg font-semibold text-admin-fg">{editing ? "Edit Kategori" : "Kategori Baru"}</h3><p className="mt-0.5 text-xs text-admin-muted">Slug dibuat sekali dan tetap stabil ketika nama diganti.</p></div>
              <Button variant="outline" size="icon" type="button" onClick={() => setShowForm(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-admin-subtle transition hover:bg-admin-subtle" aria-label="Tutup form kategori"><IosIcon name="close" size={14} tint="currentColor" /></Button>
            </div>
            {editing && <div className="mt-4 rounded-xl border border-admin-border bg-admin-subtle px-3 py-2"><p className="text-xs text-admin-muted">Slug permanen</p><code className="text-sm text-admin-muted">/{editing.slug}</code></div>}
            {error && <p className="mt-4 rounded-xl border border-admin-danger/20 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger">{error}</p>}
            <Label className="mt-4 grid gap-1.5"><span className="text-xs font-semibold text-admin-muted">Nama kategori</span><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={40} autoFocus className="h-9 rounded-xl border border-admin-border bg-admin-subtle px-3 text-sm text-admin-fg focus:border-admin-accent/40 focus:outline-none" /></Label>
            <div className="mt-4">
              <p className="text-xs font-semibold text-admin-muted">Ikon</p>
              <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {CATEGORY_ICON_OPTIONS.map((option) => {
                  const active = form.icon === option.value;
                  return <Button variant="outline" key={option.value} type="button" onClick={() => setForm((current) => ({ ...current, icon: option.value }))} aria-pressed={active} title={option.label} className={`flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-xs transition ${active ? "border-admin-accent/50 bg-admin-primary/10 text-admin-accent" : "border-admin-border bg-admin-subtle text-admin-muted hover:bg-admin-subtle"}`}><IosIcon name={option.value} size={18} tint="currentColor" /><span>{option.label}</span></Button>;
                })}
              </div>
            </div>
            <Label className="mt-4 grid gap-1.5"><span className="text-xs font-semibold text-admin-muted">Urutan tampil</span><Input type="number" min={0} max={999} value={form.sort_order} onChange={(event) => setForm((current) => ({ ...current, sort_order: Number(event.target.value) }))} className="h-9 rounded-xl border border-admin-border bg-admin-subtle px-3 text-sm text-admin-fg focus:border-admin-accent/40 focus:outline-none" /></Label>
            <div className="mt-6 flex justify-end gap-2"><Button variant="outline" type="button" onClick={() => setShowForm(false)} disabled={saving} className="h-9 rounded-md border border-admin-border bg-admin-subtle px-4 text-sm text-admin-muted transition hover:bg-admin-subtle disabled:opacity-50">Batal</Button><Button variant="default" type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-admin-primary px-5 text-sm font-semibold text-admin-inverse transition hover:bg-admin-primary disabled:opacity-50">{saving ? <Spinner size={14} className="border-admin-inverse/20 border-t-admin-inverse" /> : <IosIcon name="checked" size={14} tint="currentColor" />}{saving ? "Menyimpan…" : "Simpan Kategori"}</Button></div>
        </Dialog>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus kategori?"
        description={deleteTarget ? `“${deleteTarget.name}” akan dihapus permanen. Katalog dan footer langsung berhenti menampilkannya.` : ""}
        confirmLabel="Hapus kategori"
        cancelLabel="Batal"
        variant="danger"
        loading={deleting === deleteTarget?.id}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
      />
    </section>
  );
}
