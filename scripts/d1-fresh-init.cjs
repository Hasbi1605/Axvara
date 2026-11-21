#!/usr/bin/env node
// scripts/d1-fresh-init.cjs — fresh-DB bootstrap handoff (audit AU-G2-1).
//
// AXVARA has two schema paths, and they are not interchangeable:
//   1. New/empty DB  -> apply drizzle/schema.sql (the verified snapshot).
//   2. Existing DB   -> let `wrangler d1 migrations apply` replay only the
//                       migrations missing from the d1_migrations ledger.
//
// Historical migrations CANNOT be replayed on an empty DB (0002 assumes base
// tables that predate the repo, and many later files are deliberately
// non-idempotent). That means a schema-bootstrapped DB still looks "blank" to
// Wrangler, which would then try to replay 0002.. and fail. This initializer
// closes that gap without touching production or rewriting any migration file:
//
//   * it only runs against a DB it has proven empty (no application tables, no
//     existing ledger rows), so a restored/partial/ambiguous DB fails closed;
//   * it applies drizzle/schema.sql and verifies the result (foreign keys,
//     integrity, critical objects);
//   * it then writes the baseline ledger derived from the checked-in manifest
//     drizzle/bootstrap-baseline.json, which must match the migration files and
//     the schema.sql revision exactly.
//
// Usage (local sqlite file; never --remote):
//   node scripts/d1-fresh-init.cjs --db /tmp/fresh.sqlite --check
//   node scripts/d1-fresh-init.cjs --db /tmp/fresh.sqlite --apply
//   node scripts/d1-fresh-init.cjs --emit-sql /tmp/fresh-bootstrap.sql
//   node scripts/d1-fresh-init.cjs --print-baseline   # deliberate regeneration
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(ROOT, "drizzle", "schema.sql");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle", "migrations");
const BASELINE_PATH = path.join(ROOT, "drizzle", "bootstrap-baseline.json");

/** Same DDL Wrangler creates for its D1 migration ledger. */
const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

/** Critical objects asserted after bootstrap. Counts stay floors, not frozen. */
const REQUIRED = {
  tables: [
    "orders", "products", "product_variants", "payment_transactions",
    "buyer_notice_log", "product_groups", "product_group_members",
    "pedia_tiers", "games_products", "supplier_topups",
  ],
  columns: [
    ["orders", "expires_at"], ["buyer_notice_log", "status"],
    ["product_group_members", "product_id"],
  ],
  indexes: ["idx_buyer_notice_order", "idx_orders_expires_dt", "idx_product_group_dirty_pending"],
  triggers: [
    "pg_member_valid_insert", "pg_member_valid_update",
    "archived_product_activation", "payment_invoice_history_insert",
  ],
  floors: { tables: 90, indexes: 130, triggers: 44 },
};

class FreshInitError extends Error {
  constructor(reason) {
    super(`fresh_init_failed: ${reason}`);
    this.name = "FreshInitError";
    this.reason = reason;
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function migrationFiles(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
}

/**
 * Load and validate the checked-in baseline. Fails closed on any ambiguity:
 * manifest missing, files added/removed without a deliberate baseline update,
 * numbering gaps, or schema.sql edited without refreshing the manifest.
 */
function loadBaseline({ root = ROOT } = {}) {
  const schemaPath = path.join(root, "drizzle", "schema.sql");
  const migrationsDir = path.join(root, "drizzle", "migrations");
  const baselinePath = path.join(root, "drizzle", "bootstrap-baseline.json");
  if (!fs.existsSync(baselinePath)) throw new FreshInitError("baseline_missing");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch {
    throw new FreshInitError("baseline_unreadable");
  }
  const files = migrationFiles(migrationsDir);
  const listed = Array.isArray(manifest.migrations) ? manifest.migrations : null;
  if (!listed || listed.some((name) => typeof name !== "string")) throw new FreshInitError("baseline_invalid");
  if (listed.length !== files.length || listed.some((name, i) => name !== files[i])) {
    const missing = files.filter((name) => !listed.includes(name));
    const extra = listed.filter((name) => !files.includes(name));
    throw new FreshInitError(`baseline_drift:migrations missing=${missing.join(",") || "-"} extra=${extra.join(",") || "-"}`);
  }
  listed.forEach((name, i) => {
    const expected = String(i + 2).padStart(4, "0");
    if (!name.startsWith(`${expected}_`)) throw new FreshInitError(`baseline_drift:numbering ${name}`);
  });
  if (manifest.schema_through !== listed[listed.length - 1]) throw new FreshInitError("baseline_drift:schema_through");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  if (manifest.schema_sha256 !== sha256(schemaSql)) throw new FreshInitError("baseline_drift:schema_sha256");
  return {
    schemaSql,
    schemaPath,
    migrationsDir,
    files: listed,
    schemaThrough: manifest.schema_through,
    schemaSha256: manifest.schema_sha256,
  };
}

/** Baseline manifest regenerated from the files on disk (deliberate operation). */
function buildBaseline({ root = ROOT } = {}) {
  const files = migrationFiles(path.join(root, "drizzle", "migrations"));
  const schemaSql = fs.readFileSync(path.join(root, "drizzle", "schema.sql"), "utf8");
  return {
    $comment:
      "Audit AU-G2-1 bootstrap ledger. Exact migration filenames already represented by drizzle/schema.sql as of schema_through. Consumed ONLY by scripts/d1-fresh-init.cjs; regenerate deliberately with --print-baseline after intentionally editing schema.sql or adding a migration.",
    schema_through: files[files.length - 1],
    schema_sha256: sha256(schemaSql),
    migrations: files,
  };
}

/**
 * Decide whether this DB is a valid fresh-bootstrap target. Only a blank DB
 * (no application tables and no applied ledger rows) qualifies.
 */
function planFreshInit(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String(row.name));
  if (tables.includes("d1_migrations")) {
    const applied = Number(db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n || 0);
    if (applied > 0) return { ok: false, reason: "existing_ledger", applied };
    return { ok: tables.length === 1, reason: "not_blank", tables: tables.filter((name) => name !== "d1_migrations") };
  }
  if (tables.length > 0) return { ok: false, reason: "not_blank", tables };
  return { ok: true };
}

/** Validate a schema-bootstrapped DB. Throws FreshInitError on the first problem. */
function verifySchema(db) {
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length) throw new FreshInitError(`foreign_key_violation:${foreignKeys.length}`);
  const integrity = db.prepare("PRAGMA integrity_check").get();
  if (!integrity || String(integrity.integrity_check) !== "ok") throw new FreshInitError("integrity_check_failed");

