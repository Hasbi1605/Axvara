import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryFirst } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ORDER_FACETS_SQL, orderFacets } from "@/lib/admin-order-facets";
import { readPrivateFinancialSnapshot } from "@/lib/admin-report-cache";
import { csvCell } from "@/lib/csv";
import { deriveNameFromEmail } from "@/lib/utils";
import { withoutPrivateBuyerData } from "@/lib/buyer-fields";
import { TUNVN_RETRYABLE_SQL } from "@/lib/tunvn/orders";
import { GAMES_ORDER_LABEL_SQL } from "@/lib/games/order-display";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const VALID_STATUS = new Set(["pending", "lunas", "dibatalkan", "kadaluarsa"]);
const VALID_CHANNEL = new Set(["web", "telegram", "whatsapp"]);

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const status = params.get("status")?.trim().toLowerCase() || "";
  const channel = params.get("channel")?.trim().toLowerCase() || "";
  // AC-22 / PD-44: filter Jenis — 'pedia' (order_kind='pedia') vs 'apps'.
  const kind = params.get("kind")?.trim().toLowerCase() || "";
  const method = params.get("method")?.trim().toLowerCase() || "";
  const proof = params.get("proof")?.trim().toLowerCase() || "";
  const query = params.get("q")?.trim().slice(0, 120) || "";
  const dateFrom = validDate(params.get("date_from"));
  const dateTo = validDate(params.get("date_to"));
  const page = clampNumber(params.get("page"), 1, 100_000, 1);
  const limit = clampNumber(params.get("limit"), 1, 100, 10);
  const exportCsv = params.get("export") === "csv";

  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (VALID_STATUS.has(status)) { conditions.push("o.status=?"); bindings.push(status); }
  if (VALID_CHANNEL.has(channel)) { conditions.push("COALESCE(o.sales_channel,'web')=?"); bindings.push(channel); }
  if (kind === "pedia") conditions.push("COALESCE(o.order_kind,'apps')='pedia'");
  else if (kind === "apps") conditions.push("COALESCE(o.order_kind,'apps')='apps'");
  else if (kind === "games") conditions.push("o.order_kind='games'");
  if (method === "manual") conditions.push("LOWER(o.payment_method)!='qris' AND LOWER(o.payment_method) NOT LIKE 'nowpayments:%' AND LOWER(o.payment_method) NOT LIKE 'sekalipay_gateway:%'");
  else if (/^(?:[a-z0-9_-]{1,32}|(?:nowpayments|sekalipay_gateway):[a-z0-9_-]{1,64})$/.test(method)) { conditions.push("LOWER(o.payment_method)=?"); bindings.push(method); }
  if (proof === "submitted") conditions.push("EXISTS(SELECT 1 FROM payment_proofs pf WHERE pf.order_code=o.code AND pf.status='submitted')");
  if (query) {
    conditions.push(`INSTR(LOWER(o.code || ' ' || COALESCE(o.customer_name,'') || ' ' || COALESCE(o.customer_wa,'') || ' ' || COALESCE(o.items,'') || ' ' ||
      COALESCE((SELECT ${GAMES_ORDER_LABEL_SQL} FROM games_order_items gi
        JOIN games_products gp ON gp.id=gi.product_id LEFT JOIN games_meta gm ON gm.slug=gp.game_slug
        WHERE gi.order_code=o.code AND o.order_kind='games'),'')), ?) > 0`);
    bindings.push(query.toLowerCase());
  }
  // Prefix tanggal UTC mencakup format ISO dan SQLite. Batas mentah
  // mempertahankan peluang pemakaian indeks tanpa fungsi date() pada kolom.
  if (dateFrom) { conditions.push("o.created_at>=?"); bindings.push(dateFrom); }
  if (dateTo) { conditions.push("o.created_at<?"); bindings.push(addOneDay(dateTo)); }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

  const select = `SELECT o.*, COALESCE(pt.payable_amount,o.subtotal) AS payment_amount,
      CASE WHEN o.order_kind='games' THEN ${GAMES_ORDER_LABEL_SQL} END AS games_product_name,
      gi.unit_price AS games_unit_price,
      pp.id AS proof_id, pp.status AS proof_status,
      pp.claimed_method AS proof_claimed_method, pp.r2_key AS proof_r2_key,
      pp.rejection_reason AS proof_rejection_reason
    FROM orders o
    LEFT JOIN games_order_items gi ON gi.order_code=o.code AND o.order_kind='games'
    LEFT JOIN games_products gp ON gp.id=gi.product_id
    LEFT JOIN games_meta gm ON gm.slug=gp.game_slug
    LEFT JOIN payment_transactions pt ON pt.order_code=o.code
    LEFT JOIN payment_proofs pp ON pp.id=(
      SELECT MAX(latest.id) FROM payment_proofs latest WHERE latest.order_code=o.code
    )${where} ORDER BY o.created_at DESC`;

  if (exportCsv) {
    const rows = await queryAll(`${select} LIMIT 5000`, ...bindings);
    return new NextResponse(makeCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="axvara-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const offset = (page - 1) * limit;
  // Facet global (counts kanal/status, daftar metode) tidak ikut filter —
  // tab kanal adalah pemilih — tetapi jangan memindai seluruh tabel orders
  // tiap request daftar (temuan audit D1 reads). Cache privat terenkripsi
  // ~60 detik mengikuti pola overview (auth/revocation tetap berjalan di
  // requireAdmin sebelum ke sini; facet basi maksimal 60 dtk sama seperti
  // status operasional overview).
  const facetRowsPromise = readPrivateFinancialSnapshot(
    "admin-order-facets-v1",
    async () => ({ generatedAt: new Date().toISOString(), rows: await queryAll(ORDER_FACETS_SQL) }),
    60_000,
  ).then((snapshot) => snapshot.rows);
  const [rows, statsRow, facetRows] = await Promise.all([
    queryAll(`${select} LIMIT ? OFFSET ?`, ...bindings, limit, offset),
    // Kartu metrik WAJIB memakai `where` yang sama dengan daftarnya. Dulu
    // query ini tanpa WHERE, sehingga memfilter ke "Pending" tetap
    // menampilkan "Total pesanan 26" — kartu dan daftar di layar yang sama
    // bercerita beda. Join pt dipertahankan untuk omzet.
    queryFirst(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN o.status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN o.status='lunas' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN o.status='lunas' THEN COALESCE(pt.payable_amount,o.subtotal) ELSE 0 END) AS revenue
      FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code${where}`, ...bindings),
    facetRowsPromise,
  ]);
  const total = Number(statsRow?.total ?? rows.length);
  // Status supplier per order (insiden 2026-10-10): order WR/SK yang tertahan
  // dulu hanya tampil "Perlu handover" di Pesanan — tanpa sebab (saldo habis,
  // antre, diproses) dan tanpa tombol Retry/Batal, yang hanya ada di tab
  // Warung Rebahan/Sekalipay. Dua SELECT berindeks order_code, ≤ limit baris.
  const supplierByOrder = await loadSupplierLinks(rows.map((row) => String(row.code || "")).filter(Boolean));
  // Pedia summary per order (satu query berindeks order_code untuk kode AXP di
  // halaman ini). Names server-normalized; legacy blank names derive at read.
  const pediaByOrder = await loadPediaSummaries(rows.map((row) => String(row.code || "")).filter(Boolean));

  return NextResponse.json({
    orders: rows.map((row) => ({ ...normalizeOrder(row), supplier_links: supplierByOrder.get(String(row.code || "")) ?? [], ...(String(row.order_kind || "apps") === "pedia" ? { pedia: pediaByOrder.get(String(row.code || "")) ?? null } : {}) })),
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    stats: {
      total: Number(statsRow?.total || 0),
      pending: Number(statsRow?.pending || 0),
      paid: Number(statsRow?.paid || 0),
      revenue: Number(statsRow?.revenue || 0),
    },
    ...orderFacets(facetRows),
  });
}

type SupplierLink = {
  supplier: "wr" | "sk" | "tunvn" | "storebat" | "mirai" | "aivault"; id: number; status: string; attempt_count: number;
  max_attempts: number; last_error: string | null; supplier_order_id: string | null;
  delivery_status: string | null;
  can_retry?: boolean; can_reconcile?: boolean; item_index?: number; purchase_disabled?: boolean;
};

export type AdminPediaSummary = {
  status: string;
  quantity: number;
  done: number | null;
  percent: number | null;
  target: string | null;
  supplier: string | null;
  supplier_order_id: string | null;
  last_error: string | null;
};

async function loadPediaSummaries(codes: string[]): Promise<Map<string, AdminPediaSummary | null>> {
  const out = new Map<string, AdminPediaSummary | null>();
  const pediaCodes = codes.filter((code) => /^AXP-\d{8}-[A-Z0-9]{8}$/.test(code));
  if (!pediaCodes.length) return out;
  const marks = pediaCodes.map(() => "?").join(",");
  const rows = await queryAll(
    `SELECT i.order_code, i.status, i.quantity, i.remains, i.target_normalized,
            i.supplier, i.supplier_order_id, i.last_error
       FROM pedia_order_items i WHERE i.order_code IN (${marks})`,
    ...pediaCodes,
  ).catch(() => [] as Record<string, unknown>[]);
  const byCode = new Map(rows.map((row) => [String(row.order_code), row]));
  for (const code of pediaCodes) {
    // Missing Pedia item must not infer success: explicit null, no fake status.
    const row = byCode.get(code);
    if (!row) { out.set(code, null); continue; }
    const qty = Number(row.quantity) || 0;
    const rawRemains = row.remains != null ? Number(row.remains) : NaN;
    const remains = Number.isSafeInteger(rawRemains) && rawRemains >= 0 && rawRemains <= qty ? rawRemains : null;
    const done = String(row.status) === "completed" ? qty : remains != null ? qty - remains : null;
    out.set(code, {
      status: String(row.status ?? "unknown"),
      quantity: qty,
      done,
      percent: qty > 0 && done !== null ? (done / qty) * 100 : null,
      target: row.target_normalized ? String(row.target_normalized).slice(0, 120) : null,
      supplier: row.supplier ? String(row.supplier) : null,
      supplier_order_id: row.supplier_order_id ? String(row.supplier_order_id) : null,
      last_error: row.last_error ? String(row.last_error).slice(0, 200) : null,
    });
  }
  return out;
}

async function loadSupplierLinks(codes: string[]): Promise<Map<string, SupplierLink[]>> {
  const out = new Map<string, SupplierLink[]>();
  if (!codes.length) return out;
  const marks = codes.map(() => "?").join(",");
  const [wr, sk, tunvn, storebat, mirai, aivault] = await Promise.all([
    queryAll(`SELECT id, order_code, status, attempt_count, max_attempts, last_error, wr_order_id AS supplier_order_id, delivery_status,
      CASE WHEN wr_variant_id LIKE 'jaspay:%' AND wr_order_id IS NOT NULL AND status='completed' AND jaspay_invoice_total IS NULL THEN 1 ELSE 0 END AS can_reconcile
      FROM wr_order_links WHERE order_code IN (${marks}) ORDER BY id`, ...codes).catch(() => [] as Record<string, unknown>[]),
    queryAll(`SELECT id, order_code, status, attempt_count, max_attempts, last_error, sk_invoice AS supplier_order_id, NULL AS delivery_status
      FROM sk_order_links WHERE order_code IN (${marks}) ORDER BY id`, ...codes).catch(() => [] as Record<string, unknown>[]),
    queryAll(`SELECT id,order_code,item_index,status,attempt_count,3 AS max_attempts,last_error,
      COALESCE(provider_batch_id,provider_order_group) AS supplier_order_id,NULL AS delivery_status,
      CASE WHEN ${TUNVN_RETRYABLE_SQL} THEN 1 ELSE 0 END AS can_retry,
      (SELECT supplier_purchase_disabled FROM orders WHERE code=tunvn_order_links.order_code) AS purchase_disabled,
      CASE WHEN kind='buff' AND provider_batch_id IS NOT NULL AND status IN ('processing','needs_admin') THEN 1 ELSE 0 END AS can_reconcile
      FROM tunvn_order_links WHERE order_code IN (${marks}) ORDER BY id`,...codes),
    // Status saja (tanpa receipt/invite/ciphertext); aksi tetap di Antrean panel supplier.
    queryAll(`SELECT id,order_code,item_index,status,attempt_count,last_error,provider_order_id AS supplier_order_id
      FROM storebat_order_links WHERE order_code IN (${marks}) ORDER BY id`,...codes).catch(() => [] as Record<string, unknown>[]),
    queryAll(`SELECT id,order_code,item_index,status,attempt_count,last_error,provider_order_code AS supplier_order_id
      FROM mirai_order_links WHERE order_code IN (${marks}) ORDER BY id`,...codes).catch(() => [] as Record<string, unknown>[]),
    queryAll(`SELECT id,order_code,item_index,status,attempt_count,last_error,provider_order_id AS supplier_order_id
      FROM aivault_order_links WHERE order_code IN (${marks}) ORDER BY id`,...codes).catch(() => [] as Record<string, unknown>[]),
  ]);
  for (const [supplier, rows] of [["wr", wr], ["sk", sk], ["tunvn",tunvn], ["storebat",storebat], ["mirai",mirai], ["aivault",aivault]] as const) {
    for (const row of rows) {
      const code = String(row.order_code || "");
      const list = out.get(code) ?? [];
      list.push({
        supplier, id: Number(row.id), status: String(row.status || ""),
        attempt_count: Number(row.attempt_count || 0), max_attempts: Number(row.max_attempts || 3),
        last_error: row.last_error ? String(row.last_error).slice(0, 160) : null,
        supplier_order_id: row.supplier_order_id ? String(row.supplier_order_id) : null,
        delivery_status: row.delivery_status ? String(row.delivery_status) : null,
        ...(supplier === "wr" && Number(row.can_reconcile) === 1 ? { can_reconcile: true } : {}),
        ...(["storebat","mirai","aivault"].includes(supplier) ? { item_index:Number(row.item_index) } : {}),
        ...(supplier==="tunvn" ? {can_retry:Number(row.can_retry)===1,can_reconcile:Number(row.can_reconcile)===1,item_index:Number(row.item_index),purchase_disabled:Number(row.purchase_disabled)===1} : {}),
      });
      out.set(code, list);
    }
  }
  return out;
}

function normalizeOrder(row: Record<string, unknown>) {
  let items: unknown[] = [];
  try { items = withoutPrivateBuyerData(JSON.parse(String(row.items || "[]"))); } catch { items = []; }
  if (row.order_kind === "games") items = [{ name: String(row.games_product_name || "Pesanan Games"), qty: 1, price: Number(row.games_unit_price ?? row.subtotal) }];
  // Server-normalized display name: stored name first, email-derived fallback
  // for legacy Pedia rows (or any blank), never "Tanpa nama" from the API.
  const storedName = String(row.customer_name ?? "").trim();
  const customerName = storedName || deriveNameFromEmail(String(row.customer_email ?? ""));
  return {
    code: row.code, customer_name: customerName || storedName, customer_wa: row.customer_wa,
    customer_email: row.customer_email, items, subtotal: row.subtotal,
    payment_amount: row.payment_amount, payment_method: row.payment_method,
    payment_account: row.payment_account,
    proof_url: row.proof_r2_key ? `/r2/${String(row.proof_r2_key)}` : row.proof_url,
    proof_id: row.proof_id, proof_status: row.proof_status,
    proof_claimed_method: row.proof_claimed_method,
    proof_rejection_reason: row.proof_rejection_reason, status: row.status,
    payment_status: row.payment_status, sales_channel: row.sales_channel || "web",
    order_kind: String(row.order_kind || "apps"),
    fulfillment_status: row.fulfillment_status, admin_note: row.admin_note,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/** Batas atas eksklusif rentang tanggal: YYYY-MM-DD + 1 hari (kalender murni). */
function addOneDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  return next.toISOString().slice(0, 10);
}

function clampNumber(value: string | null, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function makeCsv(rows: Record<string, unknown>[]) {
  const header = ["Kode", "Tanggal", "Channel", "Status", "Status Pembayaran", "Nama", "WhatsApp", "Email", "Metode", "Nominal", "Produk"];
  const lines = rows.map((row) => {
    let itemNames = "";
    try {
      const items = (row.order_kind === "games" ? normalizeOrder(row).items : JSON.parse(String(row.items || "[]"))) as { name?: string; qty?: number }[];
      itemNames = items.map((item) => `${item.name || "Produk"} x${item.qty || 1}`).join("; ");
    } catch { itemNames = String(row.items || ""); }
    return [row.code, row.created_at, row.sales_channel || "web", row.status, row.payment_status, row.customer_name, row.customer_wa, row.customer_email, row.payment_method, row.payment_amount ?? row.subtotal, itemNames].map(csvCell).join(",");
  });
  return `\uFEFF${[header.map(csvCell).join(","), ...lines].join("\r\n")}`;
}
