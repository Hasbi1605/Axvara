import { NextRequest, NextResponse } from "next/server";
import { execRun, OrderTransitionError, queryAll, transitionPendingOrder } from "@/lib/db";
import { isExpiredIso } from "@/lib/expiry";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET belum dikonfigurasi" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  // Expiry is evaluated in JS from the canonical ISO string (shared helper
  // with the operations cron) so ISO-8601 and legacy space-separated values
  // expire with identical semantics. Orders that carry a QRIS ledger are
  // left to the operations cron's guarded ledger+order transition so the
  // transaction row never stays `pending` while its order is kadaluarsa
  // (which would pin the unique amount slot forever); that transition is
  // idempotent, so whichever cron reaches such an order first wins.
  const expiredCandidates = await queryAll(
    "SELECT code,items,expires_at FROM orders WHERE status='pending' AND expires_at IS NOT NULL ORDER BY expires_at ASC LIMIT 200",
  );
  const expiredOrders = expiredCandidates.filter((order) => (
    order.status === undefined || order.status === "pending"
  ) && isExpiredIso(order.expires_at));
  const expiredIds: string[] = [];
  for (const order of expiredOrders) {
    // Skip orders owned by the QRIS ledger path: the operations cron
    // expires their transaction row in the same guarded batch, which also
    // releases the unique-amount slot. Expiring only the order here would
    // strand a `pending` transaction and block amount reuse.
    const ledger = await queryAll(
      "SELECT status, expires_at FROM payment_transactions WHERE order_code=?",
      String(order.code),
    );
    const activeLedger = ledger.some(
      (tx) => ["initializing", "pending"].includes(String(tx.status)),
    );
    if (activeLedger) continue;
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
