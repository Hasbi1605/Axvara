import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { Mutex } from "async-mutex";
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
import { pathToFileURL } from "node:url";
import pino from "pino";
import { usePostgresAuthState } from "./pg-auth.js";
import { BOT_NUMBER, botIdentity, matchesBotIdentity, validBotNumber, persistBotNumber, reloadBotIdentity, pool, initializeDurable, deliveryClaim, settleDelivery, releaseUnsentDelivery, pauseOutbound, requiresManualReconnect, isRestriction, groupAllowsBotSend } from "./durable.js";
import { isNotificationGroupName, selectNotificationGroup, notificationGroupStatus, validNotificationKey, notificationContent, currentPromoKey, loadPromoImage } from "./group-target.js";
import { registerPromoBot } from "./promo-bot.js";
import { queueWelcome, drainWelcomes } from "./welcome-inbox.js";
// (registerWrProxy tidak lagi diimpor — proxy WR pindah ke axvara-wr-proxy)

const logger = pino({ name: "axvara-wa-gateway" });
const PORT = Number(process.env.PORT || 3001);
const AXVARA_WEBHOOK_URL = process.env.AXVARA_WEBHOOK_URL || "https://axvara.tech/api/whatsapp/webhook";
const AXVARA_WEBHOOK_TOKEN = process.env.AXVARA_WEBHOOK_TOKEN || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
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
let switching = false;
let configurationFailed = false;
const sessionMutex = new Mutex();
const outboundMutex = new Mutex();
let welcomeDrain: Promise<void> | undefined;
function flushWelcomes() {
  if (shuttingDown) return;
  welcomeDrain ??= Promise.resolve().then(() => {
    const url = new URL(AXVARA_WEBHOOK_URL);
    url.pathname = "/api/whatsapp/group-events"; url.search = "";
    return drainWelcomes(url, AXVARA_WEBHOOK_TOKEN, status => logger.warn({ status }, "Welcome handoff abandoned"));
  }).catch(() => logger.warn("Welcome inbox drain failed")).finally(() => { welcomeDrain = undefined; });
}

