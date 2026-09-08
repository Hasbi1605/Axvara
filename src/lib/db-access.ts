import { getD1, queryAll, queryFirst, execRun, type D1, type D1Statement, type D1Result } from "@/lib/db";

type Row = Record<string, unknown>;
export type DatabaseAccess = {
  d1: D1 | null;
  queryAll: (query: string, ...params: unknown[]) => Promise<Row[]>;
  queryFirst: (query: string, ...params: unknown[]) => Promise<Row | null>;
  execRun: (query: string, ...params: unknown[]) => Promise<{ changes?: number; lastInsertRowid?: number }>;
  getD1: () => D1 | null;
  isD1Mode: () => boolean;
  canSpend: (queries: number) => boolean;
};

/** Capture a database for this call tree. Never swap globalThis.DB during a request. */
export function createDatabaseAccess(d1: D1 | null = getD1()): DatabaseAccess {
  const statement = (query: string, params: unknown[]) => d1!.prepare(query).bind(...params);
  return {
    d1, getD1: () => d1, isD1Mode: () => Boolean(d1), canSpend: () => true,
    queryAll: d1 ? async (q, ...p) => (await statement(q, p).all()).results as Row[] : queryAll,
    queryFirst: d1 ? async (q, ...p) => await statement(q, p).first() as Row | null : async (q, ...p) => (await queryFirst(q, ...p)) ?? null,
    execRun: d1 ? async (q, ...p) => {
      const result = await statement(q, p).run();
      return { changes: result.meta.changes, lastInsertRowid: result.meta.last_row_id };
    } : execRun,
  };
}

export class QueryBudgetExceeded extends Error {
  constructor() { super("Local query budget exhausted; resume on the next invocation"); }
}

/** Count submitted statements, including failed calls and every member of a batch.
 * An aborted batch may execute fewer members; charging the full batch is conservative.
 * Two tail statements are reserved for the cron checkpoint. Admission happens BEFORE
 * touching D1; oversized batches are rejected whole, never committed halfway through. */
export function createBudgetedDatabase(limit = 40, reserveTail = 2, base = getD1()) {
  let used = 0;
  let ceiling = limit - reserveTail;
  const consume = (n: number) => {
    if (used + n > ceiling) throw new QueryBudgetExceeded();
    used += n;
  };
  const originals = new WeakMap<D1Statement, D1Statement>();
  const wrap = (source: D1Statement): D1Statement => {
    const result: D1Statement = {
      bind: (...p) => wrap(source.bind(...p)),
      first: async () => { consume(1); return source.first(); },
      all: async () => { consume(1); return source.all(); },
      run: async () => { consume(1); return source.run(); },
    };
    originals.set(result, source);
    return result;
  };
  const db: D1 | null = base ? {
    prepare: (q) => wrap(base.prepare(q)),
    batch: async (statements): Promise<D1Result[]> => {
      consume(statements.length);
      return base.batch(statements.map((s) => originals.get(s) ?? s));
    },
  } : null;
  const access = createDatabaseAccess(db);
  if (!base) {
    // Dev fallback has no D1 statements; count its query API calls consistently.
    for (const name of ["queryAll", "queryFirst", "execRun"] as const) {
      const original = access[name];
      Object.assign(access, { [name]: async (q: string, ...p: unknown[]) => { consume(1); return original(q, ...p); } });
    }
  }
  access.canSpend = (n) => used + n <= ceiling;
  return { access, get used() { return used; }, get remaining() { return ceiling - used; },
    fits: (n: number) => access.canSpend(n),
    beginTail: () => { ceiling = limit; },
  };
}
