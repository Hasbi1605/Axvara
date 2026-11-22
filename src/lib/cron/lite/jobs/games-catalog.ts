// src/lib/cron/lite/jobs/games-catalog.ts — games_catalog job body
// (3A-8c, class E: pure move, no behavior change).
//
// BEFORE: the games_catalog branch lived inline in
// src/app/api/cron/lite/route.ts. AFTER: `run(ctx)` owns the verbatim
// body and returns whether the route must answer its existing 503;
// the route keeps that NextResponse and the generic marker tail.
// No dirty-group drain in any outcome shape.

import type { LiteContext } from "@/lib/cron/lite/context";

export async function run(ctx: LiteContext): Promise<{ failed: boolean }> {
  const { db, result } = ctx;
  // docs/GAMES.md §12.5: katalog baru = Sekalipay Game; Digiflazz tidak lagi
  // dipanggil untuk price-list. Throttle/no-op ada di dalam sync.
  const { syncGamesSkCatalog } = await import("@/lib/games/sk-catalog-sync");
  const synced = await syncGamesSkCatalog(db);
  Object.assign(result, synced);
  return { failed: "ok" in synced && synced.ok === false };
}
