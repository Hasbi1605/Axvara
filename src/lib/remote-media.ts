import { MAX_ARTICLE_IMAGE_BYTES } from "@/lib/article-media";
import { checkMagicBytes } from "@/lib/security";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const BLOCKED_HOST_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".home.arpa",
  ".invalid",
  ".test",
  ".onion",
];

export class RemoteMediaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RemoteMediaError";
  }
}

export function parsePublicRemoteImageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteMediaError("source_url tidak valid", 400);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
  const isBlockedName = hostname === "localhost"
    || !hostname.includes(".")
    || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));

  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
    || isIpLiteral
    || isBlockedName
  ) {
    throw new RemoteMediaError("source_url harus berupa URL HTTPS publik", 400);
  }

  url.hash = "";
  return url;
}

async function readWithLimit(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTICLE_IMAGE_BYTES) {
    throw new RemoteMediaError("Gambar sumber melebihi 5 MB", 413);
  }
  if (!response.body) throw new RemoteMediaError("Respons gambar kosong", 422);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ARTICLE_IMAGE_BYTES) {
      await reader.cancel();
      throw new RemoteMediaError("Gambar sumber melebihi 5 MB", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

type RemoteFetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function fetchPublicWebp(sourceUrl: string, fetcher: RemoteFetcher = fetch) {
  let current = parsePublicRemoteImageUrl(sourceUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetcher(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { accept: "image/webp" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new RemoteMediaError("Gagal mengambil gambar sumber", 502);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new RemoteMediaError("Redirect gambar sumber tidak valid atau terlalu banyak", 422);
      }
      current = parsePublicRemoteImageUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) {
      throw new RemoteMediaError(`Gambar sumber merespons HTTP ${response.status}`, 422);
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType && !["image/webp", "application/octet-stream"].includes(contentType)) {
      throw new RemoteMediaError("Gambar sumber harus berformat WebP", 415);
    }

    const bytes = await readWithLimit(response);
    if (!checkMagicBytes(bytes, "image/webp")) {
      throw new RemoteMediaError("Isi source_url bukan file WebP valid", 415);
    }
    return bytes;
  }

  throw new RemoteMediaError("Redirect gambar sumber terlalu banyak", 422);
}
