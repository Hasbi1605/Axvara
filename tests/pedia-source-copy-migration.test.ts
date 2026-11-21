import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'vitest';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

it('corrects source copy idempotently without overwriting admin copy or historical orders', () => {
const db = new DatabaseSync(':memory:');
try {
  db.exec(`CREATE TABLE pedia_tiers(id INTEGER PRIMARY KEY, supplier TEXT, supplier_service_id INTEGER, description_md TEXT, updated_at TEXT);
    CREATE TABLE pedia_order_items(snapshot_json TEXT);
    INSERT INTO pedia_tiers VALUES
      (47,'indosmm',7887,'Followers Instagram untuk target publik. Pilihan dengan akun berpostingan menurut keterangan layanan.',NULL),
      (46,'indosmm',9475,'Followers Instagram untuk target publik. Pilihan dengan akun berpostingan menurut keterangan layanan.',NULL),
      (1,'indosmm',6405,'Followers global, akun real/aktif.',NULL),
      (2,'indosmm',575,'Copy admin khusus',NULL),
      (3,'indosmm',9999,'Followers global, akun real/aktif.',NULL),
      (4,'legacy_supplier',6405,'Followers global, akun real/aktif.',NULL);
    INSERT INTO pedia_order_items VALUES ('{"description":"akun real/aktif"}');`);
  const migration = readFileSync('drizzle/migrations/0090_pedia_source_copy_20261102.sql', 'utf8');
  db.exec(migration);
  const rows = () => db.prepare('SELECT id, description_md, updated_at FROM pedia_tiers ORDER BY id').all();
  const first = rows();
  assert.deepEqual(first.map((row: { description_md: string }) => row.description_md), [
    'Followers global, label Real.', 'Copy admin khusus', 'Followers global, akun real/aktif.',
    'Followers global, akun real/aktif.',
    'Followers Instagram untuk target publik. Pilihan dengan akun berpostingan menurut keterangan layanan.',
    'Followers Instagram untuk target publik. Akun lama menurut label layanan.',
  ]);
  assert.equal(db.prepare('SELECT snapshot_json FROM pedia_order_items').get().snapshot_json, '{"description":"akun real/aktif"}');
  db.exec(migration);
  assert.deepEqual(rows(), first);
  db.exec("UPDATE pedia_tiers SET description_md='Keterangan admin akun lama' WHERE id=47");
  db.exec(migration);
  assert.equal(db.prepare('SELECT description_md FROM pedia_tiers WHERE id=47').get().description_md, 'Keterangan admin akun lama');
} finally {
  db.close();
}
});
