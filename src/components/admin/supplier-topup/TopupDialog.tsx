"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, Copy, ExternalLink, X } from "lucide-react";
import type { SkTopupChannel } from "@/lib/sekalipay/topup";
import type { CreateSupplierTopupInput, SupplierTopupItem, SupplierTopupSupplier } from "@/lib/supplier/topup";
import { Badge, Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, NativeSelect, Skeleton } from "../ui";
import { actionError, httpsUrl, money, STATUS, SUPPLIER_NAMES, TOPUP_INACTIVE, TOPUPS, topupRequest } from "./model";

const CHECK_INTERVAL = 15_000;
const getCode = (error: unknown) => error instanceof Error && /^[a-z0-9_]{1,100}$/i.test(error.message) ? error.message : "request_failed";

function useTimeLeft(expiresAt: number | null | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (expiresAt == null) return;
    setNow(Date.now());
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) window.clearInterval(interval);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [expiresAt]);
  return expiresAt == null ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState("");
  return <div>
    <Button variant="outline" size="sm" className="h-11" aria-label={`Salin ${label}`} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setFeedback("Disalin"); }
      catch { setFeedback("Gagal menyalin. Salin teks secara manual."); }
    }}><Copy aria-hidden="true" />Salin</Button>
    <span role="status" className="ml-2 text-xs text-admin-muted">{feedback}</span>
  </div>;
}

function SekalipayPayment({ item, onRefresh, checking }: { item: SupplierTopupItem; onRefresh: () => void; checking: boolean }) {
  const payLink = httpsUrl(item.payment?.payment_link) ?? httpsUrl(item.payment?.payment_url);
  const qr = httpsUrl(item.payment?.qr_link);
  const [brokenQr, setBrokenQr] = useState<string | null>(null);
  return <>
    <dl className="space-y-3 rounded-lg border border-admin-border bg-admin-subtle/40 p-4">
      <div>
        <dt className="text-sm text-admin-muted">Total yang harus dibayar</dt>
        <dd className="break-words text-3xl font-semibold tabular-nums">{money(item.pay_amount, "IDR")}</dd>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-admin-border pt-3">
        <div><dt className="text-xs text-admin-muted">Saldo yang masuk</dt><dd className="break-words font-medium tabular-nums">{money(item.credit_amount, "IDR")}</dd></div>
        <div><dt className="text-xs text-admin-muted">Biaya</dt><dd className="break-words font-medium tabular-nums">{money(item.fee_amount, "IDR")}</dd></div>
      </div>
    </dl>
    {qr && (brokenQr !== qr ? (
      // eslint-disable-next-line @next/next/no-img-element -- QR URL is issued per invoice and not a Next image asset.
      <img src={qr} width={164} height={164} alt="QR pembayaran Sekalipay" referrerPolicy="no-referrer" className="mx-auto size-[164px] max-w-full rounded-md bg-white object-contain p-2" onError={() => setBrokenQr(qr)} /* admin-ui-allow: white QR quiet zone in both themes */ />
    ) : <Button asChild variant="outline" className="h-11"><a href={qr} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Buka QR pembayaran</a></Button>)}
    {payLink ? <Button asChild className="h-11"><a href={payLink} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Buka halaman bayar</a></Button>
      : <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-admin-muted">Link pembayaran sedang disiapkan</p>
        <Button variant="outline" size="sm" className="h-11" onClick={onRefresh} disabled={checking}>Cek lagi</Button>
      </div>}
  </>;
}

function UsdtBep20Payment({ item }: { item: SupplierTopupItem }) {
  const exact = item.payment?.exact_amount;
  const address = item.payment?.address;
  const confirming = item.payment?.upstream_status === "CONFIRMING";
  if (typeof exact !== "number" || !Number.isFinite(exact) || typeof address !== "string" || !/^0x[0-9a-f]{40}$/i.test(address) || item.payment?.network !== "BEP20") {
    return <p className="text-sm text-admin-muted">Instruksi transfer belum tersedia. Cek status sebelum mengirim.</p>;
  }
  return <>
    <div className="space-y-2 rounded-lg border border-admin-border bg-admin-subtle/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-admin-muted">Nominal yang harus dikirim</p><Badge variant="outline">BEP20</Badge>
      </div>
      <p className="break-words text-3xl font-semibold tabular-nums">{exact} USDT</p>
      <CopyValue key={exact} label="nominal" value={String(exact)} />
    </div>
    {confirming && <p role="status" className="rounded-md border border-admin-border bg-admin-subtle p-3 text-sm text-admin-muted">Pembayaran terdeteksi, menunggu konfirmasi jaringan BEP20…</p>}
    <p className="rounded-md border border-admin-warning/25 bg-admin-warning/10 p-3 text-sm font-medium text-admin-warning">Kirim PERSIS nominal ini, jaringan BEP20 (BSC) saja.</p>
    <div className="min-w-0 space-y-2">
      <p className="text-sm font-medium">Alamat tujuan</p>
      <code className="block break-all rounded-md border border-admin-border p-3 text-sm">{address}</code>
      <CopyValue key={address} label="alamat" value={address} />
    </div>
  </>;
}

