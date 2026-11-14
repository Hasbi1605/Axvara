import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { faviconIcons } from "@/lib/favicons";
import { gamesMetadata } from "@/lib/games/metadata";

describe("per-service favicons (14 Nov 2026)", () => {
  it.each(["market", "pedia", "games"] as const)("%s ships svg/ico/apple/192/512 assets that exist", (service) => {
    const icons = faviconIcons(service) as { icon: { url: string }[]; apple: { url: string }[] };
    const urls = [...icons.icon, ...icons.apple].map((i) => i.url);
    expect(urls).toEqual([
      `/brand/favicons/${service}/favicon.svg`, `/brand/favicons/${service}/favicon.ico`,
      `/brand/favicons/${service}/icon-192.png`, `/brand/favicons/${service}/icon-512.png`,
      `/brand/favicons/${service}/apple-touch-icon.png`,
    ]);
    for (const url of urls) expect(existsSync(`public${url}`)).toBe(true);
    const ico = readFileSync(`public/brand/favicons/${service}/favicon.ico`);
    expect(ico.readUInt16LE(2)).toBe(1); // ICO type
    expect(ico.readUInt16LE(4)).toBe(3); // 16/32/48
  });

  it("wires each layout to its own favicon set; root fallback is the new Market icon without the white outline bug", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain('faviconIcons("market")');
    expect(readFileSync("src/app/pedia/layout.tsx", "utf8")).toContain('faviconIcons("pedia")');
    expect(gamesMetadata("/", "t", "d").icons).toEqual(faviconIcons("games"));
    const root = readFileSync("public/favicon.svg", "utf8");
    expect(root).toBe(readFileSync("public/brand/favicons/market/favicon.svg", "utf8"));
    expect(root).not.toMatch(/<svg[^>]*stroke="white"/);
  });
});
