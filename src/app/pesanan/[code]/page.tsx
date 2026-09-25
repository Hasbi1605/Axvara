"use client";

export const runtime = "edge";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatRupiah } from "@/lib/utils";
import { supportTelegramLink } from "@/lib/site";
import { WR_QUEUED_MAX_HOURS } from "@/lib/warung-rebahan/delivery-class";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";
import { settleLocalOrder } from "@/lib/local-orders";
import { WrCredentialsPanel } from "@/components/storefront/WrCredentialsPanel";
import { InlineSpinner, OrderStatusSkeleton } from "@/components/storefront/Skeletons";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

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
  /** `failed` = lunas tetapi produk gagal dikirim otomatis. */
  fulfillmentStatus?: string | null;
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
    fulfillmentStatus: value.fulfillment_status ? String(value.fulfillment_status) : null,
    qris: value.qris as QrisInvoice | null | undefined,
  };
}

function countdown(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
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
 * dibuat (≤10 mnt) DAN membawa QRIS dari respons create — kasus redirect
 * checkout → halaman ini. Salinan lama tidak pernah diperbarui (bisa sudah
 * lunas/kedaluwarsa), jadi menampilkannya dulu = menyuruh bayar pesanan mati;
 * dulu juga memunculkan "Pesanan Diterima! Admin akan memverifikasi bukti".
 */
const LOCAL_FRESH_MS = 10 * 60_000;
function fromFreshLocal(value: Record<string, unknown> | undefined, now: number): Order | null {
  if (!value || value.status !== "pending") return null;
  const created = Date.parse(String(value.createdAt || ""));
  const qris = value.qris as Partial<QrisInvoice> | null | undefined;
  if (!Number.isFinite(created) || now - created > LOCAL_FRESH_MS || !qris?.image_url || !qris.expires_at) return null;
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
    qris: {
      payable_amount: Number(qris.payable_amount) || subtotal,
      unique_code: Number(qris.unique_code) || 0,
      image_url: String(qris.image_url),
      expires_at: String(qris.expires_at),
      status: "pending",
    },
    qrisReissueAllowed: false,
    credentialsReady: false,
    queuedDelivery: false,
    instantDelivery: false,
    fulfillmentStatus: null,
  };
}

