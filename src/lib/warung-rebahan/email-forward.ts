// src/lib/warung-rebahan/email-forward.ts — Parser email WR + template Axvara.
//
// Alur bot email (fase 2): email dari info@warungrebahan.com masuk mailbox
// ingest → forwarder (Apps Script / worker Gmail) POST mentahnya ke
// /api/webhook/wr-email → parser ambil invoice WR → join ke
// wr_order_links.wr_order_id → kirim template branding Axvara ke buyer.
//
// Edge-safe: pure string/HTML parsing, tanpa Node-only API, tanpa fetch ke
// Gmail di sini (fetch dilakukan forwarder di luar Pages).
import type { Locale } from "@/lib/i18n/locale";

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
  locale?: Locale;
  axvaraOrderCode: string;
  buyerName: string;
  invoiceUrl: string;
  supportWa: string;
  parsed: ParsedWrEmail;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Nomor WA tampil (0895…) → link wa.me internasional (62…). */
function waLink(local: string): string {
  const digits = local.replace(/\D/g, "");
  const intl = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent("Halo AXVARA, saya butuh bantuan pesanan")}`;
}

/** URL absolut logo email — Gmail tidak render SVG inline, jadi pakai PNG
 *  (path Prism SAMA PERSIS dengan Navbar, stroke putih seperti navbar).
 *  siteUrl diteruskan dari webhook agar preview lokal juga bisa (localhost). */
export function emailLogoUrl(siteUrl: string): string {
  const base = /^https?:\/\//i.test(siteUrl.trim()) ? siteUrl.trim().replace(/\/$/, "") : "https://axvara.tech";
  return `${base}/brand/axvara-email-mark.png`;
}

const tr = (locale: Locale | undefined, id: string, en: string) => locale === "en" ? en : id;

function shell(title: string, subtitle: string, inner: string, opts: { logoUrl: string; siteUrl: string; locale?: Locale }): string {
  // Header: logo Prism PNG (asli navbar) + wordmark tracking lebar.
  // Body email TERANG PENUH (termasuk area luar kartu) — background midnight
  // di Gmail tampil sebagai blok hitam jelek dan mempergelap kartu.
  return `<!doctype html><html lang="${opts.locale === "en" ? "en" : "id"}"><body style="margin:0;background:#f1f5ff;font-family:-apple-system,'SF Pro Text',Inter,Arial,sans-serif">`
    + `<div style="max-width:560px;margin:0 auto;padding:24px 16px">`
    + `<div style="background:#080C1E;border-radius:20px 20px 0 0;padding:28px 24px;text-align:center">`
    + `<div style="margin:0;text-align:center;line-height:0"><img src="${esc(opts.logoUrl)}" width="72" height="66" alt="AXVARA" style="display:inline-block;border:0;outline:none" /></div>`
    + `<p style="margin:10px 0 0;color:#fff;font-size:15px;font-weight:300;letter-spacing:4.5px">AXVARA</p>`
    + `<h1 style="margin:12px 0 0;color:#fff;font-size:22px;font-weight:700">${esc(title)}</h1>`
    + `<p style="margin:8px 0 0;color:rgba(241,245,255,.65);font-size:14px">${esc(subtitle)}</p></div>`
    + `<div style="background:#fff;border-radius:0 0 20px 20px;padding:24px">${inner}</div>`
    + `<p style="text-align:center;color:#8892a8;font-size:12px;margin:16px 0 0">${tr(opts.locale, "Email otomatis", "Automated email")} <a href="${esc(opts.siteUrl)}" style="color:#8892a8;text-decoration:underline">Axvara</a> — ${tr(opts.locale, "mohon jangan dibalas.", "please do not reply.")}</p>`
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
  const en = ctx.locale === "en";
  const firstName = ctx.buyerName.trim().split(/\s+/)[0] || "Kak";
  // siteUrl = origin invoice (https://axvara.tech di prod) — untuk logo + link.
  const siteUrl = ctx.invoiceUrl.match(/^https?:\/\/[^/]+/i)?.[0] ?? "https://axvara.tech";
  const logoUrl = emailLogoUrl(siteUrl);
  const waHref = waLink(ctx.supportWa);
  // Footer: "Butuh bantuan?" (teks) → tombol wa.me klikable → "Axvara" link web.
  const supportBlock =
    `<p style="text-align:center;font-size:13px;color:#0f1430;font-weight:700;margin:20px 0 8px">${en ? "Need help? Our team is ready:" : "Butuh bantuan? Tim kami siap membantu:"}</p>`
    + `<p style="text-align:center;margin:0">`
    + `<a href="${esc(waHref)}" style="display:inline-block;background:#22C55E;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 24px;border-radius:999px">${en ? "Contact us on WhatsApp" : "Hubungi Kami via WhatsApp"}</a></p>`
    + `<p style="text-align:center;font-size:13px;color:#64748b;margin:12px 0 0">${en ? "Thank you for shopping at" : "Terima kasih sudah berbelanja di"} <a href="${esc(siteUrl)}" style="color:#0f1430;font-weight:700;text-decoration:none">Axvara</a>.</p>`;
  if (parsed.kind === "invite_sent") {
    const target = parsed.targetEmail ?? (en ? "your target email" : "email tujuan kamu");
    const product = parsed.product ?? (en ? "your product" : "produk kamu");
    const subject = en
      ? `${product} invite sent — AXVARA ${ctx.axvaraOrderCode}`
      : `Invite ${product} sudah terkirim — AXVARA ${ctx.axvaraOrderCode}`;
    const text =
      (en ? `Hi ${firstName}, the ${product} invite was sent to ${target}.\n` : `Halo ${firstName}, invite ${product} sudah dikirim ke ${target}.\n`) +
      (en ? `Check that email's Inbox/SPAM and click the invitation link to start using the service.\n` : `Cek Inbox/SPAM email tersebut lalu klik tautan undangan untuk mulai memakai layanan.\n`) +
      `${en ? "Axvara invoice" : "Invoice Axvara"}: ${ctx.invoiceUrl}\n${en ? "Need help? WhatsApp" : "Butuh bantuan? WA"} ${ctx.supportWa}`;
    const html = shell(
      en ? "Invite Sent" : "Invite Terkirim",
      en ? `The ${product} invitation has been sent to your email.` : `Undangan ${product} sudah dikirim ke email kamu.`,
      invoiceBadge(ctx.axvaraOrderCode)
      + `<p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 12px">${en ? `Hi ${esc(firstName)}, the` : `Halo ${esc(firstName)}, invite`} <b>${esc(product)}</b> ${en ? "invite has been sent. Check the target email and click the link to start using the service." : "telah dikirim. Cek email tujuan lalu klik tautannya untuk mulai menggunakan layanan."}</p>`
      + `<div style="background:#f8fafc;border-left:3px solid #00E5FF;border-radius:0 12px 12px 0;padding:12px 16px;font-size:13px;color:#475569">`
      + `<p style="margin:0 0 4px"><span style="color:#94a3b8;font-size:11px;letter-spacing:1px">${en ? "PRODUCT" : "PRODUK"}</span><br><b style="color:#0f1430">${esc(product)}</b></p>`
      + `<p style="margin:8px 0 0"><span style="color:#94a3b8;font-size:11px;letter-spacing:1px">${en ? "TARGET EMAIL" : "EMAIL TUJUAN"}</span><br><b style="color:#0f1430">${esc(target)}</b></p></div>`
      + `<div style="background:#f0fdff;border:1px solid rgba(0,229,255,.35);border-radius:12px;padding:12px 16px;margin-top:12px;font-size:13px;color:#0e7490">${en ? "Please check the <b>Inbox</b> or <b>Spam</b> folder, then click the link in the invitation email to start using the service." : "Silakan periksa <b>Inbox</b> atau folder <b>Spam</b>, lalu klik tautan di email undangan untuk mulai menggunakan layanan."}</div>`
      + cta(ctx.invoiceUrl, en ? "View Invoice →" : "Lihat Invoice →")
      + supportBlock,
      { logoUrl, siteUrl, locale: ctx.locale },
    );
  return { subject, text, html };
  }
  return buildOrderUpdateTemplate(ctx, firstName, siteUrl, logoUrl, supportBlock);
}

