"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";
import { Spinner } from "@/components/ui/Loading";

type Subscriber = { id: number; email: string; status: string; source: string; created_at: string };

export function NewsletterSubscribers() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/subscribers", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Email pelanggan gagal dimuat");
      setSubscribers(body.subscribers ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Email pelanggan gagal dimuat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => subscribers.filter((subscriber) => subscriber.email.toLowerCase().includes(query.trim().toLowerCase())), [query, subscribers]);

  return (
    <section className="mt-5 ax-glass rounded-[20px] overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4 sm:p-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-white/5"><IosIcon name="news" size={16} tint="white" /></span>
        <div><h2 className="text-sm font-semibold text-white">Pelanggan Email</h2><p className="text-xs text-white/40">Alamat yang dikirim melalui form “Tetap update” di footer.</p></div>
        <span className="ml-auto rounded-full bg-white/10 px-3 py-1 text-xs text-white/60">{subscribers.length} email</span>
      </div>
      <div className="border-b border-white/10 p-4 sm:px-5"><div className="relative max-w-[420px]"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60"><IosIcon name="search" size={14} tint="white" /></span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari email…" className="h-10 w-full rounded-full border border-white/10 bg-white/[0.06] pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:border-[#00E5FF]/40 focus:outline-none" /></div></div>
      {error ? <div className="p-8 text-center"><p className="text-sm text-red-300">{error}</p><button type="button" onClick={() => void load()} className="mt-3 text-sm font-semibold text-[#00E5FF]">Coba lagi</button></div>
      : loading ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-white/50"><Spinner size={18} /> Memuat email…</div>
      : filtered.length === 0 ? <p className="p-8 text-center text-sm text-white/40">{query ? "Email tidak ditemukan." : "Belum ada email yang masuk."}</p>
      : <div className="divide-y divide-white/5">{filtered.map((subscriber) => <div key={subscriber.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-white/[0.03] sm:px-5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white">{subscriber.email}</p><p className="mt-0.5 text-xs text-white/35">Dari footer · {new Date(subscriber.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</p></div><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">Aktif</span></div>)}</div>}
    </section>
  );
}
