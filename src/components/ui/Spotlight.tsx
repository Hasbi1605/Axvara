"use client";
import { useEffect, useRef } from "react";

/**
 * Spotlight — soft light that follows cursor, Apple-style.
 * - Big radial gradients, very low opacity, blur, lerped with rAF so it glides
 * - Only on pointer: fine (desktop), auto-disabled on touch / reduced-motion
 */
export function Spotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ x: -9999, y: -9999 });
  const cur = useRef({ x: -9999, y: -9999 });
  const raf = useRef<number | null>(null);
  const visible = useRef(false);

  useEffect(() => {
    const isFine = window.matchMedia("(pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!isFine || reduce) return;

    const el = ref.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
      if (!visible.current) {
        cur.current.x = e.clientX;
        cur.current.y = e.clientY;
        visible.current = true;
        el.style.opacity = "1";
      }
    };
    const onLeave = () => {
      visible.current = false;
      el.style.opacity = "0";
    };

    const tick = () => {
      // no delay — snap straight to cursor
      cur.current.x = target.current.x;
      cur.current.y = target.current.y;
      el.style.transform = `translate3d(${cur.current.x}px, ${cur.current.y}px, 0) translate(-50%, -50%)`;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("mouseleave", onLeave);

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[1] hidden md:block will-change-transform"
      style={{
        width: 420,
        height: 420,
        opacity: 0,
        transition: "opacity 0.45s ease",
        transform: "translate3d(-9999px, -9999px, 0) translate(-50%, -50%)",
      }}
    >
      {/* Layer 1 — darker, smaller white aura */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 310,
          height: 310,
          background: "radial-gradient(circle at center, rgba(255,255,255,0.042), rgba(255,255,255,0.011) 40%, transparent 74%)",
          filter: "blur(12px)",
        }}
      />
      {/* Layer 2 — darker cyan whisper */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 210,
          height: 210,
          background: "radial-gradient(circle at center, rgba(0,229,255,0.065), rgba(0,229,255,0.018) 44%, transparent 76%)",
          filter: "blur(10px)",
        }}
      />
      {/* Layer 3 — small dim core */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 74,
          height: 74,
          background: "radial-gradient(circle at center, rgba(255,255,255,0.085), transparent 70%)",
          filter: "blur(5px)",
        }}
      />
    </div>
  );
}
