import type { DatabaseAccess } from "@/lib/db-access";
import { WA_GROUP_HREF } from "@/lib/site";
import { loadPromoProducts, promoMessages, promoSlotAt } from "@/lib/telegram/promo-digest";
import { normalizeBotNumber, validBotRevision } from "./bot-number";
import { gatewayConfig } from "./gateway";

export const PROMO_BOT_CONFIG_KEY = "whatsapp_promo_bot";
export const PROMO_GROUP_ID = /^\d+(-\d+)?@g\.us$/;
export type PromoBotConfig = { enabled: boolean; enabledAt?: string; botNumber: string; botRevision: string; groups: { id: string; subject: string }[] };
export type PromoBotStatus = { configured: boolean; connected: boolean; blocked: boolean; botNumber: string | null; botRevision: string | null; lastSendAt?: string | null; lastAckAt?: string | null; pairingCode?: string; error?: string };
export type PromoBotGroup = { id: string; subject: string; size: number; canSend: boolean };

export function parsePromoBotConfig(raw: unknown): PromoBotConfig | null {
  try {
    const v = JSON.parse(String(raw ?? "null"));
    if (!v || typeof v.enabled !== "boolean" || typeof v.botNumber !== "string" || normalizeBotNumber(v.botNumber) !== v.botNumber || !validBotRevision(v.botRevision) || !Array.isArray(v.groups) || v.groups.length > 20) return null;
    if (v.enabledAt !== undefined && (typeof v.enabledAt !== "string" || !Number.isFinite(Date.parse(v.enabledAt)))) return null;
    if (v.groups.some((g: PromoBotGroup) => !g || typeof g.id !== "string" || !PROMO_GROUP_ID.test(g.id) || typeof g.subject !== "string" || g.subject.length > 500) || new Set(v.groups.map((g: PromoBotGroup) => g.id)).size !== v.groups.length) return null;
    return { enabled: v.enabled, ...(v.enabledAt !== undefined ? { enabledAt: v.enabledAt } : {}), botNumber: v.botNumber, botRevision: v.botRevision, groups: v.groups.map((g: PromoBotGroup) => ({ id: g.id, subject: g.subject })) };
  } catch { return null; }
}
export async function readPromoBotConfig(db: DatabaseAccess) {
  return parsePromoBotConfig((await db.queryFirst("SELECT value FROM store_settings WHERE key=?", PROMO_BOT_CONFIG_KEY))?.value);
}
async function control<T>(action: string, identity?: { botNumber: string | null; botRevision: string | null; newBotNumber?: string }): Promise<T> {
  const config = gatewayConfig();
  if (!config) throw new Error("Gateway WhatsApp belum dikonfigurasi.");
  const get = action === "status" || action === "groups";
  const query = action === "groups" ? `?${new URLSearchParams({ botNumber: identity?.botNumber || "", botRevision: identity?.botRevision || "" })}` : "";
  const response = await fetch(`${config.url}/promo-bot/${action}${query}`, {
    method: get ? "GET" : "POST", headers: { "x-gateway-token": config.token, ...(!get ? { "content-type": "application/json" } : {}) },
    ...(!get ? { body: JSON.stringify(identity) } : {}), cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.reason || "Gateway WhatsApp belum siap.");
  return body as T;
}
export const promoBotStatus = () => control<PromoBotStatus>("status");
export const promoBotNumber = (identity: { newBotNumber: string; botNumber: string | null; botRevision: string | null }) => control<PromoBotStatus>("number", identity);
export const promoBotPair = (identity: { botNumber: string; botRevision: string }) => control<PromoBotStatus>("pair", identity);
export const promoBotGroups = (identity: { botNumber: string; botRevision: string }) => control<{ groups: PromoBotGroup[] }>("groups", identity);

export async function enqueueWhatsAppPromoBot(db: DatabaseAccess, now = new Date()): Promise<number> {
  const due = promoSlotAt(now);
  if (!due || !db.getD1() || !db.canSpend(5)) return 0;
  const config = await readPromoBotConfig(db);
  if (!config?.enabled || !config.groups.length) return 0;
  const slotStart = Date.parse(`${due.businessDate}T${due.slot === "morning" ? "09" : "17"}:00:00+07:00`);
  if (config.enabledAt && Date.parse(config.enabledAt) > slotStart) return 0;
  const prefix = `wa:promo2:${due.businessDate}:${due.slot}:`;
  const missing = await db.queryFirst(`SELECT 1 AS missing FROM json_each(?) g WHERE NOT EXISTS (SELECT 1 FROM whatsapp_outbox WHERE idempotency_key=? || replace(json_extract(g.value,'$.id'),'@g.us','')) LIMIT 1`, JSON.stringify(config.groups), prefix);
  if (!missing) return 0;
  const products = await loadPromoProducts(db);
  if (products.length < 3) return 0;
  const link = (await db.queryFirst("SELECT value FROM store_settings WHERE key=?", "whatsapp_group_url"))?.value;
  const payload = JSON.stringify({ message: `${promoMessages(due.slot, products).short}\n\nJoin Grup WA: ${typeof link === "string" && link.trim() ? link.trim() : WA_GROUP_HREF}`, botNumber: config.botNumber, botRevision: config.botRevision, expiresAt: `${due.businessDate}T${due.slot === "morning" ? "12" : "20"}:00:00+07:00` });
  const result = await db.execRun(`INSERT OR IGNORE INTO whatsapp_outbox(idempotency_key,channel,destination,message_type,payload,status,attempt_count,next_attempt_at,created_at,updated_at)
    SELECT ? || replace(json_extract(value,'$.id'),'@g.us',''),'whatsapp',json_extract(value,'$.id'),'promo_bot_digest',?,'pending',0,datetime('now'),datetime('now'),datetime('now') FROM json_each(?)`, prefix, payload, JSON.stringify(config.groups));
  return Number(result.changes ?? 0);
}