function scheduleReconnect(delay: number) {
  if (shuttingDown || blocked || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void startWhatsApp().catch(error => logger.error({ type: error?.name }, "Reconnect failed")); }, delay);
}
async function resolveNotificationGroup() {
  if (!sock || !isConnected || sock.user?.id?.split(":")[0]?.split("@")[0] !== BOT_NUMBER) return null;
  const socket = sock;
  const identity = botIdentity();
  const current = () => sock === socket && isConnected && !switching && matchesBotIdentity(identity);
  if (notificationGroup && (groupMetadataCache.get(notificationGroup.id)?.expiresAt ?? 0) > Date.now()) return notificationGroup;
  const control = (await pool.query("SELECT group_id FROM axvara_wa_runtime WHERE id=1")).rows[0];
  if (!current()) return null;
  if (control?.group_id) {
    const meta = await socket.groupMetadata(control.group_id);
    if (!current()) return null;
    if (!isNotificationGroupName(meta.subject)) throw new Error("Nama grup tujuan berubah; periksa grup sebelum melanjutkan.");
    if (!groupAllowsBotSend(meta, socket.user?.lid)) throw new Error("Pastikan nomor bot menjadi anggota dan memiliki izin mengirim pesan ke grup AXVARA'S.");
    notificationGroup = { id: meta.id, subject: meta.subject };
    groupMetadataCache.set(meta.id, { data: meta, expiresAt: Date.now()+GROUP_METADATA_TTL_MS });
    return notificationGroup;
  }
  const group = selectNotificationGroup(Object.values(await socket.groupFetchAllParticipating()));
  if (!current()) return null;
  if (!groupAllowsBotSend(group, socket.user?.lid)) throw new Error("Pastikan nomor bot menjadi anggota dan memiliki izin mengirim pesan ke grup AXVARA'S.");
  await pool.query("UPDATE axvara_wa_runtime SET group_id=$1 WHERE id=1 AND group_id IS NULL AND phone=$2 AND revision=$3", [group.id, identity.botNumber, identity.botRevision]);
  if (!current()) return null;
  notificationGroup = { id: group.id, subject: group.subject };
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

async function stopSocket() {
  const old = sock;
  sock = null; isConnected = false;
  if (old) {
    for (const event of ["connection.update", "creds.update", "messages.upsert", "groups.update", "group-participants.update", "messages.update"] as const) old.ev.removeAllListeners(event);
    try { await old.end(undefined); } catch { /* already closed */ }
  }
  await credsSaved;
}

function startWhatsApp(): Promise<void> {
  if (blocked || switching || shuttingDown) return Promise.resolve();
  if (starting) return starting;
  starting = startSocket().finally(() => { starting = null; });
  return starting;
}
async function startSocket(): Promise<void> {
  await credsSaved;
  const { state, saveCreds } = await usePostgresAuthState(BOT_NUMBER);
  const phone = BOT_NUMBER;
  await stopSocket();
  if (switching || shuttingDown) return;
  const socket = makeWASocket({
    auth: state,
    getMessage: async key => {
      const cached = inboundMessages.get(cacheKey(key.remoteJid || "", key.id || ""));
      if (cached) return cached.message.message || undefined;
      const row = (await pool.query("SELECT key,payload FROM axvara_wa_delivery WHERE message_id=$1 AND target=$2", [key.id, key.remoteJid])).rows[0];
      if (row?.key.startsWith("wa:promo:")) return proto.Message.fromObject(JSON.parse(row.payload));
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
        if (sock !== socket || BOT_NUMBER !== phone) return undefined;
        const meta = await socket.groupMetadata(jid);
        if (meta && sock === socket && BOT_NUMBER === phone) groupMetadataCache.set(jid, { data: meta, expiresAt: Date.now() + GROUP_METADATA_TTL_MS });
        return meta;
      } catch {
        return undefined;
      }
    },
  });
  sock = socket;
  const current = () => sock === socket && BOT_NUMBER === phone && !switching && !shuttingDown;
  socket.ev.on("creds.update", () => {
    if (!current()) return;
    credsSaved = credsSaved.then(saveCreds).catch(() => { if (current()) { blocked = true; void socket.end(undefined); } logger.error("Unable to persist session; stopped"); });
  });
  socket.ev.on("groups.update", updates => { if (!current()) return; for (const group of updates) if (group.id) { groupMetadataCache.delete(group.id); if (notificationGroup?.id === group.id) notificationGroup = null; } });
  socket.ev.on("group-participants.update", async update => {
    if (!current()) return;
    groupMetadataCache.delete(update.id);
    if (notificationGroup?.id === update.id) notificationGroup = null;
    if (update.action !== "add") return;
    const identity = botIdentity();
    const observedAt = Date.now();
    try {
      const group = await resolveNotificationGroup();
      if (!current() || !matchesBotIdentity(identity) || group?.id !== update.id) return;
      const own = new Set([socket.user?.id?.replace(/:\d+@/, "@"), socket.user?.lid, `${phone}@s.whatsapp.net`].filter(Boolean));
      const members = update.participants.filter(p => !own.has(p.id) && !own.has(p.phoneNumber) && !own.has(p.lid))
        .slice(0, 100).map(p => ({ id: p.id, name: (p.notify || p.name || p.verifiedName || "").slice(0, 200) }));
      if (!members.length) return;
      await queueWelcome({ event: "member_join", observedAt, groupId: group.id, members, ...identity });
      void flushWelcomes();
    } catch { logger.warn("Group welcome could not be queued"); }
  });
  socket.ev.on("messages.update", updates => {
    if (!current()) return;
    if (updates.some(entry => Number(entry.update.status) >= 3)) {
      lastAckAt = new Date().toISOString();
      void pool.query("UPDATE axvara_wa_control SET last_ack_at=now() WHERE phone=$1", [phone]).catch(() => {});
    }
  });

  socket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (!current()) return;
    if (qr) {
      latestQr = true;
    }
    if (connection === "open") {
      isConnected = true;
      latestQr = false; pairingCode = "";
      if (socket.user?.id?.split(":")[0]?.split("@")[0] !== phone) { blocked = true; isConnected = false; void socket.end(undefined); return; }
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

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (!current() || type !== "notify") return;
    for (const message of messages) {
      if (!message.message || message.key.fromMe) continue;
      const conversationId = message.key.remoteJid || "";
      if (conversationId !== TARGET_GROUP_ID && conversationId !== notificationGroup?.id) continue;

      // Jeda antrean inbound legacy 1–2,5 dtk; bukan mekanisme anti-ban.
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));

      if (!current()) return;
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
            { logger: logger as any, reuploadRequest: socket.updateMediaMessage },
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
        if (!current()) return;
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
const promoBot = registerPromoBot(app, { validGatewayToken, getMainBotNumber: () => BOT_NUMBER, logger });

setInterval(() => {
  logger.info({ memoryRssMb: Math.round(process.memoryUsage().rss / 1e6) }, "Gateway memory RSS");
}, 10 * 60_000).unref();

app.get("/health", async () => ({
  status: "ok",
  connected: isConnected,
  provider: "baileys",
  lastDisconnectCode,
  lastDisconnectAt,
  reconnectCount,
  blocked, lastAckAt, lastSendAt: lastSendAtIso, version: "sales-v1",
  promoBot: promoBot.health(),
  memoryRssMb: Math.round(process.memoryUsage().rss / 1e6),
}));

app.get<{ Params: { token: string } }>("/media/:token", async (request, reply) => {
  const media = mediaFiles.get(request.params.token);
  if (!media || media.expiresAt <= Date.now()) return reply.status(404).send({ status: false, reason: "media_not_found" });
  mediaFiles.delete(request.params.token);
  return reply.header("Cache-Control", "private, no-store").type(media.contentType).send(media.buffer);
});

// Antrean outbound legacy satu per satu, jeda 4–8 detik untuk membatasi beban.
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

function paceSend<T>(phone: string, fn: () => Promise<T>): Promise<T> {
  return outboundMutex.runExclusive(async () => {
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
          await pauseOutbound(15, phone);
          consecutiveDangerSignals = 0;
          logger.error("3 danger signals in a row — outbound paused 15 min");
        }
      }
      throw error;
    }
  });
}

