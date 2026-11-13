import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { fill, pediaCopy, pediaRegionLabel, pediaServiceName } from "./copy";

const CHIP = /\b(?:(?:garansi\s+)?refill(?:\s+(?:lifetime|\d+\s*(?:days?|hari|d)\b))?|no refill|tanpa refill|tidak bergaransi|instant start|(?:no|less|high) drop)\b/gi;
const NOISE = /^(?:max(?:imum)?\s*:|min(?:imum)?\s*:|all type links?\b|tidak bergaransi\b|no refill\b)/i;

/** Display only: keep source names and all order identifiers unchanged. */
export function shortPediaName(name: string, platform = "", locale: "id" | "en" = "id") {
  const full = pediaServiceName(name, locale);
  const platformWord = platform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const seen = new Set<string>();
  const clean = full.replace(/\[([^\]]*)\]/g, (_, value: string) => NOISE.test(value.trim()) ? " " : ` ${value} `)
    .replace(CHIP, " ")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D★☆⚠◆◇●○►▶✓✔✦✧]+/gu, " ")
    .replace(platformWord ? new RegExp(`\\b${platformWord}\\b`, "gi") : /$^/, " ")
    .replace(/\b(followers?|pengikut|likes?|suka|views?|tayangan|penayangan|comments?|komentar|shares?|subscribers?|members?|plays?|saves?|reposts?)\b/gi, (word) => {
      const key = word.toLowerCase();
      if (seen.has(key)) return "";
      seen.add(key);
      return word;
    })
    .replace(/\b([\p{L}\p{N}]+)(?:\s+\1\b)+/giu, "$1")
    .replace(/\s*([|·/–—])(?:\s*[|·/–—])+\s*/g, " · ")
    .replace(/^[\s|·/–—-]+|[\s|·/–—-]+$/g, "")
    .replace(/\s+/g, " ").trim();
  return clean || full.trim() || pediaCopy(locale).variantFallback;
}

export function pediaVariantNames(products: PediaCatalogProduct[], locale: "id" | "en") {
  const rows = products.flatMap((product) => product.tiers.map((tier) => ({ tier, name: shortPediaName(tier.public_name ?? tier.label_note ?? product.name, product.platform, locale), qualifiers: [tier.region ? pediaRegionLabel(tier.region, locale) : "", tier.quality, tier.speed_note].filter((v): v is string => !!v).map((v) => shortPediaName(v, "", locale)) })));
  const names = new Map<number, string>();
  for (const row of rows) {
    const same = rows.filter((other) => other.name.toLowerCase() === row.name.toLowerCase());
    const qualifiers = row.qualifiers.filter((v) => !row.name.toLowerCase().includes(v.toLowerCase()))
      .sort((a, b) => a.length - b.length);
    const qualifier = qualifiers.find((value) => same.every((other) => other === row || !other.qualifiers.includes(value)));
    names.set(row.tier.id, same.length === 1 ? row.name : `${row.name} · ${qualifier || fill(pediaCopy(locale).variantOrdinal, { n: same.indexOf(row) + 1 })}`);
  }
  return names;
}

export function groupPediaMetrics(products: PediaCatalogProduct[]) {
  const groups = new Map<string, PediaCatalogProduct[]>();
  for (const product of products) {
    const group = groups.get(product.metric);
    if (group) group.push(product);
    else groups.set(product.metric, [product]);
  }
  return groups;
}
