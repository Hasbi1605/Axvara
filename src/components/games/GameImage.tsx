"use client";
import { useState } from "react";

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "G";
}

/** SK rejects cross-site Referer headers; keep every Games image on this path. */
export function gamesImageProps(src: string, onError: () => void, eager = false) {
  return { src, referrerPolicy: "no-referrer" as const, loading: eager ? "eager" as const : "lazy" as const, decoding: "async" as const, onError };
}

export function GameImage({ src, name, className = "", imageClassName = "", eager = false }: {
  src: string | null; name: string; className?: string; imageClassName?: string; eager?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return <span className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-[#0F1430] ${className}`}>
    {src && src !== failedSrc
      // eslint-disable-next-line @next/next/no-img-element
      ? <img {...gamesImageProps(src, () => setFailedSrc(src), eager)} alt="" className={`h-full w-full object-cover ${imageClassName}`} />
      : <span aria-hidden="true" className="font-display text-[inherit] font-bold tracking-wide text-white/70">{initials(name)}</span>}
  </span>;
}
