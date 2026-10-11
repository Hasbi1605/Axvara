"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AXVARA_SERVICES, type AxvaraService } from "@/lib/site";

export function ServicesMenu({ active }: { active: AxvaraService }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
      if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const links = Array.from(panel.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
      const index = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1
        : event.key === "ArrowDown" ? (index + 1) % links.length : (index < 0 ? links.length - 1 : (index - 1 + links.length) % links.length);
      links[next]?.focus();
    }}>
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={id}
        onClick={(event) => { event.currentTarget.focus(); setOpen((value) => !value); }}
        className="flex min-h-[44px] items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 text-xs text-white/80 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] sm:gap-2 sm:px-3 sm:text-sm">
        <span className="text-left leading-4">Layanan<span className="block sm:inline"> AXVARA</span></span>
        <ChevronDown aria-hidden="true" className={`h-3 w-3 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <nav ref={panel} id={id} hidden={!open} aria-label="Layanan AXVARA"
        className="fixed left-4 right-4 top-[64px] z-50 mt-2 rounded-2xl border border-white/15 bg-[#0F1430] p-2 shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-[320px]">
        {AXVARA_SERVICES.map((service) => (
          <a key={service.id} href={service.href} aria-current={active === service.id ? "true" : undefined}
            onClick={() => setOpen(false)}
            className="flex min-h-[64px] items-center gap-3 rounded-xl px-3 py-3 text-white/80 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={service.icon} width={28} height={28} alt="" className="h-7 w-7 shrink-0 brightness-0 invert" />
            <span className="min-w-0"><span className="block text-sm font-semibold text-white">{service.name}</span><span className="block text-xs text-white/60">{service.description}</span></span>
          </a>
        ))}
      </nav>
    </div>
  );
}
