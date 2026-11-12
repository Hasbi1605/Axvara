import type { DatabaseAccess } from "@/lib/db-access";
import { checkoutSubjects } from "@/lib/checkout-guard";
import { isDigiflazzConfigured, sendTransaction } from "./digiflazz";
import type { GamesDefinition } from "./registry";
import { sanitizeGamesNickname } from "./sellable";
import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
import { validateSkAccount } from "@/lib/sekalipay/client";
import type { GamesSkContract, GamesSkTarget } from "./registry";

export type GamesNicknameResult = { status: "ok"; nickname: string } | { status: "invalid" } | { status: "unavailable" };
const unavailable = { status: "unavailable" } as const;
const WINDOW = 15 * 60_000;
const DAY = 86_400_000;
const FALLBACK_COST: Record<string, number> = { ffcekusername: 5, mlcekusername: 24, pubgcekusername: 80 };

function cachedResult(row: Record<string, unknown>): GamesNicknameResult {
  if (row.result === "invalid") return { status: "invalid" };
  const nickname = sanitizeGamesNickname(String(row.nickname ?? ""));
  return row.result === "ok" && nickname ? { status: "ok", nickname } : unavailable;
}

/** Paid admission atomically claims the account and enforces IP/device + UTC day limits.
 * Pending/ambiguous claims never expire: a lost response cannot buy a second check. */
