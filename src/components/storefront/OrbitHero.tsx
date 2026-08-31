"use client";
import { useEffect, useRef, useState, useCallback } from "react";

type OrbitItem = {
  label: string;
  slug: string; // simpleicons slug
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

// Official vector logos (user-provided SVG, file-based — no more 404 simpleicons)
const LOCAL_LOGO: Record<string, string> = {
  capcut: "/icons/capcut.svg",
  canva: "/icons/canva.svg",
};

// Brand hex for Iconify fallback (if local not present)
const BRAND_HEX: Record<string, string> = {
  openai: "412991",
  anthropic: "D4A27F",
  googlegemini: "4285F4",
  // canva/capcut now via LOCAL_LOGO
  netflix: "E50914",
  youtube: "FF0000",
  nordvpn: "4687FF",
  perplexity: "1FB8CD",
  notion: "000000",
  adobe: "FF0000",
  spotify: "1DB954",
};
const logoUrlColored = (slug: string) => {
  if (LOCAL_LOGO[slug]) return LOCAL_LOGO[slug];
  const hex = BRAND_HEX[slug] || "1A1A1E";
  const remap: Record<string, string> = { openai: "simple-icons:openai", adobe: "simple-icons:adobe" };
  const icon = remap[slug] || `simple-icons:${slug}`;
  return `https://api.iconify.design/${icon}.svg?color=%23${hex}`;
};

// kept for future planet bg decisions

export function OrbitHero() {
  const [dragAngle, setDragAngle] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hovered, setHovered] = useState<string | null>(null);
  const startX = useRef(0);
  const startAngle = useRef(0);
  const rafRef = useRef<number | null>(null);
  const velRef = useRef(0);

  // auto rotate with inertia
  useEffect(() => {
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!isDragging) {
        // friction
        velRef.current *= 0.992;
        // base auto speed
        const base = 14; // deg/sec
        setDragAngle((a) => a + (base + velRef.current) * dt);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isDragging]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true);
    startX.current = e.clientX;
    startAngle.current = dragAngle;
    velRef.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [dragAngle]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX.current;
    const next = startAngle.current + dx * 0.6;
    // velocity for inertia
    velRef.current = dx * 0.08;
    setDragAngle(next);
  }, [isDragging]);

  const onPointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    velRef.current += e.deltaY * 0.12;
  }, []);

  // build placements per ring
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

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
      className="relative w-[360px] h-[360px] sm:w-[440px] sm:h-[440px] shrink-0 select-none touch-none cursor-grab active:cursor-grabbing"
      style={{ touchAction: "none" }}
    >
      {/* 3D perspective container */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ perspective: "900px", perspectiveOrigin: "50% 45%" }}>
        {/* tilted solar plane */}
        <div className="relative" style={{ width: 440, height: 440, transform: "rotateX(62deg)", transformStyle: "preserve-3d" }}>
          {/* orbit rings - ellipse due to tilt */}
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
          {/* outer asteroid dust - subtle */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none" style={{ width: 368, height: 368, border: "1px dashed rgba(255,255,255,0.06)" }} />
          {/* thin inner glow rings */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none blur-[0.5px]" style={{ width: 136, height: 136, border: "1px solid rgba(0,229,255,0.14)" }} />
        </div>
      </div>

      {/* AXVARA prism — centered core, matches Navbar prism, tuned for orbit */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none" aria-label="AXVARA">
        {/* outer halo — cyan, brand-coherent */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[142px] h-[142px] sm:w-[158px] sm:h-[158px] rounded-full blur-[22px] opacity-50" style={{ background: "radial-gradient(circle at center, rgba(0,229,255,0.26), rgba(0,229,255,0.09) 36%, transparent 70%)" }} />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[96px] h-[96px] sm:w-[108px] sm:h-[108px] rounded-full blur-[10px] opacity-70" style={{ background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.16), transparent 62%)" }} />
        {/* core — midnight glass, prism white */}
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
        {/* ground reflection — subtle cyan */}
        <div className="absolute left-1/2 top-[90%] -translate-x-1/2 w-[92px] h-[22px] rounded-full blur-[10px] opacity-[0.18]" style={{ background: "radial-gradient(ellipse at center, rgba(0,229,255,0.55), transparent 72%)", transform: "scaleY(0.5)" }} />
      </div>

      {/* planets - computed in 2D ellipse with depth */}
      {placements.map(({ item, r, baseAngle, speed }, idx) => {
        const angle = baseAngle + dragAngle * speed;
        const rad = (angle * Math.PI) / 180;
        const ELLIPSE = 0.38; // flatten factor for 62deg tilt
        const x = Math.cos(rad) * r;
        const y = Math.sin(rad) * r * ELLIPSE;
        // depth: sin 1 = front (south), -1 = back (north)
        const depth = Math.sin(rad);
        const scale = 0.78 + 0.32 * ((depth + 1) / 2); // front 1.10, back 0.78
        const opacity = 0.62 + 0.38 * ((depth + 1) / 2);
        const zIndex = depth > 0 ? 30 : 10;
        const blur = depth < -0.4 ? 0.4 : 0;
        const isFront = depth > 0.15;

        return (
          <div
            key={item.label + idx}
            onMouseEnter={() => setHovered(item.label)}
            onMouseLeave={() => setHovered(null)}
            className="absolute left-1/2 top-1/2 flex items-center justify-center will-change-transform"
            style={{
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`,
              zIndex,
              opacity,
              filter: blur ? `blur(${blur}px)` : undefined,
              transition: isDragging ? "none" : "transform 0.45s cubic-bezier(0.22,1,0.36,1), opacity 0.45s linear",
            } as React.CSSProperties & { willChange: string }}
            title={item.label}
          >
            {/* shadow on ground for front planets */}
            {isFront && (
              <div className="absolute top-[56%] left-1/2 -translate-x-1/2 w-8 h-2 rounded-full blur-[4px] bg-black/35 -z-10" style={{ transform: "translateX(-50%) scaleX(1.2)" }} />
            )}
            {/* trail - smooth comet tail */}
            {(() => {
              const trailLen = 22 + (idx % 3) * 5;
              const tx = Math.cos(((angle - trailLen) * Math.PI) / 180) * r;
              const ty = Math.sin(((angle - trailLen) * Math.PI) / 180) * r * ELLIPSE;
              const mx = Math.cos(((angle - trailLen / 2) * Math.PI) / 180) * r;
              const my = Math.sin(((angle - trailLen / 2) * Math.PI) / 180) * r * ELLIPSE;
              const tOpacity = Math.max(0, 0.45 + depth * 0.25);
              return (
                <svg className="absolute left-1/2 top-1/2 pointer-events-none -z-10" width={440} height={440} viewBox="-220 -220 440 440" style={{ transform: "translate(-50%, -50%)", opacity: tOpacity }}>
                  <path
                    d={`M ${tx} ${ty} Q ${mx} ${my} ${x} ${y}`}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={isFront ? 1.5 : 0.9}
                    strokeLinecap="round"
                    opacity={isFront ? 0.38 : 0.14}
                    style={{ filter: isFront ? `drop-shadow(0 0 5px ${item.color}66)` : undefined }}
                  />
                  <path
                    d={`M ${tx} ${ty} Q ${mx} ${my} ${x} ${y}`}
                    fill="none"
                    stroke="rgba(255,255,255,0.20)"
                    strokeWidth={0.6}
                    strokeLinecap="round"
                    opacity={isFront ? 0.45 : 0.16}
                  />
                </svg>
              );
            })()}
            {/* planet sphere - bright realistic, not too dark; CapCut/Canva use true brand vector */}
            {(() => {
              const isCapCut = item.slug === "capcut";
              const isCanva = item.slug === "canva";
              const isBrandVector = isCapCut || isCanva;
              // Canva is circular logo already; CapCut is horizontal ribbon — both need larger container
              const sphereBg = isBrandVector
                ? isCanva
                  ? "rgba(255,255,255,0.96)" // Canva is already circular purple, put on white for fidelity
                  : "rgba(255,255,255,0.96)" // CapCut black ribbon on white
                : `linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.78)), radial-gradient(ellipse 60% 55% at 50% 48%, ${item.color}14, transparent 68%)`;
              return (
                <div
                  className={`relative overflow-hidden backdrop-blur-md flex items-center justify-center border ${isBrandVector ? "w-[42px] h-[42px] sm:w-[46px] sm:h-[46px] rounded-full p-[3px]" : "w-[38px] h-[38px] sm:w-[42px] sm:h-[42px] rounded-full"}`}
                  style={{
                    background: sphereBg,
                    borderColor: depth > 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.50)",
                    boxShadow: isFront
                      ? `0 8px 20px rgba(0,0,0,0.22), 0 0 14px ${item.color}28, inset 0 1px 1px rgba(255,255,255,0.95), inset 0 -1px 2px rgba(0,0,0,0.06)`
                      : `0 4px 12px rgba(0,0,0,0.16), 0 0 8px ${item.color}18, inset 0 1px 1px rgba(255,255,255,0.75)`,
                  }}
                >
                  {!isBrandVector && (
                    <>
                      <div className="absolute inset-0 rounded-full pointer-events-none opacity-60" style={{ background: `radial-gradient(ellipse 70% 60% at 50% 55%, ${item.color}18, transparent 68%)` }} />
                      <div className="absolute left-[14%] top-[10%] w-[46%] h-[28%] rounded-full blur-[4px] pointer-events-none" style={{ background: "radial-gradient(ellipse at center, rgba(255,255,255,0.85), transparent 70%)" }} />
                      <div className="absolute left-[20%] top-[15%] w-[16%] h-[10%] rounded-full bg-white blur-[1px] pointer-events-none opacity-90" />
                    </>
                  )}
                  {/* logo */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoUrlColored(item.slug)}
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
              );
            })()}
            {/* label under planet when front */}
            <span
              className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-medium tracking-wide whitespace-nowrap px-1.5 py-0.5 rounded-full"
              style={{
                color: isFront ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.38)",
                background: isFront ? "rgba(0,0,0,0.42)" : "transparent",
                border: isFront ? "1px solid rgba(255,255,255,0.12)" : "none",
                backdropFilter: isFront ? "blur(6px)" : undefined,
                opacity: depth > -0.6 ? 1 : 0,
              }}
            >
              {item.label}
            </span>
            {/* orbit trail dot for depth */}
            {hovered === item.label && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[68px] h-[68px] rounded-full border border-white/10 pointer-events-none" />
            )}
          </div>
        );
      })}

      {/* subtle star dust */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} className="absolute w-[2px] h-[2px] rounded-full bg-white/55 blur-[0.3px]" style={{ left: `${8 + ((i * 37) % 84)}%`, top: `${12 + ((i * 53) % 76)}%`, opacity: 0.18 + (i % 3) * 0.12 }} />
        ))}
      </div>

      {/* no helper text */}
    </div>
  );
}
