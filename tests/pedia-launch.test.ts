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

  it("Footer Pedia = footer market (konsisten) + header platform ikon asli", () => {
    const layout = read("src/app/pedia/layout.tsx");
    expect(layout).toContain('Footer shopBase="https://axvara.tech"');
    expect(layout).not.toContain("Axvara Pedia</span> · Naikkan");
    const plat = read("src/app/pedia/p/[platform]/platform-client.tsx");
    expect(plat).toContain("PlatformIcon");
    expect(plat).not.toContain("name.slice(0, 2)");
  });

  it("Focus ring Pedia violet halus (tanpa kotak biru global)", () => {
    const hero = read("src/components/pedia/LinkPasteHero.tsx");
    expect(hero).toContain("pedia-link-input:focus-visible");
    expect(hero).toContain("rgba(139,92,246,.35)");
  });

  it("PD-62: tombol Pedia kedua di /link + footer Jelajah + digest flag", () => {
    const link = read("src/app/(shop)/link/link-bio-client.tsx");
    expect(link).toContain("Axvara Pedia");
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
