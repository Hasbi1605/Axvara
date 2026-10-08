// tests/pedia-launch.test.ts — PEDIA M6: LaunchCards + AppSwitcher + /link + footer + digest.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("integrasi pusat M6 (PD-60–64)", () => {
  it("PD-60: DISIMPAN 2026-10-08 — beranda kembali ke CommunityBar (Telegram + Grup WA); LaunchCards.saved.tsx menunggu owner", () => {
    const home = read("src/app/(shop)/home-client.tsx");
    expect(home).toContain("CommunityBar");
    expect(home).not.toContain("LaunchCards");
    // Komponen tersimpan utuh, tidak diimpor siapa pun.
    const cards = read("src/components/storefront/LaunchCards.saved.tsx");
    expect(cards).toContain("Axvara Pedia");
    expect(cards).toContain("Axvara AI");
    expect(cards).toContain("utm_source=axvara");
    expect(cards).toContain("aria-label");
    expect(cards).toContain("aria-hidden");
  });

  it("PD-61: 3 pill DISIMPAN 2026-10-08 — navbar toko tanpa AppSwitcher; navbar Pedia tetap ada", () => {
    const nav = read("src/components/storefront/Navbar.tsx");
    // Pill disembunyikan tapi komponen TIDAK dihapus (impor dikembalikan
    // saat owner memutuskan memunculkan).
    expect(nav).not.toContain("<AppSwitcher");
    expect(nav).toContain("AppSwitcher DISIMPAN");
    const pediaNav = read("src/components/pedia/PediaNavbar.tsx");
    expect(pediaNav).toContain('active="pedia"');
    const switcher = read("src/components/pedia/AppSwitcher.tsx");
    // Cross-host absolut (fix pill tidak bisa pindah halaman).
    expect(switcher).toContain("https://axvara.tech/");
    expect(switcher).toContain("https://pedia.axvara.tech/pedia");
    expect(switcher).toContain("Segera");
    // 2026-10-08: tanpa highlight — tab aktif teks putih biasa, tanpa pill.
    expect(switcher).not.toContain("bg-[var(--px-violet-soft)]");
    expect(switcher).not.toContain('aria-current={on');
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

  it("Navbar mobile Pedia: lockup PEDIA saja + anti-geser + tanpa pill Lacak", () => {
    const nav = read("src/components/pedia/PediaNavbar.tsx");
    // Mobile: "PEDIA" saja (tanpa AXVARA); desktop tetap "AXVARA PEDIA".
    expect(nav).toContain("md:hidden");
    expect(nav).toContain("PEDIA");
    expect(nav).toContain("AXVARA PEDIA");
    // Anti-geser horizontal: header overflow-hidden + min-w-0.
    expect(nav).toContain("overflow-hidden");
    expect(nav).toContain("min-w-0");
    // Pill Lacak dihapus (lacak = tab Pesanan bottom bar).
    expect(nav).not.toContain("/pedia/lacak");
    expect(nav).not.toContain('"Lacak"');
    expect(nav).not.toContain(">Lacak<");
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

  it("Footer Pedia = footer market (konsisten) + header platform ikon asli", () => {
    const layout = read("src/app/pedia/layout.tsx");
    expect(layout).toContain('Footer shopBase="https://axvara.tech"');
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
    expect(footer).toContain("Axvara Pedia");
    expect(footer).toContain("utm_medium=footer");
    const digest = read("src/lib/telegram/promo-digest.ts");
    expect(digest).toContain("PEDIA_PROMO_DIGEST_ENABLED");
    expect(digest).toContain("pedia.axvara.tech");
  });

  it("PD-64: link WA & Telegram tetap ada (HelpSheet + footer, tidak hilang)", () => {
    const footer = read("src/components/storefront/Footer.tsx");
    expect(footer).toContain("whatsapp");
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
