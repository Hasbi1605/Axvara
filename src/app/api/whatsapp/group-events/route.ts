import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDatabaseAccess } from "@/lib/db-access";
import { authenticateWebhook, salesGatewayControl } from "@/lib/whatsapp/gateway";
import { normalizeBotNumber, validBotRevision } from "@/lib/whatsapp/bot-number";
import { welcomeNewMemberMessage } from "@/lib/whatsapp/messages";
import { SALES_GROUP_NAME } from "@/lib/whatsapp/sales-notifications";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const schema = z.object({ event: z.literal("member_join"), groupId: z.string().regex(/^\d+(-\d+)?@g\.us$/),
  botNumber: z.string().refine(n => normalizeBotNumber(n) === n), botRevision: z.string().refine(validBotRevision),
  members: z.array(z.object({ id: z.string().regex(/^\d+(:\d+)?@(lid|s\.whatsapp\.net)$/), name: z.string().max(200).default("") }).strict()).min(1).max(100),
}).strict();

/** Authenticated live joins only. Chat/reaction webhooks never invoke this route. */
export async function POST(request: NextRequest) {
  const json = (data: object, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!authenticateWebhook(request).ok) return json({ error: "unauthorized" }, 401);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "invalid_content_type" }, 415);
  if (Number(request.headers.get("content-length") || 0) > 64000) return json({ error: "payload_too_large" }, 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 64000) return json({ error: "payload_too_large" }, 413);
  let input: unknown; try { input = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = schema.safeParse(input); if (!parsed.success) return json({ error: "invalid_join" }, 400);
  const db = createDatabaseAccess(); if (!db.getD1()) return json({ error: "database_unavailable" }, 503);
  const { groupId, botNumber, botRevision, members } = parsed.data;
  try {
    const status = await salesGatewayControl("status");
    if (!status.connected || status.blocked || status.groupName !== SALES_GROUP_NAME || status.groupId !== groupId || status.botNumber !== botNumber || status.botRevision !== botRevision)
      return json({ error: "bot_configuration_changed" }, 409);
    // Never greet the bot itself; names and phone numbers are not part of the key.
    const joined = [...new Map(members.filter(m => m.id.replace(/:\d+@/, "@") !== `${botNumber}@s.whatsapp.net`)
      .map(m => [m.id.replace(/:\d+@/, "@"), m])).values()].sort((a,b) => a.id.localeCompare(b.id));
    if (!joined.length) return json({ ok: true, status: "ignored" });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([groupId, botNumber, botRevision, new Date().toISOString().slice(0,10), joined.map(m=>m.id)])));
    const key = "wa:welcome:" + Array.from(new Uint8Array(digest), n=>n.toString(16).padStart(2,"0")).join("");
    const names = joined.map(m=>m.name.trim()).filter(Boolean).slice(0,3);
    const message = welcomeNewMemberMessage(names.length ? names.join(", ") + (joined.length > 3 ? " dan teman-teman" : "") : undefined);
    await db.execRun(`INSERT OR IGNORE INTO whatsapp_outbox(idempotency_key,channel,destination,message_type,payload,status,attempt_count,next_attempt_at,created_at,updated_at)
      VALUES (?,'whatsapp',?,'group_welcome',?,'pending',0,datetime('now'),datetime('now'),datetime('now'))`, key, groupId, JSON.stringify({ message, botNumber, botRevision }));
    return json({ ok: true, status: "queued" }, 202);
  } catch { return json({ error: "welcome_unavailable" }, 503); }
}