function buildOrderUpdateTemplate(
  ctx: ForwardContext,
  firstName: string,
  siteUrl: string,
  logoUrl: string,
  supportBlock: string,
): AxvaraForwardTemplate {
  const { parsed } = ctx;
  const en = ctx.locale === "en";
  const product = parsed.product ?? (en ? "your order" : "pesanan kamu");
  const subject = en
    ? `Order ${product} is being processed — AXVARA ${ctx.axvaraOrderCode}`
    : `Pesanan ${product} sedang diproses — AXVARA ${ctx.axvaraOrderCode}`;
  const text =
    (en ? `Hi ${firstName}, your order ${product} is being processed.\n` : `Halo ${firstName}, pesanan ${product} kamu sedang diproses.\n`) +
    (en ? `Product details will be available shortly in this email and on the order page: ${ctx.invoiceUrl}\n` : `Detail produk akan segera tersedia di email ini dan juga di halaman pesanan: ${ctx.invoiceUrl}\n`) +
    (en ? `No need to wait — we will let you know by email as soon as it is ready.\nNeed help? WhatsApp ${ctx.supportWa}` : `Tidak perlu menunggu — begitu siap, kami kabari lewat email ini.\nButuh bantuan? WA ${ctx.supportWa}`);
  const detailRows = [
    parsed.product ? `<p style="margin:0 0 4px"><span style="color:#94a3b8;font-size:11px;letter-spacing:1px">${en ? "PRODUCT" : "PRODUK"}</span><br><b style="color:#0f1430">${esc(parsed.product)}</b></p>` : "",
    parsed.variant ? `<p style="margin:8px 0 0"><span style="color:#94a3b8;font-size:11px;letter-spacing:1px">${en ? "VARIANT" : "VARIAN"}</span><br><b style="color:#0f1430">${esc(parsed.variant)}</b></p>` : "",
  ].join("");
  const html = shell(
    en ? "Order Processing" : "Pesanan Diproses",
    en ? "There is a status update for your order." : "Ada pembaruan status untuk pesananmu.",
    invoiceBadge(ctx.axvaraOrderCode)
    + `<p style="text-align:center;margin:0 0 12px"><span style="display:inline-block;background:rgba(0,229,255,.14);border:1px solid rgba(0,229,255,.4);color:#0e7490;font-size:11px;font-weight:700;letter-spacing:1px;border-radius:999px;padding:6px 14px">STATUS: ${en ? "PROCESSING" : "DIPROSES"}</span></p>`
    + `<p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 12px">${en ? `Hi ${esc(firstName)}, your order` : `Halo ${esc(firstName)}, pesanan`} <b>${esc(product)}</b> ${en ? "is being processed. Product details will be available shortly in this email and on the order page." : "kamu sedang diproses. Detail produk akan segera tersedia di email ini dan juga di halaman pesanan."}</p>`
    + `<p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 12px">${en ? "No need to wait — we will let you know by email as soon as it is ready. You can also reopen the order page anytime with the button below." : "Tidak perlu menunggu — begitu siap, kami kabari lewat email ini. Kamu juga bisa membuka lagi halaman pesanan kapan saja lewat tombol di bawah."}</p>`
    + (detailRows ? `<div style="background:#f8fafc;border-left:3px solid #00E5FF;border-radius:0 12px 12px 0;padding:12px 16px;font-size:13px;color:#475569">${detailRows}</div>` : "")
    + cta(ctx.invoiceUrl, en ? "View Invoice →" : "Lihat Invoice →")
    + supportBlock,
    { logoUrl, siteUrl, locale: ctx.locale },
  );
  return { subject, text, html };
}

