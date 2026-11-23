import { NextRequest } from "next/server";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import { applyPixelverifMarkupUpdate, PIXELVERIF_MARKUP_SELECT_FROM } from "@/lib/pixelverif/markup";
import {
  bulkJson,
  parseBulkMarkupRequest,
  type BulkMarkupItemFailure,
} from "@/lib/supplier/bulk-markup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function resolvePixelverifKey(id: string): { flow: "normal" | "full"; validity: 3 } | null {
  if (id === "normal_3" || id === "PV-NORMAL-3") return { flow: "normal", validity: 3 };
  if (id === "full_3" || id === "PV-FULL-3") return { flow: "full", validity: 3 };
  return null;
}

export async function POST(request: NextRequest) {
  const gate = await parseBulkMarkupRequest(request);
  if (!gate.ok) return gate.response;

  const { db, body } = gate;
  const { ids, markup_percent, reset_manual } = body;

  const parsedById = new Map<string, { flow: "normal" | "full"; validity: 3 }>();
  const invalidSet = new Set<string>();
  for (const id of ids) {
    const resolved = resolvePixelverifKey(id);
    if (resolved) parsedById.set(id, resolved);
    else invalidSet.add(id);
  }

  const byFlow = new Map<string, Record<string, unknown>>();
  if (parsedById.size > 0) {
    const rows = await db
      .queryAll(`${PIXELVERIF_MARKUP_SELECT_FROM} AND v.pixelverif_validity = 3`)
      .catch(() => [] as Record<string, unknown>[]);
    for (const row of rows) {
      byFlow.set(`${row.pixelverif_flow_type}_${row.pixelverif_validity}`, row);
    }
  }

  let updated = 0;
  let anyChanged = false;
  const failed: BulkMarkupItemFailure[] = [];

  for (const id of ids) {
    if (invalidSet.has(id)) {
      failed.push({ id, error: "invalid_id" });
      continue;
    }
    const target = parsedById.get(id)!;
    const row = byFlow.get(`${target.flow}_${target.validity}`);
    if (!row) {
      failed.push({ id, error: "not_mapped" });
      continue;
    }
    const outcome = await applyPixelverifMarkupUpdate(db, row, {
      markup_percent,
      admin_price_idr: reset_manual ? null : undefined,
      block_archived: true,
    });
    if (!outcome.ok) {
      failed.push({ id, error: outcome.error });
      continue;
    }
    updated++;
    if (outcome.changed) anyChanged = true;
  }

  if (anyChanged) {
    await bumpCatalogRevision("market", db);
  }

  return bulkJson({ ok: true, updated, failed });
}
