// src/lib/whatsapp/outbox.ts — Antrean pesan WhatsApp idempoten dengan retry (issue #13).
//
// Masalah: notifikasi penting (mis. "Pembayaran Diterima" ke buyer) hanya
// best-effort — gagal sekali lalu hilang selamanya, tanpa jejak di health.
// Tabel `whatsapp_outbox` sudah ada (migrasi 0007) tapi tidak pernah dipakai.
//
// Desain: enqueue idempoten (UNIQUE idempotency_key) → kirim sekali → tandai
// sent/failed. Cron operations memproses baris due (pending/failed dalam
// batas retry, next_attempt_at lewat) dengan claim CAS agar dua worker tidak
// mengirim ganda. Backoff 1-5-15-60 menit, maks 5 percobaan lalu `dead`.
import { execRun, getD1, queryAll, queryFirst, type D1Statement } from "@/lib/db";
import { sendTextMessage } from "./gateway";

export const WA_OUTBOX_RETRY_DELAYS_MINUTES = [1, 5, 15, 60];
export const WA_OUTBOX_MAX_ATTEMPTS = WA_OUTBOX_RETRY_DELAYS_MINUTES.length + 1;

export type WaOutboxKind = "payment_detected" | "text";

export function waOutboxKey(kind: WaOutboxKind, ref: string): string {
  return `wa:${kind}:${ref}`;
}

function nextAttemptSql(minutes: number): string {
  return `datetime('now', '+${minutes} minutes')`;
}

/** Masukkan pesan ke antrean; idempoten — key sama tidak membuat duplikat. */
export async function enqueueWhatsAppMessage(
  idempotencyKey: string,
  destination: string,
  message: string,
  messageType = "text",
): Promise<boolean> {
  const d1 = getD1();
  if (d1) {
    const statements: D1Statement[] = [
      d1.prepare(
        `INSERT OR IGNORE INTO whatsapp_outbox
          (idempotency_key, channel, destination, message_type, payload, status,
           attempt_count, next_attempt_at, created_at, updated_at)
         VALUES (?, 'whatsapp', ?, ?, ?, 'pending', 0, datetime('now'), datetime('now'), datetime('now'))`,
      ).bind(idempotencyKey, destination, messageType, message),
    ];
    await d1.batch(statements);
    const row = await queryFirst(`SELECT id FROM whatsapp_outbox WHERE idempotency_key=?`, idempotencyKey);
    return Boolean(row);
  }
  // Dev fallback: tanpa D1, kirim langsung (best-effort seperti sebelumnya).
  const result = await sendTextMessage({ target: destination, message });
  return result.ok;
}

/** Hasil claim: menang, kalah oleh worker lain, atau DB menolak (CHECK/dll). */
export type WaClaimResult =
  | { outcome: "claimed"; workerId: string }
  | { outcome: "lost" }
  | { outcome: "db_error"; error: string };

/** Ambil baris due untuk diproses cron (terbatas, terurut). */
export async function getDueWhatsAppOutbox(limit = 8): Promise<Record<string, unknown>[]> {
  return queryAll(
    `SELECT * FROM whatsapp_outbox
     WHERE status IN ('pending','failed')
       AND attempt_count < ?
       AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
       AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))
     ORDER BY next_attempt_at ASC, id ASC LIMIT ?`,
    WA_OUTBOX_MAX_ATTEMPTS,
    limit,
  ).catch(() => []);
}

/**
 * Klaim satu baris due menjadi `sending` dengan lease eksplisit.
 * Berbeda dengan versi lama yang menelan error DB dan mengembalikannya
 * sebagai "kalah claim": kegagalan database (mis. CHECK produksi yang
 * menolak `sending`) kini dilaporkan sebagai `db_error` agar cron/admin
 * dapat membedakannya dari perebutan worker yang normal.
 */
