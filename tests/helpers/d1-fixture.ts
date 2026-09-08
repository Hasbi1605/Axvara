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
 * like D1. Gateway/network boundaries belong in the calling test's mocks. */
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
