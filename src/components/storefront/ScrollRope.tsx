"use client";
import { useEffect, useRef, useCallback } from "react";

/**
 * ScrollRope v2 — Event-driven animation.
 * - RAF only runs while velocity is significant (> 0.01).
 * - Stops completely when sway settles — zero idle CPU.
 * - No useState for sway/progress — all imperative via refs.
 * - No listeners or animation loop on mobile.
 * - prefers-reduced-motion respected.
 */
export function ScrollRope() {
  const pathShadowRef = useRef<SVGPathElement>(null);
  const pathMainRef = useRef<SVGPathElement>(null);
  const pathCyanRef = useRef<SVGPathElement>(null);
  const tasselRef = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const swayRef = useRef(0);
  const velRef = useRef(0);
  const progressRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);

  const updateDOM = useCallback(() => {
    const w = 60;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const length = 60 + progressRef.current * (Math.min(520, vh * 0.7) - 60);
    const h = length;
    const mid = h * 0.55;
    const cx = swayRef.current * 1.2;

    const d = `M ${w / 2} 0 C ${w / 2 + cx * 0.3} ${mid * 0.5}, ${w / 2 + cx} ${mid}, ${w / 2 + cx * 0.5} ${h - 18}`;

    if (pathShadowRef.current) pathShadowRef.current.setAttribute("d", d);
    if (pathMainRef.current) pathMainRef.current.setAttribute("d", d);
    if (pathCyanRef.current) pathCyanRef.current.setAttribute("d", d);
    if (tasselRef.current) tasselRef.current.setAttribute("transform", `translate(${w / 2 + cx * 0.5}, ${h - 18})`);

    // Update SVG height
    if (svgRef.current) {
      svgRef.current.setAttribute("height", String(h));
      svgRef.current.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
    if (wrapRef.current) {
      wrapRef.current.style.height = `${h}px`;
    }
  }, []);

  const tick = useCallback(() => {
    velRef.current += -swayRef.current * 0.08; // spring
    velRef.current *= 0.92; // damping
    swayRef.current += velRef.current;

    updateDOM();

    // Stop loop when velocity is negligible — key perf win
    if (Math.abs(velRef.current) < 0.01 && Math.abs(swayRef.current) < 0.01) {
      swayRef.current = 0;
      velRef.current = 0;
      isRunningRef.current = false;
      rafRef.current = null;
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [updateDOM]);

  const startLoop = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    // Respect prefers-reduced-motion
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(min-width: 768px)").matches
    ) return;

    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progressRef.current = max > 0 ? window.scrollY / max : 0;
      // nudge sway on scroll
      velRef.current += (Math.random() - 0.5) * 0.8;
      updateDOM();
      startLoop();
    };

    const onResize = () => updateDOM();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    // Initial position
    onScroll();
    updateDOM();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      isRunningRef.current = false;
    };
  }, [updateDOM, startLoop]);

  const onEnter = () => { velRef.current += 6; startLoop(); };
  const onClick = () => { velRef.current += (Math.random() > 0.5 ? 10 : -10); startLoop(); };
  const onMove = (e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - (r.left + r.width / 2);
    velRef.current += x * 0.04;
    startLoop();
  };

  return (
    <div
      ref={wrapRef}
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      onClick={onClick}
      className="fixed top-0 right-3 sm:right-6 z-40 hidden md:block cursor-pointer select-none"
      style={{ height: 60, width: 60 }}
      aria-hidden
      title="Tarik talinya!"
    >
      <svg ref={svgRef} width={60} height={60} viewBox="0 0 60 60" className="overflow-visible">
        {/* shadow */}
        <path
          ref={pathShadowRef}
          d="M 30 0 C 30 15, 30 33, 30 42"
          fill="none"
          stroke="rgba(0,0,0,0.18)"
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* rope */}
        <path
          ref={pathMainRef}
          d="M 30 0 C 30 15, 30 33, 30 42"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={2.2}
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.35))" }}
        />
        <path
          ref={pathCyanRef}
          d="M 30 0 C 30 15, 30 33, 30 42"
          fill="none"
          stroke="rgba(0,229,255,0.35)"
          strokeWidth={1}
          strokeLinecap="round"
          opacity={0.6}
        />
        {/* tassel / handle */}
        <g ref={tasselRef} transform="translate(30, 42)">
          <ellipse cx={0} cy={7} rx={8} ry={4} fill="rgba(0,0,0,0.25)" />
          <rect x={-3} y={-10} width={6} height={14} rx={3} fill="#E5E7EB" stroke="#CBD5E1" strokeWidth={0.5} />
          <rect x={-5} y={4} width={10} height={6} rx={2} fill="#00E5FF" opacity={0.9} />
          <line x1={-3} y1={10} x2={-3} y2={16} stroke="#CBD5E1" strokeWidth={1} />
          <line x1={0} y1={10} x2={0} y2={17} stroke="#CBD5E1" strokeWidth={1} />
          <line x1={3} y1={10} x2={3} y2={15} stroke="#CBD5E1" strokeWidth={1} />
        </g>
        {/* top knot */}
        <circle cx={30} cy={2} r={5} fill="#1E293B" stroke="rgba(255,255,255,0.6)" strokeWidth={1} />
        <circle cx={30} cy={2} r={2} fill="#00E5FF" />
      </svg>
    </div>
  );
}
