import Link from "next/link";
import { notFound } from "next/navigation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Article = { slug: string; title: string; excerpt: string | null; cover_url: string | null; content: string; published_at: string | null };

async function getArticle(slug: string): Promise<Article | null> {
  try {
    const r = await fetch(`/api/articles/${encodeURIComponent(slug)}`, { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) {
      // Fallback: try query via list
      const r2 = await fetch(`/api/articles?q=${encodeURIComponent(slug)}`, { cache: "no-store" }).catch(() => null);
      if (!r2 || !r2.ok) return null;
      const j2 = await r2.json().catch(() => ({}));
      const found = (j2.articles as Article[])?.find((a) => a.slug === slug);
      return found ?? null;
    }
    const j = await r.json().catch(() => ({}));
    return (j.article as Article) ?? j.articles?.[0] ?? null;
  } catch { return null; }
}

function renderContent(md: string) {
  // Minimal markdown: paragraphs, **bold**, - list, ## headings
  const lines = md.split("\n");
  const els: React.ReactNode[] = [];
  let liBuf: string[] = [];
  const flushLi = () => {
    if (liBuf.length) {
      els.push(<ul key={`ul-${els.length}`} className="list-disc pl-5 space-y-1.5 my-4 text-[15px] leading-[1.7] text-white/75">{liBuf.map((t, i) => <li key={i}>{inline(t)}</li>)}</ul>);
      liBuf = [];
    }
  };
  const inline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => p.startsWith("**") ? <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>);
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) { flushLi(); els.push(<div key={`sp-${idx}`} className="h-3" />); return; }
    if (line.startsWith("## ")) { flushLi(); els.push(<h2 key={idx} className="mt-8 font-display font-bold text-[20px] text-white tracking-[-0.01em]">{line.slice(3)}</h2>); return; }
    if (line.startsWith("# ")) { flushLi(); els.push(<h1 key={idx} className="mt-6 font-display font-bold text-[22px] text-white">{line.slice(2)}</h1>); return; }
    if (line.startsWith("- ") || line.startsWith("* ")) { liBuf.push(line.slice(2)); return; }
    flushLi();
    els.push(<p key={idx} className="text-[15px] leading-[1.75] text-white/75">{inline(line)}</p>);
  });
  flushLi();
  return <>{els}</>;
}

export default async function ArtikelDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) return notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt ?? article.title,
    image: article.cover_url ?? undefined,
    datePublished: article.published_at ?? undefined,
    author: { "@type": "Organization", name: "AXVARA" },
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <Link href="/artikel" className="text-sm text-white/50 hover:text-white">← Semua artikel</Link>
      <p className="mt-6 text-[11px] tracking-[0.14em] text-[#00E5FF]/70 font-semibold uppercase">Artikel</p>
      <h1 className="mt-2 font-display font-bold text-[28px] sm:text-[36px] leading-[1.05] tracking-[-0.02em] text-white">{article.title}</h1>
      {article.excerpt && <p className="mt-3 text-[15px] leading-6 text-white/60">{article.excerpt}</p>}
      {article.published_at && <p className="mt-2 text-xs text-white/35">{new Date(article.published_at).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · AXVARA</p>}
      {article.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={article.cover_url} alt={article.title} className="mt-6 w-full rounded-[20px] object-cover aspect-[16/9] bg-white/5" />
      )}
      <div className="mt-6">{renderContent(article.content)}</div>

      <div className="mt-10 flex flex-wrap gap-2">
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`https://axvara.pages.dev/artikel/${article.slug}`)}`} target="_blank" className="h-9 px-4 rounded-full ax-glass-card text-sm text-white/70 hover:text-white">Share Facebook</a>
        <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(article.title)}&url=${encodeURIComponent(`https://axvara.pages.dev/artikel/${article.slug}`)}`} target="_blank" className="h-9 px-4 rounded-full ax-glass-card text-sm text-white/70 hover:text-white">Share X</a>
        <a href={`https://wa.me/?text=${encodeURIComponent(article.title + " https://axvara.pages.dev/artikel/" + article.slug)}`} target="_blank" className="h-9 px-4 rounded-full bg-[#25D366] text-white text-sm font-bold">Share WA</a>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
