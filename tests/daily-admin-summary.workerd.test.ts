import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it("runs daily admin summary on native D1/workerd within <=12 statements, low rows_read, and 0-statement isolate memo", async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
        import { sendDueDailyAdminSummary } from './src/lib/telegram/daily-admin-summary';
        import { createBudgetedDatabase } from './src/lib/db-access';
        export default {
          async fetch(request, env) {
            const input = await request.json();
            globalThis.__sent = [];
            let rowsRead = 0;
            const origPrepare = env.DB.prepare.bind(env.DB);
            const instrumented = {
              prepare(sql) {
                const wrapStmt = (stmt) => ({
                  bind: (...p) => wrapStmt(stmt.bind(...p)),
                  first: async (...a) => {
                    const res = await stmt.all(...a);
                    rowsRead += Number(res?.meta?.rows_read ?? 0);
                    return res?.results?.[0] ?? null;
                  },
                  all: async (...a) => {
                    const res = await stmt.all(...a);
                    rowsRead += Number(res?.meta?.rows_read ?? 0);
                    return res;
                  },
                  run: async (...a) => {
                    const res = await stmt.run(...a);
                    rowsRead += Number(res?.meta?.rows_read ?? 0);
                    return res;
                  },
                });
                return wrapStmt(origPrepare(sql));
              },
              batch: (stmts) => env.DB.batch(stmts),
            };
            if (!globalThis.__baseDb) globalThis.__baseDb = instrumented;
            const b = createBudgetedDatabase(12, 0, globalThis.__baseDb);
            const result = await sendDueDailyAdminSummary(b.access, { now: new Date(input.nowIso) });
            return Response.json({ result, used: b.used, rowsRead, messages: globalThis.__sent });
          }
        };`,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    define: {
      "process.env": JSON.stringify({
        TELEGRAM_BOT_ENABLED: "true",
        TELEGRAM_ADMIN_CHAT_ID: "-100123",
        TELEGRAM_BOT_TOKEN: "bot-token",
      }),
    },
    plugins: [
      {
        name: "mock-telegram",
        setup(b) {
          b.onResolve({ filter: /telegram\/api$/ }, () => ({ path: "sender", namespace: "fixture" }));
          // Shared payment modules lazily import next-on-pages (server-only); stub it like order-queue.workerd.
          b.onResolve({ filter: /^@cloudflare\/next-on-pages$/ }, () => ({ path: "next-on-pages", namespace: "fixture" }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: args.path === "next-on-pages"
              ? "export const getRequestContext=()=>globalThis[Symbol.for('__cloudflare-request-context__')];"
              : `export async function sendMessage(params){ globalThis.__sent.push(params); return { ok: true, result: { message_id: globalThis.__sent.length } }; }
                 export async function getMe(){ throw Error('unexpected recovery health probe'); }`,
          }));
        },
      },
    ],
  });

  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text,
    d1Databases: ["DB"],
  });
  const fixture = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const ddl = fixture.sql
      .prepare("SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL")
      .all() as { sql: string }[];
    for (const row of ddl) {
      await db.prepare(row.sql).run();
    }

    await db.batch([
      db.prepare("INSERT INTO products(id,name,slug,price,stock,is_active,fulfillment_mode) VALUES(1,'Hot Product','hot',50000,2,1,'manual')"),
      db.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active) VALUES(1,1,'HOT-1','1M',50000,2,'manual',1)"),
      // 200 historical paid orders (>45 days ago) + 100 historical expired orders (>45 days ago)
      db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<200)
        INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at,created_at,updated_at)
        SELECT 'HIST-'||x,'U','628','[{"product_id":1,"variant_id":1,"qty":1}]',50000,'qris','lunas','paid','web','2026-09-01 10:00:00','2026-09-01 09:55:00','2026-09-01 10:00:00' FROM n`),
      db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100)
        INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,created_at,updated_at)
        SELECT 'EXP-'||x,'U','628','[]',50000,'qris','kadaluarsa','expired','web','2026-09-01 09:55:00','2026-09-01 10:15:00' FROM n`),
      // Yesterday WIB (2026-11-17) order + stuck order
      db.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at,created_at,updated_at)
        VALUES('YEST-1','A','628','[{"product_id":1,"variant_id":1,"qty":3}]',75000,'qris','lunas','paid','web','2026-11-17 05:00:00','2026-11-17 04:55:00','2026-11-17 05:00:00')`),
      db.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,status)
        VALUES('YEST-1',0,1,1,3,'manual','manual_required')`),
    ]);

    const r1 = await runtime.dispatchFetch("https://fixture.test/summary", {
      method: "POST",
      body: JSON.stringify({ nowIso: "2026-11-18T00:05:00Z" }),
    });
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as {
      result: { due: boolean; sent: boolean };
      used: number;
      rowsRead: number;
      messages: { text: string }[];
    };
    expect(body1.result).toMatchObject({ due: true, sent: true });
    expect(body1.used).toBeLessThanOrEqual(12);
    // Must not scan the 300 historical orders!
    expect(body1.rowsRead).toBeLessThan(150);
    expect(body1.messages).toHaveLength(1);
    expect(body1.messages[0].text).toContain("Order lunas: <b>1</b>");
    expect(body1.messages[0].text).toContain("<code>YEST-1</code>");
    expect(body1.messages[0].text).toContain("<b>Hot Product</b> — stok <b>2</b> (terjual 30h: 3)");

    // Second tick on same isolate must spend 0 D1 statements via unwrapD1 memo
    const r2 = await runtime.dispatchFetch("https://fixture.test/summary", {
      method: "POST",
      body: JSON.stringify({ nowIso: "2026-11-18T00:10:00Z" }),
    });
    const body2 = (await r2.json()) as {
      result: { due: boolean; sent: boolean; skipped?: string };
      used: number;
      rowsRead: number;
    };
    expect(body2.result).toMatchObject({ due: true, sent: false, skipped: "already_sent" });
    expect(body2.used).toBe(0);
    expect(body2.rowsRead).toBe(0);
  } finally {
    fixture.close();
    await runtime.dispose();
  }
}, 30000);
