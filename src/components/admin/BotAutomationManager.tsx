"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { Badge, Button, Card, PageHeader, Skeleton } from "./ui";
import { formatWibDateTime } from "@/lib/utils";
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
  fulfillment_action?: { orders: { code: string; product: string; status: string; updated_at: string }[]; total: number; whatsapp_outbox_failed_7d: number };
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

  return <div className="mt-4 space-y-6">
    <PageHeader title="Kanal & Fulfillment" description="Pantau kanal aktif dan pengiriman yang memerlukan tindakan." actions={<Button variant="outline" size="sm" disabled={loading} onClick={() => void fetchHealth()}><RefreshCw /> Muat ulang</Button>} />
    {loading ? <div role="status" className="space-y-4"><Skeleton className="h-64 w-full" /><Skeleton className="h-40 w-full" /><span className="sr-only">Memuat kanal dan otomasi…</span></div> : error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-admin-danger/25 bg-admin-danger/10 p-4 text-sm text-admin-danger"><p>{error}. Status kanal belum diketahui.</p><Button variant="outline" size="sm" onClick={() => void fetchHealth()}>Coba lagi</Button></div> : <>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChannelCard title="Telegram" ready={Boolean(health?.bot_configured && health.bot_enabled)} rows={[["Token", health?.bot_configured], ["Bot aktif", health?.bot_enabled], ["Webhook", Boolean(health?.webhook?.url && !health.webhook.error)]]}>
          <p className="mt-3 break-all font-mono text-xs text-admin-muted">{health?.webhook?.url || "Webhook belum tersedia"}</p>
          {health?.webhook?.last_error && <p className="mt-1 text-xs text-admin-danger">{health.webhook.last_error}</p>}
          <Button size="sm" onClick={() => void setTelegramWebhook()} disabled={webhookLoading || !health?.bot_configured} className="mt-4">{webhookLoading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />} Pasang/perbarui webhook</Button>
        </ChannelCard>
        <ChannelCard title="WhatsApp" ready={Boolean(health?.whatsapp_configured && health.whatsapp_enabled)} rows={[["Gateway", health?.whatsapp_configured], ["Bot aktif", health?.whatsapp_enabled]]}>
          <p className="mt-3 text-sm text-admin-fg">Grup &amp; siaran aktif · pembelian via WA dipensiunkan</p>
          <p className="mt-3 text-xs leading-5 text-admin-muted">Status ini memeriksa konfigurasi server. Koneksi sesi Baileys tetap perlu dilaporkan oleh health endpoint gateway Heroku.</p>
        </ChannelCard>
      </div>
    <Card className="p-4 sm:p-6">
      <h3 className="font-semibold">Perlu tindakan</h3>
      <div className="mt-4 divide-y divide-admin-border">{health?.fulfillment_action?.orders?.length ? health.fulfillment_action.orders.map(order => <div key={order.code} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0"><a className="break-all text-sm font-medium underline underline-offset-4" href={`/admin?section=orders&q=${encodeURIComponent(order.code)}`}>{order.code}</a><p className="mt-1 break-words text-sm text-admin-muted">{order.product}</p><p className="mt-1 text-xs text-admin-muted">{formatWibDateTime(order.updated_at)} WIB</p></div><Badge variant={order.status === "failed" ? "destructive" : "warning"}>{order.status === "failed" ? "Gagal kirim" : order.status === "manual_required" ? "Perlu tindakan" : "Antrean tertahan"}</Badge></div>) : <p className="py-4 text-sm text-admin-muted">Tidak ada pengiriman yang macet</p>}</div>
      <p className="mt-4 text-xs text-admin-muted">Pesan WhatsApp gagal 7 hari: {health?.fulfillment_action?.whatsapp_outbox_failed_7d ?? 0}</p>
    </Card></>}
  </div>;
}

function ChannelCard({ title, ready, rows, children }: { title: string; ready: boolean; rows: [string, boolean | undefined][]; children: React.ReactNode }) {
  return <Card className="p-4"><div className="flex items-center justify-between gap-3"><h3 className="min-w-0 text-sm font-semibold text-admin-fg">{title}</h3><Badge variant={ready ? "success" : "destructive"}>{ready ? "Siap" : "Perlu konfigurasi"}</Badge></div><div className="mt-4 grid grid-cols-2 gap-2">{rows.map(([label, ok]) => <div key={label} className="flex items-center gap-2 rounded-md bg-admin-subtle px-2.5 py-2 text-xs font-medium text-admin-fg"><span aria-hidden="true" className={`inline-block size-2 rounded-full ${ok ? "bg-admin-success" : "bg-admin-danger"}`} />{label}<span className="sr-only">{ok ? ": aktif" : ": belum"}</span></div>)}</div>{children}</Card>;
}
