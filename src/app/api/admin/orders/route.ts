import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryFirst } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { csvCell } from "@/lib/csv";

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
  if (method === "manual") conditions.push("LOWER(o.payment_method)!='qris'");
  else if (/^[a-z0-9_-]{1,32}$/.test(method)) { conditions.push("LOWER(o.payment_method)=?"); bindings.push(method); }
  if (proof === "submitted") conditions.push("EXISTS(SELECT 1 FROM payment_proofs pf WHERE pf.order_code=o.code AND pf.status='submitted')");
  if (query) {
    conditions.push("LOWER(o.code || ' ' || COALESCE(o.customer_name,'') || ' ' || COALESCE(o.customer_wa,'') || ' ' || COALESCE(o.items,'')) LIKE ?");
    bindings.push(`%${query.toLowerCase()}%`);
  }
  if (dateFrom) { conditions.push("date(o.created_at)>=date(?)"); bindings.push(dateFrom); }
  if (dateTo) { conditions.push("date(o.created_at)<=date(?)"); bindings.push(dateTo); }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

  const select = `SELECT o.*, COALESCE(pt.payable_amount,o.subtotal) AS payment_amount,
      pp.id AS proof_id, pp.status AS proof_status,
      pp.claimed_method AS proof_claimed_method, pp.r2_key AS proof_r2_key,
      pp.rejection_reason AS proof_rejection_reason
    FROM orders o
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
  const [rows, totalRow, statsRow, channelRows, statusRows, methodRows] = await Promise.all([
    queryAll(`${select} LIMIT ? OFFSET ?`, ...bindings, limit, offset),
    queryFirst(`SELECT COUNT(*) AS count FROM orders o${where}`, ...bindings),
    // Kartu metrik WAJIB memakai `where` yang sama dengan daftarnya. Dulu
    // query ini tanpa WHERE, sehingga memfilter ke "Pending" tetap
    // menampilkan "Total pesanan 26" — kartu dan daftar di layar yang sama
    // bercerita beda. Join pt dipertahankan untuk omzet.
    queryFirst(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN o.status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN o.status='lunas' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN o.status='lunas' THEN COALESCE(pt.payable_amount,o.subtotal) ELSE 0 END) AS revenue
      FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code${where}`, ...bindings),
    queryAll("SELECT COALESCE(sales_channel,'web') AS value,COUNT(*) AS count FROM orders GROUP BY COALESCE(sales_channel,'web')"),
    queryAll("SELECT status AS value,COUNT(*) AS count FROM orders GROUP BY status"),
    queryAll("SELECT LOWER(payment_method) AS value,COUNT(*) AS count FROM orders GROUP BY LOWER(payment_method) ORDER BY count DESC"),
  ]);
  const total = Number(totalRow?.count ?? rows.length);
  // Status supplier per order (insiden 2026-10-10): order WR/SK yang tertahan
  // dulu hanya tampil "Perlu handover" di Pesanan — tanpa sebab (saldo habis,
  // antre, diproses) dan tanpa tombol Retry/Batal, yang hanya ada di tab
  // Warung Rebahan/Sekalipay. Dua SELECT berindeks order_code, ≤ limit baris.
  const supplierByOrder = await loadSupplierLinks(rows.map((row) => String(row.code || "")).filter(Boolean));

  return NextResponse.json({
    orders: rows.map((row) => ({ ...normalizeOrder(row), supplier_links: supplierByOrder.get(String(row.code || "")) ?? [] })),
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    stats: {
      total: Number(statsRow?.total || 0),
      pending: Number(statsRow?.pending || 0),
      paid: Number(statsRow?.paid || 0),
      revenue: Number(statsRow?.revenue || 0),
    },
    counts: { channels: rowCounts(channelRows), statuses: rowCounts(statusRows) },
    methods: methodRows.map((row) => String(row.value || "")).filter(Boolean),
  });
}

type SupplierLink = {
  supplier: "wr" | "sk"; id: number; status: string; attempt_count: number;
  max_attempts: number; last_error: string | null; supplier_order_id: string | null;
  delivery_status: string | null;
};

async function loadSupplierLinks(codes: string[]): Promise<Map<string, SupplierLink[]>> {
  const out = new Map<string, SupplierLink[]>();
  if (!codes.length) return out;
  const marks = codes.map(() => "?").join(",");
  const [wr, sk] = await Promise.all([
    queryAll(`SELECT id, order_code, status, attempt_count, max_attempts, last_error, wr_order_id AS supplier_order_id, delivery_status
      FROM wr_order_links WHERE order_code IN (${marks}) ORDER BY id`, ...codes).catch(() => [] as Record<string, unknown>[]),
    queryAll(`SELECT id, order_code, status, attempt_count, max_attempts, last_error, sk_invoice AS supplier_order_id, NULL AS delivery_status
      FROM sk_order_links WHERE order_code IN (${marks}) ORDER BY id`, ...codes).catch(() => [] as Record<string, unknown>[]),
  ]);
  for (const [supplier, rows] of [["wr", wr], ["sk", sk]] as const) {
    for (const row of rows) {
      const code = String(row.order_code || "");
      const list = out.get(code) ?? [];
      list.push({
        supplier, id: Number(row.id), status: String(row.status || ""),
        attempt_count: Number(row.attempt_count || 0), max_attempts: Number(row.max_attempts || 3),
        last_error: row.last_error ? String(row.last_error).slice(0, 160) : null,
        supplier_order_id: row.supplier_order_id ? String(row.supplier_order_id) : null,
        delivery_status: row.delivery_status ? String(row.delivery_status) : null,
      });
      out.set(code, list);
    }
  }
  return out;
}

function normalizeOrder(row: Record<string, unknown>) {
  let items: unknown[] = [];
  try { items = JSON.parse(String(row.items || "[]")); } catch { items = []; }
  return {
    code: row.code, customer_name: row.customer_name, customer_wa: row.customer_wa,
    customer_email: row.customer_email, items, subtotal: row.subtotal,
    payment_amount: row.payment_amount, payment_method: row.payment_method,
    payment_account: row.payment_account,
    proof_url: row.proof_r2_key ? `/r2/${String(row.proof_r2_key)}` : row.proof_url,
    proof_id: row.proof_id, proof_status: row.proof_status,
    proof_claimed_method: row.proof_claimed_method,
    proof_rejection_reason: row.proof_rejection_reason, status: row.status,
    payment_status: row.payment_status, sales_channel: row.sales_channel || "web",
    fulfillment_status: row.fulfillment_status, admin_note: row.admin_note,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function rowCounts(rows: Record<string, unknown>[]) {
  return Object.fromEntries(rows.map((row) => [String(row.value || ""), Number(row.count || 0)]));
}

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
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
      const items = JSON.parse(String(row.items || "[]")) as { name?: string; qty?: number }[];
      itemNames = items.map((item) => `${item.name || "Produk"} x${item.qty || 1}`).join("; ");
    } catch { itemNames = String(row.items || ""); }
    return [row.code, row.created_at, row.sales_channel || "web", row.status, row.payment_status, row.customer_name, row.customer_wa, row.customer_email, row.payment_method, row.payment_amount ?? row.subtotal, itemNames].map(csvCell).join(",");
  });
  return `\uFEFF${[header.map(csvCell).join(","), ...lines].join("\r\n")}`;
}
