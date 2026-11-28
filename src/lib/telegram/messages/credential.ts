import { copySectionTitles, type VariantCopy } from "@/lib/product-copy/format";
import { appLogoHtml } from "../app-logo-emoji";
import { marketWarrantyClaim, marketWarrantyClaimEn } from "@/lib/warranty-policy";
import type { Locale } from "@/lib/i18n/locale";
import { escapeHtml, truncate } from "./format";

type CredentialMessageOptions = {
  plaintext: string;
  orderCode?: string;
  productName?: string;
  copy?: VariantCopy | null;
  secretTag?: "code" | "pre";
};

type CredentialTxtUnit = {
  plaintext: string;
  productName?: string;
  copy?: VariantCopy | null;
};

/**
 * Plain UTF-8 text file for multi-unit / long credentials (Item 14). One file
 * per "Ambil Ulang Produk" instead of N HTML bubbles. Contains NO HTML tags —
 * the buyer's credentials stay verbatim so copy-paste is lossless.
 */
export function buildCredentialsTxtFile(params: {
  orderCode: string;
  units: CredentialTxtUnit[];
  locale?: Locale;
}): string {
  const en = params.locale === "en";
  const total = params.units.length;
  const lines: string[] = [
    `AXVARA - ${en ? "Order" : "Pesanan"} ${params.orderCode}`,
    en ? "Access/license details. Keep private, do not share." : "Detail akses/lisensi. Jangan dibagikan ke siapa pun.",
    "",
  ];
  params.units.forEach((unit, index) => {
    lines.push(`--- Unit ${index + 1}/${total}${unit.productName ? `: ${unit.productName}` : ""} ---`);
    lines.push(unit.plaintext);
    const sections = unit.copy?.sections ?? [];
    if (sections.length || (unit.copy?.notes ?? []).length) {
      lines.push("", en ? "Terms & Conditions:" : "Syarat & Ketentuan:");
      for (const section of sections) for (const item of section.items) lines.push(`- ${item}`);
      for (const note of unit.copy?.notes ?? []) lines.push(`- ${note}`);
    }
    lines.push("");
  });
  const claim = en ? marketWarrantyClaimEn : marketWarrantyClaim;
  lines.push(en ? "Warranty claim terms:" : "Syarat klaim garansi:");
  lines.push(`- ${claim.eligibility}`);
  claim.requirements.forEach((req) => lines.push(`- ${req}`));
  claim.notes.forEach((note) => lines.push(`- ${note}`));
  return lines.join("\n");
}

export function credentialsTxtFilename(orderCode: string): string {
  const safe = String(orderCode || "ORDER").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "ORDER";
  return `AXVARA-${safe}.txt`;
}

const CREDENTIAL_SEPARATOR = "━━━━━━━━━━━━━━━━";
const SECTION_ICON: Record<string, string> = { paket: "📌", proses: "📦", aturan: "⚠️", garansi: "🛡" };

/** Escaping happens before counting; every part has complete tags/entities.
 * The 4096 limit is enforced on HTML too (stricter than Telegram's parsed text).
 * Split at Unicode code points and preserve every character of the credential.
 * Layout (Telegram only): product logo header, credential copy block, icon
 * section headers, separators, collapsible claim terms, thank-you footer.
 */
