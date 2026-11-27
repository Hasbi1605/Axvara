import fs from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it("migrates the notice ledger and claims one labelled recovery on native D1", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import { createDatabaseAccess } from './src/lib/db-access';
      import { notifyWebPaidAdmin, retryPendingTelegramNotifications } from './src/lib/telegram/order-notifications';
      export default { async fetch(request, env) {
        const db = createDatabaseAccess(env.DB);
        const posts = [];
        let probes = 0;
        globalThis.fetch = async (url, init) => {
          if (url === 'https://api.telegram.org/botfixture/getMe' && init.method === 'POST') {
            probes++;
            return Response.json({ ok: true, result: { id: 17 } });
          }
          if (url !== 'https://api.telegram.org/botfixture/sendMessage' || init.method !== 'POST') throw Error('Forbidden fixture request');
          posts.push(JSON.parse(init.body).text);
          return posts.length === 1 ? Response.json({ ok: false, error_code: 500 }, { status: 500 })
            : Response.json({ ok: true, result: { message_id: 42 } });
        };
        const retry = async () => (await retryPendingTelegramNotifications(10, { created:false, paid:false, paidAdmin:false, paidAdminWeb:true }, db)).paidAdminWeb;
        const initial = await notifyWebPaidAdmin('AXV-fixture', db);
        const early = await retry();
        await db.execRun("UPDATE buyer_notice_log SET updated_at=datetime('now','-31 minutes') WHERE idempotency_key='admin-paid:AXV-fixture'");
        const followUp = await notifyWebPaidAdmin('AXV-fixture', db);
        const recovered = await retry();
        const after = await retry();
        return Response.json({ initial, early, followUp, recovered, after, posts, probes });
      } };
    ` },
    define: {
      "process.env.TELEGRAM_BOT_ENABLED": JSON.stringify("true"),
      "process.env.TELEGRAM_ADMIN_CHAT_ID": JSON.stringify("-1234"),
      "process.env.TELEGRAM_BOT_TOKEN": JSON.stringify("fixture"),
      // Setup Node (tests/setup/telegram-custom-emoji-off.ts) tidak sampai ke bundle workerd.
      "process.env.TELEGRAM_CUSTOM_EMOJI": JSON.stringify("off"),
    },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
  });
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text, d1Databases: ["DB"],
  });
  try {
    const db = await runtime.getD1Database("DB");
    const statements = (path: string) => fs.readFileSync(path, "utf8").replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch([
      db.prepare(`CREATE TABLE orders (code TEXT PRIMARY KEY, items TEXT, customer_name TEXT, customer_email TEXT,
        customer_wa TEXT, subtotal INTEGER, payment_method TEXT, paid_at TEXT, variant_snapshot TEXT, order_kind TEXT,
        sales_channel TEXT, status TEXT, payment_status TEXT, updated_at TEXT)`),
      db.prepare("CREATE TABLE payment_transactions (id INTEGER, order_code TEXT, payable_amount INTEGER)"),
      db.prepare("INSERT INTO orders (code, items, customer_name, subtotal, paid_at, order_kind, sales_channel, status, payment_status) VALUES ('AXV-fixture','[]','Test',10000,datetime('now','-31 minutes'),'pedia','web','lunas','paid')"),
      ...statements("drizzle/migrations/0039_buyer_notice_log.sql").map(sql => db.prepare(sql)),
      ...statements("drizzle/migrations/0082_buyer_access_pin.sql").filter(sql => sql.startsWith("ALTER TABLE buyer_notice_log")).map(sql => db.prepare(sql)),
      db.prepare(`INSERT INTO buyer_notice_log VALUES ('email:fixture','AXV-fixture','email','failed','test-provider','test-error',2,'test-retry','test-lease','test-created','test-updated')`),
    ]);
    const preserved = await db.prepare("SELECT * FROM buyer_notice_log").first();
    await db.batch(statements("drizzle/migrations/0152_admin_paid_notice_unknown.sql").map(sql => db.prepare(sql)));
    expect(await db.prepare("SELECT * FROM buyer_notice_log").first()).toEqual(preserved);
    expect(await db.prepare("SELECT name FROM pragma_index_list('buyer_notice_log') WHERE name='idx_buyer_notice_order'").first()).not.toBeNull();
    await expect(db.prepare("UPDATE buyer_notice_log SET status='unknown' WHERE idempotency_key='email:fixture'").run()).rejects.toThrow(/CHECK/);

    const response = await runtime.dispatchFetch("https://fixture.test/notify");
    expect(response.status).toBe(200);
    const result = await response.json() as { posts: string[] };
    expect(result).toMatchObject({ initial: false, early: 0, followUp: false, recovered: 1, after: 0, probes: 1 });
    expect(result.posts).toEqual([result.posts[0], `🔁 Kirim ulang otomatis — abaikan bila notif lunas order ini sudah ada\n${result.posts[0]}`]);
    expect(await db.prepare("SELECT status,error,access_attempts FROM buyer_notice_log WHERE idempotency_key='admin-paid:AXV-fixture'").first())
      .toEqual({ status: "sent", error: null, access_attempts: 1 });
  } finally {
    await runtime.dispose();
  }
}, 30_000);
