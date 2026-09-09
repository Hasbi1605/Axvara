// POST /api/telegram/webhook — Telegram Bot webhook handler
// Validates secret header, deduplicates updates, routes commands/callbacks.
//
// Refactor struktural (pure move): logika handler perintah/callback dan
// penerbitan invoice dipindah ke src/lib/telegram/handlers/* agar file ini
// tetap tipis dan fokus pada tanggung jawab route: validasi request, autentikasi
// webhook constant-time, idempotency/lease update, upsert user + guard grup,
// lalu routing. NOL perubahan perilaku — status HTTP, urutan statement, teks,
// dan kontrol keamanan (guard ownerBound di handlers/callback.ts) identik.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { sendMessage, answerCallbackQuery } from "@/lib/telegram/api";
import { errorMessage } from "@/lib/telegram/messages";
import { isTransientWebhookError } from "@/lib/telegram/webhook-errors";
import { constantTimeEqual } from "@/lib/security";
import { markDone } from "@/lib/telegram/handlers/shared";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleCallback } from "@/lib/telegram/handlers/callback";

export const runtime = "edge";

const MAX_BODY_SIZE = 64_000; // 64KB max

// Zod schema for minimal Telegram update validation
const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    from: z.object({ id: z.number(), first_name: z.string(), last_name: z.string().optional(), username: z.string().optional() }).optional(),
    chat: z.object({ id: z.number(), type: z.string() }),
    text: z.string().optional(),
    date: z.number(),
  }).optional(),
  callback_query: z.object({
    id: z.string(),
    from: z.object({ id: z.number(), first_name: z.string(), last_name: z.string().optional(), username: z.string().optional() }),
    message: z.object({ message_id: z.number(), chat: z.object({ id: z.number() }) }).optional(),
    data: z.string().optional(),
  }).optional(),
}).passthrough();

