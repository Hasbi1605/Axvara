import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { constantTimeEqual } from "@/lib/security";
import { UUID } from "@/lib/broadcasts/model";
import { BROADCAST_QUEUE_MAX_IDS } from "@/lib/broadcasts/queue";
import { processBroadcastDeliveryBatch } from "@/lib/broadcasts/worker";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    v: z.literal(1),
    kind: z.literal("broadcast_deliveries"),
    campaignId: z.string().regex(UUID),
    deliveryIds: z
      .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
      .min(1)
      .max(BROADCAST_QUEUE_MAX_IDS),
    attempt: z.number().int().min(1).max(100),
  })
  .strict();

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return json({ error: "unauthorized" }, 401);
  }
  const bounded = await readJsonBody(request, 4096);
  if (!bounded.ok) return json({ error: "invalid_request" }, 400);
  const parsed = schema.safeParse(bounded.data);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const body = parsed.data;
  try {
    // Workers Paid: unbudgeted D1 access for queue batches (2 statements/recipient hot path).
    const db = createDatabaseAccess();
    const result = await processBroadcastDeliveryBatch(db, body.campaignId, body.deliveryIds, {
      timeBudgetMs: 38_000,
    });
    return json({ ok: true, ...result });
  } catch {
    console.error(
      JSON.stringify({
        event: "broadcast_queue_origin",
        campaignId: body.campaignId,
        deliveryCount: body.deliveryIds.length,
        attempt: body.attempt,
        outcome: "error",
      }),
    );
    return json({ error: "broadcast_unavailable" }, 503);
  }
}
