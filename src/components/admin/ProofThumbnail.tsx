"use client";

import { useEffect, useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";

function ProofState({
  title,
  detail,
  tone = "neutral",
}: {
  title: string;
  detail: string;
  tone?: "neutral" | "danger";
}) {
  const danger = tone === "danger";
  return (
    <div
      className={`flex min-h-[84px] w-[136px] shrink-0 flex-col justify-between rounded-xl border px-3 py-2.5 ${
        danger ? "border-red-400/20 bg-red-400/[0.07]" : "border-[#FFB800]/20 bg-[#FFB800]/[0.06]"
      }`}
      title={detail}
    >
      <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${danger ? "bg-red-400/10" : "bg-[#FFB800]/10"}`}>
        <IosIcon name="image" size={13} tint={danger ? "white" : "#FFB800"} />
      </span>
      <span>
        <span className={`block text-[11px] font-semibold leading-tight ${danger ? "text-red-200" : "text-[#FFCF55]"}`}>{title}</span>
        <span className="mt-0.5 block text-[9px] leading-tight text-white/35">{detail}</span>
      </span>
    </div>
  );
}

export function ProofThumbnail({ proof }: { proof?: string | null }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setOpen(false);
  }, [proof]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!proof) return <ProofState title="Belum ada bukti" detail="Tidak diunggah pembeli" />;

  const key = proof.replace(/^\/r2\//, "");
  if (!key.startsWith("bukti/") || key.includes("..")) {
    return <ProofState title="Bukti tidak valid" detail="Alamat file bermasalah" tone="danger" />;
  }
  const source = `/api/admin/bukti/${key}`;
  if (failed) return <ProofState title="File bukti tidak tersedia" detail="Periksa penyimpanan R2" tone="danger" />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative h-[84px] w-[136px] shrink-0 overflow-hidden rounded-xl border border-white/15 bg-black/20 text-left transition hover:border-[#00E5FF]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]/50"
        aria-label="Lihat bukti pembayaran"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source} alt="Bukti pembayaran" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" onError={() => setFailed(true)} />
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/90 to-black/10 px-2 pb-1.5 pt-4 text-[10px] font-semibold text-white">
          <IosIcon name="full-image" size={11} tint="white" /> Lihat bukti
        </span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#050713]/90 p-3 backdrop-blur-md sm:p-6" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Bukti pembayaran">
          <div className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#0F1430] shadow-[0_28px_80px_rgba(0,0,0,0.55)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
              <div>
                <p className="text-sm font-semibold text-white">Bukti pembayaran</p>
                <p className="text-[11px] text-white/40">Periksa nominal, tanggal, dan rekening tujuan.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/15" aria-label="Tutup">
                <IosIcon name="close" size={13} tint="white" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/25 p-3 sm:p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source} alt="Bukti pembayaran ukuran penuh" className="max-h-[72dvh] max-w-full rounded-xl object-contain shadow-2xl" />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-3 sm:px-5">
              <a href={source} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-4 text-xs font-semibold text-white/75 hover:bg-white/10 hover:text-white">
                <IosIcon name="external-link" size={12} tint="white" /> Buka asli
              </a>
              <a href={source} download className="inline-flex h-9 items-center rounded-full bg-[#00E5FF] px-4 text-xs font-bold text-[#070a1e] hover:bg-[#00D0E8]">Unduh bukti</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