/** Konteks email kredensial: isi detail akun dikirim LANGSUNG ke pembeli
 *  (keputusan owner 2026-09-18) — bukan hanya kabar. Dipakai delivery web
 *  untuk channel email; pengirim tetap Axvara via Resend. */
export type CredentialEmailContext = {
  locale?: Locale;
  axvaraOrderCode: string;
  buyerName: string;
  productNames: string;
  /** Detail akun terformat (sudah didekripsi). */
  details: string;
  invoiceUrl: string;
  supportWa: string;
  /**
   * Kode akses pesanan turunan HMAC (di-derive pemanggil dari versi
   * tersimpan). Hanya dirender bila non-empty; legacy (versi 0/kosong) =
   * output identik seperti sebelumnya.
   */
  buyerAccessCode?: string;
};

/**
 * Kotak kode akses pembeli — format blok sama seperti callout info existing
 * (cyan), kode tebal agar mudah dibaca/disalin. Tidak pernah memuat link
 * dengan kode di query/body.
 */
function accessCodeHtml(code: string, locale?: Locale): string {
  return `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0">`
    + `<p style="margin:0;color:#475569;font-size:12px">${code.length === 6 ? tr(locale, "PIN akses pesanan", "Order access PIN") : tr(locale, "Kode akses pesanan", "Order access code")}</p>`
    + `<p style="margin:6px 0;color:#0f1430;font-size:${code.length === 6 ? "20" : "15"}px;letter-spacing:${code.length === 6 ? "2" : "1"}px"><b>${esc(code)}</b></p>`
    + `<p style="margin:0;color:#475569;font-size:12px;line-height:1.6">${tr(locale, "Untuk membuka akun di web, isi nomor invoice, email atau No. WA checkout, dan", "To open the account on the web, enter the invoice number, checkout email or WhatsApp number, and this")} ${code.length === 6 ? "PIN" : tr(locale, "kode", "code")}.</p></div>`;
}

