import Fastify from "fastify";
import makeWASocket, {
  Browsers,
  downloadMediaMessage,
  normalizeMessageContent,
  proto,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { randomBytes, timingSafeEqual } from "node:crypto";
import pino from "pino";
import { usePostgresAuthState } from "./pg-auth.js";
import { BOT_NUMBER, pool, initializeDurable, deliveryClaim, settleDelivery, pauseOutbound, requiresManualReconnect, isRestriction, groupAllowsBotSend } from "./durable.js";
import { isNotificationGroupName, selectNotificationGroup, notificationGroupStatus } from "./group-target.js";
// (registerWrProxy tidak lagi diimpor — proxy WR pindah ke axvara-wr-proxy)

const logger = pino({ name: "axvara-wa-gateway" });
const PORT = Number(process.env.PORT || 3001);
const AXVARA_WEBHOOK_URL = process.env.AXVARA_WEBHOOK_URL || "https://axvara.tech/api/whatsapp/webhook";
const AXVARA_WEBHOOK_TOKEN = process.env.AXVARA_WEBHOOK_TOKEN || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const WA_BOT_NUMBER = BOT_NUMBER;
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || "120363412672344593@g.us";
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MESSAGE_TTL_MS = 20 * 60 * 1000;
const MEDIA_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_MESSAGES = 500;

type CachedInbound = { message: WAMessage; expiresAt: number };
type CachedMedia = { buffer: Buffer; contentType: string; expiresAt: number };

const inboundMessages = new Map<string, CachedInbound>();
const mediaFiles = new Map<string, CachedMedia>();
let sock: WASocket | null = null;
let isConnected = false;
let pairingCodeRequested = false;
let starting: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let shuttingDown = false;
let credsSaved: Promise<void> = Promise.resolve();
let latestQr = false;
let pairingCode = "";
let pairingExpiresAt = 0;
let notificationGroup: { id: string; subject: string } | null = null;
let lastAckAt: string | null = null;
let lastSendAtIso: string | null = null;
let blocked = false;

function scheduleReconnect(delay: number) {
  if (shuttingDown || blocked || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void startWhatsApp().catch(error => logger.error({ type: error?.name }, "Reconnect failed")); }, delay);
}
async function resolveNotificationGroup() {
  if (!sock || !isConnected || sock.user?.id?.split(":")[0]?.split("@")[0] !== BOT_NUMBER) return null;
  if (notificationGroup && (groupMetadataCache.get(notificationGroup.id)?.expiresAt ?? 0) > Date.now()) return notificationGroup;
  const control = (await pool.query("SELECT group_id FROM axvara_wa_control WHERE phone=$1", [BOT_NUMBER])).rows[0];
  if (control?.group_id) {
    const meta = await sock.groupMetadata(control.group_id);
    if (!isNotificationGroupName(meta.subject)) throw new Error("Nama grup tujuan berubah; periksa grup sebelum melanjutkan.");
    if (!groupAllowsBotSend(meta, sock.user?.lid)) throw new Error("Jadikan bot admin di grup AXVARA'S yang hanya mengizinkan admin mengirim pesan.");
    notificationGroup = { id: meta.id, subject: meta.subject };
    groupMetadataCache.set(meta.id, { data: meta, expiresAt: Date.now()+GROUP_METADATA_TTL_MS });
    return notificationGroup;
  }
  const group = selectNotificationGroup(Object.values(await sock.groupFetchAllParticipating()));
  if (!groupAllowsBotSend(group, sock.user?.lid)) throw new Error("Jadikan bot admin di grup AXVARA'S yang hanya mengizinkan admin mengirim pesan.");
  notificationGroup = { id: group.id, subject: group.subject };
  await pool.query("UPDATE axvara_wa_control SET group_id=$2 WHERE phone=$1 AND group_id IS NULL", [BOT_NUMBER, notificationGroup.id]);
  groupMetadataCache.set(group.id, { data: group, expiresAt: Date.now()+GROUP_METADATA_TTL_MS });
  return notificationGroup;
}
// Operasional sesi tunggal dengan reconnect terbatas:
// - reconnectCount/lastDisconnectCode/lastDisconnectAt dipaparkan di /health.
// - 401 (loggedOut) = JANGAN reconnect otomatis (dok resmi Baileys).
// - Sisanya: exponential backoff + jitter, dan socket lama di-end dulu.
// Ini mengurangi konflik/reconnect berulang, bukan jaminan bebas pembatasan.
let reconnectCount = 0;
let lastDisconnectCode: number | null = null;
let lastDisconnectAt: string | null = null;
// Cache metadata grup (FAQ resmi Baileys): tiap sendMessage ke grup tanpa
// cache fetch daftar partisipan → rate limit cepat habis.
const groupMetadataCache = new Map<string, { data: unknown; expiresAt: number }>();
const GROUP_METADATA_TTL_MS = 5 * 60_000;

