// src/server.mjs — userbot sempit AXVARA: HANYA melayani POST /forward di loopback.
// Tidak membaca chat, tidak mendaftarkan event handler, tidak memakai method
// Telegram lain selain (a) getDialogs sekali saat start untuk cache access hash
// dan (b) messages.ForwardMessages lewat forward.mjs.
import http from "node:http";
import fs from "node:fs";
import telegram from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { createForwarder, ForwardError } from "./forward.mjs";

const { TelegramClient } = telegram;

const MAX_BODY = 4 * 1024;
const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function log(msg, extra = {}) {
  // Tidak pernah mencatat secret/body/chat id; hanya peristiwa + kode.
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    log("missing_env", { name });
    process.exit(1);
  }
  return v;
}

function isLoopbackRequest(req) {
  if (!LOOPBACK_ADDRS.has(req.socket.remoteAddress ?? "")) return false;
  const host = String(req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  return LOOPBACK_HOSTS.has(host);
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return; // buang sisa body tanpa menimbun memori
      size += c.length;
      if (size > MAX_BODY) {
        over = true;
        chunks.length = 0;
        reject(Object.assign(new Error("too_large"), { tooLarge: true }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => over || resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createServer({ forwarder, isReady }) {
  return http.createServer(async (req, res) => {
    try {
      if (!isLoopbackRequest(req)) return send(res, 403, { ok: false, error: "forbidden" });
      const url = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && url === "/health") return send(res, 200, { ok: true, ready: Boolean(isReady()) });
      if (url !== "/forward") return send(res, 404, { ok: false, error: "not_found" });
      if (req.method !== "POST") return send(res, 405, { ok: false, error: "method_not_allowed" });

      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch (e) {
        if (e?.tooLarge) {
          res.shouldKeepAlive = false;
          res.on("finish", () => req.destroy());
          return send(res, 413, { ok: false, error: "payload_too_large" });
        }
        return send(res, 400, { ok: false, error: "invalid_request" });
      }
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return send(res, 400, { ok: false, error: "invalid_request" });
      }
      try {
        const out = await forwarder.forward(input);
        log("forward", { status: 200, replay: out.replay });
        return send(res, 200, { ok: true, messageId: out.messageId, replay: out.replay });
      } catch (err) {
        if (err instanceof ForwardError) {
          log("forward", { status: err.status, error: err.code, rpc: err.rpc });
          return send(res, err.status, {
            ok: false,
            error: err.code,
            ...(err.rpc !== undefined ? { rpc: err.rpc } : {}),
            ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}),
          });
        }
        log("forward", { status: 500, error: "internal" });
        return send(res, 500, { ok: false, error: "internal" });
      }
    } catch {
      if (!res.headersSent) send(res, 500, { ok: false, error: "internal" });
    }
  });
}

async function main() {
  const apiId = Number(need("TG_API_ID"));
  const apiHash = need("TG_API_HASH");
  const sessionFile = need("TG_SESSION_FILE");
  const allowFrom = need("TG_ALLOW_FROM_CHAT");
  const allowTo = need("TG_ALLOW_TO_CHAT");
  const stateFile = need("TG_STATE_FILE");
  const port = Number(process.env.TG_USERBOT_PORT || 8791);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    log("invalid_env", { name: "TG_API_ID" });
    process.exit(1);
  }

  const sessionString = fs.readFileSync(sessionFile, "utf8").trim(); // dibaca sekali, tidak pernah dicatat
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3,
    requestRetries: 3,
    floodSleepThreshold: 0, // FLOOD_WAIT dikembalikan ke pemanggil, bukan ditidurkan
    useWSS: false,
    autoReconnect: true,
  });
  client.setLogLevel("error");

  let ready = false;
  const peers = new Map();
  let dialogs = [];
  const resolvePeer = async (chatId) => {
    const cached = peers.get(chatId);
    if (cached) return cached;
    // ID "-100…" sebagai string dibaca gramjs sebagai username → cari dari dialog (id bertanda).
    const dialog = dialogs.find((d) => String(d.id) === chatId);
    const peer = dialog?.inputEntity ?? (await client.getInputEntity(Number(chatId)));
    peers.set(chatId, peer);
    return peer;
  };

  async function connectAndPrime() {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      log("not_authorized");
      return;
    }
    dialogs = await client.getDialogs({ limit: 500 }); // mengisi cache access hash; staging bisa jauh di bawah (akun owner ramai)
    await resolvePeer(allowFrom);
    await resolvePeer(allowTo);
    ready = true;
    log("ready");
  }

  const isReady = () => ready && client.connected === true;
  const forwarder = createForwarder({
    invoke: (request) => client.invoke(request),
    resolvePeer,
    allowFrom,
    allowTo,
    stateFile,
    isReady,
  });

  const server = createServer({ forwarder, isReady });
  server.listen(port, "127.0.0.1", () => log("listening", { port }));

  connectAndPrime().catch((e) => {
    ready = false;
    log("startup_failed", { error: String(e?.errorMessage ?? e?.name ?? "error").slice(0, 60) });
  });

  const shutdown = async () => {
    server.close();
    try { await client.disconnect(); } catch { /* abaikan */ }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    log("fatal", { error: String(e?.name ?? "error").slice(0, 60) });
    process.exit(1);
  });
}
