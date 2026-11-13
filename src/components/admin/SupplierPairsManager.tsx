// src/components/admin/SupplierPairsManager.tsx — Tab "WR vs SK".
// Pemetaan pasangan + pemenang otomatis (keputusan owner 2026-09-30):
// produk yang sama di dua supplier dipilih OTOMATIS mana yang tampil
// (stok dulu, modal kemudian), bukan manual.
//
// Admin di sini: lihat pasangan + pemenang + alasan, atur prefer
// (auto/WR/SK + margin), hitung ulang manual. Pembeli tidak pernah
// melihat tab ini — mereka hanya melihat pemenangnya di katalog.

"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { Badge, Button, Card, Input, NativeSelect, PageHeader, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";

type PairRow = {
  id: number;
  wr_product_id: number;
  wr_name: string;
  wr_stock: number;
  wr_modal: number | null;
  wr_active: boolean;
  sk_product_id: number;
  sk_name: string;
  sk_stock: number;
  sk_modal: number | null;
  sk_active: boolean;
  winner: "WR" | "SK" | null;
  prefer: "auto" | "WR" | "SK";
  prefer_margin: number;
  decided_at: string | null;
  reason: string | null;
};

const hasStock = (stock: number) => stock < 0 || stock > 0;

/** Teks perbandingan manusiawi untuk satu pasangan (D5, tanpa angka mentah). */
export function pairComparison(pair: PairRow): string {
  if (!hasStock(pair.wr_stock) && !hasStock(pair.sk_stock)) return "Keduanya habis";
  if (!pair.wr_active && !pair.sk_active) return "Keduanya nonaktif";
  if (!pair.wr_active) return "WR nonaktif";
  if (!pair.sk_active) return "SK nonaktif";
  if (pair.wr_modal != null && pair.sk_modal != null && pair.wr_modal !== pair.sk_modal) {
    const cheap = pair.sk_modal < pair.wr_modal ? "SK" : "WR";
    const low = Math.min(pair.wr_modal, pair.sk_modal), high = Math.max(pair.wr_modal, pair.sk_modal);
    return `${cheap} lebih murah · ${formatRupiah(low)} vs ${formatRupiah(high)}`;
  }
  if (pair.wr_modal != null && pair.sk_modal != null) return "Modal sama";
  if (pair.wr_stock !== pair.sk_stock) {
    const more = pair.sk_stock > pair.wr_stock ? "SK" : "WR";
    return `Stok ${more} lebih banyak`;
  }
  return "Keduanya tersedia";
}

/** Alasan pemenang dalam bahasa manusia; kode internal tidak ditampilkan. */
export function humanPairReason(reason: string | null): string {
  if (!reason) return "Belum dihitung";
  if (reason === "pasangan_yatim") return "Pasangan belum lengkap";
  if (reason.includes("dua-duanya nonaktif")) return "Keduanya nonaktif";
  if (reason.includes("dua-duanya habis")) return "Keduanya habis";
  if (reason.startsWith("stok SK habis")) return "Stok SK habis";
  if (reason.startsWith("stok WR habis")) return "Stok WR habis";
  if (reason.includes("nonaktif manual")) return "Salah satu supplier nonaktif";
  if (reason.startsWith("modal tak terbaca")) return "Modal belum terbaca";
  if (reason.startsWith("modal seri")) return "Modal sama";
  if (reason.startsWith("prefer")) return "Sesuai preferensi admin";
  if (reason.startsWith("modal")) return "Modal lebih murah";
  return "Dipilih otomatis";
}

