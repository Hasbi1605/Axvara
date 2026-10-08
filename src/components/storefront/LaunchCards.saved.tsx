// DISIMPAN 2026-10-08 (permintaan owner): kartu peluncuran Pedia + AI.
// Beranda kembali ke CommunityBar (Telegram + Grup WA). File ini tidak
// diimpor siapa pun — aktifkan lagi dengan rename ke LaunchCards.tsx +
// pasang <LaunchCards /> di home-client. Sebelumnya: src/components/storefront/LaunchCards.tsx (M6).
"use client";

import { useEffect, useRef, useState } from "react";

export function LaunchCards() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 -mt-1 mb-2">
      <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
        <a
          href="/pedia?utm_source=axvara&utm_medium=launch_card"
          className="ax-launch ax-glass-card group flex items-center gap-3 rounded-[20px] p-4 text-left transition hover:border-white/20"
          aria-label="Axvara Pedia — naikkan followers, likes dan views, bayar QRIS"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="rounded-full bg-[#FFB800]/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#FFCF55]">BARU</span>
              <span className="font-semibold text-[13px] text-white">Axvara Pedia</span>
            </span>
            <span className="mt-0.5 block text-[12px] text-white/55">Naikkan followers, likes & views</span>
            <PediaMiniDemo />
          </span>
          <span aria-hidden="true" className="shrink-0 text-white/30 transition group-hover:translate-x-0.5 group-hover:text-white">→</span>
        </a>
        <a
          href="/ai?utm_source=axvara&utm_medium=launch_card"
          className="ax-glass-card group flex items-center gap-3 rounded-[20px] border border-white/10 p-4 text-left transition hover:border-white/20"
          aria-label="Axvara AI segera hadir — API GPT, Claude, DeepSeek bayar QRIS, daftar waitlist"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white/60">SEGERA</span>
              <span className="font-semibold text-[13px] text-white">Axvara AI</span>
            </span>
            <span className="mt-0.5 block text-[12px] text-white/55">API GPT, Claude, DeepSeek · bayar QRIS</span>
            <AiMiniDemo />
          </span>
          <span aria-hidden="true" className="shrink-0 text-white/30 transition group-hover:translate-x-0.5 group-hover:text-white">→</span>
        </a>
      </div>
    </div>
  );
}

/** Mini-demo Pedia: angka 1.204 → 1.704 naik 1,6 dtk, jeda 3 dtk, ulang.
 *  Mulai saat terlihat (IntersectionObserver), berhenti saat tab tersembunyi. */
function PediaMiniDemo() {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(1204);
  useEffect(() => {
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let visible = false;
    let stopped = false;
    const run = () => {
      if (stopped || !visible || document.hidden) {
        timer = setTimeout(run, 1000);
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / 1600);
        setN(Math.round(1204 + 500 * p));
        if (p < 1) raf = requestAnimationFrame(step);
        else timer = setTimeout(() => { setN(1204); timer = setTimeout(run, 3000); }, 3000);
      };
      raf = requestAnimationFrame(step);
    };
    const el = ref.current;
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? false;
      if (visible && !timer && n === 1204) run();
    });
    if (el) io.observe(el);
    const onVis = () => { if (!document.hidden && visible && !timer) run(); };
    document.addEventListener("visibilitychange", onVis);
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: object) => void }).requestIdleCallback;
    if (idle) idle(() => run());
    else timer = setTimeout(run, 1200);
    return () => {
      stopped = true;
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span ref={ref} aria-hidden="true" className="mt-1.5 block font-mono text-[11px] text-white/45" style={{ fontVariantNumeric: "tabular-nums" }}>
      {n.toLocaleString("id-ID")} followers → 1.704
    </span>
  );
}

/** Mini-demo AI: ketikan 28ms/karakter + kursor kedip, ulang tiap 6 dtk. */
function AiMiniDemo() {
  const full = "› Halo! Ada yang bisa kubantu…";
  const [text, setText] = useState("");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const type = (i: number) => {
      if (stopped) return;
      setText(full.slice(0, i));
      if (i <= full.length) timer = setTimeout(() => type(i + 1), 28);
      else timer = setTimeout(() => type(0), 6000);
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: object) => void }).requestIdleCallback;
    if (idle) idle(() => type(0));
    else timer = setTimeout(() => type(0), 1200);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span aria-hidden="true" className="mt-1.5 block truncate font-mono text-[11px] text-white/45">
      {text}<span className="animate-pulse">▌</span>
    </span>
  );
}
