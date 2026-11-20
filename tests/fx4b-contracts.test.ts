import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const src = (file: string) => readFileSync(`src/${file}`, "utf8");
const shop = (file: string) => src(`app/(shop)/${file}`);

it.each(["cara-order", "garansi-replace"])("%s leaves the main landmark to the shop layout", (route) => {
  expect(shop(`${route}/page.tsx`)).not.toMatch(/<main\b/);
});
it("checkout renders headings and submits via a form with an accessible issue dialog", () => {
  const page = shop("checkout/page.tsx");
  expect(page).toMatch(/<h1[^>]*>[^\n]*Keranjang kosong/);
  expect(page).toMatch(/<h1[^>]*>[^\n]*message\(directError\)/);
  expect(page).toMatch(/<form[^>]*onSubmit=/);
  expect(page).toMatch(/useModalA11y\(\{/);
});
it("Market navigation is named and exposed muted text meets the updated floor", () => {
  expect(src("components/storefront/Navbar.tsx")).toMatch(/<nav aria-label=/);
  expect(src("components/storefront/Footer.tsx")).not.toMatch(/\btext-white\/(30|35|40|45)\b/);
});
it("PDP orders headings, names thumbnails, and doesn't advertise invalid discounts", () => {
  const page = shop("produk/[slug]/product-detail-client.tsx");
  const body = page.slice(page.indexOf("<Link\n        href=\"/#katalog\""));
  expect(body.indexOf("<h1")).toBeLessThan(body.indexOf("{desktopCopy}"));
  expect(page).toMatch(/key=\{`thumb-[\s\S]{0,240}type="button"[\s\S]{0,240}aria-pressed=/);
  expect(page).toContain("displayComparePrice > displayPrice");
  expect(page).toContain('prices.locale === "en" ? "en-US" : "id-ID"');
  expect(page).not.toContain("router.back()");
});
it("catalog image fallback doesn't depend on the stock overlay's DOM position", () => {
  expect(src("components/storefront/ProductCard.tsx")).not.toContain("nextElementSibling");
});
it("Games clears quote errors and keeps AXG proof out of the Pedia namespace", () => {
  for (const file of ["lacak/track-client", "pesanan/[code]/status-client", "[slug]/game-client"]) {
    expect(src(`app/games/${file}.tsx`)).not.toContain("@/lib/pedia/buyer-session");
  }
  expect(src("app/games/[slug]/game-client.tsx")).toMatch(/setQuoteBusy\(true\); setError\(""\);/);
});
it("new not-found rendering and Games missing-slug metadata don't point to the Games homepage", () => {
  expect(existsSync("src/app/not-found.tsx")).toBe(true);
  expect(src("app/games/[slug]/page.tsx")).toMatch(/canonical: null/);
  expect(src("app/games/layout.tsx")).toMatch(/images:/);
  expect(shop("artikel/[slug]/page.tsx")).not.toContain("datePublished: article.published_at ?? undefined");
});
it("profit definition list doesn't put a button between dt/dd and the grouping div", () => {
  const list = src("components/admin/AdminOverview.tsx").match(/<dl[\s\S]*?<\/dl>/g)?.find((part) => part.includes("row.action"));
  expect(list).toBeTruthy();
  expect(list).not.toContain("{content}</Button>");
});
it.each(["layanan", "o/[slug]", "p/[platform]"])("Pedia %s uses the direct catalog reader", (route) => {
  expect(src(`app/pedia/${route}/page.tsx`)).toContain("await loadPublicPediaProducts()");
});
it("Pedia SSR loader short circuits, and buyer utility pages explicitly opt out of indexing", () => {
  expect(src("lib/pedia/public-catalog.ts")).toMatch(/function loadPublicPediaProducts[^\n]+\n\s*if \(process.env.PEDIA_ENABLED !== "true"\) return \[\];/);
  expect(src("app/pedia/lacak/layout.tsx")).toContain("robots: { index: false, follow: false }");
  expect(src("app/pedia/refill/page.tsx")).toContain("robots: { index: false, follow: false }");
});
