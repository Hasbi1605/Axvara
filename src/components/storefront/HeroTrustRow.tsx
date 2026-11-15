/** Baris trust kecil di bawah CTA hero — satu gaya untuk Market, Pedia dan Games (15 Nov 2026). */
export function HeroTrustRow({ items }: { items: readonly string[] }) {
  return <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tracking-wide text-white/40">
    {items.map((item, i) => <span key={item} className="contents">{i > 0 && <span aria-hidden="true" className="opacity-30">•</span>}<span>{item}</span></span>)}
  </div>;
}
