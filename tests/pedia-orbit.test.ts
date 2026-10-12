import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Orbit Pedia (2026-10-12, permintaan owner): kembar OrbitHero Market —
// mesin animasi 1:1 (refs + rAF, compositor-only), planet = 8 sosmed Pedia,
// inti = prism AXVARA Market. Regresi performa yang sama berlaku.
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("PediaOrbit: kembar OrbitHero untuk sosmed", () => {
  it("memakai 8 ikon platform Pedia", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    for (const id of ["instagram", "tiktok", "youtube", "facebook", "threads", "spotify", "shopee", "x"]) {
      expect(src).toContain(`/icons/platforms/${id}.svg`);
    }
  });

  it("planet tersebar ke ring luar (tidak ada ring kosong) + inti prism AXVARA", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    // ring 3 (outer) wajib ada isinya — jangan count: 0.
    expect(src).not.toMatch(/\{ r: 182, speed: [\d.]+, count: 0 \}/);
    // Inti = prism Market: path segitiga + label AXVARA.
    expect(src).toContain("M60 4 L6.5 104 L113.5 104 Z");
    expect(src).toContain(">AXVARA<");
    expect(src).not.toContain("pedia-mark");
    // Hero Pedia memasang orbit di grid kanan ala Market.
    const home = read("src/app/pedia/home-client.tsx");
    expect(home).toContain("<PediaOrbit />");
    expect(home).toContain("lg:grid-cols-[1fr_auto]");
  });

  it("logo putih (Threads/X) memakai sphere gelap agar terlihat", () => {
    const src = read("src/components/pedia/PediaOrbit.tsx");
    expect(src).toContain("dark?: boolean");
    expect(src).toContain("linear-gradient(180deg, #232842, #12162e)");
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
    expect(src).toContain("liteCountRef.current = 5");
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
