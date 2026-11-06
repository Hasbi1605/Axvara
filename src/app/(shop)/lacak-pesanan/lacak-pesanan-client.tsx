"use client";

export const runtime = "edge";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { supportTelegramLink } from "@/lib/site";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";
import { WrCredentialsPanel } from "@/components/storefront/WrCredentialsPanel";
import { WarrantyClaimAccordion } from "@/components/storefront/WarrantyClaim";
import { DeviceOrders } from "@/components/storefront/DeviceOrders";
import { IosIcon } from "@/components/ui/IosIcon";
import { parseExpiry } from "@/lib/expiry";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { GatewayPaymentPanel } from "@/components/storefront/GatewayPaymentPanel";
import { usePaymentConsent } from "@/hooks/usePaymentConsent";
import { asPayLocale, cancelCopy, normalizePaymentView, orderPanelCopy, paymentCancelHidden, paymentHeading, paymentMethodLabel, resumeAmount, resumeInfo, usdFor, type PayLocale, type PaymentView } from "@/lib/payment-ui";
import { normalizeOrderAccessCode } from "@/lib/order-access-format";
import { isValidOrderContact, orderAccessHeaders, readOrderContact, rememberBuyerAccessSession, rememberOrderContact } from "@/lib/order-access-client";
import { SLOW_MS, useLoadingStage } from "@/hooks/useLoadingStage";
import { isPediaCode, pediaOrderUrl, pediaTrackUrl, redirectBrowser } from "@/components/pedia/status-view";

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
  /** true bila detail akun WR sudah siap (dari /api/orders/lookup). */
  credentialsReady: boolean;
  /** true bila order PIN6 baru butuh PIN untuk unlock kredensial; false = legacy kontak saja. */
  buyerPinRequired: boolean;
  deliveryProgress?: { ready: number; total: number };
  /** true bila order milik pipeline supplier (WR/SK). */
  supplierOwned: boolean;
  /** true bila link supplier masih berjalan (belum terminal). */
  supplierRunning: boolean;
  /** Status pengiriman produk. `failed` = lunas tetapi produk belum sampai. */
  fulfillmentStatus?: string;
  /** Tampilan aman non-QRIS dari server (gateway/crypto); null untuk QRIS/lama. */
  payment: PaymentView | null;
  /** Bahasa tersimpan di pesanan; teks pembayaran tidak mengikuti preferensi global. */
  locale: PayLocale;
};

type RecentEntry = { code: string; wa: string; savedAt?: number };

