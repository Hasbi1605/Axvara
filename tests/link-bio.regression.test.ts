// tests/link-bio.regression.test.ts — Halaman link-in-bio /link (pengganti Linktree).
//
// Kunci: 6 tombol (web, bot Telegram ?start=beli, grup WA, lacak, WA admin,
// Telegram bantuan), ikon brand resmi (tanpa emoji), tombol share (native +
// fallback salin), tanpa chrome global (navbar/footer/bottom-nav/reminder),
// masuk sitemap + skeleton navigasi.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function read(p: string): string {
  return fs.readFileSync(path.join(process.cwd(), p), "utf-8");
}

describe("Halaman /link — tombol link-in-bio", () => {
  it("memuat 6 tujuan: web, bot Telegram, grup WA, lacak, WA admin, Telegram bantuan", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src).toContain('{ href: "/", label: "Katalog Web"');
    expect(src).not.toContain("/#katalog");
    expect(src).toContain("TG_BOT_HREF");
    expect(src).toContain("`https://t.me/${SITE.adminTelegram}?start=beli`");
    expect(src).toContain("WA_GROUP_HREF");
    expect(src).toContain("chat.whatsapp.com/D0GGXwVjJkL3qjxvacDRAP");
    expect(src).toContain('href: "/lacak-pesanan"');
    expect(src).toContain("adminWaLink(");
    expect(src).toContain("supportTelegramLink()");
  });

  it("badge trust: Order Tanpa Login, Bergaransi, Fast Respon", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src).toContain("Order Tanpa Login");
    expect(src).toContain("Bergaransi");
    expect(src).toContain("Fast Respon");
    expect(src).not.toContain("QRIS otomatis");
  });

  it("hierarki tagline dua baris tanpa strip + footer tanpa embel-embel", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src).toContain("Satu gerbang, semua tools premium</p>");
    expect(src).toContain("AI, streaming, desain, dan musik.</p>");
    expect(src).not.toContain("semua tools premium — AI");
    expect(src).toContain("© 2026 {settings.name}</p>");
    expect(src).not.toContain("third-party independen.</p>");
  });

  it("semua 6 pill outline biru glossy tipis seragam (rollback: revert commit ini)", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src).toContain("border-[#00E5FF]/25");
    expect(src).toContain("bg-[#00E5FF]/[0.08]");
    expect(src).toContain("hover:border-[#00E5FF]/50");
    expect(src).toContain('hint: "Semua tools premium"');
    expect(src).not.toContain("checkout QRIS");
  });

  it("label support: Support WhatsApp + Support Telegram (bukan WA Admin)", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src).toContain('label: "Support WhatsApp"');
    expect(src).toContain('label: "Support Telegram"');
    expect(src).not.toContain('label: "WA Admin"');
    expect(src).not.toContain('label: "Telegram Bantuan"');
  });

  it("anti geser kanan mobile: wrapper overflow-x-clip + glow overflow-hidden (tanpa main ganda)", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src).toContain("overflow-x-clip");
    expect(src).toContain("ax-meteors");
    expect(src).toContain("overflow-hidden");
    expect(src).not.toContain("<main");
  });

  it("meteor jatuh tipis: 3 garis GPU-only + mati saat reduced-motion", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src.match(/ax-meteor"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    const css = read("src/app/globals.css");
    expect(css).toContain("@keyframes axMeteor");
    expect(css).toContain(".ax-meteor");
    expect(css).toContain(".ax-meteors { display: none; }");
  });

  it("tanpa emoji di label/hint tombol", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u);
  });

  it("ikon memakai aset solid-circle seragam 6 tombol (bukan emoji/glyph)", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src).toContain("/brand/telegram.svg");
    expect(src).toContain("/brand/whatsapp-circle.svg");
    expect(src).toContain("/brand/support-wa-question.png");
    expect(src).toContain("/brand/support-telegram-question.png");
    expect(src).toContain("/brand/website-circle.png");
    expect(src).toContain("/brand/track-circle.png");
  });

  it("aset ikon solid-circle website + lacak ada di public/brand", () => {
    expect(fs.existsSync(path.join(process.cwd(), "public/brand/website-circle.png"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "public/brand/track-circle.png"))).toBe(true);
  });

  it("aset ikon bantuan question hijau/biru ada di public/brand", () => {
    expect(fs.existsSync(path.join(process.cwd(), "public/brand/support-wa-question.png"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "public/brand/support-telegram-question.png"))).toBe(true);
  });

  it("punya tombol share: native navigator.share + fallback salin tautan", () => {
    const src = read("src/app/link/link-bio-client.tsx");
    expect(src).toContain("navigator");
    expect(src).toContain("share");
    expect(src).toContain("clipboard.writeText");
    expect(src).toContain("Bagikan halaman ini");
    expect(src).toContain("axvara.tech/link");
  });

  it("metadata: judul Link Bio + canonical /link", () => {
    const src = read("src/app/link/page.tsx");
    expect(src).toContain("AXVARA • Link Bio");
    expect(src).toContain('canonical: "/link"');
  });
});

describe("Halaman /link — tanpa chrome global", () => {
  it("navbar, footer, bottom-nav, dan reminder disembunyikan di /link", () => {
    expect(read("src/components/storefront/Navbar.tsx")).toContain('pathname === "/link"');
    expect(read("src/components/storefront/Footer.tsx")).toContain('pathname === "/link"');
    expect(read("src/components/storefront/MobileBottomNav.tsx")).toContain('pathname === "/link"');
    expect(read("src/components/storefront/PendingOrderReminder.tsx")).toContain('"/link"');
  });

  it("/link masuk sitemap dan skeleton navigasi", () => {
    expect(read("src/app/sitemap.ts")).toContain("`${base}/link`");
    expect(read("src/components/storefront/Skeletons.tsx")).toContain('"/link"');
  });
});
