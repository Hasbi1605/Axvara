import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { checkRateLimit } from "@/lib/rateLimit";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export const bulkMarkupBodySchema = z
  .object({
    variant_ids: z.array(z.string().trim().min(1).max(160)).min(1).max(200),
    markup_percent: z
      .number()
      .finite()
      .min(0)
      .max(1000)
      .refine((v) => Number.isInteger(v * 2), "invalid_markup_step"),
    reset_manual: z.boolean().optional().default(false),
  })
  .strict();

export type ParsedBulkMarkupBody = {
  ids: string[];
  markup_percent: number;
  reset_manual: boolean;
};

export type BulkMarkupItemFailure = { id: string; error: string };

export function bulkJson(value: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(value, {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

export async function parseBulkMarkupRequest(
  request: NextRequest,
): Promise<
  | { ok: true; db: DatabaseAccess; body: ParsedBulkMarkupBody }
  | { ok: false; response: NextResponse }
> {
  if (!(await requireAdmin(request))) {
    return { ok: false, response: bulkJson({ error: "unauthorized" }, 401) };
  }
  if (!checkRateLimit(request, "products:write")) {
    return { ok: false, response: bulkJson({ error: "rate_limited" }, 429, { "Retry-After": "60" }) };
  }
  const raw = await readJsonBody(request, 16_384);
  if (!raw.ok) {
    raw.response.headers.set("Cache-Control", "private, no-store");
    return { ok: false, response: raw.response };
  }
  const parsed = bulkMarkupBodySchema.safeParse(raw.data);
  if (!parsed.success) {
    return { ok: false, response: bulkJson({ error: "invalid_body" }, 400) };
  }
  const db = createDatabaseAccess();
  if (!db.d1) {
    return { ok: false, response: bulkJson({ error: "database_unavailable" }, 503) };
  }
  return {
    ok: true,
    db,
    body: {
      ids: [...new Set(parsed.data.variant_ids)],
      markup_percent: parsed.data.markup_percent,
      reset_manual: parsed.data.reset_manual,
    },
  };
}
