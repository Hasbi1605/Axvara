import type { DatabaseAccess } from "@/lib/db-access";
import { loadPromoProducts, promoMessages, promoSlotAt } from "@/lib/telegram/promo-digest";
import { readSalesConfig } from "./sales-notifications";

export async function enqueueWhatsAppPromo(db: DatabaseAccess, now = new Date()): Promise<number> {
  const due = promoSlotAt(now);
  if (!due || !db.getD1() || !db.canSpend(4)) return 0;
  const config = await readSalesConfig(db);
  if (!config?.enabled) return 0;
  const key = `wa:promo:${due.businessDate}:${due.slot}`;
  if (await db.queryFirst("SELECT id FROM whatsapp_outbox WHERE idempotency_key=?", key)) return 0;
  const products = await loadPromoProducts(db);
  if (products.length < 3) return 0;
  const result = await db.execRun(
    `INSERT OR IGNORE INTO whatsapp_outbox(idempotency_key,channel,destination,message_type,payload,status,attempt_count,next_attempt_at,created_at,updated_at)
     VALUES (?,'whatsapp',?,'promo_digest',?,'pending',0,datetime('now'),datetime('now'),datetime('now'))`,
    key, config.groupId, JSON.stringify({
      message: promoMessages(due.slot, products).short,
      botNumber: config.botNumber, botRevision: config.botRevision,
      expiresAt: `${due.businessDate}T${due.slot === "morning" ? "12" : "20"}:00:00+07:00`,
    }),
  );
  return Number(result.changes ?? 0);
}
