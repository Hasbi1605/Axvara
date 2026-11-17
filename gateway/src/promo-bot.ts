import type { FastifyInstance } from "fastify";
import { Mutex } from "async-mutex";
import makeWASocket, {
  Browsers,
  proto,
  type GroupMetadata,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import { usePostgresAuthState } from "./pg-auth.js";
import {
  PROMO_BOT_NUMBER,
  PROMO_BOT_REVISION,
  promoBotIdentity,
  matchesPromoBotIdentity,
  validBotNumber,
  initializePromoRuntime,
  persistPromoBotNumber,
  reloadPromoBotIdentity,
  pool,
  deliveryClaim,
  settleDelivery,
  pauseOutbound,
  requiresManualReconnect,
  isRestriction,
  groupAllowsBotSend,
} from "./durable.js";
import {
  validPromoBotKey,
  currentPromoBotKey,
  promoBotKeyMatchesTarget,
  notificationContent,
  loadPromoImage,
} from "./group-target.js";

export interface PromoBotDeps {
  validGatewayToken: (raw: unknown) => boolean;
  getMainBotNumber: () => string;
  logger: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
  createSocket?: typeof makeWASocket;
  loadImage?: typeof loadPromoImage;
  authProvider?: typeof usePostgresAuthState;
  sendTimeoutMs?: number;
}

export interface PromoBotController {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  health: () => { configured: boolean; connected: boolean; blocked: boolean };
  onMainBotNumberChanged: () => void;
}

const GROUP_METADATA_TTL_MS = 5 * 60_000;
const SOCKET_EVENTS = [
  "connection.update",
  "creds.update",
  "groups.update",
  "group-participants.update",
  "messages.update",
] as const;

export function registerPromoBot(app: FastifyInstance, deps: PromoBotDeps): PromoBotController {
  const createSocket = deps.createSocket ?? makeWASocket;
  const loadImage = deps.loadImage ?? loadPromoImage;
  const authProvider = deps.authProvider ?? usePostgresAuthState;
  const sendTimeoutMs = deps.sendTimeoutMs ?? 25_000;

  let sock: WASocket | null = null;
  let isConnected = false;
  let blocked = false;
  let switching = false;
  let configurationFailed = false;
  let shuttingDown = false;
  let starting: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let credsSaved: Promise<void> = Promise.resolve();
  let latestQr = false;
  let pairingCode = "";
  let pairingExpiresAt = 0;
  let pairingCodeRequested = false;
  let reconnectCount = 0;
  let lastDisconnectCode: number | null = null;
  let lastDisconnectAt: string | null = null;
  let lastError: string | undefined;

  const promoMutex = new Mutex();
  const groupMetadataCache = new Map<string, { data: GroupMetadata; expiresAt: number }>();
  let participatingCache: { data: Record<string, GroupMetadata>; expiresAt: number } | null = null;

  function toIsoOrNull(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
  }

  function scheduleReconnect(delay: number) {
    if (shuttingDown || blocked || switching || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void startPromoWhatsApp().catch(error => deps.logger.error({ type: error?.name }, "Promo bot reconnect failed"));
    }, delay);
  }

  async function stopSocket() {
    const old = sock;
    sock = null;
    isConnected = false;
    if (old) {
      for (const event of SOCKET_EVENTS) old.ev.removeAllListeners(event);
      try {
        await old.end(undefined);
      } catch {
        /* already closed */
      }
    }
    await credsSaved;
  }

  function startPromoWhatsApp(): Promise<void> {
    if (!PROMO_BOT_NUMBER || switching || shuttingDown) return Promise.resolve();
    if (PROMO_BOT_NUMBER === deps.getMainBotNumber()) {
      blocked = true;
      isConnected = false;
      lastError = "Nomor promo bot tidak boleh sama dengan nomor notifikasi utama.";
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      return Promise.resolve();
    }
    if (blocked) return Promise.resolve();
    if (starting) return starting;
    starting = startSocket().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function startSocket(): Promise<void> {
    await credsSaved;
    const phone = PROMO_BOT_NUMBER;
    if (!phone || switching || shuttingDown) return;
    if (phone === deps.getMainBotNumber()) {
      blocked = true;
      isConnected = false;
      lastError = "Nomor promo bot tidak boleh sama dengan nomor notifikasi utama.";
      await stopSocket();
      return;
    }
    const { state, saveCreds } = await authProvider(phone);
    await stopSocket();
    if (switching || shuttingDown || PROMO_BOT_NUMBER !== phone) return;

    const socket = createSocket({
      auth: state,
      getMessage: async key => {
        const row = (
          await pool.query(
            "SELECT key,payload FROM axvara_wa_delivery WHERE message_id=$1 AND target=$2",
            [key.id, key.remoteJid],
          )
        ).rows[0];
        if (row?.key?.startsWith("wa:promo2:")) return proto.Message.fromObject(JSON.parse(row.payload));
        return undefined;
      },
      logger: deps.logger as any,
      browser: Browsers.macOS("Safari"),
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      cachedGroupMetadata: async jid => {
        const hit = groupMetadataCache.get(jid);
        if (hit && hit.expiresAt > Date.now()) return hit.data;
        try {
          if (sock !== socket || PROMO_BOT_NUMBER !== phone) return undefined;
          const meta = await socket.groupMetadata(jid);
          if (meta && sock === socket && PROMO_BOT_NUMBER === phone) {
            groupMetadataCache.set(jid, { data: meta, expiresAt: Date.now() + GROUP_METADATA_TTL_MS });
          }
          return meta;
        } catch {
          return undefined;
        }
      },
    });
    sock = socket;
    const current = () => sock === socket && PROMO_BOT_NUMBER === phone && !switching && !shuttingDown;

    socket.ev.on("creds.update", () => {
      if (!current()) return;
      credsSaved = credsSaved.then(saveCreds).catch(() => {
        if (current()) {
          blocked = true;
          lastError = "Gagal menyimpan kredensial sesi promo.";
          void socket.end(undefined);
        }
        deps.logger.error("Unable to persist promo bot session; stopped");
      });
    });

    socket.ev.on("groups.update", updates => {
      if (!current()) return;
      for (const group of updates) {
        if (group.id) groupMetadataCache.delete(group.id);
      }
      participatingCache = null;
    });

    socket.ev.on("group-participants.update", update => {
      if (!current()) return;
      groupMetadataCache.delete(update.id);
      participatingCache = null;
    });

    socket.ev.on("messages.update", updates => {
      if (!current()) return;
      if (updates.some(entry => Number(entry.update.status) >= 3)) {
        void pool.query("UPDATE axvara_wa_control SET last_ack_at=now() WHERE phone=$1", [phone]).catch(() => {});
      }
    });

    socket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (!current()) return;
      if (qr) latestQr = true;
      if (connection === "open") {
        isConnected = true;
        latestQr = false;
        pairingCode = "";
        if (phone === deps.getMainBotNumber() || socket.user?.id?.split(":")[0]?.split("@")[0] !== phone) {
          blocked = true;
          isConnected = false;
          lastError = phone === deps.getMainBotNumber()
            ? "Nomor promo bot tidak boleh sama dengan nomor notifikasi utama."
            : "Nomor WhatsApp terhubung tidak cocok dengan nomor promo bot.";
          void socket.end(undefined);
          return;
        }
        pairingCodeRequested = false;
        reconnectCount = 0;
        lastError = undefined;
        deps.logger.info("Promo bot WhatsApp connected successfully");
      }
      if (connection === "close") {
        isConnected = false;
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        lastDisconnectCode = typeof statusCode === "number" ? statusCode : null;
        lastDisconnectAt = new Date().toISOString();
        if (requiresManualReconnect(statusCode)) {
          blocked = true;
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = undefined;
          }
          lastError = `Sesi promo berhenti (kode ${statusCode}); perlu pemeriksaan manual.`;
          deps.logger.error({ statusCode }, "Promo bot session stopped; manual inspection required");
          return;
        }
        if (statusCode === 515) {
          deps.logger.info("Promo bot stream restart (515), reconnecting in 1s");
          scheduleReconnect(1000);
          return;
        }
        reconnectCount += 1;
        const backoff = Math.min(1000 * 2 ** Math.min(reconnectCount, 6), 60_000);
        const jitter = Math.floor(Math.random() * 2000);
        const delay = backoff + jitter;
        deps.logger.warn({ statusCode, attempt: reconnectCount, delayMs: delay }, "Promo bot connection closed, backing off");
        scheduleReconnect(delay);
      }
    });
  }

  function matchesConfiguredIdentity(value: { botNumber?: unknown; botRevision?: unknown }): boolean {
    return (
      PROMO_BOT_NUMBER !== null &&
      PROMO_BOT_REVISION !== null &&
      typeof value.botNumber === "string" &&
      typeof value.botRevision === "string" &&
      matchesPromoBotIdentity({ botNumber: value.botNumber, botRevision: value.botRevision })
    );
  }

  async function buildPromoStatus() {
    if (!PROMO_BOT_NUMBER) {
      return {
        configured: false,
        connected: false,
        blocked: false,
        botNumber: null,
        botRevision: null,
        lastSendAt: null,
        lastAckAt: null,
        ...(lastError ? { error: lastError } : {}),
      };
    }
    if (PROMO_BOT_NUMBER === deps.getMainBotNumber()) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      blocked = true;
      isConnected = false;
      lastError = "Nomor promo bot tidak boleh sama dengan nomor notifikasi utama.";
      if (sock) await stopSocket();
    }
    const control = (
      await pool.query("SELECT paused_until,last_sent_at,last_ack_at FROM axvara_wa_control WHERE phone=$1", [PROMO_BOT_NUMBER])
    ).rows[0];
    const paused = Boolean(control?.paused_until && new Date(control.paused_until).getTime() > Date.now());
    return {
      configured: true,
      connected: isConnected,
      blocked: blocked || paused,
      ...promoBotIdentity(),
      lastSendAt: toIsoOrNull(control?.last_sent_at),
      lastAckAt: toIsoOrNull(control?.last_ack_at),
      ...(lastError ? { error: lastError } : {}),
    };
  }

  app.get("/promo-bot/status", async (request, reply) =>
    promoMutex.runExclusive(async () => {
      if (!deps.validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ reason: "unauthorized" });
      if (configurationFailed) await reloadPromoBotIdentity();
      return buildPromoStatus();
    }),
  );

  app.post("/promo-bot/number", async (request, reply) =>
    promoMutex.runExclusive(async () => {
      if (!deps.validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ reason: "unauthorized" });
      const body = request.body as { newBotNumber?: unknown; botNumber?: string | null; botRevision?: string | null } | undefined;
      const validExpectedNull = body?.botNumber === null && body?.botRevision === null;
      const validExpectedConfigured = validBotNumber(body?.botNumber) && typeof body?.botRevision === "string" && body.botRevision.length > 0;
      if (!body || !validBotNumber(body.newBotNumber) || (!validExpectedNull && !validExpectedConfigured)) {
        return reply.status(400).send({ reason: "invalid_bot_number" });
      }
      if (body.newBotNumber === deps.getMainBotNumber()) {
        return reply.status(409).send({ reason: "same_as_notification_bot" });
      }
      if (!matchesPromoBotIdentity(body)) {
        return reply.status(409).send({ reason: "bot_configuration_changed" });
      }
      if (body.newBotNumber === PROMO_BOT_NUMBER && !configurationFailed) {
        return buildPromoStatus();
      }
      switching = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      try {
        await starting;
        await stopSocket();
        groupMetadataCache.clear();
        participatingCache = null;
        latestQr = false;
        pairingCode = "";
        pairingExpiresAt = 0;
        pairingCodeRequested = false;
        await persistPromoBotNumber(body.newBotNumber, { botNumber: body.botNumber, botRevision: body.botRevision });
        reconnectCount = 0;
        lastDisconnectCode = null;
        lastDisconnectAt = null;
        blocked = false;
        configurationFailed = false;
        lastError = undefined;
        switching = false;
        await startPromoWhatsApp();
        return buildPromoStatus();
      } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        if (reason === "bot_configuration_changed" || reason === "same_as_notification_bot") {
          await reloadPromoBotIdentity().catch(() => {});
          return reply.status(409).send({ reason });
        }
        blocked = true;
        configurationFailed = true;
        lastError = reason || "Tidak dapat mengganti nomor promo bot.";
        await stopSocket();
        groupMetadataCache.clear();
        participatingCache = null;
        latestQr = false;
        pairingCode = "";
        await reloadPromoBotIdentity().catch(() => {});
        return reply.status(503).send({ reason: "Tidak dapat mengganti nomor promo bot. Cek koneksi sebelum mencoba lagi." });
      } finally {
        switching = false;
      }
    }),
  );

  app.post("/promo-bot/pair", async (request, reply) =>
    promoMutex.runExclusive(async () => {
      if (!deps.validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ reason: "unauthorized" });
      const body = (request.body || {}) as { botNumber?: unknown; botRevision?: unknown };
      if (!matchesConfiguredIdentity(body)) return reply.status(409).send({ reason: "bot_configuration_changed" });
      if (configurationFailed) {
        await reloadPromoBotIdentity();
        if (!matchesConfiguredIdentity(body)) return reply.status(409).send({ reason: "bot_configuration_changed" });
        if (PROMO_BOT_NUMBER === deps.getMainBotNumber()) {
          blocked = true;
          lastError = "Nomor promo bot tidak boleh sama dengan nomor notifikasi utama.";
          return reply.status(409).send({ reason: "same_as_notification_bot" });
        }
        blocked = false;
        configurationFailed = false;
        latestQr = false;
        lastDisconnectCode = null;
        lastError = undefined;
        await startPromoWhatsApp();
      }
      const phone = PROMO_BOT_NUMBER!;
      if (phone === deps.getMainBotNumber()) {
        blocked = true;
        lastError = "Nomor promo bot tidak boleh sama dengan nomor notifikasi utama.";
        return reply.status(409).send({ reason: "same_as_notification_bot" });
      }
      if (isConnected) return { connected: true, ...promoBotIdentity() };
      if (pairingCode && pairingExpiresAt > Date.now()) return { connected: false, ...promoBotIdentity(), pairingCode };
      if (pairingCodeRequested) return reply.status(409).send({ reason: "Permintaan pairing sedang berjalan. Cek koneksi kembali." });
      if (blocked && lastDisconnectCode !== 401) {
        return reply.status(409).send({ reason: "Sesi dihentikan karena pembatasan/konflik. Periksa WhatsApp sebelum menautkan kembali." });
      }
      pairingCodeRequested = true;
      try {
        if (lastDisconnectCode === 401) {
          await credsSaved;
          await (await authProvider(phone)).clearAuth();
          blocked = false;
          latestQr = false;
          lastError = undefined;
          await startPromoWhatsApp();
        }
        for (let tries = 0; !latestQr && tries < 20; tries++) await new Promise(r => setTimeout(r, 250));
        if (!sock || !latestQr) return reply.status(503).send({ reason: "Koneksi pairing belum siap. Coba kembali sebentar lagi." });
        pairingCode = await sock.requestPairingCode(phone);
        await credsSaved;
        if (blocked) throw new Error("Pairing session could not be persisted");
        pairingExpiresAt = Date.now() + 60_000;
        return { connected: false, ...promoBotIdentity(), pairingCode };
      } catch {
        return reply.status(503).send({ reason: "Tidak dapat membuat kode pairing. Periksa WhatsApp nomor promo bot." });
      } finally {
        pairingCodeRequested = false;
      }
    }),
  );

  app.get("/promo-bot/groups", async (request, reply) =>
    promoMutex.runExclusive(async () => {
      if (!deps.validGatewayToken(request.headers["x-gateway-token"])) return reply.status(401).send({ reason: "unauthorized" });
      const query = (request.query || {}) as { botNumber?: unknown; botRevision?: unknown };
      if (!matchesConfiguredIdentity(query)) return reply.status(409).send({ reason: "bot_configuration_changed" });
      if (!sock || !isConnected || blocked || PROMO_BOT_NUMBER === deps.getMainBotNumber()) {
        return reply.status(503).send({ reason: "whatsapp_not_connected" });
      }
      try {
        let participating: Record<string, GroupMetadata>;
        if (participatingCache && participatingCache.expiresAt > Date.now()) {
          participating = participatingCache.data;
        } else {
          participating = await sock.groupFetchAllParticipating();
          const expiresAt = Date.now() + GROUP_METADATA_TTL_MS;
          participatingCache = { data: participating, expiresAt };
          for (const [id, meta] of Object.entries(participating)) {
            groupMetadataCache.set(id, { data: meta, expiresAt });
          }
        }
        const lid = sock.user?.lid;
        const phone = PROMO_BOT_NUMBER!;
        const groups = Object.values(participating)
          .map(meta => ({
            id: meta.id,
            subject: meta.subject || "",
            size: typeof meta.size === "number" ? meta.size : meta.participants.length,
            canSend: groupAllowsBotSend(meta, lid, phone),
          }))
          .sort((a, b) => a.subject.localeCompare(b.subject));
        return { groups };
      } catch {
        return reply.status(503).send({ reason: "whatsapp_not_connected" });
      }
    }),
  );

  app.post("/promo-bot/send-promo", async (request, reply) =>
    promoMutex.runExclusive(async () => {
      if (!deps.validGatewayToken(request.headers["x-gateway-token"])) {
        return reply.status(401).send({ status: false, reason: "unauthorized" });
      }
      const body = request.body as {
        target?: unknown;
        message?: unknown;
        idempotencyKey?: unknown;
        botNumber?: unknown;
        botRevision?: unknown;
      } | undefined;
      if (
        !body ||
        typeof body.message !== "string" ||
        !body.message.trim() ||
        body.message.length > 12_000 ||
        !validPromoBotKey(body.idempotencyKey) ||
        !promoBotKeyMatchesTarget(body.idempotencyKey, body.target)
      ) {
        return reply.status(400).send({ status: false, reason: "invalid_notification" });
      }
      if (!matchesConfiguredIdentity(body)) {
        return reply.status(409).send({ status: false, reason: "bot_configuration_changed" });
      }
      if (!currentPromoBotKey(body.idempotencyKey)) {
        return reply.status(410).send({ status: false, reason: "promo_expired" });
      }
      if (!sock || !isConnected || blocked || PROMO_BOT_NUMBER === deps.getMainBotNumber()) {
        return reply.status(503).send({ status: false, reason: "whatsapp_not_connected" });
      }

      const target = body.target as string;
      const message = body.message;
      const key = body.idempotencyKey;
      const phone = PROMO_BOT_NUMBER!;

      try {
        let meta: GroupMetadata | undefined;
        const hit = groupMetadataCache.get(target);
        if (hit && hit.expiresAt > Date.now()) {
          meta = hit.data;
        } else if (participatingCache && participatingCache.expiresAt > Date.now() && participatingCache.data[target]) {
          meta = participatingCache.data[target];
        } else {
          try {
            meta = await sock.groupMetadata(target);
            if (meta) groupMetadataCache.set(target, { data: meta, expiresAt: Date.now() + GROUP_METADATA_TTL_MS });
          } catch {
            if (!isConnected) return reply.status(503).send({ status: false, reason: "whatsapp_not_connected" });
            meta = undefined;
          }
        }
        if (!meta || !groupAllowsBotSend(meta, sock.user?.lid, phone)) {
          return reply.status(409).send({ status: false, reason: "promo_group_not_allowed" });
        }

        let image: Buffer;
        try {
          image = await loadImage();
        } catch {
          return reply.status(503).send({ status: false, reason: "promo_image_unavailable" });
        }
        if (!currentPromoBotKey(key)) {
          return reply.status(410).send({ status: false, reason: "promo_expired" });
        }

        const content = notificationContent(message, "promo");
        const claim = await deliveryClaim(key, target, JSON.stringify(content), phone);
        if ("sent" in claim) return { status: true, id: claim.id };
        if ("reason" in claim) {
          return reply
            .status(claim.outcomeUnknown || claim.reason === "idempotency_conflict" ? 409 : 429)
            .send({ status: false, ...claim });
        }

        const current = sock;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const send = current.sendMessage(target, { image, caption: message });
        const settle = (result: WAMessage | undefined) =>
          settleDelivery(key, result?.key?.id || undefined, phone, result?.message ? JSON.stringify(result.message) : undefined);
        void send.then(settle).catch(() => {});
        try {
          const result = await Promise.race([
            send,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("send_timeout")), sendTimeoutMs);
            }),
          ]);
          await settle(result);
          if (!result?.key?.id) {
            return reply.status(409).send({ status: false, outcomeUnknown: true, reason: "delivery_outcome_unknown" });
          }
          return { status: true, id: result.key.id };
        } catch (error) {
          await settleDelivery(key, undefined, phone);
          await pauseOutbound(isRestriction(error) ? 24 * 60 : 15, phone);
          if (isRestriction(error)) {
            blocked = true;
            lastError = "Sesi promo dibatasi atau terputus saat mengirim.";
            void current.end(undefined);
          }
          if (error instanceof Error && error.message === "send_timeout") {
            blocked = true;
            lastError = "Pengiriman promo timeout; periksa status sebelum mencoba lagi.";
            void current.end(undefined);
          }
          return reply.status(409).send({ status: false, outcomeUnknown: true, reason: "delivery_outcome_unknown" });
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch {
        return reply.status(503).send({ status: false, reason: "notification_gateway_unavailable" });
      }
    }),
  );

  return {
    async start() {
      await initializePromoRuntime();
      await startPromoWhatsApp();
    },
    async stop() {
      shuttingDown = true;
      isConnected = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      await stopSocket();
    },
    health() {
      return {
        configured: PROMO_BOT_NUMBER !== null,
        connected: isConnected,
        blocked,
      };
    },
    onMainBotNumberChanged() {
      if (PROMO_BOT_NUMBER && PROMO_BOT_NUMBER === deps.getMainBotNumber()) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
        blocked = true;
        isConnected = false;
        lastError = "Nomor promo bot tidak boleh sama dengan nomor notifikasi utama.";
        void stopSocket();
      }
    },
  };
}
