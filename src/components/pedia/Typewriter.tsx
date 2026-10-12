"use client";

import { useEffect, useState } from "react";

const PHRASES = ["Termurah", "Termudah", "Terpercaya"];

export function Typewriter() {
  const [text, setText] = useState(PHRASES[0]);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout>;
    let phrase = 0;
    let length = PHRASES[0].length;
    let deleting = true;
    const tick = () => {
      if (document.hidden || motion.matches) return;
      length += deleting ? -1 : 1;
      setText(PHRASES[phrase].slice(0, length));
      let delay = deleting ? 45 : 85;
      if (length === 0) { deleting = false; phrase = (phrase + 1) % PHRASES.length; delay = 260; }
      if (length === PHRASES[phrase].length) { deleting = true; delay = 2200; }
      timer = setTimeout(tick, delay);
    };
    const resume = () => {
      clearTimeout(timer);
      if (motion.matches) { setText(PHRASES[0]); phrase = 0; length = PHRASES[0].length; deleting = true; }
      else if (!document.hidden) timer = setTimeout(tick, 2200);
    };
    resume();
    document.addEventListener("visibilitychange", resume);
    motion.addEventListener("change", resume);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", resume); motion.removeEventListener("change", resume); };
  }, []);
  return <span className="block text-[#00E5FF]">
    <span className="sr-only">Termurah. Termudah. Terpercaya.</span>
    <span aria-hidden="true">{text}<span className="ml-1 inline-block h-[0.85em] w-[2px] bg-[#00E5FF]/60 align-baseline motion-safe:animate-pulse" /></span>
  </span>;
}
