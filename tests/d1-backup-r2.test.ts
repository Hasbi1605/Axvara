import { createRequire } from "node:module";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const {
  D1_DATABASE_ID,
  R2_BACKUP_BUCKET,
  buildBackupKey,
  formatStepSummary,
  redactSecretsAndUrls,
  runBackup,
  uploadBackupToR2,
  validateSqlDump,
} = createRequire(import.meta.url)("../scripts/d1-backup-r2.cjs");

function makeValidSqlDump(extraPaddingBytes = 10_500): Buffer {
  const header = [
    "PRAGMA defer_foreign_keys=TRUE;",
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, code TEXT);",
    "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);",
    "CREATE TABLE payment_transactions (id INTEGER PRIMARY KEY, order_code TEXT);",
    "CREATE TABLE fulfillment_items (id INTEGER PRIMARY KEY, order_code TEXT);",
    `INSERT INTO orders VALUES (1, '${"x".repeat(extraPaddingBytes)}');`,
  ].join("\n");
  return Buffer.from(header, "utf8");
}

const baseEnv = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_KEY: "super-secret-cf-api-key",
  CLOUDFLARE_EMAIL: "ops@axvara.test",
};

describe("d1-backup-r2", () => {
  it("adds a failure-only, credential-free Actions annotation and summary to the existing job", () => {
    const yaml = readFileSync(new URL("../.github/workflows/d1-backup.yml", import.meta.url), "utf8");
    const step = yaml.match(/      - name: Report backup failure\n        if: (.*)\n        run: \|\n((?: {10}.+\n)+)/);
    expect(step?.[1]).toBe("${{ failure() }}");
    expect(step?.[2]).not.toContain("secrets.");
    // Summary goes to a temp file (portable: Linux CI rejects appending to /dev/stdout of a pipe); no Actions or external calls.
    const dir = mkdtempSync(join(tmpdir(), "d1-backup-summary-"));
    const summary = join(dir, "summary.md");
    try {
      const output = execFileSync("/bin/bash", ["-e", "-c", step![2]], {env:{NODE_ENV:"test",GITHUB_STEP_SUMMARY:summary},encoding:"utf8"});
      expect(output).toContain("::error title=D1 backup failed::");
      expect(readFileSync(summary, "utf8")).toContain("last successful backup");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("polls D1 export API with at_bookmark -> current_bookmark, validates, gzips, hashes, and uploads to axvara-db-backups", async () => {
    const dumpBuf = makeValidSqlDump();
    const signedUrl = "https://r2-signed.cloudflare.test/export/dump.sql?X-Amz-Signature=deadbeefsecret123&Expires=99999";
    const calls: { url: string; body?: unknown }[] = [];

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body: parsedBody });
      if (url.endsWith(`/d1/database/${D1_DATABASE_ID}/export`)) {
        if (!parsedBody.current_bookmark) {
          return new Response(
            JSON.stringify({ success: true, result: { status: "active", at_bookmark: "bm-1" } }),
            { status: 202 },
          );
        }
        if (parsedBody.current_bookmark === "bm-1") {
          return new Response(
            JSON.stringify({ success: true, result: { status: "active", at_bookmark: "bm-2" } }),
            { status: 202 },
          );
        }
        return Response.json({
          success: true,
          result: {
            status: "complete",
            at_bookmark: "bm-2",
            result: { filename: "axvara-db.sql", signed_url: signedUrl },
          },
        });
      }
      if (url === signedUrl) {
        return new Response(new Uint8Array(dumpBuf), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const uploads: { bucket: string; key: string; gzBuffer: Buffer }[] = [];
    const now = new Date("2026-11-18T19:23:05.123Z");
    const report = await runBackup({
      env: baseEnv,
      fetchFn,
      uploadFn: async (opts: { bucket: string; key: string; gzBuffer: Buffer }) => {
        uploads.push(opts);
      },
      now,
      pollIntervalMs: 0,
      sleepFn: async () => undefined,
    });

    expect(calls.slice(0, 3).map((c) => c.body)).toEqual([
      { output_format: "polling" },
      { output_format: "polling", current_bookmark: "bm-1" },
      { output_format: "polling", current_bookmark: "bm-2" },
    ]);
    expect(calls[3].url).toBe(signedUrl);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe(R2_BACKUP_BUCKET);
    expect(uploads[0].key).toBe("daily/2026/11/axvara-db-2026-11-18T19-23-05Z.sql.gz");
    expect(zlib.gunzipSync(uploads[0].gzBuffer)).toEqual(dumpBuf);

    const expectedHash = crypto.createHash("sha256").update(uploads[0].gzBuffer).digest("hex");
    expect(report).toMatchObject({
      bucket: "axvara-db-backups",
      key: "daily/2026/11/axvara-db-2026-11-18T19-23-05Z.sql.gz",
      rawBytes: dumpBuf.length,
      gzipBytes: uploads[0].gzBuffer.length,
      sha256: expectedHash,
    });

    const summary = formatStepSummary(report);
    expect(summary).toContain(report.key);
    expect(summary).toContain(report.sha256);
    expect(summary).not.toContain(signedUrl);
    expect(summary).not.toContain("deadbeefsecret123");
    expect(summary).not.toContain(baseEnv.CLOUDFLARE_API_KEY);
    expect(summary).not.toContain("CREATE TABLE");
  });

  it("rejects empty, undersized, missing-core-table, and truncated SQL dumps", () => {
    expect(() => validateSqlDump(Buffer.alloc(0))).toThrow(/empty/i);
    expect(() => validateSqlDump(Buffer.from("CREATE TABLE orders (id INT);", "utf8"))).toThrow(/too small/i);

    const missingTable = Buffer.from(
      `CREATE TABLE orders (id INT);\nCREATE TABLE products (id INT);\nINSERT INTO orders VALUES ('${"a".repeat(10_500)}');`,
      "utf8",
    );
    expect(() => validateSqlDump(missingTable)).toThrow(/payment_transactions/);

    const truncated = Buffer.concat([
      makeValidSqlDump(),
      Buffer.from("\nINSERT INTO products VALUES (2, 'cut-off-mid-statement", "utf8"),
    ]);
    expect(() => validateSqlDump(truncated)).toThrow(/truncated/i);
  });

  it("never exposes signed URLs or Cloudflare credentials in download/upload errors and blocks axvara-assets", async () => {
    const signedUrl = "https://r2.example.invalid/dump.sql?X-Amz-Signature=secret-sig-999&token=abc";
    const redacted = redactSecretsAndUrls(
      `fetch failed for ${signedUrl} with key ${baseEnv.CLOUDFLARE_API_KEY} and ${baseEnv.CLOUDFLARE_EMAIL}`,
      baseEnv,
      [signedUrl],
    );
    expect(redacted).not.toContain("secret-sig-999");
    expect(redacted).not.toContain("r2.example.invalid");
    expect(redacted).not.toContain(baseEnv.CLOUDFLARE_API_KEY);
    expect(redacted).not.toContain(baseEnv.CLOUDFLARE_EMAIL);

    // Download error containing signed URL must be redacted
    const fetchFailDl = vi.fn(async (url: string) => {
      if (url.endsWith("/export")) {
        return Response.json({
          success: true,
          result: { status: "complete", result: { signed_url: signedUrl } },
        });
      }
      throw new Error(`network failure reaching ${signedUrl}`);
    });
    await expect(
      runBackup({
        env: baseEnv,
        fetchFn: fetchFailDl,
        uploadFn: async () => undefined,
        pollIntervalMs: 0,
      }),
    ).rejects.toSatisfy((err: Error) => {
      expect(err.message).not.toContain("secret-sig-999");
      expect(err.message).not.toContain("r2.example.invalid");
      return true;
    });

    // Refuses writing to axvara-assets
    expect(() =>
      uploadBackupToR2({
        bucket: "axvara-assets",
        key: buildBackupKey(new Date("2026-11-18T19:23:00Z")),
        gzBuffer: Buffer.from("gz"),
        env: baseEnv,
      }),
    ).toThrow(/unauthorized bucket/i);
  });
});