  const objects = { table: new Set(), index: new Set(), trigger: new Set() };
  for (const row of db.prepare("SELECT type,name FROM sqlite_master").all()) {
    if (row.type === "index" && String(row.name).startsWith("sqlite_")) continue;
    if (objects[row.type]) objects[row.type].add(String(row.name));
  }
  for (const name of REQUIRED.tables) if (!objects.table.has(name)) throw new FreshInitError(`missing_table:${name}`);
  for (const name of REQUIRED.indexes) if (!objects.index.has(name)) throw new FreshInitError(`missing_index:${name}`);
  for (const name of REQUIRED.triggers) if (!objects.trigger.has(name)) throw new FreshInitError(`missing_trigger:${name}`);
  for (const [table, column] of REQUIRED.columns) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
    if (!columns.includes(column)) throw new FreshInitError(`missing_column:${table}.${column}`);
  }
  if (objects.table.size < REQUIRED.floors.tables) throw new FreshInitError(`table_floor:${objects.table.size}`);
  if (objects.index.size < REQUIRED.floors.indexes) throw new FreshInitError(`index_floor:${objects.index.size}`);
  if (objects.trigger.size < REQUIRED.floors.triggers) throw new FreshInitError(`trigger_floor:${objects.trigger.size}`);
}

/**
 * Bootstrap a proven-empty DB from schema.sql and mark the baseline applied.
 * Atomic: any failure rolls the whole bootstrap back.
 */
function applyFreshInit(db, baseline) {
  const plan = planFreshInit(db);
  if (!plan.ok) throw new FreshInitError(plan.reason);
  db.exec("BEGIN");
  try {
    db.exec(baseline.schemaSql);
    db.exec(LEDGER_DDL);
    const insert = db.prepare("INSERT INTO d1_migrations(name) VALUES (?)");
    for (const name of baseline.files) insert.run(name);
    verifySchema(db);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw error;
  }
  return { applied: baseline.files.length, ledger: ledgerNames(db) };
}

function ledgerNames(db) {
  try {
    return db.prepare("SELECT name FROM d1_migrations ORDER BY name").all().map((row) => String(row.name));
  } catch {
    return [];
  }
}

/** Migration files not present in the applied ledger (what Wrangler would run). */
function pendingMigrations({ files, applied }) {
  const done = applied instanceof Set ? applied : new Set(applied);
  return files.filter((name) => !done.has(name));
}

function emitBootstrapSql(baseline) {
  const rows = baseline.files
    .map((name) => `INSERT OR IGNORE INTO d1_migrations(name) VALUES ('${name.replace(/'/g, "''")}');`)
    .join("\n");
  return [
    "-- Generated by scripts/d1-fresh-init.cjs --emit-sql. For an EMPTY database only.",
    `-- Baseline: schema.sql @ ${baseline.schemaThrough} (sha256 ${baseline.schemaSha256})`,
    baseline.schemaSql,
    LEDGER_DDL + ";",
    rows,
    "",
  ].join("\n");
}

module.exports = {
  BASELINE_PATH, LEDGER_DDL, ROOT,
  FreshInitError, applyFreshInit, buildBaseline, emitBootstrapSql, ledgerNames,
  loadBaseline, migrationFiles, pendingMigrations, planFreshInit, verifySchema,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1] ?? true;
  };
  try {
    if (args.includes("--print-baseline")) {
      process.stdout.write(`${JSON.stringify(buildBaseline(), null, 2)}\n`);
      process.exit(0);
    }
    const baseline = loadBaseline();
    if (flag("--emit-sql")) {
      const out = String(flag("--emit-sql"));
      fs.writeFileSync(out, emitBootstrapSql(baseline));
      console.log(JSON.stringify({ ok: true, out, migrations: baseline.files.length, schema_through: baseline.schemaThrough }));
      process.exit(0);
    }
    const dbPath = flag("--db");
    if (!dbPath || dbPath === true) {
      console.error("usage: node scripts/d1-fresh-init.cjs --db <sqlite-path> [--check|--apply] | --emit-sql <path> | --print-baseline");
      process.exit(2);
    }
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(String(dbPath));
    try {
      if (args.includes("--apply")) {
        const result = applyFreshInit(db, baseline);
        const pending = pendingMigrations({ files: baseline.files, applied: result.ledger });
        console.log(JSON.stringify({ ok: true, applied: result.applied, pending }));
      } else {
        const plan = planFreshInit(db);
        console.log(JSON.stringify({ ok: plan.ok, ...plan }));
        if (!plan.ok) process.exitCode = 1;
      }
    } finally {
      db.close();
    }
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  }
}
