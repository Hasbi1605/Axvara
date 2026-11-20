import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it("workerd D1 + native BROADCAST_QUEUE producer: sendBatch chunks enqueue and origin delivers once without double-send", async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
        import { enqueueDueTelegramPromo } from './src/lib/telegram/promo-broadcast';
        import { POST } from './src/app/api/internal/queue/broadcast/route';
        import { createDatabaseAccess } from './src/lib/db-access';

        const sentCalls = [];
        globalThis.fetch = async (url, init) => {
          const method = String(url).split('/').pop() || '';
          const body = JSON.parse(String(init?.body ?? '{}'));
          sentCalls.push({ method, chat_id: body.chat_id });
          return Response.json({ ok: true, result: { message_id: sentCalls.length } });
        };

        export default {
          async fetch(req, env, ctx) {
            globalThis.DB = env.DB;
            globalThis[Symbol.for('__cloudflare-request-context__')] = { env, ctx };
            const db = createDatabaseAccess(env.DB);
            const url = new URL(req.url);
            if (url.pathname === '/enqueue') {
              const res = await enqueueDueTelegramPromo(db, new Date('2099-11-19T02:05:00Z'));
              await db.execRun("UPDATE broadcast_deliveries SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE campaign_id=?", res.campaignId);
              const rows = await db.queryAll('SELECT id FROM broadcast_deliveries WHERE campaign_id=? ORDER BY id', res.campaignId);
              return Response.json({ ...res, ids: rows.map((r) => Number(r.id)) });
            }
            if (url.pathname === '/calls') {
              return Response.json({ sentCalls });
            }
            return POST(req);
          }
        };
      `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    define: {
      "process.env": JSON.stringify({
        CRON_SECRET: "workerd-cron",
        TELEGRAM_BOT_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "workerd-tg-token",
        SITE_URL: "https://axvara.tech",
      }),
    },
    plugins: [
      {
        name: "workerd-runtime-boundaries",
        setup(b) {
          b.onResolve({ filter: /^(next\/server|@cloudflare\/next-on-pages)$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "next/server"
                ? "export const NextResponse = Response; export const NextRequest = Request;"
                : "export const getRequestContext = () => globalThis[Symbol.for('__cloudflare-request-context__')];",
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
    queueProducers: { BROADCAST_QUEUE: "axvara-broadcast" },
  });
  const f = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const tables = f.sql
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
      .all();
    for (const table of tables) await db.prepare(String(table.sql)).run();
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO broadcast_dispatch_control(id) VALUES(1)"),
      db.prepare(
        "INSERT INTO products(id,name,slug,price,is_active) VALUES(1,'Canva','canva',5000,1),(2,'Claude','claude',10000,1),(3,'Netflix','netflix',15000,1)",
      ),
      db.prepare(
        "INSERT INTO product_variants(product_id,sku,label,price,stock,is_active) VALUES(1,'C','1M',5000,5,1),(2,'A','1M',10000,5,1),(3,'N','1M',15000,5,1)",
      ),
      db.prepare(
        "INSERT INTO telegram_users(user_id,chat_id,is_blocked,broadcast_opt_out) VALUES('101','101',0,0),('102','102',0,0),('103','103',1,0)",
      ),
    ]);

    const enqRes = await runtime.dispatchFetch("https://fixture/enqueue");
    expect(enqRes.status).toBe(200);
    const enq = (await enqRes.json()) as { enqueued: number; queuedMessages: number; campaignId: string; ids: number[] };
    expect(enq.enqueued).toBe(2);
    expect(enq.queuedMessages).toBe(1);
    expect(enq.ids).toHaveLength(2);

    // Origin processes batch on real workerd D1
    const originRes = await runtime.dispatchFetch("https://fixture/api/internal/queue/broadcast", {
      method: "POST",
      headers: { authorization: "Bearer workerd-cron", "content-type": "application/json" },
      body: JSON.stringify({
        v: 1,
        kind: "broadcast_deliveries",
        campaignId: enq.campaignId,
        deliveryIds: enq.ids,
        attempt: 1,
      }),
    });
    expect(originRes.status).toBe(200);
    expect(await originRes.json()).toMatchObject({ ok: true, settled: true, state: "done", sent: 2 });

    // Duplicate replay sends 0
    const dupRes = await runtime.dispatchFetch("https://fixture/api/internal/queue/broadcast", {
      method: "POST",
      headers: { authorization: "Bearer workerd-cron", "content-type": "application/json" },
      body: JSON.stringify({
        v: 1,
        kind: "broadcast_deliveries",
        campaignId: enq.campaignId,
        deliveryIds: enq.ids,
        attempt: 1,
      }),
    });
    expect(await dupRes.json()).toMatchObject({ ok: true, settled: true, sent: 0 });

    const calls = (await (await runtime.dispatchFetch("https://fixture/calls")).json()) as {
      sentCalls: Array<{ method: string; chat_id: string }>;
    };
    expect(calls.sentCalls).toEqual([
      { method: "sendMessage", chat_id: "101" },
      { method: "sendMessage", chat_id: "102" },
    ]);
  } finally {
    f.close();
    await runtime.dispose();
  }
}, 30_000);
