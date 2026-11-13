"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Spinner } from "@/components/ui/Loading";
import { formatWibDateTime } from "@/lib/utils";
import { Badge, Button, Card, Input } from "./ui";

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
    <Card className="mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-admin-border p-4 sm:p-6">
        <div className="min-w-0"><h2 className="text-base font-semibold text-admin-fg">Pelanggan Email</h2><p className="text-sm text-admin-muted">Alamat yang dikirim melalui form “Tetap update” di footer.</p></div>
        <Badge variant="secondary" className="ml-auto">{subscribers.length} email</Badge>
      </div>
      <div className="border-b border-admin-border p-4 sm:px-6">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-admin-muted" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari email…" aria-label="Cari email" className="pl-9" />
        </div>
      </div>
      {error ? <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-admin-danger/25 bg-admin-danger/10 p-4 text-sm text-admin-danger"><p>{error}</p><Button variant="outline" size="sm" type="button" onClick={() => void load()}>Coba lagi</Button></div>
      : loading ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-admin-muted"><Spinner size={18} /> Memuat email…</div>
      : filtered.length === 0 ? <p className="p-8 text-center text-sm text-admin-muted">{query ? "Email tidak ditemukan." : "Belum ada email yang masuk."}</p>
      : <div className="divide-y divide-admin-border">{filtered.map((subscriber) => <div key={subscriber.id} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-admin-subtle/50 sm:px-6"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-admin-fg">{subscriber.email}</p><p className="mt-0.5 text-xs text-admin-muted">Dari footer · {formatWibDateTime(subscriber.created_at) ?? "—"}</p></div><Badge variant={subscriber.status === "active" ? "success" : "secondary"}>{subscriber.status === "active" ? "Aktif" : "Berhenti"}</Badge></div>)}</div>}
    </Card>
  );
}
