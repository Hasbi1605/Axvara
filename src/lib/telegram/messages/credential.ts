import { COPY_SECTION_TITLES, type VariantCopy } from "@/lib/product-copy/format";
import { marketWarrantyClaim } from "@/lib/warranty-policy";
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
  plaintext, orderCode, productName, copy, secretTag = "pre",
}: CredentialMessageOptions): string[] {
  const identity = [
    productName ? `📦 ${escapeHtml(truncate(productName, 120))}` : "",
    orderCode ? `🔢 <code>${escapeHtml(truncate(orderCode, 120))}</code>` : "",
  ].filter(Boolean).join("\n");
  const firstHeader = ["🎁 <b>Produk Siap!</b>", identity].filter(Boolean).join("\n");
  const nextHeader = ["📦 <b>Detail Produk — lanjutan</b>", identity].filter(Boolean).join("\n");
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

  append("Detail akses/lisensi kamu:");
  text(plaintext, secretTag);
  if (secretTag === "code") append("👆 <i>Tap untuk copy</i>");

  append("📜 <b>Syarat &amp; Ketentuan</b>");
  for (const section of copy?.sections ?? []) {
    append(`<b>${COPY_SECTION_TITLES[section.kind]}</b>`);
    section.items.forEach(item => text(`• ${item}`));
  }
  (copy?.notes ?? []).forEach(note => text(`• ${note}`));
  if (!copy?.sections.length && !copy?.notes.length) {
    text("Ikuti ketentuan pada deskripsi produk. Jika belum jelas, hubungi admin melalui /bantuan.");
  }

  append("📖 <b>Cara Penggunaan / Aktivasi</b>");
  for (const group of copy?.activation ?? []) {
    if (group.title) text(group.title);
    group.steps.forEach((step, index) => text(`${index + 1}. ${step}`));
  }
  if (!copy?.activation.length) {
    text("Panduan khusus belum tersedia. Hubungi admin melalui /bantuan untuk petunjuk penggunaan/aktivasi produk ini.");
  }

  append("🛡 <b>Syarat klaim garansi</b>");
  text(`${marketWarrantyClaim.eligibility}. Masa dan cakupan garansi mengikuti ketentuan produk.`);
  marketWarrantyClaim.requirements.forEach((requirement, index) => text(`${index + 1}. ${requirement}`));
  marketWarrantyClaim.notes.forEach(textLine => text(textLine));
  text(marketWarrantyClaim.closing);
  append("🔒 Simpan baik-baik, jangan dibagikan. Simpan invoice untuk klaim.\n❓ Ada kendala? Ketik /bantuan. Ketentuan lengkap: /garansi");
  messages.push(current);
  return messages;
}
