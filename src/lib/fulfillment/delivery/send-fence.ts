import type { DatabaseAccess } from "@/lib/db-access";
import { MAX_ATTEMPTS } from "./types";

// A Telegram request has a native 10s timeout, WhatsApp 15s. Stop starting
// parts after 30s: at most 45s of transport, far below the 600s takeover.
const START_WINDOW_MS = 30_000;
export const SEND_CLAIM_STALE_SECONDS = 600;

export class CredentialSendDeferred extends Error {
  constructor(reason: string) { super(`credential_send_deferred:${reason}`); }
}

type SendResult = { ok: boolean; messageId?: string; definiteFailure?: boolean };

/** Only automatic item sends enter here; admin resend intentionally does not. */
export async function sendFencedCredential(
  database: DatabaseAccess, itemId: number, leaseFence: string, channel: "telegram",
  messages: string[], send: (text: string) => Promise<SendResult>,
): Promise<string> {
  if (!messages.length) throw new Error("credential_send_empty");
  // Reserve eight tail statements for item settlement/retry and job outcome.
  if (!database.canSpend(10)) throw new CredentialSendDeferred("credential_send_budget");
  const deadline = Date.now() + START_WINDOW_MS;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(messages)));
  const payloadHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  const token = crypto.randomUUID();
  let claim;
  let row;
  try {
    claim = await database.queryFirst(
      `INSERT INTO fulfillment_send_claims (item_id,channel,status,token,payload_hash,updated_at)
       SELECT ?,?,'sending',?,?,strftime('%Y-%m-%d %H:%M:%f','now') WHERE EXISTS (
         SELECT 1 FROM fulfillment_items WHERE id=? AND locked_until=? AND status='sending'
           AND julianday(locked_until)>julianday('now'))
       ON CONFLICT(item_id,channel) DO UPDATE SET status='sending',token=excluded.token,
         error=NULL,attempt_count=fulfillment_send_claims.attempt_count+1,updated_at=strftime('%Y-%m-%d %H:%M:%f','now')
       WHERE fulfillment_send_claims.payload_hash=excluded.payload_hash
         AND fulfillment_send_claims.attempt_count<?
         AND (fulfillment_send_claims.status='failed' OR
           (fulfillment_send_claims.status='sending'
            AND julianday(fulfillment_send_claims.updated_at)<julianday('now',?)))
       RETURNING *`,
      itemId, channel, token, payloadHash, itemId, leaseFence, MAX_ATTEMPTS, `-${SEND_CLAIM_STALE_SECONDS} seconds`,
    );
    // Successful CAS already returned its state; read only on a lost claim
    // to distinguish sent replay, active sending, changed payload and exhaustion.
    row = claim ?? await database.queryFirst(
      `SELECT status,token,payload_hash,part_count,message_id,attempt_count,
         julianday(updated_at)<julianday('now',?) AS stale
       FROM fulfillment_send_claims WHERE item_id=? AND channel=?`,
      `-${SEND_CLAIM_STALE_SECONDS} seconds`, itemId, channel,
    );
  } catch {
    // Unlike general notices, credentials MUST fail closed when the ledger fails.
    throw new CredentialSendDeferred("credential_send_ledger_unavailable");
  }
  if (row?.status === "sent") return String(row.message_id ?? "");
  if (!row) throw new CredentialSendDeferred("credential_send_lease_lost");
  if (row.payload_hash !== payloadHash) throw new Error("credential_send_payload_changed");
  if (!claim && Number(row.attempt_count) >= MAX_ATTEMPTS && (row.status === "failed" || row.stale)) {
    throw new Error("credential_send_attempts_exhausted");
  }
  if (!claim || row.token !== token) throw new CredentialSendDeferred("credential_send_pending");
  let messageId = String(row.message_id ?? "");
  for (let part = Number(row.part_count); part < messages.length; part++) {
    if (Date.now() >= deadline || !database.canSpend(9)) {
      await database.execRun(
        "UPDATE fulfillment_send_claims SET status='failed',error='credential_send_yield',updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE item_id=? AND channel=? AND token=? AND status='sending'",
        itemId, channel, token,
      );
      throw new CredentialSendDeferred("credential_send_yield");
    }
    // A thrown error, unreadable response, timeout, 5xx or a lost checkpoint
    // leaves sending intact. Never immediately replay a possibly accepted part.
    const result = await send(messages[part]).catch(() => ({ ok: false } as SendResult));
    if (!result.ok) {
      if (result.definiteFailure) {
        const failed = await database.execRun(
          "UPDATE fulfillment_send_claims SET status='failed',error='credential_send_rejected',updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE item_id=? AND channel=? AND token=? AND status='sending'",
          itemId, channel, token,
        );
        if (!failed.changes) throw new CredentialSendDeferred("credential_send_lease_lost");
        throw new Error("credential_send_rejected");
      }
      throw new CredentialSendDeferred("credential_send_outcome_unknown");
    }
    messageId = result.messageId ?? "";
    let saved;
    try {
      saved = await database.execRun(
        `UPDATE fulfillment_send_claims SET part_count=?,message_id=?,status=?,error=NULL,updated_at=strftime('%Y-%m-%d %H:%M:%f','now')
         WHERE item_id=? AND channel=? AND token=? AND status='sending'`,
        part + 1, messageId, part === messages.length - 1 ? "sent" : "sending", itemId, channel, token,
      );
    } catch { throw new CredentialSendDeferred("credential_send_checkpoint_unknown"); }
    if (!saved.changes) throw new CredentialSendDeferred("credential_send_lease_lost");
  }
  return messageId;
}
