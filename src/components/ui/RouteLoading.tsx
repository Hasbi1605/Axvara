"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";

export function RouteLoading() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const prev = useRef<string>("");

  useEffect(() => {
    const key = `${pathname}?${searchParams.toString()}`;
    if (prev.current && prev.current !== key) {
      setLoading(true);
      const t = setTimeout(() => setLoading(false), 420);
      return () => clearTimeout(t);
    }
    prev.current = key;
    const t = setTimeout(() => setLoading(false), 160);
    return () => clearTimeout(t);
  }, [pathname, searchParams]);

  if (!loading) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[70] h-[2px] overflow-hidden pointer-events-none">
      <div className="h-full w-[42%] bg-[#00E5FF] shadow-[0_0_10px_rgba(0,229,255,0.9)] animate-[routeBar_0.9s_var(--ease-apple)_infinite]" />
      <style>{`@keyframes routeBar{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}`}</style>
    </div>
  );
}
