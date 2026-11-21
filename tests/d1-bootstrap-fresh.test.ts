// Audit AU-G2-1: the fresh-DB bootstrap handoff.
//
// schema.sql is the only way to build a new database (historical migrations are
// not replayable), but that DB still looks blank to Wrangler's ledger, which
// would try to replay 0002.. and fail. These tests pin the handoff:
//   - schema.sql alone builds a complete, FK-consistent database;
//   - the checked-in baseline manifest matches the migration set + schema revision;
//   - the migration history and schema.sql agree on tables/columns/indexes/triggers;
//   - the initializer refuses anything that is not provably empty;
//   - after init, Wrangler has nothing historical pending and a synthetic next
//     migration applies exactly once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (file: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => { get: (...p: unknown[]) => any; all: (...p: unknown[]) => any[]; run: (...p: unknown[]) => unknown };
    close: () => void;
  };
};
const fresh = require("../scripts/d1-fresh-init.cjs") as {
  FreshInitError: new (reason: string) => Error;
  loadBaseline: (options?: { root?: string }) => {
    schemaSql: string; files: string[]; schemaThrough: string; schemaSha256: string;
  };
  planFreshInit: (db: any) => { ok: boolean; reason?: string; tables?: string[]; applied?: number };
  verifySchema: (db: any) => void;
  applyFreshInit: (db: any, baseline: any) => { applied: number; ledger: string[] };
  pendingMigrations: (input: { files: string[]; applied: string[] | Set<string> }) => string[];
  ledgerNames: (db: any) => string[];
  LEDGER_DDL: string;
};

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmpDirs: string[] = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axvara-fresh-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function memoryDb() {
  return new DatabaseSync(":memory:");
}

function objectSets(db: any) {
  const sets = { table: new Set<string>(), index: new Set<string>(), trigger: new Set<string>() };
  for (const row of db.prepare("SELECT type,name FROM sqlite_master").all()) {
    if (row.type === "index" && String(row.name).startsWith("sqlite_")) continue;
    if (row.type === "table" && String(row.name).startsWith("sqlite_")) continue;
    if (sets[row.type as keyof typeof sets]) sets[row.type as keyof typeof sets].add(String(row.name));
  }
  return sets;
}

/** Strip `--` comments without touching quoted strings. */
function stripComments(sql: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) { out += sql[++i]; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; out += ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    out += ch;
  }
  return out;
}

/** Statements in order; trigger bodies (which contain `;`) stay atomic. */
function statements(raw: string): string[] {
  const sql = stripComments(raw);
  const blocks: string[] = [];
  const stripped = sql.replace(/CREATE\s+TRIGGER\b[\s\S]*?\bEND\s*;/gi, (match: string) => {
    blocks.push(match);
    return `\u0000${blocks.length - 1}\u0000;`;
  });
  const parts: string[] = [];
  let current = "";
  for (const ch of stripped) {
    if (ch === ";") { parts.push(current); current = ""; } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts
    .map((part) => part.replace(/\u0000(\d+)\u0000/g, (_m, n) => blocks[Number(n)]).trim())
    .filter(Boolean);
}

/**
 * Objects the migration history ends up with (ordered CREATE/DROP/RENAME model).
 * Exemptions are the two known, documented gaps:
 * - base tables that predate the repo's first migration (0001 is absent);
 * - the pedia_tiers rebuild chain in 0062 leaves archive tables behind.
 */
function migrationObjects(migrationsDir: string) {
  const sim = { table: new Set<string>(), index: new Set<string>(), trigger: new Set<string>() };
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of statements(fs.readFileSync(path.join(migrationsDir, file), "utf8"))) {
      let m: RegExpExecArray | null;
      if ((m = /^CREATE\s+(?:UNIQUE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/i.exec(statement))) sim.table.add(m[1]);
      else if ((m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_]+)/i.exec(statement))) sim.table.delete(m[1]);
      else if ((m = /^ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+RENAME\s+TO\s+([A-Za-z0-9_]+)/i.exec(statement))) {
        sim.table.delete(m[1]); sim.table.add(m[2]);
      } else if ((m = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/i.exec(statement))) sim.index.add(m[1]);
      else if ((m = /^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_]+)/i.exec(statement))) sim.index.delete(m[1]);
      else if ((m = /^CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/i.exec(statement))) sim.trigger.add(m[1]);
      else if ((m = /^DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_]+)/i.exec(statement))) sim.trigger.delete(m[1]);
    }
  }
  return sim;
}

