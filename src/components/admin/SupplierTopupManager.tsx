"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SupplierTopupItem, SupplierTopupSupplier } from "@/lib/supplier/topup";
import { Badge, Button, Card, PageHeader, Skeleton } from "./ui";
import { BALANCE_CARDS, dateTime, money, readBalance, STATUS, SUPPLIER_NAMES, TOPUP_INACTIVE, TOPUPS, topupRequest } from "./supplier-topup/model";
import { TopupDialog } from "./supplier-topup/TopupDialog";

type CardId = (typeof BALANCE_CARDS)[number]["id"];
type Balance = { value: number | null; stale: boolean; state: "loading" | "ready" | "error" };
type Gates = Record<SupplierTopupSupplier, boolean>;
const HISTORY_LIMIT = 20;
const NEW_BALANCE: Balance = { value: null, stale: false, state: "loading" };
const HISTORY_ROW = "grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center";

export function SupplierTopupManager() {
  const [balances, setBalances] = useState<Partial<Record<CardId, Balance>>>({});
  const [items, setItems] = useState<SupplierTopupItem[]>([]);
  const [gates, setGates] = useState<Gates | null>(null);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading");
  const [dialog, setDialog] = useState<{ supplier: SupplierTopupSupplier; initialItem?: SupplierTopupItem } | null>(null);
  const balanceRequests = useRef(new Map<CardId, AbortController>());
  const historyRequest = useRef<AbortController | null>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  const loadBalance = useCallback(async (card: (typeof BALANCE_CARDS)[number]) => {
    const { id } = card;
    balanceRequests.current.get(id)?.abort();
    const request = new AbortController();
    balanceRequests.current.set(id, request);
    setBalances(prev => ({ ...prev, [id]: { ...(prev[id] ?? NEW_BALANCE), state: "loading" } }));
    try {
      const result = await readBalance(card, request.signal);
      if (!request.signal.aborted) setBalances(prev => ({ ...prev, [id]: { ...result, state: "ready" } }));
    } catch {
      if (!request.signal.aborted) setBalances(prev => ({ ...prev, [id]: { ...(prev[id] ?? NEW_BALANCE), stale: true, state: "error" } }));
    } finally {
      if (balanceRequests.current.get(id) === request) balanceRequests.current.delete(id);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    historyRequest.current?.abort();
    const request = new AbortController();
    historyRequest.current = request;
    setHistoryState("loading");
    try {
      const data = await topupRequest<{ items: SupplierTopupItem[]; gates: Gates }>(TOPUPS, { signal: request.signal });
      if (!Array.isArray(data.items) || !data.gates) throw new Error("load_failed");
      if (request.signal.aborted) return;
      setItems(data.items.slice(0, HISTORY_LIMIT));
      setGates(data.gates);
      setHistoryState("ready");
    } catch {
      if (request.signal.aborted) return;
      setGates(null);
      setHistoryState("error");
    } finally {
      if (historyRequest.current === request) historyRequest.current = null;
    }
  }, []);

  const loadAll = useCallback(() => {
    BALANCE_CARDS.forEach(card => void loadBalance(card));
    void loadHistory();
  }, [loadBalance, loadHistory]);

  useEffect(() => {
    const balanceControllers = balanceRequests.current;
    loadAll();
    return () => {
      balanceControllers.forEach(request => request.abort());
      historyRequest.current?.abort();
    };
  }, [loadAll]);

  const saveItem = useCallback((item: SupplierTopupItem) => {
    // An older history snapshot must not overwrite a just-created or just-paid item.
    if (historyRequest.current) void loadHistory();
    setItems(prev => [item, ...prev.filter(row => row.id !== item.id)]
      .sort((a, b) => b.created_at - a.created_at || b.id - a.id).slice(0, HISTORY_LIMIT));
    if (item.status === "paid") {
      const card = BALANCE_CARDS.find(card => card.id === item.supplier);
      if (card) void loadBalance(card);
    }
  }, [loadBalance, loadHistory]);

  const disableTopup = useCallback((supplier: SupplierTopupSupplier) => {
    setGates(prev => ({ sekalipay: false, tunvn: false, ...prev, [supplier]: false }));
  }, []);

  function openDialog(button: HTMLButtonElement, supplier: SupplierTopupSupplier, initialItem?: SupplierTopupItem) {
    opener.current = button;
    setDialog({ supplier, initialItem });
  }

  return <div className="space-y-6">
    <PageHeader title="Saldo & Topup" description="Pantau saldo supplier dan buat tagihan topup Sekalipay atau TUNVN. Pembayaran tetap kamu lakukan sendiri."
      actions={<Button variant="outline" className="h-11" onClick={loadAll}><RefreshCw aria-hidden="true" />Muat ulang semua</Button>} />

    <section aria-label="Saldo supplier" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {BALANCE_CARDS.map(card => {
        const balance = balances[card.id] ?? NEW_BALANCE;
        const supplier = card.id === "sekalipay" || card.id === "tunvn" ? card.id : null;
        const enabled = supplier !== null && gates?.[supplier] === true;
        const retry = balance.stale && balance.state !== "loading";
        return <Card key={card.id} role="group" aria-label={card.name} className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium text-admin-muted">{card.name}</h3>
            <span className="text-xs text-admin-muted">{card.currency}</span>
          </div>
          <div className="space-y-1" aria-busy={balance.state === "loading"}>
            {balance.state === "loading" && balance.value === null
              ? <Skeleton className="h-8 w-28 max-w-full" role="status" aria-label="Memuat saldo" />
              : <p className="break-words text-2xl font-semibold tabular-nums">{money(balance.value, card.currency)}</p>}
            {retry && <div className="flex flex-wrap items-center justify-between gap-x-2">
              <p className={`text-xs ${balance.state === "error" ? "text-admin-danger" : "text-admin-muted"}`}>
                {balance.state === "error" ? balance.value === null ? "Gagal memuat" : "Gagal memuat · saldo terakhir" : "Saldo terakhir (tidak terbaru)"}
              </p>
              <Button variant="ghost" size="sm" className="h-11 px-2" onClick={() => void loadBalance(card)}>Coba lagi</Button>
            </div>}
          </div>
          <div className="mt-auto border-t border-admin-border pt-3">
            {supplier ? <div className="space-y-2">
              <Button className="h-11" size="sm" disabled={!enabled} aria-label={`Topup ${card.name}`} onClick={e => openDialog(e.currentTarget, supplier)}>Topup</Button>
              {!enabled && <p className="text-xs text-admin-muted">{gates ? TOPUP_INACTIVE : historyState === "error" ? "Status topup belum bisa diperiksa" : "Memeriksa ketersediaan topup…"}</p>}
            </div> : <p className="py-2 text-xs text-admin-muted">Topup manual di dashboard supplier</p>}
          </div>
        </Card>;
      })}
    </section>

    <Card className="overflow-hidden">
      <div className="space-y-1 p-4">
        <h3 ref={historyHeading} tabIndex={-1} className="font-semibold">Riwayat topup</h3>
        <p className="text-sm text-admin-muted">Hingga 20 tagihan terbaru. Waktu dalam WIB.</p>
      </div>
      {historyState === "error" && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-admin-border p-4">
        <p className="text-sm text-admin-danger" role="alert">Gagal memuat riwayat topup</p>
        <Button variant="outline" size="sm" className="h-11" onClick={() => void loadHistory()}>Coba lagi</Button>
      </div>}
      {!items.length && historyState === "loading" && <div className="border-t border-admin-border p-4" role="status" aria-label="Memuat riwayat topup"><Skeleton className="h-12" /></div>}
      {!items.length && historyState === "ready" && <p className="border-t border-admin-border p-4 text-sm text-admin-muted">Belum ada topup.</p>}
      {items.length > 0 && <>
        <div aria-hidden="true" className={`${HISTORY_ROW} hidden border-y border-admin-border bg-admin-subtle/50 text-xs font-medium text-admin-muted sm:grid`}>
          <span>Supplier</span><span>Dibuat (WIB)</span><span>Total bayar</span><span>Status</span><span className="min-w-[6.5rem]">Aksi</span>
        </div>
        <ul aria-label="Tagihan terbaru" className="divide-y divide-admin-border">
          {items.map(item => {
            const [status, variant] = STATUS[item.status];
            const supplier = SUPPLIER_NAMES[item.supplier];
            const canReopen = item.status !== "paid" && item.status !== "failed";
            const canCheckFailed = item.status === "failed" && !!item.supplier_ref;
            const action = canCheckFailed ? "Cek status topup" : "Lihat topup";
            return <li key={item.id} className={HISTORY_ROW}>
              <span className="font-medium">{supplier}</span>
              <time className="text-sm text-admin-muted" dateTime={new Date(item.created_at).toISOString()}>{dateTime.format(item.created_at)}</time>
              <span className="text-sm tabular-nums"><span className="sr-only">Total bayar: </span>{item.currency === "USDT" && item.pay_amount !== null ? `${item.pay_amount} USDT` : money(item.pay_amount, item.currency)}</span>
              <span><Badge variant={variant}>{status}</Badge></span>
              <span className="sm:min-w-[6.5rem]">{(canReopen || canCheckFailed) && <Button variant="outline" size="sm" className="h-11" aria-label={`${action} ${supplier} ${item.ref_id}`} onClick={e => openDialog(e.currentTarget, item.supplier, item)}>{canCheckFailed ? "Cek status" : action}</Button>}</span>
            </li>;
          })}
        </ul>
      </>}
    </Card>

    {dialog && <TopupDialog supplier={dialog.supplier} initialItem={dialog.initialItem} enabled={gates?.[dialog.supplier] === true}
      onClose={() => setDialog(null)} onRestoreFocus={() => {
        const target = opener.current;
        (target?.isConnected && !target.disabled ? target : historyHeading.current)?.focus();
      }} onItem={saveItem} onReloadHistory={loadHistory} onUnavailable={disableTopup} />}
  </div>;
}
