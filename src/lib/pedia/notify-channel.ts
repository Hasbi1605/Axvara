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
    `SELECT code, customer_email, buyer_access_version FROM orders WHERE code=?`, orderCode,
  ).catch(() => null);
  const email = String(order?.customer_email ?? "").trim();
  if (email) {
    try {
      const { sendPediaEmail } = await import("@/lib/pedia/email");
      // Kode akses di-derive ephemeral dari versi tersimpan aktual (NEVER
      // tebak v1 untuk order lama/reused); legacy (versi 0) = teks identik.
      // Link status hanya memuat kode order — tidak pernah access code.
      const { deriveOrderAccessCode } = await import("@/lib/order-access");
      const buyerAccessCode = await deriveOrderAccessCode({
        code: String(order?.code ?? orderCode), buyer_access_version: order?.buyer_access_version,
      }).catch(() => "");
      const body = buyerAccessCode
        ? `${text}\nKode Akses: ${buyerAccessCode} — simpan baik-baik dan jangan bagikan ke siapa pun.`
        : text;
      await sendPediaEmail({ to: email, subject: `Pedia — ${orderCode}`, text: body });
    } catch { /* email best-effort; WA di bawah tetap jalan */ }
  }
}
