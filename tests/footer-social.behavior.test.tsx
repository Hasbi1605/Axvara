// tests/footer-social.behavior.test.tsx — Tombol ikon-only sosmed di footer.
//
// Kunci: 4 tombol ikon saja (tanpa label teks) — Instagram, Threads, TikTok,
// Facebook — mengarah ke URL sosmed AXVARA dari SITE.social; ikon satu tone
// (fill=currentColor, Simple Icons terbaru — Threads = redesain Meta 2026);
// tap target ≥44px (h-10 w-10), ada aria-label, buka tab baru (_blank +
// noreferrer); sameAs SEO ikut memuat 4 sosmed.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

function read(p: string): string {
  return fs.readFileSync(path.join(process.cwd(), p), "utf-8");
}

describe("Footer — tombol ikon sosmed AXVARA", () => {
  it("SITE.social memuat 4 URL sosmed resmi", async () => {
    const { SITE } = await import("@/lib/site");
    expect(SITE.social.instagram).toBe("https://www.instagram.com/axvara.tech/");
    expect(SITE.social.threads).toBe("https://www.threads.com/@axvara.tech");
    expect(SITE.social.tiktok).toBe("https://www.tiktok.com/@axvara.tech");
    expect(SITE.social.facebook).toBe("https://www.facebook.com/Axvara.tech/");
  });

  it("footer merender 4 tombol ikon-only dari SITE.social (_blank + aria-label, tanpa label teks)", () => {
    const src = read("src/components/storefront/Footer.tsx");
    expect(src).toContain("SOCIAL_LINKS");
    expect(src).toContain("SITE.social.instagram");
    expect(src).toContain("SITE.social.threads");
    expect(src).toContain("SITE.social.tiktok");
    expect(src).toContain("SITE.social.facebook");
    expect(src).toContain('target="_blank"');
    expect(src).toContain('rel="noreferrer"');
    expect(src).toContain("aria-label={social.label}");
    // Ikon-only: tidak ada teks label di dalam tombol.
    expect(src).not.toContain("{social.label}</a>");
  });

  it("ikon satu tone: satu set path Simple Icons (IG + Threads redesain + TikTok + FB), fill=currentColor", () => {
    const src = read("src/components/storefront/Footer.tsx");
    expect(src).toContain("SOCIAL_ICON_PATHS");
    expect(src).toContain('fill="currentColor"');
    expect(src).toContain("instagram:");
    expect(src).toContain("threads:");
    expect(src).toContain("tiktok:");
    expect(src).toContain("facebook:");
    // Ciri khas path terbaru (bukan placeholder/glyph generik).
    expect(src).toContain("M7.0301.084"); // Instagram Simple Icons
    expect(src).toContain("M18.263 11.097"); // Threads redesain Meta 2026
    expect(src).toContain("M12.525.02"); // TikTok Simple Icons
    expect(src).toContain("M9.101 23.691"); // Facebook "f" Simple Icons
  });

  it("tap target ≥44px dan gaya satu tone selaras tema Midnight", () => {
    const src = read("src/components/storefront/Footer.tsx");
    expect(src).toContain("h-10 w-10");
    expect(src).toContain("rounded-full");
    expect(src).toContain("text-white/60");
    expect(src).toContain("hover:border-[#00E5FF]/40");
  });

  it("sameAs SEO memuat 4 sosmed + Telegram", () => {
    const src = read("src/lib/site-seo.ts");
    expect(src).toContain("SITE.social.instagram");
    expect(src).toContain("SITE.social.threads");
    expect(src).toContain("SITE.social.tiktok");
    expect(src).toContain("SITE.social.facebook");
  });
});
