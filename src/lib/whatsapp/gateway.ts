// src/lib/whatsapp/gateway.ts — AXVARA Baileys gateway adapter
// Handles the small webhook contract exposed by the Heroku gateway, secure
// outbound calls, and SSRF-safe streaming media download.

import { NextRequest } from "next/server";

export const MAX_BODY_SIZE = 64_000; // 64 KB
export const MAX_MEDIA_SIZE = 5 * 1024 * 1024; // 5 MB

export type WhatsAppIncomingMessage = {
  rawSender: string;
  conversationId: string; // group ID (e.g. 120363024823948293@g.us) or direct sender
  memberId: string; // phone number of individual (e.g. 628123456789)
  message: string;
  name: string;
  inboxId: string;
  replyToInboxId?: string;
  isGroup: boolean;
  attachment?: {
    url: string;
    filename?: string;
    extension?: string;
  };
};

export type WhatsAppSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

export type SendMessageParams = {
  target: string; // group JID or phone number
  message: string;
  inboxId?: string; // reply to incoming inboxid
};

export type SendImageParams = {
  target: string;
  imageUrl: string;
  caption?: string;
  inboxId?: string; // reply to incoming inboxid
  filename?: string;
};

// ---- Timing-Safe Comparison ----

export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  let c = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    c |= aBuf[i] ^ bBuf[i];
  }
  return c === 0;
}

// ---- Webhook Authentication ----

export function authenticateWebhook(
  request: NextRequest,
  payload?: unknown,
): { ok: boolean; reason?: string } {
  const expectedSecret = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!expectedSecret || expectedSecret.trim() === "") {
    return { ok: false, reason: "webhook_not_configured" };
  }

  // Check header tokens first
  const headerToken =
    request.headers.get("x-webhook-token") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  // Check query param fallback
  const queryToken =
    request.nextUrl.searchParams.get("token") ||
    request.nextUrl.searchParams.get("secret") ||
    "";

  // Payload secret remains supported for local fixtures; the production
  // Baileys gateway uses x-webhook-token.
  const body = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : undefined;
  const payloadToken = typeof body?.secret === "string"
    ? body.secret
    : typeof body?.webhook_secret === "string"
      ? body.webhook_secret
      : "";

  const tokenToTest = headerToken.trim() || queryToken.trim() || payloadToken.trim();
  if (!tokenToTest) {
    return { ok: false, reason: "missing_token" };
  }

  if (!timingSafeEqual(tokenToTest, expectedSecret)) {
    return { ok: false, reason: "invalid_token" };
  }

  return { ok: true };
}

// ---- Baileys Gateway Payload Parser ----

export function parseWhatsAppPayload(body: unknown): WhatsAppIncomingMessage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const sender = String(b.sender || "").trim();
  if (!sender) return null;

  const memberRaw = String(b.member || "").trim();
  const inboxId = String(b.inboxid || b.id || "").trim();
  const message = String(b.message || "").trim();
  const name = String(b.name || "").trim();
  const url = String(b.url || b.media || "").trim();
  const filename = b.filename ? String(b.filename).trim() : undefined;
  const extension = b.extension ? String(b.extension).trim().toLowerCase() : undefined;

  // The gateway sends the group JID as sender and the participant JID as member.
  const isGroup = Boolean(
    sender.includes("@g.us") ||
    b.group ||
    b.isGroup ||
    (memberRaw && memberRaw !== sender)
  );

  const conversationId = sender;
  // For group messages, member is memberRaw. For direct messages, member is sender.
  const memberId = isGroup && memberRaw ? memberRaw : sender;

  const msg: WhatsAppIncomingMessage = {
    rawSender: sender,
    conversationId,
    memberId,
    message,
    name,
    inboxId,
    replyToInboxId: b.reply ? String(b.reply).trim() : undefined,
    isGroup,
  };

  if (url) {
    msg.attachment = {
      url,
      filename,
      extension,
    };
  }

  return msg;
}

// ---- Group Allowlist & Self Check ----

export function isGroupAllowed(groupId: string): boolean {
  const raw = process.env.WHATSAPP_GROUP_ALLOWLIST || "";
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return false; // Fail closed if allowlist not set
  return allowed.includes(groupId);
}

export function isSelfMessage(memberId: string): boolean {
  const botNumber = (process.env.WHATSAPP_BOT_NUMBER || "").trim().replace(/\D/g, "");
  if (!botNumber) return false;
  const cleanMember = memberId.replace(/\D/g, "");
  const normBot = botNumber.startsWith("62") ? botNumber.slice(2) : botNumber.replace(/^0/, "");
  const normMember = cleanMember.startsWith("62") ? cleanMember.slice(2) : cleanMember.replace(/^0/, "");
  return normBot === normMember || cleanMember === botNumber || cleanMember.endsWith(botNumber);
}

