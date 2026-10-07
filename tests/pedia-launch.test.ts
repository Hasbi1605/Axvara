// tests/pedia-launch.test.ts — PEDIA M6: LaunchCards + AppSwitcher + /link + footer + digest.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("integrasi pusat M6 (PD-60–64)", () => {
  it("PD-60: LaunchCards menggantikan CommunityBar di home-client", () => {
    const home = read("src/app/(shop)/home-client.tsx");
    expect(home).toContain("LaunchCards");
    expect(home).not.toContain("CommunityBar");
    const cards = read("src/components/storefront/LaunchCards.tsx");
    expect(cards).toContain("Axvara Pedia");
    expect(cards).toContain("Axvara AI");
    expect(cards).toContain("utm_source=axvara");
    expect(cards).toContain("aria-label");
    expect(cards).toContain("aria-hidden");
  });

  it("PD-61: AppSwitcher di navbar toko (Apps aktif) + navbar Pedia", () => {
    const nav = read("src/components/storefront/Navbar.tsx");
    expect(nav).toContain("AppSwitcher");
    expect(nav).toContain('active="apps"');
    const pediaNav = read("src/components/pedia/PediaNavbar.tsx");
    expect(pediaNav).toContain('active="pedia"');
    const switcher = read("src/components/pedia/AppSwitcher.tsx");
    expect(switcher).toContain("Segera");
    expect(switcher).toContain("aria-current");
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
