"use client";
import { useState } from "react";
import { Button, Input, Label, Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Textarea } from "@/components/admin/ui";
import { useAdminDraft } from "../AdminWorkspace";
import { ImageDropzone } from "../ImageDropzone";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { computeGamesMarkupPrice } from "@/lib/games/pricing";
import { formatRupiah } from "@/lib/utils";
import { markupValid, type Game, type Pricing } from "./shared";

export function GameEditor({ game, pricing, busy, onClose, onSave }: { game: Game; pricing: Pricing; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
  const initial = { display_name: game.name, publisher: game.publisher ?? "", icon_url: game.icon ?? "", banner_url: game.banner ?? "", description: game.description ?? "", id_guide: game.id_guide ?? "", featured_rank: game.featured_rank == null ? "" : String(game.featured_rank), markup_percent: game.markup_percent == null ? "" : String(game.markup_percent) };
  const [draft, setDraft] = useState(initial), [error, setError] = useState(""), [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useAdminDraft(dirty || busy, busy);
  const update = (key: keyof typeof draft, value: string) => setDraft(old => ({ ...old, [key]: value }));
  function close() { if (!busy) { if (dirty) setDiscard(true); else onClose(); } }
  async function save() {
    if (!draft.display_name.trim()) { setError("Nama tampil wajib diisi."); return; }
    if (!markupValid(draft.markup_percent, true)) { setError("Markup harus 0–100%, maksimal 2 desimal."); return; }
    if (draft.featured_rank !== "" && (!/^\d+$/.test(draft.featured_rank) || Number(draft.featured_rank) < 1 || Number(draft.featured_rank) > 99)) { setError("Urutan populer harus bilangan bulat 1–99."); return; }
    if (draft.description.length > 600 || draft.id_guide.length > 600) { setError("Deskripsi dan panduan maksimal 600 karakter."); return; }
    // Inherited artwork can be /brand/...; only newly uploaded image URLs belong in the PATCH.
    const changed = Object.fromEntries((Object.keys(draft) as (keyof typeof draft)[]).filter(key => draft[key] !== initial[key]).map(key => [key, key === "featured_rank" || key === "markup_percent" ? draft[key].trim() === "" ? null : Number(draft[key]) : draft[key]]));
    if (await onSave({ slug: game.slug, ...changed })) onClose();
    else setError("Game belum tersimpan. Periksa koneksi lalu coba lagi.");
  }
  const preview = markupValid(draft.markup_percent, true) ? computeGamesMarkupPrice({ cost: 50000, markupPercent: draft.markup_percent.trim() === "" ? pricing.markup_percent : Number(draft.markup_percent), rounding: pricing.rounding }) : null;
  return <><Sheet open onOpenChange={open => { if (!open) close(); }}><SheetContent className="w-full max-w-xl sm:w-[85vw]" onEscapeKeyDown={e => { if (dirty || busy) { e.preventDefault(); close(); } }} onInteractOutside={e => { if (busy) e.preventDefault(); }}>
    <form noValidate className="flex min-h-full flex-col" onSubmit={e => { e.preventDefault(); void save(); }}>
      <SheetHeader className="border-b border-admin-border p-6 pr-12"><SheetTitle>Edit game</SheetTitle><SheetDescription>Atur tampilan dan markup {game.name}.</SheetDescription></SheetHeader>
      <fieldset disabled={busy} className="min-w-0 flex-1 space-y-4 p-6">
        {error && <p role="alert" className="text-sm text-admin-danger">{error}</p>}
        <Label className="grid gap-2">Nama tampil<Input maxLength={120} value={draft.display_name} onChange={e => update("display_name", e.target.value)} /></Label>
        <Label className="grid gap-2">Publisher<Input maxLength={120} value={draft.publisher} onChange={e => update("publisher", e.target.value)} /></Label>
        <div role="group" aria-label="Ikon" className="space-y-2 [&_img]:max-h-32"><Label>Ikon</Label><ImageDropzone area="banners" value={draft.icon_url} onUploaded={url => update("icon_url", url)} onRemove={() => update("icon_url", "")} /></div>
        <div role="group" aria-label="Banner" className="space-y-2"><Label>Banner</Label><ImageDropzone area="banners" value={draft.banner_url} onUploaded={url => update("banner_url", url)} onRemove={() => update("banner_url", "")} /></div>
        <Label className="grid gap-2">Deskripsi singkat<Textarea value={draft.description} maxLength={600} onChange={e => update("description", e.target.value)} /><span className="text-right text-xs text-admin-muted">{draft.description.length}/600 karakter</span></Label>
        <Label className="grid gap-2">Panduan cari ID<Textarea value={draft.id_guide} maxLength={600} onChange={e => update("id_guide", e.target.value)} /><span className="text-right text-xs text-admin-muted">{draft.id_guide.length}/600 karakter</span></Label>
        <Label className="grid gap-2">Urutan populer<Input inputMode="numeric" value={draft.featured_rank} onChange={e => update("featured_rank", e.target.value)} /><span className="text-xs text-admin-muted">1–99. Kosongkan bila bukan game populer.</span></Label>
        <Label className="grid gap-2">Markup khusus %<Input inputMode="decimal" value={draft.markup_percent} placeholder="Ikut default" onChange={e => update("markup_percent", e.target.value)} /><span className="text-xs text-admin-muted">Kosongkan untuk mengikuti markup default.</span></Label>
        <p className="text-sm tabular-nums text-admin-muted">Contoh: modal {formatRupiah(50000)} → {preview == null ? "Periksa markup" : formatRupiah(preview)}</p>
      </fieldset>
      <SheetFooter className="sticky bottom-0 border-t border-admin-border bg-admin-card p-4"><Button type="button" variant="outline" disabled={busy} onClick={close}>Batal</Button><Button type="submit" disabled={busy || !dirty}>{busy ? "Menyimpan…" : "Simpan"}</Button></SheetFooter>
    </form>
  </SheetContent></Sheet><ConfirmDialog open={discard} title="Buang perubahan game?" description="Perubahan yang belum disimpan akan hilang." confirmLabel="Buang perubahan" onClose={() => setDiscard(false)} onConfirm={onClose} /></>;
}
