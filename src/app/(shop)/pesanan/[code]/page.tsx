"use client";

export const runtime = "edge";

import { AutomaticOrderProgress } from "@/components/storefront/AutomaticOrderProgress";
import type { AutomaticProgressItem } from "@/lib/warung-rebahan/progress";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatRupiah } from "@/lib/utils";
import { supportTelegramLink } from "@/lib/site";
import { WR_QUEUED_MAX_HOURS } from "@/lib/warung-rebahan/delivery-class";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";
import { settleLocalOrder } from "@/lib/local-orders";
import { WrCredentialsPanel } from "@/components/storefront/WrCredentialsPanel";
import { WarrantyClaimAccordion } from "@/components/storefront/WarrantyClaim";
import { MobileCollapsible } from "@/components/storefront/ProductCopy";
import { InlineSpinner, OrderStatusSkeleton } from "@/components/storefront/Skeletons";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { isPediaCode, pediaOrderUrl, redirectBrowser } from "@/components/pedia/status-view";
import { checkoutContactKey } from "@/components/storefront/WrCredentialsPanel";
import { GatewayPaymentPanel } from "@/components/storefront/GatewayPaymentPanel";
import { usePaymentConsent } from "@/hooks/usePaymentConsent";
import { parseExpiry } from "@/lib/expiry";
import { asPayLocale, cancelCopy, normalizePaymentView, orderPanelCopy, paymentCancelHidden, paymentHeading, type PayLocale, type PaymentView } from "@/lib/payment-ui";
import { orderCopy } from "@/lib/i18n/order-copy";
import { translateProductName } from "@/lib/i18n/product-name";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { ensureBuyerAccessSession, forgetBuyerAccessSession, isValidOrderContact, orderAccessHeaders, readOrderContact, rememberOrderContact } from "@/lib/order-access-client";

type QrisInvoice = {
  payable_amount: number;
  unique_code: number;
  image_url: string;
  expires_at: string;
  status: string;
};

type Order = {
  code: string;
  name: string;
  wa: string;
  email?: string | null;
  method: string;
  items: { name: string; price: number; qty: number }[];
  subtotal: number;
  status: string;
  qris?: QrisInvoice | null;
  expiresAt?: string;
  qrisReissueAllowed: boolean;
  /** true HANYA bila detail akun digital (WR) sudah siap diambil pembeli. */
  credentialsReady: boolean;
  /** true bila ada baris yang dikerjakan sesuai antrean (bukan kirim instan). */
  queuedDelivery: boolean;
  /** true bila SEMUA baris dikirim otomatis dari stok sendiri (selesai hitungan detik). */
  instantDelivery: boolean;
  /** true bila order ini milik pipeline supplier (WR/SK): kalimat manual/stok admin tidak berlaku. */
  supplierOwned: boolean;
  /** true bila link supplier masih berjalan (status vendor belum terminal). */
  supplierRunning: boolean;
  /** `failed` = lunas tetapi produk gagal dikirim otomatis. */
  fulfillmentStatus?: string | null;
  /** true bila order PIN6 baru butuh PIN untuk unlock kredensial; false = legacy kontak saja. */
  buyerPinRequired: boolean;
  automaticProgress?: AutomaticProgressItem[];
  uniqueUnitsProgress?: {ready:number;total:number};
  /** Tampilan aman non-QRIS dari server (gateway/crypto); null untuk QRIS/lama. */
  payment: PaymentView | null;
  /** Bahasa tersimpan di pesanan (id/en) untuk teks panel pembayaran. */
  locale: PayLocale;
};

function fromApi(value: Record<string, unknown>): Order {
  return {
    code: String(value.code),
    name: String(value.customer_name),
    wa: String(value.customer_wa),
    email: value.customer_email ? String(value.customer_email) : null,
    method: String(value.payment_method),
    items: (value.items || []) as Order["items"],
    subtotal: Number(value.subtotal),
    status: String(value.status),
    expiresAt: value.expires_at ? String(value.expires_at) : undefined,
    qrisReissueAllowed: value.qris_reissue_allowed === true,
    credentialsReady: value.credentials_ready === true,
    queuedDelivery: value.queued_delivery === true,
    instantDelivery: value.instant_delivery === true,
    supplierOwned: value.supplier_owned === true,
    supplierRunning: value.supplier_running === true,
    fulfillmentStatus: value.fulfillment_status ? String(value.fulfillment_status) : null,
    buyerPinRequired: value.buyer_pin_required !== false,
    automaticProgress: Array.isArray(value.automatic_progress) ? value.automatic_progress as AutomaticProgressItem[] : [],
    uniqueUnitsProgress: value.unique_units_progress as Order["uniqueUnitsProgress"],
    qris: value.qris as QrisInvoice | null | undefined,
    payment: normalizePaymentView(value.payment),
    locale: asPayLocale(value.locale),
  };
}

