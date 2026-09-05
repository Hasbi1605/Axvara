"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Loading";

type Counts = { available: number; reserved: number; delivered: number; revoked: number };

export function FulfillmentInventoryPanel({ productId, variantId, mode }: { productId: number; variantId: number; mode: string }) {
  const toast = useToast();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [sharedText, setSharedText] = useState("");
  const [inventoryText, setInventoryText] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/fulfillment?product_id=${productId}&variant_id=${variantId}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as Partial<Counts>;
      if (response.ok) setCounts({ available: Number(data.available || 0), reserved: Number(data.reserved || 0), delivered: Number(data.delivered || 0), revoked: Number(data.revoked || 0) });
    } catch { /* Status inventory bersifat pendukung. */ }
  }, [productId, variantId]);
  useEffect(() => { if (mode !== "manual") void load(); }, [load, mode]);

  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/admin/fulfillment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: productId, variant_id: variantId, ...payload }) });
    const data = await response.json().catch(() => ({})) as { error?: string; inserted?: number; duplicate?: number; invalid?: number };
    if (!response.ok) throw new Error(data.error || "Konfigurasi fulfillment gagal disimpan");
    return data;
  };

  const saveShared = async () => {
    if (!sharedText.trim()) return;
    setLoading(true);
    try { await post({ action: "set_shared_secret", shared_secret: sharedText.trim() }); setSharedText(""); toast.success("Pesan bersama disimpan terenkripsi."); await load(); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Pesan bersama gagal disimpan"); }
    finally { setLoading(false); }
  };
  const importInventory = async () => {
    const secrets = inventoryText.split("\n").map((value) => value.trim()).filter(Boolean);
    if (!secrets.length) return;
    setLoading(true);
    try {
      await post({ action: "set_mode", fulfillment_mode: "unique" });
      const data = await post({ action: "import", secrets });
      setInventoryText(""); toast.success(`${data.inserted || 0} stok unik ditambahkan.`); await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Inventory gagal diimpor"); }
    finally { setLoading(false); }
  };

  if (mode === "manual") return <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3 text-xs text-white/40">Fulfillment manual: admin mengirim akses setelah pembayaran dikonfirmasi.</div>;

  return <div className="mt-4 rounded-2xl border border-[#00E5FF]/15 bg-[#00E5FF]/[0.035] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold text-white">Konten fulfillment</p><p className="mt-0.5 text-[11px] text-white/35">Tersimpan terenkripsi dan tidak pernah ditampilkan kembali.</p></div>{counts && <div className="flex flex-wrap gap-1.5 text-[10px]"><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">Tersedia {counts.available}</span><span className="rounded-full bg-white/[0.06] px-2 py-1 text-white/45">Terpakai {counts.delivered}</span><span className="rounded-full bg-[#FFB800]/10 px-2 py-1 text-[#FFCF55]">Dipesan {counts.reserved}</span></div>}</div>
    {mode === "shared" ? <div className="mt-3"><textarea value={sharedText} onChange={(event) => setSharedText(event.target.value)} rows={3} placeholder="Link, akun bersama, atau instruksi yang dikirim ke setiap pembeli…" className="w-full resize-none rounded-xl border border-white/10 bg-[#080C1E]/65 p-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#00E5FF]/40" /><button onClick={() => void saveShared()} disabled={loading || !sharedText.trim()} className="mt-2 inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-4 text-xs font-bold text-[#07101f] disabled:opacity-40">{loading && <Spinner size={13} />} Simpan pesan bersama</button></div> : <div className="mt-3"><textarea value={inventoryText} onChange={(event) => setInventoryText(event.target.value)} rows={4} placeholder={"Satu akun/key per baris\nemail:password\nLICENSE-KEY"} className="w-full resize-none rounded-xl border border-white/10 bg-[#080C1E]/65 p-3 font-mono text-xs text-white outline-none placeholder:text-white/25 focus:border-[#00E5FF]/40" /><div className="mt-2 flex items-center justify-between gap-3"><p className="text-[10px] text-white/35">Maksimal 100 entri per impor.</p><button onClick={() => void importInventory()} disabled={loading || !inventoryText.trim()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-4 text-xs font-bold text-[#07101f] disabled:opacity-40">{loading && <Spinner size={13} />} Impor stok unik</button></div></div>}
  </div>;
}