export function SupplierPairsManager() {
  const toast = useToast();
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/supplier-pairs", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat pasangan");
      setPairs(body.pairs || []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memuat pasangan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decideAll = async () => {
    setDeciding(true);
    try {
      const res = await fetch("/api/admin/supplier-pairs/decide", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menghitung");
      toast.success(`Pemenang dihitung: ${body.decided} pasangan, ${body.changed} berubah.`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menghitung");
    } finally {
      setDeciding(false);
    }
  };

  const savePrefer = async (pair: PairRow, prefer: string, margin: number) => {
    setSaving(pair.id);
    try {
      const res = await fetch("/api/admin/supplier-pairs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pair.id, prefer, prefer_margin: margin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menyimpan");
      toast.success("Preferensi disimpan dan pemenang dihitung ulang.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menyimpan");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="WR vs SK"
        description="Produk yang sama di dua supplier dipilih otomatis: stok lebih dulu, lalu modal. Yang tidak tampil disembunyikan dari katalog."
        actions={<Button onClick={() => void decideAll()} disabled={deciding || loading}>{deciding ? <Spinner size={13} /> : <RefreshCw />} Hitung ulang</Button>}
      />

      {error && <div className="rounded-xl border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger" role="alert">
        <p>{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Coba lagi</Button>
      </div>}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
        ) : !pairs.length ? (
          <p className="p-10 text-center text-sm text-admin-muted">Belum ada pasangan.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <caption className="sr-only">Pasangan produk Warung Rebahan dan Sekalipay</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead>WR</TableHead>
                    <TableHead>SK</TableHead>
                    <TableHead>Perbandingan</TableHead>
                    <TableHead>Preferensi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pairs.map((pair) => <TableRow key={pair.id}>
                    <TableCell className="min-w-[160px]">
                      <p className="font-medium text-admin-fg">{pair.wr_name || pair.sk_name}</p>
                      <p className="mt-1 text-xs text-admin-muted">Pasangan #{pair.id}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <Badge variant={pair.winner === "WR" ? "success" : "secondary"}>{pair.winner === "WR" ? "Tampil" : "Tidak tampil"}</Badge>
                      <p className="mt-1 text-admin-muted">stok {pair.wr_stock < 0 ? "tak terbatas" : pair.wr_stock}{pair.wr_modal != null ? ` · modal ${formatRupiah(pair.wr_modal)}` : ""}{pair.wr_active ? "" : " · nonaktif"}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <Badge variant={pair.winner === "SK" ? "success" : "secondary"}>{pair.winner === "SK" ? "Tampil" : "Tidak tampil"}</Badge>
                      <p className="mt-1 text-admin-muted">stok {pair.sk_stock < 0 ? "tak terbatas" : pair.sk_stock}{pair.sk_modal != null ? ` · modal ${formatRupiah(pair.sk_modal)}` : ""}{pair.sk_active ? "" : " · nonaktif"}</p>
                    </TableCell>
                    <TableCell className="min-w-[220px] text-xs">
                      <p className="text-admin-fg">{pairComparison(pair)}</p>
                      <p className="mt-1 text-admin-muted">{humanPairReason(pair.reason)}</p>
                    </TableCell>
                    <TableCell><PairPreference pair={pair} saving={saving === pair.id} onSave={savePrefer} /></TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 p-4 md:hidden" aria-label="Kartu pasangan supplier">
              {pairs.map((pair) => <article key={pair.id} className="space-y-3 rounded-xl border border-admin-border p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-admin-fg">{pair.wr_name || pair.sk_name}</p>
                    <Badge variant={pair.winner ? "success" : "secondary"}>{pair.winner ? `${pair.winner} tampil` : "Belum ada pemenang"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-admin-muted">Pasangan #{pair.id} · {pairComparison(pair)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><p className="font-medium text-admin-fg">WR</p><p className="mt-0.5 text-admin-muted">stok {pair.wr_stock < 0 ? "tak terbatas" : pair.wr_stock}{pair.wr_modal != null ? ` · ${formatRupiah(pair.wr_modal)}` : ""}</p></div>
                  <div><p className="font-medium text-admin-fg">SK</p><p className="mt-0.5 text-admin-muted">stok {pair.sk_stock < 0 ? "tak terbatas" : pair.sk_stock}{pair.sk_modal != null ? ` · ${formatRupiah(pair.sk_modal)}` : ""}</p></div>
                </div>
                <p className="text-xs text-admin-muted">{humanPairReason(pair.reason)}</p>
                <PairPreference pair={pair} saving={saving === pair.id} onSave={savePrefer} />
              </article>)}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function PairPreference({ pair, saving, onSave }: {
  pair: PairRow;
  saving: boolean;
  onSave: (pair: PairRow, prefer: string, margin: number) => void;
}) {
  const [prefer, setPrefer] = useState<"auto" | "WR" | "SK">(pair.prefer);
  const [margin, setMargin] = useState(String(pair.prefer_margin));
  // Nilai server berubah setelah simpan/refetch → sinkronkan, jangan biarkan
  // tombol "Simpan" tetap aktif karena draft lama.
  useEffect(() => { setPrefer(pair.prefer); setMargin(String(pair.prefer_margin)); }, [pair.prefer, pair.prefer_margin]);
  const dirty = prefer !== pair.prefer || margin !== String(pair.prefer_margin);
  return <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Preferensi pasangan ${pair.id}`}>
    <NativeSelect value={prefer} onChange={(event) => setPrefer(event.target.value as "auto" | "WR" | "SK")} aria-label={`Preferensi kualitas pasangan ${pair.id}`} title="Preferensi kualitas (mengalahkan selisih modal kecil)" className="w-[152px]">
      <option value="auto">Otomatis</option>
      <option value="WR">Utamakan WR</option>
      <option value="SK">Utamakan SK</option>
    </NativeSelect>
    <div className="flex items-center gap-1">
      <span className="text-xs text-admin-muted">Toleransi</span>
      <Input value={margin} onChange={(event) => setMargin(event.target.value)} inputMode="numeric" aria-label={`Toleransi margin pasangan ${pair.id}`} title="Toleransi margin (Rp)" className="w-20 text-right tabular-nums" />
    </div>
    <Button variant="outline" size="sm" onClick={() => onSave(pair, prefer, Math.max(0, Math.floor(Number(margin) || 0)))} disabled={saving || !dirty}>{saving ? <Spinner size={13} /> : null} Simpan</Button>
  </div>;
}
