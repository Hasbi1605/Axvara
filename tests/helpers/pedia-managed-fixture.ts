import { createDatabaseAccess } from "@/lib/db-access";
import type { createD1Fixture } from "./d1-fixture";

/**
 * Versi snapshot term yang dipakai fixture Pedia (PSMM-ACCEPTANCE-CLOSE).
 * Gate syarat material FAIL CLOSED: baris auto wajib dicap versi ini dan quote
 * wajib menandatangani versi ini agar order BARU sah.
 */
export const FIXTURE_TERMS_VERSION = "2026-11-12T10:00:00.000Z";

/**
 * Tulis snapshot deskripsi resmi valid untuk `serviceIds` dan cap `managed`
 * baris auto ProviderSMM yang cocok. Tidak menyentuh baris `curated`.
 */
export async function seedOfficialDescriptions(
  db: ReturnType<typeof createDatabaseAccess>,
  serviceIds: number[],
  text = "Syarat resmi berlaku.\nJangan ubah target selama proses.",
): Promise<void> {
  const entries: Record<string, { status: "ok"; text: string }> = {};
  for (const id of serviceIds) entries[String(id)] = { status: "ok", text };
  const snapshot = JSON.stringify({
    fetched_at: FIXTURE_TERMS_VERSION,
    source_url: "https://providersmm.id/services",
    entries,
  });
  const write = (key: string, value: string) => db.execRun(
    `INSERT INTO store_settings (key,value,updated_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    key, value,
  );
  await write("pedia_psmm_desc_snapshot", snapshot);
  await write("pedia_psmm_desc_last_at", FIXTURE_TERMS_VERSION);
  if (!serviceIds.length) return;
  await db.execRun(
    `UPDATE pedia_tiers SET managed_snapshot_at=?
      WHERE managed='auto' AND supplier='providersmm'
        AND supplier_service_id IN (${serviceIds.map(() => "?").join(",")})`,
    FIXTURE_TERMS_VERSION, ...serviceIds,
  );
}

/**
 * Versi untuk fixture yang menyuntik snapshot lewat `sql.exec` langsung: cap
 * baris auto + kembalikan versi agar token quote bisa menandatanganinya.
 */
export async function stampManagedTerms(
  db: ReturnType<typeof createDatabaseAccess>,
  serviceIds: number[],
  version: string = FIXTURE_TERMS_VERSION,
): Promise<string> {
  if (serviceIds.length) {
    await db.execRun(
      `UPDATE pedia_tiers SET managed_snapshot_at=?
        WHERE managed='auto' AND supplier='providersmm'
          AND supplier_service_id IN (${serviceIds.map(() => "?").join(",")})`,
      version, ...serviceIds,
    );
  }
  return version;
}

/** Tandai tier auto + bekali deskripsi resmi dalam satu langkah fixture. */
export async function makeTierSellableAsManaged(
  fx: ReturnType<typeof createD1Fixture>,
  db: ReturnType<typeof createDatabaseAccess>,
  tierIds: number[],
  serviceIds: number[],
): Promise<void> {
  for (const id of tierIds) fx.sql.prepare("UPDATE pedia_tiers SET managed='auto' WHERE id=?").run(id);
  await seedOfficialDescriptions(db, serviceIds);
}