function cacheKey(target: string, messageId: string): string {
  return `${target}:${messageId}`;
}

function cleanupCaches(): void {
  const now = Date.now();
  for (const [key, value] of inboundMessages) if (value.expiresAt <= now) inboundMessages.delete(key);
  for (const [key, value] of mediaFiles) if (value.expiresAt <= now) mediaFiles.delete(key);
  while (inboundMessages.size > MAX_CACHED_MESSAGES) {
    const oldest = inboundMessages.keys().next().value;
    if (!oldest) break;
    inboundMessages.delete(oldest);
  }
}

setInterval(cleanupCaches, 60_000).unref();

function rememberInbound(message: WAMessage): void {
  const target = message.key.remoteJid || "";
  const id = message.key.id || "";
  if (target && id) inboundMessages.set(cacheKey(target, id), { message, expiresAt: Date.now() + MESSAGE_TTL_MS });
  cleanupCaches();
}

function quotedMessage(target: string, inboxId?: string): WAMessage | undefined {
  if (!inboxId) return undefined;
  const cached = inboundMessages.get(cacheKey(target, inboxId));
  if (!cached || cached.expiresAt <= Date.now()) return undefined;
  return cached.message;
}

function validGatewayToken(raw: unknown): boolean {
  if (!AXVARA_WEBHOOK_TOKEN || typeof raw !== "string") return false;
  const provided = Buffer.from(raw);
  const expected = Buffer.from(AXVARA_WEBHOOK_TOKEN);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function startWhatsApp(): Promise<void> {
  if (blocked || shuttingDown) return Promise.resolve();
  if (starting) return starting;
  starting = startSocket().finally(() => { starting = null; });
  return starting;
}
async function startSocket(): Promise<void> {
  await credsSaved;
  const { state, saveCreds } = await usePostgresAuthState();
  // Teardown socket lama DULU sebelum bikin baru (anti zombie socket).
  if (sock) {
    try {
      const old = sock;
      sock = null;
      for (const event of ["connection.update", "creds.update", "messages.upsert", "groups.update", "group-participants.update", "messages.update"] as const) old.ev.removeAllListeners(event);
      await old.end(undefined);
    } catch {
      /* socket lama sudah mati — lanjut */
    }
  }

  sock = makeWASocket({
    auth: state,
    getMessage: async key => {
      const cached = inboundMessages.get(cacheKey(key.remoteJid || "", key.id || ""));
      if (cached) return cached.message.message || undefined;
      const row = (await pool.query("SELECT payload FROM axvara_wa_delivery WHERE message_id=$1 AND target=$2", [key.id, key.remoteJid])).rows[0];
      return row ? proto.Message.fromObject({ conversation: row.payload }) : undefined;
    },
    logger: logger as any,
    browser: Browsers.macOS("Safari"),
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    // Cache metadata grup: hemat fetch daftar partisipan tiap sendMessage.
    cachedGroupMetadata: async (jid) => {
      const hit = groupMetadataCache.get(jid);
      if (hit && hit.expiresAt > Date.now()) return hit.data as any;
      try {
        const meta = await sock?.groupMetadata(jid);
        if (meta) groupMetadataCache.set(jid, { data: meta, expiresAt: Date.now() + GROUP_METADATA_TTL_MS });
        return meta;
      } catch {
        return undefined;
      }
    },
  });
  sock.ev.on("creds.update", () => {
    credsSaved = credsSaved.then(saveCreds).catch(() => { blocked = true; void sock?.end(undefined); logger.error("Unable to persist session; stopped"); });
  });
  sock.ev.on("groups.update", updates => { for (const group of updates) if (group.id) { groupMetadataCache.delete(group.id); if (notificationGroup?.id === group.id) notificationGroup = null; } });
  sock.ev.on("group-participants.update", update => { groupMetadataCache.delete(update.id); if (notificationGroup?.id === update.id) notificationGroup = null; });
  sock.ev.on("messages.update", updates => {
    if (updates.some(entry => Number(entry.update.status) >= 3)) {
      lastAckAt = new Date().toISOString();
      void pool.query("UPDATE axvara_wa_control SET last_ack_at=now() WHERE phone=$1", [BOT_NUMBER]).catch(() => {});
    }
  });

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQr = true;
    }
    if (connection === "open") {
      isConnected = true;
      latestQr = false; pairingCode = "";
      if (sock?.user?.id?.split(":")[0]?.split("@")[0] !== BOT_NUMBER) { blocked = true; isConnected = false; void sock?.end(undefined); return; }
      pairingCodeRequested = false;
      reconnectCount = 0;
      logger.info("WhatsApp connected successfully");
    }
    if (connection === "close") {
      isConnected = false;
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      lastDisconnectCode = typeof statusCode === "number" ? statusCode : null;
      lastDisconnectAt = new Date().toISOString();
      // Logged-out, forbidden, conflict, atau bad session perlu pemeriksaan
      // owner; 401 sendiri tidak membuktikan nomor diblokir.
      if (requiresManualReconnect(statusCode)) {
        blocked = true;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = undefined; }
        logger.error({ statusCode }, "WhatsApp session stopped; manual inspection required");
        return;
      }
      // 515 = restart stream normal pasca-handshake → reconnect cepat 1 dtk.
      if (statusCode === 515) {
        logger.info("Stream restart (515), reconnecting in 1s");
        scheduleReconnect(1000);
        return;
      }
      // Sisanya: exponential backoff + jitter (maks ~60 dtk) agar tidak hammer.
      reconnectCount += 1;
      const backoff = Math.min(1000 * 2 ** Math.min(reconnectCount, 6), 60_000);
      const jitter = Math.floor(Math.random() * 2000);
      const delay = backoff + jitter;
      logger.warn({ statusCode, attempt: reconnectCount, delayMs: delay }, "WhatsApp connection closed, backing off");
      scheduleReconnect(delay);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const message of messages) {
      if (!message.message || message.key.fromMe) continue;
      const conversationId = message.key.remoteJid || "";
      if (conversationId !== TARGET_GROUP_ID && conversationId !== notificationGroup?.id) continue;

      // Jeda antrean inbound legacy 1–2,5 dtk; bukan mekanisme anti-ban.
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));

      const content = normalizeMessageContent(message.message);
      const imageMessage = content?.imageMessage;
      const extendedMessage = content?.extendedTextMessage;
      const isGroup = conversationId.endsWith("@g.us");
      const participant = isGroup ? message.key.participant || "" : conversationId;
      const participantAlt = isGroup ? message.key.participantAlt || "" : message.key.remoteJidAlt || "";
      const memberId = (participant.endsWith("@lid") && participantAlt ? participantAlt : participant)
        .replace(/:\d+@/, "@").replace(/@.*$/, "");
      const text = content?.conversation || extendedMessage?.text || imageMessage?.caption || "";
      const inboxId = message.key.id || "";
      const contextInfo = imageMessage?.contextInfo || extendedMessage?.contextInfo;

      rememberInbound(message);

      let mediaPayload: { url: string; filename: string; extension: string } | undefined;
      if (imageMessage && PUBLIC_BASE_URL && sock) {
        try {
          const downloaded = await downloadMediaMessage(
            message,
            "buffer",
            {},
            { logger: logger as any, reuploadRequest: sock.updateMediaMessage },
          );
          const buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);
          const contentType = imageMessage.mimetype || "image/jpeg";
          if (buffer.byteLength <= MAX_MEDIA_BYTES && ["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
            const token = randomBytes(24).toString("hex");
            const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
            mediaFiles.set(token, { buffer, contentType, expiresAt: Date.now() + MEDIA_TTL_MS });
            mediaPayload = { url: `${PUBLIC_BASE_URL}/media/${token}`, filename: `bukti-${inboxId}.${extension}`, extension };
          }
        } catch (error) {
          logger.warn({ error, inboxId }, "Unable to cache incoming image");
        }
      }

      try {
        const quotedText = contextInfo?.quotedMessage
          ? (normalizeMessageContent(contextInfo.quotedMessage)?.conversation
            || normalizeMessageContent(contextInfo.quotedMessage)?.extendedTextMessage?.text
            || normalizeMessageContent(contextInfo.quotedMessage)?.imageMessage?.caption
            || "")
          : undefined;
        const payload = {
          sender: conversationId,
          member: memberId,
          message: text,
          name: message.pushName || "",
          inboxid: inboxId,
          reply: contextInfo?.stanzaId,
          quotedText: quotedText || undefined,
          isGroup,
          ...mediaPayload,
        };
        const response = await fetch(AXVARA_WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "AxvaraBaileysGateway/2.0",
            "x-webhook-token": AXVARA_WEBHOOK_TOKEN,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        });
        logger.info({ status: response.status, inboxId }, "Webhook forwarded");
      } catch (error) {
        logger.error({ error, inboxId }, "Failed to forward webhook");
      }
    }
  });
}

