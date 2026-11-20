import { fingerprint, matchesBotIdentity, pool } from "./durable.js";

type Welcome = { event: "member_join"; observedAt: number; groupId: string; botNumber: string; botRevision: string; members: { id: string; name: string }[] };
const backoffSeconds = [5, 15, 60, 180, 600];

export async function queueWelcome(event: Welcome) {
  const ids = [...new Set(event.members.map(m => m.id.replace(/:\d+@/, "@")))].sort();
  const key = fingerprint(event.groupId, JSON.stringify([event.botNumber, event.botRevision, new Date(event.observedAt).toISOString().slice(0, 10), ids]));
  await pool.query(`INSERT INTO axvara_wa_welcome_inbox(key,payload,expires_at)
    VALUES($1,$2,to_timestamp($3 / 1000.0) + interval '30 minutes') ON CONFLICT DO NOTHING`, [key, JSON.stringify(event), event.observedAt]);
}

// Called by the sole runtime-lock owner, with one in-flight drain per process.
export async function drainWelcomes(url: URL, token: string, warn: (status: number) => void, fetchFn = fetch) {
  await pool.query("DELETE FROM axvara_wa_welcome_inbox WHERE expires_at <= now()");
  const { rows } = await pool.query(`SELECT key,payload,attempts FROM axvara_wa_welcome_inbox
    WHERE next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 4`);
  for (const { key, payload, attempts } of rows as { key: string; payload: Welcome; attempts: number }[]) {
    const { observedAt, ...body } = payload;
    let status = 410;
    if (matchesBotIdentity(body) && Date.now() < observedAt + 30 * 60_000) {
      try {
        const response = await fetchFn(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
          headers: { "content-type": "application/json", "x-webhook-token": token, "x-wa-join-observed-at": String(observedAt) }, body: JSON.stringify(body) });
        status = response.status;
        if (status === 202 || status === 200) {
          const result = await response.json() as { ok?: boolean; status?: string } | null;
          if (result?.ok !== true || result.status !== (status === 202 ? "queued" : "ignored")) status = 0;
        } else {
          await response.body?.cancel().catch(() => {});
        }
      } catch { status = 0; }
    }
    if (status === 202 || status === 200 || (status >= 400 && status < 500 && ![408, 425, 429].includes(status)) || attempts >= backoffSeconds.length) {
      await pool.query("DELETE FROM axvara_wa_welcome_inbox WHERE key=$1", [key]);
      if (status !== 202 && status !== 200 && status !== 410) warn(status);
    } else {
      await pool.query("UPDATE axvara_wa_welcome_inbox SET attempts=attempts+1,next_attempt_at=now()+($2 * interval '1 second') WHERE key=$1", [key, backoffSeconds[attempts]]);
    }
  }
}
