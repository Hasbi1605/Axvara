// src/components/admin/SupplierPairsManager.tsx — Tab "WR vs SK".
// Pemetaan pasangan + pemenang otomatis (keputusan owner 2026-09-30):
// produk yang sama di dua supplier dipilih OTOMATIS mana yang tampil
// (stok dulu, modal kemudian), bukan manual.
//
// Admin di sini: lihat 28 pasangan + pemenang + alasan, atur prefer
// (auto/WR/SK + margin), hitung ulang manual. Pembeli tidak pernah
// melihat tab ini — mereka hanya melihat pemenangnya di katalog.

"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trophy } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { Badge, Button, Card, Input, Label, NativeSelect, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
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
      toast.success("Preferensi disimpan + pemenang dihitung ulang.");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menyimpan");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-admin-fg">Pemenang otomatis WR vs SK</h2>
          <p className="mt-1 text-sm text-admin-muted">Stok dulu, modal kemudian. Dihitung ulang tiap sweep cron dari data live. Pecundang + produk habis disembunyikan dari katalog publik (tetap ada di admin).</p>
        </div>
        <Button onClick={() => void decideAll()} disabled={deciding || loading}>{deciding ? <Spinner size={13} /> : <RefreshCw />} Hitung ulang</Button>
      </header>

      {error && <div className="rounded-md border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger" role="alert">
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
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead>WR</TableHead>
                    <TableHead>SK</TableHead>
                    <TableHead>Pemenang</TableHead>
                    <TableHead>Preferensi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pairs.map((pair) => <TableRow key={pair.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-admin-muted">#{pair.id}</TableCell>
                    <TableCell>
                      <p className="font-medium text-admin-fg">{pair.wr_name}</p>
                      <p className="mt-1 text-xs text-admin-muted">Stok {pair.wr_stock}{pair.wr_modal != null ? ` · modal ${formatRupiah(pair.wr_modal)}` : ""}{pair.wr_active ? "" : " · nonaktif"}</p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-admin-fg">{pair.sk_name}</p>
                      <p className="mt-1 text-xs text-admin-muted">Stok {pair.sk_stock}{pair.sk_modal != null ? ` · modal ${formatRupiah(pair.sk_modal)}` : ""}{pair.sk_active ? "" : " · nonaktif"}</p>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {pair.winner == null
                          ? <Badge variant="secondary">Belum ada pemenang</Badge>
                          : <Badge variant={pair.winner === "WR" ? "success" : "info"}><Trophy /> {pair.winner === "WR" ? "WR" : "SK"}</Badge>}
                        {pair.reason && <p className="font-mono text-xs text-admin-muted">{pair.reason}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <PairPreference pair={pair} saving={saving === pair.id} onSave={savePrefer} />
                    </TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 p-4 md:hidden">
              {pairs.map((pair) => <article key={pair.id} className="space-y-3 rounded-md border border-admin-border p-3">
                <div className="space-y-1">
                  <Badge variant={pair.winner === "WR" ? "success" : "secondary"}>WR · stok {pair.wr_stock}</Badge>
                  <p className="text-xs text-admin-muted">{pair.wr_name}{pair.wr_modal != null ? ` · modal ${formatRupiah(pair.wr_modal)}` : ""}{pair.wr_active ? "" : " · nonaktif"}</p>
                </div>
                <div className="space-y-1">
                  <Badge variant={pair.winner === "SK" ? "info" : "secondary"}>SK · stok {pair.sk_stock}</Badge>
                  <p className="text-xs text-admin-muted">{pair.sk_name}{pair.sk_modal != null ? ` · modal ${formatRupiah(pair.sk_modal)}` : ""}{pair.sk_active ? "" : " · nonaktif"}</p>
                </div>
                {pair.winner == null
                  ? <Badge variant="secondary">Belum ada pemenang</Badge>
                  : <Badge variant={pair.winner === "WR" ? "success" : "info"}><Trophy /> Pemenang {pair.winner}: {pair.winner === "WR" ? pair.wr_name : pair.sk_name}</Badge>}
                {pair.reason && <p className="font-mono text-xs text-admin-muted">{pair.reason}</p>}
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
  return <div className="flex flex-wrap items-end gap-2">
    <div className="space-y-1">
      <Label className="text-xs text-admin-muted" htmlFor={`pair-prefer-${pair.id}`}>Preferensi kualitas</Label>
      <NativeSelect id={`pair-prefer-${pair.id}`} value={prefer} onChange={(event) => setPrefer(event.target.value as "auto" | "WR" | "SK")} title="Preferensi kualitas (mengalahkan selisih modal kecil)" className="w-[150px]">
        <option value="auto">Auto</option>
        <option value="WR">Utamakan WR</option>
        <option value="SK">Utamakan SK</option>
      </NativeSelect>
    </div>
    <div className="space-y-1">
      <Label className="text-xs text-admin-muted" htmlFor={`pair-margin-${pair.id}`}>Toleransi margin (Rp)</Label>
      <Input id={`pair-margin-${pair.id}`} value={margin} onChange={(event) => setMargin(event.target.value)} inputMode="numeric" className="w-24 text-right tabular-nums" />
    </div>
    <Button size="sm" onClick={() => onSave(pair, prefer, Math.max(0, Math.floor(Number(margin) || 0)))} disabled={saving}>{saving ? <Spinner size={13} /> : null} Simpan</Button>
  </div>;
}
