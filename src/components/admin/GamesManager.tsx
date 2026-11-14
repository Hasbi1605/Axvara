"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { Badge, Button, Card, Input, NativeSelect, PageHeader, Skeleton, StatCard, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsList, TabsTrigger } from "@/components/admin/ui";
import { navigateWithDraftGuard, pushAdminHistory, useAdminDraft } from "./AdminWorkspace";
import { GameEditor } from "./games/GameEditor";
import { PricingPanel } from "./games/PricingPanel";
import { VariantsPanel } from "./games/VariantsPanel";
import { json, request, type Game, type List } from "./games/shared";
export { plainSupplierDescription } from "./games/VariantsPanel";

const PAGE_SIZE = 50;
const TABS = [["games", "Game"], ["variants", "Varian"], ["pricing", "Harga"]] as const;
type Tab = typeof TABS[number][0];
const tabOf = (value: string | null): Tab => TABS.some(([key]) => key === value) ? value as Tab : "games";

export function GamesManager() {
  const [list, setList] = useState<List | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("games");
  const [q, setQ] = useState(""), [search, setSearch] = useState(""), [brand, setBrand] = useState(""), [enabled, setEnabled] = useState(""), [sellable, setSellable] = useState(""), [page, setPage] = useState(1), [editing, setEditing] = useState<Game | null>(null);
  const generation = useRef(0), lock = useRef(false);
  useAdminDraft(busy, busy);
  useEffect(() => { const timer = setTimeout(() => { setSearch(q); setPage(1); }, 300); return () => clearTimeout(timer); }, [q]);
  useEffect(() => { const sync = () => setTab(tabOf(new URLSearchParams(window.location.search).get("tab"))); sync(); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setLoadError("");
    const params = new URLSearchParams({ brand, q: search, enabled, sellable, sort: "sellable", limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    try { const next = await request<List>(`/api/admin/games/products?${params}`); if (current === generation.current) setList(next); }
    catch (e) { if (current === generation.current) setLoadError(e instanceof Error ? e.message : "Data Games belum berhasil dimuat."); }
    finally { if (current === generation.current) setLoading(false); }
  }, [brand, search, enabled, sellable, page]);
  useEffect(() => { void load(); const pending = generation; return () => { pending.current++; }; }, [load]);
  async function mutate(url: string, method: string, body: Record<string, unknown>, message: string | ((data: { updated: number; changed?: number }) => string)) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { const data = await request<{ updated: number; changed?: number }>(url, json(method, body)); const text = typeof message === "string" ? message : message(data); setNotice(text); toast.success(text); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Perubahan belum tersimpan. Coba lagi."); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  const patch = (body: Record<string, unknown>) => mutate("/api/admin/games/products", "PATCH", body, "Perubahan varian disimpan.");
  function navigate(next: Tab) { navigateWithDraftGuard(() => { setTab(next); setError(""); const url = new URL(window.location.href); url.searchParams.set("section", "games"); url.searchParams.set("tab", next); pushAdminHistory(`${url.pathname}?${url.searchParams}${url.hash}`); }); }
  const counts = list?.sync.counts, ready = !loading && !loadError && !!list;
  const stat = (value: React.ReactNode) => loading ? <Skeleton className="h-8 w-24" /> : loadError ? "—" : value;
  const totalPages = Math.max(1, Math.ceil((list?.total ?? 0) / PAGE_SIZE));
  return <div className="min-w-0 space-y-6">
    <PageHeader title="Games" description="Kelola tampilan game, varian, dan harga top up dari satu tempat." actions={<Button asChild variant="outline" size="sm"><a href="/admin?section=orders&kind=games">Lihat pesanan Games</a></Button>} />
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Ringkasan Games">
      <StatCard label="Sinkron terakhir" value={stat(<span className="text-base sm:text-lg">{list?.sync.last_sync_at ? formatWibDateTime(list.sync.last_sync_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Belum pernah"}</span>)} />
      <StatCard label="Varian bisa dijual" value={stat(counts ? `${counts.sellable} / ${counts.total}` : "—")} hint="Aktif, supplier aktif, stok tersedia" />
      <StatCard label="Supplier nonaktif" value={stat(counts?.supplier_off ?? "—")} />
      <StatCard label="Markup default" value={stat(list?.pricing ? `${list.pricing.markup_percent} %` : "—")} />
    </section>
    {ready && counts && counts.total > 0 && counts.supplier_off / counts.total > 0.5 && <div role="alert" className="flex items-start gap-3 rounded-md border border-admin-warning/30 bg-admin-warning/10 p-4 text-sm text-admin-warning"><AlertTriangle className="size-5 shrink-0" aria-hidden="true" /><p>Sekalipay menonaktifkan {counts.supplier_off} dari {counts.total} varian Game. Periksa status produk H2H di akun Sekalipay.</p></div>}
    {(loadError || error) && <div role="alert" className="rounded-md border border-admin-danger/30 bg-admin-danger/10 p-4 text-sm text-admin-danger"><p>{loadError || error}</p><Button variant="outline" size="sm" className="mt-2" disabled={loading || busy} onClick={() => { setError(""); void load(); }}>Coba lagi</Button></div>}
    {notice && <p role="status" className="text-sm text-admin-muted">{notice}</p>}
    <Tabs value={tab} onValueChange={value => navigate(value as Tab)}><TabsList aria-label="Bagian Games">{TABS.map(([value, label]) => <TabsTrigger key={value} value={value} disabled={busy}>{label}</TabsTrigger>)}</TabsList></Tabs>
    {loading && !list && <div role="status" aria-label="Memuat Games" className="space-y-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
    {!loadError && list && <>
      {tab === "games" && <Card className="overflow-hidden"><Table className="block md:table" aria-label="Daftar game"><TableHeader className="hidden md:table-header-group"><TableRow>{["Game", "Bisa dijual", "Mulai", "Markup", "Populer", "Tampil", "Aksi"].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody className="block md:table-row-group">{(list.games ?? []).map(game => <TableRow key={game.slug} className="block p-2 md:table-row md:p-0">
        <TableCell className="block md:table-cell"><div className="flex items-center gap-3"><GameIcon game={game} /><div className="min-w-0"><p className="break-words font-medium">{game.name}</p><p className="text-xs text-admin-muted">{game.publisher || "Publisher belum diisi"}</p></div></div></TableCell>
        <TableCell className="inline-block md:table-cell"><span className="mr-2 text-xs text-admin-muted md:hidden">Bisa dijual</span>{game.sellable_count} / {game.variants_total}</TableCell><TableCell className="inline-block tabular-nums md:table-cell"><span className="mr-2 text-xs text-admin-muted md:hidden">Mulai</span>{game.min_price == null ? "Belum tersedia" : formatRupiah(game.min_price)}</TableCell>
        <TableCell className="block md:table-cell"><div className="flex flex-wrap items-center gap-2"><span className="tabular-nums">{game.effective_markup_percent} %</span><Badge variant="secondary">{game.markup_percent == null ? "Default" : "Khusus"}</Badge></div></TableCell><TableCell className="inline-block md:table-cell"><span className="mr-2 text-xs text-admin-muted md:hidden">Populer</span>{game.featured_rank ?? "—"}</TableCell><TableCell className="inline-block md:table-cell"><Switch aria-label={`Tampilkan ${game.name}`} checked={!game.hidden} disabled={busy} onCheckedChange={checked => void mutate("/api/admin/games/games", "PATCH", { slug: game.slug, hidden: !checked }, "Tampilan game disimpan.")} /></TableCell><TableCell className="inline-block md:table-cell"><Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(game)}>Edit<span className="sr-only"> {game.name}</span></Button></TableCell>
      </TableRow>)}</TableBody></Table>{!list.games?.length && <p className="p-8 text-center text-sm text-admin-muted">Belum ada game. Katalog akan muncul setelah sinkron.</p>}</Card>}
      {tab === "variants" && <div className="space-y-4">
        <fieldset disabled={busy} className="flex flex-wrap items-end gap-3"><Input className="w-full sm:flex-1" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari kode atau nama varian…" aria-label="Cari kode atau nama varian" /><NativeSelect className="w-full sm:w-48" value={brand} aria-label="Game" onChange={e => { setBrand(e.target.value); setPage(1); }}><option value="">Semua game</option>{list.brands.map(value => <option key={value} value={value}>{value}</option>)}</NativeSelect><NativeSelect className="w-full sm:w-40" value={sellable} aria-label="Filter bisa dijual" onChange={e => { setSellable(e.target.value); setPage(1); }}><option value="">Semua varian</option><option value="1">Bisa dijual</option></NativeSelect><NativeSelect className="w-full sm:w-40" value={enabled} aria-label="Status jual" onChange={e => { setEnabled(e.target.value); setPage(1); }}><option value="">Semua status</option><option value="1">Aktif</option><option value="0">Belum aktif</option></NativeSelect>{(q || brand || sellable || enabled) && <Button variant="outline" onClick={() => { setQ(""); setBrand(""); setSellable(""); setEnabled(""); setPage(1); }}>Hapus filter</Button>}</fieldset>
        <p role="status" className="text-xs text-admin-muted">{loading ? "Memuat varian…" : `${list.total} varian cocok · halaman ${page} dari ${totalPages}`}</p>
        <VariantsPanel key={`${search}:${brand}:${enabled}:${sellable}:${page}`} items={list.items} total={list.total} busy={busy || loading} onPatch={patch} onBulk={body => mutate("/api/admin/games/products/bulk-markup", "POST", body, data => `${data.changed ?? data.updated} varian diperbarui`)} />
        <div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={page <= 1 || loading || busy} onClick={() => setPage(page - 1)}>Sebelumnya</Button><Button variant="outline" size="sm" disabled={page >= totalPages || loading || busy} onClick={() => setPage(page + 1)}>Berikutnya</Button></div>
      </div>}
      {tab === "pricing" && list.pricing && <PricingPanel pricing={list.pricing} count={list.sync.counts.total} busy={busy || loading} onSave={body => mutate("/api/admin/games/pricing", "PUT", body, data => `${data.updated} harga diperbarui`)} />}
      {editing && list.pricing && <GameEditor key={editing.slug} game={editing} pricing={list.pricing} busy={busy} onClose={() => setEditing(null)} onSave={body => mutate("/api/admin/games/games", "PATCH", body, "Game disimpan.")} />}
    </>}
  </div>;
}

function GameIcon({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false);
  // eslint-disable-next-line @next/next/no-img-element
  return game.icon && !failed ? <img src={game.icon} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-10 shrink-0 rounded-md object-cover" /> : <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-md bg-admin-subtle text-sm font-semibold">{game.name.slice(0, 2).toUpperCase()}</span>;
}
