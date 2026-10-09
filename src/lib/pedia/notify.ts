// src/lib/pedia/notify.ts — Notifikasi Telegram Pedia (PEDIA-PRD II/§9.5).
//
// Modest: hanya 3 ke pembeli (dibayar→kirim rupiah; selesai; partial+kredit)
// + 2 ke admin (needs_check konfirmasi ganda resubmit/cancel; saldo < ambang).
// TIDAK ADA spam per-paket kecil. Email pembeli dikirim bersamaan (M5).

import type { createDatabaseAccess } from "@/lib/db-access";

type Db = ReturnType<typeof createDatabaseAccess>;

export async function pediaOrderSummary(db: Db, orderCode: string): Promise<string> {
  const row = await db.queryFirst(
    `SELECT i.*, p.name AS product_name, p.slug AS product_slug
       FROM pedia_order_items i JOIN pedia_products p ON p.id=i.product_id
      WHERE i.order_code=?`,
    orderCode,
  ).catch(() => null);
  if (!row) return orderCode;
  return `${String(row.product_name)} · ${Number(row.quantity)} · ${String(row.target_normalized).slice(0, 80)}`;
}

/** Pembeli: "X sudah dibayar, lagi kami kirim. Cek status: link" (§9.5). */
export async function notifyPediaPaid(db: Db, orderCode: string, siteUrl: string): Promise<void> {
  const order = await db.queryFirst(`SELECT customer_wa FROM orders WHERE code=?`, orderCode).catch(() => null);
  void order;
  const summary = await pediaOrderSummary(db, orderCode);
  const { sendPediaBuyerMessage } = await import("@/lib/pedia/notify-channel");
  await sendPediaBuyerMessage(db, orderCode,
    `${summary} sudah dibayar, lagi kami kirim. Cek status: ${siteUrl}/pedia/lacak?code=${orderCode}`);
}

/** Pembeli: selesai. */
export async function notifyPediaCompleted(db: Db, orderCode: string): Promise<void> {
  const { sendPediaBuyerMessage } = await import("@/lib/pedia/notify-channel");
  const summary = await pediaOrderSummary(db, orderCode);
  await sendPediaBuyerMessage(db, orderCode, `${summary} — selesai. Makasih sudah order di Pedia.`);
}

/** Pembeli: partial/canceled + kode kredit. */
export async function notifyPediaCredit(
  db: Db, orderCode: string, creditCode: string, amount: number, kind: string,
): Promise<void> {
  const { sendPediaBuyerMessage } = await import("@/lib/pedia/notify-channel");
  const summary = await pediaOrderSummary(db, orderCode);
  const label = kind === "partial" ? "sebagian terkirim" : "gagal diproses";
  await sendPediaBuyerMessage(db, orderCode,
    `${summary} ${label}. Sisa Rp ${amount.toLocaleString("id-ID")} jadi kode kredit: ${creditCode} (berlaku 180 hari).`);
}

/** Admin: antrean needs_check (MANUAL — bukan auto-refund). */
export async function notifyPediaNeedsCheck(db: Db, orderCode: string, reason: string): Promise<void> {
  void db;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return;
  const { sendMessage } = await import("@/lib/telegram/api");
  await sendMessage({
    chat_id: chatId,
    text: `🟡 <b>Pedia butuh tindakan manual</b>\n${orderCode}\nSebab: ${reason}\n\nBuka Admin → Pedia → Pesanan.`,
    parse_mode: "HTML",
  }).catch(() => null);
}

/** Admin: saldo supplier < ambang (throttle 1:1 WR/SK — 2026-10-09).
 *
 * Dulu ping tiap 1 jam (tanpa syarat turun) → spam 9×/8 jam saat saldo Rp 0
 * stagnan. Kini cermin `warung-rebahan/saldo.ts` + `sekalipay/saldo.ts`:
 * kirim ulang hanya bila (a) belum pernah kirim dalam 6 jam terakhir, atau
 * (b) saldo TURUN melewati kelipatan Rp5.000. State `amount|timestamp_ms`
 * disimpan di `store_settings.pedia_balance_alert_at` (kunci yang sama —
 * tanpa migrasi skema; format datetime lama tetap dibaca: timestamp tak
 * diketahui → tulis format baru, tanpa spam ganda).
 *
 * Mengembalikan true bila pesan benar-benar dikirim (untuk test + penanda). */
export async function notifyPediaLowBalance(balance: number, db?: Db): Promise<boolean> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return false;
  const now = Date.now();
  const amount = Math.floor(Number(balance) || 0);
  if (db) {
    const row = await db.queryFirst(
      `SELECT value FROM store_settings WHERE key='pedia_balance_alert_at'`,
    ).catch(() => null);
    const raw = row ? String(row.value ?? "") : "";
    // Format baru `amount|ms`; format lama datetime `datetime('now')`.
    // Pakai parseExpiry kanonis (SQLite `YYYY-MM-DD HH:MM:SS` = UTC):
    // `Date.parse` mentah menganggapnya waktu LOKAL (WIB = UTC+7) sehingga
    // selisihnya 7 jam > 6 jam → state kemarin dianggap basi → spam.
    const { parseExpiry } = await import("@/lib/expiry");
    const parseLegacy = (s: string): number => parseExpiry(s) ?? NaN;
    let lastBalance = NaN;
    let lastMs = parseLegacy(raw);
    if (raw.includes("|")) {
      const [b, t] = raw.split("|");
      lastBalance = Number(b);
      lastMs = Number(t);
    }
    if (Number.isFinite(lastMs)) {
      if (now - lastMs < 6 * 60 * 60 * 1000) {
        // Dalam 6 jam: hanya bunyi lagi bila turun melewati kelipatan Rp5.000.
        // Format lama (amount tak diketahui) → bungkam + migrasi state di
        // bawah, JANGAN kirim (return sebelum tulis agar tidak spam ganda).
        if (!Number.isFinite(lastBalance)) {
          await db.execRun(
            `INSERT INTO store_settings (key, value, updated_at) VALUES ('pedia_balance_alert_at', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
            `${amount}|${lastMs}`,
          ).catch(() => null);
          return false;
        }
        if (!(amount <= Math.floor(lastBalance / 5000) * 5000 - 5000)) return false;
      }
    }
    await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES ('pedia_balance_alert_at', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
      `${amount}|${now}`,
    ).catch(() => null);
  }
  const { sendMessage } = await import("@/lib/telegram/api");
  await sendMessage({
    chat_id: chatId,
    text: `🔴 <b>Saldo ProviderSMM menipis</b>\nSisa Rp ${Math.round(amount).toLocaleString("id-ID")}. Top up di panel provider sebelum order macet.`,
    parse_mode: "HTML",
  }).catch(() => null);
  return true;
}
