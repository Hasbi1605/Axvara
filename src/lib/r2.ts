// src/lib/r2.ts — Cloudflare R2 bucket binding helper

export type R2Bucket = {
  put: (
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
  get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete: (key: string) => Promise<void>;
};

export function getR2Bucket(): R2Bucket | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const env = process.env as unknown as Record<string, unknown>;
  return (
    (g.R2_ASSETS as R2Bucket | undefined) ??
    (g.ASSETS as R2Bucket | undefined) ??
    (env.R2_ASSETS as R2Bucket | undefined) ??
    null
  );
}
