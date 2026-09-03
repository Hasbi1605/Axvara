import { checkMagicBytes } from "@/lib/security";

export const MAX_ARTICLE_IMAGE_BYTES = 5 * 1024 * 1024;
export type ArticleImageKind = "cover" | "content";

type R2Bucket = {
  put: (key: string, body: ArrayBuffer, options: unknown) => Promise<void>;
};

export class ArticleMediaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ArticleMediaError";
  }
}

export function isArticleImageKind(value: string): value is ArticleImageKind {
  return value === "cover" || value === "content";
}

function randomHex() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function storeArticleWebp(bytes: Uint8Array, kind: ArticleImageKind) {
  if (bytes.byteLength > MAX_ARTICLE_IMAGE_BYTES) {
    throw new ArticleMediaError("Maksimum 5 MB", 413);
  }
  if (!checkMagicBytes(bytes, "image/webp")) {
    throw new ArticleMediaError("Media agent harus berupa WebP valid", 400);
  }

  const env = process.env as unknown as Record<string, unknown>;
  const bucket = (
    (globalThis as unknown as Record<string, unknown>).R2_ASSETS
    ?? env.R2_ASSETS
  ) as R2Bucket | undefined;
  if (!bucket) throw new ArticleMediaError("R2_ASSETS belum dibinding", 503);

  const folder = kind === "cover" ? "covers" : "content";
  const key = `articles/${folder}/${randomHex()}.webp`;
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await bucket.put(key, body, { httpMetadata: { contentType: "image/webp" } });
  return `/r2/${key}`;
}
