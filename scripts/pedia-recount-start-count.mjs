import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const exec = promisify(execFile);
const terminal = ["completed", "partial", "canceled"];
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function parseArgs(args) {
  const options = { codes: [], limit: 50, apply: false, remote: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const [flag, ...parts] = args[i].split("=");
    if (!["--database", "--code", "--limit", "--apply", "--remote"].includes(flag)) throw Error("unknown flag");
    if (flag !== "--code" && seen.has(flag)) throw Error("duplicate flag");
    seen.add(flag);
    if (flag === "--apply" || flag === "--remote") {
      if (parts.length) throw Error("invalid flag");
      options[flag.slice(2)] = true;
      continue;
    }
    const value = parts.length ? parts.join("=") : args[++i];
    if (!value || value.startsWith("--")) throw Error("missing flag value");
    if (flag === "--code") options.codes.push(value);
    else if (flag === "--database") options.database = value;
    else {
      if (!/^[1-9]\d*$/.test(value)) throw Error("invalid limit");
      options.limit = Number(value);
    }
  }
  if (!/^[\w-]{1,128}$/.test(options.database ?? "") || options.limit > 50 ||
      !options.codes.length || options.codes.length > options.limit ||
      new Set(options.codes).size !== options.codes.length ||
      options.codes.some((code) => !/^AXP-[A-Z0-9-]{1,80}$/.test(code))) throw Error("invalid database, limit or order allowlist");
  return options;
}

export function parseStartCount(raw) {
  if ((typeof raw !== "number" && typeof raw !== "string") || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

// ponytail: at most 50 explicit codes and 3 reads per item; use an operator-reviewed batch tool if this ceiling becomes insufficient.
export async function recountOnce(db, call, options) {
  const rows = await db.queryAll(`SELECT order_code, supplier, supplier_order_id FROM pedia_order_items
    WHERE order_code IN (${options.codes.map(() => "?").join(",")})
    AND status IN ('completed','partial','canceled') AND supplier_order_id IS NOT NULL
    AND length(trim(supplier_order_id))>0 AND (start_count IS NULL OR start_count=0)`, ...options.codes);
  const result = { scanned: rows.length, corrected: 0, zero: 0, skipped: 0 };
  for (const row of rows) {
    if (!options.codes.includes(row.order_code) || row.supplier !== "indosmm") { result.skipped++; continue; }
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { response = await call(row.supplier, String(row.supplier_order_id)); } catch { response = null; }
      if (response) break;
    }
    if (!response) throw Error("supplier status read failed after 3 attempts");
    const status = String(response.status ?? "").toLowerCase().replace(/\s+/g, "_").replace(/^cancelled$/, "canceled");
    const count = parseStartCount(response.start_count);
    if (!terminal.includes(status) || count === null) { result.skipped++; continue; }
    if (count === 0) { result.zero++; continue; }
    if (!options.apply) { result.corrected++; continue; }
    const write = await db.execRun(`UPDATE pedia_order_items SET start_count=?, updated_at=datetime('now')
      WHERE order_code=? AND supplier=? AND supplier_order_id=? AND status IN ('completed','partial','canceled')
      AND (start_count IS NULL OR start_count=0)`, count, row.order_code, row.supplier, row.supplier_order_id);
    if (Number(write.changes) === 1) result.corrected++; else result.skipped++;
  }
  return result;
}

function wranglerDb(options) {
  async function execute(sql, params) {
    let index = 0;
    const command = sql.replace(/\?/g, () => quote(params[index++]));
    if (index !== params.length) throw Error("SQL parameter mismatch");
    let stdout;
    try {
      ({ stdout } = await exec("npx", ["--yes", "wrangler@4.128.0", "d1", "execute", options.database,
        options.remote ? "--remote" : "--local", "--json", "--command", command], { maxBuffer: 5_000_000 }));
    } catch { throw Error("D1 command failed"); }
    let response;
    try { response = JSON.parse(stdout); } catch { throw Error("invalid D1 response"); }
    if (!Array.isArray(response) || response.length !== 1 || response[0].success !== true || !Array.isArray(response[0].results)) throw Error("D1 query failed");
    return response[0];
  }
  return {
    queryAll: async (sql, ...params) => (await execute(sql, params)).results,
    execRun: async (sql, ...params) => {
      const response = await execute(sql, params);
      if (!Number.isInteger(response.meta?.changes)) throw Error("missing D1 changes");
      return { changes: response.meta.changes };
    },
  };
}

function proxyCaller() {
  const base = process.env.WARUNG_REBAHAN_PROXY_URL;
  const token = process.env.WARUNG_REBAHAN_PROXY_TOKEN;
  if (!base || !token) throw Error("proxy environment not configured");
  let url;
  try { url = new URL(base); } catch { throw Error("invalid proxy URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw Error("invalid proxy URL");
  return async (supplier, order) => {
    const response = await fetch(`${base.replace(/\/+$/, "")}/indosmm/status`, {
      method: "POST", headers: { "content-type": "application/json", "x-proxy-token": token },
      body: JSON.stringify({ order }), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data && typeof data === "object" && !Array.isArray(data) && !("error" in data) ? data : null;
  };
}

export async function main(args, adapters = {}) {
  const options = parseArgs(args);
  const result = await recountOnce(adapters.db ?? wranglerDb(options), adapters.call ?? proxyCaller(), options);
  return { mode: options.apply ? "apply" : "dry-run", ...result };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(`recount failed: ${error.message}`);
    process.exitCode = 1;
  });
}
