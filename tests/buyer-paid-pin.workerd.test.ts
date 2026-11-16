import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

it("discloses paid PINs with real workerd HMAC/D1 and rejects status, revocation and rotation", async () => {
  const code = "AXV-20261116-PAIDPIN1", token = "d".repeat(64);
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {POST} from './src/app/api/orders/[code]/pin/route';
      import {createCheckoutCredentialGrant,createBuyerAccessSession} from './src/lib/order-access';
      export default {async fetch(req,env){
        globalThis.DB=env.DB;
        if(new URL(req.url).pathname==='/fixture-proofs') {
          const order=await env.DB.prepare('SELECT * FROM orders').first();
          return Response.json({grant:await createCheckoutCredentialGrant(order),status:await createBuyerAccessSession(order)});
        }
        return POST(req,{params:Promise.resolve({code:'${code}'})});
      }};` },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    define: { "process.env": JSON.stringify({ NODE_ENV: "test", BUYER_ORDER_ACCESS_SECRET: "workerd-paid-pin-fixture" }) },
    plugins: [{ name: "framework-adapter", setup(b) {
      b.onResolve({ filter: /^server-only$|^next\/server$/ }, args => ({ path: args.path, namespace: "framework" }));
      b.onLoad({ filter: /.*/, namespace: "framework" }, args => ({ contents: args.path === "server-only" ? "" : "export const NextResponse=Response; export const NextRequest=Request;" }));
    } }],
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"],
    outboundService: () => { throw new Error("No external traffic"); } });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch([
      db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY,quote_id TEXT,buyer_access_version INTEGER,buyer_access_format TEXT,status TEXT,payment_status TEXT)"),
      db.prepare("CREATE TABLE wr_credential_tokens(id INTEGER PRIMARY KEY,order_code TEXT,token_hash TEXT,revoked INTEGER DEFAULT 0,expires_at TEXT,buyer_access_version INTEGER,last_used_at TEXT)"),
      db.prepare("INSERT INTO orders VALUES(?,'fixture-quote',1,'pin6','lunas','paid')").bind(code),
      db.prepare("INSERT INTO wr_credential_tokens(order_code,token_hash,buyer_access_version,expires_at) VALUES(?,?,1,datetime('now','+1 day'))").bind(code, createHash("sha256").update(`wr-cred:${code}:${token}`).digest("hex")),
    ]);
    const proofs = await (await runtime.dispatchFetch("https://fixture.test/fixture-proofs")).json() as { grant: string; status: string };
    const post = (headers: Record<string, string>) => runtime.dispatchFetch("https://fixture.test/pin", { method: "POST", headers });
    expect((await post({ "x-buyer-access-session": proofs.status })).status).toBe(404);
    const response = await post({ "x-checkout-credential-grant": proofs.grant });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const pin = await response.json(); expect(pin).toMatchObject({ pin: expect.stringMatching(/^[A-Z0-9]{6}$/) });
    expect(await (await post({ "x-credential-token": token })).json()).toEqual(pin);
    await db.prepare("UPDATE wr_credential_tokens SET revoked=1").run();
    expect((await post({ "x-credential-token": token })).status).toBe(404);
    await db.prepare("UPDATE orders SET buyer_access_version=2").run();
    expect((await post({ "x-checkout-credential-grant": proofs.grant })).status).toBe(404);
  } finally { await runtime.dispose(); }
}, 30_000);
