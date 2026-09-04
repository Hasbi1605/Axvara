// BotAutomationManager.tsx — Admin section: Bot & Otomasi
// Health card, webhook setup, product fulfillment config, inventory import.
"use client";
import React, { useState, useEffect, useCallback } from "react";

interface HealthData {
  bot_configured: boolean;
  bot_enabled: boolean;
  klikqris_mode: string;
  klikqris_configured: boolean;
  payment_enabled: boolean;
  fulfillment_enabled: boolean;
  encryption_key_set: boolean;
  webhook?: { url: string; pending_updates: number; last_error: string | null };
  telegram_orders?: { payment_status: string; count: number }[];
  fulfillment_jobs?: { status: string; count: number }[];
}

interface Product {
  id: number;
  name: string;
  fulfillment_mode?: string;
  telegram_enabled?: number;
}

interface InventoryCounts {
  available: number;
  reserved: number;
  delivered: number;
  revoked: number;
}

interface ProductVariant {
  id: number;
  label: string;
  sku: string;
  fulfillment_mode: string;
  is_active: number;
}

export default function BotAutomationManager({ products }: { products: Product[] }) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<number | null>(null);
  const [inventoryCounts, setInventoryCounts] = useState<InventoryCounts | null>(null);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const [sharedSecretText, setSharedSecretText] = useState("");
  const [fulfillmentMode, setFulfillmentMode] = useState("manual");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bot/health");
      if (res.ok) setHealth(await res.json());
    } catch { /* ok */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const handleSetWebhook = async () => {
    setWebhookLoading(true);
    try {
      const res = await fetch("/api/admin/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set" }),
      });
      const data = await res.json();
      alert(data.ok ? `Webhook terpasang: ${data.webhook_url}` : `Gagal: ${data.description || data.error}`);
      fetchHealth();
    } catch { alert("Gagal menghubungi server"); }
    setWebhookLoading(false);
  };

  const loadInventory = async (productId: number, variantId: number | null = null) => {
    setSelectedProduct(productId);
    setSelectedVariant(variantId);
    setImportResult(null);
    try {
      const suffix = variantId ? `&variant_id=${variantId}` : "";
      const res = await fetch(`/api/admin/fulfillment?product_id=${productId}${suffix}`);
      if (!res.ok) throw new Error("Gagal memuat konfigurasi fulfillment");
      const data = await res.json();
      setInventoryCounts(data);
      setFulfillmentMode(String(data.fulfillment_mode || "manual"));
    } catch {
      setInventoryCounts(null);
      setImportResult("Gagal memuat konfigurasi fulfillment");
    }
  };

  const handleProductSelect = async (productId: number) => {
    setSelectedProduct(productId);
    setSelectedVariant(null);
    setVariants([]);
    try {
      const res = await fetch(`/api/admin/variants?product_id=${productId}`);
      if (res.ok) {
        const data = await res.json() as { variants?: ProductVariant[] };
        const activeVariants = (data.variants || []).filter((variant) => variant.is_active === 1);
        setVariants(activeVariants);
        if (activeVariants.length > 0) {
          await loadInventory(productId, activeVariants[0].id);
          return;
        }
      }
    } catch { /* Legacy product-level fallback below. */ }
    await loadInventory(productId, null);
  };

  const handleSetMode = async (mode: string) => {
    if (!selectedProduct) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_mode",
          product_id: selectedProduct,
          variant_id: selectedVariant || undefined,
          fulfillment_mode: mode,
        }),
      });
      if (res.ok) {
        setFulfillmentMode(mode);
        setImportResult(`Mode diubah ke: ${mode}`);
      }
    } catch { setImportResult("Gagal mengubah mode"); }
    setActionLoading(false);
  };

  const handleSetSharedSecret = async () => {
    if (!selectedProduct || !sharedSecretText.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_shared_secret",
          product_id: selectedProduct,
          variant_id: selectedVariant || undefined,
          shared_secret: sharedSecretText,
        }),
      });
      if (res.ok) {
        setImportResult("Shared secret tersimpan (terenkripsi)");
        setSharedSecretText("");
        setFulfillmentMode("shared");
      }
    } catch { setImportResult("Gagal menyimpan shared secret"); }
    setActionLoading(false);
  };

  const handleImport = async () => {
    if (!selectedProduct || !importText.trim()) return;
    setActionLoading(true);
    const secrets = importText.split("\n").filter((s) => s.trim());
    try {
      const res = await fetch("/api/admin/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          product_id: selectedProduct,
          variant_id: selectedVariant || undefined,
          secrets,
        }),
      });
      const data = await res.json();
      setImportResult(`Inserted: ${data.inserted}, Duplicate: ${data.duplicate}, Invalid: ${data.invalid}`);
      setImportText("");
      loadInventory(selectedProduct, selectedVariant);
    } catch { setImportResult("Gagal import"); }
    setActionLoading(false);
  };

  if (loading) return <div className="text-white/50 text-center py-8">Memuat...</div>;

  return (
    <div className="space-y-5">
      {/* Health Card */}
      <div className="ax-glass rounded-[20px] p-5">
        <h3 className="text-white font-semibold text-lg mb-4">🤖 Status Bot &amp; Pembayaran</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <StatusPill label="Bot Token" ok={health?.bot_configured} />
          <StatusPill label="Bot Enabled" ok={health?.bot_enabled} />
          <StatusPill label="KlikQRIS" ok={health?.klikqris_configured} extra={health?.klikqris_mode} />
          <StatusPill label="Payment" ok={health?.payment_enabled} />
          <StatusPill label="Fulfillment" ok={health?.fulfillment_enabled} />
          <StatusPill label="Encryption Key" ok={health?.encryption_key_set} />
        </div>

        {health?.webhook && (
          <div className="mt-3 text-xs text-white/50 space-y-1">
            <p>Webhook: {health.webhook.url || "(tidak terpasang)"}</p>
            <p>Pending updates: {health.webhook.pending_updates}</p>
            {health.webhook.last_error && <p className="text-red-400">Error: {health.webhook.last_error}</p>}
          </div>
        )}

        <button
          onClick={handleSetWebhook}
          disabled={webhookLoading || !health?.bot_configured}
          className="mt-4 px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-xl text-sm hover:bg-cyan-500/30 transition disabled:opacity-40"
        >
          {webhookLoading ? "Memasang..." : "Pasang/Perbarui Webhook"}
        </button>
      </div>

      {/* Telegram Order Stats */}
      {health?.telegram_orders && health.telegram_orders.length > 0 && (
        <div className="ax-glass rounded-[20px] p-5">
          <h3 className="text-white font-semibold mb-3">📊 Pesanan Telegram</h3>
          <div className="flex gap-3 flex-wrap text-sm">
            {health.telegram_orders.map((o) => (
              <span key={o.payment_status} className="px-3 py-1 rounded-full bg-white/5 text-white/70">
                {o.payment_status}: {o.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Product Fulfillment Config */}
      <div className="ax-glass rounded-[20px] p-5">
        <h3 className="text-white font-semibold text-lg mb-4">📦 Konfigurasi Fulfillment</h3>

        <div className="mb-4">
          <select
            value={selectedProduct ?? ""}
            onChange={(e) => e.target.value && handleProductSelect(Number(e.target.value))}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm"
          >
            <option value="">Pilih produk...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {selectedProduct && variants.length > 0 && (
          <div className="mb-4">
            <label className="text-sm text-white/60 block mb-2">Varian yang dikirim:</label>
            <select
              value={selectedVariant ?? ""}
              onChange={(e) => loadInventory(selectedProduct, Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm"
            >
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.label} — {variant.sku} ({variant.fulfillment_mode})
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedProduct && (
          <div className="space-y-4">
            {/* Mode selector */}
            <div>
              <label className="text-sm text-white/60 block mb-2">
                Mode Fulfillment {selectedVariant ? "Varian" : "Produk Legacy"}:
              </label>
              <div className="flex gap-2 flex-wrap">
                {["manual", "shared", "unique"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleSetMode(mode)}
                    disabled={actionLoading}
                    className={`px-3 py-1.5 rounded-xl text-sm transition ${
                      fulfillmentMode === mode
                        ? "bg-cyan-500/30 text-cyan-400 border border-cyan-500/40"
                        : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {mode === "manual" ? "👤 Manual" : mode === "shared" ? "📝 Shared" : "🔑 Unique"}
                  </button>
                ))}
              </div>
            </div>

            {/* Inventory counts */}
            {inventoryCounts && (
              <div className="flex gap-3 flex-wrap text-sm">
                <span className="text-green-400">Available: {inventoryCounts.available}</span>
                <span className="text-yellow-400">Reserved: {inventoryCounts.reserved}</span>
                <span className="text-cyan-400">Delivered: {inventoryCounts.delivered}</span>
                <span className="text-red-400">Revoked: {inventoryCounts.revoked}</span>
              </div>
            )}

            {/* Shared secret input */}
            {fulfillmentMode === "shared" && (
              <div>
                <label className="text-sm text-white/60 block mb-1">Pesan/Link Bersama (terenkripsi):</label>
                <textarea
                  value={sharedSecretText}
                  onChange={(e) => setSharedSecretText(e.target.value)}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm resize-none"
                  placeholder="Masukkan link/instruksi yang dikirim ke semua pembeli..."
                />
                <button
                  onClick={handleSetSharedSecret}
                  disabled={actionLoading || !sharedSecretText.trim()}
                  className="mt-2 px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-xl text-sm hover:bg-cyan-500/30 transition disabled:opacity-40"
                >
                  {actionLoading ? "Menyimpan..." : "Simpan Shared Secret"}
                </button>
              </div>
            )}

            {/* Unique inventory import */}
            {fulfillmentMode === "unique" && (
              <div>
                <label className="text-sm text-white/60 block mb-1">Import Inventory (1 secret per baris, maks 100):</label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={5}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm resize-none font-mono"
                  placeholder={"account1@example.com:password123\naccount2@example.com:password456\n..."}
                />
                <button
                  onClick={handleImport}
                  disabled={actionLoading || !importText.trim()}
                  className="mt-2 px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-xl text-sm hover:bg-cyan-500/30 transition disabled:opacity-40"
                >
                  {actionLoading ? "Mengimport..." : "Import Inventory"}
                </button>
              </div>
            )}

            {importResult && (
              <p className="text-xs text-cyan-300 bg-cyan-500/10 rounded-lg p-2">{importResult}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ label, ok, extra }: { label: string; ok?: boolean; extra?: string }) {
  return (
    <div className={`px-3 py-2 rounded-xl text-xs ${ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
      {ok ? "✅" : "❌"} {label}
      {extra && <span className="ml-1 text-white/40">({extra})</span>}
    </div>
  );
}
