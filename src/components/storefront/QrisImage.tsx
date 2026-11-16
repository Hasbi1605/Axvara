"use client";
// QRIS bergaya Pedia/Games: kotak putih, spinner saat memuat, tombol muat ulang
// bila gagal. Dipakai halaman pesanan Pedia dan Games.
import { useState } from "react";
import { InlineSpinner } from "@/components/storefront/Skeletons";

/** API mengirim URL absolut domain Market; CSP host Pedia/Games (img-src 'self')
 * memblokirnya. Path QRIS identik di semua host, jadi pakai same-origin. */
export const sameOriginQris = (url: string) => {
  try { const u = new URL(url, "https://x.invalid"); return u.pathname.startsWith("/api/payments/qris/") ? `${u.pathname}${u.search}` : url; } catch { return url; }
};

export function QrisImage({ src, alt, loadingLabel = "Memuat QRIS…", failedLabel = "QRIS gagal dimuat", retryLabel = "Muat ulang QRIS" }: { src: string; alt: string; loadingLabel?: string; failedLabel?: string; retryLabel?: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const url = attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;
  return (
    <div className="mx-auto mt-2 min-h-[224px] w-[224px] max-w-full rounded-xl bg-white p-2.5 sm:min-h-[240px] sm:w-[240px]">
      <div className="relative aspect-square w-full">
        {state !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#080C1E]/[0.04] text-[#080C1E]/60" role="status">
            {state === "loading" ? (
              <><InlineSpinner className="h-7 w-7" tone="dark" /><span className="text-xs font-medium">{loadingLabel}</span></>
            ) : (
              <>
                <span className="text-xs font-semibold text-[#080C1E]/80">{failedLabel}</span>
                <button type="button" onClick={() => { setState("loading"); setAttempt((n) => n + 1); }} className="h-9 rounded-xl bg-[#080C1E] px-4 text-xs font-bold text-white">{retryLabel}</button>
              </>
            )}
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={url} src={url} alt={alt} onLoad={() => setState("ready")} onError={() => setState("error")} className={`h-full w-full rounded-xl object-contain transition-opacity duration-300 ${state === "ready" ? "opacity-100" : "opacity-0"}`} />
      </div>
    </div>
  );
}
