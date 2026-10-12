"use client";
import { useEffect, useRef, useCallback } from "react";

type OrbitItem = {
  label: string;
  icon: string;
  color: string;
  ring: number; // 0..2
  dark?: boolean; // logo putih (Threads/X) → sphere gelap agar terlihat
};

// Planet = 8 platform sosmed Pedia (7 ikon unik + Instagram ganda agar
// ring 0 & 3 terisi seimbang). Logo asli tiap brand diambil dari paket yang
// SAMA dengan Market (/icons/*.svg — badge resmi tiap brand, bukan glyph
// Simple Icons generik /icons/platforms/ yang untuk filter). Pengecualian
// (tak ada di /icons/): instagram/tiktok/facebook/threads/shopee/x tetap
// memakai glyph /icons/platforms/ (logo asli brand, bukan generik).
const ITEMS: OrbitItem[] = [
  // ring 0 - inner (1 planet agar inti tidak sesak)
  { label: "TikTok", icon: "/icons/platforms/tiktok.svg", color: "#FE2C55", ring: 0 },
  // ring 1
  { label: "YouTube", icon: "/icons/youtube.svg", color: "#FF0000", ring: 1 },
  { label: "Facebook", icon: "/icons/platforms/facebook.svg", color: "#1877F2", ring: 1 },
  { label: "Threads", icon: "/icons/platforms/threads.svg", color: "#FFFFFF", ring: 1, dark: true },
  // ring 2
  { label: "Spotify", icon: "/icons/spotify.svg", color: "#1DB954", ring: 2 },
  { label: "Shopee", icon: "/icons/platforms/shopee.svg", color: "#EE4D2D", ring: 2 },
  // ring 3 - outer (2 planet agar ring luar tidak kosong)
  { label: "X", icon: "/icons/platforms/x.svg", color: "#FFFFFF", ring: 3, dark: true },
  { label: "Instagram", icon: "/icons/platforms/instagram.svg", color: "#D62976", ring: 3 },
];

const RINGS = [
  { r: 68, speed: 1.15, count: 1 },
  { r: 104, speed: 0.85, count: 3 },
  { r: 142, speed: 0.62, count: 2 },
  { r: 182, speed: 0.42, count: 2 },
];

const ELLIPSE = 0.38; // flatten factor for 62deg tilt

// Pre-compute placements (static — no React state needed).
// Offset tiap ring di-stagger (bukan ringIdx*18 yang menumpuk 3 planet di
// satu sisi) agar planet tersebar merata sejak frame pertama.
const RING_PHASE = [200, 20, 140, 320];
const placements = (() => {
  const out: { item: OrbitItem; r: number; baseAngle: number; speed: number }[] = [];
  RINGS.forEach((ring, ringIdx) => {
    const ringItems = ITEMS.filter((it) => it.ring === ringIdx);
    ringItems.forEach((item, i) => {
      const base = (360 / ring.count) * i + (RING_PHASE[ringIdx] ?? ringIdx * 18);
      out.push({ item, r: ring.r, baseAngle: base, speed: ring.speed });
    });
  });
  return out;
})();

/**
 * PediaOrbit — Kembar OrbitHero Market untuk beranda Pedia.
 *
 * Mesin animasi disalin 1:1 dari src/components/storefront/OrbitHero.tsx:
 * - Zero React re-render (refs + rAF imperatif, transform + opacity saja).
 * - IntersectionObserver + visibilitychange pause, reduced-motion statis.
 * - Mode hemat mobile (coarse/≤640px): semua 8 planet tetap tampil
 *   seperti Market, tanpa trail/label/shadow dinamis/star-dust, 24fps,
 *   start ditunda requestIdleCallback.
 * - Drag + wheel impulse hanya (pointer: fine); sentuh = native pan-y.
 *
 * Yang beda: 8 planet sosmed Pedia (bukan 12 produk Market) + inti mark
 * AXVARA Pedia (bukan prism Market) sesuai permintaan owner 2026-10-12.
 * Planet disamakan persis resep Market: sphere 38/42px + ikon asli 22/24px
 * + gloss/tint/border/shadow sama agar rapih sama rata.
 */