/** Template "Detail Akun Siap" — MEMUAT ISI KREDENSIAL (keputusan owner).
 *  Nol jejak supplier; ada peringatan jangan bagikan + tombol invoice
 *  sebagai cadangan bila email ini diteruskan orang lain. */
export function buildCredentialReadyTemplate(ctx: CredentialEmailContext): AxvaraForwardTemplate {
  const firstName = ctx.buyerName.trim().split(/\s+/)[0] || "Kak";
  const siteUrl = ctx.invoiceUrl.match(/^https?:\/\/[^/]+/i)?.[0] ?? "https://axvara.tech";
  const logoUrl = emailLogoUrl(siteUrl);
  const waHref = waLink(ctx.supportWa);
  const en = ctx.locale === "en";
  const product = ctx.productNames || (en ? "your order" : "pesanan kamu");
  const subject = en
    ? `Account details for ${product} are ready — AXVARA ${ctx.axvaraOrderCode}`
    : `Detail akun ${product} sudah siap — AXVARA ${ctx.axvaraOrderCode}`;
  const text =
    (en ? `Hi ${firstName}, the account details for ${product} are ready.\n\n` : `Halo ${firstName}, detail akun ${product} kamu sudah siap.\n\n`) +
    `${ctx.details}\n\n` +
    (ctx.buyerAccessCode ? `\n${ctx.buyerAccessCode.length === 6 ? "PIN" : (en ? "Access Code" : "Kode")}${en ? ": " : " Akses Pesanan: "}${ctx.buyerAccessCode}\n${en ? "Keep this code safe — do not share it with anyone." : "Simpan kode ini baik-baik — jangan bagikan ke siapa pun."}\n\n` : "") +
    (en ? `Keep it safe and do NOT share it with anyone.\n` : `Simpan baik-baik dan JANGAN bagikan ke siapa pun.\n`) +
    `${en ? "Axvara invoice" : "Invoice Axvara"}: ${ctx.invoiceUrl}\n${en ? "Need help? WhatsApp" : "Butuh bantuan? WA"} ${ctx.supportWa}`;
  // Detail di-render sebagai blok monospace per baris agar mudah disalin;
  // di-escape penuh (nilai dari upstream, bukan dari kita).
  const detailBlock = ctx.details
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => `<p style="margin:0 0 6px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#0f1430;word-break:break-all">${esc(l)}</p>`)
    .join("");
  const html = shell(
    en ? "Account Details Ready" : "Detail Akun Siap",
    en ? "Keep it safe — do not share it with anyone." : "Simpan baik-baik — jangan bagikan ke siapa pun.",
    invoiceBadge(ctx.axvaraOrderCode)
    + `<p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 12px">${en ? `Hi ${esc(firstName)}, the account details for` : `Halo ${esc(firstName)}, detail akun`} <b>${esc(product)}</b> ${en ? "are ready:" : "kamu sudah siap:"}</p>`
    + `<div style="background:#f8fafc;border-left:3px solid #00E5FF;border-radius:0 12px 12px 0;padding:12px 16px;font-size:13px;color:#475569">${detailBlock}</div>`
    + (ctx.buyerAccessCode ? accessCodeHtml(ctx.buyerAccessCode, ctx.locale) : "")
    + `<div style="background:#fef9e7;border:1px solid rgba(255,184,0,.4);border-radius:12px;padding:12px 16px;margin-top:12px;font-size:13px;color:#92690e">${en ? "Do not share these details with anyone, including anyone claiming to be an admin. Axvara admin will never ask for your account details." : "Jangan bagikan detail ini ke siapa pun, termasuk yang mengaku admin. Admin Axvara tidak pernah meminta detail akunmu."}</div>`
    + cta(ctx.invoiceUrl, en ? "View Invoice →" : "Lihat Invoice →")
    + `<p style="text-align:center;font-size:13px;color:#0f1430;font-weight:700;margin:20px 0 8px">${en ? "Need help? Our team is ready:" : "Butuh bantuan? Tim kami siap membantu:"}</p>`
    + `<p style="text-align:center;margin:0">`
    + `<a href="${esc(waHref)}" style="display:inline-block;background:#22C55E;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 24px;border-radius:999px">${en ? "Contact us on WhatsApp" : "Hubungi Kami via WhatsApp"}</a></p>`
    + `<p style="text-align:center;font-size:13px;color:#64748b;margin:12px 0 0">${en ? "Thank you for shopping at" : "Terima kasih sudah berbelanja di"} <a href="${esc(siteUrl)}" style="color:#0f1430;font-weight:700;text-decoration:none">Axvara</a>.</p>`,
    { logoUrl, siteUrl, locale: ctx.locale },
  );
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Email pembeli di luar alur WR (2026-09-25). Semua kabar pembeli memakai
// shell bermerek yang sama dengan email WR, bukan HTML polos tanpa logo.
// ---------------------------------------------------------------------------

