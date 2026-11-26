"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Save, Send, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Input, Label, PageHeader, Skeleton, Switch } from "./ui";
import { formatWibDateTime } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

interface TelegramChannelState {
  channelUsername: string;
  channelTitle: string;
  forceSubEnabled: boolean;
  channelPromoEnabled: boolean;
  dmPromoEnabled: boolean;
  cacheTtlSeconds: number;
}

interface ChannelVerifyResult {
  ok: boolean;
  channelUsername: string;
  botUsername: string | null;
  isAdmin: boolean;
  canPostMessages: boolean;
  status: string | null;
  error?: string;
}

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
  telegram_channel?: TelegramChannelState;
  telegram_orders?: { status: string; count: number }[];
  whatsapp_orders?: { payment_status: string; count: number }[];
  fulfillment_jobs?: { status: string; count: number }[];
  whatsapp_outbox?: { status: string; count: number }[];
  fulfillment_action?: { orders: { code: string; product: string; status: string; updated_at: string }[]; total: number; whatsapp_outbox_failed_7d: number };
}

const DEFAULT_CHANNEL_STATE: TelegramChannelState = {
  channelUsername: "axvaratech",
  channelTitle: "Axvara Official",
  forceSubEnabled: false,
  channelPromoEnabled: false,
  dmPromoEnabled: true,
  cacheTtlSeconds: 21_600,
};

