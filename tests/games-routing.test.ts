import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { middleware } from "@/middleware";
import sitemap from "@/app/games/sitemap";
import { GET as robots } from "@/app/games/robots.txt/route";
import apexRobots from "@/app/robots";
import { gamesMetadata } from "@/lib/games/metadata";
import { isMetadataRouteFile } from "next/dist/lib/metadata/is-metadata-route";
import { normalizeMetadataPageToRoute, normalizeMetadataRoute } from "next/dist/lib/metadata/get-metadata-route";
vi.mock("@/lib/d1-maintenance", () => ({ isD1InMaintenance: async () => false, maintenanceDatabase: () => null }));
let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => { fx = createD1Fixture(); });
afterEach(() => { fx.close(); vi.unstubAllEnvs(); });
const call = (host: string, path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => middleware(new NextRequest(`https://${host}${path}`, { ...init, headers: { host, ...init?.headers } }));
it.each(["/", "/free-fire?x=1", "/lacak", "/sitemap.xml", "/robots.txt"])("rewrites Games %s without a feature flag and keeps security headers", async path => {
  const res = await call("games.axvara.tech", path);
  const url = new URL(res.headers.get("x-middleware-rewrite")!);
  expect(url.pathname).toBe(path === "/" ? "/games" : `/games${path.split("?")[0]}`);
  if (path.includes("?")) expect(url.search).toBe("?x=1");
  expect(res.headers.get("x-frame-options")).toBe("DENY"); expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
});
it.each(["axvara.tech", "pedia.axvara.tech", "preview.pages.dev"])("308 redirects %s Games links to canonical host", async host => {
  const res = await call(host, "/games/free-fire?x=1");
  expect(res.status).toBe(308); expect(res.headers.get("location")).toBe("https://games.axvara.tech/free-fire?x=1");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
});
it.each(["localhost", "127.0.0.1"])("keeps %s local paths", async host => {
  const res = await call(host, "/games/free-fire"); expect(res.headers.has("location")).toBe(false); expect(res.headers.has("x-middleware-rewrite")).toBe(false);
});
it.each(["/api", "/api/games/nickname", "/_next/static/x.js", "/brand/mark.svg", "/icons/x.webp", "/og/x.png", "/favicon.ico", "/fonts/font.ttf", "/images/a.avif", "/r2/x", "/mcp", "/games/free-fire"])("does not rewrite shared path %s", async path => {
  const res = await call("games.axvara.tech", path); expect(res.headers.has("x-middleware-rewrite")).toBe(false); expect(res.headers.get("x-frame-options")).toBe("DENY");
});
it("keeps production admin on apex and protects mutating API origins", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const admin = await call("games.axvara.tech", "/admin?tab=games"); expect(admin.status).toBe(307); expect(admin.headers.get("location")).toBe("https://axvara.tech/admin?tab=games");
  const denied = await call("games.axvara.tech", "/api/games/nickname", { method: "POST", headers: { origin: "https://evil.test" } });
  expect(denied.status).toBe(403); expect(denied.headers.get("x-frame-options")).toBe("DENY");
});
it("serves a nested sitemap recognized by installed Next 15; only enabled sellable registry games are indexed", async () => {
  expect(isMetadataRouteFile("/games/sitemap.ts", ["ts", "tsx"], true)).toBe(true);
  expect(normalizeMetadataPageToRoute(normalizeMetadataRoute("/games/sitemap"), false)).toBe("/games/sitemap.xml/route");
  expect(isMetadataRouteFile("/games/robots.ts", ["ts", "tsx"], true)).toBe(false);
  fx.sql.prepare("INSERT INTO games_products(buyer_sku_code,product_name,game_brand,sell_price,enabled) VALUES('ff140','140 Diamonds','FREE FIRE',10000,1),('mlcekusername','Cek Username','MOBILE LEGENDS',50,1),('pubg60','60 UC','PUBG MOBILE',10000,0),('unknown','Other','Other',1,1)").run();
  expect((await sitemap()).map(row => row.url)).toEqual(["https://games.axvara.tech/", "https://games.axvara.tech/free-fire"]);
  expect(gamesMetadata("/free-fire", "FF", "Top up")).toMatchObject({ alternates: { canonical: "https://games.axvara.tech/free-fire" }, openGraph: { url: "https://games.axvara.tech/free-fire" } });
});
it("serves Games robots text without changing apex robots output", async () => {
  const response = robots(); expect(response.headers.get("content-type")).toContain("text/plain");
  expect(await response.text()).toContain("Sitemap: https://games.axvara.tech/sitemap.xml");
  expect(apexRobots().sitemap).toBe("https://axvara.tech/sitemap.xml");
});
