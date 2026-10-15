import { pediaBounds } from "./bounds";
// src/lib/pedia/sync.ts — Terapkan diff ProviderSMM → D1 (PEDIA-PRD §9.3, PD-30–33).
//
// Kontrak dengan `axvara-wr-proxy/src/psmm-diff.ts`:
//   Header  x-supplier-sync-token: <SUPPLIER_SYNC_TOKEN>  (cek di route)
//   Body    { source: "providersmm",
//             services: [{service_id,name,type,category,rate,min_qty,max_qty,
//                          api_refill,api_cancel,api_dripfeed}],
//             removed_service_ids: number[], heartbeat?: true }
//   2xx = TERSIMPAN (VPS baru memajukan snapshot-nya).
//
// Setelah upsert: untuk tingkat yang terhubung → hitung ulang
// `package_prices_json` (rumus §7.2) + guard margin PD-32/33:
// - rate naik hingga harga_jual − modal < min_profit → tingkat nonaktif
//   otomatis (`is_active=0`, `auto_disabled_reason='margin'`) + notif admin.
// - layanan hilang dari daftar → tingkat terkait nonaktif
//   (`auto_disabled_reason='service_missing'`) + notif.
// - Pulih otomatis HANYA bila admin mengaktifkan ulang (buka kunci manual).

import type { DatabaseAccess } from "@/lib/db-access";
import { computePediaPrice, passesMarginGuard } from "@/lib/pedia/pricing";
import { isPediaProvider, type PediaProvider } from "@/lib/pedia/proxy";

export type PsmmDiffService = {
  service_id: number;
  name: string;
  type: string;
  category: string;
  rate: number;
  min_qty: number;
  max_qty: number;
  api_refill: number;
  api_cancel: number;
  api_dripfeed: number;
  currency?: string;
};

export type PsmmSyncResult = {
  upserted: number;
  markedMissing: number;
  tiersRepriced: number;
  tiersAutoDisabled: { tierId: number; reason: string }[];
  errors: string[];
};

const MAX_SERVICES_PER_CALL = 100;

function parsePackages(raw: unknown): number[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  } catch {
    return [];
  }
}

async function notifyAdminPediaDisabled(text: string): Promise<void> {
  try {
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!chatId || !token) return;
    const { sendMessage } = await import("@/lib/telegram/api");
    await sendMessage({ chat_id: chatId, text, parse_mode: "HTML" }).catch(() => null);
  } catch { /* best-effort */ }
}

/** Terapkan satu diff providersmm. Idempoten (upsert + guard bersyarat). */
export async function applyProvidersmmDiff(
  db: DatabaseAccess,
  services: PsmmDiffService[],
  removedServiceIds: number[],
): Promise<PsmmSyncResult> {
  return applyPediaDiff(db, "providersmm", services, removedServiceIds, "IDR");
}

/** Rates are per 1,000 units. Only verified IDR may enter the IDR column.
 * Legacy ProviderSMM diffs already use IDR; IndoSMM must supply currency. */