export default function BotAutomationManager() {
  const toast = useToast();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [channelCfg, setChannelCfg] = useState<TelegramChannelState>(DEFAULT_CHANNEL_STATE);
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelVerifying, setChannelVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<ChannelVerifyResult | null>(null);
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
      if (data.telegram_channel) {
        setChannelCfg(data.telegram_channel);
      }
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

  const saveChannelSettings = async () => {
    setChannelSaving(true);
    try {
      const response = await fetch("/api/admin/telegram/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          channelUsername: channelCfg.channelUsername,
          channelTitle: channelCfg.channelTitle,
          forceSubEnabled: channelCfg.forceSubEnabled,
          channelPromoEnabled: channelCfg.channelPromoEnabled,
          dmPromoEnabled: channelCfg.dmPromoEnabled,
          cacheTtlSeconds: channelCfg.cacheTtlSeconds,
        }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; config?: TelegramChannelState; dmPromoEnabled?: boolean; error?: string };
      if (!response.ok || !data.ok || !data.config) {
        throw new Error(data.error || "Pengaturan channel gagal disimpan.");
      }
      setChannelCfg({
        ...data.config,
        dmPromoEnabled: data.dmPromoEnabled ?? channelCfg.dmPromoEnabled,
      });
      setVerifyResult(null);
      toast.success("Pengaturan channel Telegram disimpan.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Pengaturan channel gagal disimpan.");
    } finally {
      setChannelSaving(false);
    }
  };

  const verifyChannelAdmin = async () => {
    setChannelVerifying(true);
    try {
      const response = await fetch("/api/admin/telegram/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          channelUsername: channelCfg.channelUsername,
        }),
      });
      const data = await response.json().catch(() => ({})) as ChannelVerifyResult;
      if (!response.ok) throw new Error(data.error || "Gagal memeriksa status admin bot.");
      setVerifyResult(data);
      if (data.ok) {
        toast.success(`${data.botUsername || "Bot"} aktif sebagai Admin di @${data.channelUsername}.`);
      } else {
        toast.error(data.error || "Bot belum menjadi Admin channel.");
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memeriksa status admin bot.");
    } finally {
      setChannelVerifying(false);
    }
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-admin-fg">Channel Resmi Telegram &amp; Wajib Join</h3>
            <p className="mt-1 text-xs leading-5 text-admin-muted">
              Atur channel publik untuk Smart Force-Join bot dan auto-promo katalog pagi/sore (09.00 &amp; 17.00 WIB).
            </p>
          </div>
          <Badge variant={channelCfg.forceSubEnabled ? "success" : "secondary"}>
            {channelCfg.forceSubEnabled ? "Wajib join aktif" : "Wajib join nonaktif"}
          </Badge>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Label className="grid gap-2">
            Username channel (tanpa @)
            <Input
              value={channelCfg.channelUsername}
              maxLength={64}
              placeholder="axvaratech"
              disabled={channelSaving}
              onChange={(e) => {
                setChannelCfg((prev) => ({ ...prev, channelUsername: e.target.value }));
                setVerifyResult(null);
              }}
            />
          </Label>
          <Label className="grid gap-2">
            Nama tampil channel
            <Input
              value={channelCfg.channelTitle}
              maxLength={80}
              placeholder="Axvara Official"
              disabled={channelSaving}
              onChange={(e) => setChannelCfg((prev) => ({ ...prev, channelTitle: e.target.value }))}
            />
          </Label>
        </div>
        <div className="mt-4 divide-y divide-admin-border rounded-md border border-admin-border">
          <div className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-admin-fg">Wajib join channel (Smart Force-Join)</p>
              <p className="text-xs text-admin-muted">Cek saat /start dan belanja (cache 6 jam, fail-open). Pesanan, kredensial, garansi, dan bantuan tidak pernah diblokir.</p>
            </div>
            <Switch
              aria-label="Wajib join channel (Smart Force-Join)"
              checked={channelCfg.forceSubEnabled}
              disabled={channelSaving}
              onCheckedChange={(checked) => setChannelCfg((prev) => ({ ...prev, forceSubEnabled: checked }))}
            />
          </div>
          <div className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-admin-fg">Auto-promo pagi &amp; sore ke Channel</p>
              <p className="text-xs text-admin-muted">Posting katalog ready otomatis ke @{channelCfg.channelUsername || "axvaratech"} dengan tombol Order di Bot dan Website.</p>
            </div>
            <Switch
              aria-label="Auto-promo pagi & sore ke Channel"
              checked={channelCfg.channelPromoEnabled}
              disabled={channelSaving}
              onCheckedChange={(checked) => setChannelCfg((prev) => ({ ...prev, channelPromoEnabled: checked }))}
            />
          </div>
          <div className="flex items-center justify-between gap-4 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-admin-fg">Auto-promo pagi &amp; sore ke DM Bot</p>
              <p className="text-xs text-admin-muted">Kirim katalog ready ke DM pengguna bot. Dapat dimatikan kapan saja jika promo cukup lewat Channel.</p>
            </div>
            <Switch
              aria-label="Auto-promo pagi & sore ke DM Bot"
              checked={channelCfg.dmPromoEnabled}
              disabled={channelSaving}
              onCheckedChange={(checked) => setChannelCfg((prev) => ({ ...prev, dmPromoEnabled: checked }))}
            />
          </div>
        </div>
        {verifyResult && (
          <div
            role="status"
            className={`mt-4 rounded-md border p-3 text-xs leading-5 ${
              verifyResult.ok
                ? "border-admin-success/30 bg-admin-success/10 text-admin-success"
                : "border-admin-warning/30 bg-admin-warning/10 text-admin-warning"
            }`}
          >
            {verifyResult.ok ? (
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                {verifyResult.botUsername || "Bot"} aktif sebagai Administrator di @{verifyResult.channelUsername} dengan izin kirim pesan.
              </p>
            ) : (
              <p>{verifyResult.error || "Bot belum menjadi Administrator channel."}</p>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" disabled={channelSaving} onClick={() => void saveChannelSettings()}>
            {channelSaving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />} Simpan pengaturan channel
          </Button>
          <Button variant="outline" size="sm" disabled={channelVerifying || !health?.bot_configured} onClick={() => void verifyChannelAdmin()}>
            {channelVerifying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />} Cek status admin bot
          </Button>
        </div>
      </Card>
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
