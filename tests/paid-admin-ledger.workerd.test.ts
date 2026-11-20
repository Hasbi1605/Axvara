import fs from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it("migrates the notice ledger and suppresses an ambiguous admin POST on native D1", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import { createDatabaseAccess } from './src/lib/db-access';
      import { notifyWebPaidAdmin, retryPendingTelegramNotifications } from './src/lib/telegram/order-notifications';
      export default { async fetch(request, env) {
        const db = createDatabaseAccess(env.DB);
        let posts = 0;
        globalThis.fetch = async (url, init) => {
          if (url !== 'https://api.telegram.org/botfixture/sendMessage' || init.method !== 'POST') throw Error('Forbidden fixture request');
          posts++;
          return Response.json({ ok: false, error_code: 500 }, { status: 500 });
        };
        const initial = await notifyWebPaidAdmin('AXV-fixture', db);
        const retry = await retryPendingTelegramNotifications(10, { created:false, paid:false, paidAdmin:false, paidAdminWeb:true }, db);
        const followUp = await notifyWebPaidAdmin('AXV-fixture', db);
        return Response.json({ initial, retry: retry.paidAdminWeb, followUp, posts });
      } };
    ` },
    define: {
      "process.env.TELEGRAM_BOT_ENABLED": JSON.stringify("true"),
      "process.env.TELEGRAM_ADMIN_CHAT_ID": JSON.stringify("-1234"),
      "process.env.TELEGRAM_BOT_TOKEN": JSON.stringify("fixture"),
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
      db.prepare("INSERT INTO orders (code, items, customer_name, subtotal, paid_at, order_kind, sales_channel, status, payment_status) VALUES ('AXV-fixture','[]','Test',10000,datetime('now'),'pedia','web','lunas','paid')"),
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
    expect(await response.json()).toEqual({ initial: false, retry: 0, followUp: false, posts: 1 });
    expect(await db.prepare("SELECT status,error FROM buyer_notice_log WHERE idempotency_key='admin-paid:AXV-fixture'").first())
      .toEqual({ status: "unknown", error: "ambiguous" });
  } finally {
    await runtime.dispose();
  }
}, 30_000);
