"use client";

// Skeleton per halaman storefront. Satu sumber bentuk: dipakai overlay
// navigasi (NavigationProgress) SEKALIGUS state loading di halaman itu
// sendiri, jadi peralihan skeleton → skeleton → konten tidak melompat.
import { SLOW_MS, useLoadingStage } from "@/hooks/useLoadingStage";

export function Bone({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`ax-skeleton ${className}`} />;
}

export function InlineSpinner({ className = "w-4 h-4", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const colors = tone === "dark" ? "border-[#080C1E]/20 border-t-[#080C1E]" : "border-white/20 border-t-[#00E5FF]";
  return <span aria-hidden className={`inline-block shrink-0 rounded-full border-2 animate-spin ${colors} ${className}`} />;
}

/** Muncul setelah 8 dtk menunggu agar layar tidak terlihat macet tanpa kabar. */
export function SlowNetworkHint({ active = true, message = "Koneksi sepertinya lambat — halaman masih dimuat, jangan ditutup." }: { active?: boolean; message?: string }) {
  const stage = useLoadingStage(active, [SLOW_MS]);
  if (stage < 1) return null;
  return (
    <p role="status" className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-[#FFD66B]/90">
      <InlineSpinner className="w-3.5 h-3.5" />
      {message}
    </p>
  );
}

function Status({ label }: { label: string }) {
  return <span role="status" className="sr-only">{label}</span>;
}

export function CatalogGridSkeleton({ count = 8, className = "mt-6" }: { count?: number; className?: string }) {
  return (
    <div className={`${className} grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5`} aria-label="Memuat katalog">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="ax-glass-card rounded-[16px] sm:rounded-[22px] p-1.5 sm:p-2">
          <Bone className="aspect-[4/3] rounded-[12px] sm:rounded-[16px]" />
          <div className="p-2 sm:p-2.5 space-y-2">
            <Bone className="h-2.5 w-16 rounded-full" />
            <Bone className="h-3.5 w-[85%] rounded-full" />
            <Bone className="h-4 w-20 rounded-full" />
            <div className="grid grid-cols-2 gap-1.5 pt-1"><Bone className="h-8 rounded-[10px]" /><Bone className="h-8 rounded-[10px]" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HomeSkeleton({ slowHint = true }: { slowHint?: boolean }) {
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-10">
      <Status label="Memuat beranda…" />
      <div className="max-w-3xl space-y-3">
        <Bone className="h-10 sm:h-14 w-[85%] rounded-2xl" />
        <Bone className="h-10 sm:h-14 w-[70%] rounded-2xl" />
        <Bone className="mt-2 h-4 w-[60%] rounded-full" />
        <div className="flex gap-3 pt-3"><Bone className="h-11 w-36 rounded-full" /><Bone className="h-11 w-36 rounded-full" /></div>
      </div>
      <div className="mt-12 flex items-center justify-between"><Bone className="h-6 w-44 rounded-xl" /><Bone className="h-3 w-24 rounded-full" /></div>
      <div className="mt-4 flex gap-2 overflow-hidden">{Array.from({ length: 5 }, (_, i) => <Bone key={i} className="h-9 w-24 shrink-0 rounded-full" />)}</div>
      <CatalogGridSkeleton />
      {slowHint && <SlowNetworkHint />}
    </div>
  );
}

export function ProductDetailSkeleton({ slowHint = true }: { slowHint?: boolean }) {
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8" aria-busy="true">
      <Status label="Memuat detail produk…" />
      <Bone className="h-5 w-24 rounded-full" />
      <div className="mt-6 grid lg:grid-cols-[1fr_38%] xl:grid-cols-[1fr_minmax(360px,420px)] gap-6 lg:gap-8 items-start">
        <div className="ax-glass-card rounded-[24px] p-2 sm:p-3">
          <Bone className="aspect-[4/3] rounded-2xl" />
          <div className="mt-3 flex gap-2"><Bone className="w-[90px] h-[68px] rounded-xl" /><Bone className="w-[90px] h-[68px] rounded-xl" /><Bone className="w-[90px] h-[68px] rounded-xl" /></div>
        </div>
        <div className="ax-glass-card rounded-[24px] p-5 sm:p-7 space-y-4">
          <Bone className="h-3 w-28 rounded-full" />
          <Bone className="h-7 w-[85%] rounded-xl" />
          <Bone className="h-8 w-40 rounded-xl" />
          <Bone className="h-4 w-full rounded-full" />
          <div className="space-y-2 pt-2"><Bone className="h-16 rounded-xl" /><Bone className="h-16 rounded-xl" /></div>
          <Bone className="h-[52px] rounded-xl" />
          <Bone className="h-12 rounded-xl" />
        </div>
      </div>
      {slowHint && <SlowNetworkHint />}
    </div>
  );
}

export function CheckoutSkeleton({ label = "Memuat checkout…", slowHint = true }: { label?: string; slowHint?: boolean }) {
  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8" aria-busy="true">
      <Status label={label} />
      <Bone className="h-7 w-36 rounded-xl" />
      <Bone className="mt-2 h-4 w-64 max-w-full rounded-full" />
      <div className="mt-6 grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="ax-glass-card rounded-[24px] p-5 sm:p-6 space-y-4">
          <Bone className="h-4 w-40 rounded-full" />
          <Bone className="h-[72px] rounded-2xl" />
          <Bone className="h-[72px] rounded-2xl" />
          <Bone className="h-4 w-32 rounded-full mt-4" />
          <Bone className="h-11 rounded-xl" />
          <Bone className="h-11 rounded-xl" />
        </div>
        <div className="hidden lg:block ax-glass-card rounded-[24px] p-6 space-y-4">
          <Bone className="h-4 w-44 rounded-full" />
          <div className="flex gap-3"><Bone className="w-12 h-12 rounded-xl" /><div className="flex-1 space-y-2"><Bone className="h-3 w-full rounded-full" /><Bone className="h-3 w-1/2 rounded-full" /></div></div>
          <Bone className="h-12 rounded-xl" />
        </div>
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-sm text-white/55"><InlineSpinner />{label}</p>
      {slowHint && <SlowNetworkHint />}
    </div>
  );
}

export function OrderStatusSkeleton({ label = "Memuat pesanan…", slowHint = true }: { label?: string; slowHint?: boolean }) {
  return (
    <div className="mx-auto max-w-[640px] px-4 py-10 sm:px-6" aria-busy="true">
      <div className="ax-glass-card rounded-[28px] p-6 sm:p-8 flex flex-col items-center">
        <Bone className="h-16 w-16 rounded-full" />
        <Bone className="mt-4 h-7 w-64 max-w-full rounded-xl" />
        <Bone className="mt-3 h-4 w-44 rounded-full" />
        <Bone className="mt-3 h-7 w-52 rounded-full" />
        <Bone className="mt-6 aspect-square w-full max-w-[300px] rounded-2xl" />
        <p role="status" className="mt-5 flex items-center gap-2 text-sm text-white/55"><InlineSpinner />{label}</p>
        {slowHint && <SlowNetworkHint message="Koneksi sepertinya lambat — status pesanan masih dimuat, jangan ditutup." />}
      </div>
    </div>
  );
}

export function ContentPageSkeleton({ slowHint = true }: { slowHint?: boolean }) {
  return (
    <div className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14" aria-busy="true">
      <Status label="Memuat halaman…" />
      <Bone className="h-9 w-[60%] rounded-2xl" />
      <Bone className="mt-4 h-4 w-[80%] rounded-full" />
      <Bone className="mt-2 h-4 w-[55%] rounded-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-36 rounded-[20px]" />)}
      </div>
      {slowHint && <SlowNetworkHint />}
    </div>
  );
}

const CONTENT_ROUTES = ["/artikel", "/lacak-pesanan", "/cara-order", "/garansi-replace"];

/** Jenis skeleton rute tujuan; null = cukup bar (mis. /admin punya loader sendiri). */
export function routeSkeletonKind(pathname: string): "home" | "product" | "checkout" | "order" | "content" | null {
  if (pathname === "/") return "home";
  if (/^\/produk\/[^/]+/.test(pathname)) return "product";
  if (pathname === "/checkout") return "checkout";
  if (/^\/pesanan\/[^/]+/.test(pathname)) return "order";
  if (CONTENT_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return "content";
  return null;
}

/** Overlay navigasi: pesan lambat datang dari pil global, bukan dari skeleton. */
export function RouteSkeleton({ pathname }: { pathname: string }) {
  switch (routeSkeletonKind(pathname)) {
    case "home": return <HomeSkeleton slowHint={false} />;
    case "product": return <ProductDetailSkeleton slowHint={false} />;
    case "checkout": return <CheckoutSkeleton slowHint={false} />;
    case "order": return <OrderStatusSkeleton slowHint={false} />;
    case "content": return <ContentPageSkeleton slowHint={false} />;
    default: return null;
  }
}
