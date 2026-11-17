#!/usr/bin/env node
// Automated daily D1 SQL export -> gzip -> SHA-256 -> private R2 bucket (axvara-db-backups).
// Never writes to axvara-assets and never prints signed URLs, dump contents, or credentials.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const zlib = require("node:zlib");
const { cloudflareAuth } = require("./cloudflare-plan.cjs");

const D1_DATABASE_ID = "c21453bf-68ab-4efd-8b0d-22fb360c4f33";
const D1_DATABASE_NAME = "axvara-db";
const R2_BACKUP_BUCKET = "axvara-db-backups";
const FORBIDDEN_BUCKETS = new Set(["axvara-assets"]);
const MIN_DUMP_BYTES = 10_000;
const REQUIRED_CORE_TABLES = ["orders", "products", "payment_transactions", "fulfillment_items"];
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLLS = 90;

function redactSecretsAndUrls(input, env = {}, extraSecrets = []) {
  let out = String(input ?? "");
  const secrets = [
    env.CLOUDFLARE_API_KEY,
    env.CLOUDFLARE_API_TOKEN,
    env.CLOUDFLARE_EMAIL,
    ...extraSecrets,
  ];
  for (const s of secrets) {
    if (typeof s === "string" && s.length > 0) {
      out = out.split(s).join("[REDACTED]");
    }
  }
  out = out.replace(/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]");
  out = out.replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]");
  out = out.replace(/([?&](?:X-Amz-[^=]+|Signature|Expires|AWSAccessKeyId|token|key|secret)=)[^&\s"']+/gi, "$1[REDACTED]");
  return out;
}

function buildBackupKey(now = new Date()) {
  const isoSafe = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const yyyy = isoSafe.slice(0, 4);
  const mm = isoSafe.slice(5, 7);
  return `daily/${yyyy}/${mm}/${D1_DATABASE_NAME}-${isoSafe}.sql.gz`;
}

function validateSqlDump(dumpBuffer, minBytes = MIN_DUMP_BYTES) {
  if (!dumpBuffer || !Uint8Array.prototype.isPrototypeOf(dumpBuffer)) {
    throw new Error("D1 dump missing or invalid buffer");
  }
  if (dumpBuffer.length === 0) {
    throw new Error("D1 dump is empty");
  }
  if (dumpBuffer.length < minBytes) {
    throw new Error(`D1 dump too small (${dumpBuffer.length} < ${minBytes} bytes)`);
  }
  const sqlText = Buffer.from(dumpBuffer).toString("utf8");
  for (const table of REQUIRED_CORE_TABLES) {
    const pattern = new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["'\`\\[]?${table}["'\`\\]]?\\b`,
      "i",
    );
    if (!pattern.test(sqlText)) {
      throw new Error(`D1 dump missing CREATE TABLE for core table: ${table}`);
    }
  }
  const lines = sqlText.split(/\r?\n/);
  let lastMeaningful = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    lastMeaningful = trimmed;
    break;
  }
  if (!lastMeaningful || !lastMeaningful.endsWith(";")) {
    throw new Error("D1 dump appears truncated (does not end with SQL statement terminator)");
  }
  return { rawBytes: dumpBuffer.length };
}

function compressAndHash(dumpBuffer) {
  const gzBuffer = zlib.gzipSync(dumpBuffer, { level: 9 });
  const sha256 = crypto.createHash("sha256").update(gzBuffer).digest("hex");
  return { gzBuffer, sha256 };
}

