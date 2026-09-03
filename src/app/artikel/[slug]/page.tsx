import Link from "next/link";
import { marked } from "marked";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { normalizeArticle } from "@/lib/articles";
import { queryFirst } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Article = {
  slug: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  content: string;
  published_at: string | null;
  source_urls: string[];
  author_name?: string | null;
};

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: { href?: string; src?: string; alt?: string; level?: number };
  marks?: { type?: string; attrs?: { href?: string } }[];
  content?: JsonNode[];
};

type MarkdownToken = {
  type: string;
  text?: string;
  depth?: number;
  href?: string;
  ordered?: boolean;
  start?: number | "";
  tokens?: MarkdownToken[];
  items?: MarkdownToken[];
  header?: MarkdownToken[];
  rows?: MarkdownToken[][];
};

async function getArticle(slug: string): Promise<Article | null> {
  const row = await queryFirst("SELECT * FROM articles WHERE slug=?", slug);
  if (!row) return null;
  const article = normalizeArticle(row);
  if (article.status !== "published") return null;
  return article as unknown as Article;
}

function safeImageSource(source?: string) {
  return Boolean(source?.startsWith("/r2/articles/content/"));
}

function renderLegacyJson(value: string): ReactNode | null {
  let document: JsonNode;
  try {
    document = JSON.parse(value) as JsonNode;
  } catch {
    return null;
  }
  if (document.type !== "doc") return null;

  const render = (node: JsonNode, key: string): ReactNode => {
    const children = node.content?.map((child, index) => render(child, `${key}-${index}`));
    if (node.type === "text") {
      let output: ReactNode = node.text ?? "";
      for (const [index, mark] of (node.marks ?? []).entries()) {
        if (mark.type === "bold") output = <strong key={`${key}-b${index}`} className="font-semibold text-white">{output}</strong>;
        if (mark.type === "italic") output = <em key={`${key}-i${index}`}>{output}</em>;
        if (mark.type === "strike") output = <del key={`${key}-s${index}`}>{output}</del>;
        if (mark.type === "link" && mark.attrs?.href?.startsWith("https://")) {
          output = <a key={`${key}-a${index}`} href={mark.attrs.href} target="_blank" rel="noreferrer" className="text-[#00E5FF] underline">{output}</a>;
        }
      }
      return output;
    }
    if (node.type === "heading") {
      return node.attrs?.level === 3
        ? <h3 key={key} className="mt-7 text-lg font-bold text-white">{children}</h3>
        : <h2 key={key} className="mt-8 font-display text-xl font-bold text-white">{children}</h2>;
    }
    if (node.type === "paragraph") return <p key={key} className="my-3 text-[15px] leading-[1.8] text-white/75">{children}</p>;
    if (node.type === "bulletList") return <ul key={key} className="my-4 list-disc space-y-1.5 pl-6 text-white/75">{children}</ul>;
    if (node.type === "orderedList") return <ol key={key} className="my-4 list-decimal space-y-1.5 pl-6 text-white/75">{children}</ol>;
    if (node.type === "listItem") return <li key={key}>{children}</li>;
    if (node.type === "blockquote") return <blockquote key={key} className="my-5 border-l-2 border-[#00E5FF] pl-4 text-white/65">{children}</blockquote>;
    if (node.type === "horizontalRule") return <hr key={key} className="my-8 border-white/10" />;
    if (node.type === "hardBreak") return <br key={key} />;
    if (node.type === "image" && safeImageSource(node.attrs?.src)) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img key={key} src={node.attrs?.src} alt={node.attrs?.alt ?? ""} className="my-6 w-full rounded-xl" />;
    }
    return <span key={key}>{children}</span>;
  };
  return document.content?.map((node, index) => render(node, String(index))) ?? null;
}