export async function POST(request: NextRequest) {
  // 1. Only POST + JSON
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  // 2. Validate Telegram webhook secret
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) return NextResponse.json({ error: "bot_not_configured" }, { status: 503 });

  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  // constantTimeEqual (bukan `!==`): tiga webhook lain sudah constant-time,
  // Telegram tertinggal. Helper juga tidak membocorkan panjang secret.
  if (!secretHeader || !constantTimeEqual(secretHeader, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 3. Check feature flag
  if (process.env.TELEGRAM_BOT_ENABLED !== "true") {
    return NextResponse.json({ ok: true, status: "bot_disabled" });
  }

  // 4. Parse + validate body
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_SIZE) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = TelegramUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: true, status: "invalid_update" }); // Return 200 to prevent Telegram retries
  }

  const update = parsed.data;
  const updateId = String(update.update_id);

  // 5. Claim update_id with lease (idempotency, issue #6). States:
  // - done → sudah selesai penuh: jawab already_processed, janganยี ulangi.
  // - processing + lease aktif → worker lain sedang kerja: jangan rebut.
  // - failed / processing lease-kedaluwarsa → boleh reclaim atomik untuk
  //   retry nyata (attempt_count+1), tanpa membuat order/invoice ganda
  //   karena pembuatan order memakai idempotency key + guard D1.
  const leaseUntil = new Date(Date.now() + 30_000).toISOString();
  const MAX_UPDATE_ATTEMPTS = 5;
  try {
    if (isD1Mode()) {
      const existing = await queryFirst(
        `SELECT status, attempt_count, lease_until FROM telegram_updates WHERE update_id=?`, updateId,
      );
      if (existing) {
        const status = String(existing.status);
        const leaseUntilExisting = String(existing.lease_until || "");
        const leaseActive = leaseUntilExisting
          && Number.isFinite(Date.parse(leaseUntilExisting))
          && Date.parse(leaseUntilExisting) > Date.now();
        if (status === "done") {
          return NextResponse.json({ ok: true, status: "already_processed" });
        }
        if (status === "processing" && leaseActive) {
          return NextResponse.json({ ok: true, status: "already_processing" });
        }
        const attempts = Number(existing.attempt_count || 0);
        if (attempts >= MAX_UPDATE_ATTEMPTS) {
          return NextResponse.json({ ok: true, status: "already_processed" });
        }
        // Reclaim atomik: hanya menang bila baris masih failed / lease
        // kedaluwarsa — kalah berarti worker lain baru saja claim.
        const reclaimed = await execRun(
          `UPDATE telegram_updates
           SET status='processing', lease_until=?, attempt_count=attempt_count+1, updated_at=datetime('now')
           WHERE update_id=? AND status IN ('failed','processing')
             AND (status='failed' OR lease_until IS NULL OR datetime(lease_until) <= datetime('now'))`,
          leaseUntil, updateId,
        );
        if (!reclaimed.changes) {
          return NextResponse.json({ ok: true, status: "already_processing" });
        }
      } else {
        await execRun(
          `INSERT INTO telegram_updates (update_id, status, lease_until) VALUES (?, 'processing', ?)`,
          updateId, leaseUntil,
        );
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: true, status: "already_processing" });
    }
  }

  // 6. Upsert telegram user + bind verified private chat (issue #5).
  // chat_id grup (negatif) TIDAK PERNAH disimpan sebagai identitas user:
  // upsert memakai chat pribadi hanya bila update datang dari chat private,
  // dan ensurePrivateRecipient mengikat ulang order lunas milik buyer ke
  // chat pribadi terverifikasi tanpa memercayai id grup.
  const from = update.message?.from ?? update.callback_query?.from;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  // Callback updates carry no chat.type — infer privacy from the chat id
  // sign (review R7). Telegram group/supergroup/channel ids are negative;
  // a callback from a negative chat must follow the group path even though
  // there is no message.chat.type field to read.
  const chatType = update.message?.chat.type ?? (typeof chatId === "number" && chatId < 0 ? "supergroup" : "private");
  const isPrivateChat = chatType === "private";
  if (from && chatId) {
    try {
      if (isD1Mode()) {
        if (isPrivateChat) {
          await execRun(
            `INSERT INTO telegram_users (user_id, chat_id, username, first_name, last_name)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET chat_id=?, username=?, first_name=?, last_name=?, updated_at=datetime('now')`,
            String(from.id), String(chatId), from.username ?? null, from.first_name, from.last_name ?? null,
            String(chatId), from.username ?? null, from.first_name, from.last_name ?? null,
          );
          const { ensurePrivateRecipient } = await import("@/lib/fulfillment/deliver");
          await ensurePrivateRecipient(String(from.id), String(chatId)).catch(() => {});
        } else {
          await execRun(
            `INSERT INTO telegram_users (user_id, chat_id, username, first_name, last_name)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET username=?, first_name=?, last_name=?, updated_at=datetime('now')`,
            String(from.id), String(from.id), from.username ?? null, from.first_name, from.last_name ?? null,
            from.username ?? null, from.first_name, from.last_name ?? null,
          );
        }
      }
    } catch { /* best-effort user upsert */ }
  }

  // 6b. Group guard: checkout/callback dari grup tidak membawa state
  // pembelian — balas dengan deep-link ke chat pribadi, lalu berhenti.
  if (!isPrivateChat && chatId) {
    try {
      if (update.callback_query) {
        const cq = update.callback_query;
        await answerCallbackQuery(cq.id);
        if (cq.data) {
          const { SITE } = await import("@/lib/site");
          const { groupCheckoutRedirectMessage } = await import("@/lib/telegram/messages");
          await sendMessage({
            chat_id: chatId,
            text: groupCheckoutRedirectMessage(SITE.adminTelegram),
            parse_mode: "HTML",
          });
        }
        await markDone(updateId);
        return NextResponse.json({ ok: true, status: "group_redirected" });
      }
      if (update.message?.text) {
        const groupText = update.message.text.trim().toLowerCase().split(/\s+/)[0].split("@")[0];
        const purchaseIntents = ["/start", "/katalog", "/cari", "/search", "/cart", "/keranjang", "/orders", "/riwayat", "/pesanan", "/bantuan", "/help", "/garansi"];
        if (purchaseIntents.includes(groupText) || !groupText.startsWith("/")) {
          // /chatid tetap dilayani di grup (admin setup); sisanya redirect.
          if (groupText !== "/chatid") {
            const { SITE } = await import("@/lib/site");
            const { groupCheckoutRedirectMessage } = await import("@/lib/telegram/messages");
            await sendMessage({
              chat_id: chatId,
              text: groupCheckoutRedirectMessage(SITE.adminTelegram),
              parse_mode: "HTML",
            });
            await markDone(updateId);
            return NextResponse.json({ ok: true, status: "group_redirected" });
          }
        }
      }
    } catch { /* redirect best-effort; lanjutkan routing normal */ }
  }

  try {
    // 7. Route: callback query
    if (update.callback_query) {
      const cq = update.callback_query;
      const cqChatId = cq.message?.chat.id;
      const messageId = cq.message?.message_id;

      if (!cqChatId || !messageId || !cq.data) {
        await answerCallbackQuery(cq.id);
        await markDone(updateId);
        return NextResponse.json({ ok: true });
      }

      await answerCallbackQuery(cq.id);
      await handleCallback(cq.data, cqChatId, messageId, cq.from);
      await markDone(updateId);
      return NextResponse.json({ ok: true });
    }

    // 8. Route: text command
    if (update.message?.text && chatId) {
      const text = update.message.text.trim();
      await handleCommand(text, chatId, update.message.chat?.type ?? "private", from);
      await markDone(updateId);
      return NextResponse.json({ ok: true });
    }

    await markDone(updateId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Klasifikasi error (bot-mati 8 Sep 2026): tidak semua kegagalan layak
    // retry Telegram. Hanya kegagalan TRANSIENT (DB/jaringan/timeout) yang
    // menjawab 500 agar Telegram redelivery (R5). Error permanen (bug kode,
    // konfigurasi hilang) menjawab 200 + baris failed + pesan error ke user —
    // retry 5x tidak akan memperbaikinya, malah menaikkan error rate webhook
    // sampai Telegram menurunkan reputasi endpoint dan bot terlihat mati.
    const transient = isTransientWebhookError(error);
    try {
      if (isD1Mode()) {
        await execRun(
          `UPDATE telegram_updates SET status='failed', last_error=?, updated_at=datetime('now') WHERE update_id=?`,
          (error instanceof Error ? error.message : "Unknown").slice(0, 500), updateId,
        );
      }
    } catch { /* best effort */ }

    // Jejak diagnosis: tanpa log ini, penyebab 500 hanya bisa ditebak dari
    // luar (Pages logs kosong → "bot mati misterius"). Tanpa PII.
    console.error(
      `telegram webhook update ${updateId} ${transient ? "transient" : "permanent"} failure:`,
      error instanceof Error ? error.message : "Unknown",
    );

    if (chatId) {
      try { await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML" }); } catch { /* ok */ }
    }
    if (transient) {
      return NextResponse.json({ ok: false, status: "error_retryable" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status: "error_handled" });
  }
}
