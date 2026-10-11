// tests/pedia-launch.test.ts — PEDIA M6: LaunchCards + AppSwitcher + /link + footer + digest.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("integrasi pusat M6 (PD-60–64)", () => {
  it("PD-60: Market promotes Pedia alongside its Telegram order channel", () => {
    const home = read("src/app/(shop)/home-client.tsx");
    expect(home).toContain("CommunityBar");
    expect(home).not.toContain("LaunchCards");
    const community = read("src/components/storefront/CommunityBar.tsx");
    expect(community).toContain('<CrossServicePromo current="market"');
    expect(community).toContain("Kanal order Market");
    expect(community).not.toContain("Grup WhatsApp");
    // Komponen tersimpan utuh, tidak diimpor siapa pun.
    const cards = read("src/components/storefront/LaunchCards.saved.tsx");
    expect(cards).toContain("Axvara Pedia");
    expect(cards).toContain("Axvara AI");
    expect(cards).toContain("utm_source=axvara");
    expect(cards).toContain("aria-label");
    expect(cards).toContain("aria-hidden");
  });

  it("PD-61: both navbars use the same live-services menu, without AI pills", () => {
    const nav = read("src/components/storefront/Navbar.tsx");
    expect(nav).not.toContain("<AppSwitcher");
    expect(nav).toContain('<ServicesMenu active="market"');
    const pediaNav = read("src/components/pedia/PediaNavbar.tsx");
    expect(pediaNav).toContain('active="pedia"');
    expect(pediaNav).toContain("ServicesMenu");
    expect(pediaNav).not.toContain("AppSwitcher");
    const menu = read("src/components/shared/ServicesMenu.tsx");
    expect(menu).toContain("AXVARA_SERVICES");
    expect(menu).not.toContain("Segera");
    expect(menu).not.toContain("slice(0, 2)");
  });

  it("Lockup Pedia konsisten dengan navbar pusat (tanpa |, ukuran sama)", () => {
    const pediaNav = read("src/components/pedia/PediaNavbar.tsx");
    const shopNav = read("src/components/storefront/Navbar.tsx");
    // Lockup gabung tanpa pemisah.
    expect(pediaNav).toContain("AXVARA PEDIA");
    expect(pediaNav).not.toContain("bg-white/40");
    expect(pediaNav).not.toMatch(/AXVARA\s*<span/);
    // Ukuran disamakan dengan navbar pusat: 64px, container 1280, mark 36x32,
    // font-display 22px tracking 0.16em.
    expect(pediaNav).toContain("h-[64px]");
    expect(pediaNav).toContain("max-w-[1280px]");
    expect(pediaNav).toContain("border-b border-white/10");
    expect(pediaNav).toContain("w-[36px]");
    expect(pediaNav).toContain("font-display");
    expect(pediaNav).toContain("text-[22px]");
    expect(pediaNav).toContain("tracking-[0.16em]");
    expect(shopNav).toContain("h-[64px]");
    expect(shopNav).toContain("max-w-[1280px]");
  });

  it("Navbar Pedia: compact mobile brand, unclipped menu and desktop tracking", () => {
    const nav = read("src/components/pedia/PediaNavbar.tsx");
    // Mobile: "PEDIA" saja (tanpa AXVARA); desktop tetap "AXVARA PEDIA".
    expect(nav).toContain("md:hidden");
    expect(nav).toContain("PEDIA");
    expect(nav).toContain("AXVARA PEDIA");
    expect(nav).not.toContain("overflow-hidden");
    expect(nav).not.toContain("overflowX");
    expect(nav).toContain("min-w-0");
    expect(nav).toContain("/pedia/lacak");
    expect(nav).toContain("hidden items-center");
  });

  it("Bottom bar Pedia konsisten dengan pusat (ikon + cyan + titik aktif)", () => {
    const bottom = read("src/components/pedia/PediaBottomNav.tsx");
    // Ikon sama dengan pusat: home/category/purchase-order/chat.
    expect(bottom).toContain("IosIcon");
    expect(bottom).toContain('"home"');
    expect(bottom).toContain('"category"');
    expect(bottom).toContain('"purchase-order"');
    expect(bottom).toContain('"chat"');
    // Aktif = cyan + titik, shell sama (backdrop-blur + border-t + shadow).
    expect(bottom).toContain("text-[#00E5FF]");
    expect(bottom).toContain("bg-[#00E5FF]");
    expect(bottom).toContain("backdrop-blur-xl");
    expect(bottom).toContain("active:scale-95");
    expect(bottom).toContain("shadow-[0_-8px_24px_rgba(0,0,0,0.6)]");
    // Tanpa indikator violet lama.
    expect(bottom).not.toContain("px-violet");
  });

  it("Mark Pedia = SVG trace Muse (kanvas padat, bukan PNG berpadding)", () => {
    const pediaNav = read("src/components/pedia/PediaNavbar.tsx");
    // SVG kanvas padat (tanpa padding transparan 30px PNG) → tampil penuh.
    expect(pediaNav).toContain("/brand/pedia-mark.svg");
    expect(pediaNav).not.toContain("pedia-mark-white.png");
    const link = read("src/app/(shop)/link/link-bio-client.tsx");
    expect(link).toContain("/brand/pedia-circle.svg");
    expect(link).not.toContain("pedia-mark-white.png");
    const svg = read("public/brand/pedia-mark.svg");
    expect(svg).toContain('viewBox="0 0 144 128"');
    expect(svg).toContain('fill="currentColor"');
  });

  it("Pedia uses the shared footer once + platform headers retain native icons", () => {
    const layout = read("src/app/pedia/layout.tsx");
    expect(layout).toContain('<Footer />');
    expect(layout).not.toContain("<footer");
    expect(layout).not.toContain("Axvara Pedia</span> · Naikkan");
    const plat = read("src/app/pedia/p/[platform]/platform-client.tsx");
    expect(plat).toContain("PlatformIcon");
    expect(plat).not.toContain("name.slice(0, 2)");
  });

  it("Focus ring Pedia biru Axvara satu outline luar (tanpa outline ganda)", () => {
    const hero = read("src/components/pedia/LinkPasteHero.tsx");
    // Ring dikunci via state fokus React + fallback :focus-within
    // (dua-duanya di CONTAINER yang sama = tetap satu garis): container
    // SATU ring biru, input TANPA ring.
    expect(hero).toContain("onFocus");
    expect(hero).toContain("onBlur");
    expect(hero).toContain("pedia-link-box:focus-within");
    expect(hero).toContain('borderColor: "#00E5FF"');
    expect(hero).toContain("rgba(0,229,255,.35)");
    expect(hero).toContain("focus:outline-none");
    expect(hero).not.toContain("139,92,246");
  });

  it("PD-62: kartu Pedia DISEMBUNYIKAN dari /link (2026-10-08 owner) + footer Jelajah + digest flag", () => {
    const link = read("src/app/(shop)/link/link-bio-client.tsx");
    // Kartu disembunyikan tapi kode DISIMPAN (1 baris comment siap kembalikan).
    // Comment diawali "// " sehingga tak ikut render — asersi kode aktif:
    expect(link).not.toMatch(/^\s*\{ href: "\/pedia/m);
    expect(link).toContain("kartu Pedia DISEMBUNYIKAN");
    expect(link).toContain("utm_medium=link_bio");
    const footer = read("src/components/storefront/Footer.tsx");
    expect(footer).toContain("AXVARA Pedia");
    expect(footer).toContain("utm_medium=footer");
    const digest = read("src/lib/telegram/promo-digest.ts");
    expect(digest).toContain("PEDIA_PROMO_DIGEST_ENABLED");
    expect(digest).toContain("pedia.axvara.tech");
  });

  it("PD-64: link WA & Telegram tetap ada (HelpSheet + footer, tidak hilang)", () => {
    const footer = read("src/components/storefront/Footer.tsx");
    // 2026-10-10: footer WA lewat hub /wa (waHubLink), bukan string "whatsapp".
    expect(footer).toContain("waHubLink(");
    const link = read("src/app/(shop)/link/link-bio-client.tsx");
    expect(link).toContain("Bot Telegram");
    expect(link).toContain("Grup WhatsApp");
  });

  it("AC-08: reduced-motion mematikan animasi promo", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".ax-launch::before");
  });
});