export async function applyPediaDiff(
  db: DatabaseAccess,
  supplier: PediaProvider,
  services: PsmmDiffService[],
  removedServiceIds: number[],
  currency?: string,
): Promise<PsmmSyncResult> {
  if (!isPediaProvider(supplier)) throw new Error("invalid_provider");
  if ((currency ?? (supplier === "providersmm" ? "IDR" : "")).toUpperCase() !== "IDR") throw new Error("unsupported_currency");
  const out: PsmmSyncResult = {
    upserted: 0, markedMissing: 0, tiersRepriced: 0, tiersAutoDisabled: [], errors: [],
  };
  if (!Array.isArray(services) || !Array.isArray(removedServiceIds) || services.length > MAX_SERVICES_PER_CALL || removedServiceIds.length > MAX_SERVICES_PER_CALL) throw new Error("invalid_diff");
  const list = services;
  // Validate the entire payload before writing: a partial 2xx must not advance VPS state.
  for (const s of list) {
    if (!s || !Number.isSafeInteger(s.service_id) || s.service_id <= 0
        || !Number.isFinite(s.rate) || s.rate <= 0
        || !Number.isSafeInteger(s.min_qty) || s.min_qty <= 0
        || !Number.isSafeInteger(s.max_qty) || s.max_qty < s.min_qty
        || typeof s.type !== "string" || typeof s.name !== "string" || typeof s.category !== "string"
        || [s.api_refill, s.api_cancel, s.api_dripfeed].some((v) => v !== 0 && v !== 1)) throw new Error("invalid_service");
    if (s.currency !== undefined && s.currency.toUpperCase() !== "IDR") throw new Error("unsupported_currency");
  }
  if (removedServiceIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("invalid_removed_service_id");
  const removed = removedServiceIds;

  // 1. Upsert cermin layanan (satu statement per layanan dalam budget route).
  for (const s of list) {
    const sid = Number(s?.service_id);
    try {
      await db.execRun(
        `INSERT INTO pedia_supplier_services
           (supplier, service_id, name, category, type, rate_idr_per_1k, min_qty, max_qty,
            api_refill, api_cancel, api_dripfeed, present, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
         ON CONFLICT(supplier, service_id) DO UPDATE SET
           name=excluded.name, category=excluded.category, type=excluded.type,
           rate_idr_per_1k=excluded.rate_idr_per_1k, min_qty=excluded.min_qty,
           max_qty=excluded.max_qty, api_refill=excluded.api_refill,
           api_cancel=excluded.api_cancel, api_dripfeed=excluded.api_dripfeed,
           present=1, updated_at=datetime('now')`,
        supplier, sid, String(s.name ?? "").slice(0, 300), String(s.category ?? "").slice(0, 200),
        String(s.type ?? "").slice(0, 60), Number(s.rate) || 0,
        Math.max(0, Math.floor(Number(s.min_qty) || 0)), Math.max(0, Math.floor(Number(s.max_qty) || 0)),
        s.api_refill ? 1 : 0, s.api_cancel ? 1 : 0, s.api_dripfeed ? 1 : 0,
      );
      out.upserted++;
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message.slice(0, 120) : "upsert_failed");
    }
  }

  // 2. Tandai layanan hilang (present=0) — guard per tingkat di langkah 3.
  for (const sid of removed) {
    try {
      const r = await db.execRun(
        `UPDATE pedia_supplier_services SET present=0, updated_at=datetime('now')
          WHERE supplier=? AND service_id=? AND present=1`,
        supplier, sid,
      );
      if (Number(r.changes || 0) > 0) out.markedMissing++;
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message.slice(0, 120) : "missing_failed");
    }
  }

  // 3. Untuk tingkat yang memakai layanan yang berubah/hilang: hitung ulang
  //    harga paket + guard margin. Scope dibatasi ke service_id yang tersentuh
  //    agar tick diff kecil (kuota D1 §9.8).
  const touched = new Set<number>([
    ...list.map((s) => Number(s?.service_id)).filter(Number.isFinite),
    ...removed,
  ]);
  if (touched.size === 0) return out;

  const placeholders = [...touched].map(() => "?").join(",");
  const tiers = await db.queryAll(
    `SELECT t.*, s.rate_idr_per_1k AS live_rate, s.present AS live_present,
            s.min_qty AS live_min, s.max_qty AS live_max, s.type AS live_type
       FROM pedia_tiers t
       LEFT JOIN pedia_supplier_services s
         ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id
      WHERE t.supplier=? AND t.supplier_service_id IN (${placeholders})`,
    supplier, ...[...touched],
  );
  const minOrderRp = Number(process.env.PEDIA_MIN_ORDER_RP || 1000) || 1000;

  for (const t of tiers) {
    const tierId = Number(t.id);
    const liveRate = Number(t.live_rate);
    const present = Number(t.live_present ?? 0);
    // Layanan hilang dari daftar → nonaktif + notif (PD-33).
    if (!Number.isFinite(liveRate) || liveRate <= 0 || present !== 1 || t.live_type !== "Default") {
      if (Number(t.is_active) === 1) {
        await db.execRun(
          `UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='service_missing',
             updated_at=datetime('now') WHERE id=? AND is_active=1`,
          tierId,
        );
        out.tiersAutoDisabled.push({ tierId, reason: "service_missing" });
        await notifyAdminPediaDisabled(
          `🚫 <b>Produk Pedia dinonaktifkan otomatis</b> — layanan supplier #${t.supplier_service_id} hilang dari daftar.`,
        );
      }
      continue;
    }
    // Hitung ulang harga paket dari rate terkini (§7.2). PENTING (PD-32):
    // guard margin dicek memakai harga TERSIMPAN (sebelum tulis ulang) vs
    // modal pada rate BARU — markup memberi headroom untuk kenaikan kecil
    // (harga ikut naik otomatis), tetapi kenaikan besar yang menghabiskan
    // margin → nonaktif + notif agar admin yang memutuskan (naikkan harga
    // manual / ganti layanan), bukan harga melonjak diam-diam ke pembeli.
    // Mengecek SESUDAH tulis ulang tidak ada gunanya: rumus max() selalu
    // menutup min_profit dari harga yang baru dihitung.
    const prod = await db.queryFirst(
      `SELECT packages_json, step FROM pedia_products WHERE id=?`, Number(t.product_id),
    );
    const packages = parsePackages(prod?.packages_json);
    let prevPrices: Record<string, number> = {};
    try {
      const v = JSON.parse(String(t.package_prices_json ?? "{}"));
      if (v && typeof v === "object") prevPrices = v as Record<string, number>;
    } catch { prevPrices = {}; }
    const limits = pediaBounds({ min_qty: t.live_min, max_qty: t.live_max }, t, Number(prod?.step));
    const prices: Record<string, number> = {};
    for (const qty of packages) {
      if (!Number.isSafeInteger(qty) || !limits || qty < limits.min || qty > limits.max || qty % limits.step !== 0) continue;
      prices[String(qty)] = computePediaPrice({
        supplierRatePer1k: liveRate,
        quantity: qty,
        markupPct: Number(t.markup_pct) || 0,
        minProfitRp: Number(t.min_profit_rp) || 0,
        minOrderRp,
      });
    }
    // Guard margin PD-32: paket TERKECIL (paling sensitif) pada harga LAMA
    // masih menutup min_profit di rate baru? Bila tidak → nonaktifkan +
    // notif. Pulih hanya manual oleh admin. Tanpa harga tersimpan (sinkron
    // pertama) guard dilewati — belum ada harga yang dijanjikan ke pembeli.
    const pricedPackages = packages.filter((qty) => Number(prevPrices[String(qty)]) > 0);
    const smallest = pricedPackages.length ? Math.min(...pricedPackages) : 0;
    const storedSmallest = smallest ? Number(prevPrices[String(smallest)]) || 0 : 0;
    const minProfit = Number(t.min_profit_rp) || 0;
    if (smallest > 0 && storedSmallest > 0 && Number(t.is_active) === 1
        && !passesMarginGuard({
          supplierRatePer1k: liveRate, quantity: smallest,
          sellPrice: storedSmallest, minProfitRp: minProfit,
        })) {
      await db.execRun(
        `UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='margin',
           updated_at=datetime('now') WHERE id=? AND is_active=1`,
        tierId,
      );
      out.tiersAutoDisabled.push({ tierId, reason: "margin" });
      await notifyAdminPediaDisabled(
        `🚫 <b>Produk Pedia dinonaktifkan otomatis</b> — margin habis (tier #${tierId}, rate naik).`,
      );
    }
    // Disable must commit first: replay after a failed disable must still
    // compare against the old promised prices, not freshly increased ones.
    await db.execRun(
      `UPDATE pedia_tiers SET package_prices_json=?, rate_snapshot=?,
         updated_at=datetime('now') WHERE id=?`,
      JSON.stringify(prices), liveRate, tierId,
    );
    out.tiersRepriced++;
  }
  return out;
}