function captureSendSession() {
  const socket = sock;
  const identity = botIdentity();
  return { socket, identity, current: () => sock === socket && isConnected && !blocked && !switching && !shuttingDown && matchesBotIdentity(identity) };
}

app.get("/notification-status", async (request, reply) => sessionMutex.runExclusive(async () => {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ reason: "unauthorized" });
  if (configurationFailed) await reloadBotIdentity();
  let error: string | undefined;
  let group: { id: string; subject: string } | null = null;
  try { group = await resolveNotificationGroup(); } catch (e) { error = e instanceof Error ? e.message : "Grup belum tersedia"; }
  const control = (await pool.query("SELECT paused_until,last_sent_at,last_ack_at FROM axvara_wa_control WHERE phone=$1", [BOT_NUMBER])).rows[0];
  // groupName is the verified configured target; groupSubject preserves the
  // actual WhatsApp title. Pages validates the canonical name before enabling.
  return { connected: isConnected, ...botIdentity(), ...notificationGroupStatus(group), error,
    blocked: blocked || Boolean(control?.paused_until && new Date(control.paused_until).getTime() > Date.now()),
    lastSendAt: control?.last_sent_at, lastAckAt: control?.last_ack_at };
}));

app.post("/notification-number", async (request, reply) => sessionMutex.runExclusive(async () => {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ reason: "unauthorized" });
  const body = request.body as { newBotNumber?: string; botNumber?: string; botRevision?: string };
  if (!body || !validBotNumber(body.newBotNumber) || !validBotNumber(body.botNumber) || typeof body.botRevision !== "string") return reply.status(400).send({ reason: "invalid_bot_number" });
  if (!matchesBotIdentity(body)) return reply.status(409).send({ reason: "bot_configuration_changed" });
  if (body.newBotNumber === BOT_NUMBER && !configurationFailed) return { connected: isConnected, ...botIdentity() };
  switching = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = undefined; }
  try {
    await starting;
    await stopSocket();
    // Drop permissions/pairing from the old phone before the commit too: its
    // outcome may be ambiguous, and recovery can load a different identity.
    notificationGroup = null; groupMetadataCache.clear(); inboundMessages.clear(); mediaFiles.clear();
    latestQr = false; pairingCode = ""; pairingExpiresAt = 0; pairingCodeRequested = false;
    await persistBotNumber(body.newBotNumber, body);
    promoBot.onMainBotNumberChanged();
    reconnectCount = 0; lastDisconnectCode = null; lastDisconnectAt = null;
    lastAckAt = null; lastSendAtIso = null; blocked = false; configurationFailed = false;
    switching = false;
    // Start the selected session. Pairing still requires a separate owner action.
    await startWhatsApp();
    return { connected: isConnected, ...botIdentity() };
  } catch {
    blocked = true; configurationFailed = true;
    await stopSocket();
    notificationGroup = null; groupMetadataCache.clear(); latestQr = false; pairingCode = "";
    await reloadBotIdentity().catch(() => {});
    return reply.status(503).send({ reason: "Tidak dapat mengganti nomor bot. Cek koneksi sebelum mencoba lagi." });
  } finally { switching = false; }
}));

