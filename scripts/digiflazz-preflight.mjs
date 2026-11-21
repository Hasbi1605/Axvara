import { createHash, randomBytes } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const credentialsPath = fileURLToPath(new URL("../.digiflazz-credentials", import.meta.url));

export function initCredentials(path = credentialsPath) {
  writeFileSync(path, JSON.stringify({
    DIGIFLAZZ_USERNAME: "",
    DIGIFLAZZ_DEVELOPMENT_KEY: "",
    DIGIFLAZZ_PRODUCTION_KEY: "",
    DIGIFLAZZ_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

export function readCredentials(path = credentialsPath) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
      throw new Error("Berkas kredensial harus milik sendiri, file biasa <=8 KiB, dengan izin 600.");
    }
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}

export function requestsFor(credentials, production = false) {
  const username = credentials?.DIGIFLAZZ_USERNAME;
  const apiKey = credentials?.[production ? "DIGIFLAZZ_PRODUCTION_KEY" : "DIGIFLAZZ_DEVELOPMENT_KEY"];
  if (![username, apiKey].every(value => typeof value === "string" && value.length > 0 && value.length <= 256 && !/\s/.test(value))) {
    throw new Error("Isi username dan API key untuk mode yang dipilih di .digiflazz-credentials; jangan kirim lewat chat.");
  }
  return [
    ["cek-saldo", "deposit", "depo"],
    ["price-list", "prepaid", "pricelist"],
  ].map(([endpoint, cmd, suffix]) => ({
    endpoint,
    body: { cmd, username, sign: createHash("md5").update(username + apiKey + suffix).digest("hex") },
  }));
}

export function summarize(responses) {
  const deposit = responses?.[0]?.data?.deposit;
  const catalog = responses?.[1]?.data;
  if (typeof deposit !== "number" || !Number.isFinite(deposit) || deposit < 0 || !Array.isArray(catalog)) {
    throw new Error("Respons saldo/katalog tidak valid; periksa key, whitelist, dan produk di dashboard.");
  }
  const games = catalog.filter(row => row && typeof row.category === "string" && /^games$/i.test(row.category.trim()));
  return {
    deposit, configured_products: catalog.length, game_products: games.length,
    // ponytail: snapshot produk akun, bukan ranking marketplace; pemilihan seller memerlukan dashboard.
    games: games.map(row => ({
      sku: row.buyer_sku_code, name: row.product_name, brand: row.brand, type: row.type,
      seller: row.seller_name, description: row.desc, price: row.price,
      buyer_active: row.buyer_product_status, seller_active: row.seller_product_status,
      unlimited_stock: row.unlimited_stock, stock: row.stock, multi: row.multi,
      start_cut_off: row.start_cut_off, end_cut_off: row.end_cut_off,
    })),
  };
}

export async function remoteReadOnly() {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 4096) throw new Error();
    }
    const requests = JSON.parse(input);
    if (!Array.isArray(requests) || requests.length !== 2 || requests[0].endpoint !== "cek-saldo" || requests[1].endpoint !== "price-list") throw new Error();
    const responses = [];
    for (const { endpoint, body } of requests) {
      const response = await fetch(`https://api.digiflazz.com/v1/${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        redirect: "error", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        console.error(`Digiflazz HTTP ${response.status} pada ${endpoint}; tidak ada retry atau pembelian.`);
        process.exitCode = 1;
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 1024 * 1024) throw new Error();
        chunks.push(chunk);
      }
      responses.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    }
    process.stdout.write(JSON.stringify(responses));
  } catch {
    process.exitCode = 1;
  }
}

/** Target SSH VPS dibaca dari env lokal (nilai di `.ops-private.md`, git-ignored), tidak ditulis di repo publik. */
function sshTarget() {
  const target = (process.env.AXVARA_VPS_SSH_TARGET || "").trim();
  if (!/^[\w-]+@(?:\d{1,3}\.){3}\d{1,3}$/.test(target)) throw new Error("Set AXVARA_VPS_SSH_TARGET (user@ip) dari .ops-private.md; tidak ada retry atau pembelian.");
  return target;
}
function sshKeyPath() {
  const key = (process.env.AXVARA_VPS_SSH_KEY || "").trim();
  if (!/\.pem$/.test(key)) throw new Error("Set AXVARA_VPS_SSH_KEY (path .pem) dari .ops-private.md; tidak ada retry atau pembelian.");
  return resolve(key.replace(/^~(?=\/)/, homedir()));
}

/** @param {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding) => import("node:child_process").SpawnSyncReturns<string>} [run] */
export function runCheck(credentials, production = false, run = spawnSync) {
  const requests = requestsFor(credentials, production);
  // Kirim hanya signature terbatas melalui stdin SSH; API key tidak masuk argv atau VPS.
  const source = `(${remoteReadOnly.toString()})()`;
  const result = run("ssh", [
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=yes",
    "-i", sshKeyPath(), sshTarget(),
    `node -e '${source.replaceAll("'", "'\\''")}'`,
  ], { input: JSON.stringify(requests), encoding: "utf8", timeout: 40000, maxBuffer: 3 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const diagnostic = result.stderr?.trim().split("\n").at(-1);
    if (/^Digiflazz HTTP [1-5][0-9]{2} pada (cek-saldo|price-list); tidak ada retry atau pembelian\.$/.test(diagnostic)) throw new Error(diagnostic);
    throw new Error("Cek gagal: periksa SSH, koneksi, whitelist, dan API key; tidak ada retry atau pembelian.");
  }
  try {
    return summarize(JSON.parse(result.stdout));
  } catch {
    throw new Error("Respons saldo/katalog tidak valid; periksa key, whitelist, dan produk di dashboard.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--init") {
      initCredentials();
      console.log("Dibuat .digiflazz-credentials (600, tidak ditimpa); isi username/key secara lokal. Webhook belum aktif.");
    } else if (args[0] === "--check" && (args.length === 1 || (args.length === 2 && args[1] === "--production"))) {
      console.log(JSON.stringify(runCheck(readCredentials(), args.includes("--production")), null, 2));
    } else {
      throw new Error("Gunakan --init atau --check [--production]. Hanya cek saldo/katalog, bukan transaksi.");
    }
  } catch (error) {
    console.error(error instanceof Error && /^Digiflazz HTTP [1-5][0-9]{2} pada (cek-saldo|price-list); tidak ada retry atau pembelian\.$/.test(error.message)
      ? error.message
      : "Persiapan/cek belum berhasil. Periksa argumen (--init atau --check [--production]), berkas privat 600 (tidak boleh ditimpa), username/key, SSH dan whitelist. Tidak ada pembelian.");
    process.exitCode = 1;
  }
}
