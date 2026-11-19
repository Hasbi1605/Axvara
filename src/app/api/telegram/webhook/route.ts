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
import { readTextBody } from "@/lib/http-body";
import { z } from "zod";
import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { sendMessage, answerCallbackQuery } from "@/lib/telegram/api";
import { errorMessage } from "@/lib/telegram/messages";
import { isTransientWebhookError } from "@/lib/telegram/webhook-errors";
import { constantTimeEqual } from "@/lib/security";
import { markDone, runInBackground } from "@/lib/telegram/handlers/shared";
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
    caption: z.string().optional(),
    photo: z.array(z.object({
      file_id: z.string(),
      file_unique_id: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      file_size: z.number().optional(),
    }).passthrough()).optional(),
    date: z.number(),
  }).passthrough().optional(),
  callback_query: z.object({
    id: z.string(),
    from: z.object({ id: z.number(), first_name: z.string(), last_name: z.string().optional(), username: z.string().optional() }),
    message: z.object({
      message_id: z.number(),
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
      caption: z.string().optional(),
      photo: z.array(z.object({ file_id: z.string() }).passthrough()).optional(),
    }).passthrough().optional(),
    data: z.string().optional(),
  }).optional(),
}).passthrough();

function isProtectedCallbackMessage(msg: Record<string, unknown> | undefined): boolean {
  if (!msg) return false;
  const content = `${String(msg.caption ?? "")}\n${String(msg.text ?? "")}`;
  if (/Menunggu pembayaran|Awaiting payment|Total bayar|Total to pay|PEMBAYARAN LUNAS|Pembayaran sudah terverifikasi|Payment confirmed|Ketuk untuk menyalin|Tap to copy/i.test(content)) {
    return true;
  }
  const markup = msg.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined;
  const rows = markup?.inline_keyboard;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const btn of row) {
        const d = String(btn?.callback_data ?? "");
        if (/^(?:refresh|qrenew|cancel|cancelok|cred|paycheck|ccancel|claim|claimstart|moredeliv):/.test(d)) {
          return true;
        }
      }
    }
  }
  return false;
}

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
    const bounded = await readTextBody(request, MAX_BODY_SIZE);
    if (!bounded.ok) return bounded.response;
    const raw = bounded.data;
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
      // Optimistic single-statement claim for new updates; fall back to SELECT + atomic reclaim on conflict.
      const inserted = await execRun(
        `INSERT INTO telegram_updates (update_id, status, lease_until) VALUES (?, 'processing', ?) ON CONFLICT(update_id) DO NOTHING`,
        updateId, leaseUntil,
      );
      if ((inserted.changes ?? 0) === 0) {
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
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: true, status: "already_processing" });
    }
    return NextResponse.json({ ok: false, error: "update_claim_unavailable" }, { status: 503, headers: { "Retry-After": "5" } });
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

  // Early non-alert callback ack immediately after dedup claim succeeds (before D1 user upsert/handlers).
  const cqEarly = update.callback_query;
  const cqEarlyData = typeof cqEarly?.data === "string" ? cqEarly.data : "";
  const isPrefOrAlertCallback = cqEarlyData === "soldout" || cqEarlyData.startsWith("lang:") || cqEarlyData.startsWith("cur:");
  let callbackAnsweredUpfront = false;
  if (cqEarly && isPrivateChat && cqEarlyData && !isPrefOrAlertCallback) {
    callbackAnsweredUpfront = true;
    runInBackground(answerCallbackQuery(cqEarly.id));
  }

  const msgTextRaw = (update.message?.text ?? update.message?.caption ?? "").trim();
  const isStartCmd = msgTextRaw.toLowerCase().split(/\s+/)[0]?.split("@")[0] === "/start";

  if (from && chatId) {
    try {
      if (isD1Mode()) {
        if (isPrivateChat) {
          await execRun(
            `INSERT INTO telegram_users (user_id, chat_id, username, first_name, last_name)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET chat_id=?, username=?, first_name=?, last_name=?, is_blocked=0, updated_at=datetime('now')`,
            String(from.id), String(chatId), from.username ?? null, from.first_name, from.last_name ?? null,
            String(chatId), from.username ?? null, from.first_name, from.last_name ?? null,
          );
          // Background ensurePrivateRecipient (skip within 10 min per isolate; /start always forces).
          const { ensurePrivateRecipientDebounced } = await import("@/lib/fulfillment/delivery/manifest");
          runInBackground(ensurePrivateRecipientDebounced(String(from.id), String(chatId), { force: isStartCmd }));
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
        const purchaseIntents = ["/start", "/katalog", "/cari", "/search", "/cart", "/keranjang", "/orders", "/riwayat", "/pesanan", "/bantuan", "/help", "/garansi", "/bahasa", "/currency"];
        if (purchaseIntents.includes(groupText) || !groupText.startsWith("/")) {
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
    } catch { /* redirect best-effort; lanjutkan routing normal */ }
  }

  try {
    // 7. Route: callback query
  // Preference callbacks answer exactly once inside handleCallback.
    if (update.callback_query) {
      const cq = update.callback_query;
      const cqChatId = cq.message?.chat.id;
      const messageId = cq.message?.message_id;

      if (!cqChatId || !messageId || !cq.data) {
        if (!callbackAnsweredUpfront) await answerCallbackQuery(cq.id);
        await markDone(updateId);
        return NextResponse.json({ ok: true });
      }

      const sourceMeta = {
        isPhoto: Boolean(cq.message?.photo && cq.message.photo.length > 0),
        isProtected: isProtectedCallbackMessage(cq.message as Record<string, unknown> | undefined),
      };

      if (cq.data === "soldout") {
        await answerCallbackQuery(cq.id, "Varian produk habis. Silakan pilih produk lain.", true);
      } else if (typeof cq.data === "string" && (cq.data === "lang:id" || cq.data === "lang:en" || cq.data.startsWith("lang:") || cq.data.startsWith("cur:"))) {
        await handleCallback(cq.data, cqChatId, messageId, cq.from, cq.id, sourceMeta);
      } else {
        if (!callbackAnsweredUpfront) runInBackground(answerCallbackQuery(cq.id));
        await handleCallback(cq.data, cqChatId, messageId, cq.from, undefined, sourceMeta);
      }
      await markDone(updateId);
      return NextResponse.json({ ok: true });
    }

    // 8. Route: text command / photo message
    const photos = update.message?.photo;
    const photoFileId = Array.isArray(photos) && photos.length > 0 ? photos[photos.length - 1]?.file_id : undefined;
    if ((msgTextRaw || photoFileId) && chatId) {
      await handleCommand(msgTextRaw, chatId, update.message?.chat?.type ?? "private", from, photoFileId);
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