app.post("/notification-pair", async (request, reply) => sessionMutex.runExclusive(async () => {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ reason: "unauthorized" });
  if (!matchesBotIdentity((request.body || {}) as { botNumber?: string; botRevision?: string })) return reply.status(409).send({ reason: "bot_configuration_changed" });
  if (configurationFailed) {
    await reloadBotIdentity();
    if (!matchesBotIdentity((request.body || {}) as { botNumber?: string; botRevision?: string })) return reply.status(409).send({ reason: "bot_configuration_changed" });
    blocked = false; configurationFailed = false; latestQr = false; lastDisconnectCode = null;
    await startWhatsApp();
  }
  if (isConnected) return { connected: true, ...botIdentity() };
  if (pairingCode && pairingExpiresAt > Date.now()) return { connected: false, ...botIdentity(), pairingCode };
  if (pairingCodeRequested) return reply.status(409).send({ reason: "Permintaan pairing sedang berjalan. Cek koneksi kembali." });
  if (blocked && lastDisconnectCode !== 401) return reply.status(409).send({ reason: "Sesi dihentikan karena pembatasan/konflik. Periksa WhatsApp sebelum menautkan kembali." });
  pairingCodeRequested = true;
  try {
    if (lastDisconnectCode === 401) {
      // An explicit admin action may replace only this bot's revoked credentials.
      await credsSaved;
      await (await usePostgresAuthState(BOT_NUMBER)).clearAuth();
      blocked = false; latestQr = false;
      await startWhatsApp();
    }
    for (let tries = 0; !latestQr && tries < 20; tries++) await new Promise(r => setTimeout(r, 250));
    if (!sock || !latestQr) return reply.status(503).send({ reason: "Koneksi pairing belum siap. Coba kembali sebentar lagi." });
    pairingCode = await sock.requestPairingCode(BOT_NUMBER);
    await credsSaved;
    if (blocked) throw new Error("Pairing session could not be persisted");
    pairingExpiresAt = Date.now()+60_000;
    return { connected: false, ...botIdentity(), pairingCode };
  } catch { return reply.status(503).send({ reason: "Tidak dapat membuat kode pairing. Periksa WhatsApp nomor bot." }); }
  finally { pairingCodeRequested = false; }
}));

