// POST /api/games/digiflazz/webhook — callback status transaksi Digiflazz
// (docs/GAMES.md §12.4). Urutan: baca body (batas byte) → verifikasi
// `X-Hub-Signature: sha1=<HMAC-SHA1(secret, raw)>` constant-time → parse →
// dedupe `dana_webhook_events` → transisi yang sama dengan polling
// (`applyGamesTransactionResult`, idempoten, hanya attempt aktif).
import { NextRequest, NextResponse } from "next/server";
import { readTextBody } from "@/lib/http-body";
import { createDatabaseAccess } from "@/lib/db-access";
import { constantTimeEqual } from "@/lib/security";
import { applyGamesTransactionResult } from "@/lib/games/dispatch";
import { parseTransactionData } from "@/lib/games/digiflazz";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16_000;
const REF_ID = /^[A-Za-z0-9_-]{1,100}$/;
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

async function hmacSha1Hex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}
async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function POST(request: NextRequest) {
  const bounded = await readTextBody(request, MAX_BODY_BYTES);
  if (!bounded.ok) return bounded.response;
  const secret = process.env.DIGIFLAZZ_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  const given = (request.headers.get("x-hub-signature") ?? "").trim().toLowerCase();
  if (!constantTimeEqual(given, `sha1=${await hmacSha1Hex(secret, bounded.data)}`)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(bounded.data); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const data = (body as Record<string, unknown>).data;
  // Ping pembuatan webhook (header event=ping atau body tanpa `data`): cukup 200.
  if ((request.headers.get("x-digiflazz-event") ?? "").toLowerCase() === "ping" || data === undefined) {
    return NextResponse.json({ ok: true, ping: true });
  }
  const tx = parseTransactionData(data);
  if (!tx || !REF_ID.test(tx.ref_id)) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const db = createDatabaseAccess();
  const eventKey = `digiflazz:${tx.ref_id}:${tx.status}`;
  try {
    // order_code diisi setelah ref terbukti milik kita (FK ke orders).
    await db.execRun(
      `INSERT OR IGNORE INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status)
       VALUES(?,?,?,?,'digiflazz','received')`,
      eventKey, await sha256Hex(bounded.data), Math.max(0, Math.trunc(tx.price ?? 0)), bounded.data,
    );
    const event = await db.queryFirst("SELECT provider,status FROM dana_webhook_events WHERE event_key=?", eventKey);
    if (!event || event.provider !== "digiflazz") return NextResponse.json({ error: "event_conflict" }, { status: 409 });
    if (event.status === "matched" || event.status === "ignored") return NextResponse.json({ ok: true, duplicate: true });
    const outcome = await applyGamesTransactionResult(db, tx.ref_id, tx);
    if (outcome === "unknown_ref" || outcome === "ignored") {
      await db.execRun(
        "UPDATE dana_webhook_events SET status='ignored',last_error=?,processed_at=datetime('now') WHERE event_key=? AND status!='matched'",
        outcome === "unknown_ref" ? "unknown_ref" : "stale_or_terminal", eventKey,
      );
      return NextResponse.json({ ok: true, ignored: true });
    }
    await db.execRun(
      `UPDATE dana_webhook_events SET status='matched',last_error=NULL,processed_at=datetime('now'),
         order_code=(SELECT order_code FROM games_dispatch_attempts WHERE ref_id=?) WHERE event_key=? AND status!='matched'`,
      tx.ref_id, eventKey,
    );
    return NextResponse.json({ ok: true });
  } catch {
    // Digiflazz mengulang pengiriman bila bukan 2xx; event tetap bisa diproses ulang.
    try { await db.execRun("UPDATE dana_webhook_events SET status='failed',last_error='games_apply_retry' WHERE event_key=? AND status NOT IN ('matched','ignored')", eventKey); } catch { /* best-effort */ }
    return NextResponse.json({ error: "retry" }, { status: 503 });
  }
}
