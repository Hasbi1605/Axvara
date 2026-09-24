"use client";

// Pengingat melayang "pesanan belum dibayar" (2026-09-24, permintaan owner).
//
// Pembeli yang tak sengaja menekan kembali / menutup halaman QRIS dulu harus
// checkout ulang, padahal ordernya masih hidup (QR 15 menit, order 60 menit,
// 1x perpanjang). Kartu ini muncul di seluruh storefront dengan hitung
// mundur, dan satu ketukan membawa kembali ke /pesanan/[code].
//
// Status & tenggat SELALU dari server (`GET /api/orders?code=`): salinan
// lokal checkout tidak pernah diperbarui (tetap "pending" selamanya) dan bisa
// sudah dibayar dari perangkat lain.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { parseExpiry } from "@/lib/expiry";

const STORAGE_KEY = "axvara-orders";
const DISMISS_KEY = "axvara-pending-reminder-dismissed";
/** Order QRIS mati paling lambat 60 menit setelah dibuat; sisanya cadangan jam perangkat. */
const CANDIDATE_MAX_AGE_MS = 75 * 60_000;
/** 2 permintaan/menit — jauh di bawah limit `orders:lookup` 20/menit. */
const RECHECK_MS = 30_000;
const HIDDEN_PREFIXES = ["/checkout", "/pesanan", "/admin"];

type LocalOrder = { code?: string; status?: string; createdAt?: string };
type Pending = { code: string; qrisExpiresAt: number | null; orderExpiresAt: number | null; reissueAllowed: boolean };

function readLocal(): LocalOrder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dismissedCodes(): string[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DISMISS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Pesanan lokal terbaru yang masih mungkin hidup. */
function newestCandidate(now: number): string | null {
  const dismissed = new Set(dismissedCodes());
  const candidates = readLocal()
    .filter((o) => o?.code && o.status === "pending" && !dismissed.has(String(o.code)))
    .map((o) => ({ code: String(o.code), created: Date.parse(String(o.createdAt || "")) }))
    .filter((o) => Number.isFinite(o.created) && now - o.created < CANDIDATE_MAX_AGE_MS)
    .sort((a, b) => b.created - a.created);
  return candidates[0]?.code ?? null;
}

/** Catat status akhir ke salinan lokal agar order ini tidak dicek ulang. */
function settleLocal(code: string, status: string) {
  try {
    const next = readLocal().map((o) => (o?.code === code ? { ...o, status: status || "closed" } : o));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* storage penuh/diblokir: cukup sembunyikan */ }
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function PendingOrderReminder() {
  const pathname = usePathname() ?? "/";
  const hiddenRoute = HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const [pending, setPending] = useState<Pending | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const code = newestCandidate(Date.now());
    if (!code) {
      setPending(null);
      return;
    }
    try {
      const response = await fetch(`/api/orders?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      if (response.status === 404) {
        settleLocal(code, "missing");
        setPending(null);
        return;
      }
      // 429/5xx: pertahankan tampilan terakhir, coba lagi di siklus berikutnya.
      if (!response.ok) return;
      const { order } = (await response.json()) as { order?: Record<string, unknown> };
      if (!order || order.status !== "pending") {
        settleLocal(code, String(order?.status ?? ""));
        setPending(null);
        return;
      }
      const qris = order.qris as { expires_at?: unknown } | null | undefined;
      setPending({
        code,
        qrisExpiresAt: parseExpiry(qris?.expires_at),
        orderExpiresAt: parseExpiry(order.expires_at),
        reissueAllowed: order.qris_reissue_allowed === true,
      });
      setNow(Date.now());
    } catch { /* jaringan putus: coba lagi nanti */ }
  }, []);

  useEffect(() => {
    if (hiddenRoute) return;
    void refresh();
    const interval = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, RECHECK_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hiddenRoute, pathname, refresh]);

  const active = Boolean(pending) && !hiddenRoute;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  if (!pending || hiddenRoute) return null;

  // QR masih berlaku → bayar; QR mati tapi order hidup + boleh perpanjang → perpanjang.
  const payDeadline = pending.qrisExpiresAt ?? pending.orderExpiresAt;
  const canPay = payDeadline !== null && now < payDeadline;
  const canRenew = !canPay && pending.reissueAllowed && pending.orderExpiresAt !== null && now < pending.orderExpiresAt;
  if (!canPay && !canRenew) return null;
  const remaining = (canPay ? payDeadline! : pending.orderExpiresAt!) - now;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissedCodes(), pending.code]));
    } catch { /* tetap sembunyikan untuk render ini */ }
    setPending(null);
  };

  return (
    <div
      role="region"
      aria-label="Pesanan menunggu pembayaran"
      className="fixed inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] z-40 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[380px]"
    >
      {/* Panel hampir solid: kaca 45% membuat ikon hero di belakang menembus teks. */}
      <div className="flex items-center gap-2 rounded-2xl border border-[#FFB800]/30 bg-[#0B1025]/95 p-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <Link href={`/pesanan/${encodeURIComponent(pending.code)}`} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#FFB800]/15">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/ios11/clock-96.png" alt="" width={20} height={20} className="h-5 w-5 object-contain" style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" }} draggable={false} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-white">{canPay ? "Pesanan belum dibayar" : "QRIS hangus"}</span>
            {/* Timer di luar area `truncate`: di layar sempit label boleh terpotong, hitung mundur tidak. */}
            <span className="flex items-baseline gap-1 text-xs text-white/60">
              <span className="truncate">{canPay ? "Bayar dalam" : "Sisa waktu"}</span>
              <span className="shrink-0 font-mono font-bold text-[#FFB800]" aria-live="off">{mmss(remaining)}</span>
            </span>
          </span>
          <span className="shrink-0 rounded-xl bg-[#00E5FF] px-3 py-2 text-xs font-bold text-[#080C1E]">{canPay ? "Bayar" : "Perpanjang"}</span>
        </Link>
        <button type="button" onClick={dismiss} aria-label="Tutup pengingat" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white">
          ✕
        </button>
      </div>
    </div>
  );
}