async function sendGroupNotification(request: FastifyRequest, reply: FastifyReply, kind: boolean | "welcome" | "promo") {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ status: false, reason: "unauthorized" });
  const body = request.body as { target?: string; message?: string; idempotencyKey?: string; botNumber?: string; botRevision?: string; welcomeExpiresAt?: number };
  if (!body || typeof body.message !== "string" || !body.message.trim() || body.message.length > 12_000 || !validNotificationKey(body.idempotencyKey, kind)) {
    return reply.status(400).send({ status: false, reason: "invalid_notification" });
  }
  if (kind === "welcome" && body.welcomeExpiresAt !== undefined && !Number.isSafeInteger(body.welcomeExpiresAt)) {
    return reply.status(400).send({ status: false, reason: "invalid_notification" });
  }
  const expired = () => kind === "promo" && !currentPromoKey(body.idempotencyKey!) ? "promo_expired" :
    kind === "welcome" && (body.welcomeExpiresAt ?? Infinity) <= Date.now() ? "welcome_expired" : null;
  if (!matchesBotIdentity(body)) return reply.status(409).send({ status: false, reason: "bot_configuration_changed" });
  if (expired()) return reply.status(410).send({ status: false, reason: expired() });
  if (!sock || !isConnected || blocked) return reply.status(503).send({ status: false, reason: "whatsapp_not_connected" });
  const session = captureSendSession();
  return outboundMutex.runExclusive(async () => {
  try {
    const admitted = await sessionMutex.runExclusive(async () => {
    const current = session.socket!;
    const phone = session.identity.botNumber;
    if (!matchesBotIdentity(body)) return reply.status(409).send({ status: false, reason: "bot_configuration_changed" });
    if (!session.current()) return reply.status(503).send({ status: false, reason: "whatsapp_not_connected" });
    const group = await resolveNotificationGroup();
    if (!session.current()) return reply.status(503).send({ status: false, reason: "whatsapp_not_connected" });
    if (!group || group.id !== body.target) return reply.status(409).send({ status: false, reason: "notification_group_mismatch" });
    const content = notificationContent(body.message!, kind);
    let image: Buffer | undefined;
    if (kind === "promo") {
      try { image = await loadPromoImage(); }
      catch { return reply.status(503).send({ status: false, reason: "promo_image_unavailable" }); }
    }
    if (expired()) return reply.status(410).send({ status: false, reason: expired() });
    if (!session.current() || notificationGroup?.id !== group.id) return reply.status(503).send({ status: false, reason: "notification_gateway_unavailable" });
    const claim = await deliveryClaim(body.idempotencyKey!, group.id, kind === "promo" ? JSON.stringify(content) : body.message!, phone);
    if ("sent" in claim) return { status: true, id: claim.id };
    if ("reason" in claim) return reply.status(claim.outcomeUnknown || claim.reason === "idempotency_conflict" ? 409 : 429).send({ status: false, ...claim });
    const expiryReason = expired();
    if (!session.current() || notificationGroup?.id !== group.id || expiryReason) {
      await releaseUnsentDelivery(body.idempotencyKey!);
      return reply.status(expiryReason ? 410 : 503).send({ status: false, reason: expiryReason || "notification_gateway_unavailable" });
    }
    // Wrap the socket promise so the session lock releases at admission, not on completion.
    const send = current.sendMessage(group.id, image ? { image, caption: body.message } : content);
    void send.catch(() => {});
    return { started: true as const, pending: send, current, phone };
    });
    if (admitted.started !== true) return admitted;
    const { pending: send, current, phone } = admitted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Keep observing completion even if the HTTP caller times out. Never send an ambiguous key again.
    const settle = (result: WAMessage | undefined) => settleDelivery(body.idempotencyKey!, result?.key?.id || undefined, phone, kind === "promo" && result?.message ? JSON.stringify(result.message) : undefined);
    void send.then(settle).catch(() => {});
    try {
      const result = await Promise.race([send, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("send_timeout")), 25_000); })]);
      await settle(result);
      if (matchesBotIdentity(session.identity)) lastSendAtIso = new Date().toISOString();
      if (!result?.key?.id) return reply.status(409).send({ status: false, outcomeUnknown: true, reason: "delivery_outcome_unknown" });
      return { status: true, id: result.key.id };
    } catch (error) {
      await settleDelivery(body.idempotencyKey!, undefined, phone);
      await pauseOutbound(isRestriction(error) ? 24*60 : 15, phone);
      if (session.current() && (isRestriction(error) || (error instanceof Error && error.message === "send_timeout"))) { blocked = true; void current.end(undefined); }
      return reply.status(409).send({ status: false, outcomeUnknown: true, reason: "delivery_outcome_unknown" });
    } finally { if (timer) clearTimeout(timer); }
  } catch { return reply.status(503).send({ status: false, reason: "notification_gateway_unavailable" }); }
  });
}
app.post("/send-notification", (request, reply) => reply.status(validGatewayToken(request.headers["x-gateway-token"]) ? 410 : 401).send({ status: false, reason: "sales_notifications_retired" }));
app.post("/send-promo", (request, reply) => sendGroupNotification(request, reply, "promo"));
app.post("/send-broadcast", (request, reply) => sendGroupNotification(request, reply, true));
app.post("/send-welcome", (request, reply) => sendGroupNotification(request, reply, "welcome"));