const app = Fastify({ logger: false, bodyLimit: 128 * 1024 });

app.get("/health", async () => ({
  status: "ok",
  connected: isConnected,
  provider: "baileys",
  lastDisconnectCode,
  lastDisconnectAt,
  reconnectCount,
  blocked, lastAckAt, lastSendAt: lastSendAtIso, version: "sales-v1",
}));

app.get<{ Params: { token: string } }>("/media/:token", async (request, reply) => {
  const media = mediaFiles.get(request.params.token);
  if (!media || media.expiresAt <= Date.now()) return reply.status(404).send({ status: false, reason: "media_not_found" });
  mediaFiles.delete(request.params.token);
  return reply.header("Cache-Control", "private, no-store").type(media.contentType).send(media.buffer);
});

// Antrean outbound legacy satu per satu, jeda 4–8 detik untuk membatasi beban.
let sendQueue: Promise<unknown> = Promise.resolve();
let lastSendAt = 0;
// Sinyal sesi/otorisasi; error transport dan restart 515 bukan bukti restriction.
const RESTRICTION_SIGNALS = ["401", "403", "440", "463", "timelock", "forbidden", "restricted", "conflict", "bad session"];
let consecutiveDangerSignals = 0;
const DANGER_PAUSE_MS = 15 * 60_000; // 15 menit cooldown setelah 3 sinyal bahaya
let dangerPausedUntil = 0;

