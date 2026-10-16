import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Orbit Pedia (2026-10-12, permintaan owner): kembar OrbitHero Market —
// mesin animasi 1:1 (refs + rAF, compositor-only), planet = 8 sosmed Pedia,
// inti = mark AXVARA Pedia. Regresi performa yang sama berlaku.
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("PediaOrbit: kembar OrbitHero untuk sosmed", () => {
  it("planet tersebar merata sejak frame pertama (offset tiap ring di-stagger)", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    // Bukan ringIdx*18 (menumpuk planet di satu sisi) — tiap ring punya fase sendiri.
    expect(src).toContain("RING_PHASE");
    expect(src).not.toContain("(360 / ring.count) * i + ringIdx * 18");
  });

  it("planet = paket ikon yang sama dengan Market + tersebar tanpa ring kosong", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    // YouTube + Spotify memakai badge resmi /icons/*.svg (sama dengan Market),
    // sisanya glyph asli /icons/platforms/ (tak ada di /icons/).
    expect(src).toContain('icon: "/icons/youtube.svg"');
    expect(src).toContain('icon: "/icons/spotify.svg"');
    for (const id of ["instagram", "tiktok", "facebook", "threads", "shopee", "x"]) {
      expect(src).toContain(`/icons/platforms/${id}.svg`);
    }
    // ring 3 (outer) wajib ada isinya — jangan count: 0.
    expect(src).not.toMatch(/\{ r: 182, speed: [\d.]+, count: 0 \}/);
  });

  it("inti = mark AXVARA Pedia (bukan prism Market)", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    // Mark trace Pedia via <img> + filter putih (pola PediaNavbar) + label PEDIA.
    expect(src).toContain("/brand/pedia-mark.svg");
    expect(src).toContain("brightness-0 invert");
    expect(src).toContain(">PEDIA<");
    expect(src).toContain('aria-label="AXVARA Pedia"');
    // Prism Market (path segitiga inline) tidak dipakai lagi.
    expect(src).not.toContain("M60 4 L6.5 104 L113.5 104 Z");
    expect(src).not.toContain(">AXVARA<");
    // Hero Pedia memasang orbit di grid kanan ala Market.
    const home = read("src/app/pedia/home-client.tsx");
    expect(home).toContain("<PediaOrbit />");
    expect(home).toContain("lg:grid-cols-[minmax(0,1fr)_auto]");
  });

  it("planet sama persis resep Market (sphere 38/42 + ikon 22/24 + gloss + tint)", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    // Ukuran sphere + ikon + gloss + tint brand + border/shadow Market.
    expect(src).toContain("w-[38px] h-[38px] sm:w-[42px] sm:h-[42px]");
    expect(src).toContain("w-[22px] h-[22px] sm:w-[24px] sm:h-[24px] object-contain");
    expect(src).toContain("radial-gradient(ellipse 70% 60% at 50% 55%");
    expect(src).toContain("radial-gradient(ellipse 60% 55% at 50% 48%");
    expect(src).toContain("drop-shadow(0 1px 2px rgba(0,0,0,0.22))");
    expect(src).not.toContain("w-[34px] h-[34px] sm:w-[38px] sm:h-[38px]");
  });

  it("logo putih (Threads/X) memakai sphere gelap agar terlihat", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    expect(src).toContain("dark?: boolean");
    expect(src).toContain("rgba(35,40,66,0.96), rgba(18,22,46,0.96)");
  });

  it("hot path compositor-only seperti OrbitHero (tanpa filter/blur/display per frame)", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    const body = src.slice(src.indexOf("const updatePositions"), src.indexOf("}, []);", src.indexOf("const updatePositions")));
    expect(body).not.toContain(".style.filter");
    expect(body).not.toContain("backdropFilter");
    expect(body).not.toContain(".style.display");
    expect(body).not.toContain("drop-shadow");
    expect(body).toContain(".style.transform");
    expect(body).toContain(".style.opacity");
  });

  it("mode hemat mobile + LCP + reduced-motion + scroll native seperti Market", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    expect(src).toContain("liteRef");
    // 2026-10-12 (owner): mobile tampil SEMUA planet seperti Market
    // (8 planet Pedia, bukan 4 — pembatas indeks mobile dihapus).
    expect(src).toContain("liteCountRef.current = placements.length");
    expect(src).not.toContain("pi >= 4");
    expect(src).toContain("frameBudget");
    expect(src).toContain("deferForLcp");
    expect(src).toContain("requestIdleCallback");
    expect(src).toContain("prefers-reduced-motion");
    expect(src).toContain('touchAction: "pan-y"');
    expect(src).not.toContain("e.preventDefault()");
    // Trail/label/shadow/star-dust desktop-only.
    expect(src).toContain("pointer-events-none hidden sm:block");
    expect(src).toContain("hidden sm:inline-block");
  });
});