export async function checkGamesNickname(db: DatabaseAccess, game: GamesDefinition, customerNo: string, ip: string, device: string): Promise<GamesNicknameResult> {
  if (!db.d1 || process.env.DIGIFLAZZ_TESTING === "true" || !isDigiflazzConfigured()) return unavailable;
  const now = Date.now();
  // FF MAX shares the same Garena lookup SKU and account namespace as FF.
  const gameKey = game.nicknameSku;
  try {
    const cached = await db.queryFirst(
      "SELECT ref_id,result,nickname,checked_at FROM games_nickname_cache WHERE game_key=? AND customer_no=? AND (expires_at IS NULL OR expires_at>?)",
      gameKey, customerNo, now,
    );
    const repoll = cached && (cached.result === "pending" || cached.result === "ambiguous");
    if (cached && (!repoll || Number(cached.checked_at) > now - 60_000)) return cachedResult(cached);
    const product = repoll
      ? await db.queryFirst("SELECT cost,buyer_sku_code FROM games_nickname_checks WHERE ref_id=?", cached.ref_id)
      : await db.queryFirst("SELECT cost FROM games_products WHERE buyer_sku_code=?", game.nicknameSku);
    if (repoll && (!product || product.buyer_sku_code !== game.nicknameSku)) return unavailable;
    const cost = product ? Number(product.cost) : FALLBACK_COST[game.nicknameSku];
    if (!Number.isSafeInteger(cost) || cost <= 0 || cost > 80) return unavailable;
    const [subject] = await checkoutSubjects({ ip: ip || "unknown", wa: "", email: "" });
    if (!subject) return unavailable;
    const ref = repoll ? String(cached.ref_id) : `NCK-${crypto.randomUUID()}`;
    const stmt = (sql: string, ...params: unknown[]) => db.d1!.prepare(sql).bind(...params);
    if (repoll) {
      // ponytail: free same-ref poll counters are per isolate; add D1 counters if a global unpaid-request budget is needed.
      if (!rateLimit(`games:nickname_poll:${subject.hash}`, RATE_LIMITS["games:nickname_poll"], WINDOW)
        || !rateLimit(`games:nickname_poll_device:${device}`, RATE_LIMITS["games:nickname_poll_device"], WINDOW)) return unavailable;
      const claimed = await db.execRun(`UPDATE games_nickname_cache SET result='pending',checked_at=?
        WHERE ref_id=? AND checked_at=? AND checked_at<=? AND result IN ('pending','ambiguous')`,
      now, ref, cached.checked_at, now - 60_000);
      if (claimed.changes !== 1) return unavailable;
    } else {
      const result = await db.d1.batch([
        stmt(`INSERT INTO games_nickname_cache(game_key,customer_no,ref_id,result,checked_at)
          VALUES(?,?,?,'pending',?) ON CONFLICT(game_key,customer_no) DO UPDATE SET
          ref_id=excluded.ref_id,result='pending',nickname=NULL,checked_at=excluded.checked_at,expires_at=NULL
          WHERE games_nickname_cache.expires_at IS NOT NULL AND games_nickname_cache.expires_at<=?`,
        gameKey, customerNo, ref, now, now),
        stmt(`INSERT INTO games_nickname_checks(ref_id,slug,buyer_sku_code,cost,status,ip_hash,device_id,created_at)
          SELECT ?,?,?,?,'submitting',?,?,? WHERE EXISTS(SELECT 1 FROM games_nickname_cache WHERE ref_id=?)
          AND (SELECT COUNT(*) FROM games_nickname_checks WHERE ip_hash=? AND created_at>?)<10
          AND (SELECT COUNT(*) FROM games_nickname_checks WHERE device_id=? AND created_at>?)<5
          AND (SELECT COUNT(*) FROM games_nickname_checks WHERE created_at>=?)<500`,
        ref, game.slug, game.nicknameSku, cost, subject.hash, device, now, ref,
        subject.hash, now - WINDOW, device, now - WINDOW, Math.floor(now / DAY) * DAY),
        stmt(`DELETE FROM games_nickname_cache WHERE ref_id=? AND NOT EXISTS(SELECT 1 FROM games_nickname_checks WHERE ref_id=?)`, ref, ref),
      ]);
      if (Number(result[1]?.meta?.changes) !== 1) return unavailable;
    }
    const payload = { buyer_sku_code: game.nicknameSku, customer_no: customerNo, ref_id: ref, max_price: cost };
    let response = await sendTransaction(payload);
    if (!repoll && response.kind === "ok" && response.tx.ref_id === ref && response.tx.buyer_sku_code === game.nicknameSku && response.tx.status === "Pending") {
      await new Promise(resolve => setTimeout(resolve, 1500));
      response = await sendTransaction(payload);
    }
    let status = "ambiguous";
    let rc: string | null = null;
    let nickname: string | null = null;
    let expiresAt: number | null = null;
    if (response.kind === "ok" && response.tx.ref_id === ref && response.tx.buyer_sku_code === game.nicknameSku) {
      const tx = response.tx;
      rc = tx.rc;
      if (tx.status === "Sukses" && tx.rc === "00") {
        nickname = sanitizeGamesNickname((tx.sn ?? "").replace(/^(?:(?:username\s*\/\s*)?nickname|username)\s*:\s*/i, "")) || null;
        status = nickname ? "ok" : "ambiguous";
        expiresAt = nickname ? Date.now() + DAY : null;
      } else if (tx.status === "Gagal") {
        // Official buyer response-code table: only 54 = Nomor Tujuan Salah.
        status = tx.rc === "54" ? "invalid" : "unavailable";
        expiresAt = Date.now() + (status === "invalid" ? 3_600_000 : 60_000);
      }
    }
    const settled = await db.d1.batch([
      stmt(`UPDATE games_nickname_checks SET status=?,rc=? WHERE ref_id=? AND EXISTS(
        SELECT 1 FROM games_nickname_cache WHERE ref_id=? AND checked_at=? AND result='pending')`, status, rc, ref, ref, now),
      stmt("UPDATE games_nickname_cache SET result=?,nickname=?,checked_at=?,expires_at=? WHERE ref_id=? AND checked_at=? AND result='pending'", status, nickname, Date.now(), expiresAt, ref, now),
    ]);
    return Number(settled[1]?.meta?.changes) === 1 ? cachedResult({ result: status, nickname }) : unavailable;
  } catch { return unavailable; }
}

