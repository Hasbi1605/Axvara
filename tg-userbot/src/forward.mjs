// src/forward.mjs — logika murni forward `drop_author` (tanpa jaringan sendiri).
// Client Telegram diinjeksi (`invoke`, `resolvePeer`) agar bisa diuji dengan fake.
// Satu-satunya method Telegram yang dipakai: messages.ForwardMessages.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import telegram from "telegram";
import bigInt from "big-integer";

const { Api } = telegram;

const CHAT_ID_RE = /^-100\d{5,20}$/;
const KEY_RE = /^[A-Za-z0-9:_-]{8,128}$/;
const MAX_MESSAGE_ID = 2_147_483_647;
export const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STATUS = {
  invalid_request: 400,
  forbidden_chat: 403,
  telegram_rejected: 409,
  outcome_unknown: 502,
  userbot_not_ready: 503,
};

export class ForwardError extends Error {
  constructor(code, { retryAfter, rpc, detail } = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ForwardError";
    this.code = code;
    this.status = STATUS[code] ?? 500;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
    if (rpc !== undefined) this.rpc = rpc;
  }
}

function validate({ fromChatId, messageId, toChatId, idempotencyKey } = {}) {
  if (typeof fromChatId !== "string" || !CHAT_ID_RE.test(fromChatId)) throw new ForwardError("invalid_request", { detail: "fromChatId" });
  if (typeof toChatId !== "string" || !CHAT_ID_RE.test(toChatId)) throw new ForwardError("invalid_request", { detail: "toChatId" });
  if (!Number.isSafeInteger(messageId) || messageId <= 0 || messageId > MAX_MESSAGE_ID) throw new ForwardError("invalid_request", { detail: "messageId" });
  if (typeof idempotencyKey !== "string" || !KEY_RE.test(idempotencyKey)) throw new ForwardError("invalid_request", { detail: "idempotencyKey" });
}

/** Long 64-bit signed acak sebagai BigInteger (format yang dipakai gramjs). */
function randomLong() {
  const v = bigInt(randomBytes(8).toString("hex"), 16);
  return v.greaterOrEquals(bigInt(2).pow(63)) ? v.subtract(bigInt(2).pow(64)) : v;
}

/** Ambil id pesan baru di channel dari hasil Updates; null bila tak ditemukan. */
export function extractMessageId(result, randomId) {
  const updates = Array.isArray(result?.updates) ? result.updates : result?.update ? [result.update] : [];
  for (const u of updates) {
    if (u?.className === "UpdateNewChannelMessage" && Number.isInteger(u.message?.id)) return u.message.id;
  }
  for (const u of updates) {
    if (u?.className === "UpdateMessageID" && Number.isInteger(u.id) && String(u.randomId) === String(randomId)) return u.id;
  }
  return null;
}

/** Klasifikasi error invoke: { rpc, retryAfter } bila RPC error pasti-ditolak, else null. */
function classifyRpcError(err) {
  if (!err || typeof err !== "object") return null;
  const isRpc = typeof err.errorMessage === "string" || (typeof err.seconds === "number" && err.name?.includes("Flood"));
  if (!isRpc) return null; // bukan jawaban RPC (jaringan/timeout/internal) → hasil tak pasti
  if (typeof err.code === "number" && err.code >= 500) return null; // server error: tak pasti
  let name = "RPC_ERROR";
  let retryAfter;
  const m = typeof err.errorMessage === "string" ? err.errorMessage.match(/^([A-Z][A-Z0-9_]*?)(?:_(\d+))?$/) : null;
  if (m) {
    name = m[1];
    if (m[2] !== undefined && /FLOOD|SLOWMODE/.test(name)) retryAfter = Number(m[2]);
  }
  // gramjs memetakan FLOOD_WAIT_X ke FloodWaitError{seconds}; errorMessage berisi teks manusia.
  if (typeof err.seconds === "number") {
    retryAfter = err.seconds;
    if (!m) name = /slow/i.test(err.name || "") ? "SLOWMODE_WAIT" : "FLOOD_WAIT";
  }
  return { rpc: name, retryAfter };
}