export function credentialMessages({
  plaintext, orderCode, productName, copy, secretTag = "pre", locale = "id",
}: CredentialMessageOptions & { locale?: Locale }): string[] {
  const en = locale === "en";
  const titles = copySectionTitles(locale);
  const nameLine = productName
    ? `${appLogoHtml(productName, "🛍")} <b>${escapeHtml(truncate(productName, 120))}</b>`
    : "";
  const codeHtml = orderCode ? ` · <code>${escapeHtml(truncate(orderCode, 120))}</code>` : "";
  const firstHeader = [nameLine, `🎁 <b>${en ? "Product ready" : "Produk siap"}</b>${codeHtml}`].filter(Boolean).join("\n");
  const nextHeader = [nameLine, `<b>${en ? "Product details (continued)" : "Detail produk (lanjutan)"}</b>${codeHtml}`].filter(Boolean).join("\n");
  const blockLimit = 4096 - Math.max(firstHeader.length, nextHeader.length) - 2;
  const messages: string[] = [];
  let current = firstHeader;
  const append = (html: string, gap = "\n\n") => {
    if (current.length + gap.length + html.length > 4096) {
      messages.push(current);
      current = nextHeader;
      gap = "\n\n";
    }
    current += `${gap}${html}`;
  };
  const text = (raw: string, tag?: "code" | "pre", gap = "\n") => {
    const opening = tag ? `<${tag}>` : "";
    const closing = tag ? `</${tag}>` : "";
    const limit = blockLimit - opening.length - closing.length;
    let escaped = "";
    for (const char of raw) {
      const next = escapeHtml(char);
      if (escaped.length + next.length > limit) {
        append(`${opening}${escaped}${closing}`, gap);
        escaped = "";
      }
      escaped += next;
    }
    if (escaped) append(`${opening}${escaped}${closing}`, gap);
  };

  append(CREDENTIAL_SEPARATOR);
  append(`🔐 <b>${en ? "Your access/license details" : "Detail akses/lisensi kamu"}</b>`, "\n");
  text(plaintext, secretTag);
  append(secretTag === "code"
    ? (en ? "💡 <i>Tap to copy.</i>" : "💡 <i>Ketuk untuk menyalin.</i>")
    : (en ? "💡 <i>Tap the block above to copy.</i>" : "💡 <i>Ketuk blok di atas untuk menyalin.</i>"), "\n");

  append(CREDENTIAL_SEPARATOR);
  const sections = copy?.sections ?? [];
  const notes = copy?.notes ?? [];
  sections.forEach((section, index) => {
    append(`${SECTION_ICON[section.kind] ?? "📌"} <b>${escapeHtml(titles[section.kind])}</b>`, index === 0 ? "\n" : "\n\n");
    section.items.forEach(item => text(`• ${item}`));
  });
  if (!sections.length) {
    append(en ? "📌 <b>Terms &amp; Conditions</b>" : "📌 <b>Syarat &amp; Ketentuan</b>", "\n");
  }
  notes.forEach(note => text(`• ${note}`));
  if (!sections.length && !notes.length) {
    text(en ? "Follow the terms in the product description. If anything is unclear, contact the admin via /bantuan." : "Ikuti ketentuan pada deskripsi produk. Jika belum jelas, hubungi admin melalui /bantuan.");
  }

  append(en ? "🚀 <b>How to Use / Activation</b>" : "🚀 <b>Cara Penggunaan / Aktivasi</b>");
  for (const group of copy?.activation ?? []) {
    if (group.title) append(`<i>${escapeHtml(truncate(group.title, 200))}</i>`, "\n");
    group.steps.forEach((step, index) => text(`${index + 1}. ${step}`));
  }
  if (!copy?.activation.length) {
    text(en ? "No specific guide yet. Contact the admin via /bantuan for usage/activation help for this product." : "Panduan khusus belum tersedia. Hubungi admin melalui /bantuan untuk petunjuk penggunaan/aktivasi produk ini.");
  }

  append(CREDENTIAL_SEPARATOR);
  const claimPolicy = en ? marketWarrantyClaimEn : marketWarrantyClaim;
  const claimLines = [
    `${claimPolicy.eligibility}. ${en ? "Warranty length and coverage follow the product terms." : "Masa dan cakupan garansi mengikuti ketentuan produk."}`,
    ...claimPolicy.requirements.map((requirement, index) => `${index + 1}. ${requirement}`),
    ...claimPolicy.notes,
    claimPolicy.closing,
  ];
  const claimHeader = en ? "🧾 <b>Warranty claim terms</b>" : "🧾 <b>Syarat klaim garansi</b>";
  const claimQuote = `<blockquote expandable>${claimHeader}\n${claimLines.map(escapeHtml).join("\n")}</blockquote>`;
  if (claimQuote.length <= blockLimit) {
    append(claimQuote, "\n");
  } else {
    append(claimHeader, "\n");
    claimLines.forEach(line => text(line));
  }

  append(CREDENTIAL_SEPARATOR, "\n");
  append(en ? "🛒 <b>Thanks for shopping at AXVARA!</b> ✨" : "🛒 <b>Terima kasih sudah belanja di AXVARA!</b> ✨", "\n");
  append(en ? "<i>Keep these access details private, do not share them. Keep the invoice for claims.</i>" : "<i>Simpan detail akses ini, jangan dibagikan. Simpan invoice untuk klaim.</i>", "\n");
  messages.push(current);
  return messages;
}
