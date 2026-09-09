// POST /api/whatsapp/webhook — Baileys WhatsApp group bot webhook handler
//
// MENGAPA route.ts tetap ramping: file ini hanya menampung ORKESTRASI POST —
// rangkaian kontrol keamanan yang WAJIB berurutan (auth timing-safe → feature flag
// → parse → allowlist grup → dedup/rate-limit inbox) lalu routing perintah bot.
// Seluruh logika handler (katalog, admin `.d`, pembayaran, intake bukti) dipindah
// ke `src/lib/whatsapp/handlers/*` agar jalur uang & autentikasi mudah diaudit
// terpisah. Ini PURE MOVE: tidak ada perubahan SQL, urutan statement, teks pesan,
// perintah bot, atau kode status HTTP.

import { NextRequest, NextResponse } from "next/server";
import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { isEnabled } from "@/lib/feature-flags";
import { getSession, upsertSession } from "@/lib/whatsapp/session";
import {
  authenticateWebhook,
  parseWhatsAppPayload,
  isGroupAllowed,
  isSelfMessage,
  isAdminMember,
  MAX_BODY_SIZE,
} from "@/lib/whatsapp/gateway";
import * as msg from "@/lib/whatsapp/messages";
import {
  parsePaymentMethod,
  isPaymentProofCaption,
  sendTextMessage,
} from "@/lib/whatsapp/handlers/shared";
import { handleList, handleProductSearch, handleNumberSelection } from "@/lib/whatsapp/handlers/catalog";
import { handleAdminDone } from "@/lib/whatsapp/handlers/admin";
import { handlePay } from "@/lib/whatsapp/handlers/payment";
import { handleProofUpload } from "@/lib/whatsapp/handlers/proof";

export const runtime = "edge";

const WHATSAPP_MEMBER_EVENTS_PER_MINUTE = 12;

