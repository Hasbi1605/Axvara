"use client";
import { Button } from "@/components/admin/ui";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { IosIcon } from "@/components/admin/AdminIcon";

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
        danger ? "border-admin-danger/20 bg-admin-danger/[0.07]" : "border-admin-warning/20 bg-admin-warning/[0.06]"
      }`}
      title={detail}
    >
      <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${danger ? "bg-admin-danger/10" : "bg-admin-warning/10"}`}>
        <IosIcon name="image" size={13} tint="currentColor" />
      </span>
      <span>
        <span className={`block text-xs font-semibold leading-tight ${danger ? "text-admin-danger" : "text-admin-warning"}`}>{title}</span>
        <span className="mt-0.5 block text-xs leading-tight text-admin-muted">{detail}</span>
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



  if (!proof) return <ProofState title="Belum ada bukti" detail="Tidak diunggah pembeli" />;

  const key = proof.replace(/^\/r2\//, "");
  if (!key.startsWith("bukti/") || key.includes("..")) {
    return <ProofState title="Bukti tidak valid" detail="Alamat file bermasalah" tone="danger" />;
  }
  const source = `/api/admin/bukti/${key}`;
  if (failed) return <ProofState title="File bukti tidak tersedia" detail="Periksa penyimpanan R2" tone="danger" />;

  return (
    <>
      <Button variant="outline"
        type="button"
        onClick={() => setOpen(true)}
        className="group relative h-[84px] w-[136px] shrink-0 overflow-hidden rounded-xl border border-admin-border bg-admin-subtle/20 text-left transition hover:border-admin-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/50"
        aria-label="Lihat bukti pembayaran"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source} alt="Bukti pembayaran" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" onError={() => setFailed(true)} />
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-admin-subtle/90 to-admin-subtle/10 px-2 pb-1.5 pt-4 text-xs font-semibold text-admin-fg">
          <IosIcon name="full-image" size={11} tint="currentColor" /> Lihat bukti
        </span>
      </Button>
      {open && (
        <Dialog title="Bukti pembayaran" onClose={() => setOpen(false)} className="w-[1024px] !p-0">
            <div className="flex items-center justify-between gap-3 border-b border-admin-border px-4 py-3 sm:px-5">
              <div>
                <p className="text-sm font-semibold text-admin-fg">Bukti pembayaran</p>
                <p className="text-xs text-admin-muted">Periksa nominal, tanggal, dan rekening tujuan.</p>
              </div>
              <Button variant="outline" size="icon" type="button" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md bg-admin-subtle transition hover:bg-admin-subtle" aria-label="Tutup">
                <IosIcon name="close" size={13} tint="currentColor" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-admin-subtle/25 p-3 sm:p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source} alt="Bukti pembayaran ukuran penuh" className="max-h-[72dvh] max-w-full rounded-xl object-contain shadow-2xl" />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-admin-border px-4 py-3 sm:px-5">
              <a href={source} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-admin-border bg-admin-subtle px-4 text-xs font-semibold text-admin-muted transition hover:bg-admin-subtle hover:text-admin-fg">
                <IosIcon name="globe" size={12} tint="currentColor" /> Buka asli
              </a>
              <a href={source} download className="inline-flex h-9 items-center gap-1.5 rounded-md bg-admin-primary px-4 text-xs font-semibold text-admin-inverse transition hover:bg-admin-primary"><IosIcon name="download" size={13} tint="currentColor" /> Unduh bukti</a>
            </div>
        </Dialog>
      )}
    </>
  );
}
