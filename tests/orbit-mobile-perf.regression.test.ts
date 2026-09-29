import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regresi 2026-09-29 (laporan owner: HP lag di area orbit):
// hot path animasi OrbitHero WAJIB compositor-only (transform + opacity).
// Properti repaint (filter/blur/backdrop-filter per frame, display toggle,
// drop-shadow SVG per frame) membuat GPU HP kentang repaint tiap frame.
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("orbit mobile hemat: hot path GPU-only", () => {
  it("updatePositions tidak menulis filter/blur/backdrop/display per frame", () => {
    const src = read("src/components/storefront/OrbitHero.tsx");
    const body = src.slice(src.indexOf("const updatePositions"), src.indexOf("}, []);", src.indexOf("const updatePositions")));
    expect(body).not.toContain(".style.filter");
    expect(body).not.toContain("backdropFilter");
    expect(body).not.toContain(".style.display");
    expect(body).not.toContain("drop-shadow");
    // Yang boleh: transform + opacity + zIndex (murah).
    expect(body).toContain(".style.transform");
    expect(body).toContain(".style.opacity");
  });

  it("mobile menyembunyikan dekorasi mahal (trail SVG, label, shadow, star dust)", () => {
    const src = read("src/components/storefront/OrbitHero.tsx");
    // Trail SVG + star dust: desktop only.
    expect(src).toContain("pointer-events-none hidden sm:block");
    // Label: statis + desktop only (tanpa backdrop-blur per frame).
    expect(src).toContain("hidden sm:inline-block");
    expect(src).not.toContain('backdropFilter = isFront');
    // Shadow statis: tidak di-toggle per frame.
    expect(src).not.toContain('style.display = isFront');
  });

  it("mode hemat mobile: planet dirampingkan + frame budget dilonggarkan", () => {
    const src = read("src/components/storefront/OrbitHero.tsx");
    expect(src).toContain("liteRef");
    expect(src).toContain("liteCountRef.current = 8");
    expect(src).toContain("frameBudget");
    // Scroll tetap native di layar sentuh (tidak pernah preventDefault).
    expect(src).toContain('touchAction: "pan-y"');
    expect(src).not.toContain("e.preventDefault()");
  });

  it("glow hero di-hemat di mobile (blur raksasa = repaint termahal kedua)", () => {
    const src = read("src/app/home-client.tsx");
    expect(src).toContain("blur-[44px] sm:blur-[80px]");
    expect(src).toContain("hidden sm:block");
  });
});
