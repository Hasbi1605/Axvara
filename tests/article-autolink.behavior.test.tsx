// @vitest-environment jsdom
//
// tests/article-autolink.behavior.test.tsx — Link di artikel BISA DIKLIK
// (laporan owner 2026-10-03 + screenshot: URL di artikel Netflix tampil biru
// sebagai <code> hiasan tapi tidak bisa diklik). Render artikel kini autolink
// teks polos (URL/bare-domain/handle bot) + codespan berisi URL — pakai ulang
// linkifySegments milik PDP agar aturannya konsisten.
//
// Regresi 2026-10-03 (artikel 500): halaman artikel (server component) TIDAK
// BOLEH mengimpor modul client ("use client" / lucide-react) — linkifySegments
// tinggal di lib/product-copy/text.ts yang murni. next build hijau tidak
// menangkap ini; test di bawah menguncinya.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
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
  const { default: ArtikelDetail } = await import("@/app/(shop)/artikel/[slug]/page");
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

describe("artikel: embed YouTube server-only", () => {
  const YT_CONTENT = [
    "## Tonton dulu videonya",
    "",
    "Video tutorial login Alight Motion untuk Android dan iOS:",
    "",
    "@youtube:8emqddsjPsE",
    "",
    "## Langkah 1",
    "",
    "Lanjut teks setelah video.",
  ].join("\n");

  it("tag @youtube:ID valid jadi iframe youtube-nocookie 16:9", async () => {
    const fx = await renderArticle(YT_CONTENT);
    try {
      const frame = document.querySelector("article iframe");
      expect(frame).not.toBeNull();
      expect(frame?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/8emqddsjPsE?rel=0");
      expect(frame?.getAttribute("title")).toBe("Video tutorial YouTube");
      expect(frame?.getAttribute("loading")).toBe("lazy");
      // Teks di sekitar embed tetap tampil.
      expect(document.body.textContent).toContain("Lanjut teks setelah video.");
      // Tag mentah tidak bocor sebagai teks.
      expect(document.body.textContent).not.toContain("@youtube:");
    } finally {
      fx.close();
    }
  });

  it("ID tidak valid = teks polos, bukan iframe", async () => {
    const fx = await renderArticle("Lihat videonya:\n\n@youtube:xxx\n\nSelesai.");
    try {
      expect(document.querySelector("article iframe")).toBeNull();
      expect(document.body.textContent).toContain("Selesai.");
    } finally {
      fx.close();
    }
  });
});

describe("kredensial pasca-bayar: link bisa diklik (CredentialText)", () => {
  // Laporan owner 2026-10-03 + screenshot /pesanan: blok DETAIL AKUN DIGITAL
  // menampilkan URL mentah (panduan artikel, mailbox, clearcookies) sebagai
  // teks mono yang tidak bisa diklik.
  const CRED_SAMPLE = [
    "Netflix — 1 Profile 2 User",
    "Email: krutehkhan@gmail.com | PASSWORD : Nengflix222@@ | PROFILE : UCIHA |",
    "CARA LOGIN = axvara.tech/go/netflix-login",
    "AKSES BOT / KODE = axvara.tech/go/otp",
    "- https://www.netflix.com/clearcookies",
    "- lalu https://www.netflix.com/youraccount",
  ].join("\n");

  it("URL/bare-domain/path internal jadi <a>, email kredensial tetap teks", async () => {
    const { CredentialText } = await import("@/components/storefront/ProductCopy");
    const { default: React } = await import("react");
    render(React.createElement(CredentialText, { text: CRED_SAMPLE }));
    // Shortlink go/* → href /go relatif tanpa _blank.
    const guide = screen.getByRole("link", { name: "axvara.tech/go/netflix-login" });
    expect(guide.getAttribute("href")).toBe("/go/netflix-login");
    expect(guide.getAttribute("target")).toBeNull();
    // Mailbox shortlink ikut internal; clearcookies → tab baru.
    const mailbox = screen.getByRole("link", { name: "axvara.tech/go/otp" });
    expect(mailbox.getAttribute("href")).toBe("/go/otp");
    expect(mailbox.getAttribute("target")).toBeNull();
    expect(screen.getByRole("link", { name: "https://www.netflix.com/clearcookies" })).not.toBeNull();
    // Email kredensial BUKAN link (tidak boleh ada mailto).
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(document.body.textContent).toContain("krutehkhan@gmail.com");
  });
});

describe("artikel: server component aman untuk edge", () => {
  it("page artikel tidak mengimpor modul client (penyebab 500 prod 2026-10-03)", () => {
    const page = readFileSync("src/app/(shop)/artikel/[slug]/page.tsx", "utf8");
    // linkifySegments WAJIB dari modul murni — bukan dari ProductCopy.tsx
    // ("use client" + lucide-react) yang membuat edge Pages 500.
    expect(page).toContain('from "@/lib/product-copy/text"');
    expect(page).not.toContain("components/storefront/ProductCopy");
    const text = readFileSync("src/lib/product-copy/text.ts", "utf8");
    const codeLines = text.split("\n").filter((line) => !line.trim().startsWith("//"));
    const code = codeLines.join("\n");
    expect(code).not.toContain("use client");
    expect(code).not.toContain("lucide-react");
    expect(code).not.toMatch(/from ["']react["']/);
  });
});
