// Penjadwal cron AXVARA (2026-10-04, Workers Free plan).
//
// Insiden 3 Okt 2026 20:25–23:50 WIB: 41 run beruntun `/api/cron/operations`
// dibunuh runtime Pages (`exceededResources` → HTTP 503) karena SATU request
// memikul semua fase dan CPU melewati batas ~10 ms Free plan. Insiden 4 Okt
// 02:00–05:20 WIB: setelah pemecahan per fase, request fase WR/SK gabungan
// (order + sync) masih dibunuh — order lunas ikut tertahan.
//
// Kini:
// - setiap langkah = request terpisah (`?phase=`), dipanggil BERURUTAN;
// - fase WR/SK dibelah `part=orders` (order/reconcile/kirim/saldo) dan
//   `part=sync` (katalog, diulang `&continue=1` selama `more: true`);
//   order didahulukan agar tetap jalan walau sync kena limit;
// - alarm Telegram ber-state di Workers KV: 1 pesan saat gangguan mulai
//   (2 tick gagal beruntun), pengingat tiap 6 jam, 1 pesan saat pulih
//   (3 tick sukses beruntun). Tanpa KV → fallback stateless :00/:30.

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

export type CronStep = { phase: string; part?: "orders" | "sync"; chunked?: boolean };

/** Urutan satu tick: order WR/SK sebelum notify, sync katalog di belakang. */
export const CRON_STEPS: CronStep[] = [
  { phase: "expiry" },
  { phase: "fulfillment" },
  { phase: "warung_rebahan", part: "orders" },
  { phase: "sekalipay", part: "orders" },
  { phase: "notify" },
  { phase: "warung_rebahan", part: "sync", chunked: true },
  { phase: "sekalipay", part: "sync", chunked: true },
  { phase: "cleanup" },
];
/** Plafon potongan per langkah sync per tick (WR 49/10 = 5; SK ~100/25 = 4). */
export const MAX_CHUNKS_PER_PHASE = 10;
/** Fallback tanpa KV: alarm hanya di tick menit kelipatan 30. */
export const ALERT_EVERY_MINUTES = 30;
export const ALARM_START_AFTER_FAILED_TICKS = 2;
export const ALARM_RECOVER_AFTER_OK_TICKS = 3;
export const ALARM_REMINDER_MS = 6 * 60 * 60 * 1000;
export const ALARM_KV_KEY = "cron_alarm_v1";
/**
 * Langkah `:sync` = pengaman berkala sejak diff VPS (2026-10-04) menjaga
 * kesegaran. Kegagalannya baru dialarmkan bila beruntun ≥ 6 tick (30 mnt);
 * kegagalan langkah lain (order, notify, …) tetap 2 tick.
 */
export const SOFT_ALARM_AFTER_TICKS = 6;
const isSoft = (f: PhaseOutcome) => f.step.endsWith(":sync");

export type PhaseOutcome = { step: string; calls: number; ok: boolean; status: number; error?: string };
export type AlarmState = {
  since: number | null;
  failedTicks: number;
  okTicks: number;
  alertedAt: number | null;
  lastFailures: string[];
  /** Tick beruntun yang HANYA gagal di langkah `:sync`. */
  softTicks?: number;
};
export type AlarmAction = "none" | "start" | "reminder" | "recovered";
export type TickReport = { outcomes: PhaseOutcome[]; failures: PhaseOutcome[]; alerted: boolean; action: AlarmAction };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export function stepLabel(step: CronStep): string {
  return step.part ? `${step.phase}:${step.part}` : step.phase;
}

