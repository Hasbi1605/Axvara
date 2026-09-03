"use client";
import { useEffect, useRef, useCallback } from "react";

type OrbitItem = {
  label: string;
  slug: string;
  color: string;
  ring: number; // 0..3
};

const ITEMS: OrbitItem[] = [
  // ring 0 - inner
  { label: "ChatGPT", slug: "openai", color: "#10A37F", ring: 0 },
  { label: "Claude", slug: "anthropic", color: "#C07A5A", ring: 0 },
  // ring 1
  { label: "Gemini", slug: "googlegemini", color: "#4285F4", ring: 1 },
  { label: "CapCut", slug: "capcut", color: "#000000", ring: 1 },
  { label: "Canva", slug: "canva", color: "#00C4CC", ring: 1 },
  // ring 2
  { label: "Netflix", slug: "netflix", color: "#E50914", ring: 2 },
  { label: "YouTube", slug: "youtube", color: "#FF0000", ring: 2 },
  { label: "VPN", slug: "nordvpn", color: "#4687FF", ring: 2 },
  { label: "Perplexity", slug: "perplexity", color: "#20808D", ring: 2 },
  // ring 3 - outer
  { label: "Notion", slug: "notion", color: "#111111", ring: 3 },
  { label: "Adobe", slug: "adobe", color: "#FF0000", ring: 3 },
  { label: "Spotify", slug: "spotify", color: "#1DB954", ring: 3 },
];

const RINGS = [
  { r: 68, speed: 1.15, count: 2 },
  { r: 104, speed: 0.85, count: 3 },
  { r: 142, speed: 0.62, count: 4 },
  { r: 182, speed: 0.42, count: 3 },
];

// Local SVG logos (no external Iconify requests)
const LOCAL_LOGO: Record<string, string> = {
  capcut: "/icons/capcut.svg",
  canva: "/icons/canva.svg",
  openai: "/icons/openai.svg",
  anthropic: "/icons/anthropic.svg",
  googlegemini: "/icons/googlegemini.svg",
  netflix: "/icons/netflix.svg",
  youtube: "/icons/youtube.svg",
  nordvpn: "/icons/nordvpn.svg",
  perplexity: "/icons/perplexity.svg",
  notion: "/icons/notion.svg",
  adobe: "/icons/adobe.svg",
  spotify: "/icons/spotify.svg",
};

const logoUrl = (slug: string) => LOCAL_LOGO[slug] || `/icons/${slug}.svg`;

const ELLIPSE = 0.38; // flatten factor for 62deg tilt

// Pre-compute placements (static — no React state needed)
const placements = (() => {
  const out: { item: OrbitItem; r: number; baseAngle: number; speed: number }[] = [];
  RINGS.forEach((ring, ringIdx) => {
    const ringItems = ITEMS.filter((it) => it.ring === ringIdx);
    ringItems.forEach((item, i) => {
      const base = (360 / ring.count) * i + ringIdx * 18;
      out.push({ item, r: ring.r, baseAngle: base, speed: ring.speed });
    });
  });
  return out;
})();

/**
 * OrbitHero v2 — Zero React re-renders during animation.
 *
 * All animation is done imperatively via refs + rAF.
 * - Angle stored in ref (not useState) — no React reconciliation per frame.
 * - DOM updates via direct style manipulation on pre-ref'd elements.
 * - IntersectionObserver pauses animation when hero is off-screen.
 * - document.visibilitychange pauses when tab is hidden.
 * - prefers-reduced-motion disables animation entirely.
 * - Single instance — page.tsx uses CSS responsive layout, not two mounts.
 */
