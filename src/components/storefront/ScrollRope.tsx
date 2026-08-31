"use client";
import { useEffect, useRef, useState } from "react";

export function ScrollRope() {
  const pathRef = useRef<SVGPathElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [sway, setSway] = useState(0);
  const swayRef = useRef(0);
  const velRef = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      setProgress(p);
      // nudge sway on scroll
      velRef.current += (Math.random() - 0.5) * 0.8;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // physics: spring + damping
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      velRef.current += -swayRef.current * 0.08; // spring
      velRef.current *= 0.92; // damping
      swayRef.current += velRef.current;
      setSway(swayRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onEnter = () => { velRef.current += 6; };
  const onClick = () => { velRef.current += (Math.random() > 0.5 ? 10 : -10); };
  const onMove = (e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - (r.left + r.width / 2);
    velRef.current += x * 0.04;
  };

  // rope length grows with scroll: 60px -> 70vh
  const [vh, setVh] = useState(800);
  useEffect(() => { setVh(window.innerHeight); const onR = () => setVh(window.innerHeight); window.addEventListener("resize", onR); return () => window.removeEventListener("resize", onR); }, []);
  const length = typeof window !== "undefined" ? 60 + progress * (Math.min(520, vh * 0.7) - 60) : 60;
  const w = 60, h = length;
  // curve control: sway + gentle sine along length
  const mid = h * 0.55;
  const cx = sway * 1.2;

  return (
    <div
      ref={wrapRef}
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      onClick={onClick}
      className="fixed top-0 right-3 sm:right-6 z-40 hidden md:block cursor-pointer select-none"
      style={{ height: h, width: w }}
      aria-hidden
      title="Tarik talinya!"
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        {/* shadow */}
        <path
          ref={pathRef}
          d={`M ${w / 2} 0 C ${w / 2 + cx * 0.3} ${mid * 0.5}, ${w / 2 + cx} ${mid}, ${w / 2 + cx * 0.5} ${h - 18}`}
          fill="none"
          stroke="rgba(0,0,0,0.18)"
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* rope */}
        <path
          d={`M ${w / 2} 0 C ${w / 2 + cx * 0.3} ${mid * 0.5}, ${w / 2 + cx} ${mid}, ${w / 2 + cx * 0.5} ${h - 18}`}
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={2.2}
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.35))" }}
        />
        <path
          d={`M ${w / 2} 0 C ${w / 2 + cx * 0.3} ${mid * 0.5}, ${w / 2 + cx} ${mid}, ${w / 2 + cx * 0.5} ${h - 18}`}
          fill="none"
          stroke="rgba(0,229,255,0.35)"
          strokeWidth={1}
          strokeLinecap="round"
          opacity={0.6}
        />
        {/* tassel / handle */}
        <g transform={`translate(${w / 2 + cx * 0.5}, ${h - 18})`}>
          <ellipse cx={0} cy={7} rx={8} ry={4} fill="rgba(0,0,0,0.25)" />
          <rect x={-3} y={-10} width={6} height={14} rx={3} fill="#E5E7EB" stroke="#CBD5E1" strokeWidth={0.5} />
          <rect x={-5} y={4} width={10} height={6} rx={2} fill="#00E5FF" opacity={0.9} />
          <line x1={-3} y1={10} x2={-3} y2={16} stroke="#CBD5E1" strokeWidth={1} />
          <line x1={0} y1={10} x2={0} y2={17} stroke="#CBD5E1" strokeWidth={1} />
          <line x1={3} y1={10} x2={3} y2={15} stroke="#CBD5E1" strokeWidth={1} />
        </g>
        {/* top knot */}
        <circle cx={w / 2} cy={2} r={5} fill="#1E293B" stroke="rgba(255,255,255,0.6)" strokeWidth={1} />
        <circle cx={w / 2} cy={2} r={2} fill="#00E5FF" />
      </svg>
    </div>
  );
}
