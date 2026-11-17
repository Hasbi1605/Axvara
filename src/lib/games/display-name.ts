// Buyer-only presentation. Supplier data, classification, and order snapshots stay raw.
const compact = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (text: string): string => text.replace(/\s+/g, " ").trim();
const capitalize = (text: string): string => text.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
const UNITS = /\b(?:cp|fc|fmp|uc|vp|bp|ml|mlbb|ff|ow|rp|pubg|aov|gb)\b/gi;
// Region/item identifiers are meaningful even when also present in the game title.
const KEEP_PREFIX = /^(?:europe|brazil|brasil|indonesia|malaysia|singapore|singapura|philippines|filipina|russia|rusia|turkey|turki|thailand|vietnam|india|global|asia|overseas|infinite)\b/i;

export function gamesVariantName(raw: string, game: { name: string; slug: string }): string {
  const cleaned = clean(raw).replace(/^[\s–-]+/, "");
  const gameNames = [compact(game.name), compact(game.slug)].filter(Boolean);
  const words: string[] = game.name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const initials = words.map((word) => word[0]).join("");
  let name = cleaned;
  // Repeat only shortening edits so repeated aliases also normalize idempotently.
  while (name && !KEEP_PREFIX.test(name)) {
    let remainder: string | undefined;
    const tokens = [...name.matchAll(/[\p{L}\p{N}]+/gu)];
    for (const token of tokens.reverse()) {
      const end = token.index! + token[0].length;
      const prefix = name.slice(0, end);
      if (!/^[\p{L}\p{N}\s–-]+$/u.test(prefix)) continue;
      const alias = compact(prefix);
      const tail = name.slice(end).replace(/^[\s:–-]+/, "");
      if (!tail || tail === name.slice(end)) continue;
      const isPrefix = alias.length >= 4 && gameNames.some((full) => full.startsWith(alias));
      const isAlias = isPrefix || (initials.length >= 2 && alias === initials)
        || (words.length >= 2 && words.includes(prefix.toLowerCase()));
      // A partial word alias (Strike, Legends, AU2) is safe only before a quantity.
      // Full names may precede a named item; allow Mobilelegend's missing final "s".
      const fullPrefix = alias.length >= 6 && gameNames.some((full) => full.startsWith(alias) && full.length - alias.length <= 1);
      if (isAlias && (/^\d/.test(tail) || (fullPrefix && tail.split(" ").length >= 2))) {
        remainder = tail;
        break;
      }
    }
    if (!remainder) break;
    name = remainder;
  }
  return capitalize((name || cleaned || "Nominal")
    // Angka ≥1000 tanpa pemisah: berdiri sendiri sebelum kata, atau di dalam kombinasi "(a+b)"/"a+b".
    .replace(/(^|[\s(+])(\d{4,})(?=\s+\p{L}|\s*[)+]|\s*\()/gu, (match, lead: string, digits: string) =>
      Number(digits) >= 1000 ? lead + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : match)
    // Region huruf kecil dalam kurung: kode ≤3 huruf jadi kapital (ID, US, BR), nama jadi Title Case.
    .replace(/\(([\p{Ll}\s]+)\)/gu, (_, text: string) => `(${text.trim().length <= 3 ? text.toUpperCase() : text.replace(/(^|\s)(\p{Ll})/gu, (_match, space: string, letter: string) => space + letter.toUpperCase())})`)
    .replace(UNITS, (unit) => unit.toUpperCase()));
}

const withoutEmoji = (text: string): string => clean(text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]+/gu, " "));
const restatement = (text: string): string => text.toLowerCase()
  .replace(/\broblox\s+(?=gift\s+card\b)/g, "")
  .replace(/\b(?:vcr|voucher)\b/g, "")
  .replace(/(\d)[.,](?=\d{3}(?:\D|$))/g, "$1")
  .match(/[\p{L}\p{N}]+/gu)?.sort().join(" ") ?? "";

export function gamesVariantDescription(raw: string | null, locale: "id" | "en", variantName?: string): string | null {
  if (!raw) return null;
  const text = withoutEmoji(raw).replace(/[\s:–-]+$/, "");
  if (!text) return null;
  const key = compact(text);
  if (/^prosesinstant?detikan$/.test(key)) return null;
  if (["allregionkecualimysgrutidakdidukung", "allregionkecualimysgrusiaakanotomatisgagal"].includes(key)) {
    return locale === "en"
      ? "Valid for all regions except Malaysia, Singapore, and Russia."
      : "Berlaku untuk semua region kecuali Malaysia, Singapura, dan Rusia.";
  }
  if (key === "khususregionluarregionidphmysgruautoditolak") {
    return locale === "en"
      ? "For overseas-region accounts only. Indonesia, Philippines, Malaysia, Singapore, and Russia accounts are not supported."
      : "Khusus akun region luar negeri. Akun region Indonesia, Filipina, Malaysia, Singapura, dan Rusia tidak didukung.";
  }
  if (key === "bidangidisinomorhpreedemvoucher") {
    return locale === "en"
      ? "Enter your phone number in the ID field to receive the voucher code."
      : "Isi kolom ID dengan nomor HP untuk menerima kode voucher.";
  }
  if (variantName && restatement(text) === restatement(variantName)) return null;
  const letters = text.match(/\p{L}/gu) ?? [];
  const uppercase = text.match(/\p{Lu}/gu) ?? [];
  return letters.length > 0 && uppercase.length / letters.length >= 0.7
    ? capitalize(text.toLowerCase()) : text;
}
