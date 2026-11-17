// Penjadwal cron AXVARA (Workers Paid, revisi 2026-10-23).
//
// Insiden 3 Okt 2026 20:25–23:50 WIB: 41 run beruntun `/api/cron/operations`
// dibunuh runtime Pages (`exceededResources` → HTTP 503) karena SATU request
// memikul semua fase dan CPU melewati batas ~10 ms Free plan. Insiden 4 Okt
// 02:00–05:20 WIB: setelah pemecahan per fase, request fase WR/SK gabungan
// (order + sync) masih dibunuh — order lunas ikut tertahan.
//
// Riwayat pemecahan fase (2026-10-09), tetap dipertahankan pada Paid:
// - setiap langkah = request terpisah (`?phase=`), dipanggil BERURUTAN dengan
//   sejak Paid 23 Oktober tanpa jeda tambahan; origin timeout 45 detik;
// - `notify` dipecah `notify_a` (retry Telegram + invoice) dan `notify_b`
//   (QRIS + reminder + WA outbox): satu-satunya lite job yang mengipas 5
//   sub-kerjaan dalam 1 request;
// - fase WR/SK dibelah `part=orders` (order/reconcile/kirim/saldo) dan
//   `part=sync` (katalog, diulang `&continue=1` selama `more: true`);
//   order didahulukan agar tetap jalan walau sync kena limit;
// - alarm Telegram ber-state di Workers KV: 1 pesan saat gangguan mulai
//   (hard 2 / soft 6 eksekusi gagal per step), pengingat tiap 6 jam,
//   pulih setelah tiap step terdampak sukses 3 kali. KV rusak → :00/:30.

export type KvLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

export type CronEnv = {
  AXVARA_API_ORIGIN: string;
  AXVARA_CRON_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ADMIN_CHAT_ID?: string;
  CRON_STATE?: KvLike;
};

/**
 * Tingkat alarm per langkah (2026-10-05):
 * - `hard`: dialarmkan setelah 2 eksekusi gagal beruntun (menyentuh pembeli);
 * - `soft`: baru dialarmkan setelah 6 eksekusi gagal beruntun per step;
 * - `none`: tidak pernah dialarmkan (pelengkap/cadangan — inti sudah
 *   dikerjakan langkah lite, kesegaran katalog dijaga diff VPS).
 */
export type AlarmTier = "hard" | "soft" | "none";
export type CronStep = { phase: string; part?: "orders" | "sync"; chunked?: boolean; lite?: string; alarm: AlarmTier; heavy?: boolean; everyMinutes?: number };
/**
 * Route besar `/api/cron/operations` hanya dipanggil di tick menit :00 UTC
 * (sekali per jam) sejak 5 Okt malam: email Cloudflare "Workers CPU limit
 * exceeded 100+ times/24 jam" — 583 dari 589 request yang dibunuh adalah
 * route besar yang dipanggil tiap 5 mnt. Pekerjaan rutinnya kini di lite.
 */
export const HEAVY_EVERY_MINUTES = 60;
export function isHeavyTick(scheduledTime: number): boolean {
  const d = new Date(scheduledTime);
  return d.getUTCMinutes() === 0;
}

/**
 * Urutan satu tick. Langkah INTI lewat `/api/cron/lite` (route ramping,
 * dengan batas pekerjaan per request) didahulukan; route besar
 * `/api/cron/operations` tetap dipanggil sebagai pelengkap (stranded ledger,
 * manual-WA, reconcile tambahan, saldo, notify, sync cadangan, cleanup) —
 * aman ganda karena klaim/transisi idempoten.
 */
