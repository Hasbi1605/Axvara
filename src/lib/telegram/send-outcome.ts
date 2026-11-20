// Pure classifier for Bot API sendMessage results (no network/env imports), kept
// outside api.ts so tests that mock "@/lib/telegram/api" still classify real outcomes.

export type TelegramSendOutcome =
  | { kind: "sent"; messageId: number }
  | { kind: "rejected"; errorCode: 400 | 401 | 403 | 404 }
  | { kind: "rate_limited"; retryAfter?: number }
  | { kind: "ambiguous" };

/** Classify sendMessage only. callApi's synthetic failures have no error_code. */
export function classifyTelegramSend(res: unknown): TelegramSendOutcome {
  const body = res as { ok?: unknown; result?: { message_id?: unknown }; error_code?: unknown; parameters?: { retry_after?: unknown } } | null | undefined;
  const messageId = body?.result?.message_id;
  if (body?.ok === true && typeof messageId === "number" && Number.isSafeInteger(messageId)) {
    return { kind: "sent", messageId };
  }
  if (body?.ok === false) {
    const errorCode = body.error_code;
    if (errorCode === 400 || errorCode === 401 || errorCode === 403 || errorCode === 404) {
      return { kind: "rejected", errorCode };
    }
    if (errorCode === 429) {
      const retryAfter = body.parameters?.retry_after;
      return { kind: "rate_limited", retryAfter: typeof retryAfter === "number" && Number.isFinite(retryAfter) ? retryAfter : undefined };
    }
  }
  return { kind: "ambiguous" };
}
