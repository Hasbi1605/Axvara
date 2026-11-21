import pg from "pg";
import { createHash, randomUUID } from "node:crypto";

export const DEFAULT_BOT_NUMBER = "6283181632507";
export let BOT_NUMBER = DEFAULT_BOT_NUMBER;
export let BOT_REVISION = "initial";
export let PROMO_BOT_NUMBER: string | null = null;
export let PROMO_BOT_REVISION: string | null = null;
export const validBotNumber = (phone: unknown): phone is string => typeof phone === "string" && /^[1-9]\d{9,14}$/.test(phone);
export function botIdentity() { return { botNumber: BOT_NUMBER, botRevision: BOT_REVISION }; }
export function matchesBotIdentity(value: { botNumber?: string; botRevision?: string }) {
  return (value.botNumber ?? DEFAULT_BOT_NUMBER) === BOT_NUMBER && (value.botRevision ?? "initial") === BOT_REVISION;
}
export function promoBotIdentity() { return { botNumber: PROMO_BOT_NUMBER, botRevision: PROMO_BOT_REVISION }; }
export function matchesPromoBotIdentity(value: { botNumber?: string | null; botRevision?: string | null }) {
  return (value.botNumber ?? null) === PROMO_BOT_NUMBER && (value.botRevision ?? null) === PROMO_BOT_REVISION;
}
export { GROUP_NAME } from "./group-target.js";
export function groupAllowsBotSend(
  group: { announce?: boolean; participants: { id: string; phoneNumber?: string; admin?: string | null }[] },
  ownLid?: string,
  phone = BOT_NUMBER,
) {
  const normalize = (id: string) => id.replace(/:\d+@/, "@");
  const own = new Set([phone + "@s.whatsapp.net", ...(ownLid ? [normalize(ownLid)] : [])]);
  return group.participants.some(member => {
    const memberPhone = member.phoneNumber || "";
    const matches = own.has(normalize(member.id)) || own.has(normalize(memberPhone.includes("@") ? memberPhone : memberPhone + "@s.whatsapp.net"));
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
  await lease.query(`CREATE TABLE IF NOT EXISTS axvara_wa_welcome_inbox (
    key TEXT PRIMARY KEY, payload JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), attempts INTEGER NOT NULL DEFAULT 0
  )`);
  await lease.query(`CREATE TABLE IF NOT EXISTS axvara_wa_runtime (
    id INTEGER PRIMARY KEY CHECK(id=1), phone TEXT NOT NULL, revision TEXT NOT NULL,
    group_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await lease.query(`CREATE TABLE IF NOT EXISTS axvara_wa_promo_runtime (
    id INTEGER PRIMARY KEY CHECK(id=1), phone TEXT, revision TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await lease.query("INSERT INTO axvara_wa_promo_runtime(id,phone,revision) VALUES(1,NULL,NULL) ON CONFLICT DO NOTHING");
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

export async function deliveryClaim(key: string, target: string, text: string, phone = BOT_NUMBER) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const control = (await client.query("SELECT * FROM axvara_wa_control WHERE phone=$1 FOR UPDATE", [phone])).rows[0];
    const existing = (await client.query("SELECT * FROM axvara_wa_delivery WHERE key=$1", [key])).rows[0];
    const hash = fingerprint(target, text);
    if (existing && existing.fingerprint !== hash) return { reason: "idempotency_conflict" } as const;
    if (existing?.status === "sent") return { sent: true, id: existing.message_id } as const;
    if (existing && existing.status !== "queued") return { reason: "delivery_outcome_unknown", outcomeUnknown: true } as const;
    if (control?.paused_until && new Date(control.paused_until).getTime() > Date.now()) return { reason: "gateway_cooldown_active" } as const;
    if (control && new Date(control.next_send_at).getTime() > Date.now()) return { reason: "notification_paced" } as const;
    await client.query(`INSERT INTO axvara_wa_delivery(key,fingerprint,target,payload,status)
      VALUES($1,$2,$3,$4,'sending') ON CONFLICT(key) DO UPDATE SET status='sending',updated_at=now()`, [key, hash, target, text]);
    await client.query("UPDATE axvara_wa_control SET next_send_at=now()+interval '60 seconds' WHERE phone=$1", [phone]);
    await client.query("COMMIT");
    return { claimed: true } as const;
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
}
export async function settleDelivery(key: string, messageId?: string, phone = BOT_NUMBER, message?: string) {
  await pool.query("UPDATE axvara_wa_delivery SET status=$2,message_id=$3,payload=COALESCE($4,payload),updated_at=now() WHERE key=$1 AND (status!='sent' OR $2='sent')", [key, messageId ? "sent" : "unknown", messageId ?? null, messageId ? message ?? null : null]);
  if (messageId) await pool.query("UPDATE axvara_wa_control SET last_sent_at=now() WHERE phone=$1", [phone]);
}
export async function releaseUnsentDelivery(key: string) {
  await pool.query("UPDATE axvara_wa_delivery SET status='queued',updated_at=now() WHERE key=$1 AND status='sending'", [key]);
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

export async function initializePromoRuntime() {
  await pool.query(`CREATE TABLE IF NOT EXISTS axvara_wa_promo_runtime (
    id INTEGER PRIMARY KEY CHECK(id=1), phone TEXT, revision TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query("INSERT INTO axvara_wa_promo_runtime(id,phone,revision) VALUES(1,NULL,NULL) ON CONFLICT DO NOTHING");
  return reloadPromoBotIdentity(true);
}

/** Caller holds the promo mutex and has stopped the old socket. No auth/delivery rows are deleted. */
export async function persistPromoBotNumber(phone: string, expected: { botNumber?: string | null; botRevision?: string | null }) {
  if (!validBotNumber(phone)) throw new Error("invalid_bot_number");
  if (phone === BOT_NUMBER) throw new Error("same_as_notification_bot");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query("SELECT phone,revision FROM axvara_wa_promo_runtime WHERE id=1 FOR UPDATE")).rows[0];
    const currentPhone = current?.phone ?? null;
    const currentRevision = current?.revision ?? null;
    if (currentPhone !== (expected.botNumber ?? null) || currentRevision !== (expected.botRevision ?? null)) {
      throw new Error("bot_configuration_changed");
    }
    if (currentPhone === phone) {
      await client.query("INSERT INTO axvara_wa_control(phone) VALUES($1) ON CONFLICT DO NOTHING", [phone]);
      await client.query("COMMIT");
      return promoBotIdentity();
    }
    await client.query("INSERT INTO axvara_wa_control(phone) VALUES($1) ON CONFLICT DO NOTHING", [phone]);
    const revision = randomUUID();
    await client.query(
      "INSERT INTO axvara_wa_promo_runtime(id,phone,revision,updated_at) VALUES(1,$1,$2,now()) ON CONFLICT(id) DO UPDATE SET phone=$1,revision=$2,updated_at=now()",
      [phone, revision],
    );
    await client.query("COMMIT");
    PROMO_BOT_NUMBER = phone;
    PROMO_BOT_REVISION = revision;
    return promoBotIdentity();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function reloadPromoBotIdentity(ensureControl = false) {
  const row = (await pool.query("SELECT phone,revision FROM axvara_wa_promo_runtime WHERE id=1")).rows[0];
  if (!row?.phone) {
    PROMO_BOT_NUMBER = null;
    PROMO_BOT_REVISION = null;
    return promoBotIdentity();
  }
  if (!validBotNumber(row.phone) || typeof row.revision !== "string" || !row.revision) {
    throw new Error("Invalid promo bot runtime settings");
  }
  PROMO_BOT_NUMBER = row.phone;
  PROMO_BOT_REVISION = row.revision;
  if (ensureControl) {
    await pool.query("INSERT INTO axvara_wa_control(phone) VALUES($1) ON CONFLICT DO NOTHING", [PROMO_BOT_NUMBER]);
  }
  return promoBotIdentity();
}
