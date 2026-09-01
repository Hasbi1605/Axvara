"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Props = {
  tab: "products" | "orders";
  onTab: (t: "products" | "orders") => void;
  total?: number;
  pending?: number;
};

export function AdminNavbar({ tab, onTab, total = 0, pending = 0 }: Props) {
  const router = useRouter();
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    router.replace("/");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070a1e]/80 backdrop-blur-xl">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 h-[56px] flex items-center gap-4">
        <Link href="/admin" className="flex items-center gap-2.5 shrink-0">
          <span className="w-7 h-6 text-white flex items-center justify-center">
            <svg viewBox="0 0 120 110" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" shapeRendering="geometricPrecision" aria-hidden>
              <path d="M60 4 L6.5 104 L113.5 104 Z" />
              <path d="M60 4 L60 49.5" />
              <path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z" />
              <path d="M35.8 78.5 L84.2 78.5" />
              <path d="M35.8 78.5 L6.5 104" />
              <path d="M84.2 78.5 L113.5 104" />
            </svg>
          </span>
          <span className="font-display font-semibold tracking-[0.14em] text-sm text-white">AXVARA</span>
          <span className="hidden sm:inline-flex items-center rounded-full bg-white/10 border border-white/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-white/60">ADMIN</span>
        </Link>

        <nav className="ml-2 sm:ml-6 flex items-center gap-1.5">
          <button
            onClick={() => onTab("products")}
            className={`h-8 px-3.5 rounded-full text-xs font-bold border transition ${tab === "products" ? "bg-white text-[#070a1e] border-white" : "text-white/65 border-white/10 hover:text-white hover:bg-white/10"}`}
          >
            Produk {total ? `· ${total}` : ""}
          </button>
          <button
            onClick={() => onTab("orders")}
            className={`h-8 px-3.5 rounded-full text-xs font-bold border transition ${tab === "orders" ? "bg-white text-[#070a1e] border-white" : "text-white/65 border-white/10 hover:text-white hover:bg-white/10"}`}
          >
            Pesanan {pending ? `· ${pending}` : ""}
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link href="/" className="hidden sm:inline-flex h-8 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 hover:text-white items-center">
            Lihat toko
          </Link>
          <button onClick={logout} className="h-8 px-3 rounded-full bg-white/10 border border-white/10 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/15">
            Keluar
          </button>
        </div>
      </div>
    </header>
  );
}