export const CRON_STEPS: CronStep[] = [
  { phase: "lite", lite: "payments", alarm: "hard" },
  { phase: "lite", lite: "expiry", alarm: "hard" },
  { phase: "lite", lite: "fulfillment", alarm: "hard" },
  { phase: "lite", lite: "wr_orders", alarm: "hard" },
  { phase: "lite", lite: "sk_orders", alarm: "hard" },
  { phase: "lite", lite: "tunvn_orders", alarm: "hard" },
  { phase: "lite", lite: "aivault_orders", alarm: "hard" },
  { phase: "lite", lite: "pedia_orders", alarm: "hard" },
  // AXVARA Games (docs/GAMES.md §12.3): dispatch + polling Digiflazz; no-op tanpa kredensial.
  { phase: "lite", lite: "games_orders", alarm: "hard" },
  { phase: "lite", lite: "jaspay_catalog", alarm: "soft" },
  { phase: "lite", lite: "tunvn_catalog", alarm: "soft" },
  { phase: "lite", lite: "aivault_catalog", alarm: "soft" },
  // notify dipecah dua (2026-10-09): tiap request hanya memikul 2–3
  // sub-kerjaan + dynamic import, bukan 5 sekaligus.
  { phase: "lite", lite: "notify_a", alarm: "soft" },
  { phase: "lite", lite: "notify_b", alarm: "soft" },
  { phase: "lite", lite: "promo", alarm: "soft" },
  { phase: "lite", lite: "cleanup", alarm: "none", everyMinutes: 5 },
  // AXVARA Games (docs/GAMES.md §12.5): sinkron katalog Digiflazz tiap 10 mnt;
  // throttle & no-op tanpa kredensial dijaga di dalam job.
  { phase: "lite", lite: "games_catalog", alarm: "soft", everyMinutes: 10 },
  { phase: "publish-scheduled", alarm: "soft", everyMinutes: 5 },
  // Pelengkap per jam (stranded ledger, manual-WA, reconcile tambahan, saldo,
  // watchdog, sync cadangan). Tidak dialarmkan: inti sudah di lite.
  { phase: "expiry", alarm: "none", heavy: true },
  { phase: "fulfillment", alarm: "none", heavy: true },
  { phase: "warung_rebahan", part: "orders", alarm: "none", heavy: true },
  { phase: "sekalipay", part: "orders", alarm: "none", heavy: true },
  { phase: "notify", alarm: "none", heavy: true },
  { phase: "warung_rebahan", part: "sync", chunked: true, alarm: "none", heavy: true },
  { phase: "sekalipay", part: "sync", chunked: true, alarm: "none", heavy: true },
  { phase: "cleanup", alarm: "none", heavy: true },
];
/** Plafon potongan per langkah sync per tick (WR 49/10 = 5; SK ~100/25 = 4). */
export const MAX_CHUNKS_PER_PHASE = 10;
/** Paid: langkah tetap berurutan tanpa jeda buatan agar pembayaran/pengiriman
 * segera dijalankan. Batas batch, lease dan timeout tetap membatasi pekerjaan. */
export const STEP_DELAY_MS = 0;
/** A stalled origin must not prevent subsequent order/notification jobs. */
export const STEP_TIMEOUT_MS = 45_000;
/** Fallback KV hilang/rusak: hard DAN soft di tick menit kelipatan 30. */
export const ALERT_EVERY_MINUTES = 30;
export const ALARM_START_AFTER_FAILED_TICKS = 2;
export const ALARM_RECOVER_AFTER_OK_TICKS = 3;
export const ALARM_REMINDER_MS = 6 * 60 * 60 * 1000;
export const ALARM_KV_KEY = "cron_alarm_v1";
/**
 * Ambang soft dihitung per eksekusi step, bukan tick penjadwal: Games
 * tiap 10 menit perlu 6 kegagalan, tick non-due tidak mengubah hitungan.
 */
export const SOFT_ALARM_AFTER_TICKS = 6;
const isSoft = (f: PhaseOutcome) => f.alarm === "soft" || (f.alarm === undefined && f.step.endsWith(":sync"));

