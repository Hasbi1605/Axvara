import { NextRequest } from "next/server";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import { validMiraiPackageCode } from "@/lib/mirai/client";
import { applyMiraiMarkupUpdate, MIRAI_MARKUP_SELECT_FROM } from "@/lib/mirai/markup";
import {
  bulkJson,
  parseBulkMarkupRequest,
  type BulkMarkupItemFailure,
} from "@/lib/supplier/bulk-markup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const CHUNK_SIZE = 50;

export async function POST(request: NextRequest) {
  const gate = await parseBulkMarkupRequest(request);
  if (!gate.ok) return gate.response;

  const { db, body } = gate;
  const { ids, markup_percent, reset_manual } = body;

  const validIds: string[] = [];
  const invalidSet = new Set<string>();
  for (const id of ids) {
    if (validMiraiPackageCode(id)) validIds.push(id);
    else invalidSet.add(id);
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < validIds.length; i += CHUNK_SIZE) {
    const chunk = validIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db
      .queryAll(`${MIRAI_MARKUP_SELECT_FROM} AND v.mirai_package_code IN (${placeholders})`, ...chunk)
      .catch(() => [] as Record<string, unknown>[]);
    for (const row of rows) {
      byId.set(String(row.mirai_package_code), row);
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
    const row = byId.get(id);
    if (!row) {
      failed.push({ id, error: "not_mapped" });
      continue;
    }
    const outcome = await applyMiraiMarkupUpdate(db, row, {
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
