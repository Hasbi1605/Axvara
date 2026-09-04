"use client";

import { useCallback, useEffect, useState } from "react";
import { ProofThumbnail } from "@/components/admin/ProofThumbnail";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/ui/IosIcon";
import { formatRupiah } from "@/lib/utils";

type PaymentProof = {
  id: number;
  order_code: string;
  member_id: string;
  claimed_method: "QRIS" | "SEABANK" | "EWALLET";
  r2_key: string;
  status: "submitted" | "approved" | "rejected";
  rejection_reason?: string | null;
  created_at: string;
  customer_name?: string | null;
  subtotal?: number | null;
  payable_amount?: number | null;
  order_status?: string | null;
  payment_status?: string | null;
  provider_status?: string | null;
};

export default function PaymentProofsManager() {
  const [proofs, setProofs] = useState<PaymentProof[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/proofs", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { proofs?: PaymentProof[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Gagal memuat bukti pembayaran");
      setProofs(data.proofs || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memuat bukti pembayaran");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const review = async (proof: PaymentProof, action: "approve" | "reject") => {
    let reason: string | undefined;
    if (action === "reject") {
      const entered = window.prompt("Alasan penolakan bukti:", "Nominal/rekening/tanggal belum dapat diverifikasi");
      if (entered == null) return;
      reason = entered.trim();
      if (!reason) {
        setError("Alasan penolakan wajib diisi.");
        return;
      }
    }

    setReviewing(proof.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/proofs/${proof.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Review bukti gagal");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review bukti gagal");
    } finally {
      setReviewing(null);
    }
  };

  return (
    <section className="mt-5 ax-glass rounded-[20px] overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4 sm:p-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-white/5">
          <IosIcon name="image" size={16} tint="white" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">Review Bukti Pembayaran WhatsApp</h2>
          <p className="text-[11px] text-white/40">Cocokkan nominal, waktu, dan rekening dengan mutasi sebelum menyetujui.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="ml-auto h-8 rounded-full border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white/70 disabled:opacity-50">
          Muat ulang
        </button>
      </div>

      {error && <p className="m-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
      {loading ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-white/50"><Spinner size={18} /> Memuat bukti…</div>
      ) : proofs.length === 0 ? (
        <p className="p-10 text-center text-sm text-white/40">Belum ada bukti WhatsApp.</p>
      ) : (
        <div className="divide-y divide-white/5">
          {proofs.map((proof) => (
            <article key={proof.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
              <ProofThumbnail proof={`/r2/${proof.r2_key}`} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-bold text-[#00E5FF]">{proof.order_code}</p>
                <p className="mt-1 text-sm font-semibold text-white">{proof.customer_name || proof.member_id}</p>
                <p className="mt-1 text-xs text-white/50">
                  {proof.claimed_method} · {formatRupiah(Number(proof.subtotal || 0))} · order {proof.order_status || "-"} / bayar {proof.payment_status || "-"}
                </p>
                {Number(proof.payable_amount || 0) !== Number(proof.subtotal || 0) && (
                  <p className="mt-1 text-xs font-semibold text-[#FFB800]">
                    Nominal transfer: {formatRupiah(Number(proof.payable_amount || 0))}
                  </p>
                )}
                {proof.claimed_method === "QRIS" && (
                  <p className="mt-1 text-[11px] text-white/40">
                    {proof.provider_status
                      ? `QRIS dinamis · provider ${proof.provider_status}`
                      : "QRIS statis · wajib cocokkan mutasi merchant"}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-white/35">Dikirim {new Date(proof.created_at).toLocaleString("id-ID")}</p>
                {proof.rejection_reason && <p className="mt-2 text-xs text-red-300">Alasan: {proof.rejection_reason}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {proof.status === "submitted" ? (
                  <>
                    <button type="button" disabled={reviewing === proof.id} onClick={() => void review(proof, "approve")} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#22C55E] px-3.5 text-xs font-bold text-white disabled:opacity-50">
                      <IosIcon name="checked" size={13} tint="white" />
                      {proof.claimed_method === "QRIS" && proof.provider_status
                        ? "Setujui Bukti"
                        : "Mutasi Cocok & Lunas"}
                    </button>
                    <button type="button" disabled={reviewing === proof.id} onClick={() => void review(proof, "reject")} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-red-400/20 bg-red-500/10 px-3.5 text-xs font-semibold text-red-200 disabled:opacity-50">
                      <IosIcon name="close" size={12} tint="white" /> Tolak
                    </button>
                  </>
                ) : (
                  <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${proof.status === "approved" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : "border-red-400/20 bg-red-500/10 text-red-300"}`}>
                    {proof.status === "approved" ? "Disetujui" : "Ditolak"}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
