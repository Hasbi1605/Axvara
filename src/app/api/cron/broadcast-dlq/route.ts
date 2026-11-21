import { NextResponse } from "next/server";
import { z } from "zod";
import { UUID } from "@/lib/broadcasts/model";
import { execRun, isD1Mode } from "@/lib/db";
import { readJsonBody } from "@/lib/http-body";
import { constantTimeEqual } from "@/lib/security";

export const runtime = "edge";

const event = z.object({
  campaignId: z.string().regex(UUID),
  messageId: z.string().min(1).max(128),
  deliveryIds: z.array(z.number().int().positive()).min(1).max(50),
}).strict();

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await readJsonBody(request, 2048);
  if (!body.ok) return body.response;
  const parsed = event.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  if (!isD1Mode()) return NextResponse.json({ error: "d1_required" }, { status: 503 });
  const { campaignId, messageId, deliveryIds } = parsed.data;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(messageId));
  const key = `broadcast_dlq:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}`;
  try {
    await execRun(`INSERT INTO store_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING`, key,
      JSON.stringify({ campaignId, deliveryIds }));
    return new Response(null, { status: 204 });
  } catch { return NextResponse.json({ error: "broadcast_dlq_record_failed" }, { status: 503 }); }
}