// ---- Outbound Messaging ----

function gatewayConfig(): { url: string; token: string } | null {
  const url = (process.env.WHATSAPP_GATEWAY_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.WHATSAPP_WEBHOOK_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

async function callGateway(path: string, payload: Record<string, unknown>, timeoutMs: number): Promise<WhatsAppSendResult> {
  const config = gatewayConfig();
  if (!config) return { ok: false, error: "baileys_gateway_not_configured" };
  try {
    const response = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-gateway-token": config.token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const ok = response.ok && data.status === true;
    return {
      ok,
      messageId: data.id ? String(data.id) : undefined,
      error: ok ? undefined : String(data.reason || "baileys_gateway_send_failed"),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "baileys_gateway_network_error" };
  }
}

export function sendTextMessage(params: SendMessageParams): Promise<WhatsAppSendResult> {
  return callGateway("/send", { target: params.target, message: params.message, inboxId: params.inboxId }, 15_000);
}

export function sendImageMessage(params: SendImageParams): Promise<WhatsAppSendResult> {
  return callGateway("/send-image", {
    target: params.target,
    imageUrl: params.imageUrl,
    caption: params.caption,
    inboxId: params.inboxId,
    filename: params.filename,
  }, 20_000);
}

// ---- SSRF-Safe Media Download ----

export function isPrivateIp(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase();
  const address = clean.startsWith("[") && clean.endsWith("]") ? clean.slice(1, -1) : clean;
  if (address === "localhost" || address.endsWith(".localhost") || address.endsWith(".local") || address === "::" || address === "::1") {
    return true;
  }
  if (address.includes(":") && (
    address.startsWith("fc")
    || address.startsWith("fd")
    || /^fe[89ab]/.test(address)
    || address.startsWith("::ffff:127.")
    || address.startsWith("::ffff:10.")
    || address.startsWith("::ffff:192.168.")
    || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(address)
  )) return true;
  // Check IPv4 octets
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8
  }
  return false;
}

export function checkImageMagicBytes(buf: Uint8Array, mimeType: string): boolean {
  const t = mimeType.toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (t === "image/png") {
    return (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  }
  if (t === "image/webp") {
    return (
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    );
  }
  return false;
}

export async function downloadMediaSafely(
  mediaUrl: string,
  maxBytes: number = MAX_MEDIA_SIZE,
): Promise<{ buffer: Uint8Array; contentType: string; sha256: string } | null> {
  try {
    const parsed = new URL(mediaUrl);
    // Protocol must be strictly HTTPS
    if (parsed.protocol !== "https:") return null;

    // Check SSRF
    if (isPrivateIp(parsed.hostname)) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(mediaUrl, {
      signal: controller.signal,
      redirect: "manual", // Do not blindly follow redirects to avoid SSRF redirect hops
    });
    clearTimeout(timeout);

    // If redirected, check new destination
    let response = res;
    if (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
      const location = res.headers.get("location");
      if (!location) return null;
      const redirectUrl = new URL(location, parsed);
      if (redirectUrl.protocol !== "https:" || isPrivateIp(redirectUrl.hostname)) return null;

      const redirController = new AbortController();
      const redirTimeout = setTimeout(() => redirController.abort(), 20_000);
      response = await fetch(redirectUrl.toString(), {
        signal: redirController.signal,
        redirect: "error", // At most 1 safe redirect
      });
      clearTimeout(redirTimeout);
    }

    if (!response.ok || !response.body) return null;

    // Streaming body with size limit
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        receivedBytes += value.byteLength;
        if (receivedBytes > maxBytes) {
          await reader.cancel("Size limit exceeded");
          return null;
        }
        chunks.push(value);
      }
    }

    // Combine chunks
    const fullBuffer = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // Determine and validate Content-Type
    const rawType = (response.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
    let detectedType = rawType;
    if (!detectedType || detectedType === "application/octet-stream") {
      // Guess by magic bytes
      if (checkImageMagicBytes(fullBuffer, "image/jpeg")) detectedType = "image/jpeg";
      else if (checkImageMagicBytes(fullBuffer, "image/png")) detectedType = "image/png";
      else if (checkImageMagicBytes(fullBuffer, "image/webp")) detectedType = "image/webp";
      else return null;
    }

    if (!checkImageMagicBytes(fullBuffer, detectedType)) {
      return null;
    }

    // Compute SHA-256
    const hashBuffer = await crypto.subtle.digest("SHA-256", fullBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256 = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    return {
      buffer: fullBuffer,
      contentType: detectedType,
      sha256,
    };
  } catch {
    return null;
  }
}