function looksLikeDangerSignal(message: string): boolean {
  const low = message.toLowerCase();
  return RESTRICTION_SIGNALS.some((s) => low.includes(s));
}

function paceSend<T>(fn: () => Promise<T>): Promise<T> {
  const run = sendQueue.then(async () => {
    // Auto-pause lunak: 3 sinyal bahaya berurutan → cooldown 15 menit.
    if (Date.now() < dangerPausedUntil) {
      throw new Error("gateway_cooldown_active");
    }
    const elapsed = Date.now() - lastSendAt;
    const gap = 4000 + Math.floor(Math.random() * 4000); // jeda 4–8 dtk
    if (elapsed < gap) await new Promise((r) => setTimeout(r, gap - elapsed));
    try {
      const out = await fn();
      lastSendAt = Date.now();
      consecutiveDangerSignals = 0;
      return out;
    } catch (error: any) {
      if (looksLikeDangerSignal(String(error?.message || error))) {
        consecutiveDangerSignals += 1;
        if (consecutiveDangerSignals >= 3) {
          dangerPausedUntil = Date.now() + DANGER_PAUSE_MS;
          await pauseOutbound(15);
          consecutiveDangerSignals = 0;
          logger.error("3 danger signals in a row — outbound paused 15 min");
        }
      }
      throw error;
    }
  });
  // Rantai tidak boleh putus oleh satu kegagalan.
  sendQueue = run.catch(() => undefined);
  return run;
}

app.get("/notification-status", async (request, reply) => {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ reason: "unauthorized" });
  let error: string | undefined;
  let group: { id: string; subject: string } | null = null;
  try { group = await resolveNotificationGroup(); } catch (e) { error = e instanceof Error ? e.message : "Grup belum tersedia"; }
  const control = (await pool.query("SELECT paused_until,last_sent_at,last_ack_at FROM axvara_wa_control WHERE phone=$1", [BOT_NUMBER])).rows[0];
  // groupName is the verified configured target; groupSubject preserves the
  // actual WhatsApp title. Pages validates the canonical name before enabling.
  return { connected: isConnected, botNumber: BOT_NUMBER, ...notificationGroupStatus(group), error,
    blocked: blocked || Boolean(control?.paused_until && new Date(control.paused_until).getTime() > Date.now()),
    lastSendAt: control?.last_sent_at, lastAckAt: control?.last_ack_at };
});

