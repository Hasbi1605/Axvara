"use client";
import { useState } from "react";
import type { SelectedReport } from "@/lib/dashboard-report";

export function ReportExportActions({ report, disabled }: { report: SelectedReport; disabled: boolean }) {
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null), [error, setError] = useState<string | null>(null);
  const download = async (format: "pdf" | "xlsx") => {
    if (disabled || busy) return;
    setBusy(format); setError(null);
    try {
      const { createReportPdf, createReportXlsx, reportFilename } = await import("@/lib/reports/export");
      const blob = format === "pdf" ? new Blob([new Uint8Array(await createReportPdf(report))], { type: "application/pdf" }) : await createReportXlsx(report);
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = reportFilename(report, format); document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { setError("Laporan gagal dibuat. Coba unduh lagi."); }
    finally { setBusy(null); }
  };
  return <div className="flex flex-wrap items-center gap-2">
    {([['pdf', 'PDF'], ['xlsx', 'Excel (.xlsx)']] as const).map(([format, label]) => <button key={format} type="button" disabled={disabled || busy !== null} onClick={() => void download(format)} className="min-h-10 rounded-xl border border-admin-border bg-admin-subtle px-3 text-xs font-semibold text-admin-fg transition hover:bg-admin-subtle disabled:opacity-40">{busy === format ? "Menyiapkan…" : `Unduh ${label}`}</button>)}
    {error && <p role="alert" className="w-full text-xs text-admin-danger">{error}</p>}
  </div>;
}
