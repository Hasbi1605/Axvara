import pg from "pg";
import { createHash, randomUUID } from "node:crypto";

export const DEFAULT_BOT_NUMBER = "6283181632507";
export let BOT_NUMBER = DEFAULT_BOT_NUMBER;
export let BOT_REVISION = "initial";
export const validBotNumber = (phone: unknown): phone is string => typeof phone === "string" && /^[1-9]\d{9,14}$/.test(phone);
export function botIdentity() { return { botNumber: BOT_NUMBER, botRevision: BOT_REVISION }; }
export function matchesBotIdentity(value: { botNumber?: string; botRevision?: string }) {
  return (value.botNumber ?? DEFAULT_BOT_NUMBER) === BOT_NUMBER && (value.botRevision ?? "initial") === BOT_REVISION;
}
export { GROUP_NAME } from "./group-target.js";
export function groupAllowsBotSend(group: { announce?: boolean; participants: { id: string; phoneNumber?: string; admin?: string | null }[] }, ownLid?: string) {
  const normalize = (id: string) => id.replace(/:\d+@/, "@");
  const own = new Set([BOT_NUMBER + "@s.whatsapp.net", ...(ownLid ? [normalize(ownLid)] : [])]);
  return group.participants.some(member => {
    const phone = member.phoneNumber || "";
    const matches = own.has(normalize(member.id)) || own.has(normalize(phone.includes("@") ? phone : phone + "@s.whatsapp.net"));
    return matches && (!group.announce || ["admin", "superadmin"].includes(member.admin || ""));
  });
}
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
export function fingerprint(target: string, text: string) { return createHash("sha256").update(JSON.stringify([target, text])).digest("hex"); }
export function requiresManualReconnect(code: number | undefined) { return [401, 403, 440, 500].includes(code ?? 0); }
export function isRestriction(error: unknown) {
  const value = error as { output?: { statusCode?: number }; message?: string };
  return [401,403,440,463].includes(value?.output?.statusCode ?? 0) || /\b(restricted|timelock|forbidden|logged.?out|conflict)\b/i.test(String(value?.message || ""));
}