async function sendLegacy(request: FastifyRequest, reply: FastifyReply, image: boolean) {
  if (!validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ status: false, reason: "unauthorized" });
  const body = (request.body ?? {}) as { target?: string; message?: string; imageUrl?: string; caption?: string; inboxId?: string };
  if (!sock || !isConnected) return reply.status(503).send({ status: false, reason: "whatsapp_not_connected" });
  const target = body.target;
  if (!target || !(image ? body.imageUrl : body.message)) return reply.status(400).send({ status: false, reason: image ? "missing_target_or_url" : "missing_target_or_message" });
  const allowed = () => target === TARGET_GROUP_ID || target === notificationGroup?.id;
  if (!allowed()) return reply.status(403).send({ status: false, reason: "target_not_allowed" });
  if (Date.now() < dangerPausedUntil) return reply.status(429).send({ status: false, reason: "gateway_cooldown_active" });
  const session = captureSendSession();
  try {
    return await paceSend(session.identity.botNumber, async () => {
      const admitted = await sessionMutex.runExclusive(() => {
        if (!matchesBotIdentity(session.identity)) return { rejection: [409, "bot_configuration_changed"] } as const;
        if (!session.current()) return { rejection: [503, "whatsapp_not_connected"] } as const;
        if (!allowed()) return { rejection: [403, "target_not_allowed"] } as const;
        const quoted = quotedMessage(target, body.inboxId);
        const content = image ? { image: { url: body.imageUrl! }, caption: body.caption } : { text: body.message! };
        const pending = session.socket!.sendMessage(target, content, quoted ? { quoted } : undefined);
        void pending.catch(() => {});
        return { pending, quoted: Boolean(quoted) };
      });
      if (admitted.rejection) throw new LegacyAdmissionError(admitted.rejection[0], admitted.rejection[1]);
      return { status: true, id: (await admitted.pending)?.key?.id, quoted: admitted.quoted };
    });
  } catch (error: any) {
    if (error instanceof LegacyAdmissionError) return reply.status(error.status).send({ status: false, reason: error.message });
    logger.error({ type: error?.name }, "Failed to send message");
    if (String(error?.message || "") === "gateway_cooldown_active") {
      return reply.status(429).send({ status: false, reason: "gateway_cooldown_active" });
    }
    return reply.status(500).send({ status: false, reason: error?.message || (image ? "image_send_failed" : "send_failed") });
  }
}
class LegacyAdmissionError extends Error {
  constructor(readonly status: number, reason: string) { super(reason); }
}
app.post("/send", (request, reply) => sendLegacy(request, reply, false));
app.post("/send-image", (request, reply) => sendLegacy(request, reply, true));

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
  await initializeDurable(() => { blocked = true; shuttingDown = true; void sock?.end(undefined); void promoBot.stop(); process.exitCode = 1; setTimeout(() => process.exit(1), 1000).unref(); });
  setInterval(flushWelcomes, 5_000).unref();
  flushWelcomes();
  await app.listen({ port: PORT, host: "0.0.0.0" });
  logger.info({ port: PORT }, "HTTP server listening");
  await startWhatsApp();
  await promoBot.start().catch((error) => {
    logger.error({ error }, "Promo bot startup failed; main bot unaffected");
  });
}

export { app, startWhatsApp };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  shuttingDown = true; isConnected = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  void (async () => { await sock?.end(undefined); await credsSaved; await promoBot.stop(); await app.close(); await pool.end(); process.exit(0); })();
  setTimeout(() => process.exit(1), 8000).unref();
});

main().catch((error) => {
  logger.fatal({ error }, "Fatal startup error");
  process.exit(1);
});
}
