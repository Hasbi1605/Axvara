import { z } from "zod";

export const ARTICLE_STATUSES = ["draft", "review", "scheduled", "published", "rejected"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const articleInputSchema = z.object({
  title: z.string().trim().min(6).max(140),
  content: z.string().trim().min(50).max(50_000),
  cover_url: z.string().trim().max(600).nullable().optional(),
  source_urls: z.array(z.string().url().max(600)).max(20).default([]),
  status: z.enum(ARTICLE_STATUSES).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
});

const unsafeMarkdown = /<\/?(?:script|style|iframe|object|embed|form)\b|\son\w+\s*=|javascript:/i;
export function isSafeMarkdown(value: string): boolean {
  if (unsafeMarkdown.test(value)) return false;
  try {
    const doc = JSON.parse(value) as { type?:string; content?:unknown[] };
    if (doc.type !== "doc") return true;
    const nodes = new Set(["doc","paragraph","text","heading","bulletList","orderedList","listItem","blockquote","hardBreak","horizontalRule","image"]);
    const marks = new Set(["bold","italic","strike","link"]);
    const walk=(node:unknown):boolean=>{if(!node||typeof node!=="object")return true;const n=node as {type?:string;marks?:{type?:string;attrs?:{href?:string}}[];content?:unknown[]};if(!n.type||!nodes.has(n.type))return false;if(n.marks?.some(m=>!m.type||!marks.has(m.type)||(m.type==="link"&&!/^https:\/\//.test(m.attrs?.href??""))))return false;return !n.content||n.content.every(walk)};
    return walk(doc);
  } catch { return true; }
}

export function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "artikel";
}

export function excerptFromMarkdown(value: string): string {
  try {
    const json = JSON.parse(value) as { type?: string; content?: unknown[] };
    if (json.type === "doc") {
      const text = JSON.stringify(json.content ?? []).replace(/"text":"([^"]*)"/g, "$1").replace(/[{}\[\]",:]/g, " ").replace(/\s+/g, " ").trim();
      return text.length > 160 ? `${text.slice(0,157).trimEnd()}…` : text;
    }
  } catch { /* legacy Markdown */ }
  const first = value.split(/\n\s*\n/).find((part) => part.trim() && !part.trim().startsWith("#")) ?? value;
  const clean = first.replace(/!?(?:\[[^\]]*\])?\([^)]*\)/g, "")
    .replace(/[`*_>#~-]/g, "").replace(/\s+/g, " ").trim();
  return clean.length > 160 ? `${clean.slice(0, 157).trimEnd()}…` : clean;
}

export function normalizeArticle(row: Record<string, unknown>): Record<string, unknown> & { status: ArticleStatus; is_published: number; source_urls: unknown } {
  const status = (row.status as ArticleStatus | undefined) ?? ((row.is_published as number) === 1 ? "published" : "draft");
  let sourceUrls: unknown = row.source_urls ?? [];
  if (typeof row.source_urls === "string") {
    try { sourceUrls = JSON.parse(row.source_urls || "[]"); }
    catch { sourceUrls = []; }
  }
  return { ...row, status, is_published: status === "published" ? 1 : 0,
    source_urls: sourceUrls };
}