const RECENT_KEY = "axvara-track-recent";
const CODE_RE = /^AXV-\d{8}-[A-Z0-9]{8}$/;
/** No. WA ATAU email checkout. PIN/kode akses DITOLAK di form status. */
const isValidContact = (raw: string) => isValidOrderContact(raw);

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function maskWaShort(wa: string): string {
  if (wa.includes("@")) return wa.trim().replace(/(^.).*(@.*)$/, "$1***$2");
  const digits = wa.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

function countdown(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor(((parseExpiry(expiresAt) ?? 0) - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDateTime(raw?: string): string {
  // `created_at` datang dari D1 sebagai UTC berformat spasi; `new Date(raw)`
  // akan membacanya sebagai waktu lokal dan memundurkan jam 7 jam di WIB.
  return formatWibDateTime(raw, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) ?? "—";
}

function fromApi(value: Record<string, unknown>): TrackedOrder {
  let items: TrackedOrder["items"] = [];
  try {
    const parsed = Array.isArray(value.items) ? value.items : JSON.parse(String(value.items ?? "[]"));
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
    credentialsReady: value.credentials_ready === true,
    buyerPinRequired: value.buyer_pin_required !== false,
    deliveryProgress: value.unique_units_progress as { ready: number; total: number } | undefined,
    supplierOwned: value.supplier_owned === true,
    supplierRunning: value.supplier_running === true,
    fulfillmentStatus: value.fulfillment_status ? String(value.fulfillment_status) : undefined,
    qris: value.qris as QrisInvoice | null | undefined,
    payment: normalizePaymentView(value.payment),
    locale: asPayLocale(value.locale),
  };
}

const STEPS = [
  { id: "created", title: "Pesanan dibuat", hint: "Kode diterbitkan, stok direservasi." },
  { id: "paid", title: "Pembayaran", hint: "Status diperbarui oleh sistem pembayaran." },
  { id: "done", title: "Pesanan diproses", hint: "Detail pesanan akan otomatis dikirimkan di email saat order dan akan tampil di halaman ini." },
] as const;

export default function LacakPesananClient() {
  const searchParams = useSearchParams();
  const adminView = searchParams.get("admin") === "1";
  const [code, setCode] = useState("");
  const [wa, setWa] = useState("");
  const [pin, setPin] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [waTouched, setWaTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const lookupStage = useLoadingStage(loading, [SLOW_MS]);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  // Pertahanan: lookup yang mengembalikan pesanan Pedia tidak dirender sebagai Market.
  const [pediaPointer, setPediaPointer] = useState<{ code: string; status: string | null } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Batal mandiri (2026-10-11, keputusan owner): cermin tombol di
  // /pesanan/[code] — kontak sudah terverifikasi oleh lookup itu sendiri.
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const autoSubmitted = useRef(false);
  const lastQuery = useRef<{ code: string; wa: string } | null>(null);
  const pollRequest = useRef(false);
  const lookupController = useRef<AbortController | null>(null);
  const lookupGeneration = useRef(0);
  const nextPollAt = useRef(0);
  const resultRef = useRef<HTMLDivElement | null>(null);
  // "Lacak pesanan lain": form dirender ulang saat hasil hilang; fokus pindah ke kolom kode sesudah remount.
  const focusCodeNext = useRef(false);

  useEffect(() => {
    if (adminView) return;
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (Array.isArray(raw)) {
        const entries = raw
            .filter((entry) => entry && typeof entry.code === "string" && typeof entry.wa === "string")
            // PIN/kode akses tidak pernah menetap di riwayat: scrub ke kontak
            // kosong, kontak legacy tetap tersimpan.
            .map((entry) => ({ code: normalizeCode(entry.code), wa: isValidOrderContact(entry.wa) ? String(entry.wa).trim() : "", savedAt: Number(entry.savedAt) || Date.now() }))
            .filter((entry) => CODE_RE.test(entry.code) && Date.now() - entry.savedAt < 7 * 86_400_000)
            .slice(0, 5);
        setRecent(entries);
        localStorage.setItem(RECENT_KEY, JSON.stringify(entries));
      }
    } catch {
      /* riwayat lokal opsional — abaikan bila korup */
    }
  }, [adminView]);

  const saveRecent = useCallback((entry: RecentEntry) => {
    setRecent((prev) => {
      const safeEntry = isValidOrderContact(entry.wa) ? entry : { ...entry, wa: "" };
      const next = [{...safeEntry,savedAt:Date.now()}, ...prev.filter((item) => item.code !== entry.code)].slice(0, 5);
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

  const lookup = useCallback(async (rawCode: string, rawWa: string, silent = false, rawPin = "") => {
    if (pollRequest.current && silent) return;
    if (!silent) lookupController.current?.abort();
    if (silent && (document.hidden || Date.now() < nextPollAt.current)) return;
    pollRequest.current = true;
    const generation = ++lookupGeneration.current;
    const controller = new AbortController();
    lookupController.current = controller;
    const cleanCode = normalizeCode(rawCode);
    const cleanWa = rawWa.trim();
    // PIN opsional: hanya untuk validasi status bila diisi; tidak disimpan.
    const normalizedPin = normalizeOrderAccessCode(rawPin.trim());
    const cleanPin = [6, 26].includes(normalizedPin.length) ? normalizedPin : "";
    if (!silent) {
      setLoading(true);
      setError(null);
      setPollError(null);
    }
    try {
      const lookupBody: Record<string, unknown> = adminView ? { code: cleanCode, adminView: true } : { code: cleanCode, contact: cleanWa };
      if (!adminView && cleanPin) lookupBody.access_code = cleanPin;
      const response = await fetchWithTimeout("/api/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orderAccessHeaders(cleanCode, cleanWa) },
        body: JSON.stringify(lookupBody),
        cache: "no-store", signal: controller.signal,
      }, 20_000);
      const body = await response.json().catch(() => ({}));
      if (generation !== lookupGeneration.current || controller.signal.aborted) return;
      if (response.status === 429) nextPollAt.current = Date.now() + Math.max(60, Number(response.headers.get("Retry-After")) || 60) * 1000;
      if (adminView && response.status === 401) { setOrder(null); lastQuery.current = null; }
      if (!response.ok) throw new Error(body.error || `Gagal melacak (${response.status})`);
      if (body.order?.order_kind === "pedia" || isPediaCode(String(body.order?.code ?? ""))) {
        // Tanpa STEPS/garansi/kredensial/PIN Market; kontak tidak disimpan atau dibawa ke host lain.
        setOrder(null);
        lastQuery.current = null;
        setError(null);
        setPediaPointer({ code: String(body.order.code), status: typeof body.order.pedia_status === "string" ? body.order.pedia_status : null });
        return;
      }
      setPediaPointer(null);
      nextPollAt.current = Date.now() + 5_000;
      const found = fromApi(body.order);
      setOrder(found);
      setUpdatedAt(new Date());
      setPollError(null);
      if (!silent) {
        setError(null);
        // Polling sesi tidak memakai jatah PIN: sesi p1 diterbitkan server.
        lastQuery.current = { code: cleanCode, wa: cleanWa };
        rememberOrderContact(cleanCode, cleanWa);
        rememberBuyerAccessSession(cleanCode, body.buyer_access_session);
        if (!adminView) saveRecent({ code: cleanCode, wa: cleanWa });
        requestAnimationFrame(() => {
          const result = resultRef.current;
          // Isi akun yang sudah tampil punya auto-scroll sendiri: jangan
          // ditarik kembali ke ringkasan oleh callback hasil lacak yang telat.
          if (!result || result.querySelector('[aria-label="Detail akun digital"]')) return;
          const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          result.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
        });
      }
    } catch (lookupError) {
      if (generation !== lookupGeneration.current || controller.signal.aborted) return;
      const message = lookupError instanceof Error ? lookupError.message : "Gagal melacak pesanan.";
      if (silent) {
        setPollError(message);
      } else {
        setError(message);
        setOrder(null);
        lastQuery.current = null;
      }
    } finally {
      if (generation === lookupGeneration.current) {
        pollRequest.current = false;
        if (!silent) setLoading(false);
      }
    }
  }, [saveRecent, adminView]);

  useEffect(() => () => { lookupController.current?.abort(); }, []);
  useEffect(() => {
    if (order !== null || !focusCodeNext.current) return;
    focusCodeNext.current = false;
    document.getElementById("track-code")?.focus();
  }, [order]);

  // Deep-link dari pesan WA/Telegram: ?code=AXV-...&wa=08... (atau &email=) langsung cek sekali.
  useEffect(() => {
    if (autoSubmitted.current) return;
    const paramCode = normalizeCode(searchParams.get("code") || "");
    const paramWa = (searchParams.get("contact") || searchParams.get("email") || searchParams.get("wa") || "").trim();
    if (!paramCode && !paramWa) return;
    autoSubmitted.current = true;
    if (isPediaCode(paramCode)) {
      // Kode AXP milik Pedia: alihkan tanpa kontak (param contact/email/wa dibuang).
      if (adminView) setCode(paramCode);
      else redirectBrowser(pediaTrackUrl(paramCode));
      return;
    }
    if (paramCode) setCode(paramCode);
    if (paramWa) setWa(paramWa);
    if (CODE_RE.test(paramCode) && (adminView || isValidContact(paramWa))) {
      void lookup(paramCode, paramWa);
    } else if (paramCode || paramWa) {
      setCodeTouched(true);
      setWaTouched(true);
    }
  }, [searchParams, lookup, adminView]);

  const isPending = order?.status === "pending";
  // Persetujuan total gateway memakai kontak yang BARU dipakai lookup (bukan input baru, bukan PIN).
  const [checkingPay, setCheckingPay] = useState(false);
  const refreshTracked = useCallback(async () => {
    const query = lastQuery.current;
    if (!query) return;
    nextPollAt.current = 0;
    await lookup(query.code, query.wa, true);
  }, [lookup]);
  const resolveConsentContact = useCallback((input: string) => (input || lastQuery.current?.wa || "").trim(), []);
  const consentHook = usePaymentConsent({ code: order?.code ?? "", locale: order?.locale ?? "id", resolveContact: resolveConsentContact, refresh: refreshTracked });
  const checkPaymentNow = async () => {
    if (checkingPay) return;
    setCheckingPay(true);
    try { await refreshTracked(); } finally { setCheckingPay(false); }
  };
  const awaitingSupplier = Boolean(order && order.status === "lunas" && (
    (!order.credentialsReady && order.supplierRunning) ||
    (order.deliveryProgress && order.deliveryProgress.ready < order.deliveryProgress.total)
  ));
  useEffect(() => {
    if (!lastQuery.current || (!isPending && !awaitingSupplier)) return;
    const tick = () => {
      const query = lastQuery.current;
      if (query && !document.hidden) void lookup(query.code, query.wa, true);
    };
    const interval = setInterval(tick, 5_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", tick); };
  }, [isPending, awaitingSupplier, lookup]);

  useEffect(() => {
    if (!isPending) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [isPending]);

  const codeError = codeTouched && normalizeCode(code) && !CODE_RE.test(normalizeCode(code)) && !isPediaCode(code)
    ? "Format kode belum tepat. Contoh: AXV-20260917-AB12CD34."
    : null;
  const waError = waTouched && wa.trim() && !isValidContact(wa)
    ? "Isi No. WA atau email checkout yang dipakai saat memesan."
    : null;
  const pinError = pin.trim() && ![6, 26].includes(normalizeOrderAccessCode(pin.trim()).length)
    ? "Isi PIN 6 karakter dari email, atau kode akses lama. Kosongkan untuk status saja."
    : null;
  const pediaTyped = isPediaCode(code);
  const canSubmit = pediaTyped || (CODE_RE.test(normalizeCode(code)) && isValidContact(wa) && !pinError && !loading);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setCodeTouched(true);
    setWaTouched(true);
    if (pediaTyped) { redirectBrowser(pediaTrackUrl(code), "assign"); return; }
    if (!canSubmit) return;
    void lookup(code, wa, false, pin);
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

  /** Batalkan pesanan sendiri: kontak = yang dipakai lookup barusan. */
  const cancelOrder = async () => {
    const query = lastQuery.current;
    if (adminView || !order || !query || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const response = await fetchWithTimeout(`/api/orders/${encodeURIComponent(order.code)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orderAccessHeaders(order.code) },
        body: JSON.stringify({ contact: query.wa }),
        cache: "no-store",
      }, 20_000);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || cancelCopy(order.locale).failed);
      setConfirmingCancel(false);
      await lookup(query.code, query.wa, true);
    } catch (cancelError) {
      setCancelError(cancelError instanceof Error ? cancelCopy(order.locale).serverError(cancelError.message) : cancelCopy(order.locale).failed);
    } finally {
      setCancelling(false);
    }
  };

  // Non-QRIS: tahap `expired` dari tampilan aman server juga berarti kedaluwarsa (tanpa panel/tautan).
  const isExpired = Boolean(order && (order.status === "kadaluarsa" || (order.status === "pending" && ((order.expiresAt && (parseExpiry(order.expiresAt) ?? 0) <= now) || order.payment?.state === "expired"))));
  const isPaid = order?.status === "lunas";
  const isCancelled = order?.status === "dibatalkan";
  // Lunas TAPI pengiriman gagal (2026-09-23). `/api/orders/lookup` sudah
  // mengembalikan `fulfillment_status`, tetapi halaman ini dulu hanya membaca
  // status pembayaran — order yang produknya gagal terkirim tetap tampil hijau
  // "Lunas — pembayaran diterima" selamanya. Pembeli yang menghapus chat atau
  // ganti HP jadi buta total: satu-satunya kabar ada di chat.
  const isDeliveryFailed = isPaid && order?.fulfillmentStatus === "failed";
  const pay = order?.payment ?? null;
  const payHeading = order && pay && !isPaid && !isCancelled ? paymentHeading(pay, order.locale, isExpired) : null;
  const payInfo = order && pay ? resumeInfo(pay, order.locale, isExpired) : null;
  const showPayPanel = Boolean(pay) && !adminView && !isPaid && !isCancelled && !isExpired;
  const payableAmount = Number(order?.qris?.payable_amount || (pay?.kind === "gateway" && pay.total !== null ? pay.total : order?.subtotal) || 0);
  const payToneClass = payHeading?.tone === "info" ? "border-[#00E5FF]/25 bg-[#00E5FF]/10 text-[#5cefff]" : payHeading?.tone === "neutral" ? "border-white/10 bg-white/10 text-white/60" : "border-[#FFB800]/25 bg-[#FFB800]/15 text-[#FFB800]";
  const statusMeta = isDeliveryFailed
    ? { title: "Lunas — pengiriman bermasalah", badge: "Perlu bantuan", badgeClass: "border-red-500/25 bg-red-500/15 text-red-300", icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
    : isPaid
    ? { title: "Lunas — pembayaran diterima", badge: "Lunas", badgeClass: "border-[#22C55E]/25 bg-[#22C55E]/15 text-[#4ADE80]", icon: "/icons/ios11/checked-96.png", shell: "bg-emerald-500/15", filter: "brightness(0) saturate(100%) invert(65%) sepia(51%) saturate(717%) hue-rotate(90deg)" }
    : isCancelled
      ? { title: "Pesanan dibatalkan", badge: "Dibatalkan", badgeClass: "border-red-500/25 bg-red-500/15 text-red-300", icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
      : payHeading
        ? { title: payHeading.h1, badge: payHeading.badge, badgeClass: payToneClass, icon: "/icons/ios11/clock-96.png", shell: payHeading.tone === "neutral" ? "bg-white/10" : "bg-[#FFB800]/15", filter: payHeading.tone === "neutral" ? "brightness(0) invert(1) opacity(.55)" : "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" }
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
      {adminView ? (
        <div className="ax-glass-card mt-5 rounded-2xl p-4" aria-label="Akses admin">
          <p className="text-sm text-white/70">Melihat pesanan pembeli melalui sesi admin.</p>
          {loading && <p role="status" className="mt-2 text-sm text-white/60">Memuat pesanan…</p>}
          {(error || pollError) && <p role="alert" className="mt-2 text-sm text-red-300">{error || pollError}</p>}
          <Link href="/admin" prefetch={false} target="_blank" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[#00E5FF]">Buka / masuk panel admin</Link>
          {isPediaCode(code) && <a href="/admin?section=pedia&tab=orders" className="ml-4 inline-flex min-h-11 items-center text-sm font-semibold text-[#00E5FF]">Buka di Admin → Pedia → Pesanan</a>}
          <button type="button" disabled={loading} onClick={() => void lookup(code, "")} className="ml-4 min-h-11 text-sm text-white/70">Muat ulang pesanan</button>
        </div>
      ) : <p className="mt-3 max-w-[58ch] text-sm leading-6 text-white/55">
        Masukkan <span className="font-semibold text-white">kode pesanan</span> dan{" "}
        <span className="font-semibold text-white">No. WA atau email checkout</span>. Status diperbarui otomatis
        dari Pending ke Lunas, Dibatalkan, atau Kedaluwarsa. PIN hanya untuk membuka detail akun.
      </p>}

      {/* Form utama dulu; daftar perangkat diringkas di bawah agar hemat ruang. */}
      {!adminView && <form onSubmit={submit} className="ax-glass-card mt-6 rounded-[24px] p-5 sm:p-6" aria-label="Formulir lacak pesanan">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10">
            <IosIcon name="search" size={20} tint="#00E5FF" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Kode pesanan + kontak checkout</p>
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
              className={`h-12 w-full rounded-xl border bg-white/[0.06] px-4 font-mono text-sm font-bold tracking-[0.06em] text-white placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-white/55 focus:outline-none ${codeError ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`}
            />
            {codeError && <p className="mt-1.5 text-xs text-red-300">{codeError}</p>}
            {pediaTyped && <p role="status" className="mt-1.5 text-xs leading-5 text-white/65">Kode AXP adalah pesanan Pedia. <a href={pediaTrackUrl(code)} className="font-semibold text-[#00E5FF] underline underline-offset-2">Lacak di Pedia →</a> Kontak diisi di halaman Pedia.</p>}
          </div>
          <div>
            <label htmlFor="track-wa" className="mb-1 block text-xs font-medium text-white/60">No. WA atau email checkout *</label>
            <input
              id="track-wa"
              value={wa}
              onChange={(event) => { setWa(event.target.value); setWaTouched(true); }}
              onBlur={() => setWaTouched(true)}
              placeholder="0812… atau nama@email.com"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={Boolean(waError)}
              aria-describedby={waError ? "track-wa-error" : undefined}
              className={`h-12 w-full rounded-xl border bg-white/[0.06] px-4 text-sm text-white placeholder:text-white/55 focus:outline-none ${waError ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`}
            />
            {waError && <p id="track-wa-error" className="mt-1.5 text-xs text-red-300">{waError}</p>}
          </div>
          <div>
            <label htmlFor="track-pin" className="mb-1 block text-xs font-medium text-white/60">PIN akses (didapat di email yang diisi saat checkout)</label>
            <input
              id="track-pin"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="PIN dari email produk siap"
              type="password"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              maxLength={32}
              aria-invalid={Boolean(pinError)}
              aria-describedby={pinError ? "track-pin-error" : undefined}
              className={`h-12 w-full rounded-xl border bg-white/[0.06] px-4 text-sm text-white placeholder:text-white/55 focus:outline-none ${pinError ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`}
            />
            {pinError && <p id="track-pin-error" className="mt-1.5 text-xs text-red-300">{pinError}</p>}
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#00E5FF] font-bold text-[#080C1E] transition hover:bg-[#00D0E8] disabled:opacity-60"
        >
          {loading && <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#080C1E]/20 border-t-[#080C1E]" />}
          {loading ? (lookupStage >= 1 ? "Koneksi lambat, masih melacak…" : "Melacak…") : "Lacak Pesanan"}
        </button>
      </form>}

      {!adminView && recent.length > 0 && !order && (
        <section className="ax-glass-card mt-4 rounded-[20px] p-4 sm:p-5" aria-label="Terakhir dilacak">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Terakhir dilacak di perangkat ini</p>
          <ul className="mt-3 space-y-2">
            {recent.map((entry) => (
              <li key={entry.code} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <button
                  type="button"
                  onClick={() => { const proof = readOrderContact(entry.code) || entry.wa; setCode(entry.code); setWa(proof); setPin(""); setCodeTouched(true); setWaTouched(true); if (proof) void lookup(entry.code, proof); }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate font-mono text-xs font-bold text-[#00E5FF]">{entry.code}</span>
                  <span className="block text-[11px] text-white/40">{entry.wa ? `${entry.wa.includes("@") ? "Email" : "WA"} ${maskWaShort(entry.wa)}` : "Isi kontak checkout"}</span>
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

      {/* Di bawah "Terakhir dilacak": ringkas collapsed agar tidak memakan ruang. */}
      {!adminView && !order && <DeviceOrders />}

      {pediaPointer && !order && (
        <div className="ax-glass-card mt-6 rounded-[28px] p-6 text-center sm:p-8" aria-live="polite" aria-label="Pesanan Pedia">
          <h2 className="font-display text-2xl font-bold text-white">Pesanan Pedia</h2>
          <p className="mt-2 break-all font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]">{pediaPointer.code}</p>
          {pediaPointer.status && <p className="mt-2 text-sm text-white/65">Status: {pediaPointer.status}</p>}
          {adminView
            ? <a href="/admin?section=pedia&tab=orders" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#00E5FF] px-5 font-bold text-[#080C1E]">Buka di Admin → Pedia → Pesanan</a>
            : <a href={pediaOrderUrl(pediaPointer.code)} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#00E5FF] px-5 font-bold text-[#080C1E]">Buka status pesanan</a>}
        </div>
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
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-white/15 px-3 text-xs font-semibold text-white/70 transition hover:bg-white/10"
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

          {pay && payHeading && <p className="mt-3 text-sm leading-6 text-white/60">{payHeading.lead}</p>}
          {pay && showPayPanel && order && (
            <GatewayPaymentPanel
              payment={pay}
              locale={order.locale}
              now={now}
              checking={checkingPay}
              onCheck={() => void checkPaymentNow()}
              contactKnown
              consent={{ busy: consentHook.busy, error: consentHook.error, stale: consentHook.stale, onApprove: (total, contact) => void consentHook.approve(total, contact) }}
            />
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
                      {step.id === "created" && order.createdAt ? `Dibuat ${formatDateTime(order.createdAt)}.` : step.id === "paid" && pay ? "Diverifikasi otomatis oleh sistem pembayaran." : step.hint}
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
              Pembayaran <span className="font-semibold text-white">{order.name}</span> sudah diterima. Detail pesanan akan otomatis dikirimkan di email saat order dan akan tampil di halaman ini. Simpan kode pesanan untuk klaim garansi.
            </p>
          )}
          {/* Detail akun WR di hasil lacak: kontak sudah diverifikasi penuh
              oleh /api/orders/lookup; PIN form utama diteruskan sebagai prefill
              React state (tanpa storage). Verifikasi tetap di server. */}
          {isDeliveryFailed && (
            <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-4">
              <p className="text-sm font-semibold text-red-200">Pembayaran sudah kami terima, tetapi produk gagal dikirim otomatis.</p>
              <p className="mt-1 text-xs leading-5 text-white/60">
                Tim kami sudah mendapat notifikasi dan akan menyerahkan produkmu secara manual. Bila belum ada kabar, hubungi admin dengan menyebut kode pesanan di atas.
              </p>
            </div>
          )}
          {isPaid && order.credentialsReady && (
            <WrCredentialsPanel deliveryProgress={order.deliveryProgress} key={order.code} code={order.code} prefillContact={wa} prefillPin={pin} buyerPinRequired={order.buyerPinRequired} adminView={adminView} />
          )}
          {isPaid && !order.credentialsReady && order.supplierRunning && (
            <p className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left text-xs leading-6 text-white/60" role="status">
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-[#00E5FF]" aria-hidden />
              Menyiapkan detail produkmu… Halaman ini memeriksa sendiri, detail akan tampil otomatis di sini.
            </p>
          )}
          {isPaid && !order.credentialsReady && <WarrantyClaimAccordion />}
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
              <span className="text-sm text-white/60">{pay?.kind === "crypto" ? "Total pesanan" : "Total"} • {paymentMethodLabel(pay, order.method)}</span>
              <span className="font-bold text-white">{formatRupiah(payableAmount)}</span>
            </div>
            {pay?.kind === "crypto" && pay.usdText && (
              <div className="mt-1.5 flex justify-between text-xs text-white/55"><span>{pay.surchargeBps !== null && pay.surchargeText ? orderPanelCopy(order.locale === "en" ? "en" : "id").crypto.totalWithFee(pay.surchargeBps) : (order.locale === "en" ? "Order value (USD)" : "Nilai pesanan (USD)")}</span><span className="tabular-nums text-white/80">{usdFor(pay.usdText, asPayLocale(order.locale))}</span></div>
            )}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2.5">
            {!adminView && isPending && !isExpired ? (
              <Link prefetch={false} href={`/pesanan/${order.code}`} className="col-span-2 flex h-11 items-center justify-center whitespace-nowrap rounded-xl bg-[#00E5FF] px-3 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8]">{payInfo ? payInfo.cta : "Buka Halaman Pembayaran"}</Link>
            ) : isExpired || isCancelled ? (
              <Link prefetch={false} href="/#katalog" className="col-span-2 flex h-11 items-center justify-center whitespace-nowrap rounded-xl bg-[#00E5FF] px-3 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8]">Buat Pesanan Baru</Link>
            ) : (
              <Link prefetch={false} href="/" className="ax-glass-card col-span-2 flex h-11 items-center justify-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-white hover:bg-white/10">Lanjut Belanja</Link>
            )}
          </div>
          {/* Batal mandiri: lookup sudah memverifikasi kontak, jadi tidak minta
              ulang — konfirmasi langsung. Stok kembali detik itu juga. */}
          {!adminView && isPending && !isExpired && !paymentCancelHidden(pay, isExpired) && (
            <div className="mt-3">
              {!confirmingCancel ? (
                <button
                  type="button"
                  onClick={() => { setConfirmingCancel(true); setCancelError(null); }}
                  className="flex h-11 w-full items-center justify-center whitespace-nowrap rounded-xl border border-red-400/20 bg-red-500/[0.06] px-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/[0.12]"
                >
                  {cancelCopy(order.locale).button}
                </button>
              ) : (
                <div className="rounded-2xl border border-red-400/20 bg-red-500/[0.06] p-4 text-left" role="dialog" aria-label={cancelCopy(order.locale).dialogLabel}>
                  <p className="text-sm font-semibold text-red-200">{cancelCopy(order.locale).title(order.code)}</p>
                  <p className="mt-1 text-xs leading-5 text-white/55">{cancelCopy(order.locale).body}</p>
                  {cancelError && <p role="alert" className="mt-2 text-xs text-red-300">{cancelError}</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => { setConfirmingCancel(false); setCancelError(null); }}
                      disabled={cancelling}
                      className="flex h-10 items-center justify-center rounded-xl border border-white/10 px-3 text-sm font-semibold text-white/60 transition hover:bg-white/5 disabled:opacity-50"
                    >
                      {cancelCopy(order.locale).back}
                    </button>
                    <button
                      type="button"
                      onClick={() => void cancelOrder()}
                      disabled={cancelling}
                      className="flex h-10 items-center justify-center rounded-xl bg-red-500 px-3 text-sm font-bold text-white transition hover:bg-red-400 disabled:opacity-50"
                    >
                      {cancelling ? cancelCopy(order.locale).cancelling : cancelCopy(order.locale).confirm}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="mt-3">
            <p className="text-center text-[11px] text-white/35">Butuh bantuan?</p>
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              <StoreWhatsAppLink message={`saya ingin menanyakan pesanan ${order.code} sebesar ${formatRupiah(payableAmount)}`} className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#25D366]/40 hover:bg-white/[0.06]"><img src="/brand/whatsapp-circle.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>WA Admin</span></StoreWhatsAppLink>
              <a href={supportTelegramLink()} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#2AABEE]/40 hover:bg-white/[0.06]"><img src="/brand/telegram.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>Telegram</span></a>
            </div>
          </div>
          {!adminView && <button type="button" onClick={() => { focusCodeNext.current = true; setOrder(null); setUpdatedAt(null); lastQuery.current = null; }} className="mt-4 inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-xs font-semibold text-white/45 underline decoration-white/20 underline-offset-4 hover:text-white">Lacak pesanan lain</button>}
          <p className="mt-3 text-center text-[11px] leading-5 text-white/35">Produk third-party AXVARA — simpan kode pesanan untuk klaim. Garansi berupa penggantian sesuai <Link prefetch={false} href="/garansi-replace" className="text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white">ketentuan garansi</Link>.</p>
        </div>
      )}

      <section className="mt-4 space-y-2" aria-label="Pertanyaan umum">
        {[
          ["Di mana saya menemukan kode pesanan?", "Setelah checkout kamu diarahkan ke halaman /pesanan/AXV-... Simpan kodenya. Order Telegram bisa dilihat lagi lewat /orders, order WA tercatat di grup."],
          ["PIN akses saya hilang?", "PIN 6 karakter hanya ada di email produk siap (cek inbox/spam). Status pesanan tetap bisa dilihat dengan kode + kontak checkout tanpa PIN."],
          ["Status Pending padahal sudah bayar QRIS?", "Tunggu 1–2 menit lalu halaman ini memeriksa ulang otomatis tiap 10 detik. Pastikan nominal tepat. Jika lebih dari 10 menit, hubungi admin dengan kode pesanan."],
          ["Status Pending setelah membayar dengan metode lain?", "Status diperbarui otomatis oleh sistem pembayaran. Waktu konfirmasi dapat berbeda menurut metode; jika belum berubah, hubungi admin dengan kode pesanan."],
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
