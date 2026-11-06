import { normalizeCountry } from "./locale";

export async function readTrustedCountry(): Promise<string | null> {
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    return normalizeCountry(getRequestContext().cf?.country);
  } catch { return null; }
}
