import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { excerptFromMarkdown, isSafeMarkdown, slugify } from "@/lib/articles";
import { fetchPublicWebp, parsePublicRemoteImageUrl } from "@/lib/remote-media";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("CMS schema and public media contracts", () => {
  it("keeps ALTER statements in the one-time migration, not the bootstrap schema", () => {
    expect(read("drizzle/schema.sql")).not.toMatch(/ALTER TABLE articles ADD COLUMN/i);
    expect(read("drizzle/migrations/0002_editorial_agent.sql")).toMatch(/ALTER TABLE articles ADD COLUMN status/i);
  });

  it("uses a catch-all public R2 route for nested product/article/banner keys", () => {
    expect(fs.existsSync(path.join(root, "src/app/r2/[...key]/route.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/app/r2/[key]/route.ts"))).toBe(false);
  });
});

describe("Article contracts", () => {
  it("derives stable slugs and readable excerpts", () => {
    expect(slugify("  Tips AI untuk Kuliah! ")).toBe("tips-ai-untuk-kuliah");
    expect(excerptFromMarkdown("## Judul\n\nParagraf pertama yang berguna.")).toBe("Paragraf pertama yang berguna.");
  });

  it("rejects executable markdown/HTML", () => {
    expect(isSafeMarkdown("Paragraf aman dan cukup panjang untuk artikel.")).toBe(true);
    expect(isSafeMarkdown('<img src="x" onerror="alert(1)">')).toBe(false);
    expect(isSafeMarkdown("[klik](javascript:alert(1))")).toBe(false);
  });

  it("admin update route accepts canonical editorial status and synchronizes publication", () => {
    const source = read("src/app/api/articles/[id]/route.ts");
    expect(source).toContain("status:");
    expect(source).toContain("excerptFromMarkdown");
    expect(source).toContain("is_published");
  });

  it("article manager exposes editing existing records", () => {
    const source = read("src/components/admin/ArticlesManager.tsx");
    expect(source).toContain("onEdit");
    expect(source).toContain("Edit");
    expect(source).toContain("/api/articles?id=${editing.id}");
  });

  it("renders Markdown without raw HTML and escapes JSON-LD script text", () => {
    const source = read("src/app/artikel/[slug]/page.tsx");
    expect(source).toContain('token.type === "html"');
    expect(source).toContain('.replace(/</g, "\\\\u003c")');
    expect(source).not.toContain("ReactMarkdown");
  });

  it("uses live categories in the product editor and bypasses public cache in admin", () => {
    const admin = read("src/app/admin/page.tsx");
    const categories = read("src/app/api/categories/route.ts");
    expect(admin).toContain("cats.map");
    expect(admin).toContain("/api/categories?all=1");
    expect(categories).toContain('wantAll ? "private, no-store"');
  });

  it("keeps banner media upload-only in create and update APIs", () => {
    const collection = read("src/app/api/banners/route.ts");
    const item = read("src/app/api/banners/[id]/route.ts");
    expect(collection).toContain('startsWith("/r2/banners/")');
    expect(item).toContain('startsWith("/r2/banners/")');
  });

  it("keeps the empty article state informational without a chat CTA", () => {
    const source = read("src/app/artikel/page.tsx");
    expect(source).toContain("Daftarkan email di footer");
    expect(source).not.toContain(">Chat WA</a>");
  });

  it("stores footer email subscriptions for an authenticated admin view", () => {
    const footer = read("src/components/storefront/Footer.tsx");
    const api = read("src/app/api/subscribers/route.ts");
    const admin = read("src/components/admin/NewsletterSubscribers.tsx");
    expect(footer).toContain('fetch("/api/subscribers"');
    expect(api).toContain("newsletter_subscribers");
    expect(api).toContain("requireAdmin");
    expect(admin).toContain("Pelanggan Email");
  });

  it("keeps category identity stable and renders the stored icon", () => {
    const api = read("src/app/api/categories/route.ts");
    const pills = read("src/components/storefront/CategoryPills.tsx");
    const manager = read("src/components/admin/CategoryManager.tsx");
    expect(api).not.toContain('fields.push("name=?", "slug=?")');
    expect(pills).toContain("categoryIcon(c.slug, c.icon)");
    expect(manager).toContain("CATEGORY_ICON_OPTIONS.map");
  });

  it("preserves the uploaded banner aspect ratio and never crops the popup", () => {
    const uploader = read("src/components/admin/ImageDropzone.tsx");
    const popup = read("src/components/storefront/PopupBanner.tsx");
    expect(uploader).toContain('area === "banners"');
    expect(uploader).toContain("toWebpOriginalRatio");
    expect(popup).toContain("naturalWidth");
    expect(popup).toContain("object-contain");
    expect(popup).not.toContain('aspect-[16/9] object-cover');
  });

  it("does not fetch or render storefront banners inside admin", () => {
    const source = read("src/components/storefront/PopupBanner.tsx");
    expect(source).toContain("usePathname");
    expect(source).toContain('pathname?.startsWith("/admin")');
    expect(source).toContain("if (isAdmin || !isHome)");
  });

  it("limits promotional popups to the homepage so checkout is never obstructed", () => {
    const source = read("src/components/storefront/PopupBanner.tsx");
    expect(source).toContain('const isHome = pathname === "/"');
    expect(source).toContain("isAdmin || !isHome");
  });

  it("leaves the agent name empty and supplies a neutral placeholder", () => {
    const source = read("src/components/admin/AgentIntegration.tsx");
    expect(source).toContain('[name,setName]=useState("")');
    expect(source).toContain('placeholder="Contoh: Agent Konten Harian"');
  });

  it("lets touch users scroll vertically across the orbit", () => {
    const source = read("src/components/storefront/OrbitHero.tsx");
    expect(source).toContain('touchAction: "pan-y"');
    expect(source).toContain('window.matchMedia("(pointer: fine)")');
    expect(source).not.toContain("e.preventDefault()");
  });

  it("shows structured payment-proof states instead of loose warning text", () => {
    const source = read("src/components/admin/ProofThumbnail.tsx");
    expect(source).toContain("Belum ada bukti");
    expect(source).toContain("File bukti tidak tersedia");
    expect(source).toContain('role="dialog"');
  });
});

