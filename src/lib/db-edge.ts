// Edge-only DB — D1 pure, no Node imports, bundle-safe for @cloudflare/next-on-pages
type D1 = {
  prepare: (sql: string) => {
    bind: (...p: unknown[]) => { all: () => Promise<{ results: unknown[] }>; first: () => Promise<unknown>; run: () => Promise<{ meta: { last_row_id: number; changes: number } }> };
    all: () => Promise<{ results: unknown[] }>;
  };
};
function getD1(): D1 {
  const g = globalThis as unknown as Record<string, unknown>;
  // @cloudflare/next-on-pages exposes bindings on process.env.
  const d1 = (g.DB as D1 | undefined) ?? ((process.env as unknown as Record<string, unknown>).DB as D1 | undefined);
  if (!d1) throw new Error("D1 binding DB not found — check wrangler.toml d1_databases");
  return d1;
}
export async function queryAll(sql: string, ...params: unknown[]): Promise<Record<string,unknown>[]> {
  const d1 = getD1();
  if (params.length) return ((await d1.prepare(sql).bind(...params).all()).results as Record<string,unknown>[]) ?? [];
  return ((await d1.prepare(sql).all()).results as Record<string,unknown>[]) ?? [];
}
export async function queryFirst(sql: string, ...params: unknown[]): Promise<Record<string,unknown>|undefined> {
  const d1 = getD1();
  return (await d1.prepare(sql).bind(...params).first()) as Record<string,unknown>|undefined;
}
export async function execRun(sql: string, ...params: unknown[]): Promise<{ lastInsertRowid?:number; changes?:number }> {
  const d1 = getD1();
  const r = await d1.prepare(sql).bind(...params).run();
  return { lastInsertRowid: (r as unknown as { meta:{last_row_id:number} }).meta?.last_row_id, changes: (r as unknown as { meta:{changes:number} }).meta?.changes };
}