export async function claimWhatsAppOutboxRow(row: Record<string, unknown>): Promise<WaClaimResult> {
  const id = Number(row.id);
  const attempts = Number(row.attempt_count || 0);
  // Review R10: klaim adalah lease eksplisit, bukan sekadar bump attempt.
  // Worker menulis worker_id + locked_until (+5 mnt, di luar jangkauan
  // getDue dengan syarat locked_until NULL/lewat); worker kedua yang membaca
  // snapshot basi tetap kalah CAS karena status sudah 'sending' dan
  // attempt_count sudah naik. Tanpa lease, dua worker yang sama-sama lolos
  // getDue mengirim pesan ganda sebelum salah satunya selesai.
  const workerId = `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let claimed: { changes?: number | undefined };
  try {
    claimed = await execRun(
      `UPDATE whatsapp_outbox
       SET status='sending', attempt_count=attempt_count+1, worker_id=?, locked_until=datetime('now', '+5 minutes'), updated_at=datetime('now')
       WHERE id=? AND status IN ('pending','failed') AND attempt_count=?`,
      workerId,
      id,
      attempts,
    );
  } catch (error) {
    return { outcome: "db_error", error: error instanceof Error ? error.message : String(error) };
  }
  if (!claimed.changes) return { outcome: "lost" }; // dimenangkan worker lain
  return { outcome: "claimed", workerId };
}

/** Pulihkan lease `sending` basi (worker mati di tengah kirim) ke `failed`.
 *
 * Harus dipanggil dari jalur runtime (cron) sebelum mengambil baris due —
 * bukan dari SQL buatan tes. Syarat ketat:
 * - hanya `sending` yang lease-nya sudah lewat (pekerja aktif tak tersentuh);
 * - sent/dead tidak pernah diubah menjadi antrean kirim baru;
 * - outcome tercatat ambigu (`lease_recovered:delivery_outcome_unknown`)
 *   karena runtime tidak tahu apakah pesan sempat terkirim sebelum crash;
 *   tanpa janji exactly-once tanpa dukungan provider.
 * Mengembalikan jumlah baris yang dipulihkan.
 */
export async function recoverStaleWhatsAppLeases(): Promise<number> {
  try {
    const result = await execRun(
      `UPDATE whatsapp_outbox
       SET status='failed', worker_id=NULL, locked_until=NULL,
           last_error='lease_recovered:delivery_outcome_unknown',
           next_attempt_at=datetime('now'), updated_at=datetime('now')
       WHERE status='sending'
         AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))`,
    );
    return Number(result.changes ?? 0);
  } catch {
    return 0;
  }
}

/** Proses satu baris due dengan claim CAS; true bila selesai (sent/dead).
 *
 * Error database saat klaim (mis. CHECK produksi menolak `sending`)
 * dilempar agar pemanggil dapat membedakannya dari kalah claim normal —
 * menelannya sebagai `false` membuat outage schema terlihat seperti
 * perebutan worker biasa.
 */
export async function processWhatsAppOutboxRow(row: Record<string, unknown>): Promise<boolean> {
  const id = Number(row.id);
  const attempts = Number(row.attempt_count || 0);
  const claim = await claimWhatsAppOutboxRow(row);
  if (claim.outcome === "lost") return false; // dimenangkan worker lain
  if (claim.outcome === "db_error") throw new Error(`wa_outbox_claim_failed: ${claim.error}`);
  const workerId = claim.workerId;

  const fresh = (await queryFirst(`SELECT * FROM whatsapp_outbox WHERE id=?`, id)) ?? row;
  const result = await sendTextMessage({
    target: String(fresh.destination || ""),
    message: String(fresh.payload || ""),
  });
  if (result.ok) {
    await execRun(
      `UPDATE whatsapp_outbox
       SET status='sent', provider_message_id=?, worker_id=NULL, locked_until=NULL, last_error=NULL, updated_at=datetime('now')
       WHERE id=? AND worker_id=?`,
      result.messageId ?? null,
      id,
      workerId,
    );
    return true;
  }
  const nextAttempts = attempts + 1;
  if (nextAttempts >= WA_OUTBOX_MAX_ATTEMPTS) {
    await execRun(
      `UPDATE whatsapp_outbox
       SET status='dead', worker_id=NULL, locked_until=NULL, last_error=?, updated_at=datetime('now') WHERE id=? AND worker_id=?`,
      String(result.error || "send_failed").slice(0, 500),
      id,
      workerId,
    );
    return true;
  }
  const delay = WA_OUTBOX_RETRY_DELAYS_MINUTES[Math.min(nextAttempts - 1, WA_OUTBOX_RETRY_DELAYS_MINUTES.length - 1)];
  await execRun(
    `UPDATE whatsapp_outbox
     SET status='failed', worker_id=NULL, locked_until=NULL, last_error=?, next_attempt_at=${nextAttemptSql(delay)}, updated_at=datetime('now')
     WHERE id=? AND worker_id=?`,
    String(result.error || "send_failed").slice(0, 500),
    id,
    workerId,
  );
  return false;
}

/** Dipanggil cron operations: pulihkan lease basi lalu proses baris due.
 * Mengembalikan jumlah terkirim/mati; `recovered` = lease basi yang
 * dipulihkan runtime (bukan SQL buatan tes). Error DB saat klaim tidak
 * ditelan diam-diam: baris dilewati tetapi dihitung sebagai `claimErrors`
 * agar outage schema terlihat di hasil cron, bukan seperti kalah claim.
 */
export async function processDueWhatsAppOutbox(limit = 8): Promise<{ sent: number; dead: number; recovered?: number; claimErrors?: number }> {
  const recovered = await recoverStaleWhatsAppLeases();
  const rows = await getDueWhatsAppOutbox(limit);
  let sent = 0;
  let dead = 0;
  let claimErrors = 0;
  for (const row of rows) {
    const before = String(row.status || "");
    let done = false;
    try {
      done = await processWhatsAppOutboxRow(row);
    } catch (error) {
      // Kegagalan database (CHECK/schema) — bukan kalah claim. Catat agar
      // terlihat, jangan anggap sukses/perebutan normal.
      claimErrors++;
      try {
        await execRun(
          `UPDATE whatsapp_outbox SET last_error=?, updated_at=datetime('now') WHERE id=?`,
          String(error instanceof Error ? error.message : String(error)).slice(0, 500),
          Number(row.id),
        );
      } catch { /* best-effort marker */ }
      continue;
    }
    if (!done) continue;
    const after = await queryFirst(`SELECT status FROM whatsapp_outbox WHERE id=?`, Number(row.id));
    if (String(after?.status) === "sent") sent++;
    else if (String(after?.status) === "dead" && before !== "dead") dead++;
  }
  return { sent, dead, recovered, claimErrors };
}
