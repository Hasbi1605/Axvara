import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { queryFirst, execRun } from "@/lib/db";

// Shortlink internal axvara.tech/go/:slug (2026-10-03): pembungkus link
// supplier + artikel AXVARA yang panjang. Lookup D1 by slug + is_active=1,
// redirect 307 ke destination, increment klik best-effort. Mati/tak ada = 404.
// noindex: link operasional, bukan konten SEO (juga disallow di robots.ts).

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export default async function GoRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return notFound();
  let destination: string | null = null;
  try {
    const row = (await queryFirst(
      `SELECT destination FROM supplier_links WHERE slug=? AND is_active=1`,
      slug,
    )) as Record<string, unknown> | undefined;
    if (row?.destination) destination = String(row.destination);
  } catch {
    return notFound();
  }
  if (!destination) return notFound();
  // Hitung klik best-effort: gagal catat tidak boleh gagalkan redirect.
  try {
    await execRun(
      `UPDATE supplier_links SET click_count=click_count+1, last_clicked_at=datetime('now'), updated_at=datetime('now') WHERE slug=?`,
      slug,
    );
  } catch { /* abaikan */ }
  redirect(destination);
}
