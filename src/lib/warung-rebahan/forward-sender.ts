// src/lib/warung-rebahan/forward-sender.ts — Pengirim email branding Axvara.
//
// Provider: Resend (https://resend.com) via API key server-only.
// Kenapa bukan SMTP Gmail pribadi: limit kecil, header "via gmail" bocor,
// gampang masuk spam, dan link WR ikut ter-forward bila kirim mentah.
// Resend + domain sendiri (noreply@axvara.id) = deliverability + white-label.
//
// Edge-safe: fetch() biasa, tanpa Node-only API.

export function isForwardEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.FORWARD_FROM_EMAIL?.trim(),
  );
}

export type ForwardSendResult =
  | { kind: "accepted"; ok: true; providerId: string; error?: never }
  | { kind: "rejected"; ok: false; providerId?: never; error: string }
  | { kind: "unknown"; ok: boolean; providerId?: never; error?: string };

// https://resend.com/docs/api-reference/errors — don't generalize 4xx:
// e.g. 409 can mean there was already another send in progress.
const rejected = (status: number, name: unknown) => status === 429
  || (status === 400 && ["invalid_idempotency_key", "validation_error"].includes(String(name)))
  || (status === 401 && ["missing_api_key", "restricted_api_key", "validation_error"].includes(String(name)))
  || (status === 403 && ["invalid_permission", "restricted_api_key", "suspended_api_key", "validation_error"].includes(String(name)))
  || (status === 404 && name === "not_found") || (status === 405 && name === "method_not_allowed")
  || (status === 422 && ["invalid_attachment", "invalid_parameter", "missing_required_field", "missing_required_parameter"].includes(String(name)));

/** Kirim 1 email transaksional via Resend. Timeout default 20 dtk. */
export async function sendForwardEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Pemanggil di jalur cron/webhook memakai batas lebih pendek (deadline run 45 dtk). */
  timeoutMs?: number;
  /** Kunci idempotensi provider opsional (mis. PIN checkout: order+versi,
   *  BUKAN PIN). Header Resend Idempotency-Key; pemanggil lama tanpa ini
   *  berperilaku identik. */
  idempotencyKey?: string;
}): Promise<ForwardSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  const from = process.env.FORWARD_FROM_EMAIL?.trim() || "";
  if (!apiKey || !from) return { kind: "rejected", ok: false, error: "forward_email_not_configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 20_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: `Axvara <${from}>`,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown; name?: unknown; message?: unknown } | null;
    if (!res.ok) return { kind: rejected(res.status, body?.name) ? "rejected" : "unknown", ok: false, error: String(body?.message || `resend_${res.status}`) };
    if (typeof body?.id === "string" && body.id.trim()) return { kind: "accepted", ok: true, providerId: body.id };
    return { kind: "unknown", ok: true }; // preserve legacy non-strict 2xx handling
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { kind: "unknown", ok: false, error: "resend_timeout" };
    }
    return { kind: "unknown", ok: false, error: error instanceof Error ? error.message : "resend_failed" };
  } finally {
    clearTimeout(timer);
  }
}
