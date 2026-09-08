// Klasifikasi error webhook Telegram (dipisah dari route agar Next.js build
// tidak menolak field export tambahan pada route handler).

/**
 * Bedakan kegagalan sementara (layak retry Telegram via 500) dari permanen.
 * Klasifikasi berdasarkan PENYEBAB, bukan kelas error semata (review R5):
 * - Jaringan/timeout selalu transient — termasuk TypeError('fetch failed')
 *   dari fetch/undici. Memukul rata semua TypeError sebagai permanen membuat
 *   gangguan jaringan menjadi silent drop (200 error_handled).
 * - Bug tipe/referensi/sintaks TANPA jejak jaringan adalah permanen.
 * - Config hilang permanen (retry tidak menciptakan token).
 * Default: transient — lebih aman mencoba lagi daripada diam.
 */
export function isTransientWebhookError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/TELEGRAM_BOT_TOKEN not configured|bot_not_configured|not configured/i.test(msg)) return false;
  if (/fetch failed|network|timeout|abort|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|TLS|SSL/i.test(msg)) return true;
  if (/^(TypeError|ReferenceError|SyntaxError|RangeError):/i.test(msg)) return false;
  return true;
}

/**
 * Hasil helper Telegram {ok:false}: bedakan kegagalan penting (pesan tak
 * terkirim — wajib retry nyata, JANGAN markDone) dari kegagalan kosmetik
 * (loading bar, aksi ketik — boleh lanjut tanpa retry transaksi).
 * Review R5: mengabaikan ok:false pada /cart membuat update dianggap done
 * tanpa pemulihan; me-retry transaksi yang sudah tersimpan juga salah.
 */
export function isCriticalSendResult(result: { ok: boolean; description?: string }, context: "transactional" | "cosmetic"): boolean {
  if (result.ok) return false;
  if (context === "cosmetic") return false;
  return true;
}
