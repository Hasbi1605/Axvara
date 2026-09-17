// POST /api/webhook/wr-email — Penerima forward email WR dari mailbox ingest.
//
// Arsitektur: Gmail TIDAK dipanggil dari Pages (butuh OAuth/IMAP yang tidak
// edge-safe). Forwarder eksternal — Google Apps Script di akun Gmail ingest
// (trigger tiap 1 menit, baca label WR-INGEST yang belum diproses) — POST
// mentah email ke sini dengan WR_EMAIL_WEBHOOK_SECRET. Route ini: verifikasi
// secret → parse invoice → join wr_order_links → kirim template Axvara via
// Resend (fallback: antrekan teks ke WA buyer via whatsapp_outbox).
//
// Idempoten: gmail_message_id UNIQUE di wr_email_forward_log — retry Apps
// Script tidak mengirim ganda ke buyer.

import { NextRequest, NextResponse } from "next/server";
import { queryFirst, execRun } from "@/lib/db";
import { constantTimeEqual } from "@/lib/security";
import { checkRateLimit } from "@/lib/rateLimit";
import { SITE } from "@/lib/site";
import {
  parseWrEmail,
  buildAxvaraForwardTemplate,
} from "@/lib/warung-rebahan/email-forward";
import {
  isForwardEmailConfigured,
  sendForwardEmail,
} from "@/lib/warung-rebahan/forward-sender";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_SIZE = 128_000;

function siteUrl(): string {
  const raw = (process.env.SITE_URL || SITE.webUrl).replace(/\/$/, "");
  return /^https?:\/\//i.test(raw) ? raw : SITE.webUrl;
}