async function callStep(env: CronEnv, step: CronStep, fetchFn: FetchFn): Promise<PhaseOutcome> {
  const headers = { authorization: `Bearer ${env.AXVARA_CRON_SECRET}` };
  const label = stepLabel(step);
  const base = `phase=${step.phase}${step.part ? `&part=${step.part}` : ""}`;
  const maxCalls = step.chunked ? MAX_CHUNKS_PER_PHASE : 1;
  let calls = 0;
  for (let i = 0; i < maxCalls; i++) {
    const query = i === 0 ? base : `${base}&continue=1`;
    calls++;
    let response: Response;
    try {
      response = await fetchFn(`${env.AXVARA_API_ORIGIN}/api/cron/operations?${query}`, { method: "POST", headers });
    } catch (error) {
      return { step: label, calls, ok: false, status: 0, error: error instanceof Error ? error.message.slice(0, 120) : "fetch_failed" };
    }
    if (!response.ok) return { step: label, calls, ok: false, status: response.status };
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
  return `${failure.step}: ${failure.status ? `HTTP ${failure.status}` : failure.error ?? "gagal"}`;
}

export function formatAlert(failures: PhaseOutcome[], scheduledTime: number, kind: "start" | "reminder" | "stateless" = "stateless", since?: number | null): string {
  const title = kind === "reminder"
    ? `⏳ Cron AXVARA masih gagal sejak ${wib(since ?? scheduledTime)} WIB`
    : `⚠️ Cron AXVARA gagal (tick ${wib(scheduledTime)} WIB)`;
  return [
    title,
    ...failures.map((f) => `• ${describe(f)}`),
    "",
    "HTTP 503 = biasanya runtime Pages membunuh request (exceededResources, batas CPU Free plan).",
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

const EMPTY_STATE: AlarmState = { since: null, failedTicks: 0, okTicks: 0, alertedAt: null, lastFailures: [] };

/**
 * Transisi alarm murni (mudah diuji). `changed` = perlu ditulis ke KV —
 * hanya saat transisi, agar gangguan panjang tidak menghabiskan kuota tulis
 * KV gratis (1.000/hari).
 */
export function nextAlarmState(
  prev: AlarmState,
  allFailures: PhaseOutcome[],
  now: number,
): { state: AlarmState; action: AlarmAction; changed: boolean } {
  const prevSoft = prev.softTicks ?? 0;
  const hard = allFailures.filter((f) => !isSoft(f));
  const soft = allFailures.filter(isSoft);
  const softTicks = soft.length && !hard.length ? Math.min(prevSoft + 1, SOFT_ALARM_AFTER_TICKS) : 0;
  const failures = hard.length ? allFailures : softTicks >= SOFT_ALARM_AFTER_TICKS ? soft : [];
  // Ambang soft tercapai = sudah "cukup lama gagal": langsung memenuhi syarat mulai.
  const failedTicks = !hard.length && softTicks >= SOFT_ALARM_AFTER_TICKS
    ? Math.max(prev.failedTicks, ALARM_START_AFTER_FAILED_TICKS - 1)
    : prev.failedTicks;
  const inner = innerAlarmState({ ...prev, softTicks, failedTicks }, failures, now);
  return { ...inner, changed: inner.changed || softTicks !== prevSoft };
}

function innerAlarmState(
  prev: AlarmState,
  failures: PhaseOutcome[],
  now: number,
): { state: AlarmState; action: AlarmAction; changed: boolean } {
  if (failures.length > 0) {
    const state: AlarmState = {
      since: prev.since ?? now,
      failedTicks: Math.min(prev.failedTicks + 1, ALARM_START_AFTER_FAILED_TICKS),
      okTicks: 0,
      alertedAt: prev.alertedAt,
      lastFailures: failures.map(describe).slice(0, 8),
      softTicks: prev.softTicks ?? 0,
    };
    if (state.alertedAt == null && state.failedTicks >= ALARM_START_AFTER_FAILED_TICKS) {
      return { state: { ...state, alertedAt: now }, action: "start", changed: true };
    }
    if (state.alertedAt != null && now - state.alertedAt >= ALARM_REMINDER_MS) {
      return { state: { ...state, alertedAt: now }, action: "reminder", changed: true };
    }
    const changed = prev.failedTicks !== state.failedTicks || prev.okTicks !== 0 || prev.since == null;
    return { state, action: "none", changed };
  }
  // Tick sukses.
  if (prev.alertedAt == null) {
    // Belum pernah dialarmkan: gangguan sesaat dilupakan diam-diam.
    const changed = prev.since != null || prev.failedTicks !== 0;
    return { state: { ...EMPTY_STATE, softTicks: prev.softTicks ?? 0 }, action: "none", changed };
  }
  const okTicks = prev.okTicks + 1;
  if (okTicks >= ALARM_RECOVER_AFTER_OK_TICKS) {
    return { state: { ...EMPTY_STATE, softTicks: prev.softTicks ?? 0 }, action: "recovered", changed: true };
  }
  return { state: { ...prev, failedTicks: 0, okTicks }, action: "none", changed: true };
}

async function readState(kv: KvLike): Promise<AlarmState> {
  try {
    const raw = await kv.get(ALARM_KV_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<AlarmState>;
    return {
      since: typeof parsed.since === "number" ? parsed.since : null,
      failedTicks: Number(parsed.failedTicks ?? 0) || 0,
      okTicks: Number(parsed.okTicks ?? 0) || 0,
      alertedAt: typeof parsed.alertedAt === "number" ? parsed.alertedAt : null,
      lastFailures: Array.isArray(parsed.lastFailures) ? parsed.lastFailures.map(String) : [],
      softTicks: Number(parsed.softTicks ?? 0) || 0,
    };
  } catch {
    return EMPTY_STATE;
  }
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
): Promise<TickReport> {
  const outcomes: PhaseOutcome[] = [];
  // Langkah gagal tidak menghentikan langkah berikut: tiap langkah berdiri sendiri.
  for (const step of CRON_STEPS) outcomes.push(await callStep(env, step, fetchFn));
  const failures = outcomes.filter((o) => !o.ok);

  if (!env.CRON_STATE) {
    let alerted = false;
    const hardOnly = failures.filter((f) => !isSoft(f));
    if (hardOnly.length > 0 && shouldAlert(scheduledTime)) {
      alerted = await sendAlert(env, formatAlert(hardOnly, scheduledTime), fetchFn);
    }
    return { outcomes, failures, alerted, action: alerted ? "start" : "none" };
  }

  const prev = await readState(env.CRON_STATE);
  const next = nextAlarmState(prev, failures, scheduledTime);
  let { state, changed } = next;
  const { action } = next;
  let alerted = false;
  if (action === "start" || action === "reminder") {
    alerted = await sendAlert(env, formatAlert(failures, scheduledTime, action, state.since), fetchFn);
    if (!alerted && action === "start") {
      // Telegram gagal/tidak dikonfigurasi: jangan tandai "sudah dialarmkan"
      // agar tick berikut mencoba lagi; tulis KV hanya bila state berubah.
      state = { ...state, alertedAt: null };
      changed = prev.failedTicks !== state.failedTicks || prev.since == null || prev.okTicks !== 0;
    }
  } else if (action === "recovered" && prev.since != null) {
    alerted = await sendAlert(env, formatRecovery(prev.since, scheduledTime, prev.lastFailures), fetchFn);
  }
  if (changed) {
    try {
      await env.CRON_STATE.put(ALARM_KV_KEY, JSON.stringify(state));
    } catch { /* KV gagal: tick berikut mengevaluasi ulang */ }
  }
  return { outcomes, failures, alerted, action };
}