export function OrbitHero() {
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

  // Set planet ref
  const setPlanetRef = useCallback((el: HTMLDivElement | null, i: number) => {
    planetRefs.current[i] = el;
  }, []);

  // Update all planet positions imperatively — no React setState
  const updatePositions = useCallback((drawTrails = true) => {
    const angle = angleRef.current;

    for (let i = 0; i < placements.length; i++) {
      const { r, baseAngle, speed, item } = placements[i];
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
      const blur = depth < -0.4 ? 0.4 : 0;
      const isFront = depth > 0.15;

      // Direct style — no React reconciliation
      planetEl.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
      planetEl.style.zIndex = String(zIndex);
      planetEl.style.opacity = String(opacity);
      planetEl.style.filter = blur ? `blur(${blur}px)` : "none";

      if (drawTrails) {
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
          trailEl.setAttribute("stroke-width", isFront ? "1.5" : "0.9");
          trailEl.setAttribute("opacity", isFront ? "0.38" : "0.14");
          trailEl.style.filter = isFront ? `drop-shadow(0 0 5px ${item.color}66)` : "none";
          const trailGroup = trailEl.parentElement;
          if (trailGroup) trailGroup.style.opacity = String(tOpacity);
        }
        const trailWhite = trailWhiteRefs.current[i];
        if (trailWhite) {
          trailWhite.setAttribute("d", d);
          trailWhite.setAttribute("opacity", isFront ? "0.45" : "0.16");
        }
      }

      // Shadow
      const shadowEl = shadowRefs.current[i];
      if (shadowEl) {
        shadowEl.style.display = isFront ? "" : "none";
      }

      // Label
      const labelEl = labelRefs.current[i];
      if (labelEl) {
        labelEl.style.color = isFront ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.38)";
        labelEl.style.background = isFront ? "rgba(0,0,0,0.42)" : "transparent";
        labelEl.style.border = isFront ? "1px solid rgba(255,255,255,0.12)" : "none";
        labelEl.style.backdropFilter = isFront ? "blur(6px)" : "none";
        labelEl.style.opacity = depth > -0.6 ? "1" : "0";
      }
    }

  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Touch screens must keep native vertical scrolling. Direct orbit control is
    // reserved for precise mouse/trackpad pointers.
    canDragRef.current = window.matchMedia("(pointer: fine)").matches;

    // Respect prefers-reduced-motion
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

      // Slow auto-rotation renders at 30fps; direct manipulation/inertia stays
      // at the display refresh rate so dragging remains responsive.
      const isInteractive = isDraggingRef.current || Math.abs(velRef.current) > 0.5;
      const shouldRender = isInteractive || !lastRenderTimeRef.current || now - lastRenderTimeRef.current >= 30;
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
    startAnimation();

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
      aria-label="Orbit aplikasi premium AXVARA"
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

      {/* AXVARA prism — centered core */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none" aria-label="AXVARA">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[142px] h-[142px] sm:w-[158px] sm:h-[158px] rounded-full blur-[22px] opacity-50" style={{ background: "radial-gradient(circle at center, rgba(0,229,255,0.26), rgba(0,229,255,0.09) 36%, transparent 70%)" }} />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[96px] h-[96px] sm:w-[108px] sm:h-[108px] rounded-full blur-[10px] opacity-70" style={{ background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.16), transparent 62%)" }} />
        <div className="relative w-[90px] h-[90px] sm:w-[102px] sm:h-[102px] rounded-full flex flex-col items-center justify-center overflow-hidden border border-white/[0.14]" style={{ background: "radial-gradient(ellipse 92% 88% at 30% 22%, rgba(255,255,255,0.13), rgba(255,255,255,0.04) 32%, rgba(10,14,38,0.97) 68%), linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.015))", boxShadow: "0 10px 36px rgba(0,0,0,0.46), 0 0 28px rgba(0,229,255,0.20), inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 10px rgba(0,0,0,0.38)", backdropFilter: "blur(18px) saturate(160%)", WebkitBackdropFilter: "blur(18px) saturate(160%)" }}>
          <div className="absolute inset-[1px] rounded-full pointer-events-none" style={{ border: "1px solid rgba(0,229,255,0.11)" }} />
          <div className="absolute left-[16%] top-[12%] w-[42%] h-[28%] rounded-full blur-[8px] bg-white/[0.10] pointer-events-none" />
          <span className="relative w-[46px] h-[40px] sm:w-[50px] sm:h-[44px] text-white flex items-center justify-center drop-shadow-[0_1px_8px_rgba(0,229,255,0.22)]">
            <svg viewBox="0 0 120 110" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" shapeRendering="geometricPrecision" aria-hidden>
              <path d="M60 4 L6.5 104 L113.5 104 Z" />
              <path d="M60 4 L60 49.5" />
              <path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z" />
              <path d="M35.8 78.5 L84.2 78.5" />
              <path d="M35.8 78.5 L6.5 104" />
              <path d="M84.2 78.5 L113.5 104" />
            </svg>
          </span>
          <span className="relative font-display font-[300] text-[9.5px] sm:text-[10px] tracking-[0.24em] text-white/95 mt-1 leading-none">AXVARA</span>
        </div>
        <div className="absolute left-1/2 top-[90%] -translate-x-1/2 w-[92px] h-[22px] rounded-full blur-[10px] opacity-[0.18]" style={{ background: "radial-gradient(ellipse at center, rgba(0,229,255,0.55), transparent 72%)", transform: "scaleY(0.5)" }} />
      </div>

      {/* Shared SVG for all trails; geometry redraw is throttled separately from planets */}
      <svg className="absolute left-1/2 top-1/2 z-0 pointer-events-none" width={440} height={440} viewBox="-220 -220 440 440" style={{ transform: "translate(-50%, -50%)" }} aria-hidden>
        {placements.map(({ item }, i) => (
          <g key={item.slug}>
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

      {/* Planets — rendered once, updated imperatively */}
      {placements.map(({ item }, pi) => {
        const isCapCut = item.slug === "capcut";
        const isCanva = item.slug === "canva";
        const isBrandVector = isCapCut || isCanva;
        const sphereBg = isBrandVector
          ? "rgba(255,255,255,0.96)"
          : `linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.78)), radial-gradient(ellipse 60% 55% at 50% 48%, ${item.color}14, transparent 68%)`;

        return (
          <div
            key={item.label + pi}
            ref={(el) => setPlanetRef(el, pi)}
            className="absolute left-1/2 top-1/2 flex items-center justify-center will-change-transform"
            style={{ transform: "translate(-50%, -50%)" }}
            title={item.label}
          >
            {/* shadow on ground for front planets */}
            <div
              ref={(el) => { shadowRefs.current[pi] = el; }}
              className="absolute top-[56%] left-1/2 -translate-x-1/2 w-8 h-2 rounded-full blur-[4px] bg-black/35 -z-10"
              style={{ transform: "translateX(-50%) scaleX(1.2)", display: "none" }}
            />
            {/* planet sphere */}
            <div
              className={`relative overflow-hidden flex items-center justify-center border ${isBrandVector ? "w-[42px] h-[42px] sm:w-[46px] sm:h-[46px] rounded-full p-[3px]" : "w-[38px] h-[38px] sm:w-[42px] sm:h-[42px] rounded-full"}`}
              style={{
                background: sphereBg,
                borderColor: "rgba(255,255,255,0.65)",
                boxShadow: `0 6px 16px rgba(0,0,0,0.18), 0 0 10px ${item.color}20, inset 0 1px 1px rgba(255,255,255,0.85)`,
              }}
            >
              {!isBrandVector && (
                <>
                  <div className="absolute inset-0 rounded-full pointer-events-none opacity-60" style={{ background: `radial-gradient(ellipse 70% 60% at 50% 55%, ${item.color}18, transparent 68%)` }} />
                  <div className="absolute left-[14%] top-[10%] w-[46%] h-[28%] rounded-full blur-[4px] pointer-events-none" style={{ background: "radial-gradient(ellipse at center, rgba(255,255,255,0.85), transparent 70%)" }} />
                  <div className="absolute left-[20%] top-[15%] w-[16%] h-[10%] rounded-full bg-white blur-[1px] pointer-events-none opacity-90" />
                </>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl(item.slug)}
                alt={item.label}
                width={isCanva ? 36 : isCapCut ? 32 : 24}
                height={isCanva ? 36 : isCapCut ? 20 : 24}
                className={
                  isCanva
                    ? "relative w-[34px] h-[34px] sm:w-[38px] sm:h-[38px] object-contain rounded-full"
                    : isCapCut
                      ? "relative w-[28px] h-[16px] sm:w-[32px] sm:h-[18px] object-contain"
                      : "relative w-[22px] h-[22px] sm:w-[24px] sm:h-[24px] object-contain"
                }
                style={isBrandVector ? undefined : { filter: `drop-shadow(0 1px 2px rgba(0,0,0,0.22))` }}
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
            {/* label under planet */}
            <span
              ref={(el) => { labelRefs.current[pi] = el; }}
              className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-medium tracking-wide whitespace-nowrap px-1.5 py-0.5 rounded-full"
              style={{
                color: "rgba(255,255,255,0.38)",
                background: "transparent",
                border: "none",
              }}
            >
              {item.label}
            </span>
          </div>
        );
      })}

      {/* subtle star dust */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} className="absolute w-[2px] h-[2px] rounded-full bg-white/55 blur-[0.3px]" style={{ left: `${8 + ((i * 37) % 84)}%`, top: `${12 + ((i * 53) % 76)}%`, opacity: 0.18 + (i % 3) * 0.12 }} />
        ))}
      </div>
    </div>
  );
}
