"use client";

// Overlay transisi TENGAH HALAMAN untuk perpindahan Market ↔ Pedia.
//
// Kedua aplikasi hidup di origin berbeda (axvara.tech vs pedia.axvara.tech),
// jadi navigasinya selalu muat-ulang penuh — indikator route-transition Next
// (NavigationProgress) tidak bisa menolong: layar bawaan browser yang tampil
// sampai HTML host tujuan tiba. Komponen ini menutup celah itu dari SISI ASAL:
// klik tautan lintas-host ditangkap SEBELUM navigasi keras, overlay berisi
// logo aplikasi tujuan + spinner + teks kecil "Memuat AXVARA Pedia/Market"
// ditampilkan menutupi layar, lalu navigasi berjalan di baliknya. Layar tujuan
// mengambil alih begitu siap — tidak ada kedipan putih di tengah.
// Dipasang di kedua layout (shop + pedia) agar dua arah sama terawat.

import { useEffect, useRef, useState } from "react";
import { SITE } from "@/lib/site";
import { BrandLoader } from "@/components/ui/BrandLoader";

type Dest = "market" | "pedia";

const DEST_INFO: Record<Dest, { label: string; mark: string }> = {
  market: { label: "Memuat AXVARA Market", mark: SITE.marketMark },
  pedia: { label: "Memuat AXVARA Pedia", mark: SITE.pediaMark },
};

function crossAppTarget(anchor: HTMLAnchorElement): Dest | null {
  if (anchor.target && anchor.target !== "_self") return null;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  const here = window.location.hostname;
  const there = url.hostname;
  if (there === here) return null;
  if (there === new URL(SITE.pediaUrl).hostname) return "pedia";
  if (there === new URL(SITE.webUrl).hostname) return "market";
  return null;
}

export function CrossAppTransition() {
  const [dest, setDest] = useState<Dest | null>(null);
  const navigating = useRef(false);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (navigating.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download") || anchor.hasAttribute("data-no-progress")) return;
      const target = crossAppTarget(anchor);
      if (!target) return;
      // Biarkan navigasi keras berjalan (jangan preventDefault): overlay hanya
      // menutupi masa tunggu sampai dokumen tujuan menggantikan halaman ini.
      navigating.current = true;
      setDest(target);
    };
    // pageshow = kembali via bfcache (tombol Back): halaman asal dipulihkan
    // dari cache dengan overlay masih menyala — matikan agar tidak macet.
    const onPageShow = () => {
      navigating.current = false;
      setDest(null);
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  if (!dest) return null;
  const info = DEST_INFO[dest];
  return (
    <div
      data-testid="cross-app-transition"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#080C1E]/95 backdrop-blur-md animate-[axFadeIn_0.18s_ease-out]"
    >
      <BrandLoader mark={info.mark} label={info.label} logoClassName="brightness-0 invert" testId="cross-app-loader" />
    </div>
  );
}
