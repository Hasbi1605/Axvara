// src/lib/whatsapp/gateway.ts — Fonnte WhatsApp gateway adapter
// Handles outbound messaging and media via Fonnte API.
// This is the only file that talks to the Fonnte API.

const FONNTE_API_BASE = "https://api.fonnte.com";

function getFonnteToken(): string {
  return process.env.FONNTE_TOKEN || "";
}

function getAllowedGroups(): string[] {
  const raw = process.env.WHATSAPP_GROUP_ALLOWLIST || "";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export function isGroupAllowed(groupId: string): boolean {
  return getAllowedGroups().includes(groupId);
}

export function isSelfMessage(senderId: string): boolean {
  const botNumber = process.env.WHATSAPP_BOT_NUMBER || "";
  return botNumber !== "" && senderId === botNumber;
}

export type SendMessageParams = {
  target: string; // group ID or phone number
  message: string;
  replyMessageId?: string;
};

export type SendImageParams = {
  target: string;
  imageUrl: string;
  caption?: string;
  replyMessageId?: string;
};

export async function sendTextMessage(params: SendMessageParams): Promise<{ ok: boolean; messageId?: string }> {
  const token = getFonnteToken();
  if (!token) return { ok: false };

  try {
    const body: Record<string, string> = {
      target: params.target,
      message: params.message,
    };
    if (params.replyMessageId) {
      body.reply = params.replyMessageId;
    }

    const res = await fetch(`${FONNTE_API_BASE}/send`, {
      method: "POST",
      headers: {
        "Authorization": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && data.status === true,
      messageId: data.id ? String(data.id) : undefined,
    };
  } catch {
    return { ok: false };
  }
}

export async function sendImageMessage(params: SendImageParams): Promise<{ ok: boolean; messageId?: string }> {
  const token = getFonnteToken();
  if (!token) return { ok: false };

  try {
    const body: Record<string, string> = {
      target: params.target,
      url: params.imageUrl,
      type: "image",
    };
    if (params.caption) body.message = params.caption;
    if (params.replyMessageId) body.reply = params.replyMessageId;

    const res = await fetch(`${FONNTE_API_BASE}/send`, {
      method: "POST",
      headers: {
        "Authorization": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && data.status === true,
      messageId: data.id ? String(data.id) : undefined,
    };
  } catch {
    return { ok: false };
  }
}

// Download media from Fonnte (for proof images)
export async function downloadMedia(mediaUrl: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const token = getFonnteToken();
  if (!token || !mediaUrl) return null;

  try {
    const res = await fetch(mediaUrl, {
      headers: { "Authorization": token },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    return { buffer, contentType };
  } catch {
    return null;
  }
}
