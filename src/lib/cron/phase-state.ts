import type { DatabaseAccess } from "@/lib/db-access";

export type CronPhase = "expiry" | "fulfillment" | "warung_rebahan" | "sekalipay" | "notify" | "cleanup";

export async function readCronPhase(database: DatabaseAccess): Promise<{ phase: CronPhase; deferred: CronPhase[] }> {
  const { queryFirst } = database;
  try {
    const row = await queryFirst(`SELECT value FROM store_settings WHERE key='cron_phase'`);
    const raw = String(row?.value ?? "");
    const phase: CronPhase = phaseName(raw) ?? "expiry";
    const defRow = await queryFirst(`SELECT value FROM store_settings WHERE key='cron_deferred'`);
    let deferred: CronPhase[] = [];
    try {
      const parsed = JSON.parse(String(defRow?.value ?? "[]"));
      if (Array.isArray(parsed)) deferred = parsed.filter((p): p is CronPhase => phaseName(String(p)) != null);
    } catch { deferred = []; }
    return { phase, deferred };
  } catch {
    return { phase: "expiry", deferred: [] };
  }
}

export function phaseName(raw: string): CronPhase | null {
  if (raw === "expiry" || raw === "fulfillment" || raw === "warung_rebahan" || raw === "sekalipay" || raw === "notify" || raw === "cleanup") return raw;
  return null;
}

export function nextPhase(phase: CronPhase): CronPhase {
  if (phase === "expiry") return "fulfillment";
  // WR disisipkan SETELAH fulfillment dan SEBELUM notify: order WR perlu
  // diproses sebelum notifikasi dikirim (plan §10).
  if (phase === "fulfillment") return "warung_rebahan";
  // SK jalan SETELAH WR (supplier kedua): order SK diproses sebelum notify,
  // dan sweep SK tidak berebut budget/waktu dengan sweep WR dalam satu run.
  if (phase === "warung_rebahan") return "sekalipay";
  if (phase === "sekalipay") return "notify";
  return "expiry"; // cleanup kembali ke awal (cleanup jalan tiap run, ringan)
}

export async function writeCronPhase(next: CronPhase, deferred: CronPhase[], database: DatabaseAccess): Promise<void> {
  const { execRun } = database;
  try {
    await execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES ('cron_phase', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=?, updated_at=datetime('now')`,
      next, next,
    );
    await execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES ('cron_deferred', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=?, updated_at=datetime('now')`,
      JSON.stringify(deferred.slice(0, 8)), JSON.stringify(deferred.slice(0, 8)),
    );
  } catch { /* fase best-effort; run berikutnya mengulang prioritas default */ }
}

// POISON-PILL GUARD (2026-09-18). Sebelumnya `writeCronPhase` hanya dipanggil
// di ekor handler, jadi run yang dibunuh platform di tengah jalan meninggalkan
// fase + deferred yang sama untuk run berikutnya. Insiden 17 Sep 13:06 UTC
// → 18 Sep 04:55 UTC: fase terkunci di `warung_rebahan`, tiap run 5 menit
// mengulang pekerjaan berat yang sama, dipotong pada ~125 s, dan sync
// otomatis WR tidak pernah tercatat selama ~16 jam (baris cron terakhir
// di wr_sync_log: 17 Sep 11:37 UTC). Majukan rotasi + kosongkan deferred
// sebelum kerja berat; ekor menimpa dengan nilai final bila run selesai normal.
// Konsekuensi yang disengaja: run yang mati kehilangan hint deferred-nya,
// tetapi rotasi tetap bergerak sehingga tidak ada fase yang mengunci cron.
export function advanceCronPhase(storedPhase: CronPhase, database: DatabaseAccess): Promise<void> {
  return writeCronPhase(nextPhase(storedPhase), [], database);
}

// HEARTBEAT (issue wr-sync-observability, 2026-09-19): bukti "pemicu
// memanggil + handler hidup sampai sini". 1 statement ringan, best-effort.
// Tanpa ini run yang kepotong deploy vs pemicu yang mati terlihat identik
// (keduanya: tanpa baris sync baru). Baca: `cron_last_hit_at` segar +
// sync basi = run kepotong; keduanya basi = pemicu mati.
export async function writeCronHeartbeat(execRun: DatabaseAccess["execRun"]): Promise<void> {
  try {
    await execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES ('cron_last_hit_at', datetime('now'), datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
    );
  } catch { /* heartbeat tak boleh menggagalkan run */ }
}