function originOf(url: string): string {
  return url.match(/^https?:\/\/[^/]+/i)?.[0] ?? "https://axvara.tech";
}

function firstNameOf(buyerName: string): string {
  return buyerName.trim().split(/\s+/)[0] || "Kak";
}

function supportBlockHtml(siteUrl: string, supportWa: string, locale?: Locale): string {
  return `<p style="text-align:center;font-size:13px;color:#0f1430;font-weight:700;margin:20px 0 8px">${tr(locale, "Butuh bantuan? Tim kami siap membantu:", "Need help? Our team is ready:")}</p>`
    + `<p style="text-align:center;margin:0">`
    + `<a href="${esc(waLink(supportWa))}" style="display:inline-block;background:#22C55E;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 24px;border-radius:999px">${tr(locale, "Hubungi Kami via WhatsApp", "Contact us on WhatsApp")}</a></p>`
    + `<p style="text-align:center;font-size:13px;color:#64748b;margin:12px 0 0">${tr(locale, "Terima kasih sudah berbelanja di", "Thank you for shopping at")} <a href="${esc(siteUrl)}" style="color:#0f1430;font-weight:700;text-decoration:none">Axvara</a>.</p>`;
}

function detailLinesHtml(details: string): string {
  return details
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `<p style="margin:0 0 6px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#0f1430;word-break:break-all">${esc(line)}</p>`)
    .join("");
}

