import { QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { parseExpiry } from "@/lib/expiry";
import { resolveVariantCopyDetailed } from "./resolve";

const CHECKED_KEY = "copy_review_checked_at";
const ALERTED_KEY = "copy_review_alerted";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

type CopyReviewCheckResult = {
  checked: boolean;
  changed?: number;
  alerted?: number;
  skipped?: string;
  error?: string;
};

const text = (value: unknown): string | null => value == null || !String(value).trim() ? null : String(value);
// Keep 15 complete lines inside Telegram's 4096-character message ceiling.
const name = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

/** At most four statements; a checkpoint CAS owns the entire 30-minute window. */
export async function checkCopyReviewChanges(db: DatabaseAccess, now = Date.now()): Promise<CopyReviewCheckResult> {
  let checked = false;
  try {
    const chatId = (process.env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
    if (!chatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return { checked, skipped: "telegram_disabled" };
    if (!db.canSpend(4)) return { checked, skipped: "query_budget" };
    const settings = await db.queryAll(`SELECT key, value FROM store_settings WHERE key IN (?, ?)`, CHECKED_KEY, ALERTED_KEY);
    const previous = String(settings.find(row => row.key === CHECKED_KEY)?.value ?? "");
    const last = parseExpiry(previous);
    if (last !== null && now - last < CHECK_INTERVAL_MS) return { checked, skipped: "interval" };
    const raw = String(settings.find(row => row.key === ALERTED_KEY)?.value ?? "{}");
    const alerted = JSON.parse(raw) as Record<string, string>;
    if (!alerted || typeof alerted !== "object" || Array.isArray(alerted)
      || Object.values(alerted).some(value => typeof value !== "string")) {
      return { checked, error: "invalid_alerted_state" };
    }
    const claim = await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
       WHERE COALESCE(store_settings.value, '')=?`,
      CHECKED_KEY, new Date(now).toISOString(), previous,
    );
    if (claim.changes !== 1) return { checked, skipped: "claimed" };
    checked = true;
    const rows = await db.queryAll(
      `SELECT pv.id, p.name AS product_name, pv.label, pv.wr_variant_id,
              pv.admin_terms, pv.admin_activation, pv.admin_terms_en, pv.admin_activation_en, pv.admin_copy_fingerprint,
              wv.wr_terms, wv.wr_delivery_terms, sp.sk_description, sp.sk_seller_note
         FROM product_variants pv JOIN products p ON p.id=pv.product_id
         LEFT JOIN wr_variants wv ON wv.wr_variant_id=pv.wr_variant_id
         LEFT JOIN sk_products sp ON sp.sk_variant_id=pv.sk_variant_id
        WHERE pv.is_active=1 AND p.is_active=1 AND p.archived_at IS NULL
          AND (pv.wr_variant_id IS NOT NULL OR pv.sk_variant_id IS NOT NULL)
        ORDER BY p.id, pv.id`,
    );
    const changed = rows.flatMap(row => {
      const resolution = resolveVariantCopyDetailed(text(row.wr_terms) ?? text(row.sk_description), text(row.wr_delivery_terms) ?? text(row.sk_seller_note), {
        terms: text(row.admin_terms), activation: text(row.admin_activation),
        termsEn: text(row.admin_terms_en), activationEn: text(row.admin_activation_en),
        fingerprint: text(row.admin_copy_fingerprint),
      });
      return resolution.reviewKind === "changed" ? [{ id: String(row.id), supplierKey: resolution.supplierKey,
        line: `• ${name(row.product_name)} — ${name(row.label)} (${text(row.wr_variant_id) ? "WR" : "SK"})` }] : [];
    });
    const pending = changed.filter(variant => alerted[variant.id] !== variant.supplierKey);
    if (pending.length) {
      const { sendMessage } = await import("@/lib/telegram/api");
      // No parse_mode: supplier-controlled names remain literal plain text.
      const result = await sendMessage({ chat_id: chatId, disable_web_page_preview: true,
        text: [
          `⚠️ Teks supplier berubah — S&K perlu ditinjau (${pending.length} varian)`,
          ...pending.slice(0, 15).map(variant => variant.line),
          ...(pending.length > 15 ? [`+${pending.length - 15} lainnya`] : []),
          "Varian yang sudah kamu sunting tetap menampilkan suntinganmu ke pembeli. Tinjau di admin: Produk → filter Tinjauan S&K.",
          "https://axvara.tech/admin?section=products",
        ].join("\n"),
      }).catch(() => null);
      if (result?.ok !== true) return { checked, changed: changed.length, alerted: 0, error: "telegram_failed" };
    }
    const next = JSON.stringify(Object.fromEntries(changed.map(variant => [variant.id, variant.supplierKey])));
    // Add fingerprints only after send success; a no-alert pass may only prune.
    if (next !== raw) await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      ALERTED_KEY, next,
    );
    return { checked, changed: changed.length, alerted: pending.length };
  } catch (error) {
    return { checked, error: error instanceof QueryBudgetExceeded ? "query_budget" : "check_failed" };
  }
}