/** QR dengan placeholder berukuran tetap: tidak ada kotak putih kosong yang lalu melompat. */
function QrisImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const url = attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;
  return (
    <div className="mx-auto mt-3 max-w-[330px] rounded-2xl bg-white p-3">
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
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [reissuing, setReissuing] = useState(false);
  const [reissueError, setReissueError] = useState<string | null>(null);
  const [instantSlow, setInstantSlow] = useState(false);
  const polling = useRef(false);

  const fetchOrder = useCallback(async () => {
    if (!code || typeof code !== "string") return;
    const response = await fetchWithTimeout(`/api/orders?code=${encodeURIComponent(code)}`, { cache: "no-store" }, 20_000);
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) {
      setOrder(null);
      setFetchError(null);
      return;
    }
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    setOrder(fromApi(body.order));
    setFetchError(null);
    // Titik "belum dibayar" di tab Pesanan membaca salinan lokal; catat status
    // akhir begitu server tidak lagi pending.
    if (body.order?.status && body.order.status !== "pending") settleLocalOrder(code, String(body.order.status));
  }, [code]);

  // Poll berikutnya dilewati selama yang sebelumnya belum selesai: di jaringan
  // lambat interval 5 dtk dulu menumpuk permintaan dan memperparah antrean.
  const pollOrder = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try { await fetchOrder(); } finally { polling.current = false; }
  }, [fetchOrder]);

  /** Minta QRIS baru untuk order yang masih hidup tetapi QR-nya sudah mati. */
  const requestNewQris = useCallback(async () => {
    if (!code || typeof code !== "string") return;
    setReissuing(true);
    setReissueError(null);
    try {
      const response = await fetch(`/api/payments/qris/${encodeURIComponent(code)}/reissue`, {
        method: "POST",
        cache: "no-store",
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

  useEffect(() => {
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
    const interval = setInterval(() => {
      setNow(Date.now());
      void pollOrder().catch((error) => setFetchError(error instanceof Error ? error.message : "Status terbaru gagal dimuat"));
    }, isDynamicQris ? 5_000 : 30_000);
    return () => clearInterval(interval);
  }, [orderStatus, isDynamicQris, pollOrder]);

  // Order lunas tetapi detail akun belum ada: periksa berkala supaya panel
  // muncul sendiri begitu fulfillment otomatis selesai — pembeli tidak perlu
  // reload manual. Kirim otomatis dari stok sendiri dicek rapat dulu
  // (INSTANT_POLL_DELAYS_MS); sesudahnya tiap 20 dtk maksimal 30 kali (±10 mnt)
  // agar tab yang ditinggal terbuka tidak memukul endpoint selamanya.
  // Baris antrean / yang diserahkan ke admin (maks 12 jam) hanya dipoll
  // sebentar: polling tidak mungkin menutup rentang belasan jam, jadi kabarnya
  // lewat email — 3 percobaan cukup untuk kasus "ternyata cepat".
  const credentialsReady = order?.credentialsReady === true;
  const queuedDelivery = order?.queuedDelivery === true;
  const fulfillmentStatus = order?.fulfillmentStatus ?? null;
  const instantDelivery = order?.instantDelivery === true;
  const handedToAdmin = queuedDelivery || (instantDelivery && fulfillmentStatus === "manual_required");
  const instantSending = instantDelivery && !["delivered", "manual_required", "failed"].includes(String(fulfillmentStatus));
  useEffect(() => {
    if (orderStatus !== "lunas" || credentialsReady) return;
    const fast = instantSending ? INSTANT_POLL_DELAYS_MS : [];
    const maxAttempts = fast.length + (handedToAdmin ? 3 : 30);
    let attempts = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = () => {
      if (cancelled || attempts >= maxAttempts) return;
      if (fast.length > 0 && attempts === fast.length) setInstantSlow(true);
      timer = setTimeout(() => {
        attempts += 1;
        // Diam-diam saja: kegagalan poll di sini bukan error yang perlu
        // ditampilkan, status utama sudah "Lunas".
        void pollOrder().catch(() => undefined).finally(scheduleNext);
      }, fast[attempts] ?? SLOW_POLL_MS);
    };
    scheduleNext();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderStatus, credentialsReady, instantSending, handedToAdmin, pollOrder]);

  useEffect(() => {
    if (!order?.qris || order.status !== "pending") return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [order?.qris, order?.status]);

  if (loading && !order) {
    return <OrderStatusSkeleton />;
  }
  if (fetchError && !order) {
    return <div className="mx-auto max-w-[640px] px-4 py-16 text-center"><p className="text-sm text-red-300">{fetchError}</p><button onClick={() => location.reload()} className="mt-3 text-sm text-[#00E5FF]">Coba lagi</button></div>;
  }
  if (!order) {
    return <div className="mx-auto max-w-[640px] px-4 py-16 text-center"><p className="text-white/60">Pesanan tidak ditemukan</p><Link href="/" className="mt-3 inline-block text-sm text-[#00E5FF]">Kembali ke beranda</Link></div>;
  }

  const isExpired = order.status === "kadaluarsa" || (order.status === "pending" && Boolean(order.expiresAt) && Date.parse(order.expiresAt!) <= now);
  const isPaid = order.status === "lunas";
  // Lunas TAPI gagal kirim (audit ronde 4, W-H1). Halaman ini dibuka paling
  // sering pasca-bayar (redirect checkout), tetapi dulu tetap merayakan
  // "Pembayaran Dikonfirmasi 🎉 … diproses 5–15 menit" selamanya. Salinan
  // pola `/lacak-pesanan`, yang sudah benar sejak ronde 3.
  const isDeliveryFailed = isPaid && order.fulfillmentStatus === "failed";
  const isCancelled = order.status === "dibatalkan";
  const payableAmount = Number(order.qris?.payable_amount || order.subtotal);
  // QR bisa mati sementara ORDER masih hidup — dua masa berlaku yang berbeda.
  const qrisExpired = Boolean(order.qris) && Date.parse(String(order.qris?.expires_at)) <= now;
  const statusVisual = isDeliveryFailed
    ? { icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
    : isPaid
    ? { icon: "/icons/ios11/checked-96.png", shell: "bg-emerald-500/15", filter: "brightness(0) saturate(100%) invert(65%) sepia(51%) saturate(717%) hue-rotate(90deg)" }
    : isCancelled
      ? { icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
      : { icon: "/icons/ios11/clock-96.png", shell: isExpired ? "bg-white/10" : "bg-[#FFB800]/15", filter: isExpired ? "brightness(0) invert(1) opacity(.55)" : "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" };

  // Isi blok "Pengiriman Produk" (lunas, detail akun belum ada). Urutan penting:
  // yang sudah terkirim tidak boleh lagi "diproses", dan kirim otomatis dari
  // stok sendiri tidak memakai estimasi 5–15 menit milik produk WR. Kabar web
  // lewat EMAIL (bot WA mati sejak 18 Sep 2026); nomor WA hanya disebut untuk
  // order lama tanpa email.
  const destination = order.email
    ? <>email <span className="font-medium text-white/80">{order.email}</span></>
    : <>WhatsApp <span className="font-medium text-white/80">{order.wa}</span></>;
  const toBuyer = <>Detail produk dikirim ke {destination} yang kamu masukkan saat checkout, dan tampil di halaman ini.</>;
  let delivery: { lead: ReactNode; note: ReactNode; sending?: boolean };
  if (order.fulfillmentStatus === "delivered") {
    delivery = {
      lead: <>Produk sudah dikirim ke {destination} yang kamu masukkan saat checkout.</>,
      note: <>{order.email ? "Belum masuk? Cek juga folder spam atau promosi. " : ""}Kalau tetap belum ada, hubungi admin lewat tombol di bawah dengan menyebut kode pesanan.</>,
    };
  } else if (order.queuedDelivery) {
    delivery = {
      lead: <>Pesanan <span className="font-medium text-[#FFD66B]">Made By Order</span> — disiapkan admin setelah pembayaran masuk. {toBuyer}</>,
      note: <>Umumnya lebih cepat, maksimal {WR_QUEUED_MAX_HOURS} jam pada jam layanan. Tidak perlu menunggu halaman ini terbuka — kami kabari lewat kontak di atas, dan detailnya juga tampil di sini saat kamu buka lagi.</>,
    };
  } else if (handedToAdmin) {
    // Kirim otomatis tidak bisa diselesaikan sistem (mis. stok unik habis) dan
    // admin menyerahkannya lewat "Kirim ke pembeli": plafonnya sama dengan antrean.
    delivery = {
      lead: <>Produkmu sedang disiapkan admin. {toBuyer}</>,
      note: <>Umumnya lebih cepat, maksimal {WR_QUEUED_MAX_HOURS} jam pada jam layanan. Kami kabari lewat kontak di atas, dan detailnya juga tampil di sini saat kamu buka lagi.</>,
    };
  } else if (instantSending && !instantSlow) {
    delivery = {
      sending: true,
      lead: <><span className="font-medium text-white/80">Mengirim produkmu…</span> Detail produk tampil di sini dan dikirim ke {destination} yang kamu masukkan saat checkout.</>,
      note: <>Biasanya hanya beberapa detik. Tidak perlu memuat ulang halaman.</>,
    };
  } else if (instantSending) {
    delivery = {
      lead: <>Pengiriman butuh waktu lebih lama dari biasanya. {toBuyer}</>,
      note: <>Halaman ini terus memeriksa sendiri. Kalau belum ada kabar dalam beberapa menit, hubungi admin lewat tombol di bawah dengan menyebut kode pesanan.</>,
    };
  } else {
    delivery = {
      lead: <>Pesanan sedang diproses. {toBuyer}</>,
      note: <>Estimasi 5–15 menit pada jam layanan. Halaman ini memeriksa sendiri, jadi detail akan tampil otomatis di sini kalau produknya terkirim instan.</>,
    };
  }

  return (
    <div className="mx-auto max-w-[640px] px-4 py-10 sm:px-6">
      <div className="ax-glass-card rounded-[28px] p-6 text-center sm:p-8">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${statusVisual.shell}`}>
          <img src={statusVisual.icon} alt="" width={32} height={32} className="h-8 w-8 object-contain" style={{ filter: statusVisual.filter }} draggable={false} />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold text-white">{isDeliveryFailed ? "Pengiriman Produk Bermasalah" : isPaid ? "Pembayaran Dikonfirmasi! 🎉" : isCancelled ? "Pesanan Dibatalkan" : isExpired ? "Pesanan Kedaluwarsa" : order.qris ? "Selesaikan Pembayaran QRIS" : "Pesanan Diterima!"}</h1>
        <p className="mt-2 font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]">{order.code}</p>
        {isDeliveryFailed ? (
          <span className="mt-3 inline-flex rounded-full border border-red-500/25 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300">Lunas — Perlu Bantuan</span>
        ) : isPaid ? (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/20 bg-[#22C55E]/15 px-3 py-1.5 text-xs font-semibold text-[#22C55E]">Lunas — Terdeteksi Otomatis</span>
        ) : isCancelled ? (
          <span className="mt-3 inline-flex rounded-full border border-red-500/20 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300">Dibatalkan</span>
        ) : isExpired ? (
          <span className="mt-3 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/50">Kedaluwarsa</span>
        ) : (
          <span className="mt-3 inline-flex rounded-full border border-[#FFB800]/20 bg-[#FFB800]/15 px-3 py-1.5 text-xs font-semibold text-[#FFB800]">Pending — Menunggu Pembayaran</span>
        )}

        <p className="mt-4 text-sm leading-6 text-white/60">
          {isDeliveryFailed
            ? <>Pembayaran <span className="font-medium text-white">{order.name}</span> sudah kami terima, tetapi produknya gagal dikirim otomatis.</>
            : isPaid
            ? <>Pembayaran <span className="font-medium text-white">{order.name}</span> sudah diterima. Pesanan sekarang diproses.</>
            : isCancelled
              ? <>Pesanan ini dibatalkan. Hubungi admin jika kamu sudah melakukan transfer.</>
              : isExpired
                ? <>Batas pembayaran sudah habis. Jangan bayar QRIS lama. Silakan buat pesanan baru.</>
                : order.qris && qrisExpired
                  ? <>QRIS sudah hangus. Jangan bayar QRIS lama.</>
                  : order.qris
                  ? <>Scan QRIS di bawah dan bayar <span className="font-semibold text-white">tepat sesuai total</span>. Status akan diperbarui otomatis.</>
                  : <>Terima kasih, <span className="font-medium text-white">{order.name}</span>! Admin akan memverifikasi bukti pembayaran dan menghubungi kamu.</>}
        </p>

        {order.qris && order.status === "pending" && !isExpired && (
          <section className="mt-6 rounded-2xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-4" aria-label="QRIS dinamis">
            {qrisExpired ? (
              // QR mati tetapi ORDER masih hidup: pembeli bisa minta QR baru
              // tanpa mengulang alur. Sebelumnya order ikut mati bersama QR
              // sehingga keranjang/varian harus dipilih lagi dari nol.
              <div className="py-2">
                <p className="font-display text-base font-bold text-white">QRIS sudah kedaluwarsa</p>
                <p className="mx-auto mt-2 max-w-[360px] text-xs leading-relaxed text-white/55">
                  {order.qrisReissueAllowed ? "Pesanan masih aktif. Kamu dapat meminta QRIS baru 1 kali. Jangan bayar QRIS lama." : "QRIS sudah hangus. Tidak ada pembaruan QRIS lagi; buat pesanan ulang."}
                </p>
                {order.qrisReissueAllowed && <button
                  type="button"
                  onClick={requestNewQris}
                  disabled={reissuing}
                  className="mt-4 inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-xl bg-[#00E5FF] px-5 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8] disabled:opacity-50"
                >
                  {reissuing && <InlineSpinner tone="dark" />}
                  {reissuing ? "Menerbitkan QRIS baru…" : "Minta QRIS Baru"}
                </button>}
                {reissueError && (
                  <p role="alert" className="mt-3 text-xs text-amber-200">{reissueError}</p>
                )}
              </div>
            ) : (
              <>
                <p className="font-display text-xl font-bold text-white">Scan QRIS</p>
                {/* key: QR terbitan ulang memakai URL yang sama, jadi status muat direset lewat expires_at. */}
                <QrisImage key={`${order.qris.image_url}|${order.qris.expires_at}`} src={order.qris.image_url} alt={`QRIS dinamis pesanan ${order.code}`} />
                <div className="mt-3 flex items-center justify-center gap-2" aria-label="QRIS National Payment Standard">
                  <img src="/brand/qris.svg" alt="Logo QRIS resmi" width={72} height={28} className="h-7 w-auto object-contain" draggable={false} />
                  <span className="text-sm text-white/70">National Payment Standard</span>
                </div>
                <p className="mt-4 text-xs uppercase tracking-[0.12em] text-white/45">Total bayar</p>
                <p className="mt-1 font-display text-3xl font-bold text-white">{formatRupiah(payableAmount)}</p>
                <p className="mt-1 text-xs text-white/45">Termasuk kode unik <span className="font-mono text-[#00E5FF]">+{order.qris.unique_code}</span></p>
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-[#FFB800]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#FFB800]" />Berlaku {countdown(order.qris.expires_at, now)}</div>
                <a href={order.qris.image_url} download={`AXVARA-${order.code}-QRIS.png`} className="mt-4 inline-flex h-9 items-center rounded-xl border border-white/15 px-4 text-xs font-semibold text-white/70 hover:bg-white/10">Download QRIS</a>
              </>
            )}
          </section>
        )}

        {fetchError && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-200">Status terbaru belum dapat diperiksa: {fetchError}</div>}

        <div className="ax-glass-card mt-6 rounded-2xl p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Ringkasan</p>
          <div className="mt-3 space-y-2">{order.items.map((item, index) => <div key={index} className="flex justify-between gap-4 text-sm"><span className="text-white/70">{item.name} × {item.qty}</span><span className="font-medium text-white">{formatRupiah(item.price * item.qty)}</span></div>)}</div>
          <div className="mt-3 flex justify-between border-t border-white/10 pt-3"><span className="text-sm text-white/60">Total • {order.method.toUpperCase()}</span><span className="font-bold text-white">{formatRupiah(payableAmount)}</span></div>
        </div>

        {isDeliveryFailed && (
          <section className="mt-6 rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-4 text-left" aria-label="Pengiriman bermasalah">
            <p className="text-sm font-semibold text-red-200">Pembayaran sudah kami terima, tetapi produk gagal dikirim otomatis.</p>
            <p className="mt-1 text-xs leading-5 text-white/60">
              Tim kami sudah mendapat notifikasi dan akan menyerahkan produkmu secara manual. Bila belum ada kabar, hubungi admin lewat tombol di bawah dengan menyebut kode pesanan di atas.
            </p>
          </section>
        )}

        {isPaid && (order.credentialsReady ? (
          <WrCredentialsPanel code={order.code} contactHint={[order.wa, order.email].filter(Boolean).join(" · ")} />
        ) : !isDeliveryFailed && (
          // Detail akun belum/tidak pernah ada: jangan tampilkan form verifikasi
          // yang pasti gagal. Beri kepastian ke mana produk dikirim, dan JANGAN
          // janji menit untuk baris antrean — plafonnya 12 jam (keputusan owner
          // 2026-09-18). Teksnya dipilih di `delivery` di atas.
          <section className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label="Pengiriman produk" aria-live="polite">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Pengiriman Produk</p>
            <p className="mt-2 text-xs leading-5 text-white/55">
              {delivery.sending && <InlineSpinner className="mr-1.5 h-3 w-3 align-[-2px]" />}
              {delivery.lead}
            </p>
            <p className="mt-2 text-[11px] leading-5 text-white/40">{delivery.note}</p>
          </section>
        ))}

        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <Link href="/lacak-pesanan" className="ax-glass-card flex h-11 items-center justify-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-white hover:bg-white/10">Lacak Status</Link>
          <Link href="/" className="ax-glass-card flex h-11 items-center justify-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-white hover:bg-white/10">Lanjut Belanja</Link>
        </div>
        <div className="mt-3">
          <p className="text-center text-[11px] text-white/35">Butuh bantuan?</p>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <StoreWhatsAppLink message={`saya ingin menanyakan pesanan ${order.code} sebesar ${formatRupiah(payableAmount)}`} className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#25D366]/40 hover:bg-white/[0.06]"><img src="/brand/whatsapp-circle.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>WA Admin</span></StoreWhatsAppLink>
            <a href={supportTelegramLink()} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#2AABEE]/40 hover:bg-white/[0.06]"><img src="/brand/telegram.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>Telegram</span></a>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] leading-5 text-white/35">Produk third-party AXVARA — simpan kode pesanan untuk klaim. Garansi berupa penggantian sesuai <Link href="/garansi-replace" className="text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white">ketentuan garansi</Link>.</p>
      </div>
    </div>
  );
}
