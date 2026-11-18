import { fetchWithTimeout } from "@/lib/fetch-timeout";
import type { Estimate } from "./calculate";

export async function requestRefund(path: "/api/refund" | "/api/admin/refund", data: object, signal?: AbortSignal) {
  const res = await fetchWithTimeout(path, {
    method: "POST", cache: "no-store", credentials: path === "/api/refund" ? "omit" : "same-origin", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  }, 12000);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "unavailable");
  return body as { estimate?: Estimate; locale?: "id" | "en"; activeShare?: boolean; token?: string; expires?: number };
}
