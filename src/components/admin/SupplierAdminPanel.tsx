"use client";

import { RefreshCw } from "lucide-react";
import { AsyncConfirmDialog, ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Loading";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, PageHeader } from "./ui";
import { SupplierTabs, type SupplierTabId } from "./SupplierTabs";
import { BulkMarkupDialog } from "./BulkMarkupDialog";
import type { Supplier } from "./supplier-admin-data";
import { AlatTab } from "./supplier/AlatTab";
import { AntreanTab } from "./supplier/AntreanTab";
import { MarkupTab } from "./supplier/MarkupTab";
import { RingkasTab } from "./supplier/RingkasTab";
import { SupplierPanelContext, useSupplierPanel } from "./supplier/panel-context";

const PANEL_TABS: { id: SupplierTabId; label: string }[] = [
  { id: "ringkas", label: "Ringkas" },
  { id: "antrean", label: "Antrean" },
  { id: "markup", label: "Markup" },
  { id: "alat", label: "Alat" },
];

export function SupplierAdminPanel({ supplier }: { supplier: Supplier }) {
  const panel = useSupplierPanel(supplier);
  const {
    name, locked, isWrSk, saldoLoading, refreshActive, tab, openTab, loading, busy, loadErrors,
    balance, actionError, success, receipt, setReceipt, receiptTrigger, bulk, bulkError, setBulk,
    mutateStandard, exclusionToDelete, setExclusionToDelete, deleteExclusion, bulkConfirm, setBulkConfirm,
  } = panel;

  return <SupplierPanelContext.Provider value={panel}>
    <div className="min-w-0 space-y-4 [&_[role=tab]]:min-h-11 md:[&_[role=tab]]:min-h-9">
      <PageHeader
        title={name}
        className="min-h-0 flex-row items-center justify-between md:min-h-0"
        actions={<Button variant="outline" className="min-h-11 md:min-h-0" disabled={locked || (isWrSk && saldoLoading)} onClick={refreshActive}>
          {isWrSk && saldoLoading ? <Spinner size={13} /> : <RefreshCw />} Muat ulang
        </Button>}
      />
      <SupplierTabs tabs={PANEL_TABS} active={tab} onChange={openTab}>
        <div aria-live="polite" className="space-y-1 text-sm empty:hidden [&:not(:empty)]:my-3">
          {!isWrSk && loading && <p role="status" className="text-admin-muted">Memuat data {name}…</p>}
          {busy && (isWrSk || !loading) && <p role="status" className="text-admin-muted">Memproses…</p>}
          {loadErrors.map(error => <p role="alert" key={error} className="break-words text-admin-danger">{error}</p>)}
          {isWrSk && balance?.stale && <p role="alert" className="break-words text-admin-warning">Saldo live gagal — menampilkan terakhir tercatat.</p>}
          {actionError && <p role="alert" className="break-words text-admin-danger">{actionError}</p>}
          {success && <p role="status" className="text-admin-success">{success}</p>}
        </div>

        <RingkasTab />
        <AntreanTab />
        <MarkupTab />
        <AlatTab />
      </SupplierTabs>

      <Dialog open={receipt !== null} onOpenChange={open => { if (!open) setReceipt(null); }}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={event => { event.preventDefault(); receiptTrigger.current?.focus(); receiptTrigger.current = null; }}>
          <DialogHeader><DialogTitle>Receipt {name}</DialogTitle><DialogDescription>Data privat untuk pemeriksaan admin.</DialogDescription></DialogHeader>
          <pre className="min-w-0 whitespace-pre-wrap break-all rounded-lg border border-admin-border bg-admin-subtle p-3 text-xs text-admin-muted">{receipt}</pre>
        </DialogContent>
      </Dialog>

      {bulk && <BulkMarkupDialog item={bulk.item} trigger={bulk.trigger} busy={locked} failure={bulkError} onClose={() => setBulk(null)}
        onSave={tiers => mutateStandard("Markup", `products/${encodeURIComponent(String(bulk.item.id))}`, { bulk_markup_tiers: tiers }, `Harga grosir ${bulk.item.label} disimpan.`, { patch: true, bulk: true })} />}

      {exclusionToDelete && <AsyncConfirmDialog title={`Hapus aturan ${name}?`} description={`Exclusion “${exclusionToDelete.pattern}” tidak lagi berlaku saat sinkronisasi.`}
        onClose={() => setExclusionToDelete(null)} onConfirm={() => deleteExclusion(exclusionToDelete.id)} />}

      <ConfirmDialog
        open={bulkConfirm !== null}
        title="Terapkan bulk markup?"
        description={bulkConfirm?.message ?? ""}
        variant="default"
        confirmLabel="Terapkan markup"
        cancelLabel="Batal"
        onClose={() => { bulkConfirm?.resolve(false); setBulkConfirm(null); }}
        onConfirm={() => { bulkConfirm?.resolve(true); setBulkConfirm(null); }}
      />
    </div>
  </SupplierPanelContext.Provider>;
}