export async function POST(request: NextRequest) {
  const expected = process.env.WR_EMAIL_WEBHOOK_SECRET?.trim() || "";
  if (!expected) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const supplied =
    request.headers.get("x-wr-email-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!constantTimeEqual(supplied, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(request, "webhook:warung")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  let body: { gmail_message_id?: unknown; subject?: unknown; body_html?: unknown; body_text?: unknown };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const gmailId = String(body.gmail_message_id || "").slice(0, 120);
  const subject = String(body.subject || "").slice(0, 300);
  const html = String(body.body_html || "");
  const text = String(body.body_text || "");
  if (!gmailId || (!html && !text)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  // Dedupe: retry Apps Script → balas duplicate tanpa kirim ulang.
  const existing = await queryFirst(
    `SELECT id, kind, axvara_order_code FROM wr_email_forward_log WHERE gmail_message_id=?`,
    gmailId,
  ).catch(() => null);
  if (existing) {
    return NextResponse.json({ ok: true, status: "duplicate", kind: String(existing.kind || "") });
  }

  const parsed = parseWrEmail(subject, html || text);
  if (!parsed.wrInvoice) {
    await execRun(
      `INSERT OR IGNORE INTO wr_email_forward_log (gmail_message_id, kind, error) VALUES (?,'skipped','no_invoice_found')`,
      gmailId,
    ).catch(() => undefined);
    return NextResponse.json({ ok: true, status: "skipped", reason: "no_invoice_found" });
  }
  // Join: invoice WR → order Axvara + buyer.
  const row = await queryFirst(
    `SELECT l.order_code, l.wr_order_id, o.customer_name, o.customer_email, o.customer_wa
     FROM wr_order_links l LEFT JOIN orders o ON o.code=l.order_code
     WHERE l.wr_order_id=? ORDER BY l.id DESC LIMIT 1`,
    parsed.wrInvoice,
  ).catch(() => null);
  const orderCode = String(row?.order_code || "");
  if (!row || !orderCode) {
    await execRun(
      `INSERT OR IGNORE INTO wr_email_forward_log (gmail_message_id, wr_invoice, kind, error) VALUES (?,?,'unmatched','order_not_found')`,
      gmailId, parsed.wrInvoice,
    ).catch(() => undefined);
    return NextResponse.json({ ok: true, status: "unmatched", wr_invoice: parsed.wrInvoice });
  }
  const buyerEmail = String(row.customer_email || "").trim();
  const kind = parsed.kind === "unknown" ? "order_update" : parsed.kind;
  const template = buildAxvaraForwardTemplate({
    axvaraOrderCode: orderCode,
    buyerName: String(row.customer_name || ""),
    invoiceUrl: `${siteUrl()}/pesanan/${encodeURIComponent(orderCode)}`,
    supportWa: SITE.adminWaLocal,
    parsed,
  });

  if (buyerEmail && buyerEmail.includes("@")) {
    if (!isForwardEmailConfigured()) {
      await execRun(
        `INSERT OR IGNORE INTO wr_email_forward_log (gmail_message_id, wr_invoice, axvara_order_code, kind, buyer_email, channel, error)
         VALUES (?,?,?,?,?,'email','forward_email_not_configured')`,
        gmailId, parsed.wrInvoice, orderCode, kind, buyerEmail,
      ).catch(() => undefined);
      return NextResponse.json({ ok: true, status: "held", reason: "forward_email_not_configured", order_code: orderCode }, { status: 202 });
    }
    const sent = await sendForwardEmail({ to: buyerEmail, subject: template.subject, html: template.html, text: template.text });
    await execRun(
      `INSERT OR IGNORE INTO wr_email_forward_log
         (gmail_message_id, wr_invoice, axvara_order_code, kind, buyer_email, buyer_notified_at, channel, error)
       VALUES (?,?,?,?,?,${sent.ok ? "datetime('now')" : "NULL"},'email',?)`,
      gmailId, parsed.wrInvoice, orderCode, kind, buyerEmail, sent.ok ? null : String(sent.error || "send_failed"),
    ).catch(() => undefined);
    if (!sent.ok) {
      return NextResponse.json({ ok: false, status: "send_failed", error: sent.error, order_code: orderCode }, { status: 502 });
    }
    return NextResponse.json({ ok: true, status: "forwarded", channel: "email", kind, order_code: orderCode });
  }
  // Fallback: buyer tanpa email → antrekan teks ke WA via whatsapp_outbox
  // (diproses cron operations seperti notifikasi WA lain; idempoten per order+kind).
  const buyerWa = String(row.customer_wa || "").trim();
  if (!buyerWa) {
    await execRun(
      `INSERT OR IGNORE INTO wr_email_forward_log (gmail_message_id, wr_invoice, axvara_order_code, kind, channel, error)
       VALUES (?,?,?,?,'none','no_buyer_contact')`,
      gmailId, parsed.wrInvoice, orderCode, kind,
    ).catch(() => undefined);
    return NextResponse.json({ ok: true, status: "held", reason: "no_buyer_contact", order_code: orderCode }, { status: 202 });
  }
  const idempotencyKey = `wr-email:${orderCode}:${parsed.wrInvoice}:${kind}`;
  try {
    await execRun(
      `INSERT OR IGNORE INTO whatsapp_outbox (idempotency_key, channel, destination, message_type, payload, status)
       VALUES (?,'whatsapp',?,'text',?,'pending')`,
      idempotencyKey, buyerWa,
      JSON.stringify({ text: `*AXVARA* — ${template.subject}\n\n${template.text}` }),
    );
  } catch {
    await execRun(
      `INSERT OR IGNORE INTO wr_email_forward_log (gmail_message_id, wr_invoice, axvara_order_code, kind, buyer_email, channel, error)
       VALUES (?,?,?,?,?,'whatsapp','outbox_failed')`,
      gmailId, parsed.wrInvoice, orderCode, kind, buyerWa,
    ).catch(() => undefined);
    return NextResponse.json({ ok: false, status: "outbox_failed", order_code: orderCode }, { status: 502 });
  }
  await execRun(
    `INSERT OR IGNORE INTO wr_email_forward_log
       (gmail_message_id, wr_invoice, axvara_order_code, kind, buyer_email, buyer_notified_at, channel)
     VALUES (?,?,?,?,?,datetime('now'),'whatsapp')`,
    gmailId, parsed.wrInvoice, orderCode, kind, buyerWa,
  ).catch(() => undefined);
  return NextResponse.json({ ok: true, status: "forwarded", channel: "whatsapp", kind, order_code: orderCode });
}