function ArticleBody({ content }: { content: string }) {
  const legacy = renderLegacyJson(content);
  if (legacy) return <>{legacy}</>;
  const tokens = marked.lexer(content, { gfm: true, breaks: false }) as unknown as MarkdownToken[];

  const renderTokens = (items: MarkdownToken[] | undefined, prefix: string): ReactNode[] => (
    (items ?? []).map((token, index) => {
      const key = `${prefix}-${index}`;
      const children = renderTokens(token.tokens, `${key}-c`);
      if (token.type === "space" || token.type === "html") return null;
      if (token.type === "text" || token.type === "escape") return token.tokens ? <span key={key}>{children}</span> : token.text ?? "";
      if (token.type === "strong") return <strong key={key} className="font-semibold text-white">{children}</strong>;
      if (token.type === "em") return <em key={key}>{children}</em>;
      if (token.type === "del") return <del key={key}>{children}</del>;
      if (token.type === "codespan") return <code key={key} className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-[#00E5FF]">{token.text}</code>;
      if (token.type === "br") return <br key={key} />;
      if (token.type === "link") return token.href?.startsWith("https://")
        ? <a key={key} href={token.href} target="_blank" rel="noreferrer" className="text-[#00E5FF] underline decoration-[#00E5FF]/40 underline-offset-2">{children}</a>
        : <span key={key}>{children}</span>;
      if (token.type === "image") return safeImageSource(token.href)
        ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={key} src={token.href} alt={token.text ?? ""} className="my-6 w-full rounded-xl" />
        )
        : null;
      if (token.type === "heading") return token.depth === 3
        ? <h3 key={key} className="mt-7 text-lg font-bold text-white">{children}</h3>
        : <h2 key={key} className="mt-8 font-display text-xl font-bold text-white">{children}</h2>;
      if (token.type === "paragraph") return <p key={key} className="my-3 text-[15px] leading-[1.8] text-white/75">{children}</p>;
      if (token.type === "blockquote") return <blockquote key={key} className="my-5 border-l-2 border-[#00E5FF] pl-4 text-white/65">{children}</blockquote>;
      if (token.type === "hr") return <hr key={key} className="my-8 border-white/10" />;
      if (token.type === "code") return <pre key={key} className="my-5 overflow-x-auto rounded-xl bg-black/30 p-4 text-sm text-white/80"><code>{token.text}</code></pre>;
      if (token.type === "list") {
        const listItems = (token.items ?? []).map((item, itemIndex) => <li key={`${key}-i${itemIndex}`}>{renderTokens(item.tokens, `${key}-i${itemIndex}`)}</li>);
        return token.ordered
          ? <ol key={key} start={typeof token.start === "number" ? token.start : undefined} className="my-4 list-decimal space-y-1.5 pl-6 text-white/75">{listItems}</ol>
          : <ul key={key} className="my-4 list-disc space-y-1.5 pl-6 text-white/75">{listItems}</ul>;
      }
      if (token.type === "table") {
        return <div key={key} className="my-6 overflow-x-auto"><table className="w-full border-collapse text-sm text-white/75"><thead><tr>{(token.header ?? []).map((cell, cellIndex) => <th key={`${key}-h${cellIndex}`} className="border border-white/15 bg-white/5 px-3 py-2 text-left text-white">{renderTokens(cell.tokens, `${key}-h${cellIndex}`)}</th>)}</tr></thead><tbody>{(token.rows ?? []).map((row, rowIndex) => <tr key={`${key}-r${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${key}-r${rowIndex}c${cellIndex}`} className="border border-white/10 px-3 py-2">{renderTokens(cell.tokens, `${key}-r${rowIndex}c${cellIndex}`)}</td>)}</tr>)}</tbody></table></div>;
      }
      return children.length ? <span key={key}>{children}</span> : token.text ?? null;
    })
  );

  return <>{renderTokens(tokens, "md")}</>;
}

export default async function ArtikelDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) return notFound();
  const canonicalUrl = `https://axvara.tech/artikel/${article.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt ?? article.title,
    image: article.cover_url ?? undefined,
    datePublished: article.published_at ?? undefined,
    author: { "@type": "Organization", name: article.author_name ?? "AXVARA" },
    mainEntityOfPage: canonicalUrl,
  };
  // Avoid closing the JSON-LD script when editorial text contains "</script>".
  const safeJsonLd = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <Link href="/artikel" className="text-sm text-white/50 hover:text-white">← Semua artikel</Link>
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/70">Artikel</p>
      <h1 className="mt-2 font-display text-[28px] font-bold leading-[1.05] tracking-[-0.02em] text-white sm:text-[36px]">{article.title}</h1>
      {article.excerpt && <p className="mt-3 text-[15px] leading-6 text-white/60">{article.excerpt}</p>}
      {article.published_at && <p className="mt-2 text-xs text-white/35">{new Date(article.published_at).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · AXVARA</p>}
      {article.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={article.cover_url} alt={article.title} className="mt-6 aspect-[16/9] w-full rounded-[20px] bg-white/5 object-cover" />
      )}
      <article className="mt-6"><ArticleBody content={article.content} /></article>

      {article.source_urls.length > 0 && (
        <aside className="mt-9 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-semibold text-white">Sumber riset</h2>
          <ul className="mt-2 space-y-1">
            {article.source_urls.map((source) => (
              <li key={source}><a href={source} target="_blank" rel="noreferrer" className="break-all text-xs text-[#00E5FF] hover:underline">{source}</a></li>
            ))}
          </ul>
        </aside>
      )}

      <div className="mt-10 flex flex-wrap gap-2">
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonicalUrl)}`} target="_blank" rel="noreferrer" className="ax-glass-card h-9 rounded-full px-4 text-sm text-white/70 hover:text-white">Share Facebook</a>
        <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(article.title)}&url=${encodeURIComponent(canonicalUrl)}`} target="_blank" rel="noreferrer" className="ax-glass-card h-9 rounded-full px-4 text-sm text-white/70 hover:text-white">Share X</a>
        <a href={`https://wa.me/?text=${encodeURIComponent(`${article.title} ${canonicalUrl}`)}`} target="_blank" rel="noreferrer" className="h-9 rounded-full bg-[#25D366] px-4 text-sm font-bold text-white">Share WA</a>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd }} />
    </div>
  );
}