export function PediaOrbit() {
  const containerRef = useRef<HTMLDivElement>(null);
  const planetRefs = useRef<(HTMLDivElement | null)[]>([]);
  const trailRefs = useRef<(SVGPathElement | null)[]>([]);
  const trailWhiteRefs = useRef<(SVGPathElement | null)[]>([]);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const shadowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Animation state in refs — zero React state changes during animation
  const angleRef = useRef(0);
  const velRef = useRef(0);
  const isDraggingRef = useRef(false);
  const canDragRef = useRef(false);
  const startXRef = useRef(0);
  const startAngleRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const isVisibleRef = useRef(true);
  const lastTimeRef = useRef(0);
  const lastRenderTimeRef = useRef(0);
  const lastTrailTimeRef = useRef(0);
  // Mobile hemat: semua 8 planet tetap tampil seperti Market; yang
  // dimatikan hanya trail/label/shadow dinamis/star-dust + 24fps.
  // Diputuskan SEKALI saat mount (bukan per frame) agar tidak ada
  // matchMedia di hot path.
  const liteRef = useRef(false);
  const liteCountRef = useRef(placements.length);

  // Set planet ref
  const setPlanetRef = useCallback((el: HTMLDivElement | null, i: number) => {
    planetRefs.current[i] = el;
  }, []);

  // Update all planet positions imperatively — no React setState.
  // HAPPY-PATH GPU: properti yang ditulis per frame HANYA transform dan
  // opacity (compositor-only, tanpa repaint). Lihat OrbitHero untuk daftar
  // properti yang dilarang di hot path (filter/blur/backdrop/display).
  const updatePositions = useCallback((drawTrails = true) => {
    const angle = angleRef.current;
    const lite = liteRef.current;
    const count = lite ? liteCountRef.current : placements.length;

    for (let i = 0; i < count; i++) {
      const { r, baseAngle, speed } = placements[i];
      const planetEl = planetRefs.current[i];
      if (!planetEl) continue;

      const a = baseAngle + angle * speed;
      const rad = (a * Math.PI) / 180;
      const x = Math.cos(rad) * r;
      const y = Math.sin(rad) * r * ELLIPSE;
      const depth = Math.sin(rad);
      const scale = 0.78 + 0.32 * ((depth + 1) / 2);
      const opacity = 0.62 + 0.38 * ((depth + 1) / 2);
      const zIndex = depth > 0 ? 30 : 10;

      // Direct style — compositor only, no repaint
      planetEl.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
      planetEl.style.zIndex = String(zIndex);
      planetEl.style.opacity = String(opacity);

      if (drawTrails && !lite) {
        const trailLen = 22 + (i % 3) * 5;
        const tx = Math.cos(((a - trailLen) * Math.PI) / 180) * r;
        const ty = Math.sin(((a - trailLen) * Math.PI) / 180) * r * ELLIPSE;
        const mx = Math.cos(((a - trailLen / 2) * Math.PI) / 180) * r;
        const my = Math.sin(((a - trailLen / 2) * Math.PI) / 180) * r * ELLIPSE;
        const tOpacity = Math.max(0, 0.45 + depth * 0.25);
        const d = `M ${tx} ${ty} Q ${mx} ${my} ${x} ${y}`;

        const trailEl = trailRefs.current[i];
        if (trailEl) {
          trailEl.setAttribute("d", d);
          trailEl.setAttribute("stroke-width", depth > 0.15 ? "1.5" : "0.9");
          trailEl.setAttribute("opacity", depth > 0.15 ? "0.38" : "0.14");
          const trailGroup = trailEl.parentElement;
          if (trailGroup) trailGroup.style.opacity = String(tOpacity);
        }
        const trailWhite = trailWhiteRefs.current[i];
        if (trailWhite) {
          trailWhite.setAttribute("d", d);
          trailWhite.setAttribute("opacity", depth > 0.15 ? "0.45" : "0.16");
        }
      }
    }

  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Touch screens must keep native vertical scrolling. Direct orbit control is
    // reserved for precise mouse/trackpad pointers.
    canDragRef.current = window.matchMedia("(pointer: fine)").matches;
    // Layar kecil = mode hemat: planet dalam, tanpa trail/label/
    // shadow dinamis, 24fps. Biaya komposit turun ~60–70% di HP kentang
    // sementara tampilan inti orbit tetap utuh.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const smallScreen = window.matchMedia("(max-width: 640px)").matches;
    liteRef.current = coarse || smallScreen;
    // 2026-10-12 (owner): mobile tampil SEMUA 8 planet seperti Market
    // (dulu 4 — terlalu sepi). Seluruh planet sosmed memang dipakai di
    // mode mobile, biaya komposit tetap aman (compositor-only + 24fps).
    liteCountRef.current = placements.length;

    // Respect prefers-reduced-motion
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // LCP mobile: animasi orbit ditunda sampai paint pertama selesai agar
    // thread utama fokus ke teks + gambar kartu. Desktop langsung jalan.
    const deferForLcp = liteRef.current && !reduceMotion;
    if (reduceMotion) {
      // Set static positions and exit
      updatePositions();
      return;
    }

    let canAnimate = true;

    // Animation loop — all imperative, zero React renders
    const tick = (now: number) => {
      rafRef.current = null;
      if (!canAnimate || !isVisibleRef.current || document.hidden) return;

      const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0.016;
      lastTimeRef.current = now;

      if (!isDraggingRef.current) {
        // Friction on inertia velocity
        velRef.current *= 0.992;
        // Base auto rotation + inertia
        const base = 14; // deg/sec
        angleRef.current += (base + velRef.current) * dt;
      }

      // Slow auto-rotation renders at 30fps desktop; mobile hemat di 24fps.
      // Direct manipulation/inertia stays at the display refresh rate so
      // dragging remains responsive (desktop only — mobile tidak bisa drag).
      const isInteractive = isDraggingRef.current || Math.abs(velRef.current) > 0.5;
      const frameBudget = liteRef.current ? 42 : 30;
      const shouldRender = isInteractive || !lastRenderTimeRef.current || now - lastRenderTimeRef.current >= frameBudget;
      if (shouldRender) {
        const drawTrails = !lastTrailTimeRef.current || now - lastTrailTimeRef.current >= 30;
        updatePositions(drawTrails);
        lastRenderTimeRef.current = now;
        if (drawTrails) lastTrailTimeRef.current = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const startAnimation = () => {
      if (rafRef.current !== null || !canAnimate || !isVisibleRef.current || document.hidden) return;
      lastTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    };

    const stopAnimation = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTimeRef.current = 0;
      lastRenderTimeRef.current = 0;
      lastTrailTimeRef.current = 0;
    };

    updatePositions();
    if (deferForLcp) {
      // requestIdleCallback = jalan saat browser senggang (maks 2,5 dtk);
      // fallback timeout agar orbit tetap hidup di browser lama.
      const idle = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (typeof idle.requestIdleCallback === "function") {
        idle.requestIdleCallback(startAnimation, { timeout: 2500 });
      } else {
        window.setTimeout(startAnimation, 1200);
      }
    } else {
      startAnimation();
    }

    // IntersectionObserver — pause when off-screen
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting) startAnimation();
        else stopAnimation();
      },
      { threshold: 0.05 }
    );
    observer.observe(container);

    // Visibility change — pause when tab hidden
    const onVisibility = () => {
      if (document.hidden) {
        isVisibleRef.current = false;
        stopAnimation();
      } else {
        // Re-check intersection before resuming
        const rect = container.getBoundingClientRect();
        isVisibleRef.current = rect.bottom > 0 && rect.top < window.innerHeight;
        startAnimation();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      canAnimate = false;
      stopAnimation();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [updatePositions]);

  // Pointer handlers — imperative, no setState
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!canDragRef.current) return;
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startAngleRef.current = angleRef.current;
    velRef.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!canDragRef.current || !isDraggingRef.current) return;
    const dx = e.clientX - startXRef.current;
    angleRef.current = startAngleRef.current + dx * 0.6;
    velRef.current = dx * 0.08;
  }, []);

  const onPointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!canDragRef.current) return;
    // Keep the page scroll native while adding only a subtle orbit impulse.
    velRef.current += e.deltaY * 0.12;
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
      className="relative w-[360px] h-[360px] sm:w-[440px] sm:h-[440px] shrink-0 scale-[0.88] sm:scale-100 select-none md:cursor-grab md:active:cursor-grabbing"
      style={{ touchAction: "pan-y" }}
      role="img"
      aria-label="Orbit layanan media sosial AXVARA Pedia"
    >
      {/* 3D perspective container */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ perspective: "900px", perspectiveOrigin: "50% 45%" }}>
        {/* tilted solar plane */}
        <div className="relative" style={{ width: 440, height: 440, transform: "rotateX(62deg)", transformStyle: "preserve-3d" }}>
          {/* orbit rings */}
          {RINGS.map((ring, idx) => (
            <div
              key={idx}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: ring.r * 2,
                height: ring.r * 2,
                border: "1px solid rgba(255,255,255,0.09)",
                boxShadow: idx === 3 ? "0 0 0 1px rgba(255,255,255,0.02), inset 0 1px 0 rgba(255,255,255,0.03)" : undefined,
              }}
            />
          ))}
          {/* outer asteroid dust */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none" style={{ width: 368, height: 368, border: "1px dashed rgba(255,255,255,0.06)" }} />
          {/* inner glow ring */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none blur-[0.5px]" style={{ width: 136, height: 136, border: "1px solid rgba(0,229,255,0.14)" }} />
        </div>
      </div>

      {/* Mark AXVARA Pedia — centered core (logo Pedia, bukan prism Market).
          Mark SVG trace putih via filter (pola PediaNavbar): brightness-0
          invert di atas sphere gelap kaca agar putihnya menyala. */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none" aria-label="AXVARA Pedia">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[142px] h-[142px] sm:w-[158px] sm:h-[158px] rounded-full blur-[22px] opacity-50" style={{ background: "radial-gradient(circle at center, rgba(0,229,255,0.26), rgba(0,229,255,0.09) 36%, transparent 70%)" }} />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[96px] h-[96px] sm:w-[108px] sm:h-[108px] rounded-full blur-[10px] opacity-70" style={{ background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.16), transparent 62%)" }} />
        <div className="relative w-[90px] h-[90px] sm:w-[102px] sm:h-[102px] rounded-full flex flex-col items-center justify-center overflow-hidden border border-white/[0.14]" style={{ background: "radial-gradient(ellipse 92% 88% at 30% 22%, rgba(255,255,255,0.13), rgba(255,255,255,0.04) 32%, rgba(10,14,38,0.97) 68%), linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.015))", boxShadow: "0 10px 36px rgba(0,0,0,0.46), 0 0 28px rgba(0,229,255,0.20), inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 10px rgba(0,0,0,0.38)", backdropFilter: "blur(18px) saturate(160%)", WebkitBackdropFilter: "blur(18px) saturate(160%)" }}>
          <div className="absolute inset-[1px] rounded-full pointer-events-none" style={{ border: "1px solid rgba(0,229,255,0.11)" }} />
          <div className="absolute left-[16%] top-[12%] w-[42%] h-[28%] rounded-full blur-[8px] bg-white/[0.10] pointer-events-none" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/pedia-mark.svg"
            alt=""
            width={36}
            height={32}
            className="relative h-[32px] w-[36px] sm:h-[36px] sm:w-[40px] brightness-0 invert drop-shadow-[0_1px_8px_rgba(0,229,255,0.22)]"
            draggable={false}
          />
          <span className="relative font-display font-[300] text-[9.5px] sm:text-[10px] tracking-[0.24em] text-white/95 mt-1 leading-none">PEDIA</span>
        </div>
        <div className="absolute left-1/2 top-[90%] -translate-x-1/2 w-[92px] h-[22px] rounded-full blur-[10px] opacity-[0.18]" style={{ background: "radial-gradient(ellipse at center, rgba(0,229,255,0.55), transparent 72%)", transform: "scaleY(0.5)" }} />
      </div>

      {/* Shared SVG for all trails; geometry redraw is throttled separately from planets.
          Desktop only — di mobile trail tidak digambar (hemat komposit SVG). */}
      <svg className="absolute left-1/2 top-1/2 z-0 pointer-events-none hidden sm:block" width={440} height={440} viewBox="-220 -220 440 440" style={{ transform: "translate(-50%, -50%)" }} aria-hidden>
        {placements.map(({ item }, i) => (
          <g key={item.label}>
            <path
              ref={(el) => { trailRefs.current[i] = el; }}
              d="M 0 0"
              fill="none"
              stroke={item.color}
              strokeWidth="1"
              strokeLinecap="round"
            />
            <path
              ref={(el) => { trailWhiteRefs.current[i] = el; }}
              d="M 0 0"
              fill="none"
              stroke="rgba(255,255,255,0.20)"
              strokeWidth="0.6"
              strokeLinecap="round"
            />
          </g>
        ))}
      </svg>

      {/* Planets — rendered once, updated imperatively.
          2026-10-12 (owner): SEMUA planet tampil di mobile seperti Market
          (dulu hanya 4 planet dalam, terlalu sepi).
          Trail/label/shadow dinamis tetap desktop-only (hemat komposit).
          Resep DISAMAKAN PERSIS dengan OrbitHero Market agar rapih sama rata:
          sphere 38/42px + ikon asli 22/24px object-contain + tint brand tipis
          + gloss + highlight + border/shadow sama. Logo putih (Threads/X)
          memakai bg gelap + ikon putih via filter (pola brand resmi: Threads
          & X memang monokrom putih) — bukan sphere gelap terpisah. */}
      {placements.map(({ item }, pi) => {
        const sphereBg = item.dark
          ? `linear-gradient(180deg, rgba(35,40,66,0.96), rgba(18,22,46,0.96)), radial-gradient(ellipse 60% 55% at 50% 48%, ${item.color}14, transparent 68%)`
          : `linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.78)), radial-gradient(ellipse 60% 55% at 50% 48%, ${item.color}14, transparent 68%)`;

        return (
          <div
            key={item.label + pi}
            ref={(el) => setPlanetRef(el, pi)}
            className="absolute left-1/2 top-1/2 items-center justify-center will-change-transform flex"
            style={{ transform: "translate(-50%, -50%)" }}
            title={item.label}
          >
            {/* shadow statis — tidak di-toggle per frame (hemat layout+paint) */}
            <div
              ref={(el) => { shadowRefs.current[pi] = el; }}
              className="absolute top-[56%] left-1/2 -translate-x-1/2 w-8 h-2 rounded-full blur-[4px] bg-black/35 -z-10 hidden sm:block"
              style={{ transform: "translateX(-50%) scaleX(1.2)" }}
            />
            {/* planet sphere — ukuran + border + shadow sama persis Market */}
            <div
              className="relative overflow-hidden flex items-center justify-center border w-[38px] h-[38px] sm:w-[42px] sm:h-[42px] rounded-full"
              style={{
                background: sphereBg,
                borderColor: item.dark ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.65)",
                boxShadow: `0 6px 16px rgba(0,0,0,0.18), 0 0 10px ${item.color}20, inset 0 1px 1px rgba(255,255,255,0.85)`,
              }}
            >
              {!item.dark && (
                <>
                  <div className="absolute inset-0 rounded-full pointer-events-none opacity-60" style={{ background: `radial-gradient(ellipse 70% 60% at 50% 55%, ${item.color}18, transparent 68%)` }} />
                  <div className="absolute left-[14%] top-[10%] w-[46%] h-[28%] rounded-full blur-[4px] pointer-events-none" style={{ background: "radial-gradient(ellipse at center, rgba(255,255,255,0.85), transparent 70%)" }} />
                  <div className="absolute left-[20%] top-[15%] w-[16%] h-[10%] rounded-full bg-white blur-[1px] pointer-events-none opacity-90" />
                </>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.icon}
                alt={item.label}
                width={24}
                height={24}
                className="relative w-[22px] h-[22px] sm:w-[24px] sm:h-[24px] object-contain"
                style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.22))" }}
                loading="lazy"
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  img.style.display = "none";
                  const fallback = img.nextElementSibling as HTMLElement | null;
                  if (fallback) fallback.style.display = "block";
                }}
                draggable={false}
              />
              <span className="hidden text-[9px] font-bold text-[#1A1A1E] text-center leading-none px-1 relative">{item.label.slice(0, 3)}</span>
            </div>
            {/* label statis — gaya tetap, tidak ditulis per frame.
                Tanpa backdrop-blur per frame (biang lag mobile). */}
            <span
              ref={(el) => { labelRefs.current[pi] = el; }}
              className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-medium tracking-wide whitespace-nowrap px-1.5 py-0.5 rounded-full text-white/60 bg-black/30 border border-white/10 hidden sm:inline-block"
            >
              {item.label}
            </span>
          </div>
        );
      })}

      {/* subtle star dust — desktop only (hemat paint mobile) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden hidden sm:block" aria-hidden>
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} className="absolute w-[2px] h-[2px] rounded-full bg-white/55 blur-[0.3px]" style={{ left: `${8 + ((i * 37) % 84)}%`, top: `${12 + ((i * 53) % 76)}%`, opacity: 0.18 + (i % 3) * 0.12 }} />
        ))}
      </div>
    </div>
  );
}
