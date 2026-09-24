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

export type ForwardSendResult = {
  ok: boolean;
  providerId?: string;
  error?: string;
};

/** Kirim 1 email transaksional via Resend. Timeout default 20 dtk. */
export async function sendForwardEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Pemanggil di jalur cron/webhook memakai batas lebih pendek (deadline run 45 dtk). */
  timeoutMs?: number;
}): Promise<ForwardSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  const from = process.env.FORWARD_FROM_EMAIL?.trim() || "";
  if (!apiKey || !from) return { ok: false, error: "forward_email_not_configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 20_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
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
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) return { ok: false, error: String(body?.message || `resend_${res.status}`) };
    return { ok: true, providerId: body?.id };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "resend_timeout" };
    }
    return { ok: false, error: error instanceof Error ? error.message : "resend_failed" };
  } finally {
    clearTimeout(timer);
  }
}
