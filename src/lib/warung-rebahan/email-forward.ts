// src/lib/warung-rebahan/email-forward.ts — Parser email WR + template Axvara.
//
// Alur bot email (fase 2): email dari info@warungrebahan.com masuk mailbox
// ingest → forwarder (Apps Script / worker Gmail) POST mentahnya ke
// /api/webhook/wr-email → parser ambil invoice WR → join ke
// wr_order_links.wr_order_id → kirim template branding Axvara ke buyer.
//
// Edge-safe: pure string/HTML parsing, tanpa Node-only API, tanpa fetch ke
// Gmail di sini (fetch dilakukan forwarder di luar Pages).

export type WrEmailKind = "order_update" | "invite_sent" | "unknown";

export type ParsedWrEmail = {
  kind: WrEmailKind;
  /** Invoice WR tanpa # (RBHN-20260916-DCB922). Kunci join ke wr_order_links. */
  wrInvoice: string | null;
  /** Status WR bila ada (PROCESSING / SUCCESS / ...). */
  status: string | null;
  product: string | null;
  variant: string | null;
  /** Email tujuan invite (uji.wr.tes@gmail.com) — BUKAN email buyer Axvara. */
  targetEmail: string | null;
  /** Total rupiah bila ada (Rp3.500 → 3500). */
  total: number | null;
};

const INVOICE_RE = /#?(RBHN-[A-Z0-9-]+)/i;
const EMAIL_RE = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
const STATUS_RE = /STATUS:\s*([A-Z_]+)/i;
const TOTAL_RE = /Rp\s?([\d.]+)/i;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function fieldAfter(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*\\n?([^\\n]{1,120})`, "i");
  const m = text.match(re);
  if (!m) return null;
  const v = m[1].trim();
  return v || null;
}

/**
 * Parse subject + body (HTML atau teks) email WR.
 * Didesain toleran terhadap ganti template: invoice adalah satu-satunya
 * field wajib; sisanya best-effort untuk memperkaya template Axvara.
 */
export function parseWrEmail(subject: string, bodyHtmlOrText: string): ParsedWrEmail {
  const text = stripHtml(bodyHtmlOrText);
  const haystack = `${subject}\n${text}`;
  const invoiceMatch = haystack.match(INVOICE_RE);
  const wrInvoice = invoiceMatch ? invoiceMatch[1].toUpperCase() : null;
  const statusMatch = text.match(STATUS_RE);
  const loweredSubject = subject.toLowerCase();
  const kind: WrEmailKind =
    loweredSubject.includes("invite") || text.toLowerCase().includes("invite berhasil")
      ? "invite_sent"
      : loweredSubject.includes("update") || loweredSubject.includes("pesanan") || statusMatch
        ? "order_update"
        : wrInvoice
          ? "order_update"
          : "unknown";
  const totalMatch = text.match(TOTAL_RE);
  return {
    kind,
    wrInvoice,
    status: statusMatch ? statusMatch[1].toUpperCase() : null,
    product: fieldAfter(text, "PRODUK"),
    variant: fieldAfter(text, "VARIAN"),
    targetEmail: (text.match(EMAIL_RE)?.[1] ?? null) && kind === "invite_sent"
      ? (text.match(new RegExp(`EMAIL TUJUAN\\s*\\n?\\s*(${EMAIL_RE.source})`, "i"))?.[1] ?? null)
      : null,
    total: totalMatch ? Number(totalMatch[1].replace(/\./g, "")) || null : null,
  };
}

export type AxvaraForwardTemplate = {
  subject: string;
  /** Teks polos untuk fallback + notifikasi WA/Telegram. */
  text: string;
  /** HTML branding Axvara (Midnight + Cyan). Nol jejak "Warung Rebahan". */
  html: string;
};

export type ForwardContext = {
  axvaraOrderCode: string;
  buyerName: string;
  invoiceUrl: string;
  supportWa: string;
  parsed: ParsedWrEmail;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shell(title: string, subtitle: string, inner: string): string {
  // Header email Axvara: logo Prism wireframe (inline SVG, currentColor=cyan)
  // + wordmark tracking lebar — sama seperti Navbar (font 300, 0.22em).
  // Body terang agar nyaman dibaca di Gmail (light default) dan tetap
  // terbaca di dark-mode (background kartu putih solid, bukan transparan).
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="37" viewBox="0 0 120 110" fill="none" stroke="#00E5FF" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M60 4 L6.5 104 L113.5 104 Z"/><path d="M60 4 L60 49.5"/><path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z"/><path d="M35.8 78.5 L84.2 78.5"/><path d="M35.8 78.5 L6.5 104"/><path d="M84.2 78.5 L113.5 104"/></svg>`;
  return `<!doctype html><html lang="id"><body style="margin:0;background:#080C1E;font-family:-apple-system,'SF Pro Text',Inter,Arial,sans-serif">`
    + `<div style="max-width:560px;margin:0 auto;padding:24px 16px">`
    + `<div style="background:#0B1025;border:1px solid rgba(255,255,255,.08);border-radius:20px 20px 0 0;padding:28px 24px;text-align:center">`
    + `<div style="margin:0;text-align:center;line-height:0">` + logo + `</div>`
    + `<p style="margin:10px 0 0;color:#fff;font-size:15px;font-weight:300;letter-spacing:4.5px">AXVARA</p>`
    + `<h1 style="margin:12px 0 0;color:#fff;font-size:22px;font-weight:700">${esc(title)}</h1>`
    + `<p style="margin:8px 0 0;color:rgba(241,245,255,.65);font-size:14px">${esc(subtitle)}</p></div>`
    + `<div style="background:#fff;border-radius:0 0 20px 20px;padding:24px">${inner}</div>`
    + `<p style="text-align:center;color:rgba(241,245,255,.4);font-size:12px;margin:16px 0 0">Email otomatis Axvara — mohon jangan dibalas.</p>`
    + `</div></body></html>`;
}