export type PhaseOutcome = { step: string; calls: number; ok: boolean; status: number; error?: string; alarm?: AlarmTier };
export type AlarmState = {
  since: number | null;
  alertedAt: number | null;
  lastFailures: string[];
  steps: Record<string, { failedTicks: number; okTicks: number; outcome: PhaseOutcome }>;
  /** Kegagalan sejak pesan terakhir, termasuk step baru yang sudah pulih. */
  pendingFailures: PhaseOutcome[];
};
export type AlarmAction = "none" | "start" | "reminder" | "recovered";
export type TickReport = { outcomes: PhaseOutcome[]; failures: PhaseOutcome[]; alerted: boolean; action: AlarmAction };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function sanitizeError(value: string, env: CronEnv): string {
  for (const secret of [env.AXVARA_CRON_SECRET, env.TELEGRAM_BOT_TOKEN]) {
    if (!secret) continue;
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g"), "[REDACTED]");
  }
  return value
    .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/gi, "https://api.telegram.org/bot[REDACTED]")
    .replace(/\bBearer\s+[^\s"',;<>]+/gi, "Bearer [REDACTED]")
    .replace(/([\w-]*(?:token|secret|key|authorization)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&<>]+)/gi, "$1[REDACTED]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED]")
    .replace(/\s+/g, " ").trim().slice(0, 120);
}

export function stepLabel(step: Pick<CronStep, "phase" | "part" | "lite">): string {
  if (step.lite) return `lite:${step.lite}`;
  return step.part ? `${step.phase}:${step.part}` : step.phase;
}

