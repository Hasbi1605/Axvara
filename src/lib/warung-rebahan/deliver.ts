// src/lib/warung-rebahan/deliver.ts — Delivery detail akun WR ke customer.
// Detail akun dienkripsi AES-256-GCM (FULFILLMENT_ENCRYPTION_KEY yang sama
// dengan fulfillment/crypto.ts) sebelum disimpan di wr_order_links.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";

export type WrOrderLinkRow = {
  id: number;
  order_code: string;
  wr_order_id: string | null;
  wr_variant_id: string;
  quantity: number;
  wr_cost: number;
  status: string;
};

export type WrDeliveryChannel = "web" | "telegram" | "whatsapp";

export function formatWrAccountDetails(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.slice(0, 2000);
  try {
    const data = raw as Record<string, unknown>;
    const details = Array.isArray(data) ? data : (data.account_details as unknown[]);
    if (Array.isArray(details) && details.length) {
      return details
        .map((d) => {
          if (typeof d === "string") return d;
          const o = d as Record<string, unknown>;
          const parts = ["email", "username", "user", "password", "pass", "pin", "akun", "note", "keterangan"]
            .map((k) => (o[k] != null && String(o[k]).trim() ? `${k}: ${String(o[k]).trim()}` : ""))
            .filter(Boolean);
          return parts.length ? parts.join(" · ") : JSON.stringify(o).slice(0, 500);
        })
        .join("\n")
        .slice(0, 2000);
    }
    const flat = ["email", "username", "password"]
      .map((k) => (data[k] != null ? `${k}: ${String(data[k])}` : ""))
      .filter(Boolean)
      .join("\n");
    if (flat) return flat.slice(0, 2000);
    return JSON.stringify(raw).slice(0, 2000);
  } catch {
    return String(raw).slice(0, 2000);
  }
}

export async function encryptAccountDetails(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  return encryptSecret(plaintext);
}

export async function decryptAccountDetails(ciphertext: string, iv: string): Promise<string> {
  return decryptSecret(ciphertext, iv);
}

/** Webhook order.completed: simpan akun terenkripsi + tandai delivered + kirim. */
export async function handleWrOrderCompleted(
  wrOrderId: string,
  accountPayload: unknown,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE wr_order_id=?`, wrOrderId).catch(
    () => null,
  );
  if (!link) return false;
  if (String(link.status) === "completed") return true; // idempoten
  const plaintext = formatWrAccountDetails(
    (accountPayload as { account_details?: unknown })?.account_details ?? accountPayload,
  );
  const { ciphertext, iv } = await encryptSecret(plaintext || "(detail akun kosong dari WR)");
  const now = new Date().toISOString();
  await execRun(
    `UPDATE wr_order_links SET status='completed', wr_account_details=?, wr_account_iv=?,
      completed_at=?, last_error=NULL, updated_at=? WHERE wr_order_id=?`,
    ciphertext,
    iv,
    now,
    now,
    wrOrderId,
  );
  // Semua link order ini completed → order Axvara delivered.
  const remaining = await queryFirst(
    `SELECT COUNT(*) AS n FROM wr_order_links WHERE order_code=? AND status!='completed'`,
    String(link.order_code),
  ).catch(() => ({ n: 1 }));
  if (Number(remaining?.n ?? 1) === 0) {
    await execRun(
      `UPDATE orders SET fulfillment_status='delivered', admin_note=?,
        updated_at=datetime('now') WHERE code=?`,
      `WR delivered ${now}`.slice(0, 200),
      String(link.order_code),
    ).catch(() => undefined);
  }
  await deliverToCustomer(String(link.order_code), plaintext, db).catch(() => undefined);
  return true;
}

/** Webhook order.failed: tandai failed + notifikasi admin (tanpa auto-refund). */
export async function handleWrOrderFailed(
  wrOrderId: string,
  errorMessage: string,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE wr_order_id=?`, wrOrderId).catch(
    () => null,
  );
  if (!link) return false;
  await execRun(
    `UPDATE wr_order_links SET status='failed', last_error=?, updated_at=datetime('now')
     WHERE wr_order_id=?`,
    String(errorMessage || "wr_order_failed").slice(0, 500),
    wrOrderId,
  );
  await execRun(
    `UPDATE orders SET fulfillment_status='failed', updated_at=datetime('now')
     WHERE code=? AND status='lunas'`,
    String(link.order_code),
  ).catch(() => undefined);
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (adminChatId && process.env.TELEGRAM_BOT_ENABLED === "true") {
    try {
      const { sendMessage } = await import("@/lib/telegram/api");
      await sendMessage({
        chat_id: adminChatId,
        text:
          `⚠️ <b>Order WR gagal</b> <code>${String(link.order_code)}</code>\n` +
          `WR: <code>${wrOrderId}</code> — ${String(errorMessage).slice(0, 200)}\n` +
          `Tangani manual (refund/cancel) via admin.`,
        parse_mode: "HTML",
      });
    } catch {
      /* best-effort */
    }
  }
  return true;
}

