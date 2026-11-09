// POST /api/admin/games/products/enable-wave — aktifkan SKU gelombang 1 yang
// sehat (docs/GAMES.md §12.7 P3). Hanya brand gelombang 1 + isHealthyForWave;
// tidak pernah menonaktifkan SKU. `dry_run` melaporkan jumlah tanpa menulis.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { enableGamesWave1 } from "@/lib/games/admin";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ dry_run: z.boolean({ error: "dry_run harus boolean." }).optional() }).strict();

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(request, 8_000);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.data ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_body" }, { status: 400 });
  }
  const dryRun = parsed.data.dry_run === true;
  const db = createDatabaseAccess();
  try {
    const result = await enableGamesWave1(db, { dryRun });
    return NextResponse.json({ ok: true, dry_run: dryRun, ...result });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
