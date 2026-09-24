"use client";
// Salinan produk di PDP: deskripsi, S&K berkelompok, cara aktivasi bernomor.
// Satu gaya untuk produk WR maupun non-WR (lihat src/lib/product-copy).
// [overflow-wrap:anywhere]: URL panjang (tutorial YouTube) tidak boleh
// melebarkan halaman mobile.
import { useId, useState, type ReactNode } from "react";
import { Check, ChevronDown, Info } from "lucide-react";
import {
  COPY_SECTION_TITLES,
  type ActivationGroup,
  type CopySection,
  type CopySectionKind,
  type ParsedDescription,
} from "@/lib/product-copy/format";

type Size = "sm" | "xs";

const DOT: Record<CopySectionKind, string> = {
  paket: "bg-[#00E5FF]",
  proses: "bg-[#00E5FF]/60",
  aturan: "bg-[#FFB800]",
  garansi: "bg-emerald-400",
};

export function DescriptionBody({ parsed, size = "sm" }: { parsed: ParsedDescription; size?: Size }) {
  const gap = size === "sm" ? "space-y-4" : "space-y-3";
  return (
    <div className={`${gap} [overflow-wrap:anywhere]`} data-testid="product-description-body">
      {parsed.blocks.map((block, i) =>
        block.type === "p" ? (
          <p key={i}>{block.text}</p>
        ) : (
          <ul key={i} className="space-y-2">
            {block.items.map((item, j) => (
              <li key={j} className="flex items-start gap-2.5">
                <Check aria-hidden className={`${size === "sm" ? "mt-0.5 h-4 w-4" : "mt-px h-3.5 w-3.5"} shrink-0 text-[#00E5FF]`} strokeWidth={2.5} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ),
      )}
      {parsed.sections.map((section, i) => (
        <div key={`s${i}`}>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-white/55">{section.title}</h3>
          <ul className="mt-2 space-y-1.5">
            {section.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function TermsBody({ sections, size = "sm" }: { sections: CopySection[]; size?: Size }) {
  return (
    <div className={`${size === "sm" ? "space-y-5" : "space-y-4"} [overflow-wrap:anywhere]`} data-testid="product-terms-body">
      {sections.map((section) => (
        <section key={section.kind} aria-label={COPY_SECTION_TITLES[section.kind]}>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-white/50">{COPY_SECTION_TITLES[section.kind]}</h3>
          <ul className={`mt-2 ${size === "sm" ? "space-y-2" : "space-y-1.5"}`}>
            {section.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span aria-hidden className={`mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[section.kind]}`} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ActivationBody({ groups, notes, size = "sm" }: { groups: ActivationGroup[]; notes: string[]; size?: Size }) {
  return (
    <div className={`${size === "sm" ? "space-y-4" : "space-y-3"} [overflow-wrap:anywhere]`} data-testid="product-activation-body">
      {groups.map((group, g) => (
        <div key={g}>
          {group.title && <h4 className="text-[11px] font-semibold uppercase tracking-wide text-white/55">{group.title}</h4>}
          <ol className={`${group.title ? "mt-2" : ""} space-y-2`}>
            {group.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`${size === "sm" ? "h-5 w-5 text-[11px]" : "h-[18px] w-[18px] text-[10px]"} flex shrink-0 items-center justify-center rounded-full bg-[#00E5FF]/15 font-bold text-[#00E5FF]`}
                >
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {notes.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-white/60">
          {notes.map((note, i) => (
            <li key={i} className="flex items-start gap-2">
              <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function activationStepCount(groups: ActivationGroup[]): number {
  return groups.reduce((n, group) => n + group.steps.length, 0);
}

/** Panel mobile yang terlipat secara default (S&K / cara aktivasi). */
export function MobileCollapsible({
  title,
  meta,
  icon,
  children,
}: {
  title: string;
  meta?: string | null;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const buttonId = `${baseId}-button`;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        {/* Label boleh membungkus: teks nowrap ikut menentukan lebar grid PDP
            dan membuat halaman mobile melebar ke samping. */}
        <span className="flex min-w-0 items-start gap-2 text-sm font-bold text-white">
          {icon}
          <span className="min-w-0 break-words">
            {title}
            {meta && <span className="font-semibold text-[#00E5FF]/80"> · {meta}</span>}
          </span>
        </span>
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-white/50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
        className="border-t border-white/10 px-4 pb-4 pt-3 text-xs leading-relaxed text-white/70"
      >
        {children}
      </div>
    </div>
  );
}