function loadState(stateFile) {
  const map = new Map();
  let raw;
  try {
    raw = fs.readFileSync(stateFile, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return map;
    throw e;
  }
  const parsed = JSON.parse(raw); // rusak → lempar: fail closed, jangan mulai dengan state kosong
  if (!parsed || typeof parsed !== "object" || typeof parsed.entries !== "object" || parsed.entries === null) {
    throw new Error("state_file_invalid");
  }
  for (const [k, v] of Object.entries(parsed.entries)) {
    if (v && (v.status === "pending" || v.status === "done")) map.set(k, v);
  }
  return map;
}

export function createForwarder({ invoke, resolvePeer, allowFrom, allowTo, stateFile, now = Date.now, isReady = () => true }) {
  if (typeof invoke !== "function" || typeof resolvePeer !== "function") throw new Error("invoke_and_resolvePeer_required");
  if (!CHAT_ID_RE.test(String(allowFrom)) || !CHAT_ID_RE.test(String(allowTo))) throw new Error("allow_chat_invalid");
  if (!stateFile) throw new Error("state_file_required");

  const state = loadState(stateFile);

  function persist() {
    const cutoff = now() - STATE_TTL_MS;
    for (const [k, v] of state) if (!(typeof v.at === "number" && v.at >= cutoff)) state.delete(k);
    const tmp = `${stateFile}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.fchmodSync(fd, 0o600);
      fs.writeFileSync(fd, JSON.stringify({ version: 1, entries: Object.fromEntries(state) }));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, stateFile);
    fs.chmodSync(stateFile, 0o600);
  }

  async function forward(input) {
    validate(input);
    const { fromChatId, messageId, toChatId, idempotencyKey } = input;
    if (fromChatId !== allowFrom || toChatId !== allowTo) throw new ForwardError("forbidden_chat");

    const fingerprint = `${fromChatId}:${messageId}:${toChatId}`;
    const prior = state.get(idempotencyKey);
    if (prior) {
      if (prior.fp !== fingerprint) throw new ForwardError("invalid_request", { detail: "idempotencyKey_reused" });
      if (prior.status === "done") return { messageId: prior.messageId ?? null, replay: true };
      throw new ForwardError("outcome_unknown", { detail: "previous_attempt_pending" });
    }

    if (!isReady()) throw new ForwardError("userbot_not_ready");
    let fromPeer;
    let toPeer;
    try {
      fromPeer = await resolvePeer(fromChatId);
      toPeer = await resolvePeer(toChatId);
    } catch {
      throw new ForwardError("userbot_not_ready", { detail: "peer_unresolved" });
    }
    // Server tidak boleh memproses dua request kunci sama bersamaan: cek ulang
    // setelah await (resolvePeer) sebelum menulis pending.
    if (state.has(idempotencyKey)) throw new ForwardError("outcome_unknown", { detail: "concurrent_attempt" });

    state.set(idempotencyKey, { status: "pending", at: now(), fp: fingerprint });
    try {
      persist(); // pending WAJIB tersimpan sebelum Telegram dipanggil
    } catch {
      state.delete(idempotencyKey);
      throw new ForwardError("userbot_not_ready", { detail: "state_unwritable" }); // belum ada yang terkirim
    }

    const randomId = randomLong();
    let result;
    try {
      result = await invoke(new Api.messages.ForwardMessages({
        dropAuthor: true,
        fromPeer,
        toPeer,
        id: [messageId],
        randomId: [randomId],
      }));
    } catch (err) {
      const rejected = classifyRpcError(err);
      if (rejected) {
        state.delete(idempotencyKey);
        try { persist(); } catch { /* pending basi tersisa di disk = konservatif (outcome_unknown) */ }
        throw new ForwardError("telegram_rejected", { rpc: rejected.rpc, retryAfter: rejected.retryAfter });
      }
      throw new ForwardError("outcome_unknown"); // pending tetap tersimpan
    }

    // Request sukses diterima Telegram: pesan SUDAH dibuat. Bila id tak bisa
    // dibaca, tetap catat done (messageId null) agar tidak pernah forward ulang.
    const newId = extractMessageId(result, randomId);
    state.set(idempotencyKey, { status: "done", at: now(), fp: fingerprint, messageId: newId });
    try { persist(); } catch { /* memori tetap done; disk masih pending = konservatif */ }
    return { messageId: newId, replay: false };
  }

  return { forward };
}