function invoiceBadge(code: string): string {
  return `<p style="text-align:center;margin:0 0 16px"><span style="display:inline-block;background:#f1f5ff;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;font-size:12px;color:#64748b">NO. INVOICE&nbsp; <b style="color:#0f1430">#${esc(code)}</b></span></p>`;
}

function cta(href: string, label: string): string {
  // CTA Cyan Axvara (#00E5FF, teks midnight) — bukan biru generik. Kontras
  // 13+:1 di atas putih, lolos WCAG AA untuk teks besar maupun kecil.
  return `<p style="text-align:center;margin:20px 0 0"><a href="${esc(href)}" style="display:inline-block;background:#00E5FF;color:#07101f;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:999px">${esc(label)}</a></p>`;
}

/** Template branding Axvara — TIDAK menyebut Warung Rebahan sama sekali. */
export function buildAxvaraForwardTemplate(ctx: ForwardContext): AxvaraForwardTemplate {
  const { parsed } = ctx;
  const firstName = ctx.buyerName.trim().split(/\s+/)[0] || "Kak";
  if (parsed.kind === "invite_sent") {
    const target = parsed.targetEmail ?? "email tujuan kamu";
    const product = parsed.product ?? "produk kamu";
    const subject = `Invite ${product} sudah terkirim — AXVARA ${ctx.axvaraOrderCode}`;
    const text =
      `Halo ${firstName}, invite ${product} sudah dikirim ke ${target}.\n` +
      `Cek Inbox/SPAM email tersebut lalu klik tautan undangan untuk mulai memakai layanan.\n` +
      `Invoice Axvara: ${ctx.invoiceUrl}\nButuh bantuan? WA ${ctx.supportWa}`;
    const html = shell(
      "Invite Terkirim",
      `Undangan ${product} sudah dikirim ke email kamu.`,
      invoiceBadge(ctx.axvaraOrderCode)
      + `<p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 12px">Halo ${esc(firstName)}, invite <b>${esc(product)}</b> telah dikirim. Cek email tujuan lalu klik tautannya untuk mulai menggunakan layanan.</p>`
      + `<div style="background:#f8fafc;border-left:3px solid #00E5FF;border-radius:0 12px 12px 0;padding:12px 16px;font-size:13px;color:#475569">`
      + `<p style="margin:0 0 4px"><span style="color:#94a3b8;font-size:11px;letter-spacing:1px">PRODUK</span><br><b style="color:#0f1430">${esc(product)}</b></p>`
      + `<p style="margin:8px 0 0"><span style="color:#94a3b8;font-size:11px;letter-spacing:1px">EMAIL TUJUAN</span><br><b style="color:#0f1430">${esc(target)}</b></p></div>`
      + `<div style="background:#f0fdff;border:1px solid rgba(0,229,255,.35);border-radius:12px;padding:12px 16px;margin-top:12px;font-size:13px;color:#0e7490">Silakan periksa <b>Inbox</b> atau folder <b>Spam</b>, lalu klik tautan di email undangan untuk mulai menggunakan layanan.</div>`
      + cta(ctx.invoiceUrl, "Lihat Invoice →")
      + `<p style="text-align:center;font-size:13px;color:#64748b;margin:20px 0 0">Butuh bantuan? Tim kami siap membantu: <b>WA ${esc(ctx.supportWa)}</b></p>`
      + `<p style="text-align:center;font-size:13px;color:#64748b;margin:12px 0 0">Terima kasih sudah berbelanja di <b style="color:#0f1430">Axvara</b>.</p>`,
    );
    return { subject, text, html };
  }
  const product = parsed.product ?? "pesanan kamu";
  const subject = `Pesanan ${product} sedang diproses — AXVARA ${ctx.axvaraOrderCode}`;
  const text =
    `Halo ${firstName}, pesanan ${product} kamu sedang diproses.\n` +
    `Detail akun akan segera tersedia di invoice: ${ctx.invoiceUrl}\nButuh bantuan? WA ${ctx.supportWa}`;
  const detailRows = [
    parsed.product ? `<p style="margin:0 0 4px"><span style="color:#94a3b8;font-size:11px;letter-spacing:1px">PRODUK</span><br><b style="color:#0f1430">${esc(parsed.product)}</b></p>` : "",
    parsed.variant ? `<p style="margin:8px 0 0"><span style="color:#94a3b8;font-size:11px;letter-spacing:1px">VARIAN</span><br><b style="color:#0f1430">${esc(parsed.variant)}</b></p>` : "",
  ].join("");
  const html = shell(
    "Pesanan Diproses",
    "Ada pembaruan status untuk pesananmu.",
    invoiceBadge(ctx.axvaraOrderCode)
    + `<p style="text-align:center;margin:0 0 12px"><span style="display:inline-block;background:rgba(0,229,255,.14);border:1px solid rgba(0,229,255,.4);color:#0e7490;font-size:11px;font-weight:700;letter-spacing:1px;border-radius:999px;padding:6px 14px">STATUS: DIPROSES</span></p>`
    + `<p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 12px">Halo ${esc(firstName)}, pesanan <b>${esc(product)}</b> kamu sedang diproses. Detail akun akan segera tersedia di halaman invoice.</p>`
    + (detailRows ? `<div style="background:#f8fafc;border-left:3px solid #00E5FF;border-radius:0 12px 12px 0;padding:12px 16px;font-size:13px;color:#475569">${detailRows}</div>` : "")
    + cta(ctx.invoiceUrl, "Lihat Invoice →")
    + `<p style="text-align:center;font-size:13px;color:#64748b;margin:20px 0 0">Butuh bantuan? Tim kami siap membantu: <b>WA ${esc(ctx.supportWa)}</b></p>`
    + `<p style="text-align:center;font-size:13px;color:#64748b;margin:12px 0 0">Terima kasih sudah berbelanja di <b style="color:#0f1430">Axvara</b>.</p>`,
  );
  return { subject, text, html };
}
