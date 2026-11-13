// POST /api/whatsapp/webhook — Baileys WhatsApp group bot webhook handler
//
// Alur pembeli lewat WhatsApp (pencarian/discovery produk, pemesanan &
// pembayaran, intake bukti manual) DIPENSUNKAN 13 November 2026 atas keputusan
// owner: hard off di kode, bukan lewat env flag, sehingga tidak bisa dihidupkan
// kembali tanpa perubahan kode. Pesan yang dulu memicu alur itu dijawab SATU
// balasan sopan yang mengarahkan pembeli ke website/Telegram. Yang tetap hidup:
// perintah admin `.d`, info garansi, katalog digest/broadcast/welcome lewat
// outbox grup, dan pencatatan event grup. Data order historis tidak diubah.
//
// MENGAPA route.ts tetap ramping: file ini hanya menampung ORKESTRASI POST —
// rangkaian kontrol keamanan yang WAJIB berurutan (auth timing-safe → feature
// flag → parse → allowlist grup → dedup/rate-limit inbox) lalu routing perintah.

import { NextRequest, NextResponse } from "next/server";
import { readTextBody } from "@/lib/http-body";
import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { isEnabled } from "@/lib/feature-flags";
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
import { handleAdminDone } from "@/lib/whatsapp/handlers/admin";

export const runtime = "edge";

const WHATSAPP_MEMBER_EVENTS_PER_MINUTE = 12;

/** Pesan yang dulu memicu alur belanja WhatsApp yang kini dipensiunkan. */
// Hanya perintah eksplisit yang dibalas; angka biasa atau balasan bergambar di
// obrolan grup tidak dibalas agar bot tidak spam percakapan anggota.
function isRetiredBuyerIntent(message: string, hasAttachment: boolean): boolean {
  if (hasAttachment && isPaymentProofCaption(message)) return true;
  const cmd = message.toLowerCase().trim();
  if (cmd === "list" || /^list\s+\d+$/.test(cmd)) return true;
  if (cmd === "pay" || cmd === "payment") return true;
  if (parsePaymentMethod(cmd)) return true;
  return cmd.startsWith("cari ") && cmd.length > 5;
}

export async function POST(request: NextRequest) {
  // 1. Content-Type check
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json") && !contentType.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  // 2. Body size limit. Parse the bounded payload before provider-compatible auth.
  const bounded = await readTextBody(request, MAX_BODY_SIZE);
  if (!bounded.ok) return bounded.response;
  const rawText = bounded.data;

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

  // 4. Feature flag check (gateway/grup tetap hidup; alur pembeli sudah pensiun di kode)
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
    const cmd = message.toLowerCase().trim();

    // Never let an admin command fall through to the retired buyer reply.
    if (cmd === ".d" || cmd.startsWith(".d ")) {
      if (!isAdminMember(memberId)) {
        return NextResponse.json({ ok: true, status: "admin_command_ignored" });
      }
      await handleAdminDone(conversationId, inboxId, message, incoming.quotedText);
      return NextResponse.json({ ok: true });
    }

    // Command: garansi — informasi ketentuan, bukan alur belanja.
    if (cmd === "garansi" || cmd === "/garansi") {
      await sendTextMessage({ target: conversationId, message: msg.warrantyMessage(), inboxId });
      return NextResponse.json({ ok: true });
    }

    // Semua pesan yang dulu memicu pencarian/pemesanan/bukti manual dijawab
    // satu kali dengan arahan ke website/Telegram.
    if (isRetiredBuyerIntent(message, Boolean(attachment))) {
      await sendTextMessage({ target: conversationId, message: msg.buyerFlowsRetiredMessage(), inboxId });
      return NextResponse.json({ ok: true, status: "buyer_flows_retired" });
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