function rupiah(value: number): string {
  return `Rp${Math.max(0, Math.round(value)).toLocaleString("id-ID")}`;
}

export type OrderReadyEmailContext = {
  locale?: Locale;
  axvaraOrderCode: string;
  buyerName: string;
  invoiceUrl: string;
  supportWa: string;
  /** Isi yang dikirim ke pembeli, satu blok per baris pesanan. */
  items: { label: string; details: string }[];
  /**
   * Tanda terima pembayaran. Diisi pada pengiriman otomatis: pembeli produk
   * kirim otomatis menerima SATU email (pembayaran diterima + isi produk),
   * bukan dua email terpisah (keputusan owner 2026-09-25).
   */
  receipt?: { total: number; method: string; lines: string[] } | null;
  /**
   * Kode akses pesanan turunan HMAC (di-derive pemanggil dari versi
   * tersimpan). Hanya dirender bila non-empty; legacy (versi 0/kosong) =
   * output identik seperti sebelumnya.
   */
  buyerAccessCode?: string;
};

/** Template "Pesanan Siap": isi produk non-WR (otomatis atau dari admin). */
export function buildOrderReadyTemplate(ctx: OrderReadyEmailContext): AxvaraForwardTemplate {
  const siteUrl = originOf(ctx.invoiceUrl);
  const firstName = firstNameOf(ctx.buyerName);
  const en = ctx.locale === "en";
  const product = ctx.items.map((item) => item.label).filter(Boolean).join(", ") || (en ? "Your order" : "Pesanan kamu");
  const subject = en
    ? (ctx.receipt ? `Order ready, ${product} — AXVARA ${ctx.axvaraOrderCode}` : `${product} is ready — AXVARA ${ctx.axvaraOrderCode}`)
    : (ctx.receipt ? `Pesanan siap, ${product} — AXVARA ${ctx.axvaraOrderCode}` : `${product} sudah siap — AXVARA ${ctx.axvaraOrderCode}`);
  const intro = en ? `Hi ${firstName}, your order is ready.` : `Halo ${firstName}, pesananmu sudah siap.`;
  const receiptHtml = ctx.receipt
    ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;margin:0 0 12px;font-size:13px;color:#475569">`
      + `<p style="margin:0 0 6px;color:#94a3b8;font-size:11px;letter-spacing:1px">${en ? "PAYMENT RECEIVED" : "PEMBAYARAN DITERIMA"}</p>`
      + ctx.receipt.lines.map((line) => `<p style="margin:0 0 4px;color:#0f1430">${esc(line)}</p>`).join("")
      + `<p style="margin:8px 0 0;color:#0f1430"><b>${en ? "Total" : "Total"} ${esc(rupiah(ctx.receipt.total))}</b>${ctx.receipt.method ? ` · ${esc(ctx.receipt.method)}` : ""}</p></div>`
    : "";
  const itemsHtml = ctx.items
    .map((item) => `<div style="background:#f8fafc;border-left:3px solid #00E5FF;border-radius:0 12px 12px 0;padding:12px 16px;margin:0 0 10px;font-size:13px;color:#475569">`
      + `<p style="margin:0 0 8px;color:#94a3b8;font-size:11px;letter-spacing:1px">${esc(item.label.toUpperCase())}</p>`
      + detailLinesHtml(item.details)
      + `</div>`)
    .join("");
  const html = shell(
    en ? "Order Ready" : "Pesanan Siap",
    en ? "Your product is ready to use." : "Produkmu sudah siap dipakai.",
    invoiceBadge(ctx.axvaraOrderCode)
    + `<p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 12px">${esc(intro)}</p>`
    + receiptHtml
    + itemsHtml
    + (ctx.buyerAccessCode ? accessCodeHtml(ctx.buyerAccessCode, ctx.locale) : "")
    + `<div style="background:#fef9e7;border:1px solid rgba(255,184,0,.4);border-radius:12px;padding:12px 16px;margin-top:12px;font-size:13px;color:#92690e">${en ? "Do not share these details with anyone, including anyone claiming to be an admin. The same details are also stored on the order page." : "Jangan bagikan detail ini ke siapa pun, termasuk yang mengaku admin. Detail yang sama juga tersimpan di halaman pesanan."}</div>`
    + cta(ctx.invoiceUrl, en ? "View Order →" : "Lihat Pesanan →")
    + supportBlockHtml(siteUrl, ctx.supportWa, ctx.locale),
    { logoUrl: emailLogoUrl(siteUrl), siteUrl, locale: ctx.locale },
  );
  const text = [
    intro,
    ctx.receipt ? (en ? `\nPayment received:\n${ctx.receipt.lines.join("\n")}\nTotal ${rupiah(ctx.receipt.total)}${ctx.receipt.method ? ` · ${ctx.receipt.method}` : ""}` : `\nPembayaran diterima:\n${ctx.receipt.lines.join("\n")}\nTotal ${rupiah(ctx.receipt.total)}${ctx.receipt.method ? ` · ${ctx.receipt.method}` : ""}`) : "",
    ...ctx.items.map((item) => `\n${item.label}:\n${item.details}`),
    ctx.buyerAccessCode ? (en ? `\n${ctx.buyerAccessCode.length === 6 ? "PIN" : "Access Code"}: ${ctx.buyerAccessCode}\nKeep this code safe — do not share it with anyone.` : `\n${ctx.buyerAccessCode.length === 6 ? "PIN" : "Kode"} Akses Pesanan: ${ctx.buyerAccessCode}\nSimpan kode ini baik-baik — jangan bagikan ke siapa pun.`) : "",
    en ? "\nDo not share these details with anyone." : "\nJangan bagikan detail ini ke siapa pun.",
    en ? `Order page: ${ctx.invoiceUrl}` : `Halaman pesanan: ${ctx.invoiceUrl}`,
    en ? `Need help? WhatsApp ${ctx.supportWa}` : `Butuh bantuan? WA ${ctx.supportWa}`,
  ].filter(Boolean).join("\n");
  return { subject, text, html };
}

