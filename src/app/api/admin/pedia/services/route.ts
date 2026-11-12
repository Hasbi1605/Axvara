// /api/admin/pedia/services — Penjelajah layanan supplier (§10, PD-41):
// GET: cari + filter platform/Indonesia/garansi-di-nama/tipe + "dipakai di".
// POST {action:"resync"}: Tarik ulang semua — panggil proxy `services` sekali,
// proses dalam potongan 100 via applyProvidersmmDiff (tanpa cron berat).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { callPediaProxy, isPediaProvider, PEDIA_PROVIDERS } from "@/lib/pedia/proxy";
import { PEDIA_SALE_PROVIDER } from "@/lib/pedia/sales-policy";
import { applyPediaDiff } from "@/lib/pedia/sync";
import { MANAGED_PER_CALL } from "@/lib/pedia/auto-catalog";
import { applyProviderCatalogChunk, refreshSupplierDescriptions } from "@/lib/pedia/metadata-refresh";
import { CURATION_PLATFORM_TERMS, CURATION_METRIC_TERMS, shortlistPediaServices, type CurationProduct, type CurationService } from "@/lib/pedia/curation-shortlist";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const resyncSchema = z.object({
  action: z.literal("resync"),
  supplier: z.enum(PEDIA_PROVIDERS),
  // PSMM-P2: katalog 620 layanan tidak boleh dimaterialisasi dalam satu
  // request. `cursor` melanjutkan potongan berikutnya; `refresh` memaksa
  // metadata deskripsi (selain throttle 6 jam).
  cursor: z.coerce.number().int().min(0).max(100000).optional(),
  refresh: z.boolean().optional(),
});
const serviceSchema = z.object({
  service: z.coerce.number().int().positive().safe(), name: z.string().min(1).max(300),
  type: z.string().min(1).max(60), category: z.string().max(200),
  rate: z.coerce.number().positive(), min: z.coerce.number().int().positive().safe(), max: z.coerce.number().int().positive().safe(),
  refill: z.boolean().optional(), cancel: z.boolean().optional(), dripfeed: z.boolean().optional(),
}).refine((r) => r.max >= r.min);

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams;
  if (q.get("view") === "shortlist") {
    const productId = Number(q.get("product_id")), quantity = Number(q.get("quantity"));
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100_000_000) return NextResponse.json({ error: "invalid_shortlist" }, { status: 400 });
    const db = createDatabaseAccess();
    try {
      const product = await db.queryFirst("SELECT id,name,platform,metric,target_kind FROM pedia_products WHERE id=?", productId) as CurationProduct | null;
      if (!product) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const platforms = CURATION_PLATFORM_TERMS[product.platform] ?? [], metrics = CURATION_METRIC_TERMS[product.metric] ?? [];
      if (!platforms.length || !metrics.length) return NextResponse.json({ ok: true, rows: [], considered: 0, limited: false });
      const platformWhere = platforms.map(() => "(LOWER(s.name) LIKE ? OR LOWER(s.category) LIKE ?)").join(" OR ");
      const metricWhere = metrics.map(() => "LOWER(s.name) LIKE ?").join(" OR ");
      const rows = await db.queryAll(`SELECT s.*,(SELECT GROUP_CONCAT(p.slug, ', ') FROM pedia_tiers t JOIN pedia_products p ON p.id=t.product_id WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id) AS used_in
        FROM pedia_supplier_services s WHERE s.supplier=? AND s.present=1 AND s.type='Default' AND s.rate_idr_per_1k>0 AND s.min_qty>0 AND s.max_qty>=s.min_qty
        AND s.min_qty<=? AND s.max_qty>=? AND (${platformWhere}) AND (${metricWhere})
        ORDER BY s.rate_idr_per_1k,s.supplier,s.service_id LIMIT 201`,PEDIA_SALE_PROVIDER,quantity,quantity,...platforms.flatMap(v=>['%'+v+'%','%'+v+'%']),...metrics.map(v=>'%'+v+'%')) as unknown as CurationService[];
      return NextResponse.json({ ok:true, product, quantity, rows:shortlistPediaServices(rows.slice(0,200),product,quantity), considered:Math.min(rows.length,200), limited:rows.length>200 });
    } catch { return NextResponse.json({ error:"load_failed" }, { status:500 }); }
  }
  const supplier = q.get("supplier") || "";
  if (supplier && !isPediaProvider(supplier)) return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  const search = q.get("q")?.slice(0, 80) ?? "";
  const platform = q.get("platform")?.slice(0, 30) ?? "";
  const indonesia = q.get("indonesia") === "1";
  const garansi = q.get("garansi") === "1";
  const type = q.get("type")?.slice(0, 30) ?? "";
  // PSMM-FINAL-PATCH E: filter kelayakan otomatis diterapkan di SQL SEBELUM
  // COUNT/LIMIT supaya `total`/paginasi benar (bukan menyaring 50 baris klien).
  // Default & "all" tidak menyaring apa pun: admin harus tetap bisa mendiagnosa
  // seluruh katalog, termasuk Custom Comments dan tipe yang diblokir.
  const managedStateRaw = q.get("managed") ?? "";
  const managedState: "" | "active" | "blocked" | "unmanaged" = ["active", "blocked", "unmanaged"].includes(managedStateRaw) ? managedStateRaw as "active" | "blocked" | "unmanaged" : "";
  const page = Number(q.get("page") || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return NextResponse.json({ error: "invalid_page" }, { status: 400 });
  const perPage = 50;
  const db = createDatabaseAccess();
  try {
  const where: string[] = [];
  const params: unknown[] = [];
  if (supplier) { where.push(`s.supplier=?`); params.push(supplier); }
  if (q.get("compatible") === "1") where.push(`s.type='Default' AND s.present=1 AND s.rate_idr_per_1k>0 AND s.min_qty>0 AND s.max_qty>=s.min_qty`);
  if (["mapped", "unmapped"].includes(q.get("mapping") || "")) where.push(`${q.get("mapping") === "unmapped" ? "NOT " : ""}EXISTS (SELECT 1 FROM pedia_tiers t WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id)`);
  // Subquery tier utama sama dengan kolom diagnostik (auto diutamakan).
  const tierWhere = (state: "active" | "blocked" | "unmanaged") => {
    if (state === "active") return `EXISTS (SELECT 1 FROM pedia_tiers t WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id AND t.managed='auto' AND t.is_active=1)`;
    if (state === "blocked") return `EXISTS (SELECT 1 FROM pedia_tiers t WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id AND t.managed='auto' AND t.is_active<>1)`;
    return `NOT EXISTS (SELECT 1 FROM pedia_tiers t WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id AND t.managed='auto')`;
  };
  if (managedState) where.push(tierWhere(managedState));
  if (search) {
    where.push(`(s.name LIKE ? ESCAPE '\\' OR CAST(s.service_id AS TEXT) LIKE ?)`);
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, `%${search.replace(/\D/g, "") || "§"}%`);
  }
  if (platform) { where.push(`s.name LIKE ? ESCAPE '\\'`); params.push(`%${platform}%`); }
  if (indonesia) { where.push(`s.name LIKE '%ndonesia%'`); }
  if (garansi) {
    where.push(`(s.name LIKE '%aransi%' OR s.name LIKE '%efill%' OR s.name LIKE '%♻%' OR s.name LIKE '%R30%')`);
  }
  if (type) { where.push(`s.type=?`); params.push(type); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await db.queryFirst(
    `SELECT COUNT(*) AS n FROM pedia_supplier_services s ${whereSql}`, ...params,
  ))?.n ?? 0);
  const rows = await db.queryAll(
    `SELECT s.*,
       (SELECT GROUP_CONCAT(p.slug || ':' || t.tier, ', ')
          FROM pedia_tiers t JOIN pedia_products p ON p.id=t.product_id
         WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id) AS used_in,
       (SELECT t.managed FROM pedia_tiers t WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id ORDER BY t.managed='auto' DESC LIMIT 1) AS tier_managed,
       (SELECT t.is_active FROM pedia_tiers t WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id ORDER BY t.managed='auto' DESC LIMIT 1) AS tier_active,
       (SELECT t.auto_disabled_reason FROM pedia_tiers t WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id ORDER BY t.managed='auto' DESC LIMIT 1) AS tier_disabled_reason,
       st.avg_time AS stat_avg_time, st.orders_7d AS stat_orders, st.success_rate AS stat_success,
       st.cancel_rate AS stat_cancel, st.refill_rate AS stat_refill, st.ai_score AS stat_score
     FROM pedia_supplier_services s
     LEFT JOIN pedia_service_stats st ON st.supplier=s.supplier AND st.service_id=s.service_id ${whereSql}
      ORDER BY s.supplier, s.service_id LIMIT ? OFFSET ?`,
    ...params, perPage, (page - 1) * perPage,
  );
  // PSMM-P5: diagnostik status deskripsi resmi (ok/empty/oversize/missing)
  // digabung per baris. Tidak ada perubahan pada POST resync (frozen audit).
  const { loadSupplierDescriptionStatus } = await import("@/lib/pedia/metadata-refresh");
  const descStatus = await loadSupplierDescriptionStatus(db).catch(() => new Map<number, "ok" | "empty" | "oversize">());
  const rowsWithStatus = rows.map((r) => ({
    ...r,
    description_status: descStatus.get(Number(r.service_id)) ?? "missing",
  }));
  const diff = await db.queryAll(
    `SELECT key, value FROM store_settings WHERE key IN ('pedia_diff_last_at','pedia_diff_last_change_at','pedia_indosmm_diff_last_at','pedia_indosmm_diff_last_change_at','pedia_psmm_desc_last_at')`,
  );
  const diffStatus: Record<string, string> = {};
  for (const r of diff) diffStatus[String(r.key)] = String(r.value ?? "");
  return NextResponse.json({ ok: true, total, page, perPage, rows: rowsWithStatus, diff: diffStatus });
  } catch { return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = resyncSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  const supplier = parsed.data.supplier;
  try {
  let currency = "IDR";
  if (supplier === "indosmm") {
    const balance = await callPediaProxy<{ currency?: unknown; balance?: unknown }>(supplier, "balance", {}, 15_000);
    if (!balance.ok) return NextResponse.json({ error: "proxy_failed", supplier, kind: balance.kind }, { status: 502 });
    if (balance.data.currency !== "IDR" || balance.data.balance == null || !Number.isFinite(Number(balance.data.balance)) || Number(balance.data.balance) < 0) return NextResponse.json({ error: "unsupported_currency", supplier }, { status: 400 });
    currency = balance.data.currency;
  }
  // VPS services refuses IndoSMM until rate-per-1,000 verification is configured.
  const res = await callPediaProxy<unknown>(supplier, "services", {}, 30_000);
  if (!res.ok) {
    return NextResponse.json({ error: "proxy_failed", supplier, kind: res.kind }, { status: 502 });
  }
  const validated = z.array(serviceSchema).min(1).safeParse(res.data);
  if (!validated.success) return NextResponse.json({ error: "invalid_catalog", supplier }, { status: 502 });
  const rows = validated.data.map((o) => {
    return {
      service_id: Number(o.service),
      name: String(o.name ?? "").slice(0, 300),
      type: String(o.type ?? "").slice(0, 60),
      category: String(o.category ?? "").slice(0, 200),
      rate: Number(o.rate) || 0,
      min_qty: Math.max(0, Math.floor(Number(o.min) || 0)),
      max_qty: Math.max(0, Math.floor(Number(o.max) || 0)),
      api_refill: o.refill === true ? 1 : 0,
      api_cancel: o.cancel === true ? 1 : 0,
      api_dripfeed: o.dripfeed === true ? 1 : 0,
    };
  });
  if (new Set(rows.map((r) => r.service_id)).size !== rows.length) return NextResponse.json({ error: "invalid_catalog", supplier }, { status: 502 });
  const db = createDatabaseAccess();
  // PSMM-P2: materialisasi managed hanya untuk supplier penjualan aktif.
  const managed = supplier === PEDIA_SALE_PROVIDER;
  const cursor = managed ? Number(parsed.data.cursor ?? 0) : 0;
  const window = managed ? rows.slice(cursor, cursor + MANAGED_PER_CALL) : rows;
  const nextCursor = managed ? cursor + window.length : 0;
  let upserted = 0;
  const autoDisabled: { tierId: number; reason: string }[] = [];
  const managedTiers = { created: 0, updated: 0, skipped: 0, ineligible: 0, processed: 0, remaining: 0 };
  const errors: string[] = [];
  // Metadata resmi (satu fetch, throttle >6 jam) SEBELUM materialisasi agar
  // jendela ini memakai deskripsi terbaru. Gagal fetch = last-good dipertahankan.
  let metadata: { status: string } | null = null;
  if (managed) {
    const result = await refreshSupplierDescriptions(db, rows.length, { force: parsed.data.refresh === true });
    metadata = { status: result.status };
  }
  if (managed) {
    // Cermin jendela ini dulu, lalu antrekan materialisasi jendela (idempoten)
    // dan kuras sebagian. Sisa tetap pending durable; heartbeat melanjutkan
    // tanpa memutar ulang awalan, sehingga tidak ada ack palsu.
    const mirror = await applyPediaDiff(db, supplier, window, [], currency);
    upserted += mirror.upserted;
    autoDisabled.push(...mirror.tiersAutoDisabled);
    errors.push(...mirror.errors);
    const chunk = await applyProviderCatalogChunk(db, window as never, []);
    managedTiers.processed = chunk.managed.processed;
    managedTiers.remaining = chunk.managed.remaining;
    if (chunk.managed.errors.length) errors.push("managed_partial");
  } else {
    // Proses dalam potongan 100 (janji PRD §9.3) agar hemat statement.
    for (let i = 0; i < rows.length; i += 100) {
      const r = await applyPediaDiff(db, supplier, rows.slice(i, i + 100), [], currency);
      upserted += r.upserted;
      autoDisabled.push(...r.tiersAutoDisabled);
      errors.push(...r.errors);
    }
  }
  if (!errors.length) {
    const prefix = supplier === "providersmm" ? "pedia_diff" : "pedia_indosmm_diff";
    for (const suffix of ["last_at", "last_change_at"]) await db.execRun(
      `INSERT INTO store_settings (key,value,updated_at) VALUES (?,datetime('now'),datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, `${prefix}_${suffix}`);
  }
  return NextResponse.json({
    ok: !errors.length, supplier, total: rows.length, upserted, auto_disabled: autoDisabled,
    managed: managedTiers, metadata, cursor: nextCursor, done: !managed || nextCursor >= rows.length,
    // Kontrak lama: kegagalan apa pun diringkas `sync_partial` (tidak di-ack),
    // bukan detail driver yang bisa berubah-ubah.
    errors: errors.length ? ["sync_partial"] : [],
  }, { status: errors.length ? 500 : 200 });
  } catch { return NextResponse.json({ error: "sync_failed", supplier }, { status: 500 }); }
}
