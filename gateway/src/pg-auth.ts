import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from "@whiskeysockets/baileys";
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required for Postgres auth");
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

export async function initPostgresAuthTable(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS baileys_auth_keys (
      key_id VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function usePostgresAuthState(phone: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearAuth: () => Promise<void>;
}> {
  if (!/^[1-9]\d{9,14}$/.test(phone)) throw new Error("Invalid auth phone");
  const prefix = phone + ":";
  await initPostgresAuthTable();
  const p = getPool();

  let creds: AuthenticationCreds;

  const { rows } = await p.query("SELECT value FROM baileys_auth_keys WHERE key_id=$1 LIMIT 1", [prefix + "creds.json"]);
  if (rows.length > 0 && rows[0].value) {
    creds = JSON.parse(rows[0].value, BufferJSON.reviver);
  } else {
    creds = initAuthCreds();
  }

  const saveCreds = async () => {
    const value = JSON.stringify(creds, BufferJSON.replacer);
    await p.query(
      `INSERT INTO baileys_auth_keys (key_id, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key_id) DO UPDATE
       SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [prefix + "creds.json", value]
    );
  };

  const clearAuth = async () => {
    await p.query("DELETE FROM baileys_auth_keys WHERE key_id LIKE $1", [prefix + "%"]);
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [key: string]: SignalDataTypeMap[typeof type] } = {};
          if (ids.length === 0) return data;

          const keyIds = ids.map((id) => `${prefix}${type}-${id}.json`);
          const res = await p.query(
            "SELECT key_id, value FROM baileys_auth_keys WHERE key_id = ANY($1::text[])",
            [keyIds]
          );

          for (const row of res.rows) {
            const rawId = row.key_id.replace(`${prefix}${type}-`, "").replace(".json", "");
            let val = JSON.parse(row.value, BufferJSON.reviver);
            if (type === "app-state-sync-key" && val) {
              val = proto.Message.AppStateSyncKeyData.fromObject(val);
            }
            data[rawId] = val;
          }
          return data;
        },
        set: async (data) => {
          const client = await p.connect();
          try {
            await client.query("BEGIN");
            for (const category in data) {
              for (const id in (data as any)[category]) {
                const value = (data as any)[category][id];
                const key = `${prefix}${category}-${id}.json`;
                if (value) {
                  const serialized = JSON.stringify(value, BufferJSON.replacer);
                  await client.query(
                    `INSERT INTO baileys_auth_keys (key_id, value, updated_at)
                     VALUES ($1, $2, CURRENT_TIMESTAMP)
                     ON CONFLICT (key_id) DO UPDATE
                     SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
                    [key, serialized]
                  );
                } else {
                  await client.query("DELETE FROM baileys_auth_keys WHERE key_id = $1", [key]);
                }
              }
            }
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          } finally {
            client.release();
          }
        },
      },
    },
    saveCreds,
    clearAuth,
  };
}
