import { expect, it } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";

it("the actual KlikQRIS adapter sends requests in workerd and rejects redirects without forwarding secrets", async () => {
  const compiled = await build({
    stdin: { contents: `import {createKlikQrisInvoice,fetchKlikQrisImage} from './src/lib/payments/klikqris';
      export default {async fetch(request,env){globalThis.fixtureDb=env.DB;try{
        const url=new URL(request.url);
        if(url.pathname==='/image')return new Response(await fetchKlikQrisImage('https://klikqris.com/storage/fixture.png'));
        return Response.json(await createKlikQrisInvoice(url.searchParams.get('code'),1000));
      }catch(error){return Response.json({error:error.message},{status:503});}}};`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_PAYMENTS_MAINTENANCE: "false", KLIKQRIS_ENABLED: "true", KLIKQRIS_API_KEY: "fixture-key", KLIKQRIS_MERCHANT_ID: "123456789" }) },
    plugins: [{ name: "database-boundary", setup(builder) {
      builder.onResolve({ filter: /^@\/|^\.\/dana-qris$/ }, args => {
        if (args.path === "@/lib/db") return { path: "db", namespace: "fixture" };
        if (["./dana-qris", "@/lib/fulfillment/deliver", "@/lib/warung-rebahan/order", "@/lib/sekalipay/order", "@/lib/pedia/dispatch", "@/lib/telegram/api"].includes(args.path)) {
          return { path: "unused", namespace: "fixture" };
        }
        return { path: resolve("src", args.path.slice(2) + ".ts") };
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "db" ? `
        export const getD1=()=>globalThis.fixtureDb;
        export const queryFirst=(sql,...p)=>getD1().prepare(sql).bind(...p).first();
        export const execRun=async(sql,...p)=>({changes:(await getD1().prepare(sql).bind(...p).run()).meta.changes});
        export const transitionPendingPaymentToPaid=()=>{throw new Error('settlement not used by this runtime fixture')};
      ` : `export const unused=true;` }));
    } }],
  });
  const requests: { url: string; method: string; apiKey: string | null }[] = [];
  let redirectCreate = false, redirectImage = false;
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-31", compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text, d1Databases: ["DB"],
    outboundService: async request => {
      requests.push({ url: request.url, method: request.method, apiKey: request.headers.get("x-api-key") });
      if (request.url === "https://klikqris.com/api/qris/create") {
        if (redirectCreate) return new Response(null, { status: 302, headers: { location: "https://untrusted.example/steal" } });
        const body = await request.json() as { order_id: string };
        expect(request.headers.get("id_merchant")).toBe("123456789");
        return Response.json({ status: true, data: { order_id: body.order_id, amount: "1000.00", total_amount: "1089.00",
          status: "PENDING", signature: "fixture-private-signature-1234567890", qris_url: "https://klikqris.com/storage/fixture.png",
          expired_at: new Date(Date.now() + 3600_000).toISOString() } }, { status: 201 });
      }
      if (request.url === "https://klikqris.com/storage/fixture.png") {
        if (redirectImage) return new Response(null, { status: 302, headers: { location: "https://untrusted.example/image" } });
        return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), { headers: { "content-type": "image/png" } });
      }
      throw new Error("Unexpected outbound request");
    },
  });
  try {
    const db = await runtime.getD1Database("DB");
    const paymentDDL = readFileSync("drizzle/schema.sql", "utf8").match(/CREATE TABLE IF NOT EXISTS payment_transactions \([\s\S]+?\n\);/)![0];
    await db.batch([
      db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY,status TEXT,payment_status TEXT,expires_at TEXT,payment_method TEXT,payment_account TEXT,updated_at TEXT)"),
      db.prepare("CREATE TABLE operation_guards(operation_id TEXT PRIMARY KEY,valid INTEGER CHECK(valid=1))"),
      db.prepare(paymentDDL),
      db.prepare("INSERT INTO orders(code,status,payment_status,expires_at) VALUES('AXV-20261018-WORKER01','pending','unpaid',?),('AXV-20261018-WORKER02','pending','unpaid',?)")
        .bind(new Date(Date.now()+900_000).toISOString(),new Date(Date.now()+900_000).toISOString()),
    ]);
    const response = await runtime.dispatchFetch("https://axvara.tech/invoice?code=AXV-20261018-WORKER01");
    expect(response.status).toBe(200);
    const invoice = await response.json();
    expect(invoice).toMatchObject({ payableAmount: 1089, uniqueCode: 89, qrisUrl: "https://axvara.tech/api/payments/qris/AXV-20261018-WORKER01/image" });
    expect(JSON.stringify(invoice)).not.toContain("fixture-private-signature");
    expect(requests).toEqual([{ url: "https://klikqris.com/api/qris/create", method: "POST", apiKey: "fixture-key" }]);
    expect((await runtime.dispatchFetch("https://axvara.tech/invoice?code=AXV-20261018-WORKER01")).status).toBe(200);
    expect(requests).toHaveLength(1);

    const image = await runtime.dispatchFetch("https://axvara.tech/image");
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toHaveLength(9);
    expect(requests.at(-1)?.apiKey).toBeNull();
    redirectImage = true;
    expect((await runtime.dispatchFetch("https://axvara.tech/image")).status).toBe(503);
    redirectCreate = true;
    const rejected = await runtime.dispatchFetch("https://axvara.tech/invoice?code=AXV-20261018-WORKER02");
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({ error: "klikqris_http_302" });
    expect(requests.every(request => new URL(request.url).hostname === "klikqris.com")).toBe(true);
  } finally { await runtime.dispose(); }
}, 30_000);
