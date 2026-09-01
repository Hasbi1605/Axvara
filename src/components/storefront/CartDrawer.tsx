"use client";
import { useCart } from "@/stores/cart";
import { formatRupiah } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
// TRY: iOS glyph — rollback: cp /tmp/CartDrawer.lucide.bak src/components/storefront/CartDrawer.tsx

export function CartDrawer() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const { items, drawerOpen, setDrawer, setQty, remove, subtotal } = useCart();
  const total = subtotal();

  if (isAdmin) return null;
  if (!drawerOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-[#080C1E]/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
      <div className="relative w-full max-w-[420px] h-full ax-glass-strong flex flex-col rounded-l-[24px] sm:rounded-l-[28px] overflow-hidden animate-[fadeInUp_0.32s_var(--ease-apple)]">
        <div className="h-[64px] flex items-center justify-between px-5 border-b border-white/10 shrink-0">
          <h2 className="font-display font-bold text-white">Keranjang ({items.length})</h2>
          <button onClick={() => setDrawer(false)} className="w-8 h-8 rounded-full ax-glass flex items-center justify-center text-white/70 hover:text-white" aria-label="Tutup">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/ios11/close-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-70" draggable={false} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {items.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl ax-glass flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/ios11/shopping-bag-32.png" alt="" width={28} height={28} className="w-7 h-7 object-contain brightness-0 invert opacity-30" draggable={false} />
              </div>
              <p className="mt-4 text-sm text-white/60">Keranjang masih kosong</p>
              <button onClick={() => setDrawer(false)} className="mt-3 text-sm text-[#00E5FF] font-medium">Jelajahi katalog →</button>
            </div>
          ) : (
            items.map((it) => (
              <div key={it.id} className="ax-glass rounded-2xl p-3 flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.image} alt={it.name} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white leading-4 line-clamp-2">{it.name}</p>
                  <p className="text-xs text-[#00E5FF] font-semibold mt-1">{formatRupiah(it.price)}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => setQty(it.id, it.qty - 1)} className="w-7 h-7 rounded-full ax-glass flex items-center justify-center text-white/70" aria-label="Kurangi">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/icons/ios11/minus-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-70" draggable={false} />
                    </button>
                    <span className="text-sm font-semibold text-white w-6 text-center">{it.qty}</span>
                    <button onClick={() => setQty(it.id, it.qty + 1)} className="w-7 h-7 rounded-full ax-glass flex items-center justify-center text-white/70" aria-label="Tambah">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/icons/ios11/plus-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-70" draggable={false} />
                    </button>
                    <button onClick={() => remove(it.id)} className="ml-auto text-white/40 hover:text-red-400" aria-label="Hapus">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/icons/ios11/trash-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-60" draggable={false} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="p-4 border-t border-white/10 ax-glass-strong">
            <div className="flex justify-between text-sm text-white/60">
              <span>Subtotal</span>
              <span className="font-display font-bold text-white text-base">{formatRupiah(total)}</span>
            </div>
            <Link
              href="/checkout"
              onClick={() => setDrawer(false)}
              className="mt-3 w-full h-[52px] rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold flex items-center justify-center gap-2 hover:bg-[#00D0E8] transition"
            >
              Checkout — {formatRupiah(total)}
            </Link>
            <p className="mt-2 text-center text-xs text-white/40">Bayar via QRIS / DANA / SeaBank</p>
          </div>
        )}
      </div>
    </div>
  );
}
