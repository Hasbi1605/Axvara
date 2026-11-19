import type { DatabaseAccess } from "@/lib/db-access";
import { siteOrigin } from "@/lib/site-url";
import {
  TELEGRAM_PROMO_TEMPLATE_ID,
  type BroadcastSnapshot,
} from "@/lib/broadcasts/model";
import {
  BROADCAST_QUEUE_MODE_KEY,
  enqueueCampaignDeliveriesToQueue,
} from "@/lib/broadcasts/queue";
import { TELEGRAM_ELIGIBLE, contentFingerprint } from "@/lib/broadcasts/store";
import {
  loadPromoProducts,
  promoBannerCaption,
  promoSlotAt,
  promoTelegramMessages,
  type PromoSlot,
} from "@/lib/telegram/promo-digest";

export const TELEGRAM_PROMO_SETTINGS_KEY = "telegram_promo_broadcast_enabled";
export const TELEGRAM_PROMO_BANNER_PATH = "/banners/ready-promo.jpg";

export type TelegramPromoEnqueueResult = {
  due: boolean;
  enqueued: number;
  campaignId?: string;
  queuedMessages?: number;
  skipped?: "disabled" | "already_enqueued" | "insufficient_products" | "query_budget" | "no_d1";
};

export function promoCampaignId(businessDate: string, slot: PromoSlot): string {
  const digits = businessDate.replaceAll("-", "");
  if (!/^\d{8}$/.test(digits)) throw new Error(`Invalid businessDate: ${businessDate}`);
  return `00000000-0000-4000-8000-${digits}000${slot === "morning" ? "1" : "2"}`;
}

export function promoCampaignTitle(businessDate: string, slot: PromoSlot): string {
  return `Promo otomatis ${slot === "morning" ? "pagi" : "sore"} ${businessDate}`;
}

export function promoSlotExpiresAt(businessDate: string, slot: PromoSlot): string {
  return `${businessDate}T${slot === "morning" ? "12" : "20"}:00:00+07:00`;
}

export async function enqueueDueTelegramPromo(
  database: DatabaseAccess,
  now = new Date(),
): Promise<TelegramPromoEnqueueResult> {
  const due = promoSlotAt(now);
  if (!due) return { due: false, enqueued: 0 };
  if (process.env.TELEGRAM_BOT_ENABLED !== "true" || !process.env.TELEGRAM_BOT_TOKEN) {
    return { due: true, enqueued: 0, skipped: "disabled" };
  }
  const d1 = database.getD1();
  if (!d1) return { due: true, enqueued: 0, skipped: "no_d1" };
  if (!database.canSpend(1)) return { due: true, enqueued: 0, skipped: "query_budget" };

  const campaignId = promoCampaignId(due.businessDate, due.slot);
  const guard = await database.queryFirst(
    `SELECT
       (SELECT value FROM store_settings WHERE key=?) AS enabled,
       (SELECT status FROM broadcast_campaigns WHERE id=?) AS campaign_status,
       (SELECT value FROM store_settings WHERE key=?) AS queue_mode`,
    TELEGRAM_PROMO_SETTINGS_KEY,
    campaignId,
    BROADCAST_QUEUE_MODE_KEY,
  );
  if (String(guard?.enabled ?? "").trim().toLowerCase() === "false") {
    return { due: true, enqueued: 0, skipped: "disabled" };
  }
  if (guard?.campaign_status) {
    return { due: true, enqueued: 0, campaignId, skipped: "already_enqueued" };
  }
  if (!database.canSpend(5)) return { due: true, enqueued: 0, skipped: "query_budget" };

  const products = await loadPromoProducts(database);
  if (products.length < 3) {
    return { due: true, enqueued: 0, skipped: "insufficient_products" };
  }

  const title = promoCampaignTitle(due.businessDate, due.slot);
  const captionHtml = promoBannerCaption(due.slot);
  const messagesHtml = promoTelegramMessages(due.slot, products);
  const bannerUrl = `${siteOrigin()}${TELEGRAM_PROMO_BANNER_PATH}`;
  const expiresAt = promoSlotExpiresAt(due.businessDate, due.slot);
  const snapshot: BroadcastSnapshot = {
    name: title,
    title,
    body: messagesHtml.join("\n\n"),
    cta_label: "",
    cta_url: "",
    promo: {
      kind: "telegram_promo",
      businessDate: due.businessDate,
      slot: due.slot,
      bannerUrl,
      captionHtml,
      messagesHtml,
      expiresAt,
    },
  };
  const fingerprint = await contentFingerprint({
    kind: "telegram_promo",
    businessDate: due.businessDate,
    slot: due.slot,
  });

  const nowIso = now.toISOString();
  const batchResults = await d1.batch([
    d1.prepare(
      `INSERT OR IGNORE INTO broadcast_templates(id, name, title, body, cta_label, cta_url, archived)
       VALUES (?, 'Promo Otomatis Telegram', 'Promo Otomatis Telegram', 'Template sistem promo otomatis Telegram.', '', '', 1)`,
    ).bind(TELEGRAM_PROMO_TEMPLATE_ID),
    d1.prepare(
      `INSERT OR IGNORE INTO broadcast_campaigns(id, fingerprint, template_id, template_revision, snapshot_json, channels_json, status, created_by, created_at)
       VALUES (?, ?, ?, 1, ?, '["telegram"]', 'preparing', 'cron:promo', ?)`,
    ).bind(campaignId, fingerprint, TELEGRAM_PROMO_TEMPLATE_ID, JSON.stringify(snapshot), nowIso),
    d1.prepare(
      `INSERT OR IGNORE INTO broadcast_deliveries(campaign_id, channel, recipient_id, destination, next_attempt_at, updated_at)
       SELECT c.id, 'telegram', t.user_id, t.chat_id, ?, ?
         FROM broadcast_campaigns c, telegram_users t
        WHERE c.id=? AND c.status='preparing' AND ${TELEGRAM_ELIGIBLE}`,
    ).bind(nowIso, nowIso, campaignId),
    d1.prepare(
      `UPDATE broadcast_campaigns SET status='queued' WHERE id=? AND status='preparing'`,
    ).bind(campaignId),
  ]);

  const insertedCampaign = Number(batchResults[1]?.meta?.changes ?? 0);
  if (!insertedCampaign) {
    return { due: true, enqueued: 0, campaignId, skipped: "already_enqueued" };
  }
  const enqueued = Number(batchResults[2]?.meta?.changes ?? 0);
  let queuedMessages = 0;
  if (enqueued > 0) {
    const queueRes = await enqueueCampaignDeliveriesToQueue(campaignId, database, {
      modeValue: guard?.queue_mode ?? null,
    });
    queuedMessages = queueRes.enqueuedMessages;
  }
  return { due: true, enqueued, campaignId, ...(queuedMessages > 0 ? { queuedMessages } : {}) };
}
