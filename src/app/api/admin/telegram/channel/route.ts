// GET/POST /api/admin/telegram/channel — Kelola pengaturan Channel Resmi Telegram
// (@axvaratech), Smart Force-Join, auto-promo channel/DM, dan verifikasi status admin bot.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { readJsonBody } from "@/lib/http-body";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  DEFAULT_FORCE_SUB_CACHE_TTL_SEC,
  MAX_FORCE_SUB_CACHE_TTL_SEC,
  MIN_FORCE_SUB_CACHE_TTL_SEC,
  normalizeChannelUsername,
  readTelegramChannelConfig,
  saveTelegramChannelConfig,
  verifyBotChannelAdmin,
} from "@/lib/telegram/force-sub";
import { TELEGRAM_PROMO_SETTINGS_KEY } from "@/lib/telegram/promo-broadcast";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

const saveSchema = z.object({
  action: z.literal("save"),
  channelUsername: z.string().trim().min(1).max(120),
  channelTitle: z.string().trim().min(1).max(80).optional(),
  forceSubEnabled: z.boolean(),
  channelPromoEnabled: z.boolean(),
  dmPromoEnabled: z.boolean().optional(),
  cacheTtlSeconds: z.number().int().min(MIN_FORCE_SUB_CACHE_TTL_SEC).max(MAX_FORCE_SUB_CACHE_TTL_SEC).optional(),
}).strict();

const verifySchema = z.object({
  action: z.literal("verify"),
  channelUsername: z.string().trim().max(120).optional(),
}).strict();

async function readDmPromoEnabled(db = createDatabaseAccess()): Promise<boolean> {
  if (!db.getD1()) return true;
  const row = await db.queryFirst(
    `SELECT value FROM store_settings WHERE key=?`,
    TELEGRAM_PROMO_SETTINGS_KEY,
  ).catch(() => null);
  return String(row?.value ?? "").trim().toLowerCase() !== "false";
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  const db = createDatabaseAccess();
  if (!db.getD1()) return json({ error: "db_unavailable" }, 503);
  const [config, dmPromoEnabled] = await Promise.all([
    readTelegramChannelConfig(db, { bypassMemo: true }),
    readDmPromoEnabled(db),
  ]);
  return json({ config, dmPromoEnabled });
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  const bounded = await readJsonBody(request, 4_000);
  if (!bounded.ok) return bounded.response;
  const raw = bounded.data ?? {};
  const action = (raw as { action?: unknown }).action;

  if (action === "verify") {
    const parsed = verifySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "Permintaan verifikasi tidak valid." }, 400);
    const db = createDatabaseAccess();
    const saved = await readTelegramChannelConfig(db, { bypassMemo: true });
    const target = parsed.data.channelUsername ? parsed.data.channelUsername : saved.channelUsername;
    const verification = await verifyBotChannelAdmin(target);
    return json(verification, 200);
  }

  if (action === "save") {
    const parsed = saveSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.issues[0]?.message || "Pengaturan channel tidak valid." }, 400);
    }
    const username = normalizeChannelUsername(parsed.data.channelUsername);
    if (!username) {
      return json({ error: "Username channel tidak valid (4–32 karakter huruf/angka/garis bawah, diawali huruf)." }, 400);
    }
    const db = createDatabaseAccess();
    if (!db.getD1()) return json({ error: "Database belum tersedia." }, 503);
    const config = await saveTelegramChannelConfig({
      channelUsername: username,
      channelTitle: parsed.data.channelTitle,
      forceSubEnabled: parsed.data.forceSubEnabled,
      channelPromoEnabled: parsed.data.channelPromoEnabled,
      cacheTtlSeconds: parsed.data.cacheTtlSeconds ?? DEFAULT_FORCE_SUB_CACHE_TTL_SEC,
    }, db);
    let dmPromoEnabled = await readDmPromoEnabled(db);
    if (typeof parsed.data.dmPromoEnabled === "boolean") {
      dmPromoEnabled = parsed.data.dmPromoEnabled;
      await db.execRun(
        `INSERT INTO store_settings(key, value, updated_at) VALUES(?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
        TELEGRAM_PROMO_SETTINGS_KEY,
        dmPromoEnabled ? "true" : "false",
      );
    }
    return json({ ok: true, config, dmPromoEnabled });
  }

  return json({ error: "Aksi tidak valid." }, 400);
}
