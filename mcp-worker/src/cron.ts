// Penjadwal cron AXVARA (2026-10-04, Workers Free plan).
//
// Insiden 3 Okt 2026 20:25–23:50 WIB: 41 run beruntun `/api/cron/operations`
// dibunuh runtime Pages (`exceededResources` → HTTP 503) karena SATU request
// memikul expiry + fulfillment + sync WR + sync SK + notify + cleanup dan CPU
// melewati batas ~10 ms Free plan. Worker dulu membuang respons tanpa melihat
// status, jadi tidak ada yang tahu selama 3,5 jam.
//
// Kini setiap fase = request terpisah (`?phase=`) dengan jatah CPU sendiri,
// dipanggil BERURUTAN (bukan paralel — hindari rebutan D1). Fase sync WR/SK
// diulang (`&continue=1`) selama respons `more: true`, sehingga satu putaran
// katalog penuh selesai dalam satu tick. Kegagalan dilaporkan ke Telegram
// admin; penanda run selesai (`cron_last_ok_at`) ditulis handler.

export type CronEnv = {
  AXVARA_API_ORIGIN: string;
  AXVARA_CRON_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ADMIN_CHAT_ID?: string;
};

export const CRON_PHASES = ["expiry", "fulfillment", "warung_rebahan", "sekalipay", "notify", "cleanup"] as const;
export type CronPhaseName = (typeof CRON_PHASES)[number];
/** Fase sync katalog yang dipotong kecil dan diulang selama `more: true`. */
const CHUNKED_PHASES = new Set<CronPhaseName>(["warung_rebahan", "sekalipay"]);
/** Plafon potongan per fase per tick (WR 49 produk / 10 = 5; SK ~160 / 25 = 7). */
export const MAX_CHUNKS_PER_PHASE = 10;
/**
 * Alarm stateless: Worker tidak punya penyimpanan, jadi kirim alarm hanya di
 * tick menit kelipatan 30 (maks 2 pesan/jam selama insiden berlangsung).
 * Insiden ≥30 menit pasti terlapor; gangguan sesaat tidak membuat spam.
 */
export const ALERT_EVERY_MINUTES = 30;

export type PhaseOutcome = { phase: CronPhaseName; calls: number; ok: boolean; status: number; error?: string };
export type TickReport = { outcomes: PhaseOutcome[]; failures: PhaseOutcome[]; alerted: boolean };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

async function callPhase(
  env: CronEnv,
  phase: CronPhaseName,
  fetchFn: FetchFn,
): Promise<PhaseOutcome> {
  const headers = { authorization: `Bearer ${env.AXVARA_CRON_SECRET}` };
  const maxCalls = CHUNKED_PHASES.has(phase) ? MAX_CHUNKS_PER_PHASE : 1;
  let calls = 0;
  for (let i = 0; i < maxCalls; i++) {
    const query = i === 0 ? `phase=${phase}` : `phase=${phase}&continue=1`;
    calls++;
    let response: Response;
    try {
      response = await fetchFn(`${env.AXVARA_API_ORIGIN}/api/cron/operations?${query}`, { method: "POST", headers });
    } catch (error) {
      return { phase, calls, ok: false, status: 0, error: error instanceof Error ? error.message.slice(0, 120) : "fetch_failed" };
    }
    if (!response.ok) return { phase, calls, ok: false, status: response.status };
    const body = (await response.json().catch(() => null)) as { more?: unknown } | null;
    if (!body || body.more !== true) return { phase, calls, ok: true, status: response.status };
  }
  return { phase, calls, ok: true, status: 200 };
}

export function shouldAlert(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() % ALERT_EVERY_MINUTES === 0;
}

export function formatAlert(failures: PhaseOutcome[], scheduledTime: number): string {
  const wib = new Date(scheduledTime + 7 * 60 * 60 * 1000).toISOString().slice(11, 16);
  const lines = failures.map((f) => `• ${f.phase}: ${f.status ? `HTTP ${f.status}` : f.error ?? "gagal"}`);
  return [
    `⚠️ Cron AXVARA gagal (tick ${wib} WIB)`,
    ...lines,
    "",
    "HTTP 503 = biasanya runtime Pages membunuh request (exceededResources, batas CPU Free plan).",
    "Cek: Cloudflare → Pages axvara → Functions metrics, lalu admin → Warung Rebahan/Sekalipay → Sync terakhir.",
  ].join("\n");
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

/** Satu tick cron: semua fase berurutan + alarm bila ada yang gagal. */
export async function runOperationsTick(
  env: CronEnv,
  scheduledTime: number,
  fetchFn: FetchFn = fetch,
): Promise<TickReport> {
  const outcomes: PhaseOutcome[] = [];
  // Fase gagal tidak menghentikan fase berikutnya: tiap fase berdiri sendiri.
  for (const phase of CRON_PHASES) outcomes.push(await callPhase(env, phase, fetchFn));
  const failures = outcomes.filter((o) => !o.ok);
  let alerted = false;
  if (failures.length > 0 && shouldAlert(scheduledTime)) {
    alerted = await sendAlert(env, formatAlert(failures, scheduledTime), fetchFn);
  }
  return { outcomes, failures, alerted };
}
