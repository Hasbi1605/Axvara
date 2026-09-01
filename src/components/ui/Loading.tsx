"use client";

export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-white/20 border-t-white ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function LoadingOverlay({ label = "Memuat…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-white/70">
      <Spinner size={18} />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/[0.06] border border-white/5 ${className}`} />;
}

export function PageLoader({ label = "Memuat halaman…" }: { label?: string }) {
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-16 flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-2xl ax-glass flex items-center justify-center">
        <Spinner size={22} />
      </div>
      <p className="text-sm text-white/50">{label}</p>
    </div>
  );
}

export function ButtonSpinner() {
  return <Spinner size={16} className="border-white/30 border-t-[#080C1E]" />;
}