app.post("/notification-pair", async (request, reply) => {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ reason: "unauthorized" });
  if (isConnected) return { connected: true, botNumber: BOT_NUMBER };
  if (pairingCode && pairingExpiresAt > Date.now()) return { connected: false, botNumber: BOT_NUMBER, pairingCode };
  if (pairingCodeRequested) return reply.status(409).send({ reason: "Permintaan pairing sedang berjalan. Cek koneksi kembali." });
  if (blocked && lastDisconnectCode !== 401) return reply.status(409).send({ reason: "Sesi dihentikan karena pembatasan/konflik. Periksa WhatsApp sebelum menautkan kembali." });
  pairingCodeRequested = true;
  try {
    if (lastDisconnectCode === 401) {
      // An explicit admin action may replace only this bot's revoked credentials.
      await credsSaved;
      await (await usePostgresAuthState()).clearAuth();
      blocked = false; latestQr = false;
      await startWhatsApp();
    }
    for (let tries = 0; !latestQr && tries < 20; tries++) await new Promise(r => setTimeout(r, 250));
    if (!sock || !latestQr) return reply.status(503).send({ reason: "Koneksi pairing belum siap. Coba kembali sebentar lagi." });
    pairingCode = await sock.requestPairingCode(BOT_NUMBER);
    await credsSaved;
    if (blocked) throw new Error("Pairing session could not be persisted");
    pairingExpiresAt = Date.now()+60_000;
    return { connected: false, botNumber: BOT_NUMBER, pairingCode };
  } catch { return reply.status(503).send({ reason: "Tidak dapat membuat kode pairing. Periksa WhatsApp nomor bot." }); }
  finally { pairingCodeRequested = false; }
});

app.post("/send-notification", async (request, reply) => {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ status: false, reason: "unauthorized" });
  const body = request.body as { target?: string; message?: string; idempotencyKey?: string };
  if (!body || typeof body.message !== "string" || body.message.length > 12_000 || !/^wa:sale-completed:AX[VP]-\d{8}-[A-Z0-9]{8}$/.test(body.idempotencyKey || "")) {
    return reply.status(400).send({ status: false, reason: "invalid_notification" });
  }
  if (!sock || !isConnected || blocked) return reply.status(503).send({ status: false, reason: "whatsapp_not_connected" });
  try {
    const group = await resolveNotificationGroup();
    if (!group || group.id !== body.target) return reply.status(409).send({ status: false, reason: "notification_group_mismatch" });
    const claim = await deliveryClaim(body.idempotencyKey!, group.id, body.message);
    if ("sent" in claim) return { status: true, id: claim.id };
    if ("reason" in claim) return reply.status(claim.outcomeUnknown || claim.reason === "idempotency_conflict" ? 409 : 429).send({ status: false, ...claim });
    const current = sock;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = current.sendMessage(group.id, { text: body.message });
    // Keep observing completion even if the HTTP caller times out. Never send an ambiguous key again.
    void send.then(result => settleDelivery(body.idempotencyKey!, result?.key?.id || undefined)).catch(() => {});
    try {
      const result = await Promise.race([send, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("send_timeout")), 25_000); })]);
      await settleDelivery(body.idempotencyKey!, result?.key?.id || undefined);
      lastSendAtIso = new Date().toISOString();
      if (!result?.key?.id) return reply.status(409).send({ status: false, outcomeUnknown: true, reason: "delivery_outcome_unknown" });
      return { status: true, id: result.key.id };
    } catch (error) {
      await settleDelivery(body.idempotencyKey!);
      await pauseOutbound(isRestriction(error) ? 24*60 : 15);
      if (isRestriction(error)) { blocked = true; void current.end(undefined); }
      if (error instanceof Error && error.message === "send_timeout") { blocked = true; void current.end(undefined); }
      return reply.status(409).send({ status: false, outcomeUnknown: true, reason: "delivery_outcome_unknown" });
    } finally { if (timer) clearTimeout(timer); }
  } catch { return reply.status(503).send({ status: false, reason: "notification_gateway_unavailable" }); }
});

