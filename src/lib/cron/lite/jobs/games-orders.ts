// src/lib/cron/lite/jobs/games-orders.ts — games_orders job body
// (3A-8d, class E: pure move, no behavior change).
//
// BEFORE: the games_orders branch lived inline in
// src/app/api/cron/lite/route.ts. AFTER: `run(ctx)` owns the verbatim
// body and returns whether the route must answer its existing 503;
// the route keeps that NextResponse and the generic marker tail.

import type { LiteContext } from "@/lib/cron/lite/context";

export async function run(ctx: LiteContext): Promise<{ failed: boolean }> {
  const { db, result } = ctx;
  // docs/GAMES.md §12.3: promosi lunas, dispatch supplier per item (SK baru,
  // Digiflazz legacy), pemulihan lease, polling. Budget 40 tetap dipakai.
  const { processGamesPaidOrders } = await import("@/lib/games/dispatch");
  const ran = await processGamesPaidOrders(undefined, db);
  Object.assign(result, ran);
  return { failed: Boolean(ran.error) };
}
