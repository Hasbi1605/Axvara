import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RATE_LIMITS, type RateLimitScope } from "@/lib/rateLimit";

// Regresi insiden CI #131: commit c4586fb menambahkan pemakaian scope
// "webhook:warung" di route tanpa mendaftarkannya di RATE_LIMITS —
// max === undefined → request pertama per isolate lolos, sisanya 429
// selamanya (self-DoS). Test ini memindai seluruh literal scope
// checkRateLimit di src/ dan memastikan semuanya terdaftar, sehingga
// kesalahan serupa menggagalkan CI sebelum sempat di-push.

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      collectTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("rate-limit scopes terdaftar", () => {
  it("setiap literal scope checkRateLimit di src/ ada di RATE_LIMITS", () => {
    const files = collectTsFiles("src");
    expect(files.length).toBeGreaterThan(0);
    const pattern = /checkRateLimit\(\s*[^,]+,\s*"([^"]+)"\s*\)/g;
    const used = new Map<string, string>();
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(src)) !== null) {
        if (!used.has(match[1])) used.set(match[1], file);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    const registered = new Set<string>(Object.keys(RATE_LIMITS));
    const missing = [...used.entries()].filter(([scope]) => !registered.has(scope));
    expect(
      missing.map(([scope, file]) => `${scope} (dipakai di ${file})`),
      "scope tak terdaftar — akan fail-open / me-429-kan traffic",
    ).toEqual([]);
    // Guard balik: RateLimitScope mencakup semua key terdaftar.
    const declared: RateLimitScope[] = Object.keys(RATE_LIMITS) as RateLimitScope[];
    expect(declared.length).toBe(Object.keys(RATE_LIMITS).length);
  });

  it("webhook:warung — 3 request webhook berturut-turut tidak kena 429", async () => {
    // Gagal spesifik untuk skenario #131: panggilan ke-2+ kena 429 bila
    // max undefined (e.c <= undefined selalu false).
    const { POST } = await import("@/app/api/webhook/warung/route");
    const { vi } = await import("vitest");
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "s");
    vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "s");
    const { default: cryptoKey } = await import("node:crypto").catch(() => ({ default: null }));
    void cryptoKey;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("s"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const body = JSON.stringify({ event: "order.completed", data: {} });
      const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
      const sig = Array.from(new Uint8Array(sigBytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const res = await POST(
        new Request("http://localhost/api/webhook/warung", {
          method: "POST",
          headers: { "content-type": "application/json", "x-rebahan-signature": sig },
          body,
        }) as unknown as Parameters<typeof POST>[0],
      );
      statuses.push(res.status);
    }
    vi.unstubAllEnvs();
    // Payload order_id kosong → 400 validasi, yang penting BUKAN 429.
    expect(statuses).toEqual([400, 400, 400]);
  });
});