export type BrandedNoticeContext = {
  locale?: Locale;
  orderCode: string;
  buyerAccessCode?: string;
  /** Judul di header gelap, mis. "Pembayaran Diterima". */
  title: string;
  subtitle: string;
  /** Paragraf isi (teks polos, di-escape di sini). */
  paragraphs: string[];
  /** Kotak penegasan di bawah paragraf (mis. alasan penolakan). */
  callout?: { text: string; tone: "info" | "warning" } | null;
  orderUrl: string;
  supportWa: string;
  /** Pill status (pola "STATUS: DIPROSES" existing). Absent = output identik. */
  status?: { label: string; tone: "info" | "success" } | null;
  /** Kotak ringkasan label/nilai (pola PRODUK/VARIAN existing). Absent = output identik. */
  details?: { label: string; value: string }[] | null;
  /** Label CTA; default "Lihat Pesanan →". */
  ctaLabel?: string;
};

/** Shell bermerek untuk kabar pembeli (tanda terima, serah terima, penolakan, dst). */
export function renderBrandedNotice(ctx: BrandedNoticeContext): { html: string; text: string } {
  const siteUrl = originOf(ctx.orderUrl);
  const calloutHtml = ctx.callout
    ? ctx.callout.tone === "warning"
      ? `<div style="background:#fef9e7;border:1px solid rgba(255,184,0,.4);border-radius:12px;padding:12px 16px;margin-top:12px;font-size:13px;color:#92690e">${esc(ctx.callout.text)}</div>`
      : `<div style="background:#f0fdff;border:1px solid rgba(0,229,255,.35);border-radius:12px;padding:12px 16px;margin-top:12px;font-size:13px;color:#0e7490">${esc(ctx.callout.text)}</div>`
    : "";
  const statusHtml = ctx.status
    ? ctx.status.tone === "success"
      ? `<p style="text-align:center;margin:0 0 12px"><span style="display:inline-block;background:#ecfdf5;border:1px solid rgba(34,197,94,.45);color:#15803d;font-size:11px;font-weight:700;letter-spacing:1px;border-radius:999px;padding:6px 14px">STATUS: ${esc(ctx.status.label.toUpperCase())}</span></p>`
      : `<p style="text-align:center;margin:0 0 12px"><span style="display:inline-block;background:rgba(0,229,255,.14);border:1px solid rgba(0,229,255,.4);color:#0e7490;font-size:11px;font-weight:700;letter-spacing:1px;border-radius:999px;padding:6px 14px">STATUS: ${esc(ctx.status.label.toUpperCase())}</span></p>`
    : "";
  const detailsHtml = ctx.details?.length
    ? `<div style="background:#f8fafc;border-left:3px solid #00E5FF;border-radius:0 12px 12px 0;padding:12px 16px;font-size:13px;color:#475569">`
      + ctx.details.map((d, i) => `<p style="margin:${i ? "8px" : "0"} 0 0"><span style="color:#94a3b8;font-size:11px;letter-spacing:1px">${esc(d.label.toUpperCase())}</span><br><b style="color:#0f1430;word-break:break-word">${esc(d.value)}</b></p>`).join("")
      + `</div>`
    : "";
  const html = shell(
    ctx.title,
    ctx.subtitle,
    invoiceBadge(ctx.orderCode)
    + statusHtml
    + ctx.paragraphs.map((p) => `<p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 12px">${esc(p)}</p>`).join("")
    + detailsHtml
    + (ctx.buyerAccessCode ? accessCodeHtml(ctx.buyerAccessCode, ctx.locale) : "")
    + calloutHtml
    + cta(ctx.orderUrl, ctx.ctaLabel ?? (ctx.locale === "en" ? "View Order →" : "Lihat Pesanan →"))
    + supportBlockHtml(siteUrl, ctx.supportWa, ctx.locale),
    { logoUrl: emailLogoUrl(siteUrl), siteUrl, locale: ctx.locale },
  );
  const text = [
    `${ctx.title} — ${ctx.orderCode}`,
    "",
    ...(ctx.status ? [`Status: ${ctx.status.label}`] : []),
    ...ctx.paragraphs,
    ...(ctx.details?.length ? ["", ...ctx.details.map((d) => `${d.label}: ${d.value}`)] : []),
    ...(ctx.buyerAccessCode ? [ctx.locale === "en" ? `${ctx.buyerAccessCode.length === 6 ? "PIN" : "Access Code"}: ${ctx.buyerAccessCode}` : `${ctx.buyerAccessCode.length === 6 ? "PIN" : "Kode"} Akses Pesanan: ${ctx.buyerAccessCode}`] : []),
    ctx.callout ? `\n${ctx.callout.text}` : "",
    "",
    ctx.locale === "en" ? `Order page: ${ctx.orderUrl}` : `Halaman pesanan: ${ctx.orderUrl}`,
    ctx.locale === "en" ? `Need help? WhatsApp ${ctx.supportWa}` : `Butuh bantuan? WA ${ctx.supportWa}`,
    "",
    ctx.locale === "en" ? "Automated email from Axvara, please do not reply." : "Email otomatis dari Axvara, mohon jangan dibalas.",
  ].join("\n");
  return { html, text };
}