app.post("/send", async (request, reply) => {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ status: false, reason: "unauthorized" });
  const body = request.body as { target?: string; message?: string; inboxId?: string };
  if (!sock || !isConnected) return reply.status(503).send({ status: false, reason: "whatsapp_not_connected" });
  if (!body.target || !body.message) return reply.status(400).send({ status: false, reason: "missing_target_or_message" });
  if (body.target !== TARGET_GROUP_ID && body.target !== notificationGroup?.id) return reply.status(403).send({ status: false, reason: "target_not_allowed" });
  if (Date.now() < dangerPausedUntil) return reply.status(429).send({ status: false, reason: "gateway_cooldown_active" });
  try {
    const quoted = quotedMessage(body.target, body.inboxId);
    const result = await paceSend(() => sock!.sendMessage(body.target!, { text: body.message! }, quoted ? { quoted } : undefined));
    return { status: true, id: result?.key?.id, quoted: Boolean(quoted) };
  } catch (error: any) {
    logger.error({ type: error?.name }, "Failed to send message");
    if (String(error?.message || "") === "gateway_cooldown_active") {
      return reply.status(429).send({ status: false, reason: "gateway_cooldown_active" });
    }
    return reply.status(500).send({ status: false, reason: error?.message || "send_failed" });
  }
});

app.post("/send-image", async (request, reply) => {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ status: false, reason: "unauthorized" });
  const body = request.body as { target?: string; imageUrl?: string; caption?: string; inboxId?: string };
  if (!sock || !isConnected) return reply.status(503).send({ status: false, reason: "whatsapp_not_connected" });
  if (!body.target || !body.imageUrl) return reply.status(400).send({ status: false, reason: "missing_target_or_url" });
  if (body.target !== TARGET_GROUP_ID && body.target !== notificationGroup?.id) return reply.status(403).send({ status: false, reason: "target_not_allowed" });
  if (Date.now() < dangerPausedUntil) return reply.status(429).send({ status: false, reason: "gateway_cooldown_active" });
  try {
    const quoted = quotedMessage(body.target, body.inboxId);
    const result = await paceSend(() => sock!.sendMessage(body.target!, { image: { url: body.imageUrl! }, caption: body.caption }, quoted ? { quoted } : undefined));
    return { status: true, id: result?.key?.id, quoted: Boolean(quoted) };
  } catch (error: any) {
    logger.error({ error }, "Failed to send image");
    if (String(error?.message || "") === "gateway_cooldown_active") {
      return reply.status(429).send({ status: false, reason: "gateway_cooldown_active" });
    }
    return reply.status(500).send({ status: false, reason: error?.message || "image_send_failed" });
  }
});

// Proxy Warung Rebahan (Opsi A): DINONAKTIFKAN 2026-09-14 — traffic WR pindah
// ke app akun kedua `axvara-wr-proxy` (static egress via QuotaGuard).
// Route /wr/* di bawah sengaja mengembalikan 410 agar tidak ada jalur ganda;
// app ini sekarang WhatsApp SAJA. Jangan aktifkan lagi tanpa memindahkan
// ulang whitelist WR.
app.get("/wr/health", async () => ({
  status: "gone",
  reason: "wr_proxy_moved",
  movedTo: "axvara-wr-proxy",
}));
app.all("/wr/*", async (_request, reply) => {
  return reply.status(410).send({ status: false, reason: "wr_proxy_moved" });
});

async function main(): Promise<void> {
  if (!PUBLIC_BASE_URL) logger.warn("PUBLIC_BASE_URL is not set; incoming image proofs will not be forwarded");
  await initializeDurable(() => { blocked = true; shuttingDown = true; void sock?.end(undefined); process.exitCode = 1; setTimeout(() => process.exit(1), 1000).unref(); });
  await app.listen({ port: PORT, host: "0.0.0.0" });
  logger.info({ port: PORT }, "HTTP server listening");
  await startWhatsApp();
}

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  shuttingDown = true; isConnected = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  void (async () => { await sock?.end(undefined); await credsSaved; await app.close(); await pool.end(); process.exit(0); })();
  setTimeout(() => process.exit(1), 8000).unref();
});

main().catch((error) => {
  logger.fatal({ error }, "Fatal startup error");
  process.exit(1);
});
