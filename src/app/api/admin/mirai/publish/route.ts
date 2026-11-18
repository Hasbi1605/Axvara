import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createBudgetedDatabase } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { publishMiraiCatalog } from "@/lib/mirai/catalog";
import { parseRateRational } from "@/lib/payments/fx";
import { loadCurrentFxSnapshot } from "@/lib/payments/market-snapshot";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (v: unknown, status = 200) =>
  NextResponse.json(v, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  const raw = await readJsonBody(request, 256);
  if (!raw.ok) {
    raw.response.headers.set("Cache-Control", "private, no-store");
    return raw.response;
  }
  if (!z.object({}).strict().safeParse(raw.data).success) return json({ error: "invalid_body" }, 400);
  try {
    const db = createBudgetedDatabase(40, 0).access;
    const fx = await loadCurrentFxSnapshot(db.d1);
    const rate = fx ? parseRateRational(fx.rateText) : null;
    if (!rate) return json({ error: "fx_unavailable" }, 503);
    const result = await publishMiraiCatalog(db, Number(rate.num) / Number(rate.den), { force: true });
    return json(result, "ok" in result && result.ok ? 200 : 503);
  } catch {
    return json({ error: "publish_failed" }, 503);
  }
}
