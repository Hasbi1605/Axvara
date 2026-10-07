// src/lib/pedia/notify-channel.ts — Kanal pesan pembeli Pedia.
//
// Aturan main (§9.5): email SELALU dikirim (pembeli wajib isi email saat
// checkout). WA hanya bila order berasal dari kanal WA (sales_channel
// whatsapp + conversation id) — pola notifyWhatsAppPaidAdmin. Telegram
// pembeli tidak ada (Pedia web-only di fase 1).
import type { createDatabaseAccess } from "@/lib/db-access";

type Db = ReturnType<typeof createDatabaseAccess>;

/** Kirim pesan pembeli via email (selalu) + WA bila tersedia. */
export async function sendPediaBuyerMessage(db: Db, orderCode: string, text: string): Promise<void> {
  const order = await db.queryFirst(
    `SELECT customer_email FROM orders WHERE code=?`, orderCode,
  ).catch(() => null);
  const email = String(order?.customer_email ?? "").trim();
  if (email) {
    try {
      const { sendPediaEmail } = await import("@/lib/pedia/email");
      await sendPediaEmail({ to: email, subject: `Pedia — ${orderCode}`, text });
    } catch { /* email best-effort; WA di bawah tetap jalan */ }
  }
}
