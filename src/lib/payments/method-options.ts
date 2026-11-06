// src/lib/payments/method-options.ts — Shared method assembly (R1 extraction).
// Exact tail of POST /api/checkout/quote verbatim: QRIS-first DB options +
// gateway (strict known-fee, non-QRIS) + crypto (satu opsi per koin dari snapshot
// pasar segar: buildCryptoCatalog, tanpa panggilan provider saat quote). Web route calls this; TG reuses it for
// its canonical IDR subtotal. No self-HTTP, no fake JWT, no body/country.
// Failure isolation preserved: gateway/crypto failure hides that rail only.
import { queryAll } from "@/lib/db";
import { isActiveQrisConfigured } from "@/lib/payments/dana-qris";
import { buildCryptoCatalog, type CryptoOffer, type CryptoOfferUnavailable } from "@/lib/payments/crypto-preflight";
import { getCryptoMarketSnapshot } from "@/lib/payments/market-snapshot";
import type { GatewayGroup } from "@/lib/payments/sekalipay-gateway";

export type QuoteDbMethod = {
  id: string;
  kind: "qris";
  label: string;
  sublabel: null;
  account_number: string;
  account_name: string;
  qris_url: string | null;
  currency: "IDR";
  available: true;
};

/** Tampilan saja (tidak masuk token bertanda tangan): grup merchant dari `payment_type` dan batas dari API merchant. */
export type QuoteGatewayLimits = { min: number; max: number | null };

export type QuoteGatewayMethod = {
  id: string;
  kind: "gateway";
  label: string;
  sublabel: string;
  account_number: string;
  currency: "IDR";
  available: true;
  group: GatewayGroup;
  limits: QuoteGatewayLimits;
  gateway: { channel: string; estimated_fee: number; estimated_total: number; idr_subtotal: number };
};

/** Kanal merchant di luar batas total: tampil nonaktif, TANPA biaya/total, tidak pernah masuk token bertanda tangan. */
export type QuoteGatewayUnavailable = {
  id: string;
  kind: "gateway";
  label: string;
  sublabel: string;
  account_number: string;
  currency: "IDR";
  available: false;
  group: GatewayGroup;
  limits: QuoteGatewayLimits;
  unavailable_reason: "below_min" | "above_max";
  /** Hanya below_min: min - subtotal, dihitung di server (klien tidak berhitung finansial). */
  shortfall?: number;
  gateway: { channel: string; idr_subtotal: number };
};

export type QuoteCryptoMethod = CryptoOffer & { account_number: string };
/** Koin di bawah lantai/minimum: tampil nonaktif dengan minimum dari server, tanpa jumlah, tidak pernah ditandatangani. */
export type QuoteCryptoUnavailable = CryptoOfferUnavailable & { account_number: string };

export type MethodOption = QuoteDbMethod | QuoteGatewayMethod | QuoteCryptoMethod;
/** Tampilan quote web: opsi yang bisa dipilih + kanal gateway/koin di luar batas (nonaktif). */
export type MethodCatalogOption = MethodOption | QuoteGatewayUnavailable | QuoteCryptoUnavailable;

/**
 * Opsi yang BISA dipilih/dibayar saja (bawaan, dipakai TG dan token quote). Kanal di luar batas tidak pernah muncul di sini,
 * sehingga tidak bisa dibekukan, ditandatangani, atau dipilih saat create.
 */
export async function buildMethodOptions(idrSubtotal: number): Promise<MethodOption[]> {
  return (await buildMethodCatalog(idrSubtotal)).filter((method): method is MethodOption => method.available);
}

/** Opsi untuk tampilan checkout web: seperti buildMethodOptions + kanal gateway out-of-bounds sebagai available:false (hanya display; tidak ditandatangani). */
export async function buildMethodCatalog(idrSubtotal: number, adminTest = false): Promise<MethodCatalogOption[]> {
  const dbMethods: QuoteDbMethod[] = (
    await queryAll(
      "SELECT * FROM payment_methods WHERE is_active=1 ORDER BY CASE WHEN id='qris' THEN 0 ELSE 1 END, sort_order ASC",
    )
  )
    .map((row) => ({
      id: String(row.id),
      kind: "qris" as const,
      label: String(row.label ?? ""),
      sublabel: null as null,
      account_number: String(row.account_number ?? ""),
      account_name: String(row.account_name ?? ""),
      qris_url: row.qris_url ? String(row.qris_url) : null,
      currency: "IDR" as const,
      available: true as const,
    }))
    .filter((method) => method.id !== "qris" || isActiveQrisConfigured());
  // Crypto multi-koin (LOCAL ONLY): kurs + koin dari snapshot pasar segar (D1,
  // di-refresh cron). Tanpa kurs / koin kosong atau basi / NOWPayments belum
  // terkonfigurasi => tidak ada opsi crypto (fail closed). Klien tidak pernah
  // memberi harga/kurs/koin: token bertanda tangan yang menang saat create.
  let cryptoEntries: ReturnType<typeof buildCryptoCatalog> = [];
  try {
    const { isNowpaymentsConfigured } = await import("@/lib/payments/rails");
    if (isNowpaymentsConfigured(adminTest)) {
      const market = await getCryptoMarketSnapshot();
      cryptoEntries = buildCryptoCatalog(idrSubtotal, market.fx, market.coins);
    }
  } catch {
    cryptoEntries = [];
  }
  const { isSekalipayGatewayConfigured } = await import("@/lib/payments/rails");
  let gatewayMethods: Array<QuoteGatewayMethod | QuoteGatewayUnavailable> = [];
  if (isSekalipayGatewayConfigured(adminTest)) {
    try {
      const { listSekalipayCatalog } = await import("@/lib/payments/sekalipay-gateway");
      const entries = await listSekalipayCatalog(idrSubtotal, adminTest);
      const common = (entry: (typeof entries)[number]) => ({
        id: `sekalipay_gateway:${entry.code}`,
        kind: "gateway" as const,
        label: entry.name,
        sublabel: "Estimasi biaya pembayaran",
        account_number: "",
        currency: "IDR" as const,
        group: entry.type,
        limits: { min: entry.min, max: entry.max },
      });
      // Tersedia dulu (urutan server), lalu tidak tersedia (urutan server).
      gatewayMethods = [
        ...entries.flatMap((entry): QuoteGatewayMethod[] => (entry.available
          ? [{ ...common(entry), available: true as const, gateway: { channel: entry.code, estimated_fee: entry.estimatedFee, estimated_total: entry.estimatedTotal, idr_subtotal: idrSubtotal } }]
          : [])),
        ...entries.flatMap((entry): QuoteGatewayUnavailable[] => (!entry.available
          ? [{ ...common(entry), available: false as const, unavailable_reason: entry.reason, ...(entry.shortfall !== null ? { shortfall: entry.shortfall } : {}), gateway: { channel: entry.code, idr_subtotal: idrSubtotal } }]
          : [])),
      ];
    } catch {
      /* Gateway failure must not disable QRIS or crypto. */
    }
  }
  const cryptoMethods: Array<QuoteCryptoMethod | QuoteCryptoUnavailable> = cryptoEntries.map((entry) => ({ ...entry, account_number: "" }));
  return [...dbMethods, ...gatewayMethods, ...cryptoMethods];
}
