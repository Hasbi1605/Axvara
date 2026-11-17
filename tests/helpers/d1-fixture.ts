import fs from "node:fs";
import { createRequire } from "node:module";
import type { D1, D1Statement } from "@/lib/db";

type Row = Record<string, unknown>;
type Statement = {
  get: (...params: unknown[]) => Row | undefined;
  all: (...params: unknown[]) => Row[];
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number };
};
type Database = { exec: (sql: string) => void; prepare: (sql: string) => Statement; close: () => void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => Database;
};

/** Real SQLite statements; batches execute without yielding and rollback together,
 * like D1. Gateway/network boundaries belong in the calling test's mocks.
 *
 * STRICT BIND CHECK (temuan WR 2026-09-13): D1 asli melempar saat jumlah `?`
 * placeholder tidak sama dengan jumlah values, tetapi node:sqlite diam-diam
 * `changes:0` — bug B2/B4 lolos seluruh test hijau. Maka setiap first/all/
 * run/batch di sini menghitung `?` di luar string literal dan MELEMPAR bila
 * tidak sama dengan params. Ini berlaku surut ke SEMUA test repo.
 */
export function countPlaceholders(query: string): number {
  let count = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "?") count++;
  }
  return count;
}

export function assertBindCount(query: string, params: unknown[]): void {
  const expected = countPlaceholders(query);
  if (params.length !== expected) {
    throw new Error(
      `D1 bind mismatch: query has ${expected} placeholder(s) but got ${params.length} value(s): ${query.slice(0, 120)}`,
    );
  }
  if (params.length > 100) {
    throw new Error(
      `D1_ERROR: too many SQL variables (${params.length} > 100): ${query.slice(0, 120)}`,
    );
  }
  assertD1LikePatterns(query, params);
}

/**
 * D1 (`workerd` & remote D1) enforces `SQLITE_LIMIT_LIKE_PATTERN_LENGTH = 50`
 * bytes (UTF-8) on both literal and bound `LIKE`/`GLOB` patterns.
 */