async function exportD1Dump({
  env = process.env,
  fetchFn = fetch,
  databaseId = D1_DATABASE_ID,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxPolls = DEFAULT_MAX_POLLS,
  sleepFn = delay,
} = {}) {
  const headers = { "Content-Type": "application/json", ...cloudflareAuth(env) };
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const exportUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/export`;

  let bookmark = null;
  let signedUrl = null;

  for (let poll = 0; poll < maxPolls; poll++) {
    const payload = bookmark
      ? { output_format: "polling", current_bookmark: bookmark }
      : { output_format: "polling" };

    let res;
    try {
      res = await fetchFn(exportUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new Error(`D1 export request failed: ${redactSecretsAndUrls(error?.message || "network_error", env)}`);
    }

    if (!res.ok) {
      await res.body?.cancel?.().catch(() => undefined);
      throw new Error(`D1 export API HTTP ${res.status}`);
    }

    const body = await res.json();
    if (body?.success !== true || !body?.result || typeof body.result !== "object") {
      throw new Error("D1 export API returned unsuccessful response");
    }

    const result = body.result;
    if (result.status === "error") {
      throw new Error(`D1 export job error: ${redactSecretsAndUrls(result.error || "unknown", env)}`);
    }

    if (result.status === "complete") {
      const candidate = result.result?.signed_url || result.signed_url;
      if (typeof candidate !== "string" || !candidate.startsWith("https://")) {
        throw new Error("D1 export complete without valid signed URL");
      }
      signedUrl = candidate;
      break;
    }

    if (result.status === "active" || result.status === "pending" || result.status === "in_progress") {
      if (typeof result.at_bookmark !== "string" || !result.at_bookmark) {
        throw new Error("D1 export active without bookmark");
      }
      bookmark = result.at_bookmark;
      if (poll + 1 < maxPolls && pollIntervalMs > 0) {
        await sleepFn(pollIntervalMs);
      }
      continue;
    }

    throw new Error(`D1 export unexpected status: ${redactSecretsAndUrls(String(result.status || "unknown"), env)}`);
  }

  if (!signedUrl) {
    throw new Error(`D1 export polling timed out after ${maxPolls} attempts`);
  }

  let dlRes;
  try {
    dlRes = await fetchFn(signedUrl, { signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new Error(
      `D1 dump download failed: ${redactSecretsAndUrls(error?.message || "network_error", env, [signedUrl])}`,
    );
  }

  if (!dlRes.ok) {
    await dlRes.body?.cancel?.().catch(() => undefined);
    throw new Error(`D1 dump download HTTP ${dlRes.status}`);
  }

  try {
    return Buffer.from(await dlRes.arrayBuffer());
  } catch (error) {
    throw new Error(
      `D1 dump read failed: ${redactSecretsAndUrls(error?.message || "read_error", env, [signedUrl])}`,
    );
  }
}

function uploadBackupToR2({
  bucket = R2_BACKUP_BUCKET,
  key,
  gzBuffer,
  env = process.env,
  spawnFn = spawnSync,
} = {}) {
  if (bucket !== R2_BACKUP_BUCKET || FORBIDDEN_BUCKETS.has(bucket)) {
    throw new Error(`Refusing R2 upload to unauthorized bucket: ${bucket}`);
  }
  if (!key || !key.startsWith("daily/") || !key.endsWith(".sql.gz")) {
    throw new Error(`Invalid backup object key: ${key}`);
  }

  const tmpFile = path.join(os.tmpdir(), `axvara-d1-backup-${process.pid}-${Date.now()}.sql.gz`);
  fs.writeFileSync(tmpFile, gzBuffer);
  try {
    const res = spawnFn(
      "npx",
      [
        "--yes",
        "wrangler@4.128.0",
        "r2",
        "object",
        "put",
        `${bucket}/${key}`,
        `--file=${tmpFile}`,
        "--remote",
        "--content-type=application/gzip",
      ],
      { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 },
    );
    if (res.status !== 0) {
      const detail = redactSecretsAndUrls(res.stderr || res.stdout || `exit_${res.status}`, env);
      throw new Error(`R2 upload failed: ${detail.slice(0, 300)}`);
    }
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

function formatStepSummary(report) {
  return [
    "### D1 Daily Backup (axvara-db → axvara-db-backups)",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Key | \`${report.key}\` |`,
    `| Raw SQL size | ${report.rawBytes.toLocaleString("en-US")} bytes |`,
    `| Gzip size | ${report.gzipBytes.toLocaleString("en-US")} bytes |`,
    `| SHA-256 (gzip) | \`${report.sha256}\` |`,
    `| Duration | ${report.durationMs} ms |`,
    "",
  ].join("\n");
}

async function runBackup({
  env = process.env,
  fetchFn = fetch,
  uploadFn = uploadBackupToR2,
  now = new Date(),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxPolls = DEFAULT_MAX_POLLS,
  sleepFn = delay,
  minDumpBytes = MIN_DUMP_BYTES,
} = {}) {
  const startedAt = Date.now();
  const dumpBuffer = await exportD1Dump({
    env,
    fetchFn,
    databaseId: D1_DATABASE_ID,
    pollIntervalMs,
    maxPolls,
    sleepFn,
  });
  const { rawBytes } = validateSqlDump(dumpBuffer, minDumpBytes);
  const { gzBuffer, sha256 } = compressAndHash(dumpBuffer);
  const key = buildBackupKey(now);

  await uploadFn({
    bucket: R2_BACKUP_BUCKET,
    key,
    gzBuffer,
    env,
  });

  return {
    bucket: R2_BACKUP_BUCKET,
    key,
    rawBytes,
    gzipBytes: gzBuffer.length,
    sha256,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

async function main() {
  const report = await runBackup();
  console.log(JSON.stringify(report));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatStepSummary(report));
  }
}

module.exports = {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  R2_BACKUP_BUCKET,
  MIN_DUMP_BYTES,
  REQUIRED_CORE_TABLES,
  redactSecretsAndUrls,
  buildBackupKey,
  validateSqlDump,
  compressAndHash,
  exportD1Dump,
  uploadBackupToR2,
  formatStepSummary,
  runBackup,
};

if (require.main === module) {
  main().catch((error) => {
    const safeMsg = redactSecretsAndUrls(error?.message || "unknown_error", process.env);
    console.error(`D1 backup failed: ${safeMsg}`);
    process.exitCode = 1;
  });
}