describe("Agent and MCP contracts", () => {
  it("derives the author from the authenticated token instead of request input", () => {
    const source = read("src/app/api/agent/articles/route.ts");
    expect(source).not.toMatch(/agent_name\s*:/);
    expect(source).toContain("auth.token.name");
  });

  it("exposes base64 and URL media upload in MCP and configures the custom domain", () => {
    const worker = read("mcp-worker/src/index.ts");
    const pagesRoute = read("src/app/mcp/route.ts");
    const config = read("mcp-worker/wrangler.toml");
    const importRoute = read("src/app/api/agent/media/import/route.ts");
    expect(worker).toContain("upload_article_image");
    expect(pagesRoute).toContain("upload_article_image");
    expect(worker).toContain("import_article_image_from_url");
    expect(pagesRoute).toContain("import_article_image_from_url");
    expect(importRoute).toContain('requireAgent(request, "media:write")');
    expect(importRoute).toContain("fetchPublicWebp");
    expect(pagesRoute).toContain("new URL(request.url).origin");
    expect(config).toContain("workers_dev = true");
    expect(config).toContain('AXVARA_API_ORIGIN = "https://axvara.tech"');
  });

  it("accepts only public HTTPS hostnames for remote media", () => {
    expect(parsePublicRemoteImageUrl("https://cdn.vendor.com/cover.webp").hostname).toBe("cdn.vendor.com");
    for (const url of [
      "http://cdn.vendor.com/cover.webp",
      "https://localhost/cover.webp",
      "https://127.0.0.1/cover.webp",
      "https://[::1]/cover.webp",
      "https://admin:secret@cdn.vendor.com/cover.webp",
      "https://cdn.vendor.com:8443/cover.webp",
      "https://metadata.internal/cover.webp",
    ]) {
      expect(() => parsePublicRemoteImageUrl(url)).toThrow("URL HTTPS publik");
    }
  });

  it("validates fetched WebP bytes and blocks redirects to local hosts", async () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    ]);
    const bytes = await fetchPublicWebp(
      "https://cdn.vendor.com/cover.webp",
      async () => new Response(webp, { headers: { "content-type": "image/webp" } }),
    );
    expect(bytes).toEqual(webp);

    await expect(fetchPublicWebp(
      "https://cdn.vendor.com/redirect.webp",
      async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }),
    )).rejects.toThrow("URL HTTPS publik");
  });

  it("ships exactly 20 idempotent draft fixtures", () => {
    const seed = read("drizzle/seed-articles.local.sql");
    expect((seed.match(/^\('/gm) ?? [])).toHaveLength(20);
    expect(seed).toContain("INSERT OR IGNORE");
    expect(seed).not.toMatch(/'published'/);
  });
});