type Props = {
  supplier: SupplierTopupSupplier;
  enabled: boolean;
  initialItem?: SupplierTopupItem;
  onItem: (item: SupplierTopupItem) => void;
  onClose: () => void;
  onRestoreFocus: () => void;
  onReloadHistory: () => Promise<void>;
  onUnavailable: (supplier: SupplierTopupSupplier) => void;
};

export function TopupDialog({ supplier, enabled, initialItem, onItem, onClose, onRestoreFocus, onReloadHistory, onUnavailable }: Props) {
  const isSk = supplier === "sekalipay";
  const [item, setItem] = useState(initialItem);
  const [channels, setChannels] = useState<SkTopupChannel[] | null>(null);
  const [channelError, setChannelError] = useState("");
  const [channelAttempt, setChannelAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const createLock = useRef(false);
  const refreshRequest = useRef<AbortController | null>(null);
  const viewHeading = useRef<HTMLHeadingElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const chosenChannel = channels?.find(channel => channel.service === code && channel.status === "on");
  const left = useTimeLeft(item?.status === "pending" ? item.expires_at : null);
  const invoiceId = item?.id;
  const status = item?.status;
  const expired = status === "expired" || (status === "pending" && left === 0);
  const checkable = status != null && status !== "paid" && (status !== "failed" || !!item?.supplier_ref);

  useEffect(() => {
    if (!isSk || item || !enabled) return;
    const request = new AbortController();
    setChannels(null);
    setChannelError("");
    topupRequest<{ channels: SkTopupChannel[] }>(`${TOPUPS}/sekalipay/channels`, { signal: request.signal }).then(data => {
      if (request.signal.aborted) return;
      if (!Array.isArray(data.channels)) throw new Error("load_failed");
      setChannels(data.channels);
      setCode(data.channels.find(channel => channel.status === "on")?.service ?? "");
    }).catch(error => {
      if (request.signal.aborted) return;
      const code = getCode(error);
      if (code === "sekalipay_unavailable") onUnavailable(supplier);
      setChannelError(code === "sekalipay_unavailable" ? TOPUP_INACTIVE : "Gagal memuat metode pembayaran");
    });
    return () => request.abort();
  }, [isSk, item, enabled, channelAttempt, onUnavailable, supplier]);

  useEffect(() => () => refreshRequest.current?.abort(), []);

  useEffect(() => {
    if (invoiceId != null) viewHeading.current?.focus();
  }, [invoiceId, status]);

  const refresh = useCallback(async (manual: boolean) => {
    if (invoiceId == null || !checkable || refreshRequest.current || (!manual && document.hidden)) return;
    const request = new AbortController();
    refreshRequest.current = request;
    setChecking(true);
    if (manual) setError("");
    try {
      const { item } = await topupRequest<{ item: SupplierTopupItem }>(`${TOPUPS}/${invoiceId}/refresh`, { method: "POST", signal: request.signal });
      if (request.signal.aborted) return;
      setItem(item);
      setError("");
      onItem(item);
    } catch (error) {
      if (request.signal.aborted) return;
      const code = getCode(error);
      if (code === "sekalipay_unavailable" || code === "tunvn_unavailable" || code === "storebat_unavailable") onUnavailable(supplier);
      if (manual) setError(actionError(code, "refresh"));
    } finally {
      if (refreshRequest.current === request) refreshRequest.current = null;
      if (!request.signal.aborted) setChecking(false);
    }
  }, [checkable, invoiceId, onItem, onUnavailable, supplier]);

  useEffect(() => {
    if (status !== "pending") return;
    let interval: number | undefined;
    const updateTimer = () => {
      window.clearInterval(interval);
      if (!document.hidden) interval = window.setInterval(() => void refresh(false), CHECK_INTERVAL);
    };
    updateTimer();
    document.addEventListener("visibilitychange", updateTimer);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", updateTimer);
    };
  }, [status, refresh]);

  const bounds = chosenChannel ? `${money(chosenChannel.minimum, "IDR")} – ${money(chosenChannel.maximum, "IDR")}` : "1–1000 USDT, maksimal 2 angka desimal";
  const amountText = amount.trim().replace(",", ".");
  const numericAmount = Number(amountText);
  const validSk = chosenChannel && /^\d+$/.test(amountText) && Number.isSafeInteger(numericAmount)
    && numericAmount >= Math.max(1, chosenChannel.minimum) && numericAmount <= chosenChannel.maximum;
  const validTunvn = /^\d+(?:\.\d{1,2})?$/.test(amountText) && numericAmount >= 1 && numericAmount <= 1000;
  const amountError = `Masukkan nominal ${isSk ? "rupiah bulat dalam rentang" : "sesuai batas"} ${bounds}.`;
  const fee = validSk ? chosenChannel.fee_flat + numericAmount * Number(chosenChannel.fee_percentage ?? 0) / 100 : null;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || createLock.current || (isSk && !chosenChannel)) return;
    setError("");
    setFieldError("");
    if (!(isSk ? validSk : validTunvn)) { setFieldError(amountError); amountInput.current?.focus(); return; }
    const payload: CreateSupplierTopupInput = isSk ? { supplier, code, amount: numericAmount } : { supplier, amount: numericAmount };
    createLock.current = true;
    setCreating(true);
    try {
      const { item } = await topupRequest<{ item: SupplierTopupItem }>(TOPUPS, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      setItem(item);
      onItem(item);
    } catch (error) {
      const code = getCode(error);
      if (["invalid_request", "amount_out_of_range", "amount_minimum", "amount_maximum"].includes(code)) {
        setFieldError(amountError);
      } else {
        setError(actionError(code, "create"));
        // A failed response can still leave an invoice to reconcile in history.
        if (code === "sekalipay_unavailable" || code === "tunvn_unavailable" || code === "storebat_unavailable") onUnavailable(supplier);
        else void onReloadHistory();
      }
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !createLock.current) onClose(); }}>
    <DialogContent showClose={false} className="min-w-0 p-4 sm:p-6" onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogClose asChild><Button variant="ghost" size="icon" className="absolute right-2 top-2 size-11" aria-label="Tutup dialog" disabled={creating}><X aria-hidden="true" /></Button></DialogClose>
      <DialogHeader className="pr-10">
        <DialogTitle ref={viewHeading} tabIndex={-1}>Topup {SUPPLIER_NAMES[supplier]}</DialogTitle>
        <DialogDescription>{item ? `Tagihan ${item.ref_id}` : "Buat tagihan di sini, lalu bayar sendiri. AXVARA tidak mengirim dana."}</DialogDescription>
      </DialogHeader>
      {!item ? <form noValidate className="grid min-w-0 gap-4" aria-busy={creating} onSubmit={create}>
        {isSk && <div className="space-y-2">
          <Label htmlFor="topup-channel">Metode pembayaran</Label>
          <NativeSelect id="topup-channel" className="h-11" value={code} disabled={!channels?.length || creating} onChange={e => { setCode(e.target.value); setFieldError(""); }}>
            <option value="" disabled>Pilih metode</option>
            {channels?.map(channel => <option key={channel.service} value={channel.service} disabled={channel.status === "off"}>
              {channel.name}{channel.status === "off" ? " — Sementara tidak tersedia" : ""}
            </option>)}
          </NativeSelect>
          {!channels && !channelError && enabled && <Skeleton role="status" aria-label="Memuat metode pembayaran" className="h-4 w-36" />}
          {channels && !chosenChannel && <p className="text-sm text-admin-muted">Belum ada metode pembayaran aktif.</p>}
          {channelError && <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="alert" className="text-sm text-admin-danger">{channelError}</p>
            {enabled && <Button variant="outline" size="sm" className="h-11" onClick={() => setChannelAttempt(n => n + 1)}>Coba lagi</Button>}
          </div>}
        </div>}
        <div className="space-y-2">
          <Label htmlFor="topup-amount">Nominal ({isSk ? "IDR" : "USDT"})</Label>
          <Input id="topup-amount" ref={amountInput} inputMode={isSk ? "numeric" : "decimal"} autoComplete="off" className="h-11 text-base sm:text-sm" value={amount}
            onChange={e => { setAmount(e.target.value); setFieldError(""); }} disabled={creating} aria-invalid={!!fieldError} aria-describedby={`topup-bounds${fieldError ? " topup-amount-error" : ""}`} />
          <p id="topup-bounds" className="text-sm text-admin-muted">{isSk && !chosenChannel ? "Pilih metode untuk melihat batas nominal." : `Batas nominal: ${bounds}.`}</p>
          {supplier === "storebat" && <p className="text-xs text-admin-muted">Jaringan USDT BEP20 (dikreditkan 1:1 ke saldo USD StoreBat, berlaku 5 menit).</p>}
          {fieldError && <p id="topup-amount-error" role="alert" className="text-sm text-admin-danger">{fieldError}</p>}
        </div>
        {fee !== null && Number.isFinite(fee) && <p className="rounded-md bg-admin-subtle p-3 text-sm">Perkiraan biaya: <strong>{money(fee, "IDR")}</strong></p>}
        {!enabled && !error && !channelError && <p className="text-sm text-admin-muted">{TOPUP_INACTIVE}</p>}
        {error && <p role="alert" className="text-sm text-admin-danger">{error}</p>}
        <Button type="submit" className="h-11" disabled={creating || !enabled || (isSk && !chosenChannel)}>{creating ? "Membuat tagihan…" : "Buat tagihan"}</Button>
      </form> : <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant={expired ? "warning" : STATUS[item.status][1]}>{expired ? "Kedaluwarsa" : STATUS[item.status][0]}</Badge>
          {item.status === "pending" && left !== null && left > 0 && <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-admin-muted" role="timer">
            <Clock3 aria-hidden="true" className="size-4" />Sisa waktu {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>}
        </div>
        {item.status === "paid" ? <div role="status" className="flex items-center gap-3 rounded-lg border border-admin-success/25 bg-admin-success/10 p-4 text-admin-success">
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />
          <div><p className="font-semibold">Saldo masuk</p>{item.credit_amount !== null && <p className="text-sm">{money(item.credit_amount, item.currency)} dikreditkan ke {SUPPLIER_NAMES[supplier]}.</p>}</div>
        </div> : expired ? <p className="text-sm text-admin-muted">Jangan bayar tagihan ini. Jika sudah membayar setelah kedaluwarsa, kamu masih bisa mengecek statusnya.</p>
          : item.status === "failed" ? <p className="text-sm text-admin-muted">Topup ini gagal. Jangan bayar tagihan ini.{checkable && " Jika sudah membayar, cek status untuk memastikan saldo masuk."}</p>
          : item.status === "unknown" ? <p className="text-sm text-admin-muted">{item.error === "storebat_underpaid" ? "Nominal yang diterima kurang dari tagihan. Periksa di bot StoreBat atau hubungi dukungan supplier." : item.error === "storebat_review_required" ? "Tagihan memerlukan peninjauan di sisi StoreBat. Cek status atau hubungi dukungan supplier." : "Status tagihan belum pasti. Cek status sebelum membayar atau membuat tagihan lain."}</p>
          : item.status === "creating" ? <p className="text-sm text-admin-muted">Tagihan masih disiapkan. Cek status sebelum membayar.</p>
          : isSk ? <SekalipayPayment item={item} checking={checking} onRefresh={() => void refresh(true)} /> : <UsdtBep20Payment item={item} />}
        {error && <p role="alert" className="text-sm text-admin-danger">{error}</p>}
        {checkable && <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="h-11" disabled={checking} onClick={() => void refresh(true)}>{checking ? "Mengecek status…" : "Cek status"}</Button>
          {item.status === "expired" && <Button className="h-11" disabled={!enabled || checking} onClick={() => {
            setItem(undefined); setAmount(""); setFieldError(""); setError("");
            viewHeading.current?.focus();
          }}>Buat topup baru</Button>}
        </div>}
      </>}
    </DialogContent>
  </Dialog>;
}
