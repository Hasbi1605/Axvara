"use client";
import { useEffect, useRef } from "react";

/**
 * Spotlight v2 — Event-driven, zero idle CPU.
 *
 * - Position updates ONLY when pointer actually moves.
 * - No continuous requestAnimationFrame loop.
 * - Single RAF per pointermove event for compositor-friendly timing.
 * - Only on pointer: fine (desktop), auto-disabled on touch / reduced-motion.
 */
export function Spotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const pendingRaf = useRef<number | null>(null);

  useEffect(() => {
    const isFine = window.matchMedia("(pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!isFine || reduce) return;

    const el = ref.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      // Cancel any pending frame to coalesce rapid pointermove events
      if (pendingRaf.current) cancelAnimationFrame(pendingRaf.current);

      pendingRaf.current = requestAnimationFrame(() => {
        el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
        if (el.style.opacity !== "1") el.style.opacity = "1";
        pendingRaf.current = null;
      });
    };

    const onLeave = () => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      el.style.opacity = "0";
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("mouseleave", onLeave);

    return () => {
      if (pendingRaf.current) cancelAnimationFrame(pendingRaf.current);
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
      {/* Layer 1 — white aura */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 310,
          height: 310,
          background: "radial-gradient(circle at center, rgba(255,255,255,0.042), rgba(255,255,255,0.011) 40%, transparent 74%)",
          filter: "blur(12px)",
        }}
      />
      {/* Layer 2 — cyan whisper */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 210,
          height: 210,
          background: "radial-gradient(circle at center, rgba(0,229,255,0.065), rgba(0,229,255,0.018) 44%, transparent 76%)",
          filter: "blur(10px)",
        }}
      />
      {/* Layer 3 — core */}
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