async function callStep(env: CronEnv, step: CronStep, fetchFn: FetchFn): Promise<PhaseOutcome> {
  const headers = { authorization: `Bearer ${env.AXVARA_CRON_SECRET}` };
  const label = stepLabel(step);
  const path = step.phase === "publish-scheduled" ? "/api/cron/publish-scheduled" : step.lite ? "/api/cron/lite" : "/api/cron/operations";
  const base = step.lite ? `job=${step.lite}` : `phase=${step.phase}${step.part ? `&part=${step.part}` : ""}`;
  const maxCalls = step.chunked ? MAX_CHUNKS_PER_PHASE : 1;
  let calls = 0;
  for (let i = 0; i < maxCalls; i++) {
    const query = i === 0 ? base : `${base}&continue=1`;
    calls++;
    let response: Response;
    try {
      const suffix = step.phase === "publish-scheduled" ? "" : `?${query}`;
      response = await fetchFn(`${env.AXVARA_API_ORIGIN}${path}${suffix}`, { method: "POST", headers, signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
    } catch (error) {
      return { step: label, calls, ok: false, status: 0, error: sanitizeError(error instanceof Error ? error.message : "fetch_failed", env) };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try {
        const body = JSON.parse(text) as { error?: unknown } | null;
        if (typeof body?.error === "string") detail = body.error;
      } catch { /* Non-JSON error bodies remain useful after redaction. */ }
      return { step: label, calls, ok: false, status: response.status, error: sanitizeError(detail, env) || undefined };
    }
    const body = (await response.json().catch(() => null)) as { more?: unknown } | null;
    if (!body || body.more !== true) return { step: label, calls, ok: true, status: response.status };
  }
  return { step: label, calls, ok: true, status: 200 };
}

export function shouldAlert(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() % ALERT_EVERY_MINUTES === 0;
}

function wib(ms: number): string {
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

function describe(failure: PhaseOutcome): string {
  return `${failure.step}: ${failure.status ? `HTTP ${failure.status}${failure.error ? ` — ${failure.error}` : ""}` : failure.error ?? "gagal"}`;
}

export function formatAlert(failures: PhaseOutcome[], scheduledTime: number, kind: "start" | "reminder" | "stateless" = "stateless", since?: number | null): string {
  const title = kind === "reminder"
    ? `⏳ Cron AXVARA masih gagal sejak ${wib(since ?? scheduledTime)} WIB`
    : `⚠️ Cron AXVARA gagal (tick ${wib(scheduledTime)} WIB)`;
  return [
    title,
    ...failures.map((f) => `• ${describe(f)}`),
    "",
    "Periksa error origin, koneksi provider, dan batas CPU pada Functions metrics; HTTP 503 saja belum menentukan penyebabnya.",
    kind === "stateless" ? "" : "Pesan berikutnya: pengingat tiap 6 jam, atau ✅ saat pulih.",
    "Cek: Cloudflare → Pages axvara → Functions metrics, lalu admin → Warung Rebahan/Sekalipay → Sync terakhir.",
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
}

export function formatRecovery(since: number, now: number, lastFailures: string[]): string {
  const minutes = Math.max(1, Math.round((now - since) / 60000));
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)} jam ${minutes % 60} mnt` : `${minutes} mnt`;
  return [
    `✅ Cron AXVARA pulih (${wib(now)} WIB)`,
    `Gangguan sejak ${wib(since)} WIB, ±${duration}.`,
    ...(lastFailures.length ? ["Terakhir gagal:", ...lastFailures.map((f) => `• ${f}`)] : []),
  ].join("\n");
}

const EMPTY_STATE: AlarmState = { since: null, alertedAt: null, lastFailures: [], steps: {}, pendingFailures: [] };

/**
 * Transisi alarm murni (mudah diuji). `changed` = perlu ditulis ke KV —
 * hanya saat counter/episode/detail berubah. Outcome absen (non-due) tidak
 * dianggap sukses; sukses step lain tidak dapat memulihkan step yang gagal.
 */
export function nextAlarmState(
  prev: AlarmState,
  outcomes: PhaseOutcome[],
  now: number,
): { state: AlarmState; action: AlarmAction; changed: boolean } {
  const steps = { ...prev.steps };
  const pending = new Map(prev.pendingFailures.map((f) => [f.step, f]));
  for (const outcome of outcomes) {
    if (outcome.alarm === "none") continue;
    const previous = steps[outcome.step];
    if (!outcome.ok) {
      const threshold = isSoft(outcome) ? SOFT_ALARM_AFTER_TICKS : ALARM_START_AFTER_FAILED_TICKS;
      steps[outcome.step] = { failedTicks: Math.min((previous?.failedTicks ?? 0) + 1, threshold), okTicks: 0, outcome };
      if (!previous || previous.failedTicks === 0 || pending.has(outcome.step)) pending.set(outcome.step, outcome);
    } else if (previous) {
      if (prev.alertedAt == null) {
        delete steps[outcome.step];
        pending.delete(outcome.step);
      } else {
        steps[outcome.step] = { ...previous, failedTicks: 0, okTicks: Math.min(previous.okTicks + 1, ALARM_RECOVER_AFTER_OK_TICKS) };
      }
    }
  }
  const tracked = Object.values(steps);
  let state: AlarmState = {
    since: prev.since ?? (tracked.length ? now : null),
    alertedAt: prev.alertedAt,
    lastFailures: tracked.map(({ outcome }) => describe(outcome)),
    steps,
    pendingFailures: [...pending.values()],
  };
  let action: AlarmAction = "none";
  if (prev.alertedAt == null) {
    if (!tracked.length) state = EMPTY_STATE;
    else if (tracked.some((s) => s.failedTicks >= (isSoft(s.outcome) ? SOFT_ALARM_AFTER_TICKS : ALARM_START_AFTER_FAILED_TICKS))) {
      state.alertedAt = now;
      action = "start";
    }
  } else if (tracked.every((s) => s.okTicks >= ALARM_RECOVER_AFTER_OK_TICKS)) {
    state = EMPTY_STATE;
    action = "recovered";
  } else if (tracked.some((s) => s.failedTicks > 0) && now - prev.alertedAt >= ALARM_REMINDER_MS) {
    state.alertedAt = now;
    action = "reminder";
  }
  return { state, action, changed: JSON.stringify(prev) !== JSON.stringify(state) };
}

async function readState(kv: KvLike): Promise<AlarmState> {
  const raw = await kv.get(ALARM_KV_KEY);
  if (raw === null) return EMPTY_STATE;
  let parsed: AlarmState;
  try { parsed = JSON.parse(raw) as AlarmState; }
  catch { throw new Error("invalid_alarm_state"); }
  if (!parsed || !Array.isArray(parsed.lastFailures) ||
      !(parsed.since === null || Number.isFinite(parsed.since)) ||
      !(parsed.alertedAt === null || Number.isFinite(parsed.alertedAt))) throw new Error("invalid_alarm_state");
  // State agregat lama tidak dapat diatribusikan ke step: mulai counter baru,
  // tanpa mengirim recovery palsu untuk episode lama.
  if (!("steps" in parsed)) return EMPTY_STATE;
  if (!parsed.steps || Array.isArray(parsed.steps) || !Array.isArray(parsed.pendingFailures) ||
      Object.entries(parsed.steps).some(([label, s]) => !s || !Number.isInteger(s.failedTicks) || s.failedTicks < 0 ||
        !Number.isInteger(s.okTicks) || s.okTicks < 0 || !s.outcome || s.outcome.step !== label || s.outcome.ok !== false) ||
      parsed.pendingFailures.some((f) => !f || typeof f.step !== "string" || f.ok !== false)) throw new Error("invalid_alarm_state");
  return parsed;
}

async function sendAlert(env: CronEnv, text: string, fetchFn: FetchFn): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_CHAT_ID) return false;
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_ADMIN_CHAT_ID, text, disable_web_page_preview: true }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Satu tick cron: semua langkah berurutan + alarm bila ada yang gagal. */
export async function runOperationsTick(
  env: CronEnv,
  scheduledTime: number,
  fetchFn: FetchFn = fetch,
  /** Diinjeksi test agar tidak tidur sungguhan; runtime memakai setTimeout. */
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<TickReport> {
  const outcomes: PhaseOutcome[] = [];
  // Langkah gagal tidak menghentikan langkah berikut: tiap langkah berdiri sendiri.
  const heavyTick = isHeavyTick(scheduledTime);
  let stepped = false;
  for (const step of CRON_STEPS) {
    if (step.heavy && !heavyTick) continue;
    if (step.everyMinutes && new Date(scheduledTime).getUTCMinutes() % step.everyMinutes !== 0) continue;
    // Jeda antar langkah lite (bukan sebelum langkah pertama, bukan untuk
    // langkah heavy pelengkap per jam yang memang jarang + sudah ringan).
    if (stepped && step.lite && STEP_DELAY_MS > 0) await sleepFn(STEP_DELAY_MS).catch(() => undefined);
    stepped = true;
    outcomes.push({ ...(await callStep(env, step, fetchFn)), alarm: step.alarm });
  }
  // Langkah `none` tetap tercatat di outcomes (diagnosa) tapi bukan kegagalan alarm.
  const failures = outcomes.filter((o) => !o.ok && o.alarm !== "none");

  let alerted = false;
  try {
    if (!env.CRON_STATE) throw new Error("binding_missing");
    const prev = await readState(env.CRON_STATE);
    const { state, changed, action } = nextAlarmState(prev, outcomes, scheduledTime);
    if (changed) {
      // Verifikasi write SEBELUM kirim; kegagalan KV memakai fallback, bukan
      // mengulang pesan stateful setiap tick. Ack pesan ditulis setelah terkirim.
      const pending = action === "recovered" ? prev : { ...state, alertedAt: prev.alertedAt };
      await env.CRON_STATE.put(ALARM_KV_KEY, JSON.stringify(pending));
    }
    if (action === "start" || action === "reminder") {
      const reportFailures = new Map(state.pendingFailures.map((f) => [f.step, f]));
      for (const s of Object.values(state.steps)) if (s.failedTicks > 0) reportFailures.set(s.outcome.step, s.outcome);
      alerted = await sendAlert(env, formatAlert([...reportFailures.values()], scheduledTime, action, state.since), fetchFn);
      if (alerted) await env.CRON_STATE.put(ALARM_KV_KEY, JSON.stringify({ ...state, pendingFailures: [] }));
    } else if (action === "recovered" && prev.since != null) {
      alerted = await sendAlert(env, formatRecovery(prev.since, scheduledTime, prev.lastFailures), fetchFn);
      if (alerted) await env.CRON_STATE.put(ALARM_KV_KEY, JSON.stringify(state));
    }
    return { outcomes, failures, alerted, action };
  } catch (error) {
    console.error("cron CRON_STATE unavailable; stateless fallback", sanitizeError(error instanceof Error ? error.message : "storage_failed", env));
    if (!alerted && failures.length > 0 && shouldAlert(scheduledTime)) {
      alerted = await sendAlert(env, formatAlert(failures, scheduledTime), fetchFn);
    }
    return { outcomes, failures, alerted, action: alerted ? "start" : "none" };
  }
}
