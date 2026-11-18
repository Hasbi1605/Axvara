import { COPY_SECTION_TITLES, type VariantCopy } from "@/lib/product-copy/format";
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

/** Escaping happens before counting; every part has complete tags/entities.
 * The 4096 limit is enforced on HTML too (stricter than Telegram's parsed text).
 * Split at Unicode code points and preserve every character of the credential.
 */
export function credentialMessages({
  plaintext, orderCode, productName, copy, secretTag = "pre", locale = "id",
}: CredentialMessageOptions & { locale?: Locale }): string[] {
  const en = locale === "en";
  const identity = [
    productName ? escapeHtml(truncate(productName, 120)) : "",
    orderCode ? `<code>${escapeHtml(truncate(orderCode, 120))}</code>` : "",
  ].filter(Boolean).join("\n");
  const firstHeader = [en ? "<b>📦 Product ready</b>" : "<b>📦 Produk siap</b>", identity].filter(Boolean).join("\n");
  const nextHeader = [en ? "<b>Product details (continued)</b>" : "<b>Detail produk (lanjutan)</b>", identity].filter(Boolean).join("\n");
  const blockLimit = 4096 - Math.max(firstHeader.length, nextHeader.length) - 2;
  const messages: string[] = [];
  let current = firstHeader;
  const append = (html: string) => {
    if (current.length + 2 + html.length > 4096) {
      messages.push(current);
      current = nextHeader;
    }
    current += `\n\n${html}`;
  };
  const text = (raw: string, tag?: "code" | "pre") => {
    const opening = tag ? `<${tag}>` : "";
    const closing = tag ? `</${tag}>` : "";
    const limit = blockLimit - opening.length - closing.length;
    let escaped = "";
    for (const char of raw) {
      const next = escapeHtml(char);
      if (escaped.length + next.length > limit) {
        append(`${opening}${escaped}${closing}`);
        escaped = "";
      }
      escaped += next;
    }
    if (escaped) append(`${opening}${escaped}${closing}`);
  };

  append(en ? "Your access/license details:" : "Detail akses/lisensi kamu:");
  text(plaintext, secretTag);
  if (secretTag === "code") append(en ? "<i>Tap to copy.</i>" : "<i>Ketuk untuk menyalin.</i>");

  append(en ? "<b>Terms &amp; Conditions</b>" : "<b>Syarat &amp; Ketentuan</b>");
  for (const section of copy?.sections ?? []) {
    append(`<b>${COPY_SECTION_TITLES[section.kind]}</b>`);
    section.items.forEach(item => text(`• ${item}`));
  }
  (copy?.notes ?? []).forEach(note => text(`• ${note}`));
  if (!copy?.sections.length && !copy?.notes.length) {
    text(en ? "Follow the terms in the product description. If anything is unclear, contact the admin via /bantuan." : "Ikuti ketentuan pada deskripsi produk. Jika belum jelas, hubungi admin melalui /bantuan.");
  }

  append(en ? "<b>How to Use / Activation</b>" : "<b>Cara Penggunaan / Aktivasi</b>");
  for (const group of copy?.activation ?? []) {
    if (group.title) text(group.title);
    group.steps.forEach((step, index) => text(`${index + 1}. ${step}`));
  }
  if (!copy?.activation.length) {
    text(en ? "No specific guide yet. Contact the admin via /bantuan for usage/activation help for this product." : "Panduan khusus belum tersedia. Hubungi admin melalui /bantuan untuk petunjuk penggunaan/aktivasi produk ini.");
  }

  append(en ? "<b>Warranty claim terms</b>" : "<b>Syarat klaim garansi</b>");
  const claimPolicy = en ? marketWarrantyClaimEn : marketWarrantyClaim;
  text(`${claimPolicy.eligibility}. ${en ? "Warranty length and coverage follow the product terms." : "Masa dan cakupan garansi mengikuti ketentuan produk."}`);
  claimPolicy.requirements.forEach((requirement, index) => text(`${index + 1}. ${requirement}`));
  claimPolicy.notes.forEach(textLine => text(textLine));
  text(claimPolicy.closing);
  append(en ? "Keep these access details private, do not share them. Keep the invoice for claims.\nHelp: /bantuan. Full terms: /garansi" : "Simpan detail akses ini, jangan dibagikan. Simpan invoice untuk klaim.\nBantuan: /bantuan. Ketentuan lengkap: /garansi");
  messages.push(current);
  return messages;
}
