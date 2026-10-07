// /api/admin/pedia/services — Penjelajah layanan supplier (§10, PD-41):
// GET: cari + filter platform/Indonesia/garansi-di-nama/tipe + "dipakai di".
// POST {action:"resync"}: Tarik ulang semua — panggil proxy `services` sekali,
// proses dalam potongan 100 via applyProvidersmmDiff (tanpa cron berat).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const resyncSchema = z.object({ action: z.literal("resync") });

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams;
  const search = q.get("q")?.slice(0, 80) ?? "";
  const platform = q.get("platform")?.slice(0, 30) ?? "";
  const indonesia = q.get("indonesia") === "1";
  const garansi = q.get("garansi") === "1";
  const type = q.get("type")?.slice(0, 30) ?? "";
  const page = Math.max(1, Number(q.get("page") || 1));
  const perPage = 50;
  const db = createDatabaseAccess();
  const where: string[] = [];
  const params: unknown[] = [];
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
  ).catch(() => ({ n: 0 })))?.n ?? 0);
  const rows = await db.queryAll(
    `SELECT s.*,
       (SELECT GROUP_CONCAT(p.slug || ':' || t.tier, ', ')
          FROM pedia_tiers t JOIN pedia_products p ON p.id=t.product_id
         WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id) AS used_in
     FROM pedia_supplier_services s ${whereSql}
     ORDER BY s.service_id LIMIT ? OFFSET ?`,
    ...params, perPage, (page - 1) * perPage,
  ).catch(() => []);
  const diff = await db.queryAll(
    `SELECT key, value FROM store_settings WHERE key IN ('pedia_diff_last_at','pedia_diff_last_change_at')`,
  ).catch(() => []);
  const diffStatus: Record<string, string> = {};
  for (const r of diff) diffStatus[String(r.key)] = String(r.value ?? "");
  return NextResponse.json({ ok: true, total, page, perPage, rows, diff: diffStatus });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = resyncSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  const { callPsmmProxy } = await import("@/lib/pedia/proxy");
  const res = await callPsmmProxy<Record<string, unknown>[]>("services", {}, 30_000);
  if (!res.ok) {
    return NextResponse.json({ error: "proxy_failed", kind: res.kind }, { status: 502 });
  }
  const rows = (Array.isArray(res.data) ? res.data : []).map((r) => {
    const o = r as Record<string, unknown>;
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
  }).filter((r) => Number.isFinite(r.service_id));
  // Proses dalam potongan 100 (janji PRD §9.3) agar hemat statement.
  const db = createDatabaseAccess();
  const { applyProvidersmmDiff } = await import("@/lib/pedia/sync");
  let upserted = 0;
  const autoDisabled: { tierId: number; reason: string }[] = [];
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const r = await applyProvidersmmDiff(db, rows.slice(i, i + 100), []);
    upserted += r.upserted;
    autoDisabled.push(...r.tiersAutoDisabled);
    errors.push(...r.errors);
  }
  return NextResponse.json({ ok: true, total: rows.length, upserted, auto_disabled: autoDisabled, errors: errors.slice(0, 3) });
}
