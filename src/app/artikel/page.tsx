import Link from "next/link";
import { queryAll } from "@/lib/db";
import { normalizeArticle } from "@/lib/articles";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Article = { id: number; slug: string; title: string; excerpt: string | null; cover_url: string | null; published_at: string | null };

async function getArticles(): Promise<Article[]> {
  // Query D1 langsung — jangan fetch HTTP /api/* dari Server Component.
  // fetch relatif ("/api/articles") gagal di Edge next-on-pages saat
  // NEXT_PUBLIC_BASE_URL kosong → catch → [] → "Belum ada artikel",
  // sedangkan /artikel/[slug] lolos karena query DB langsung.
  try {
    const rows = await queryAll("SELECT * FROM articles ORDER BY updated_at DESC, id DESC");
    return rows
      .map(normalizeArticle)
      .filter((a) => a.status === "published")
      .map((a) => ({
        id: Number(a.id),
        slug: String(a.slug),
        title: String(a.title),
        excerpt: (a.excerpt as string | null) ?? null,
        cover_url: (a.cover_url as string | null) ?? null,
        published_at: (a.published_at as string | null) ?? null,
      }));
  } catch { return []; }
}

export default async function ArtikelListPage() {
  const articles = await getArticles();
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="max-w-[720px]">
        <p className="text-[11px] tracking-[0.14em] text-[#00E5FF]/70 font-semibold uppercase">Artikel</p>
        <h1 className="mt-2 font-display font-bold text-[28px] sm:text-[36px] leading-none tracking-[-0.02em] text-white">Seputar AI dan teknologi</h1>
        <p className="mt-3 text-sm leading-6 text-white/55 max-w-[52ch]">Berita, panduan, dan insight praktis seputar produk digital serta perkembangan teknologi.</p>
      </div>

      {articles.length === 0 ? (
        <div className="mt-10 ax-glass-card rounded-[24px] p-8 sm:p-10 text-center">
          <p className="text-white font-medium">Belum ada artikel</p>
          <p className="text-sm text-white/50 mt-1">Artikel pertama segera terbit. Daftarkan email di footer agar tidak ketinggalan.</p>
        </div>
      ) : (
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {articles.map((a) => (
            <Link key={a.id} href={`/artikel/${a.slug}`} className="group ax-glass-card rounded-[20px] overflow-hidden hover:border-white/15 transition">
              <div className="aspect-[16/10] bg-white/5 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.cover_url ? <img src={a.cover_url} alt={a.title} className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-500" /> : <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/[0.04]" />}
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-[11px] tracking-[0.08em] text-white/40 uppercase">{a.published_at ? new Date(a.published_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : ""}</p>
                <h2 className="mt-1 font-semibold text-white leading-snug line-clamp-2 group-hover:text-white">{a.title}</h2>
                {a.excerpt && <p className="mt-1.5 text-sm leading-5 text-white/55 line-clamp-2">{a.excerpt}</p>}
                <span className="mt-3 inline-flex text-xs font-semibold text-[#00E5FF] group-hover:text-white">Baca →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
