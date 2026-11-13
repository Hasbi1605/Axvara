"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArticleEditor } from "@/components/admin/ArticleEditor";
import { ImageDropzone } from "@/components/admin/ImageDropzone";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ChevronLeft, ChevronRight, ExternalLink, ImageIcon, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import { Badge, Button, Card, Input, Label, NativeSelect, Skeleton, Textarea } from "./ui";
import { formatWibDateTime } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { navigateWithDraftGuard, useAdminDraft } from "./AdminWorkspace";

type ArticleStatus = "draft" | "review" | "scheduled" | "published" | "rejected";
type Article = {
  id: number;
  title: string;
  slug: string;
  excerpt?: string | null;
  cover_url?: string | null;
  content: string;
  status: ArticleStatus;
  source_urls?: string[];
  scheduled_at?: string | null;
  author_name?: string | null;
  author_type?: string | null;
  updated_at?: string | null;
};

type ArticleForm = {
  title: string;
  cover_url: string;
  content: string;
  status: ArticleStatus;
  sources: string;
  scheduled_at: string;
};

const emptyForm: ArticleForm = {
  title: "",
  cover_url: "",
  content: "",
  status: "draft",
  sources: "",
  scheduled_at: "",
};

const statusLabels: Record<ArticleStatus, string> = {
  draft: "Draft",
  review: "Perlu review",
  scheduled: "Terjadwal",
  published: "Published",
  rejected: "Ditolak",
};

function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const PER_PAGE_ARTIKEL = 8;

