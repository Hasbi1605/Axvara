import type { DatabaseAccess } from "@/lib/db-access";
import { DEFAULT_SALES_BOT_NUMBER, normalizeBotNumber, validBotRevision } from "./bot-number";

// ponytail: reuse group activation; split settings only if WA jobs need independent switches.
export const SALES_CONFIG_KEY = "whatsapp_sales_notifications";
export const SALES_GROUP_NAME = "AXVARA'S";
export type SalesConfig = { enabled: boolean; enabledAt: string; groupId: string | null; botNumber: string; botRevision: string };
export function parseSalesConfig(raw: unknown): SalesConfig | null {
  try {
    const value = JSON.parse(String(raw ?? "null"));
    if (!value || typeof value.enabled !== "boolean" || !Number.isFinite(Date.parse(value.enabledAt))) return null;
    if (!/^\d+(-\d+)?@g\.us$/.test(value.groupId) && (value.enabled || value.groupId !== null)) return null;
    const botNumber = value.botNumber ?? DEFAULT_SALES_BOT_NUMBER;
    const botRevision = value.botRevision ?? "initial";
    if (normalizeBotNumber(botNumber) !== botNumber || !validBotRevision(botRevision)) return null;
    return { enabled: value.enabled, enabledAt: value.enabledAt, groupId: value.groupId, botNumber, botRevision };
  } catch { return null; }
}
export async function readSalesConfig(db: DatabaseAccess): Promise<SalesConfig | null> {
  const row = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", SALES_CONFIG_KEY);
  return parseSalesConfig(row?.value);
}
