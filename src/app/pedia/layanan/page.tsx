// src/app/pedia/layanan/page.tsx — Daftar semua layanan (tab Layanan bottom nav).
import { headers } from "next/headers";
import Link from "next/link";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { ProductCard } from "@/components/pedia/PlatformGrid";

export const dynamic = "force-dynamic";

export default async function PediaServicesPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  let products: PediaCatalogProduct[] = [];
  try {
    const res = await fetch(`${proto}://${host}/api/pedia/catalog`, { next: { revalidate: 60 } });
    if (res.ok) products = (await res.json()).products ?? [];
  } catch { /* kosong */ }
  const byPlatform = new Map<string, PediaCatalogProduct[]>();
  for (const p of products) {
    const list = byPlatform.get(p.platform) ?? [];
    list.push(p);
    byPlatform.set(p.platform, list);
  }
  return (
    <div className="pt-8">
      <h1 className="font-display text-[22px] font-bold text-white sm:text-[32px]">Semua layanan</h1>
      {products.length === 0 && <p className="mt-4 text-sm text-white/55">Katalog segera hadir.</p>}
      {[...byPlatform].map(([plat, list]) => (
        <section key={plat} className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold capitalize text-white">{plat}</h2>
            <Link href={`/pedia/p/${plat}`} className="text-sm text-[#00E5FF]">Lihat semua →</Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <ProductCard key={p.slug} p={{ slug: p.slug, name: p.name, tagline: p.tagline, platform: p.platform, badges: [], minPrice: p.min_price }} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
