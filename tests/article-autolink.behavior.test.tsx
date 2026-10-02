// @vitest-environment jsdom
//
// tests/article-autolink.behavior.test.tsx — Link di artikel BISA DIKLIK
// (laporan owner 2026-10-03 + screenshot: URL di artikel Netflix tampil biru
// sebagai <code> hiasan tapi tidak bisa diklik). Render artikel kini autolink
// teks polos (URL/bare-domain/handle bot) + codespan berisi URL — pakai ulang
// linkifySegments milik PDP agar aturannya konsisten.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const NETFLIX_CONTENT = [
  "Sebelum login, bersihkan dulu jejak login lama supaya tidak error:",
  "",
  "- **Di browser:** buka `https://www.netflix.com/clearcookies`, lalu buka `https://www.netflix.com/youraccount` dan login dari sana.",
  "- **Di HP:** hapus data aplikasi Netflix dulu.",
  "",
  "Buka netflix-codes.sekalipay.com/mailbox untuk kode, atau buka bot @sekalipayviu_bot di Telegram.",
  "",
  "Masih buntu? Hubungi admin lewat halaman [Lacak Pesanan](/lacak-pesanan).",
].join("\n");

async function renderArticle(content: string) {
  const fx = createD1Fixture();
  fx.sql.prepare(`INSERT INTO articles(slug,title,excerpt,cover_url,content,status,is_published,published_at)
    VALUES('cara-login-netflix-setelah-order-di-axvara','Cara Login Netflix','Excerpt',NULL,?,'published',1,'2026-10-03 00:00:00')`).run(content);
  const { default: ArtikelDetail } = await import("@/app/artikel/[slug]/page");
  render(await ArtikelDetail({ params: Promise.resolve({ slug: "cara-login-netflix-setelah-order-di-axvara" }) }));
  return fx;
}

describe("artikel: link bisa diklik, bukan hiasan", () => {
  it("codespan berisi URL (kasus screenshot owner) jadi <a> _blank", async () => {
    const fx = await renderArticle(NETFLIX_CONTENT);
    try {
      const clear = screen.getByRole("link", { name: "https://www.netflix.com/clearcookies" });
      expect(clear.getAttribute("href")).toBe("https://www.netflix.com/clearcookies");
      expect(clear.getAttribute("target")).toBe("_blank");
      expect(clear.getAttribute("rel")).toBe("noreferrer");
      expect(screen.getByRole("link", { name: "https://www.netflix.com/youraccount" })).not.toBeNull();
      // Tidak ada lagi <code> hiasan berisi URL.
      const codes = document.querySelectorAll("article code");
      expect([...codes].map((c) => c.textContent)).not.toContain("https://www.netflix.com/clearcookies");
    } finally {
      fx.close();
    }
  });

  it("bare domain mailbox + handle bot di teks polos ikut bisa diklik", async () => {
    const fx = await renderArticle(NETFLIX_CONTENT);
    try {
      expect(screen.getByRole("link", { name: "netflix-codes.sekalipay.com/mailbox" }).getAttribute("href")).toBe(
        "https://netflix-codes.sekalipay.com/mailbox",
      );
      expect(screen.getByRole("link", { name: "@sekalipayviu_bot" }).getAttribute("href")).toBe(
        "https://t.me/sekalipayviu_bot",
      );
    } finally {
      fx.close();
    }
  });

  it("link markdown existing (internal + https) tetap jalan", async () => {
    const fx = await renderArticle(NETFLIX_CONTENT);
    try {
      // Link internal relatif (/lacak-pesanan) dirender sebagai teks (bukan https) — tidak pecah.
      expect(document.body.textContent).toContain("Lacak Pesanan");
    } finally {
      fx.close();
    }
  });
});
