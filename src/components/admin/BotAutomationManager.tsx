"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { Badge, Button, Card } from "./ui";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";

interface HealthData {
  bot_configured: boolean;
  bot_enabled: boolean;
  fulfillment_enabled: boolean;
  encryption_key_set: boolean;
  whatsapp_configured: boolean;
  whatsapp_enabled: boolean;
  whatsapp_discovery: boolean;
  whatsapp_payment: boolean;
  whatsapp_proof_intake: boolean;
  webhook?: { url?: string; pending_updates?: number; last_error?: string | null; error?: string };
  telegram_orders?: { status: string; count: number }[];
  whatsapp_orders?: { payment_status: string; count: number }[];
  fulfillment_jobs?: { status: string; count: number }[];
  whatsapp_outbox?: { status: string; count: number }[];
}

export default function BotAutomationManager() {
  const toast = useToast();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/bot/health", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as HealthData & { error?: string };
      if (!response.ok) throw new Error(data.error || "Status otomasi gagal dimuat");
      setHealth(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Status otomasi gagal dimuat"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void fetchHealth(); }, [fetchHealth]);

  const setTelegramWebhook = async () => {
    setWebhookLoading(true);
    try {
      const response = await fetch("/api/admin/telegram/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set" }) });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; webhook_url?: string; description?: string; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.description || data.error || "Webhook gagal dipasang");
      toast.success("Webhook Telegram berhasil diperbarui.");
      await fetchHealth();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Webhook gagal dipasang"); }
    finally { setWebhookLoading(false); }
  };

  if (loading) return <Card className="mt-4 flex min-h-52 items-center justify-center gap-3 text-sm text-admin-muted"><Spinner size={20} /> Memuat kanal dan otomasi…</Card>;
  if (error) return <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-admin-danger/25 bg-admin-danger/10 p-4 text-sm text-admin-danger"><p>{error}. Status kanal belum diketahui.</p><Button variant="outline" size="sm" onClick={() => void fetchHealth()}>Coba lagi</Button></div>;

  return <div className="mt-4 space-y-6">
    <Card className="overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-admin-border p-4 sm:p-6"><div className="min-w-0"><h2 className="text-base font-semibold text-admin-fg">Kanal penjualan</h2><p className="mt-0.5 text-sm text-admin-muted">Kesehatan Telegram dan gateway WhatsApp Baileys.</p></div><Button variant="outline" size="sm" onClick={() => void fetchHealth()} className="ml-auto"><RefreshCw aria-hidden="true" /> Muat ulang</Button></header>
      <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-2">
        <ChannelCard title="Telegram" ready={Boolean(health?.bot_configured && health.bot_enabled)} rows={[["Token", health?.bot_configured], ["Bot aktif", health?.bot_enabled], ["Webhook", Boolean(health?.webhook?.url && !health.webhook.error)]]}>
          <p className="mt-3 break-all font-mono text-xs text-admin-muted">{health?.webhook?.url || "Webhook belum tersedia"}</p>
          {health?.webhook?.last_error && <p className="mt-1 text-xs text-admin-danger">{health.webhook.last_error}</p>}
          <Button size="sm" onClick={() => void setTelegramWebhook()} disabled={webhookLoading || !health?.bot_configured} className="mt-4">{webhookLoading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />} Pasang/perbarui webhook</Button>
        </ChannelCard>
        <ChannelCard title="WhatsApp Baileys" ready={Boolean(health?.whatsapp_configured && health.whatsapp_enabled)} rows={[["Gateway", health?.whatsapp_configured], ["Bot aktif", health?.whatsapp_enabled], ["Pencarian", health?.whatsapp_discovery], ["Pembayaran", health?.whatsapp_payment], ["Bukti manual", health?.whatsapp_proof_intake]]}>
          <p className="mt-3 text-xs leading-5 text-admin-muted">Status ini memeriksa konfigurasi server. Koneksi sesi Baileys tetap perlu dilaporkan oleh health endpoint gateway Heroku.</p>
        </ChannelCard>
      </div>
    </Card>

    <Card className="overflow-hidden">
      <header className="border-b border-admin-border p-4 sm:p-6"><h2 className="text-base font-semibold text-admin-fg">Antrean otomasi</h2><p className="mt-0.5 text-sm text-admin-muted">Pantau pengiriman fulfillment dan pesan keluar WhatsApp.</p></header>
      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6"><QueueCard title="Fulfillment jobs" rows={health?.fulfillment_jobs || []} labelKey="status" /><QueueCard title="WhatsApp outbox" rows={health?.whatsapp_outbox || []} labelKey="status" /></div>
      <div className="mx-4 mb-4 flex flex-wrap items-center gap-3 rounded-md border border-admin-border bg-admin-subtle p-4 sm:mx-6 sm:mb-6"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-admin-fg">Konfigurasi produk dipusatkan di Varian</p><p className="mt-1 text-xs leading-5 text-admin-muted">Mode manual/shared/unique, pesan bersama, dan stok unik sekarang dikelola bersama SKU agar tidak ada pengaturan ganda.</p></div><Button asChild variant="outline" size="sm"><Link href="/admin?section=products">Buka Produk</Link></Button></div>
    </Card>
  </div>;
}

function ChannelCard({ title, ready, rows, children }: { title: string; ready: boolean; rows: [string, boolean | undefined][]; children: React.ReactNode }) {
  return <article className="rounded-md border border-admin-border p-4"><div className="flex items-center justify-between gap-3"><h3 className="min-w-0 text-sm font-semibold text-admin-fg">{title}</h3><Badge variant={ready ? "success" : "destructive"}>{ready ? "Siap" : "Perlu konfigurasi"}</Badge></div><div className="mt-4 grid grid-cols-2 gap-2">{rows.map(([label, ok]) => <div key={label} className="flex items-center gap-2 rounded-md bg-admin-subtle px-2.5 py-2 text-xs font-medium text-admin-fg"><span aria-hidden="true" className={`inline-block size-2 rounded-full ${ok ? "bg-admin-success" : "bg-admin-danger"}`} />{label}<span className="sr-only">{ok ? ": aktif" : ": belum"}</span></div>)}</div>{children}</article>;
}

function QueueCard({ title, rows, labelKey }: { title: string; rows: Record<string, unknown>[]; labelKey: string }) {
  return <article className="rounded-md border border-admin-border p-4"><h3 className="text-sm font-semibold text-admin-fg">{title}</h3><div className="mt-3 flex flex-wrap gap-2">{rows.length ? rows.map((row) => <Badge key={String(row[labelKey])} variant={["failed", "dead", "manual_required"].includes(String(row[labelKey])) ? "destructive" : "secondary"}>{String(row[labelKey])}: {Number(row.count || 0)}</Badge>) : <span className="text-sm text-admin-muted">Belum ada antrean.</span>}</div></article>;
}
