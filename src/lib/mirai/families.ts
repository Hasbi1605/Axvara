import { mapSkCategory } from "@/lib/sekalipay/sync";
import { miraiSellPriceIdr } from "./pricing";

export { miraiSellPriceIdr };

export type MiraiFamily = {
  key: string;
  name: string;
  slug: string;
  images: string[];
  imageUrl?: string;
  label: string;
  category: number;
};

export type MiraiGroupSpec = {
  key: string;
  name: string;
  slug: string;
  images: string[];
  imageUrl?: string;
  category: number;
};

export const MIRAI_GROUP_SPECS: Record<string, MiraiGroupSpec> = {
  gpt: {
    key: "gpt",
    name: "API GPT Token",
    slug: "api-gpt-token-mr",
    images: ["chatgpt-plus-1-bulan", "chatgpt-plus-av", "chatgpt-tunvn"],
    category: 1,
  },
  claude: {
    key: "claude",
    name: "API Claude Token",
    slug: "api-claude-token-mr",
    images: ["claude-api-tunvn", "claude-pro"],
    category: 1,
  },
  full: {
    key: "full",
    name: "API GPT + Claude Token",
    slug: "api-gpt-claude-token-mr",
    images: [],
    imageUrl: "/r2/products/d09170bb829405d48d95ed9c7b9ea613.webp",
    category: 1,
  },
  tau: {
    key: "tau",
    name: "API Model China Token",
    slug: "api-model-china-token-mr",
    images: [],
    imageUrl: "/r2/products/293b85da8d371b02c13c4ad854df2220.webp",
    category: 1,
  },
};

/** FNV-1a 32-bit: stable, dependency-free short hash for buyer-visible fallback slugs. */
export function miraiSlugHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function formatCompactNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace(/\.0+$/, "");
}

export function formatMiraiQuota(quotaTokens: number): string {
  if (!Number.isFinite(quotaTokens) || quotaTokens <= 0) return "Token";
  if (quotaTokens >= 1_000_000_000) return `${formatCompactNumber(quotaTokens / 1_000_000_000)}B Token`;
  if (quotaTokens >= 1_000_000) return `${formatCompactNumber(quotaTokens / 1_000_000)}M Token`;
  if (quotaTokens >= 1_000) return `${formatCompactNumber(quotaTokens / 1_000)}K Token`;
  return `${Math.round(quotaTokens)} Token`;
}

export function formatMiraiDuration(durationSeconds: number): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return "";
  if (durationSeconds >= 86400) {
    const days = durationSeconds % 86400 === 0 ? durationSeconds / 86400 : Math.round(durationSeconds / 86400);
    return `${days} Hari`;
  }
  if (durationSeconds >= 3600) {
    const hours = durationSeconds % 3600 === 0 ? durationSeconds / 3600 : Math.round(durationSeconds / 3600);
    return `${hours} Jam`;
  }
  return `${Math.max(1, Math.round(durationSeconds / 60))} Menit`;
}

export function miraiVariantLabel(quotaTokens: number, durationSeconds: number): string {
  const quota = formatMiraiQuota(quotaTokens);
  const duration = formatMiraiDuration(durationSeconds);
  return duration ? `${quota} · ${duration}` : quota;
}

export function miraiVariantSortOrder(quotaTokens: number, durationSeconds: number): number {
  const millions = Math.max(1, Math.round(quotaTokens / 1_000_000));
  const days = Math.max(0, Math.min(999, Math.round(durationSeconds / 86400)));
  return millions * 1000 + days;
}

export function miraiCategoryForName(groupKey: string, name: string): number {
  const normalizedGroup = groupKey.trim().toLowerCase();
  if (normalizedGroup in MIRAI_GROUP_SPECS) return MIRAI_GROUP_SPECS[normalizedGroup].category;
  const lowered = name.trim().toLowerCase();
  if (
    lowered.includes("gpt") ||
    lowered.includes("claude") ||
    lowered.includes("token") ||
    lowered.includes("deepseek") ||
    lowered.includes("qwen") ||
    lowered.includes("kimi") ||
    lowered.includes("glm") ||
    lowered.includes("ai ")
  ) {
    return 1;
  }
  return mapSkCategory(name);
}

export function miraiFamily(input: {
  package_code: string;
  group: string;
  name: string;
  quota_tokens: number;
  duration_seconds: number;
}): MiraiFamily {
  const groupKey = String(input.group ?? "").trim().toLowerCase();
  const label = miraiVariantLabel(input.quota_tokens, input.duration_seconds);
  const spec = MIRAI_GROUP_SPECS[groupKey];
  if (spec) {
    return {
      key: spec.key,
      name: spec.name,
      slug: spec.slug,
      images: spec.images,
      ...(spec.imageUrl ? { imageUrl: spec.imageUrl } : {}),
      label,
      category: spec.category,
    };
  }
  const cleanName = String(input.name ?? "").trim() || input.package_code;
  const slugBase =
    cleanName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 68) || "product";
  return {
    key: `package:${input.package_code}`,
    name: cleanName,
    slug: `${slugBase}-${miraiSlugHash(input.package_code)}-mr`,
    images: [],
    label,
    category: miraiCategoryForName(groupKey, cleanName),
  };
}

export function sortMiraiPackagesByQuota<T extends { quota_tokens: number; duration_seconds: number; code?: string; package_code?: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.quota_tokens !== b.quota_tokens) return a.quota_tokens - b.quota_tokens;
    if (a.duration_seconds !== b.duration_seconds) return a.duration_seconds - b.duration_seconds;
    return String(a.code ?? a.package_code ?? "").localeCompare(String(b.code ?? b.package_code ?? ""));
  });
}

export const miraiDefaultDescription = (name: string) =>
  `${name}. Pilih varian sesuai kebutuhan kuota dan masa aktif; aktivasi memakai redeem code setelah pembayaran lunas.`;
