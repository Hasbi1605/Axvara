import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { salesGatewayControl } from "@/lib/whatsapp/gateway";
import { SALES_BOT_NUMBER, SALES_CONFIG_KEY, SALES_GROUP_NAME, readSalesConfig } from "@/lib/whatsapp/sales-notifications";

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
  if (!["pair", "enable", "disable"].includes(body?.action)) return json({ error: "Aksi tidak valid." }, 400);
  try {
    const db = createDatabaseAccess();
    if (body.action === "pair") return json({ gateway: await salesGatewayControl("pair") });
    if (body.action === "disable") {
      const current = await readSalesConfig(db);
      if (current) await db.execRun("UPDATE store_settings SET value=?,updated_at=datetime('now') WHERE key=?", JSON.stringify({ ...current, enabled: false }), SALES_CONFIG_KEY);
      return json({ ok: true });
    }
    const gateway = await salesGatewayControl("status");
    if (!gateway.connected || gateway.blocked || gateway.botNumber !== SALES_BOT_NUMBER || gateway.groupName !== SALES_GROUP_NAME || !/^\d+(-\d+)?@g\.us$/.test(gateway.groupId || "")) {
      return json({ error: `Tautkan ${SALES_BOT_NUMBER}, masukkan bot ke grup ${SALES_GROUP_NAME}, lalu cek koneksi kembali.` }, 409);
    }
    const old = await readSalesConfig(db);
    // Repeated clicks preserve the cutoff. Re-enable excludes unqueued historical orders;
    // already queued deliveries remain durable and resume at the gateway's paced rate.
    const config = { enabled: true, enabledAt: old?.enabled ? old.enabledAt : new Date().toISOString(), groupId: gateway.groupId };
    await db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`, SALES_CONFIG_KEY, JSON.stringify(config));
    return json({ ok: true, config });
  } catch { return json({ error: "Gateway belum siap. Coba cek koneksi kembali." }, 503); }
}
