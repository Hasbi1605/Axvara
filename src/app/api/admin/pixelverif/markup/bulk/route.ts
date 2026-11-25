import { NextRequest } from "next/server";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import { applyPixelverifMarkupUpdate, PIXELVERIF_MARKUP_SELECT_FROM } from "@/lib/pixelverif/markup";
import { resolvePixelverifMarkupId, saveObservedPixelverifMarkup } from "@/lib/pixelverif/observed-markup";
import {
  bulkJson,
  parseBulkMarkupRequest,
  type BulkMarkupItemFailure,
} from "@/lib/supplier/bulk-markup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const gate = await parseBulkMarkupRequest(request);
  if (!gate.ok) return gate.response;

  const { db, body } = gate;
  const { ids, markup_percent, reset_manual } = body;

  const targets = ids.map(id => ({ id, target: resolvePixelverifMarkupId(id) }));
  const input = { markup_percent, admin_price_idr: reset_manual ? null : undefined, block_archived: true };
  const byFlow = new Map<string, Record<string, unknown>>();
  let observedWritten: Set<string>;
  try {
    if (targets.some(({ target }) => target?.validity === 3)) {
      const rows = await db.queryAll(`${PIXELVERIF_MARKUP_SELECT_FROM} AND v.pixelverif_validity = 3`);
      for (const row of rows) byFlow.set(`${row.pixelverif_flow_type}_${row.pixelverif_validity}`, row);
    }
    observedWritten = await saveObservedPixelverifMarkup(db, targets.flatMap(({ target }) =>
      target && !byFlow.has(target.key) ? [target.key] : []), input);
  } catch {
    return bulkJson({ error: "save_failed_or_stale" }, 409);
  }

  let updated = 0;
  let anyChanged = false;
  const failed: BulkMarkupItemFailure[] = [];

  for (const { id, target } of targets) {
    if (!target) {
      failed.push({ id, error: "invalid_id" });
      continue;
    }
    const row = byFlow.get(target.key);
    if (!row) {
      if (observedWritten.has(target.key)) updated++;
      else failed.push({ id, error: "not_mapped" });
      continue;
    }
    const outcome = await applyPixelverifMarkupUpdate(db, row, input);
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
