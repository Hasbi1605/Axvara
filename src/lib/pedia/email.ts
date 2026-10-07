// src/lib/pedia/email.ts — Email transaksional Pedia via forwarder existing
// (pola buyer-email.ts: isForwardEmailConfigured + sendForwardEmail —
// Resend via Apps Script forwarder, BUKAN SDK langsung).
import { isForwardEmailConfigured, sendForwardEmail } from "@/lib/warung-rebahan/forward-sender";

export async function sendPediaEmail(args: { to: string; subject: string; text: string }): Promise<boolean> {
  if (!isForwardEmailConfigured()) return false;
  try {
    const sent = await sendForwardEmail({
      to: args.to, subject: args.subject,
      html: `<p>${args.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`,
      text: args.text, timeoutMs: 8_000,
    }).catch(() => ({ ok: false as const }));
    return (sent as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}
