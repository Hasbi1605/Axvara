"use client";

// Link Supplier: shortlink internal axvara.tech/go/:slug (2026-10-03).
// Pembungkus link supplier + artikel panjang. CRUD penuh admin: tambah slug,
// ubah tujuan/judul, toggle aktif, hapus. Supplier ganti URL → ubah 1 baris
// di sini, semua PDP/email/panel ikut tanpa edit kurasi + redeploy.

import { useCallback, useEffect, useState } from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, Label, PageHeader, Skeleton, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
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
    <div className="min-w-0 space-y-6">
      <PageHeader title="Link Supplier" description="Shortlink axvara.tech/go/… untuk tujuan supplier; ubah satu baris di sini tanpa redeploy katalog." actions={<Button onClick={openNew}><Plus /> Link baru</Button>} />

      {error && !showForm && <div className="rounded-md border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger" role="alert">
        <p>{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Coba lagi</Button>
      </div>}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>
        ) : list.length === 0 ? (
          <p className="p-8 text-center text-sm text-admin-muted">Belum ada link. Tambahkan slug pertama.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Slug</TableHead>
                    <TableHead>Tujuan</TableHead>
                    <TableHead>Klik</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((link) => <TableRow key={link.id}>
                    <TableCell className="font-mono text-admin-accent">go/{link.slug}</TableCell>
                    <TableCell className="max-w-[320px]">
                      <p className="truncate text-admin-fg" title={link.destination}>{link.destination}</p>
                      {link.title && <p className="truncate text-xs text-admin-muted">{link.title}</p>}
                    </TableCell>
                    <TableCell className="tabular-nums text-admin-muted">{link.click_count}{link.last_clicked_at && <p className="text-xs">{link.last_clicked_at}</p>}</TableCell>
                    <TableCell>{link.is_active ? <Badge variant="success">Aktif</Badge> : <Badge variant="secondary">Nonaktif</Badge>}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Switch checked={link.is_active} aria-label={`${link.is_active ? "Nonaktifkan" : "Aktifkan"} go/${link.slug}`} disabled={toggling === link.id} onCheckedChange={() => void toggle(link)} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Aksi go/${link.slug}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEdit(link)}>Edit link</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void toggle(link)}>{link.is_active ? "Nonaktifkan (redirect 404)" : "Aktifkan"}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-admin-danger" onSelect={() => setDeleteTarget(link)}><Trash2 /> Hapus</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 p-4 md:hidden">
              {list.map((link) => <article key={link.id} className="rounded-md border border-admin-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-admin-accent">go/{link.slug}</p>
                    <p className="truncate text-xs text-admin-muted" title={link.destination}>{link.destination}</p>
                  </div>
                  {link.is_active ? <Badge variant="success">Aktif</Badge> : <Badge variant="secondary">Nonaktif</Badge>}
                </div>
                <p className="mt-1 text-xs text-admin-muted">{link.click_count} klik{link.last_clicked_at ? ` · terakhir ${link.last_clicked_at}` : ""}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Switch checked={link.is_active} aria-label={`${link.is_active ? "Nonaktifkan" : "Aktifkan"} go/${link.slug}`} disabled={toggling === link.id} onCheckedChange={() => void toggle(link)} />
                  <Button variant="outline" size="sm" onClick={() => openEdit(link)}>Edit</Button>
                  <Button variant="ghost" size="icon" aria-label={`Hapus go/${link.slug}`} className="text-admin-danger" onClick={() => setDeleteTarget(link)}><Trash2 /></Button>
                </div>
              </article>)}
            </div>
          </>
        )}
      </Card>

      {showForm && (
        <Dialog title="Tautan supplier" onClose={() => !saving && setShowForm(false)} busy={saving} className="w-[560px]">
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-admin-fg">{editing ? "Edit Link" : "Link Baru"}</h3>
              <p className="mt-1 text-sm text-admin-muted">axvara.tech/go/slug → tujuan. Slug permanen setelah dibuat.</p>
            </div>
            {!editing && <div className="space-y-2">
              <Label htmlFor="supplier-link-slug">Slug (go/…)</Label>
              <Input id="supplier-link-slug" value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} maxLength={64} autoFocus placeholder="mis. otp-sengare" />
            </div>}
            {editing && <div className="rounded-md border border-admin-border bg-admin-subtle px-3 py-2">
              <Label className="text-xs text-admin-muted">Slug permanen</Label>
              <code className="block text-sm text-admin-accent">go/{editing.slug}</code>
            </div>}
            {error && <div className="rounded-md border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger" role="alert">{error}</div>}
            <div className="space-y-2">
              <Label htmlFor="supplier-link-destination">Tujuan</Label>
              <Input id="supplier-link-destination" value={form.destination} onChange={(event) => setForm((current) => ({ ...current, destination: event.target.value }))} maxLength={2048} placeholder="/artikel/… atau https://…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-link-title">Judul (untuk admin)</Label>
              <Input id="supplier-link-title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} maxLength={160} placeholder="mis. Mailbox OTP Sengare" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Batal</Button>
              <Button onClick={() => void save()} disabled={saving}>{saving ? <Spinner size={14} /> : null}{saving ? "Menyimpan…" : "Simpan Link"}</Button>
            </div>
          </div>
        </Dialog>
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
    </div>
  );
}