const PRE_MIGRATION_TABLES = ["categories", "products", "admins", "payment_methods", "articles", "banners"];
const REBUILD_ARTIFACT_TABLES = [
  "pedia_tiers_archive0062_prev2", "pedia_tiers_archive0062_prev",
  "pedia_tiers_archive0062", "pedia_tiers_old0062",
];

describe("AU-G2-1 schema.sql bootstrap", () => {
  it("builds a complete database with no foreign-key or integrity problems", () => {
    const db = memoryDb();
    try {
      db.exec(fs.readFileSync(path.join(ROOT, "drizzle/schema.sql"), "utf8"));
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get().integrity_check).toBe("ok");
      expect(() => fresh.verifySchema(db)).not.toThrow();
      // Floors are current sanity evidence, not a frozen count.
      const objects = objectSets(db);
      expect(objects.table.size).toBeGreaterThanOrEqual(90);
      expect(objects.index.size).toBeGreaterThanOrEqual(130);
      expect(objects.trigger.size).toBeGreaterThanOrEqual(44);
    } finally { db.close(); }
  });

  it("verifySchema rejects a schema missing a critical guard", () => {
    const db = memoryDb();
    try {
      db.exec(fs.readFileSync(path.join(ROOT, "drizzle/schema.sql"), "utf8"));
      db.exec("DROP TRIGGER pg_member_valid_update");
      expect(() => fresh.verifySchema(db)).toThrow(/missing_trigger:pg_member_valid_update/);
    } finally { db.close(); }
  });
});

