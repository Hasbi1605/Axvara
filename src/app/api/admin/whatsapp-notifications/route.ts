import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { salesGatewayControl } from "@/lib/whatsapp/gateway";
import { SALES_CONFIG_KEY, SALES_GROUP_NAME, readSalesConfig, parseSalesConfig } from "@/lib/whatsapp/sales-notifications";
import { DEFAULT_SALES_BOT_NUMBER, normalizeBotNumber, validBotRevision } from "@/lib/whatsapp/bot-number";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return json({ error: "Unauthorized" }, 401);
  const config = await readSalesConfig(createDatabaseAccess());
  try { return json({ config, gateway: await salesGatewayControl("status") }); }
  catch { return json({ config, gateway: null, error: "Gateway belum tersedia. Notifikasi tetap tersimpan di antrean." }); }
}
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  if (!["pair", "enable", "disable", "number"].includes(body?.action)) return json({ error: "Aksi tidak valid." }, 400);
  const identity = { botNumber: body.botNumber ?? DEFAULT_SALES_BOT_NUMBER, botRevision: body.botRevision ?? "initial" };
  if (normalizeBotNumber(identity.botNumber) !== identity.botNumber || !validBotRevision(identity.botRevision)) return json({ error: "Konfigurasi nomor tidak valid. Cek koneksi kembali." }, 400);
  const newBotNumber = body.action === "number" ? normalizeBotNumber(body.newBotNumber) : null;
  if (body.action === "number" && !newBotNumber) return json({ error: "Masukkan nomor WhatsApp yang valid, contoh 628123456789 atau 08123456789." }, 400);
  try {
    const db = createDatabaseAccess();
    if (body.action === "pair") return json({ gateway: await salesGatewayControl("pair", identity) });
    const raw = (await db.queryFirst("SELECT value FROM store_settings WHERE key=?", SALES_CONFIG_KEY))?.value ?? null;
    const old = parseSalesConfig(raw);
    if (body.action === "disable") {
      if (old) {
        const paused = await db.execRun("UPDATE store_settings SET value=?,updated_at=datetime('now') WHERE key=? AND value=?", JSON.stringify({ ...old, enabled: false }), SALES_CONFIG_KEY, raw);
        if (!paused.changes) return json({ error: "Pengaturan berubah di sesi lain. Cek koneksi lalu ulangi." }, 409);
      }
      return json({ ok: true });
    }
    const gateway = await salesGatewayControl("status");
    const revision = gateway.botRevision ?? (gateway.botNumber === DEFAULT_SALES_BOT_NUMBER ? "initial" : "");
    if (gateway.botNumber !== identity.botNumber || revision !== identity.botRevision) return json({ error: "Nomor bot berubah di sesi lain. Cek koneksi lalu ulangi." }, 409);
    if (body.action === "number") {
      if (!gateway.botRevision) return json({ error: "Gateway belum mendukung penggantian nomor. Tunggu rilis lalu cek koneksi." }, 409);
      if (newBotNumber === gateway.botNumber) return json({ ok: true, gateway });
      // Pause first, then replace the session. A failed/ambiguous gateway call stays paused.
      const config = { enabled: false, enabledAt: old?.enabledAt || new Date().toISOString(), groupId: old?.groupId || null, ...identity };
      const paused = await db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now') WHERE store_settings.value=?`, SALES_CONFIG_KEY, JSON.stringify(config), raw);
      if (!paused.changes) return json({ error: "Pengaturan berubah di sesi lain. Cek koneksi lalu ulangi." }, 409);
      return json({ ok: true, config, gateway: await salesGatewayControl("number", { ...identity, newBotNumber: newBotNumber! }) });
    }
    if (!gateway.connected || gateway.blocked || gateway.groupName !== SALES_GROUP_NAME || !/^\d+(-\d+)?@g\.us$/.test(gateway.groupId || "")) {
      return json({ error: `Tautkan ${gateway.botNumber}, masukkan bot ke grup ${SALES_GROUP_NAME}, lalu cek koneksi kembali.` }, 409);
    }
    // The revision prevents an A→B→A change from reviving stale activation/send requests.
    const sameSession = old !== null && old.botNumber === identity.botNumber && old.botRevision === identity.botRevision;
    const config = { enabled: true, enabledAt: old?.enabled && sameSession ? old.enabledAt : new Date().toISOString(), groupId: gateway.groupId, ...identity };
    const saved = await db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now') WHERE store_settings.value=?`, SALES_CONFIG_KEY, JSON.stringify(config), raw);
    if (!saved.changes) return json({ error: "Pengaturan berubah di sesi lain. Cek koneksi lalu ulangi." }, 409);
    return json({ ok: true, config });
  } catch { return json({ error: "Gateway belum siap. Notifikasi tetap dijeda jika nomor sedang diganti. Cek koneksi sebelum mencoba lagi." }, 503); }
}
