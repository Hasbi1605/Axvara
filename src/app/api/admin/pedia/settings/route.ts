// /api/admin/pedia/settings — Pengaturan Pedia (§10 Pengaturan):
// GET: default markup per kelompok + min order + ambang alert + saldo live + riwayat 7 hari.
// PUT: ubah nilai (disimpan di store_settings).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { PRICE_GROUP_DEFAULTS } from "@/lib/pedia/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const KEYS = [
  "pedia_markup_g1", "pedia_markup_g2", "pedia_markup_g3",
  "pedia_min_profit_g1", "pedia_min_profit_g2", "pedia_min_profit_g3",
  "pedia_min_order_rp", "pedia_balance_alert_rp",
] as const;

const schema = z.object({
  pedia_markup_g1: z.coerce.number().min(0).max(1000).optional(),
  pedia_markup_g2: z.coerce.number().min(0).max(1000).optional(),
  pedia_markup_g3: z.coerce.number().min(0).max(1000).optional(),
  pedia_min_profit_g1: z.coerce.number().int().min(0).max(10000000).optional(),
  pedia_min_profit_g2: z.coerce.number().int().min(0).max(10000000).optional(),
  pedia_min_profit_g3: z.coerce.number().int().min(0).max(10000000).optional(),
  pedia_min_order_rp: z.coerce.number().int().min(500).max(100000).optional(),
  pedia_balance_alert_rp: z.coerce.number().int().min(10000).max(100000000).optional(),
});

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createDatabaseAccess();
  try {
  const rows = await db.queryAll(
    `SELECT key, value FROM store_settings WHERE key IN (${KEYS.map(() => "?").join(",")})`,
    ...KEYS,
  );
  const saved: Record<string, string> = {};
  for (const r of rows) saved[String(r.key)] = String(r.value ?? "");
  const num = (key: string, fallback: number) => {
    if (saved[key] == null || saved[key] === "") return fallback;
    const v = Number(saved[key]);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const history = await db.queryAll(
    `SELECT supplier, balance, created_at FROM pedia_supplier_balance_log
      WHERE supplier IN ('providersmm','indosmm') AND datetime(created_at) > datetime('now', '-7 days')
      ORDER BY id DESC LIMIT 100`,
  );
  return NextResponse.json({
    ok: true,
    settings: {
      pedia_markup_g1: num("pedia_markup_g1", PRICE_GROUP_DEFAULTS.G1.markup_pct),
      pedia_markup_g2: num("pedia_markup_g2", PRICE_GROUP_DEFAULTS.G2.markup_pct),
      pedia_markup_g3: num("pedia_markup_g3", PRICE_GROUP_DEFAULTS.G3.markup_pct),
      pedia_min_profit_g1: num("pedia_min_profit_g1", PRICE_GROUP_DEFAULTS.G1.min_profit_rp),
      pedia_min_profit_g2: num("pedia_min_profit_g2", PRICE_GROUP_DEFAULTS.G2.min_profit_rp),
      pedia_min_profit_g3: num("pedia_min_profit_g3", PRICE_GROUP_DEFAULTS.G3.min_profit_rp),
      pedia_min_order_rp: num("pedia_min_order_rp", 1000),
      pedia_balance_alert_rp: num("pedia_balance_alert_rp", 100000),
    },
    balance_history: history,
  });
  } catch { return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  }
  const db = createDatabaseAccess();
  const saved: string[] = [];
  try {
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
      key, String(value),
    );
    saved.push(key);
  }
  return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: saved.length ? "save_partial" : "save_failed", saved_fields: saved }, { status: 500 }); }
}