export function assertD1LikePatterns(query: string, params: unknown[]): void {
  let i = 0;
  let paramIndex = 0;
  let prevWord: string | null = null;
  let prevWasDot = false;
  const n = query.length;
  while (i < n) {
    const ch = query[i];
    if (ch <= " ") { i++; continue; }
    if (ch === "-" && query[i + 1] === "-") {
      while (i < n && query[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && query[i + 1] === "*") {
      i += 2;
      while (i < n && !(query[i] === "*" && query[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "'") {
      i++;
      let literal = "";
      while (i < n) {
        if (query[i] === "'") {
          if (query[i + 1] === "'") { literal += "'"; i += 2; continue; }
          i++;
          break;
        }
        literal += query[i++];
      }
      if (prevWord === "LIKE" || prevWord === "GLOB") {
        const bytes = Buffer.byteLength(literal, "utf8");
        if (bytes > 50) {
          throw new Error(
            `D1_ERROR: LIKE or GLOB pattern too complex (${bytes} > 50 bytes): ${query.slice(0, 120)}`,
          );
        }
      }
      prevWord = null;
      prevWasDot = false;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n) {
        if (query[i] === '"') {
          if (query[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      prevWord = null;
      prevWasDot = false;
      continue;
    }
    if (ch === "?") {
      if ((prevWord === "LIKE" || prevWord === "GLOB") && params[paramIndex] != null) {
        const bytes = Buffer.byteLength(String(params[paramIndex]), "utf8");
        if (bytes > 50) {
          throw new Error(
            `D1_ERROR: LIKE or GLOB pattern too complex (${bytes} > 50 bytes): ${query.slice(0, 120)}`,
          );
        }
      }
      paramIndex++;
      prevWord = null;
      prevWasDot = false;
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < n && /[A-Za-z0-9_$]/.test(query[i])) i++;
      const upper = query.slice(start, i).toUpperCase();
      prevWord = !prevWasDot && (upper === "LIKE" || upper === "GLOB") ? upper : null;
      prevWasDot = false;
      continue;
    }
    prevWasDot = ch === ".";
    prevWord = null;
    i++;
  }
}

export function createD1Fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(fs.readFileSync("drizzle/schema.sql", "utf8"));
  sql.exec("DELETE FROM product_variants; DELETE FROM products; PRAGMA foreign_keys=ON");
  const control = {
    queries: 0,
    limit: Infinity,
    fail: null as null | ((query: string, params: unknown[]) => boolean),
    beforeRun: null as null | ((query: string) => Promise<void>),
    afterRun: null as null | ((query: string) => Promise<void>),
    afterBatch: null as null | ((queries: string[]) => Promise<void>),
  };
  type InternalStatement = D1Statement & { query: string; execute: () => ReturnType<Statement["run"]> };
  const prepare = (query: string, params: unknown[] = []): InternalStatement => {
    const before = () => {
      control.queries++;
      if (control.queries > control.limit) throw new Error(`D1 query budget exceeded at #${control.queries}: ${query.slice(0, 100)}`);
      if (control.fail?.(query, params)) throw new Error("Injected database interruption");
      assertBindCount(query, params);
    };
    const execute = () => { before(); return sql.prepare(query).run(...params); };
    return {
      query,
      bind: (...values) => prepare(query, values),
      first: async () => { before(); return sql.prepare(query).get(...params) ?? null; },
      all: async () => { before(); return { results: sql.prepare(query).all(...params) }; },
      run: async () => {
        await control.beforeRun?.(query);
        const r = execute();
        await control.afterRun?.(query);
        return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      execute,
    };
  };
  const db: D1 = {
    prepare,
    batch: async (statements) => {
      // Tiap member melewati execute() → before() → assertBindCount, sama
      // seperti D1 asli yang menolak batch bila binding salah.
      sql.exec("BEGIN");
      let results;
      try {
        results = statements.map((statement) => {
          const result = (statement as InternalStatement).execute();
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        });
        sql.exec("COMMIT");
      } catch (error) { sql.exec("ROLLBACK"); throw error; }
      await control.afterBatch?.(statements.map((statement) => (statement as InternalStatement).query));
      return results;
    },
  };
  (globalThis as unknown as { DB?: D1 }).DB = db;
  return { sql, db, control, close() { delete (globalThis as unknown as { DB?: D1 }).DB; sql.close(); } };
}

export function insertTestOrder(sql: Database, code: string, options: {
  status?: string; channel?: string; items?: Row[]; qty?: number;
} = {}) {
  const items = options.items ?? [{ product_id: 1, variant_id: 1, name: "Fixture", price: 10000, qty: options.qty ?? 1 }];
  const paid = options.status === "lunas";
  sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,telegram_chat_id,telegram_user_id,variant_id)
    VALUES (?,?,?, ?,10000,'qris',?,?,?,'12345','12345',1)`)
    .run(code, "Test buyer", "628000000000", JSON.stringify(items), options.status ?? "pending", paid ? "paid" : "pending", options.channel ?? "telegram");
  return sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
}

export async function insertTestProduct(sql: Database, mode = "manual", variants = 1) {
  sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,100)");
  const { encryptSecret } = await import("@/lib/fulfillment/crypto");
  for (let i = 1; i <= variants; i++) {
    const secret = mode === "shared" ? await encryptSecret(`FIXTURE-SHARED-${i}`) : null;
    sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv) VALUES(?,1,?,?,10000,100,?,?,?)")
      .run(i, "SKU-" + i, "Variant " + i, mode, secret?.ciphertext ?? null, secret?.iv ?? null);
  }
}

/** Set the fulfillment encryption key for tests that encrypt/decrypt secrets. */
export function stubFulfillmentKey() {
  process.env.FULFILLMENT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
}