export async function gamesNicknameSummary(db: DatabaseAccess) {
  const today = Math.floor(Date.now() / DAY) * DAY;
  const row = await db.queryFirst(`SELECT COUNT(*) AS week_count, COALESCE(SUM(cost),0) AS week_cost,
    COALESCE(SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END),0) AS today_count,
    COALESCE(SUM(CASE WHEN created_at>=? THEN cost ELSE 0 END),0) AS today_cost
    FROM games_nickname_checks WHERE created_at>=?`, today, today, today - 6 * DAY);
  return { today: { count: Number(row?.today_count ?? 0), cost: Number(row?.today_cost ?? 0) },
    week: { count: Number(row?.week_count ?? 0), cost: Number(row?.week_cost ?? 0) } };
}

/**
 * Nickname baru (Sekalipay, GRATIS): hanya untuk varian SK yang
 * `validation.available`, target sudah tervalidasi kontrak. Cache 24 jam per
 * (variant, target); claim 60 dtk mencegah request paralel membanjiri supplier.
 * Kegagalan supplier selalu `unavailable` — tidak pernah memblokir checkout.
 */
export async function checkSkGamesNickname(
  db: DatabaseAccess,
  input: { variantId: number; contract: GamesSkContract; target: GamesSkTarget; display: string; device: string },
): Promise<GamesNicknameResult> {
  if (!db.d1 || !input.contract.supported || !input.contract.validation_available) return unavailable;
  if (!rateLimit(`games:sknick_device:${input.device}`, RATE_LIMITS["games:nickname_poll_device"], WINDOW)) return unavailable;
  const now = Date.now();
  const gameKey = `sk:${input.variantId}`;
  const stmt = (sql: string, ...params: unknown[]) => db.d1!.prepare(sql).bind(...params);
  try {
    const cached = await db.queryFirst(
      "SELECT ref_id,result,nickname,checked_at,expires_at FROM games_nickname_cache WHERE game_key=? AND customer_no=?",
      gameKey, input.display,
    );
    if (cached && (cached.result === "ok" || cached.result === "invalid" || cached.result === "unavailable")
      && Number(cached.expires_at ?? 0) > now) return cachedResult(cached);
    const ref = `SKN-${crypto.randomUUID()}`;
    const claimed = await db.d1.batch([
      stmt(`INSERT INTO games_nickname_cache(game_key,customer_no,ref_id,result,checked_at,expires_at)
        VALUES(?,?,?,'pending',?,NULL)
        ON CONFLICT(game_key,customer_no) DO UPDATE SET ref_id=excluded.ref_id,result='pending',nickname=NULL,
          checked_at=excluded.checked_at,expires_at=NULL
        WHERE (games_nickname_cache.result IN ('ok','invalid','unavailable')
               AND (games_nickname_cache.expires_at IS NULL OR games_nickname_cache.expires_at<=?))
           OR (games_nickname_cache.result IN ('pending','ambiguous') AND games_nickname_cache.checked_at<=?)`,
      gameKey, input.display, ref, now, now, now - 60_000),
    ]);
    if (Number(claimed[0]?.meta?.changes) !== 1) return unavailable;
    let status: "ok" | "unavailable" = "unavailable";
    let nickname: string | null = null;
    try {
      const result = await validateSkAccount({
        itemId: input.variantId,
        customerId: input.target.note,
        ...(input.target.zone_id ? { zoneId: input.target.zone_id } : {}),
      });
      nickname = sanitizeGamesNickname(String(result.account_name || result.display_name || "")) || null;
      status = nickname ? "ok" : "unavailable";
    } catch {
      status = "unavailable";
    }
    const expiresAt = status === "ok" ? Date.now() + DAY : Date.now() + 60_000;
    const settled = await db.d1.batch([
      stmt(`UPDATE games_nickname_cache SET result=?,nickname=?,checked_at=?,expires_at=?
        WHERE ref_id=? AND result='pending'`, status, nickname, Date.now(), expiresAt, ref),
    ]);
    return Number(settled[0]?.meta?.changes) === 1 ? cachedResult({ result: status, nickname }) : unavailable;
  } catch {
    return unavailable;
  }
}
