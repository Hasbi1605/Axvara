"use client";

export const runtime = "edge";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatRupiah } from "@/lib/utils";
import { supportTelegramLink } from "@/lib/site";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";
import { IosIcon } from "@/components/ui/IosIcon";

type QrisInvoice = {
  payable_amount: number;
  unique_code: number;
  image_url: string;
  expires_at: string;
  status: string;
};

type TrackedOrder = {
  code: string;
  name: string;
  wa: string;
  method: string;
  items: { name: string; price: number; qty: number }[];
  subtotal: number;
  status: string;
  createdAt?: string;
  expiresAt?: string;
  qris?: QrisInvoice | null;
  qrisReissueAllowed: boolean;
};

type RecentEntry = { code: string; wa: string };

const RECENT_KEY = "axvara-track-recent";
const CODE_RE = /^AXV-\d{8}-[A-Z0-9]{8}$/;
const WA_RE = /^(\+62|62|0)8\d{8,13}$/;

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function maskWaShort(wa: string): string {
  const digits = wa.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

function countdown(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDateTime(raw?: string): string {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fromApi(value: Record<string, unknown>): TrackedOrder {
  let items: TrackedOrder["items"] = [];
  try {
    const parsed = JSON.parse(String((value as { items?: unknown }).items ?? "[]"));
    if (Array.isArray(parsed)) {
      items = parsed.map((entry) => {
        const row = entry as Record<string, unknown>;
        return { name: String(row.name ?? "Produk"), price: Number(row.price ?? 0), qty: Number(row.qty ?? 1) };
      });
    }
  } catch {
    items = [];
  }
  return {
    code: String(value.code),
    name: String(value.customer_name ?? "—"),
    wa: String(value.customer_wa ?? ""),
    method: String(value.payment_method ?? "—"),
    items,
    subtotal: Number(value.subtotal ?? 0),
    status: String(value.status ?? "pending"),
    createdAt: value.created_at ? String(value.created_at) : undefined,
    expiresAt: value.expires_at ? String(value.expires_at) : undefined,
    qrisReissueAllowed: value.qris_reissue_allowed === true,
    qris: value.qris as QrisInvoice | null | undefined,
  };
}

const STEPS = [
  { id: "created", title: "Pesanan dibuat", hint: "Kode diterbitkan, stok direservasi." },
  { id: "paid", title: "Pembayaran", hint: "QRIS otomatis / verifikasi admin untuk transfer." },
  { id: "done", title: "Pesanan diproses", hint: "Detail akses dikirim via WA / Telegram." },
] as const;

export default function LacakPesananClient() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [wa, setWa] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [waTouched, setWaTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const autoSubmitted = useRef(false);
  const lastQuery = useRef<{ code: string; wa: string } | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (Array.isArray(raw)) {
        setRecent(
          raw
            .filter((entry) => entry && typeof entry.code === "string" && typeof entry.wa === "string")
            .map((entry) => ({ code: normalizeCode(entry.code), wa: String(entry.wa).trim() }))
            .filter((entry) => CODE_RE.test(entry.code))
            .slice(0, 5),
        );
      }
    } catch {
      /* riwayat lokal opsional — abaikan bila korup */
    }
  }, []);

  const saveRecent = useCallback((entry: RecentEntry) => {
    setRecent((prev) => {
      const next = [entry, ...prev.filter((item) => item.code !== entry.code)].slice(0, 5);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* storage penuh / privat — riwayat tetap tampil sesi ini */
      }
      return next;
    });
  }, []);

  const removeRecent = useCallback((target: string) => {
    setRecent((prev) => {
      const next = prev.filter((item) => item.code !== target);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* abaikan */
      }
      return next;
    });
  }, []);

  const lookup = useCallback(async (rawCode: string, rawWa: string, silent = false) => {
    const cleanCode = normalizeCode(rawCode);
    const cleanWa = rawWa.trim();
    if (!silent) {
      setLoading(true);
      setError(null);
      setPollError(null);
    }
    try {
      const response = await fetch("/api/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode, wa: cleanWa }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Gagal melacak (${response.status})`);
      const found = fromApi(body.order);
      setOrder(found);
      setUpdatedAt(new Date());
      setPollError(null);
      if (!silent) {
        setError(null);
        lastQuery.current = { code: cleanCode, wa: cleanWa };
        saveRecent({ code: cleanCode, wa: cleanWa });
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    } catch (lookupError) {
      const message = lookupError instanceof Error ? lookupError.message : "Gagal melacak pesanan.";
      if (silent) {
        setPollError(message);
      } else {
        setError(message);
        setOrder(null);
        lastQuery.current = null;
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [saveRecent]);

  // Deep-link dari pesan WA/Telegram: ?code=AXV-...&wa=08... langsung cek sekali.
  useEffect(() => {
    if (autoSubmitted.current) return;
    const paramCode = normalizeCode(searchParams.get("code") || "");
    const paramWa = (searchParams.get("wa") || "").trim();
    if (!paramCode && !paramWa) return;
    autoSubmitted.current = true;
    if (paramCode) setCode(paramCode);
    if (paramWa) setWa(paramWa);
    if (CODE_RE.test(paramCode) && WA_RE.test(paramWa.replace(/[\s-]/g, ""))) {
      void lookup(paramCode, paramWa);
    } else if (paramCode || paramWa) {
      setCodeTouched(true);
      setWaTouched(true);
    }
  }, [searchParams, lookup]);

  const isPending = order?.status === "pending";
  useEffect(() => {
    if (!isPending || !lastQuery.current) return;
    const interval = setInterval(() => {
      const query = lastQuery.current;
      if (query) void lookup(query.code, query.wa, true);
    }, 10_000);
    return () => clearInterval(interval);
  }, [isPending, lookup]);

  useEffect(() => {
    if (!isPending) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [isPending]);

  const codeError = codeTouched && normalizeCode(code) && !CODE_RE.test(normalizeCode(code))
    ? "Format kode belum tepat. Contoh: AXV-20260917-AB12CD34."
    : null;
  const waError = waTouched && wa.trim() && !WA_RE.test(wa.trim().replace(/[\s-]/g, ""))
    ? "Nomor WA belum tepat. Contoh: 0812... atau +62812...."
    : null;
  const canSubmit = CODE_RE.test(normalizeCode(code)) && WA_RE.test(wa.trim().replace(/[\s-]/g, "")) && !loading;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setCodeTouched(true);
    setWaTouched(true);
    if (!canSubmit) return;
    void lookup(code, wa);
  };

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard diblokir — pengguna tetap bisa salin manual */
    }
  };

  const isExpired = Boolean(order && (order.status === "kadaluarsa" || (order.status === "pending" && order.expiresAt && Date.parse(order.expiresAt) <= now)));
  const isPaid = order?.status === "lunas";
  const isCancelled = order?.status === "dibatalkan";
  const payableAmount = Number(order?.qris?.payable_amount || order?.subtotal || 0);
  const statusMeta = isPaid
    ? { title: "Lunas — pembayaran diterima", badge: "Lunas", badgeClass: "border-[#22C55E]/25 bg-[#22C55E]/15 text-[#4ADE80]", icon: "/icons/ios11/checked-96.png", shell: "bg-emerald-500/15", filter: "brightness(0) saturate(100%) invert(65%) sepia(51%) saturate(717%) hue-rotate(90deg)" }
    : isCancelled
      ? { title: "Pesanan dibatalkan", badge: "Dibatalkan", badgeClass: "border-red-500/25 bg-red-500/15 text-red-300", icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
      : isExpired
        ? { title: "Pesanan kedaluwarsa", badge: "Kedaluwarsa", badgeClass: "border-white/10 bg-white/10 text-white/50", icon: "/icons/ios11/clock-96.png", shell: "bg-white/10", filter: "brightness(0) invert(1) opacity(.55)" }
        : { title: "Pending — menunggu pembayaran", badge: "Pending", badgeClass: "border-[#FFB800]/25 bg-[#FFB800]/15 text-[#FFB800]", icon: "/icons/ios11/clock-96.png", shell: "bg-[#FFB800]/15", filter: "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" };

  const stepState = (index: number): "done" | "current" | "upcoming" | "failed" => {
    if (isPaid) return "done";
    if (isCancelled || order?.status === "kadaluarsa" || isExpired) return index === 0 ? "done" : index === 1 ? "failed" : "upcoming";
    if (index === 0) return "done";
    if (index === 1) return "current";
    return "upcoming";
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">Lacak Pesanan</p>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-white sm:text-4xl">Cek status pesananmu</h1>
      <p className="mt-3 max-w-[58ch] text-sm leading-6 text-white/55">
        Masukkan <span className="font-semibold text-white">kode pesanan</span> dan{" "}
        <span className="font-semibold text-white">nomor WA yang dipakai saat checkout</span>. Status diperbarui otomatis
        dari Pending ke Lunas, Dibatalkan, atau Kedaluwarsa.
      </p>

      <form onSubmit={submit} className="ax-glass-card mt-6 rounded-[24px] p-5 sm:p-6" aria-label="Formulir lacak pesanan">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10">
            <IosIcon name="search" size={20} tint="#00E5FF" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Kode + nomor WA</p>
            <p className="text-xs text-white/45">Tanpa login, tanpa daftar akun.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          <div>
            <label htmlFor="track-code" className="mb-1 block text-xs font-medium text-white/60">Kode pesanan *</label>
            <input
              id="track-code"
              value={code}
              onChange={(event) => { setCode(event.target.value.toUpperCase()); setCodeTouched(true); }}
              onBlur={() => setCodeTouched(true)}
              placeholder="AXV-20260917-AB12CD34"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(codeError)}
              className={`h-12 w-full rounded-xl border bg-white/[0.06] px-4 font-mono text-sm font-bold tracking-[0.06em] text-white placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-white/30 focus:outline-none ${codeError ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`}
            />
            {codeError ? <p className="mt-1.5 text-xs text-red-300">{codeError}</p> : <p className="mt-1.5 text-[11px] text-white/30">Lihat di halaman sukses, chat Telegram, atau grup WA setelah checkout.</p>}
          </div>
          <div>
            <label htmlFor="track-wa" className="mb-1 block text-xs font-medium text-white/60">Nomor WA checkout *</label>
            <input
              id="track-wa"
              value={wa}
              onChange={(event) => { setWa(event.target.value.replace(/[^\d+]/g, "")); setWaTouched(true); }}
              onBlur={() => setWaTouched(true)}
              placeholder="0812..."
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={Boolean(waError)}
              className={`h-12 w-full rounded-xl border bg-white/[0.06] px-4 text-sm text-white placeholder:text-white/30 focus:outline-none ${waError ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`}
            />
            {waError ? <p className="mt-1.5 text-xs text-red-300">{waError}</p> : <p className="mt-1.5 text-[11px] text-white/30">Harus sama dengan nomor yang diisi saat checkout.</p>}
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#00E5FF] font-bold text-[#080C1E] transition hover:bg-[#00D0E8] disabled:opacity-60"
        >
          {loading && <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#080C1E]/20 border-t-[#080C1E]" />}
          {loading ? "Melacak…" : "Lacak Pesanan"}
        </button>
        <p className="mt-3 text-center text-[11px] leading-5 text-white/30">Kode dan WA dicocokkan di server. Kombinasi salah tidak membocorkan data.</p>
      </form>

      {recent.length > 0 && !order && (
        <section className="ax-glass-card mt-4 rounded-[20px] p-4 sm:p-5" aria-label="Terakhir dilacak">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Terakhir dilacak di perangkat ini</p>
          <ul className="mt-3 space-y-2">
            {recent.map((entry) => (
              <li key={entry.code} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <button
                  type="button"
                  onClick={() => { setCode(entry.code); setWa(entry.wa); setCodeTouched(true); setWaTouched(true); void lookup(entry.code, entry.wa); }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate font-mono text-xs font-bold text-[#00E5FF]">{entry.code}</span>
                  <span className="block text-[11px] text-white/40">WA {maskWaShort(entry.wa)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeRecent(entry.code)}
                  aria-label={`Hapus riwayat ${entry.code}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                >
                  <IosIcon name="close" size={14} tint="white" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {order && (
        <div ref={resultRef} className="ax-glass-card mt-6 scroll-mt-24 rounded-[28px] p-6 text-center sm:p-8" aria-live="polite">
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${statusMeta.shell}`}>
            <img src={statusMeta.icon} alt="" width={32} height={32} className="h-8 w-8 object-contain" style={{ filter: statusMeta.filter }} draggable={false} />
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold text-white">{statusMeta.title}</h2>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <span className="font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]">{order.code}</span>
            <button
              type="button"
              onClick={() => void copy(order.code, "code")}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 px-3 text-xs font-semibold text-white/70 transition hover:bg-white/10"
            >
              <IosIcon name="copy" size={13} tint="white" /> {copied === "code" ? "Disalin" : "Salin"}
            </button>
          </div>
          <span className={`mt-3 inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${statusMeta.badgeClass}`}>{statusMeta.badge}</span>
          {isPending && !isExpired && order.expiresAt && (
            <p className="mt-3 inline-flex items-center gap-2 text-xs text-[#FFB800]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#FFB800]" />
              Batas pembayaran {countdown(order.expiresAt, now)} — status dicek otomatis tiap 10 detik
            </p>
          )}
          {updatedAt && (
            <p className="mt-2 text-[11px] text-white/35">
              Diperbarui {updatedAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} WIB
              {pollError ? ` • pembaruan terakhir gagal: ${pollError}` : ""}
            </p>
          )}

          <ol className="mt-6 space-y-0 text-left" aria-label="Alur status pesanan">
            {STEPS.map((step, index) => {
              const state = stepState(index);
              const dot = state === "done"
                ? "border-[#22C55E]/40 bg-[#22C55E]/15"
                : state === "current"
                  ? "border-[#FFB800]/40 bg-[#FFB800]/15"
                  : state === "failed"
                    ? "border-red-500/40 bg-red-500/15"
                    : "border-white/10 bg-white/[0.04]";
              return (
                <li key={step.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < STEPS.length - 1 && <span aria-hidden className={`absolute left-[15px] top-9 h-[calc(100%-28px)] w-px ${state === "done" ? "bg-[#22C55E]/40" : "bg-white/10"}`} />}
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${dot}`}>
                    {state === "done"
                      ? <IosIcon name="checked" size={14} tint="#22c55e" />
                      : state === "failed"
                        ? <IosIcon name="close" size={13} tint="#ef4444" />
                        : state === "current"
                          ? <IosIcon name="clock" size={14} tint="#ffb800" />
                          : <IosIcon name="box" size={14} tint="white" />}
                  </span>
                  <span className="min-w-0 pt-0.5">
                    <span className={`block text-sm font-semibold ${state === "upcoming" ? "text-white/40" : "text-white"}`}>{step.title}</span>
                    <span className="block text-xs leading-5 text-white/45">
                      {step.id === "created" && order.createdAt ? `Dibuat ${formatDateTime(order.createdAt)}.` : step.hint}
                      {step.id === "paid" && isPending && !isExpired ? " Selesaikan pembayaran sebelum batas habis." : ""}
                      {step.id === "paid" && isPaid ? " Pembayaran terverifikasi." : ""}
                      {step.id === "paid" && (isCancelled || isExpired) ? " Pembayaran tidak selesai." : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          {isPaid && (
            <p className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-left text-xs leading-6 text-emerald-200">
              Pembayaran <span className="font-semibold text-white">{order.name}</span> sudah diterima. Detail akses dikirim
              via WA / Telegram. Simpan kode pesanan untuk klaim garansi.
            </p>
          )}
          {isCancelled && (
            <p className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4 text-left text-xs leading-6 text-red-200">
              Pesanan ini dibatalkan. Jika kamu sudah transfer, hubungi admin dengan menyertakan kode pesanan.
            </p>
          )}
          {isExpired && !isPaid && (
            <p className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left text-xs leading-6 text-white/60">
              Batas pembayaran sudah habis dan stok dikembalikan. Jangan bayar invoice lama — buat pesanan baru dari katalog.
            </p>
          )}

          <div className="ax-glass-card mt-5 rounded-2xl p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Ringkasan</p>
            <div className="mt-3 space-y-2">
              {order.items.map((item, index) => (
                <div key={index} className="flex justify-between gap-4 text-sm">
                  <span className="text-white/70">{item.name} × {item.qty}</span>
                  <span className="font-medium text-white">{formatRupiah(item.price * item.qty)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3 text-xs text-white/50">
              <div className="flex justify-between gap-4"><span>Pembeli</span><span className="text-right text-white/75">{order.name} • {order.wa}</span></div>
              <div className="flex justify-between gap-4"><span>Dibuat</span><span className="text-white/75">{formatDateTime(order.createdAt)}</span></div>
            </div>
            <div className="mt-3 flex justify-between border-t border-white/10 pt-3">
              <span className="text-sm text-white/60">Total • {order.method.toUpperCase()}</span>
              <span className="font-bold text-white">{formatRupiah(payableAmount)}</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2.5">
            {isPending && !isExpired ? (
              <Link href={`/pesanan/${order.code}`} className="col-span-2 flex h-11 items-center justify-center whitespace-nowrap rounded-xl bg-[#00E5FF] px-3 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8]">Buka Halaman Pembayaran</Link>
            ) : isExpired || isCancelled ? (
              <Link href="/#katalog" className="col-span-2 flex h-11 items-center justify-center whitespace-nowrap rounded-xl bg-[#00E5FF] px-3 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8]">Buat Pesanan Baru</Link>
            ) : (
              <Link href="/" className="ax-glass-card col-span-2 flex h-11 items-center justify-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-white hover:bg-white/10">Lanjut Belanja</Link>
            )}
          </div>
          <div className="mt-3">
            <p className="text-center text-[11px] text-white/35">Butuh bantuan?</p>
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              <StoreWhatsAppLink message={`saya ingin menanyakan pesanan ${order.code} sebesar ${formatRupiah(payableAmount)}`} className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#25D366]/40 hover:bg-white/[0.06]"><img src="/brand/whatsapp-circle.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>WA Admin</span></StoreWhatsAppLink>
              <a href={supportTelegramLink()} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#2AABEE]/40 hover:bg-white/[0.06]"><img src="/brand/telegram.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>Telegram</span></a>
            </div>
          </div>
          <button type="button" onClick={() => { setOrder(null); setUpdatedAt(null); lastQuery.current = null; }} className="mt-4 text-xs font-semibold text-white/45 underline decoration-white/20 underline-offset-4 hover:text-white">Lacak pesanan lain</button>
          <p className="mt-3 text-center text-[11px] leading-5 text-white/35">Produk third-party AXVARA — simpan kode pesanan untuk klaim. Garansi berupa penggantian sesuai <Link href="/garansi-replace" className="text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white">ketentuan garansi</Link>.</p>
        </div>
      )}

      <section className="mt-8 grid gap-3 sm:grid-cols-3" aria-label="Cara melacak">
        {[
          ["1", "Siapkan kode", "Format AXV-YYYYMMDD-XXXXXXXX dari halaman sukses atau chat bot."],
          ["2", "Samakan nomor WA", "Pakai nomor yang diisi saat checkout, 08… atau +62… sama saja."],
          ["3", "Pantau status", "Pending → Lunas otomatis. Transfer manual diverifikasi admin."],
        ].map(([number, title, body]) => (
          <div key={number} className="ax-glass-card rounded-[20px] p-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#00E5FF]/[0.12] text-xs font-bold text-[#00E5FF]">{number}</span>
            <p className="mt-3 text-sm font-semibold text-white">{title}</p>
            <p className="mt-1 text-xs leading-5 text-white/50">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-4 space-y-2" aria-label="Pertanyaan umum">
        {[
          ["Di mana saya menemukan kode pesanan?", "Setelah checkout kamu diarahkan ke halaman /pesanan/AXV-... Simpan kodenya. Order Telegram bisa dilihat lagi lewat /orders, order WA tercatat di grup."],
          ["Nomor WA saya berubah / salah ketik?", "Pencarian memakai nomor persis seperti saat checkout. Jika salah ketik, hubungi admin via tombol di atas dengan menyebutkan kode pesanan dan nomor yang benar."],
          ["Status Pending padahal sudah bayar QRIS?", "Tunggu 1–2 menit lalu halaman ini memeriksa ulang otomatis tiap 10 detik. Pastikan nominal tepat. Jika lebih dari 10 menit, hubungi admin dengan kode pesanan."],
          ["Status Pending untuk transfer manual?", "Admin memverifikasi bukti pada jam dukungan 09.00–23.00 WIB, biasanya 5–15 menit. Pastikan bukti sudah terupload saat checkout."],
        ].map(([question, answer]) => (
          <details key={question} className="ax-glass-card group rounded-2xl px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-3">{question}<IosIcon name="chevron" size={14} tint="white" /></span>
            </summary>
            <p className="mt-2 text-xs leading-6 text-white/55">{answer}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
