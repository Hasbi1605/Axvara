import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { DEFAULT_SALES_BOT_NUMBER, normalizeBotNumber, validBotRevision } from "@/lib/whatsapp/bot-number";
import { readSalesConfig } from "@/lib/whatsapp/sales-notifications";
import { salesGatewayControl } from "@/lib/whatsapp/gateway";
import { PROMO_BOT_CONFIG_KEY, PROMO_GROUP_ID, parsePromoBotConfig, readPromoBotConfig, promoBotStatus, promoBotNumber, promoBotPair, promoBotGroups, type PromoBotConfig } from "@/lib/whatsapp/promo-bot";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const changed = () => json({ error: "Pengaturan berubah di sesi lain. Cek koneksi lalu ulangi." }, 409);
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return json({ error: "Unauthorized" }, 401);
  const config = await readPromoBotConfig(createDatabaseAccess());
  try {
    const gateway = await promoBotStatus();
    if (req.nextUrl.searchParams.get("groups") === "1") {
      if (!gateway.connected || !config || config.botNumber !== gateway.botNumber || config.botRevision !== gateway.botRevision) return json({ config, gateway, error: "Hubungkan nomor dan cek koneksi sebelum memuat grup." }, 409);
      return json({ config, gateway, ...(await promoBotGroups(config)) });
    }
    return json({ config, gateway });
  } catch { return json({ config, gateway: null, error: "Gateway belum tersedia. Coba cek koneksi kembali." }); }
}
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  if (!["number", "pair", "save_groups", "enable", "disable"].includes(body?.action)) return json({ error: "Aksi tidak valid." }, 400);
  const db = createDatabaseAccess();
  try {
    const raw = (await db.queryFirst("SELECT value FROM store_settings WHERE key=?", PROMO_BOT_CONFIG_KEY))?.value ?? null;
    const old = parsePromoBotConfig(raw);
    const save = async (config: PromoBotConfig, expected = raw) => db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now') WHERE store_settings.value=?`, PROMO_BOT_CONFIG_KEY, JSON.stringify(config), expected);
    if (body.action === "disable") {
      if (old && !(await save({ ...old, enabled: false })).changes) return changed();
      return json({ ok: true, config: old ? { ...old, enabled: false } : null });
    }
    const gateway = await promoBotStatus();
    if ((body.botNumber ?? null) !== gateway.botNumber || (body.botRevision ?? null) !== gateway.botRevision) return changed();
    if (body.action === "number") {
      const number = normalizeBotNumber(body.newBotNumber);
      if (!number) return json({ error: "Masukkan nomor WhatsApp yang valid, contoh 628123456789 atau 08123456789." }, 400);
      const main = await salesGatewayControl("status");
      const sales = await readSalesConfig(db);
      if (number === (main.botNumber || sales?.botNumber || DEFAULT_SALES_BOT_NUMBER)) return json({ error: "Nomor Bot Promo harus berbeda dari nomor bot AXVARA'S." }, 409);
      const paused: PromoBotConfig = { enabled: false, botNumber: gateway.botNumber || number, botRevision: gateway.botRevision || "initial", groups: [] };
      if (!parsePromoBotConfig(JSON.stringify(paused))) return changed();
      if (!(await save(paused)).changes) return changed();
      const next = await promoBotNumber({ newBotNumber: number, botNumber: gateway.botNumber, botRevision: gateway.botRevision });
      const config = { ...paused, botNumber: next.botNumber!, botRevision: next.botRevision! };
      if (!parsePromoBotConfig(JSON.stringify(config))) throw new Error("invalid_gateway_identity");
      if (!(await save(config, JSON.stringify(paused))).changes) return changed();
      return json({ ok: true, config, gateway: next });
    }
    if (!gateway.botNumber || normalizeBotNumber(gateway.botNumber) !== gateway.botNumber || !validBotRevision(gateway.botRevision)) return changed();
    const identity = { botNumber: gateway.botNumber, botRevision: gateway.botRevision };
    if (body.action === "pair") return json({ gateway: await promoBotPair(identity) });
    if (!gateway.connected || gateway.blocked || !old || old.botNumber !== identity.botNumber || old.botRevision !== identity.botRevision) return json({ error: "Hubungkan nomor Bot Promo yang tersimpan dan cek koneksi sebelum melanjutkan." }, 409);
    let config = { ...old };
    if (body.action === "save_groups") {
      const ids = body.groupIds;
      if (!Array.isArray(ids) || ids.length > 20 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !PROMO_GROUP_ID.test(id))) return json({ error: "Pilih maksimal 20 grup yang valid tanpa duplikat." }, 400);
      const { groups } = await promoBotGroups(identity);
      if (ids.some(id => !groups.some(g => g.id === id && g.canSend === true))) return json({ error: "Grup tidak tersedia atau bot tidak bisa mengirim di grup ini. Muat grup kembali." }, 409);
      config = { ...old, enabled: false, groups: ids.map(id => { const g = groups.find(g => g.id === id)!; return { id: g.id, subject: g.subject }; }) };
    } else {
      if (!old.groups.length) return json({ error: "Pilih dan simpan minimal satu grup terlebih dahulu." }, 409);
      config.enabled = true;
      if (!old.enabled) config.enabledAt = new Date().toISOString();
    }
    if (!parsePromoBotConfig(JSON.stringify(config))) return json({ error: "Konfigurasi grup tidak valid." }, 400);
    if (!(await save(config)).changes) return changed();
    return json({ ok: true, config });
  } catch { return json({ error: "Gateway belum siap. Bot Promo tetap dijeda jika nomor sedang diganti. Cek koneksi sebelum mencoba lagi." }, 503); }
}