export async function POST(request: NextRequest) {
  // 1. Content-Type check
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json") && !contentType.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  // 2. Body size limit. Parse the bounded payload before provider-compatible auth.
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const rawText = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawText);
      const obj: Record<string, string> = {};
      params.forEach((val, key) => { obj[key] = val; });
      body = obj;
    } else {
      body = JSON.parse(rawText);
    }
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 3. Timing-safe webhook authentication (header/query/payload secret)
  const auth = authenticateWebhook(request, body);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  }

  // 4. Feature flag check
  if (!isEnabled("WHATSAPP_ENABLED")) {
    return NextResponse.json({ ok: true, status: "disabled" });
  }

  // 5. Parse the gateway's provider-compatible payload
  const incoming = parseWhatsAppPayload(body);
  if (!incoming) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // 6. Group allowlist & Self check
  if (!incoming.isGroup) {
    return NextResponse.json({ ok: true, status: "not_group" });
  }
  if (isSelfMessage(incoming.memberId)) {
    return NextResponse.json({ ok: true, status: "self" });
  }
  if (!isGroupAllowed(incoming.conversationId)) {
    return NextResponse.json({ ok: true, status: "not_allowed" });
  }
  if (!incoming.inboxId) {
    return NextResponse.json({ error: "missing_inbox_id" }, { status: 400 });
  }

  // 7. Inbox deduplication. `processed` doubles as the active claim; a caught
  // failure is changed to `failed`, which lets exactly one gateway retry reclaim it.
  let inboxClaimed = false;
  if (incoming.inboxId && isD1Mode()) {
    try {
      const existing = await queryFirst(
        `SELECT id, status FROM whatsapp_inbox_events WHERE provider='baileys' AND external_message_id=?`,
        incoming.inboxId,
      );
      if (existing) {
        if (String(existing.status) !== "failed") {
          return NextResponse.json({ ok: true, status: "duplicate" });
        }
        const reclaimed = await execRun(
          `UPDATE whatsapp_inbox_events SET status='processed'
           WHERE id=? AND status='failed'`,
          Number(existing.id),
        );
        if (!reclaimed.changes) {
          return NextResponse.json({ ok: true, status: "duplicate" });
        }
        inboxClaimed = true;
      } else {
        await execRun(
          `INSERT INTO whatsapp_inbox_events (provider, external_message_id, event_type, conversation_id, member_id, status)
           VALUES ('baileys',?,?,?,?,'processed')`,
          incoming.inboxId,
          incoming.attachment ? "media" : "text",
          incoming.conversationId,
          incoming.memberId,
        );
        inboxClaimed = true;
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "";
      if (errMsg.includes("UNIQUE")) {
        return NextResponse.json({ ok: true, status: "duplicate" });
      }
      console.error("WA inbox claim failed");
      return NextResponse.json({ error: "inbox_unavailable" }, { status: 503 });
    }
  }

  if (inboxClaimed && isD1Mode()) {
    const recent = await queryFirst(
      `SELECT COUNT(*) as count FROM whatsapp_inbox_events
       WHERE provider='baileys' AND conversation_id=? AND member_id=?
         AND created_at>=datetime('now','-1 minute')`,
      incoming.conversationId,
      incoming.memberId,
    ).catch(() => null);
    if (Number(recent?.count || 0) > WHATSAPP_MEMBER_EVENTS_PER_MINUTE) {
      await execRun(
        `UPDATE whatsapp_inbox_events SET status='ignored'
         WHERE provider='baileys' AND external_message_id=? AND status='processed'`,
        incoming.inboxId,
      ).catch(() => {});
      return NextResponse.json({ ok: true, status: "rate_limited" });
    }
  }

  const { conversationId, memberId, inboxId, message, attachment } = incoming;

  try {
    // 8. A screenshot only needs the selected payment method as caption.
    if (attachment && (isPaymentProofCaption(message) || Boolean(incoming.replyToInboxId)) && isEnabled("WHATSAPP_PROOF_INTAKE")) {
      await handleProofUpload(conversationId, memberId, inboxId, message, attachment.url, incoming.replyToInboxId);
      return NextResponse.json({ ok: true });
    }

    const cmd = message.toLowerCase().trim();

    // Never let an admin command fall through to product search.
    if (cmd === ".d" || cmd.startsWith(".d ")) {
      if (!isAdminMember(memberId)) {
        return NextResponse.json({ ok: true, status: "admin_command_ignored" });
      }
      await handleAdminDone(conversationId, inboxId, message, incoming.quotedText);
      return NextResponse.json({ ok: true });
    }

    // Welcome: detect first-time member (no existing session)
    if (isEnabled("WHATSAPP_GROUP_DISCOVERY") && isD1Mode()) {
      const existingSession = await queryFirst(
        `SELECT id FROM whatsapp_sessions WHERE provider='baileys' AND conversation_id=? AND member_id=?`,
        conversationId,
        memberId,
      ).catch(() => null);
      if (!existingSession) {
        await sendTextMessage({ target: conversationId, message: msg.welcomeNewMemberMessage(incoming.name), inboxId });
        // Create a session so welcome is not sent again
        await upsertSession("baileys", conversationId, memberId, {});
      }
    }

    // Command: list [page]
    if (cmd === "list" || cmd.startsWith("list ")) {
      if (!isEnabled("WHATSAPP_GROUP_DISCOVERY")) {
        return NextResponse.json({ ok: true, status: "discovery_disabled" });
      }
      const pageMatch = cmd.match(/^list\s+(\d+)$/);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      await handleList(conversationId, page, inboxId);
      return NextResponse.json({ ok: true });
    }

    // Command: garansi or /garansi
    if (cmd === "garansi" || cmd === "/garansi") {
      await sendTextMessage({ target: conversationId, message: msg.warrantyMessage(), inboxId });
      return NextResponse.json({ ok: true });
    }

    // `pay` remains a friendly shortcut that only shows the choices.
    if (cmd === "pay" || cmd === "payment") {
      if (isEnabled("WHATSAPP_GROUP_PAYMENT")) {
        await sendTextMessage({ target: conversationId, message: msg.paymentChoiceMessage(), inboxId });
      }
      return NextResponse.json({ ok: true });
    }

    const paymentMethod = parsePaymentMethod(cmd);
    if (paymentMethod) {
      if (isEnabled("WHATSAPP_GROUP_PAYMENT")) {
        await handlePay(conversationId, memberId, inboxId, paymentMethod);
      }
      return NextResponse.json({ ok: true });
    }

    // Variant number selection (digits only)
    if (/^\d+$/.test(cmd)) {
      if (!isEnabled("WHATSAPP_GROUP_DISCOVERY")) {
        return NextResponse.json({ ok: true, status: "discovery_disabled" });
      }
      await handleNumberSelection(conversationId, memberId, Number(cmd), inboxId);
      return NextResponse.json({ ok: true });
    }

    // Product search (only if discovery enabled)
    if (cmd.length >= 2 && isEnabled("WHATSAPP_GROUP_DISCOVERY")) {
      await handleProductSearch(conversationId, memberId, message, inboxId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("WA webhook error:", error instanceof Error ? error.message : "unknown");
    if (inboxClaimed && incoming.inboxId && isD1Mode()) {
      await execRun(
        `UPDATE whatsapp_inbox_events SET status='failed'
         WHERE provider='baileys' AND external_message_id=? AND status='processed'`,
        incoming.inboxId,
      ).catch(() => {});
    }
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