/** One runtime lock across all numbers; original phone lock protects rolling upgrades. */
export async function initializeDurable(onLost: () => void) {
  if (!process.env.DATABASE_URL) throw new Error("Postgres is required for durable WhatsApp sessions");
  const lease = await pool.connect();
  const runtimeLock = await lease.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", ["axvara-wa:runtime"]);
  if (!runtimeLock.rows[0].locked) { lease.release(); throw new Error("Another gateway owns this runtime"); }
  const lock = await lease.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", ["axvara-wa:" + DEFAULT_BOT_NUMBER]);
  if (!lock.rows[0].locked) { lease.release(); throw new Error("Another gateway owns this phone session"); }
  lease.on("error", onLost);
  await lease.query(`CREATE TABLE IF NOT EXISTS axvara_wa_delivery (
    key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','sending','sent','unknown')),
    message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await lease.query(`CREATE TABLE IF NOT EXISTS axvara_wa_control (
    phone TEXT PRIMARY KEY, next_send_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paused_until TIMESTAMPTZ, group_id TEXT, last_ack_at TIMESTAMPTZ, last_sent_at TIMESTAMPTZ
  )`);
  await lease.query(`CREATE TABLE IF NOT EXISTS axvara_wa_runtime (
    id INTEGER PRIMARY KEY CHECK(id=1), phone TEXT NOT NULL, revision TEXT NOT NULL,
    group_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await lease.query(`INSERT INTO axvara_wa_runtime(id,phone,revision,group_id)
    VALUES(1,$1,'initial',(SELECT group_id FROM axvara_wa_control WHERE phone=$1)) ON CONFLICT DO NOTHING`, [DEFAULT_BOT_NUMBER]);
  const runtime = (await lease.query("SELECT phone,revision FROM axvara_wa_runtime WHERE id=1")).rows[0];
  if (!validBotNumber(runtime?.phone) || !runtime.revision) throw new Error("Invalid WhatsApp runtime settings");
  BOT_NUMBER = runtime.phone; BOT_REVISION = runtime.revision;
  await lease.query("INSERT INTO axvara_wa_control(phone) VALUES($1) ON CONFLICT DO NOTHING", [BOT_NUMBER]);
  // With the exclusive session lock held, any interrupted sender is now genuinely ambiguous.
  await lease.query("UPDATE axvara_wa_delivery SET status='unknown',updated_at=now() WHERE status='sending'");
  return lease;
}

export async function deliveryClaim(key: string, target: string, text: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const control = (await client.query("SELECT * FROM axvara_wa_control WHERE phone=$1 FOR UPDATE", [BOT_NUMBER])).rows[0];
    const existing = (await client.query("SELECT * FROM axvara_wa_delivery WHERE key=$1", [key])).rows[0];
    const hash = fingerprint(target, text);
    if (existing && existing.fingerprint !== hash) return { reason: "idempotency_conflict" } as const;
    if (existing?.status === "sent") return { sent: true, id: existing.message_id } as const;
    if (existing && existing.status !== "queued") return { reason: "delivery_outcome_unknown", outcomeUnknown: true } as const;
    if (control?.paused_until && new Date(control.paused_until).getTime() > Date.now()) return { reason: "gateway_cooldown_active" } as const;
    if (new Date(control.next_send_at).getTime() > Date.now()) return { reason: "notification_paced" } as const;
    await client.query(`INSERT INTO axvara_wa_delivery(key,fingerprint,target,payload,status)
      VALUES($1,$2,$3,$4,'sending') ON CONFLICT(key) DO UPDATE SET status='sending',updated_at=now()`, [key, hash, target, text]);
    await client.query("UPDATE axvara_wa_control SET next_send_at=now()+interval '60 seconds' WHERE phone=$1", [BOT_NUMBER]);
    await client.query("COMMIT");
    return { claimed: true } as const;
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
}
export async function settleDelivery(key: string, messageId?: string, phone = BOT_NUMBER) {
  await pool.query("UPDATE axvara_wa_delivery SET status=$2,message_id=$3,updated_at=now() WHERE key=$1 AND (status!='sent' OR $2='sent')", [key, messageId ? "sent" : "unknown", messageId ?? null]);
  if (messageId) await pool.query("UPDATE axvara_wa_control SET last_sent_at=now() WHERE phone=$1", [phone]);
}
export async function pauseOutbound(minutes = 15, phone = BOT_NUMBER) {
  await pool.query("UPDATE axvara_wa_control SET paused_until=now()+($2 * interval '1 minute') WHERE phone=$1", [phone, minutes]);
}

/** Caller holds the session mutex and has stopped the old socket. No auth/delivery rows are deleted. */
export async function persistBotNumber(phone: string, expected: { botNumber?: string; botRevision?: string }) {
  if (!validBotNumber(phone)) throw new Error("invalid_bot_number");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query("SELECT phone,revision FROM axvara_wa_runtime WHERE id=1 FOR UPDATE")).rows[0];
    if (current.phone !== expected.botNumber || current.revision !== expected.botRevision) throw new Error("bot_configuration_changed");
    if (current.phone === phone) { await client.query("COMMIT"); return botIdentity(); }
    // Carry pacing/cooldown forward, including a cooldown from earlier use of the new number.
    await client.query(`INSERT INTO axvara_wa_control(phone,next_send_at,paused_until)
      SELECT $1,next_send_at,paused_until FROM axvara_wa_control WHERE phone=$2
      ON CONFLICT(phone) DO UPDATE SET next_send_at=GREATEST(axvara_wa_control.next_send_at,EXCLUDED.next_send_at),
        paused_until=GREATEST(axvara_wa_control.paused_until,EXCLUDED.paused_until)`, [phone,current.phone]);
    const revision = randomUUID();
    await client.query("UPDATE axvara_wa_runtime SET phone=$1,revision=$2,updated_at=now() WHERE id=1", [phone,revision]);
    await client.query("COMMIT");
    BOT_NUMBER = phone; BOT_REVISION = revision;
    return botIdentity();
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Read the authoritative identity after a commit/connection failure. */
export async function reloadBotIdentity() {
  const row = (await pool.query("SELECT phone,revision FROM axvara_wa_runtime WHERE id=1")).rows[0];
  if (!validBotNumber(row?.phone) || typeof row.revision !== "string") throw new Error("Invalid WhatsApp runtime settings");
  BOT_NUMBER = row.phone; BOT_REVISION = row.revision;
  return botIdentity();
}
