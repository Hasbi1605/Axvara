"use client";
import { useState } from "react";
import { OrderAccessNotice } from "@/components/storefront/OrderAccessNotice";

export function OrderAccessAdmin({ code }: { code: string }) {
  const [access, setAccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmRotate, setConfirmRotate] = useState(false);
  async function reveal(rotate = false) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(code)}/access-code`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rotate }), cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Kode akses belum tersedia.");
      setAccess(body.buyer_access_code);
      setConfirmRotate(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Gagal membaca kode akses."); }
    finally { setLoading(false); }
  }
  return <section className="rounded-xl border border-admin-border p-3">
    <p className="mb-3 text-xs leading-5 text-admin-muted">Untuk membantu pembeli yang kehilangan kode, periksa kepemilikan pesanan sebelum membagikannya.</p>
    {access ? <OrderAccessNotice accessCode={access} /> : <button type="button" disabled={loading} onClick={() => void reveal()} className="min-h-11 rounded-xl border border-admin-border px-4 text-xs font-semibold text-admin-accent disabled:opacity-50">{loading ? "Memuat…" : "Lihat kode akses pembeli"}</button>}
    {access && <div className="mt-2">
      {confirmRotate && <p className="mb-2 text-xs leading-5 text-admin-warning">Kode dan token akses lama akan dicabut. Berikan kode baru hanya ke pembeli yang sudah diverifikasi.</p>}
      <button type="button" disabled={loading} onClick={() => confirmRotate ? void reveal(true) : setConfirmRotate(true)} className="min-h-11 rounded-xl border border-amber-200/25 px-4 text-xs text-admin-warning focus-visible:outline focus-visible:outline-2 disabled:opacity-50">{loading ? "Memuat…" : confirmRotate ? "Konfirmasi ganti kode" : "Ganti kode akses"}</button>
      {confirmRotate && <button type="button" disabled={loading} onClick={() => setConfirmRotate(false)} className="ml-2 min-h-11 px-3 text-xs text-admin-muted">Batal</button>}
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-admin-warning">{error}</p>}
  </section>;
}
