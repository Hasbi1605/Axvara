import { NextRequest, NextResponse } from "next/server";
import { execRun, OrderTransitionError, queryAll, transitionPendingOrder } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET belum dikonfigurasi" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const expiredOrders = (await queryAll(
    "SELECT code,items,expires_at FROM orders WHERE status='pending' AND expires_at<=? ORDER BY expires_at ASC",
    now,
  )).filter((order) => (
    order.status === undefined || order.status === "pending"
  ) && Boolean(order.expires_at) && Date.parse(String(order.expires_at)) <= Date.now());
  const expiredIds: string[] = [];
  for (const order of expiredOrders) {
    try {
      const items = JSON.parse(String(order.items || "[]")) as { product_id: number; qty: number }[];
      await transitionPendingOrder(String(order.code), "kadaluarsa", "Kedaluwarsa otomatis setelah 24 jam.", items);
      expiredIds.push(String(order.code));
    } catch (error) {
      if (!(error instanceof OrderTransitionError)) {
        console.error("Auto-expire order failed:", order.code, error);
      }
    }
  }

  const due = (await queryAll(
    "SELECT * FROM articles WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at ASC",
    now,
  )).filter((article) => (
    article.status === "scheduled"
    && Boolean(article.scheduled_at)
    && Date.parse(String(article.scheduled_at)) <= Date.now()
  ));

  const publishedIds: unknown[] = [];
  for (const article of due) {
    const result = await execRun(
      "UPDATE articles SET status=?,is_published=?,published_at=?,scheduled_at=?,updated_at=? WHERE id=? AND status='scheduled'",
      "published",
      1,
      now,
      null,
      now,
      article.id,
    );
    if (!result.changes) continue;
    publishedIds.push(article.id);
    await execRun(
      "INSERT INTO article_audit_log (article_id,actor_type,actor_name,action,metadata,created_at) VALUES (?,?,?,?,?,?)",
      article.id,
      "system",
      "AXVARA Scheduler",
      "publish_scheduled",
      JSON.stringify({ scheduled_at: article.scheduled_at }),
      now,
    );
  }
  return NextResponse.json({
    ok: true,
    published: publishedIds.length,
    ids: publishedIds,
    expired_orders: expiredIds.length,
    expired_order_codes: expiredIds,
  });
}