describe("AU-G2-1 baseline manifest", () => {
  function copyRepoSubset() {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "drizzle/migrations"), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "drizzle/schema.sql"), path.join(root, "drizzle/schema.sql"));
    fs.copyFileSync(path.join(ROOT, "drizzle/bootstrap-baseline.json"), path.join(root, "drizzle/bootstrap-baseline.json"));
    for (const file of fs.readdirSync(path.join(ROOT, "drizzle/migrations"))) {
      fs.copyFileSync(path.join(ROOT, "drizzle/migrations", file), path.join(root, "drizzle/migrations", file));
    }
    return root;
  }

  it("matches the checked-in migration files and schema revision", () => {
    const baseline = fresh.loadBaseline();
    const files = fs.readdirSync(path.join(ROOT, "drizzle/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(baseline.files).toEqual(files);
    expect(baseline.schemaThrough).toBe(files[files.length - 1]);
    expect(baseline.schemaSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed when a migration is added, removed, or schema.sql changes", () => {
    const added = copyRepoSubset();
    fs.writeFileSync(path.join(added, "drizzle/migrations/0153_unlisted.sql"), "SELECT 1;\n");
    expect(() => fresh.loadBaseline({ root: added })).toThrow(/baseline_drift:migrations/);

    const removed = copyRepoSubset();
    const victim = fs.readdirSync(path.join(removed, "drizzle/migrations")).sort()[10];
    fs.rmSync(path.join(removed, "drizzle/migrations", victim));
    expect(() => fresh.loadBaseline({ root: removed })).toThrow(/baseline_drift/);

    const edited = copyRepoSubset();
    fs.appendFileSync(path.join(edited, "drizzle/schema.sql"), "\n-- drift\n");
    expect(() => fresh.loadBaseline({ root: edited })).toThrow(/baseline_drift:schema_sha256/);
  });
});

describe("AU-G2-1 schema vs migration history", () => {
  it("agree on tables, indexes and triggers (documented pre-repo/rebuild gaps only)", () => {
    const db = memoryDb();
    try {
      db.exec(fs.readFileSync(path.join(ROOT, "drizzle/schema.sql"), "utf8"));
      const schema = objectSets(db);
      const history = migrationObjects(path.join(ROOT, "drizzle/migrations"));

      // Indexes and triggers must match exactly: a migration that adds one
      // without the other is exactly the silent drift this audit found.
      expect([...history.index].filter((n) => !schema.index.has(n))).toEqual([]);
      expect([...schema.index].filter((n) => !history.index.has(n))).toEqual([]);
      expect([...history.trigger].filter((n) => !schema.trigger.has(n))).toEqual([]);
      expect([...schema.trigger].filter((n) => !history.trigger.has(n))).toEqual([]);

      const schemaOnlyTables = [...schema.table].filter((n) => !history.table.has(n));
      const historyOnlyTables = [...history.table].filter((n) => !schema.table.has(n));
      expect(schemaOnlyTables.filter((n) => !PRE_MIGRATION_TABLES.includes(n))).toEqual([]);
      expect(historyOnlyTables.filter((n) => !REBUILD_ARTIFACT_TABLES.includes(n))).toEqual([]);
    } finally { db.close(); }
  });

  it("has every migration-added column in schema.sql", () => {
    const db = memoryDb();
    try {
      db.exec(fs.readFileSync(path.join(ROOT, "drizzle/schema.sql"), "utf8"));
      const missing: string[] = [];
      for (const file of fs.readdirSync(path.join(ROOT, "drizzle/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
        for (const statement of statements(fs.readFileSync(path.join(ROOT, "drizzle/migrations", file), "utf8"))) {
          const m = /^ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+COLUMN\s+([A-Za-z0-9_]+)/i.exec(statement);
          if (!m) continue;
          const columns = db.prepare(`PRAGMA table_info(${m[1]})`).all().map((row: any) => String(row.name));
          if (columns.length && !columns.includes(m[2])) missing.push(`${m[1]}.${m[2]} (${file})`);
        }
      }
      expect(missing).toEqual([]);
    } finally { db.close(); }
  });
});

describe("AU-G2-1 fresh initializer", () => {
  it("refuses a non-blank or already-ledgered database without touching it", () => {
    const nonBlank = memoryDb();
    try {
      nonBlank.exec("CREATE TABLE keep_me(id INTEGER PRIMARY KEY)");
      expect(fresh.planFreshInit(nonBlank)).toMatchObject({ ok: false, reason: "not_blank" });
      const baseline = fresh.loadBaseline();
      expect(() => fresh.applyFreshInit(nonBlank, baseline)).toThrow(/not_blank/);
      expect(nonBlank.prepare("SELECT name FROM sqlite_master WHERE name='keep_me'").all()).toHaveLength(1);
      expect(nonBlank.prepare("SELECT name FROM sqlite_master WHERE name='d1_migrations'").all()).toEqual([]);
    } finally { nonBlank.close(); }

    const ledgered = memoryDb();
    try {
      ledgered.exec(fresh.LEDGER_DDL);
      ledgered.exec("INSERT INTO d1_migrations(name) VALUES ('0140_mirai_supplier.sql')");
      expect(fresh.planFreshInit(ledgered)).toMatchObject({ ok: false, reason: "existing_ledger", applied: 1 });
      expect(() => fresh.applyFreshInit(ledgered, fresh.loadBaseline())).toThrow(/existing_ledger/);
      expect(fresh.ledgerNames(ledgered)).toEqual(["0140_mirai_supplier.sql"]);
    } finally { ledgered.close(); }
  });

  it("marks the baseline, leaves nothing pending, and applies a synthetic next migration once", () => {
    const db = memoryDb();
    try {
      const baseline = fresh.loadBaseline();
      const result = fresh.applyFreshInit(db, baseline);
      expect(result.applied).toBe(baseline.files.length);
      expect(result.ledger).toEqual(baseline.files);
      expect(fresh.pendingMigrations({ files: baseline.files, applied: result.ledger })).toEqual([]);

      const pending = fresh.pendingMigrations({
        files: [...baseline.files, "0153_synthetic_probe.sql"],
        applied: result.ledger,
      });
      expect(pending).toEqual(["0153_synthetic_probe.sql"]);

      // Emulate Wrangler's ledger gate: run a migration only while unapplied.
      const runWrangler = () => {
        const done = new Set(fresh.ledgerNames(db));
        const queue = fresh.pendingMigrations({ files: [...baseline.files, "0153_synthetic_probe.sql"], applied: done });
        for (const name of queue) {
          db.exec("CREATE TABLE IF NOT EXISTS fx9_synthetic_probe(id INTEGER PRIMARY KEY)");
          db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(name);
        }
        return queue;
      };
      expect(runWrangler()).toEqual(["0153_synthetic_probe.sql"]);
      expect(runWrangler()).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM d1_migrations WHERE name='0153_synthetic_probe.sql'").get().n).toBe(1);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='fx9_synthetic_probe'").all()).toHaveLength(1);

      // Re-running the initializer on the initialized DB must fail closed.
      expect(() => fresh.applyFreshInit(db, baseline)).toThrow(/existing_ledger/);
      expect(fresh.ledgerNames(db)).toHaveLength(baseline.files.length + 1);
    } finally { db.close(); }
  });
});