export function ArticlesManager() {
  const toast = useToast();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | ArticleStatus>("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Article | null>(null);
  const [form, setForm] = useState<ArticleForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Article | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialForm, setInitialForm] = useState("");
  const dirty = form !== null && JSON.stringify(form) !== initialForm;
  useAdminDraft(dirty || saving, saving);
  const closeEditor = () => { if (!saving) navigateWithDraftGuard(() => setForm(null)); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/articles?all=1", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Gagal memuat artikel");
      setArticles(body.articles ?? []);
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : "Gagal memuat artikel");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => articles.filter((article) => {
    if (filter !== "all" && article.status !== filter) return false;
    return !query || `${article.title} ${article.excerpt ?? ""} ${article.author_name ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
  }), [articles, filter, query]);

  const counts = useMemo(() => ({
    total: articles.length,
    draft: articles.filter((article) => article.status === "draft").length,
    review: articles.filter((article) => ["review", "scheduled"].includes(article.status)).length,
    published: articles.filter((article) => article.status === "published").length,
  }), [articles]);

  // Pagination — seragam dengan laman Produk (8/hal, reset saat filter/search)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE_ARTIKEL));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PER_PAGE_ARTIKEL, safePage * PER_PAGE_ARTIKEL),
    [filtered, safePage],
  );

  const onEdit = (article: Article) => {
    setEditing(article);
    setError(null);
    const next = {
      title: article.title,
      cover_url: article.cover_url ?? "",
      content: article.content,
      status: article.status,
      sources: (article.source_urls ?? []).join("\n"),
      scheduled_at: localDateTime(article.scheduled_at),
    };
    setForm(next); setInitialForm(JSON.stringify(next));
  };

  const openNew = () => {
    setEditing(null);
    setError(null);
    setForm(emptyForm);
    setInitialForm(JSON.stringify(emptyForm));
  };

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const sourceUrls = form.sources.split("\n").map((source) => source.trim()).filter(Boolean);
      if (form.status === "scheduled" && !form.scheduled_at) {
        throw new Error("Waktu publish wajib diisi untuk artikel terjadwal");
      }
      const payload = {
        title: form.title,
        cover_url: form.cover_url || null,
        content: form.content,
        status: form.status,
        source_urls: sourceUrls,
        scheduled_at: form.status === "scheduled"
          ? new Date(form.scheduled_at).toISOString()
          : null,
      };
      const response = await fetch(
        editing ? `/api/articles?id=${editing.id}` : "/api/articles",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Artikel gagal disimpan");
      setForm(null);
      setEditing(null);
      await load();
      toast.success(editing ? "Perubahan artikel disimpan." : "Artikel dibuat.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Artikel gagal disimpan");
    } finally {
      setSaving(false);
    }
  }

  async function remove(article: Article) {
    setDeleting(true);
    try {
      const response = await fetch(`/api/articles?id=${article.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return toast.error(body.error ?? "Artikel gagal dihapus");
      setDeleteTarget(null);
      await load();
      toast.success("Artikel dihapus.");
    } finally {
      setDeleting(false);
    }
  }

  const statusVariant = (status: string) => status === "published" ? "success" : status === "draft" ? "secondary" : status === "rejected" ? "destructive" : "warning";

  return (
    <section className="mt-4 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total artikel", counts.total, "text-admin-fg"],
          ["Draft", counts.draft, "text-admin-muted"],
          ["Review / jadwal", counts.review, "text-admin-warning"],
          ["Published", counts.published, "text-admin-success"],
        ].map(([label, value, color]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-sm font-medium text-admin-muted">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
          </Card>
        ))}
      </div>

      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-admin-fg">Artikel</h2>
            <p className="mt-0.5 text-sm text-admin-muted">Slug &amp; ringkasan dibuat otomatis.</p>
          </div>
          <Button onClick={openNew}><Plus aria-hidden="true" /> Artikel Baru</Button>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-admin-muted" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="Cari judul, isi ringkas, atau penulis…"
              aria-label="Cari artikel"
              className="pl-9"
            />
          </div>
          <NativeSelect
            value={filter}
            onChange={(event) => { setFilter(event.target.value as typeof filter); setPage(1); }}
            aria-label="Filter status artikel"
            className="w-full sm:w-44"
          >
            <option value="all">Semua status</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </NativeSelect>
        </div>

        <Card className="mt-4 overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-4" aria-busy="true">
            <span className="sr-only">Memuat artikel…</span>
            {[0, 1, 2].map((row) => <div key={row} className="flex items-center gap-3"><Skeleton className="h-12 w-20" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/4" /></div></div>)}
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-admin-muted">Tidak ada artikel yang cocok.</p>
        ) : (
          <>
            <div className="divide-y divide-admin-border">
              {paged.map((article) => (
              <div
                key={article.id}
                className="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-admin-subtle/50 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {article.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={article.cover_url} alt="" className="h-12 w-20 shrink-0 rounded-md bg-admin-subtle object-cover" />
                  ) : (
                    <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-md border border-admin-border bg-admin-subtle text-admin-muted">
                      <ImageIcon className="size-4" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-medium leading-tight text-admin-fg">{article.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-admin-muted">
                      {article.author_type === "agent" ? `Agent: ${article.author_name ?? "unknown"} · ` : ""}
                      {formatWibDateTime(article.updated_at, { dateStyle: "short" }) ?? "Belum disimpan"}
                    </p>
                    <Badge variant={statusVariant(article.status)} className="mt-1.5">
                      {statusLabels[article.status] ?? article.status}
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {article.status === "published" && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/artikel/${article.slug}`} target="_blank"><ExternalLink aria-hidden="true" /> Lihat</Link>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => onEdit(article)}>
                    <Pencil aria-hidden="true" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setDeleteTarget(article)}
                    className="text-admin-danger hover:bg-admin-danger/10 hover:text-admin-danger"
                    aria-label={`Hapus ${article.title}`}
                    title="Hapus artikel"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
              ))}
            </div>
            {filtered.length > PER_PAGE_ARTIKEL && (
              <div className="flex items-center justify-between gap-3 border-t border-admin-border px-4 py-3">
                <p className="text-sm text-admin-muted">
                  Hal {safePage} dari {totalPages} · {filtered.length} artikel
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft aria-hidden="true" /> Sebelumnya
                  </Button>
                  <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    Berikutnya <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        </Card>
      </div>

      {form && (
        <Dialog title={editing ? "Edit Artikel" : "Artikel Baru"} onClose={closeEditor} busy={saving} className="article-dialog w-[900px] !overflow-hidden !p-0">
          <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-admin-border p-6">
              <div>
                <h3 className="text-lg font-semibold text-admin-fg">{editing ? "Edit Artikel" : "Artikel Baru"}</h3>
                <p className="mt-1 text-sm text-admin-muted">Editor visual menyimpan Markdown agar kompatibel dengan MCP/agent.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeEditor} disabled={saving} aria-label="Tutup form artikel"><X aria-hidden="true" /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {error && <p role="alert" className="mb-4 rounded-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger">{error}</p>}
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="article-title">Judul *</Label>
                <Input id="article-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
              </div>
              <div className="grid gap-2">
                <p className="text-sm font-medium text-admin-fg">Cover</p>
                <ImageDropzone area="articles/covers" value={form.cover_url} onUploaded={(cover_url) => setForm({ ...form, cover_url })} onRemove={() => setForm({ ...form, cover_url: "" })} />
              </div>
              <div className="grid gap-2" role="group" aria-labelledby="article-content-label">
                <p id="article-content-label" className="text-sm font-medium text-admin-fg">Isi artikel *</p>
                <ArticleEditor value={form.content} onChange={(content) => setForm((current) => current ? { ...current, content } : current)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="article-sources">Sumber riset (satu URL per baris)</Label>
                <Textarea id="article-sources" value={form.sources} onChange={(event) => setForm({ ...form, sources: event.target.value })} rows={3} placeholder="https://sumber-resmi.example/artikel" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="article-status">Status</Label>
                  <NativeSelect id="article-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ArticleStatus })}>
                    {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </NativeSelect>
                </div>
                {form.status === "scheduled" && (
                  <div className="grid gap-2">
                    <Label htmlFor="article-scheduled">Waktu publish</Label>
                    <Input id="article-scheduled" type="datetime-local" value={form.scheduled_at} onChange={(event) => setForm({ ...form, scheduled_at: event.target.value })} />
                  </div>
                )}
              </div>
            </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-admin-border p-4 sm:px-6">
              <Button variant="outline" onClick={closeEditor} disabled={saving}>Batal</Button>
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? "Menyimpan…" : <><Save aria-hidden="true" /> Simpan</>}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus artikel?"
        description={deleteTarget ? `“${deleteTarget.title}” akan dihapus permanen dan tidak dapat dikembalikan.` : ""}
        confirmLabel="Hapus artikel"
        cancelLabel="Batal"
        variant="danger"
        loading={deleting}
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
      />
    </section>
  );
}
