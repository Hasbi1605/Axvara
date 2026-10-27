"use client";

import { useState } from "react";

export function OrderAccessNotice({ accessCode }: { accessCode: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(accessCode); setCopied(true); setCopyError(false); }
    catch { setCopied(false); setCopyError(true); }
  }
  if (!accessCode) return null;
  return <section aria-label="Kode akses pesanan" className="mb-4 rounded-2xl border border-[#00E5FF]/25 bg-[#0B1529] p-4 text-left">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-white">Kode akses pesanan</h2>
      <button type="button" onClick={() => void copy()} className="min-h-11 rounded-xl border border-white/15 px-4 text-xs font-semibold text-[#00E5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]">{copied ? "Tersalin" : "Salin kode akses"}</button>
    </div>
    <p className="mt-2 break-all font-mono text-base font-semibold tracking-wide text-white select-all">{accessCode}</p>
    <p className="mt-2 text-xs leading-5 text-white/65">Simpan kode ini untuk melacak dan membuka pesanan di perangkat lain. Bagikan hanya kepada orang yang berhak mengakses pesananmu.</p>
    {copyError && <p role="alert" className="mt-2 text-xs text-amber-200">Browser tidak mengizinkan salin otomatis. Pilih teks kode di atas lalu salin manual.</p>}
  </section>;
}
