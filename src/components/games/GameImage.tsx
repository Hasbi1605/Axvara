"use client";
import { useState } from "react";

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "G";
}

/** Shared loading/error behavior for local game art and admin uploads. */
export function gamesImageProps(src: string, onError: () => void, eager = false) {
  return { src, referrerPolicy: "no-referrer" as const, loading: eager ? "eager" as const : "lazy" as const, decoding: "async" as const, onError };
}

export function GameImage({ src, name, className = "", imageClassName = "", eager = false, framed = true, banner = false, fallbackSrc = null }: {
  src: string | null; name: string; className?: string; imageClassName?: string; eager?: boolean;
  framed?: boolean; banner?: boolean; fallbackSrc?: string | null;
}) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const primary = src && !failedSources.includes(src) ? src : null;
  const image = primary ?? (banner && fallbackSrc && !failedSources.includes(fallbackSrc) ? fallbackSrc : null);
  const generated = banner && !primary;
  return <span data-game-image={generated ? "generated-banner" : image ? "art" : "monogram"} className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-[#0F1430] ${framed ? "rounded-2xl border border-white/10 bg-gradient-to-br from-[#080C1E] to-[#00E5FF]/10 transition-shadow hover:shadow-[0_0_20px_rgba(0,229,255,.12)] group-hover:shadow-[0_0_20px_rgba(0,229,255,.12)] motion-reduce:transition-none" : ""} ${className}`}>
    {image
      // eslint-disable-next-line @next/next/no-img-element
      ? <img {...gamesImageProps(image, () => setFailedSources((previous) => [...previous, image]), eager)} alt="" className={`h-full w-full object-cover ${generated ? "scale-125 blur-[48px]" : ""} ${imageClassName}`} />
      : <span aria-hidden="true" className="font-display text-[inherit] font-bold tracking-wide text-white/70">{initials(name)}</span>}
    {generated && <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,#080C1E,rgba(8,12,30,.4)),linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] bg-[size:auto,32px_32px,32px_32px]" />}
  </span>;
}
