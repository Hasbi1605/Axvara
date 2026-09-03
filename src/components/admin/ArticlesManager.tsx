"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArticleEditor } from "@/components/admin/ArticleEditor";
import { ImageDropzone } from "@/components/admin/ImageDropzone";
import { useToast } from "@/components/ui/Toast";
import { IosIcon } from "@/components/ui/IosIcon";

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
  const [error, setError] = useState<string | null>(null);

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
    setForm({
      title: article.title,
      cover_url: article.cover_url ?? "",
      content: article.content,
      status: article.status,
      sources: (article.source_urls ?? []).join("\n"),
      scheduled_at: localDateTime(article.scheduled_at),
    });
  };

  const openNew = () => {
    setEditing(null);
    setError(null);
    setForm(emptyForm);
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
    if (!window.confirm(`Hapus artikel “${article.title}”? Tindakan ini tidak dapat dibatalkan.`)) return;
    const response = await fetch(`/api/articles?id=${article.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(body.error ?? "Artikel gagal dihapus");
    await load();
    toast.success("Artikel dihapus.");
  }

  return (
    <section className="mt-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-2">
        {[
          ["Total artikel", counts.total, "text-white"],
          ["Draft", counts.draft, "text-white/80"],
          ["Review / jadwal", counts.review, "text-[#FFB800]"],
          ["Published", counts.published, "text-[#22C55E]"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="ax-glass rounded-2xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-white/50">{label}</p>
            <p className={`text-2xl font-display font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Card utama — beri jarak mt-5 agar tidak menempel/tumpang-tindih dengan 4 mini card di atas (bug overlap) */}
      <div className="mt-5 ax-glass rounded-[20px] overflow-hidden">
        {/* Toolbar — seragam dengan Produk: search + button primary + filter */}
        <div className="flex flex-col gap-3 p-4 sm:p-5 border-b border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/5">
                <IosIcon name="news" size={16} tint="white" />
              </span>
              <div>
                <h2 className="font-semibold text-white text-sm">Artikel</h2>
                <p className="text-xs text-white/40">Slug & ringkasan dibuat otomatis.</p>
              </div>
            </div>
            <button
              onClick={openNew}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 px-5 rounded-full bg-[#00E5FF] text-[#080C1E] text-sm font-bold hover:bg-[#00D0E8] transition"
            >
              <IosIcon name="plus" size={14} tint="black" /> Artikel Baru
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-70">
                <IosIcon name="search" size={16} tint="white" />
              </span>
              <input
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                placeholder="Cari judul, isi ringkas, atau penulis…"
                className="w-full h-10 pl-10 pr-4 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40"
              />
            </div>
            <select
              value={filter}
              onChange={(event) => { setFilter(event.target.value as typeof filter); setPage(1); }}
              className="h-10 shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm text-white focus:outline-none focus:border-[#00E5FF]/40"
            >
              <option value="all" className="bg-[#0F1430]">Semua status</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value} className="bg-[#0F1430]">{label}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-10 flex flex-col items-center gap-3 text-white/60">
            <span className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <span className="text-sm">Memuat artikel…</span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-white/40">Tidak ada artikel yang cocok.</p>
        ) : (
          <>
            <div className="divide-y divide-white/5">
              {paged.map((article) => (
              <div
                key={article.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center hover:bg-white/[0.03] transition"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {article.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={article.cover_url} alt="" className="h-12 w-20 shrink-0 rounded-xl object-cover bg-white/5" />
                  ) : (
                    <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/5">
                      <IosIcon name="image" size={18} tint="white" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-semibold text-white leading-tight">{article.title}</p>
                    <p className="mt-0.5 text-xs text-white/40 line-clamp-1">
                      {article.author_type === "agent" ? `Agent: ${article.author_name ?? "unknown"} · ` : ""}
                      {article.updated_at ? new Date(article.updated_at).toLocaleDateString("id-ID") : "Belum disimpan"}
                    </p>
                    <span className="mt-1 inline-flex rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/60">
                      {statusLabels[article.status] ?? article.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {article.status === "published" && (
                    <Link
                      href={`/artikel/${article.slug}`}
                      target="_blank"
                      className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 hover:text-white"
                    >
                      <IosIcon name="external-link" size={12} tint="white" /> Lihat
                    </Link>
                  )}
                  <button
                    onClick={() => onEdit(article)}
                    className="inline-flex h-8 items-center gap-1 px-3 rounded-full bg-white text-[#080C1E] text-xs font-bold hover:bg-white/90 transition"
                  >
                    <IosIcon name="edit" size={12} tint="black" /> Edit
                  </button>
                  <button
                    onClick={() => void remove(article)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 shadow-[0_2px_10px_rgba(239,68,68,0.35)] transition"
                    aria-label={`Hapus ${article.title}`}
                    title="Hapus artikel"
                  >
                    <IosIcon name="trash" size={16} tint="white" />
                  </button>
                </div>
              </div>
              ))}
            </div>
            {filtered.length > PER_PAGE_ARTIKEL && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
                <p className="text-xs text-white/40">
                  Hal {safePage} dari {totalPages} · {filtered.length} artikel
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <IosIcon name="chevron-left" size={12} tint="white" /> Sebelumnya
                  </button>
                  <span className="text-xs text-white/40 px-1">{safePage} / {totalPages}</span>
                  <button
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    Berikutnya <IosIcon name="chevron-right" size={12} tint="white" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-6 backdrop-blur-sm">
          <div className="w-full max-w-[820px] rounded-[24px] border border-white/10 bg-[#0d1126] p-5 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-white">{editing ? "Edit Artikel" : "Artikel Baru"}</h3>
                <p className="text-xs text-white/40">Editor visual menyimpan Markdown agar kompatibel dengan MCP/agent.</p>
              </div>
              <button onClick={() => setForm(null)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70"><IosIcon name="close" size={14} tint="white" /></button>
            </div>
            {error && <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
            <div className="mt-4 grid gap-4">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-white/60">Judul *</span>
                <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-white" />
              </label>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-white/60">Cover</p>
                <ImageDropzone area="articles/covers" value={form.cover_url} onUploaded={(cover_url) => setForm({ ...form, cover_url })} onRemove={() => setForm({ ...form, cover_url: "" })} />
              </div>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-white/60">Isi artikel *</span>
                <ArticleEditor value={form.content} onChange={(content) => setForm((current) => current ? { ...current, content } : current)} />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-white/60">Sumber riset (satu URL per baris)</span>
                <textarea value={form.sources} onChange={(event) => setForm({ ...form, sources: event.target.value })} rows={3} placeholder="https://sumber-resmi.example/artikel" className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-white/60">Status</span>
                  <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ArticleStatus })} className="h-11 w-full rounded-xl border border-white/10 bg-[#10152a] px-3 text-white">
                    {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {form.status === "scheduled" && (
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-white/60">Waktu publish</span>
                    <input type="datetime-local" value={form.scheduled_at} onChange={(event) => setForm({ ...form, scheduled_at: event.target.value })} className="h-11 w-full rounded-xl border border-white/10 bg-[#10152a] px-3 text-white" />
                  </label>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setForm(null)} disabled={saving} className="h-10 rounded-full bg-white/10 px-4 text-sm text-white/70">Batal</button>
              <button onClick={() => void save()} disabled={saving} className="h-10 rounded-full bg-[#00E5FF] px-5 text-sm font-bold text-[#070a1e] disabled:opacity-50">
                {saving ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