function countdown(expiresAt: string, now: number): string {
  // `expires_at` dari API bisa berupa SQL UTC tanpa offset ("2026-11-05 02:05:42", mis. pesanan gateway): wajib lewat parser kanonis (UTC), bukan Date.parse mentah (zona waktu browser).
  const seconds = Math.max(0, Math.floor(((parseExpiry(expiresAt) ?? now) - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// Kirim otomatis dari stok sendiri selesai 0–4 dtk setelah lunas (D1 produksi
// 2026-09-25), jadi dicek rapat dulu lalu melandai. 9 permintaan per ±30 dtk
// tetap di bawah orders:lookup 20/mnt walau bertemu sisa polling pending 5 dtk.
const INSTANT_POLL_DELAYS_MS = [2_000, 2_000, 2_000, 2_000, 2_000, 5_000, 5_000, 5_000, 5_000];
const SLOW_POLL_MS = 20_000;

/**
 * Salinan lokal checkout hanya dipakai sebagai tampilan sementara bila baru
 * dibuat (≤10 mnt), membawa QRIS dan expiry order valid — kasus redirect
 * checkout → halaman ini. Salinan lama tidak pernah diperbarui (bisa sudah
 * lunas/kedaluwarsa), jadi menampilkannya dulu = menyuruh bayar pesanan mati;
 * dulu juga memunculkan "Pesanan Diterima! Admin akan memverifikasi bukti".
 */
const LOCAL_FRESH_MS = 10 * 60_000;
function fromFreshLocal(value: Record<string, unknown> | undefined, now: number): Order | null {
  if (!value || value.status !== "pending") return null;
  const created = Date.parse(String(value.createdAt || ""));
  const qris = value.qris as Partial<QrisInvoice> | null | undefined;
  const expiresAt = parseExpiry(value.expiresAt);
  if (!Number.isFinite(created) || now - created > LOCAL_FRESH_MS || !qris?.image_url || !qris.expires_at || expiresAt === null || expiresAt <= now) return null;
  const subtotal = Number(value.subtotal) || 0;
  return {
    code: String(value.code),
    name: String(value.name ?? ""),
    wa: "",
    email: null,
    method: String(value.method ?? "qris"),
    items: Array.isArray(value.items) ? (value.items as Order["items"]) : [],
    subtotal,
    status: "pending",
    expiresAt: String(value.expiresAt),
    qris: {
      payable_amount: Number(qris.payable_amount) || subtotal,
      unique_code: Number(qris.unique_code) || 0,
      image_url: String(qris.image_url),
      expires_at: String(qris.expires_at),
      status: "pending",
    },
    qrisReissueAllowed: false,
    credentialsReady: false,
    buyerPinRequired: true,
    queuedDelivery: false,
    instantDelivery: false,
    supplierOwned: false,
    supplierRunning: false,
    fulfillmentStatus: null,
    payment: null,
    locale: "id",
  };
}

/** QR dengan placeholder berukuran tetap: tidak ada kotak putih kosong yang lalu melompat. */
function QrisImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const url = attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;
  return (
    <div className="mx-auto mt-2 min-h-[224px] w-[224px] max-w-full rounded-xl bg-white p-2.5 sm:min-h-[240px] sm:w-[240px]">
      <div className="relative aspect-square w-full">
        {state !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#080C1E]/[0.04] text-[#080C1E]/60" role="status">
            {state === "loading" ? (
              <><InlineSpinner className="h-7 w-7" tone="dark" /><span className="text-xs font-medium">Memuat QRIS…</span></>
            ) : (
              <>
                <span className="text-xs font-semibold text-[#080C1E]/80">QRIS gagal dimuat</span>
                <button type="button" onClick={() => { setState("loading"); setAttempt((n) => n + 1); }} className="h-9 rounded-xl bg-[#080C1E] px-4 text-xs font-bold text-white">Muat ulang QRIS</button>
              </>
            )}
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={url} src={url} alt={alt} onLoad={() => setState("ready")} onError={() => setState("error")} className={`h-full w-full rounded-xl object-contain transition-opacity duration-300 ${state === "ready" ? "opacity-100" : "opacity-0"}`} />
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  const { code } = useParams<{ code: string }>();
  const displayLocale = useDisplayLocale();
  const formCopy = orderCopy(displayLocale);
  // Kode AXP = pesanan Pedia: satu-satunya tampilan benar ada di host Pedia.
  // Dialihkan SEBELUM fetch apa pun; tidak ada kontak/token/PIN di URL.
  const isPedia = typeof code === "string" && isPediaCode(code);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [reissuing, setReissuing] = useState(false);
  const [reissueError, setReissueError] = useState<string | null>(null);
  const [instantSlow, setInstantSlow] = useState(false);
  // Status cek pembayaran manual: kapan terakhir server ditanya + apakah
  // pengecekan manual sedang berjalan. Tanpa ini pembeli QRIS pending hanya
  // melihat laman diam + countdown, tanpa tahu polling otomatis jalan.
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [checkingNow, setCheckingNow] = useState(false);
  // Batal mandiri (2026-10-11, keputusan owner): pembeli web yang berubah
  // pikiran / salah varian bisa melepas stoknya sendiri tanpa menunggu expiry
  // atau admin. Verifikasi kontak (WA/email checkout) — bukan sekadar kode.
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelContact, setCancelContact] = useState("");
  const polling = useRef(false);
  const buyerContact = useRef("");
  const [verifiedContact, setVerifiedContact] = useState("");
  const [contactInput, setContactInput] = useState("");
  const [needsAccess, setNeedsAccess] = useState(false);

  const fetchOrder = useCallback(async (wake = false, contactOverride = "") => {
    if (!code || typeof code !== "string" || isPediaCode(code)) return;
    // `wake=1` HANYA dari tombol manual: server membangunkan poller GoPay.
    // Status: invoice + kontak checkout, atau sesi status p1 dari lookup.
    const contact = contactOverride || buyerContact.current || readOrderContact(code);
    if (contact && isValidOrderContact(contact)) {
      buyerContact.current = contact.trim();
      setVerifiedContact(contact.trim());
      setCancelContact(contact.trim());
      try { await ensureBuyerAccessSession(code, contact.trim()); } catch { /* Kontak langsung tetap dicoba; sesi hanya optimasi polling. */ }
    }
    const response = await fetchWithTimeout(`/api/orders?code=${encodeURIComponent(code)}${wake ? "&wake=1" : ""}`, { cache: "no-store", headers: orderAccessHeaders(code, contact) }, 20_000);
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) {
      forgetBuyerAccessSession(code);
      setOrder(null);
      setNeedsAccess(body.reason === "access_required");
      setFetchError(body.reason === "access_required" ? "Isi No. WA atau email checkout untuk melihat pesanan ini." : null);
      return;
    }
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    setNeedsAccess(false);
    if (rememberOrderContact(code, contact)) buyerContact.current = contact.trim() || buyerContact.current;
    setOrder(fromApi(body.order));
    setFetchError(body.order?.qris_preparation_error ? "QRIS belum tersedia. Tunggu sebentar lalu coba lagi; pesanan yang sama tetap digunakan." : null);
    // Titik "belum dibayar" di tab Pesanan membaca salinan lokal; catat status
    // akhir begitu server tidak lagi pending.
    if (body.order?.status && body.order.status !== "pending") settleLocalOrder(code, String(body.order.status));
  }, [code]);

  // Poll berikutnya dilewati selama yang sebelumnya belum selesai: di jaringan
  // lambat interval 5 dtk dulu menumpuk permintaan dan memperparah antrean.
  const pollOrder = useCallback(async () => {
    if (document.hidden || polling.current) return;
    polling.current = true;
    try {
      await fetchOrder();
      setLastCheckedAt(Date.now());
    } finally { polling.current = false; }
  }, [fetchOrder]);

  /** Cek status pembayaran SEKARANG (tombol manual di QRIS pending). */
  const checkStatusNow = useCallback(async () => {
    if (checkingNow || polling.current) return;
    polling.current = true;
    setCheckingNow(true);
    setFetchError(null);
    try {
      await fetchOrder(true);
      setLastCheckedAt(Date.now());
      setNow(Date.now());
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Status terbaru gagal dimuat");
    } finally {
      polling.current = false;
      setCheckingNow(false);
    }
  }, [checkingNow, fetchOrder]);

  const resolveConsentContact = useCallback((input: string) => {
    let contact = (input || buyerContact.current || readOrderContact(String(code))).trim();
    if (!contact) { try { contact = (sessionStorage.getItem(checkoutContactKey(String(code))) || "").trim(); } catch { /* storage opsional */ } }
    return contact;
  }, [code]);
  const rememberConsentContact = useCallback((contact: string) => {
    rememberOrderContact(String(code), contact);
    buyerContact.current = contact;
    setVerifiedContact(contact);
  }, [code]);
  const refreshAfterConsent = useCallback(async () => { await fetchOrder(); setNow(Date.now()); }, [fetchOrder]);
  const consentHook = usePaymentConsent({ code: typeof code === "string" ? code : "", locale: order?.locale ?? "id", resolveContact: resolveConsentContact, refresh: refreshAfterConsent, onAccepted: rememberConsentContact });

  /** Minta QRIS baru untuk order yang masih hidup tetapi QR-nya sudah mati. */
  const requestNewQris = useCallback(async () => {
    if (!code || typeof code !== "string") return;
    setReissuing(true);
    setReissueError(null);
    try {
      const response = await fetch(`/api/payments/qris/${encodeURIComponent(code)}/reissue`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...orderAccessHeaders(code, buyerContact.current) },
        body: JSON.stringify({ contact: buyerContact.current || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Gagal menerbitkan QRIS baru.");
      // Ambil ulang order agar nominal + expiry + gambar QR yang tampil selalu
      // berasal dari server, bukan hasil tebakan klien.
      await fetchOrder();
      setNow(Date.now());
    } catch (error) {
      setReissueError(error instanceof Error ? error.message : "Gagal menerbitkan QRIS baru.");
    } finally {
      setReissuing(false);
    }
  }, [code, fetchOrder]);

  /** Batalkan pesanan sendiri: lepas stok detik itu juga, tanpa menunggu expiry. */
  const cancelOrder = useCallback(async () => {
    if (!code || typeof code !== "string" || cancelling) return;
    if (!cancelContact.trim() || !isValidOrderContact(cancelContact)) {
      setCancelError(cancelCopy(order?.locale).needContact);
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(code)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orderAccessHeaders(code) },
        body: JSON.stringify({ contact: cancelContact.trim() }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || cancelCopy(order?.locale).failed);
      setConfirmingCancel(false);
      setCancelContact("");
      await fetchOrder();
      setNow(Date.now());
    } catch (error) {
      setCancelError(error instanceof Error ? cancelCopy(order?.locale).serverError(error.message) : cancelCopy(order?.locale).failed);
    } finally {
      setCancelling(false);
    }
  }, [code, cancelling, cancelContact, fetchOrder, order?.locale]);

  useEffect(() => {
    if (typeof code === "string" && isPediaCode(code)) { redirectBrowser(pediaOrderUrl(code)); return; }
    setLoading(true);
    setFetchError(null);
    try {
      const all = JSON.parse(localStorage.getItem("axvara-orders") || "[]") as Record<string, unknown>[];
      const provisional = fromFreshLocal(Array.isArray(all) ? all.find((item) => item?.code === code) : undefined, Date.now());
      if (provisional) setOrder(provisional);
    } catch { /* Server state remains authoritative. */ }
    void fetchOrder()
      .catch((error) => setFetchError(error instanceof Error ? error.message : "Gagal memuat pesanan"))
      .finally(() => setLoading(false));
  }, [code, fetchOrder]);

  const orderStatus = order?.status;
  const isDynamicQris = Boolean(order?.qris);
  useEffect(() => {
    if (orderStatus !== "pending") return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const stop = () => { clearInterval(interval); interval = undefined; };
    const poll = () => {
      setNow(Date.now());
      void pollOrder().catch((error) => setFetchError(error instanceof Error ? error.message : "Status terbaru gagal dimuat"));
    };
    const start = (resume: boolean) => {
      if (document.hidden || interval !== undefined) return;
      if (resume) poll(); // Catch up immediately, without waking/reissuing the QR.
      interval = setInterval(poll, isDynamicQris ? 5_000 : 8_000);
    };
    const onVisibility = () => { if (document.hidden) stop(); else start(true); };
    start(false); // The initial page load already fetches the order.
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [orderStatus, isDynamicQris, pollOrder]);

  // Order lunas tetapi detail akun belum ada: periksa berkala supaya panel
  // muncul sendiri begitu fulfillment otomatis selesai — pembeli tidak perlu
  // reload manual. Kirim otomatis (stok sendiri ATAU supplier yang linknya
  // masih berjalan) dicek rapat dulu (INSTANT_POLL_DELAYS_MS); sesudahnya
  // tiap 20 dtk maksimal 30 kali (±10 mnt) agar tab yang ditinggal terbuka
  // tidak memukul endpoint selamanya. Setiap poll juga memicu tarikan
  // status vendor di server (gerbang 20 dtk), jadi WR muncul dalam hitungan
  // detik seperti SK — bukan menunggu cron.
  // Baris antrean non-supplier / yang diserahkan ke admin (maks 12 jam)
  // hanya dipoll sebentar: polling tidak mungkin menutup rentang belasan
  // jam, jadi kabarnya lewat email — 3 percobaan cukup.
  const credentialsReady = order?.credentialsReady === true;
  const queuedDelivery = order?.queuedDelivery === true;
  const fulfillmentStatus = order?.fulfillmentStatus ?? null;
  const instantDelivery = order?.instantDelivery === true;
  const supplierOwned = order?.supplierOwned === true;
  // Milik supplier TIDAK PERNAH "diserahkan ke admin" selama belum ada
  // keputusan terminal yang terlihat: vonis manual_required dari pipeline
  // generik adalah keadaan sesaat balapan bind, bukan keputusan handover.
  // Tanpa pagar ini order supplier sehat sempat tampil "Stok otomatis
  // habis" (SK) atau menunggu admin (WR) padahal vendor sudah COMPLETED.
  const supplierSending = supplierOwned && fulfillmentStatus !== "delivered" && fulfillmentStatus !== "failed";
  const handedToAdmin = !supplierSending && (queuedDelivery || (instantDelivery && fulfillmentStatus === "manual_required"));
  const instantSending = supplierSending
    || (instantDelivery && !supplierOwned && !["delivered", "manual_required", "failed"].includes(String(fulfillmentStatus)));
  const uniqueUnitsPending = Boolean(order?.uniqueUnitsProgress && order.uniqueUnitsProgress.ready < order.uniqueUnitsProgress.total);
  const automaticPending = order?.automaticProgress?.some(item => ["preparing", "queued", "running"].includes(item.stage)) === true;
  useEffect(() => {
    if (orderStatus !== "lunas" || (credentialsReady && !uniqueUnitsPending && !automaticPending)) return;
    const fast = instantSending ? INSTANT_POLL_DELAYS_MS : [];
    const maxAttempts = fast.length + (handedToAdmin ? 3 : 30);
    let attempts = 0;
    let cancelled = false;
    let checking = false;
    let wasHidden = document.hidden;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (cancelled || document.hidden || checking || attempts >= maxAttempts) return;
      if (fast.length > 0 && attempts >= fast.length) setInstantSlow(true);
      checking = true;
      attempts += 1;
      // Fulfillment polling failures stay silent; the order is already paid.
      void pollOrder().catch(() => undefined).finally(() => { checking = false; scheduleNext(); });
    };
    const scheduleNext = () => {
      if (cancelled || document.hidden || checking || timer !== undefined || attempts >= maxAttempts) return;
      if (fast.length > 0 && attempts === fast.length) setInstantSlow(true);
      timer = setTimeout(() => { timer = undefined; check(); }, fast[attempts] ?? SLOW_POLL_MS);
    };
    const onVisibility = () => {
      if (wasHidden === document.hidden) return;
      wasHidden = document.hidden;
      clearTimeout(timer); timer = undefined;
      if (!document.hidden) check(); // Hidden time never consumes/resets the retry budget.
    };
    scheduleNext();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [orderStatus, credentialsReady, uniqueUnitsPending, automaticPending, instantSending, handedToAdmin, pollOrder]);

  useEffect(() => {
    // Detak 1 dtk dibutuhkan semua hitung mundur tahap pending: QRIS DAN gateway/crypto.
    if (order?.status !== "pending" || (!order.qris && order.payment?.state !== "pending")) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [order?.qris, order?.payment?.state, order?.status]);

  if (isPedia || (loading && !order)) {
    return <OrderStatusSkeleton />;
  }
  if (needsAccess && !order) return <form className="mx-auto max-w-md space-y-4 px-4 py-12" onSubmit={(event) => {
    event.preventDefault();
    if (!isValidOrderContact(contactInput)) {
      setFetchError("Isi No. WA atau email checkout yang dipakai saat memesan.");
      return;
    }
    setLoading(true); void fetchOrder(false, contactInput.trim()).catch((error) => setFetchError(error instanceof Error ? error.message : "Pesanan belum dapat dimuat. Coba lagi.")).finally(() => setLoading(false));
  }}>
    <h1 className="text-xl font-bold text-white">{formCopy.access.title}</h1>
    <p className="text-sm leading-6 text-white/65">{formCopy.access.lead}</p>
    <label htmlFor="order-contact" className="block text-sm text-white/80">{formCopy.access.contactLabel}</label>
    <input id="order-contact" value={contactInput} onChange={event => setContactInput(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder={formCopy.access.contactPlaceholder} className="h-12 w-full rounded-xl border border-white/20 bg-white/5 px-4 text-white outline-none focus:border-[#00E5FF]" />
    <button type="submit" className="min-h-12 w-full rounded-xl bg-[#00E5FF] px-5 font-semibold text-[#080C1E]">{formCopy.access.submit}</button>
    {fetchError && <p role="alert" className="text-xs text-amber-200">{fetchError}</p>}
    <Link href="/lacak-pesanan" className="block text-sm text-[#00E5FF]">{formCopy.access.other}</Link>
  </form>;
  if (fetchError && !order) {
    return <div className="mx-auto max-w-[640px] px-4 py-16 text-center"><p className="text-sm text-red-300">{fetchError}</p><button onClick={() => location.reload()} className="mt-3 text-sm text-[#00E5FF]">{formCopy.common.retry}</button></div>;
  }
  if (!order) {
    return <div className="mx-auto max-w-[640px] px-4 py-16 text-center"><p className="text-white/60">{formCopy.access.notFound}</p><Link prefetch={false} href="/" className="mt-3 inline-block text-sm text-[#00E5FF]">{formCopy.access.home}</Link></div>;
  }

  const ui = orderCopy(order.locale);
  const isExpired = order.status === "kadaluarsa" || (order.status === "pending" && (parseExpiry(order.expiresAt) ?? -Infinity) <= now);
  const isPaid = order.status === "lunas";
  // QR bisa mati sementara ORDER masih hidup — dua masa berlaku yang berbeda.
  const qrisExpired = Boolean(order.qris) && (parseExpiry(order.qris?.expires_at) ?? -Infinity) <= now;
  // QRIS pending yang masih hidup = satu-satunya status yang ikon jamnya
  // berputar + tombol cek manual tampil (di bawah). Kedaluwarsa/dibatalkan
  // tetap statis agar tidak menjanjikan polling yang tidak ada.
  const isPendingQris = Boolean(order.qris) && order.status === "pending" && !isExpired && !qrisExpired;
  const isPreparingQris = order.method === "qris" && !order.qris && order.status === "pending" && !isExpired;
  // Lunas TAPI gagal kirim (audit ronde 4, W-H1). Halaman ini dibuka paling
  // sering pasca-bayar (redirect checkout), tetapi dulu tetap merayakan
  // "Pembayaran Dikonfirmasi 🎉 … diproses 5–15 menit" selamanya. Salinan
  // pola `/lacak-pesanan`, yang sudah benar sejak ronde 3.
  const isDeliveryFailed = isPaid && order.fulfillmentStatus === "failed";
  const isCancelled = order.status === "dibatalkan";
  // Non-QRIS (gateway/crypto): tampilan aman dari server menentukan judul, lencana
  // dan isi; tidak ada teks "admin memverifikasi bukti" dan tidak ada pengalihan metode.
  const pay = order.payment;
  const payExpired = Boolean(pay) && !isPaid && !isCancelled && (isExpired || pay?.state === "expired");
  const payHeading = !pay || isPaid || isCancelled ? null : paymentHeading(pay, order.locale, isExpired);
  const showPayPanel = Boolean(pay) && !isPaid && !isCancelled && !payExpired;
  // Header ringkas dipakai QRIS pending DAN gateway/crypto pending: hierarki satu
  // keluarga (ikon + judul + kode), tanpa ikon besar/h1 ganda/paragraf lead.
  const compactPayment = (Boolean(order.qris) && order.status === "pending" && !isExpired)
    || Boolean(pay && showPayPanel && pay.state === "pending");
  const compactSpinning = isPendingQris || Boolean(pay && showPayPanel && pay.state === "pending");
  const panelCopy = orderPanelCopy(order.locale);
  const compactTitle = order.qris
    ? panelCopy.title.qris
    : pay?.kind === "crypto"
      ? panelCopy.title.crypto
      : pay?.kind === "gateway"
        ? panelCopy.title.gateway(pay.label)
        : panelCopy.title.qris;
  const hideCancel = paymentCancelHidden(pay, isExpired);
  const contactKnown = Boolean(verifiedContact) || (() => { try { return isValidOrderContact(sessionStorage.getItem(checkoutContactKey(order.code)) || ""); } catch { return false; } })();
  const payableAmount = Number(order.qris?.payable_amount || (pay?.kind === "gateway" && pay.total !== null ? pay.total : order.subtotal));
  const statusVisual = isDeliveryFailed
    ? { icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
    : isPaid
    ? { icon: "/icons/ios11/checked-96.png", shell: "bg-emerald-500/15", filter: "brightness(0) saturate(100%) invert(65%) sepia(51%) saturate(717%) hue-rotate(90deg)" }
    : isCancelled
      ? { icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
      : { icon: "/icons/ios11/clock-96.png", shell: isExpired ? "bg-white/10" : "bg-[#FFB800]/15", filter: isExpired ? "brightness(0) invert(1) opacity(.55)" : "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" };

  // Isi blok pengiriman (lunas, detail akun belum ada). Urutan penting:
  // yang sudah terkirim tidak boleh lagi "diproses", dan kirim otomatis dari
  // stok sendiri tidak memakai estimasi 5–15 menit milik produk WR. Kabar web
  // lewat EMAIL (bot WA mati sejak 18 Sep 2026); nomor WA hanya disebut untuk
  // order lama tanpa email.
  // Copy 2026-10-02 (laporan owner + screenshot AXV-20261002-201B9EFD): 4 state
  // dengan judul + nada beda. Jalur otomatis TIDAK BOLEH menyebut admin/12 jam
  // — teks fallback darurat ("disiapkan admin") sempat bocor ke order instan
  // yang selesai hitungan detik dan bikin panik. MBO by design (bukan stok
  // habis) vs instan-gagal (baru pakai alasan stok) juga dibedakan.
  // Revisi sore 2026-10-02 (keputusan owner): fase instan-cepat (±30 dtk
  // pertama) TIDAK menampilkan teks sama sekali — hanya skeleton
  // `instantPreparing` di bawah — supaya tidak ada bacaan yang hilang
  // sepersekian detik kemudian saat panel kredensial muncul. Teks hanya keluar
  // bila memang ada yang perlu dibaca (B lambat / C1 / C2 / WR / delivered).
  const destination = order.email
    ? ui.delivery.destinationEmail(order.email)
    : ui.delivery.destinationWa(order.wa);
  // Copy 2026-10-07 (permintaan owner): pesanan otomatis tidak lagi dijanjikan
  // via WhatsApp/Telegram — detail dikirim ke email saat order + tampil di
  // halaman ini. Order lama tanpa email tetap fallback ke nomor WA tersamar.
  const toBuyer = order.email
    ? <>{ui.delivery.toBuyerEmail}</>
    : <>{ui.delivery.toBuyerWa(destination)}</>;
  let delivery: { title: string; lead: ReactNode; note: ReactNode; skeleton?: boolean };
  if (supplierSending && !instantSlow) {
    // Supplier masih memproses (link berjalan): skeleton menyiapkan yang
    // sama dengan stok sendiri — TIDAK ADA kalimat stok/admin/diproses,
    // karena status vendor bisa berubah detik berikutnya dan teks apa pun
    // akan terbaca sesat (insiden 2026-10-13: "Stok otomatis habis" pada
    // order SK sehat + "Diproses" pada WR yang sudah COMPLETED).
    delivery = {
      title: ui.delivery.preparingTitle,
      lead: null,
      note: null,
      skeleton: true,
    };
  } else if (supplierSending) {
    delivery = {
      title: ui.delivery.autoTitle,
      lead: order.email ? <>{ui.delivery.autoSlowEmail}</> : <>{ui.delivery.autoSlowWa(destination)}</>,
      note: <>{ui.delivery.autoNote}</>,
    };
  } else if (order.fulfillmentStatus === "delivered") {
    delivery = {
      title: ui.delivery.deliveredTitle,
      lead: order.email ? <>{ui.delivery.deliveredEmail}</> : <>{ui.delivery.deliveredWa(destination)}</>,
      note: <>{ui.delivery.deliveredNote(Boolean(order.email))}</>,
    };
  } else if (order.queuedDelivery && !supplierOwned && fulfillmentStatus !== "delivered") {
    // C1 — Made By Order NON-SUPPLIER yang sudah divonis antrean manual:
    // manual BY DESIGN, bukan stok habis. Order supplier tidak masuk sini:
    // kelasnya ditentukan status vendor, bukan tebakan kelas lokal.
    delivery = {
      title: ui.delivery.mboTitle,
      lead: <>{ui.delivery.mboLead(toBuyer)}</>,
      note: <>{ui.delivery.mboNote(WR_QUEUED_MAX_HOURS)}</>,
    };
  } else if (handedToAdmin && !supplierOwned) {
    // C2 — produk instan NON-SUPPLIER yang gagal dikirim otomatis (mis.
    // stok unik habis, secret shared belum dikonfigurasi, order web tanpa
    // email valid) dan admin menyerahkannya lewat "Kirim ke pembeli".
    // Kalimat "Stok otomatis habis, jadi..." HANYA benar di sini; untuk
    // order supplier kalimat itu sesat dan dilarang tampil.
    delivery = {
      title: ui.delivery.adminTitle,
      lead: <>{ui.delivery.adminLead(toBuyer)}</>,
      note: <>{ui.delivery.adminNote(WR_QUEUED_MAX_HOURS)}</>,
    };
  } else if (instantSending && !instantSlow) {
    // Fase menyiapkan (±30 dtk pertama): skeleton saja, tanpa teks pengiriman.
    // Bentuknya menyerupai panel "Detail Akun Digital" supaya peralihan
    // skeleton → panel tidak melompat dan tombol di bawahnya tidak naik-turun.
    delivery = {
      title: ui.delivery.preparingTitle,
      lead: null,
      note: null,
      skeleton: true,
    };
  } else if (instantSending) {
    delivery = {
      title: ui.delivery.autoTitle,
      lead: order.email ? <>{ui.delivery.autoSlowEmail}</> : <>{ui.delivery.autoSlowWa(destination)}</>,
      note: <>{ui.delivery.autoNote}</>,
    };
  } else if (supplierOwned) {
    // Supplier-owned tanpa link berjalan dan belum terkirim (mis. link
    // terminal gagal/dibatalkan vendor): jujur sedang disiapkan, tanpa
    // mengarang alasan stok maupun janji menit.
    delivery = {
      title: ui.delivery.deliveredTitle,
      lead: <>{ui.delivery.supplierPreparingLead(toBuyer)}</>,
      note: <>{ui.delivery.autoNote}</>,
    };
  } else if (order.queuedDelivery) {
    // Antrean non-supplier yang belum divonis manual_required (C1 varian
    // manual murni): tetap Made By Order seperti sebelumnya.
    delivery = {
      title: ui.delivery.mboTitle,
      lead: <>{ui.delivery.mboLead(toBuyer)}</>,
      note: <>{ui.delivery.mboNote(WR_QUEUED_MAX_HOURS)}</>,
    };
  } else {
    delivery = {
      title: ui.delivery.processingTitle,
      lead: <>{ui.delivery.processingLead(toBuyer)}</>,
      note: <>{ui.delivery.processingNote}</>,
    };
  }

  // Chrome ringkasan/footer mengikuti locale PESANAN tersimpan (bukan preferensi global).
  const cc = cancelCopy(order.locale);
  const oc = ui.delivery;

  const summaryContent = <>
    <div className="space-y-2">{order.items.map((item, index) => <div key={index} className="flex justify-between gap-3 text-[13px] leading-5"><span className="min-w-0 break-words text-white/70">{translateProductName(item.name, order.locale)} × {item.qty}</span><span className="shrink-0 whitespace-nowrap font-medium text-white">{formatRupiah(item.price * item.qty)}</span></div>)}</div>
    <div className="mt-3 flex justify-between gap-3 border-t border-white/10 pt-3"><span className="text-sm text-white/60">{pay?.kind === "crypto" ? oc.orderTotal : oc.total} • {pay?.label || order.method.toUpperCase()}</span><span className="shrink-0 font-bold text-white">{formatRupiah(payableAmount)}</span></div>
  </>;

  return (
    <div className={`mx-auto px-4 sm:px-6 ${compactPayment ? "max-w-[760px] py-4 sm:py-6" : "max-w-[640px] py-10"}`}>
      <div className={`ax-glass-card text-center ${compactPayment ? "rounded-2xl p-4 sm:p-5" : "rounded-[28px] p-6 sm:p-8"}`}>
        {compactPayment ? (
          <div className="grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-2 text-center sm:grid-cols-[40px_auto_40px] sm:justify-center sm:gap-3">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${statusVisual.shell}`}>
              <span className={compactSpinning ? "animate-[spin_3s_linear_infinite]" : undefined} role={compactSpinning ? "status" : undefined} aria-label={compactSpinning ? "Menunggu pembayaran — memeriksa otomatis" : undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={statusVisual.icon} alt="" width={22} height={22} className="h-[22px] w-[22px] object-contain" style={{ filter: statusVisual.filter }} draggable={false} />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                <h1 className="font-display text-base font-bold leading-6 text-white sm:text-lg">{compactTitle}</h1>
                {qrisExpired && <span className="rounded-full border border-[#FFB800]/20 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FFB800]">{ui.qris.expiredBadge}</span>}
              </div>
              <p className="mt-1 break-all font-mono text-[11px] font-semibold tracking-[0.04em] text-[#00E5FF]">{order.code}</p>
            </div>
          </div>
        ) : <>
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${statusVisual.shell}`}>
          {isPendingQris ? (
            <span className="animate-[spin_3s_linear_infinite]" role="status" aria-label="Menunggu pembayaran — memeriksa otomatis">
              <img src={statusVisual.icon} alt="" width={32} height={32} className="h-8 w-8 object-contain" style={{ filter: statusVisual.filter }} draggable={false} />
            </span>
          ) : (
            <img src={statusVisual.icon} alt="" width={32} height={32} className="h-8 w-8 object-contain" style={{ filter: statusVisual.filter }} draggable={false} />
          )}
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold text-white">{payHeading ? payHeading.h1 : isDeliveryFailed ? ui.status.deliveryFailedTitle : isPaid ? ui.status.paidTitle : isCancelled ? ui.status.cancelledTitle : isExpired ? ui.status.expiredTitle : isPreparingQris ? ui.qris.notReady : order.qris ? ui.qris.heading : ui.status.receivedTitle}</h1>
        <p className="mt-2 font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]">{order.code}</p>
        {isDeliveryFailed ? (
          <span className="mt-3 inline-flex rounded-full border border-red-500/25 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300">{ui.status.deliveryFailedBadge}</span>
        ) : isPaid ? (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/20 bg-[#22C55E]/15 px-3 py-1.5 text-xs font-semibold text-[#22C55E]">{ui.status.paidBadge}</span>
        ) : isCancelled ? (
          <span className="mt-3 inline-flex rounded-full border border-red-500/20 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300">{ui.status.cancelledBadge}</span>
        ) : payHeading ? (
          <span className={`mt-3 inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${payHeading.tone === "pending" ? "border-[#FFB800]/20 bg-[#FFB800]/15 text-[#FFB800]" : payHeading.tone === "review" ? "border-[#FFB800]/30 bg-[#FFB800]/10 text-[#FFD66B]" : payHeading.tone === "info" ? "border-[#00E5FF]/25 bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/10 bg-white/10 text-white/60"}`}>{payHeading.badge}</span>
        ) : isExpired ? (
          <span className="mt-3 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/50">{ui.status.expiredBadge}</span>
        ) : (
          <span className="mt-3 inline-flex rounded-full border border-[#FFB800]/20 bg-[#FFB800]/15 px-3 py-1.5 text-xs font-semibold text-[#FFB800]">{ui.status.pendingBadge}</span>
        )}

        <p className="mt-4 text-sm leading-6 text-white/60">
          {isDeliveryFailed
            ? ui.status.deliveryFailedLead(order.name)
            : isPaid
            ? ui.status.paidLead(order.name)
            : isCancelled
              ? <>{ui.status.cancelledLead}</>
              : payHeading
                ? <>{payHeading.lead}</>
              : isExpired
                ? <>{ui.status.expiredLead}</>
                : isPreparingQris
                  ? <>{ui.qris.preparingLead}</>
                : order.qris && qrisExpired
                  ? <>{ui.status.qrisExpiredLead}</>
                  : order.qris
                  ? ui.status.qrisLead()
                  : ui.status.receivedLead(order.name)}
        </p>
        </>}

        {pay && showPayPanel && (
          <GatewayPaymentPanel
            payment={pay}
            locale={order.locale}
            now={now}
            checking={checkingNow}
            onCheck={checkStatusNow}
            contactKnown={contactKnown}
            consent={{ busy: consentHook.busy, error: consentHook.error, stale: consentHook.stale, onApprove: (total, contact) => void consentHook.approve(total, contact) }}
          />
        )}

        {isPreparingQris && (
          <div className="mt-5">
            <button type="button" onClick={checkStatusNow} disabled={checkingNow}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#00E5FF] px-5 text-sm font-bold text-[#080C1E] disabled:opacity-50">
              {checkingNow && <InlineSpinner tone="dark" />}
              {checkingNow ? ui.qris.preparing : ui.qris.prepare}
            </button>
          </div>
        )}

        {order.qris && order.status === "pending" && !isExpired && (
          <section className="mt-3 rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-3 sm:p-4" aria-label="QRIS dinamis">
            {qrisExpired ? (
              // QR mati tetapi ORDER masih hidup: pembeli bisa minta QR baru
              // tanpa mengulang alur. Sebelumnya order ikut mati bersama QR
              // sehingga keranjang/varian harus dipilih lagi dari nol.
              <div className="py-2">
                <p className="font-display text-base font-bold text-white">{ui.qris.expiredTitle}</p>
                <p className="mx-auto mt-2 max-w-[360px] text-xs leading-relaxed text-white/55">
                  {order.qrisReissueAllowed ? ui.qris.expiredReissue : ui.qris.expiredNoReissue}
                </p>
                {order.qrisReissueAllowed && <button
                  type="button"
                  onClick={requestNewQris}
                  disabled={reissuing}
                  className="mt-4 inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-xl bg-[#00E5FF] px-5 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8] disabled:opacity-50"
                >
                  {reissuing && <InlineSpinner tone="dark" />}
                  {reissuing ? ui.qris.reissuing : ui.qris.reissue}
                </button>}
                {reissueError && (
                  <p role="alert" className="mt-3 text-xs text-amber-200">{reissueError}</p>
                )}
              </div>
            ) : (
              <div className="grid items-center gap-3 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-5">
                <div className="min-w-0 sm:h-[290px]">
                <p className="text-xs font-semibold text-white/80">{ui.qris.scan}</p>
                {/* key: QR terbitan ulang memakai URL yang sama, jadi status muat direset lewat expires_at. */}
                <QrisImage key={`${order.qris.image_url}|${order.qris.expires_at}`} src={order.qris.image_url} alt={`QRIS dinamis pesanan ${order.code}`} />
                <div className="mt-2 flex items-center justify-center gap-1.5" aria-label="QRIS National Payment Standard">
                  <img src="/brand/qris.svg" alt="Logo QRIS resmi" width={48} height={18} className="h-[18px] w-auto object-contain" draggable={false} />
                  <span className="text-[9px] text-white/55">National Payment Standard</span>
                </div>
                </div>
                <div className="min-w-0">
                <span className="mb-2 inline-flex rounded-full border border-[#FFB800]/20 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FFB800]">{ui.qris.pending}</span>
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/65">{ui.qris.totalPay}</p>
                <p className="font-display text-2xl font-bold leading-8 text-white">{formatRupiah(payableAmount)}</p>
                <p className="text-[11px] text-white/50">{ui.qris.uniqueIncluded(String(order.qris.unique_code))}</p>
                <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-[#FFB800]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FFB800]" />{ui.qris.validFor(countdown(order.qris.expires_at, now))}</div>
                <p className="mt-1 text-[11px] text-white/50">{ui.qris.payExact}</p>
                {/* Status polling otomatis + cek manual: QRIS pending dulu hanya
                    menampilkan laman diam + countdown — pembeli tidak tahu
                    halaman memeriksa sendiri tiap 5 dtk, dan tidak ada jalan
                    saat ingin memastikan sekarang. */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <a href={order.qris.image_url} download={`AXVARA-${order.code}-QRIS.png`} className="inline-flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-xl border border-white/15 px-2 text-xs font-semibold text-white/75 hover:bg-white/10">{ui.qris.saveQris}</a>
                  <button
                    type="button"
                    onClick={checkStatusNow}
                    disabled={checkingNow}
                    className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-[#00E5FF]/30 bg-[#00E5FF]/10 px-2 text-xs font-bold text-[#00E5FF] transition hover:bg-[#00E5FF]/20 disabled:opacity-50"
                  >
                    {checkingNow && <InlineSpinner />}
                    {checkingNow ? ui.qris.checking : ui.qris.check}
                  </button>
                </div>
                <p className="mt-2 flex items-center justify-center gap-1.5 text-[10px] leading-4 text-white/50" aria-live="polite">
                  <InlineSpinner className="h-3 w-3 shrink-0" />
                  <span>{ui.qris.autoCheck}{lastCheckedAt && <span className="sr-only">{` • ${ui.qris.lastChecked(new Date(lastCheckedAt).toLocaleTimeString(order.locale === "en" ? "en-US" : "id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}`}</span>}</span>
                </p>
                </div>
              </div>
            )}
          </section>
        )}

        {fetchError && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-200">Status terbaru belum dapat diperiksa: {fetchError}</div>}

        {compactPayment ? (
          <div className="mt-3 text-left"><MobileCollapsible title={oc.summary} meta={oc.products(order.items.length)}>{summaryContent}</MobileCollapsible></div>
        ) : <div className="ax-glass-card mt-6 rounded-2xl p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{oc.summary}</p>
          <div className="mt-3">{summaryContent}</div>
        </div>}

        {isDeliveryFailed && (
          <section className="mt-6 rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-4 text-left" aria-label="Pengiriman bermasalah">
            <p className="text-sm font-semibold text-red-200">{ui.delivery.failedTitle}</p>
            <p className="mt-1 text-xs leading-5 text-white/60">
              {ui.delivery.failedBody}
            </p>
          </section>
        )}

        {isPaid && Boolean(order.automaticProgress?.length) && <AutomaticOrderProgress items={order.automaticProgress!} locale={order.locale} />}

        {isPaid && (order.buyerPinRequired || order.credentialsReady) && <WrCredentialsPanel key={order.code} code={order.code} prefillContact={verifiedContact} buyerPinRequired={order.buyerPinRequired} credentialsReady={order.credentialsReady} deliveryProgress={order.uniqueUnitsProgress} contactHint={[order.wa, order.email].filter(Boolean).join(" · ")} locale={order.locale} />}
        {isPaid && !order.credentialsReady && !isDeliveryFailed && !order.automaticProgress?.length && (
          // Detail akun belum/tidak pernah ada: jangan tampilkan form verifikasi
          // yang pasti gagal. Beri kepastian ke mana produk dikirim, dan JANGAN
          // janji menit untuk baris antrean — plafonnya 12 jam (keputusan owner
          // 2026-09-18). Teksnya dipilih di `delivery` di atas.
          <section className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label={delivery.title} aria-live="polite" aria-busy={delivery.skeleton === true}>
            {delivery.skeleton ? (
              <>
                <span role="status" className="sr-only">{delivery.title}…</span>
                <div aria-hidden className="ax-skeleton h-3 w-40 rounded-full" />
                <div aria-hidden className="mt-3 space-y-2">
                  <div className="ax-skeleton h-4 w-full rounded-full" />
                  <div className="ax-skeleton h-4 w-[85%] rounded-full" />
                  <div className="ax-skeleton h-10 w-full rounded-xl" />
                </div>
                <p className="mt-3 flex items-center gap-2 text-[11px] text-white/65"><InlineSpinner className="h-3 w-3" />{ui.delivery.preparingStatus}</p>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{delivery.title}</p>
                <p className="mt-2 text-xs leading-5 text-white/55">{delivery.lead}</p>
                <p className="mt-2 text-[11px] leading-5 text-white/65">{delivery.note}</p>
              </>
            )}
          </section>
        )}

        {isPaid && !order.credentialsReady && <WarrantyClaimAccordion code={code} locale={order.locale} />}

        {!compactPayment && <div className="mt-6 grid grid-cols-2 gap-2.5">
          <Link prefetch={false} href="/lacak-pesanan" className="ax-glass-card flex h-11 items-center justify-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-white hover:bg-white/10">{oc.track}</Link>
          <Link prefetch={false} href="/" className="ax-glass-card flex h-11 items-center justify-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-white hover:bg-white/10">{oc.shop}</Link>
        </div>}
        {/* Batal mandiri: hanya saat masih pending. Lunas/kadaluarsa/dibatalkan
            tidak punya tombol ini. Konfirmasi + verifikasi kontak agar penebak
            kode tidak bisa mengunci/membatalkan pesanan orang lain. */}
        {order.status === "pending" && !isExpired && !payExpired && !hideCancel && (
          <div className="mt-3">
            {!confirmingCancel ? (
              <div className={compactPayment ? "grid grid-cols-2 gap-2.5" : undefined}>
              {compactPayment && <Link prefetch={false} href="/" className="flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.03] px-2 text-[11px] font-medium text-white/60 transition hover:bg-white/[0.06] sm:text-xs">{oc.shop}</Link>}
              <button
                type="button"
                onClick={() => { setConfirmingCancel(true); setCancelError(null); }}
                className={compactPayment ? "flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-xl border border-red-400/15 bg-red-500/[0.04] px-2 text-[11px] font-medium text-red-200/80 transition hover:bg-red-500/[0.08] sm:text-xs" : "flex h-11 w-full items-center justify-center whitespace-nowrap rounded-xl border border-red-400/20 bg-red-500/[0.06] px-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/[0.12]"}
              >
                {compactPayment ? cc.buttonCompact : cc.button}
              </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/[0.06] p-4 text-left" role="dialog" aria-label={cc.dialogLabel}>
                <p className="text-sm font-semibold text-red-200">{cc.title(order.code)}</p>
                <p className="mt-1 text-xs leading-5 text-white/55">{cc.body}</p>
                <label htmlFor="cancel-contact" className="mt-3 block text-xs font-medium text-white/60">{cc.contactLabel}</label>
                <input
                  id="cancel-contact"
                  value={cancelContact}
                  onChange={(event) => setCancelContact(event.target.value)}
                  placeholder={cc.contactPlaceholder}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white placeholder:text-white/55 focus:border-red-400/40 focus:outline-none"
                />
                {cancelError && <p role="alert" className="mt-2 text-xs text-red-300">{cancelError}</p>}
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => { setConfirmingCancel(false); setCancelError(null); }}
                    disabled={cancelling}
                    className="flex h-10 items-center justify-center rounded-xl border border-white/10 px-3 text-sm font-semibold text-white/60 transition hover:bg-white/5 disabled:opacity-50"
                  >
                    {cc.back}
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelOrder()}
                    disabled={cancelling}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl bg-red-500 px-3 text-sm font-bold text-white transition hover:bg-red-400 disabled:opacity-50"
                  >
                    {cancelling && <InlineSpinner />}
                    {cancelling ? cc.cancelling : cc.confirm}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <div className={compactPayment ? "mt-4 border-t border-white/10 pt-3" : "mt-3"}>
          <p className="text-center text-[11px] text-white/65">{oc.help}</p>
          <div className={compactPayment ? "mt-2 flex items-center justify-center gap-3" : "mt-2 grid grid-cols-2 gap-2.5"}>
            <StoreWhatsAppLink message={`saya ingin menanyakan pesanan ${order.code} sebesar ${formatRupiah(payableAmount)}`} className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#25D366]/40 hover:bg-white/[0.06]"><img src="/brand/whatsapp-circle.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>WA Admin</span></StoreWhatsAppLink>
            <a href={supportTelegramLink()} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#2AABEE]/40 hover:bg-white/[0.06]"><img src="/brand/telegram.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>Telegram</span></a>
          </div>
        </div>

        <p className={`${compactPayment ? "mt-1 text-[10px] leading-4" : "mt-4 text-[11px] leading-5"} text-center text-white/65`}>{oc.note}<Link prefetch={false} href="/garansi-replace" className="text-white/65 underline decoration-white/20 underline-offset-2 hover:text-white">{oc.terms}</Link>.</p>
      </div>
    </div>
  );
}