async function deliverToCustomer(
  orderCode: string,
  plaintext: string,
  db: DatabaseAccess,
): Promise<void> {
  const order = await db
    .queryFirst(
      `SELECT code, items, sales_channel, telegram_chat_id, telegram_user_id,
              channel_conversation_id, customer_wa
       FROM orders WHERE code=?`,
      orderCode,
    )
    .catch(() => null);
  if (!order) return;
  const channel = String(order.sales_channel || "web") as WrDeliveryChannel;
  const productNames = parseProductNames(order.items);
  if (channel === "telegram") {
    const buyerId = String(order.telegram_user_id || "");
    const privateChat = buyerId
      ? String(
          (await db.queryFirst(`SELECT chat_id FROM telegram_users WHERE user_id=?`, buyerId).catch(() => null))
            ?.chat_id || "",
        )
      : "";
    const chatId = privateChat && Number(privateChat) > 0 ? privateChat : String(order.telegram_chat_id || "");
    if (!chatId || Number(chatId) < 0) return; // tanpa private chat: jangan bocorkan ke grup
    const { sendMessage } = await import("@/lib/telegram/api");
    const sent = await sendMessage({
      chat_id: chatId,
      text:
        `✅ <b>Pesanan ${orderCode} sudah siap!</b>\n` +
        `📦 ${escapeHtml(productNames)}\n\n` +
        `<pre>${escapeHtml(plaintext)}</pre>\n\n` +
        `Simpan baik-baik. Ketik /garansi untuk ketentuan.`,
      parse_mode: "HTML",
    });
    if (!sent.ok) throw new Error("telegram_delivery_failed");
    return;
  }
  if (channel === "whatsapp") {
    const target = String(order.channel_member_id || order.customer_wa || "");
    if (!target) return;
    const { enqueueWhatsAppMessage, waOutboxKey } = await import("@/lib/whatsapp/outbox");
    await enqueueWhatsAppMessage(
      waOutboxKey("text", `wr-delivery:${orderCode}`),
      target,
      `*PRODUK AXVARA SIAP!*\nOrder: ${orderCode}\n${productNames}\n\nDetail akses:\n${plaintext}\n\nSimpan baik-baik. Ketik *garansi* untuk ketentuan.`,
    );
    return;
  }
  // Web: tanpa push channel — kredensial aman di admin_note terenkripsi?
  // TIDAK: admin_note plaintext terlihat admin. Untuk web, customer melihat
  // via halaman pesanan (GET /api/orders/:code/self dibatasi kode order).
  // Cukup tandai agar admin/halaman pesanan tahu akun sudah tersedia.
  await db
    .execRun(
      `UPDATE orders SET admin_note=?, updated_at=datetime('now')
       WHERE code=? AND (admin_note IS NULL OR admin_note NOT LIKE 'WR_CREDENTIAL_READY%')`,
      `WR_CREDENTIAL_READY — detail akun tersedia, sampaikan via WA/Telegram customer`,
      orderCode,
    )
    .catch(() => undefined);
}

function parseProductNames(raw: unknown): string {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(parsed)) return "Produk";
    return (
      parsed
        .map((i) => {
          const name = String((i as Record<string, unknown>).name || "Produk");
          const qty = Math.max(1, Number((i as Record<string, unknown>).qty || 1));
          return `${name} ×${qty}`;
        })
        .join(", ") || "Produk"
    );
  } catch {
    return "Produk";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Ambil detail akun terdekripsi untuk halaman pesanan / admin (server-only). */
export async function getDecryptedAccountDetails(
  orderCode: string,
  database?: DatabaseAccess,
): Promise<{ order_code: string; details: string; completed_at: string | null }[]> {
  const db = database ?? createDatabaseAccess();
  const rows = await db
    .queryAll(
      `SELECT order_code, wr_account_details, wr_account_iv, completed_at
       FROM wr_order_links WHERE order_code=? AND status='completed'
         AND wr_account_details IS NOT NULL`,
      orderCode,
    )
    .catch(() => []);
  const out: { order_code: string; details: string; completed_at: string | null }[] = [];
  for (const row of rows) {
    try {
      const details = await decryptSecret(String(row.wr_account_details), String(row.wr_account_iv));
      out.push({
        order_code: String(row.order_code),
        details,
        completed_at: row.completed_at ? String(row.completed_at) : null,
      });
    } catch {
      /* kunci rotasi / data korup: lewati, jangan bocorkan */
    }
  }
  return out;
}
