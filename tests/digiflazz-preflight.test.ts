import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { initCredentials, readCredentials, requestsFor, remoteReadOnly, runCheck, summarize } from "../scripts/digiflazz-preflight.mjs";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const credentials = { DIGIFLAZZ_USERNAME: "fixture", DIGIFLAZZ_DEVELOPMENT_KEY: "dev-key", DIGIFLAZZ_PRODUCTION_KEY: "prod-key" };
const responses = [{ data: { deposit: 0 } }, { data: [
  { category: "Games", brand: "FREE FIRE", buyer_sku_code: "FF70", product_name: "70 Diamonds", price: "7000", seller_name: "Fixture Seller", desc: "Indonesia", seller_product_status: false },
  { category: "Games", brand: "MOBILE LEGENDS", buyer_sku_code: "ML85", price: 22672, buyer_product_status: true },
  { category: "Pulsa", brand: "XL", buyer_sku_code: "X100", price: 98000 },
  { category: " games ", brand: "Honkai Star Rail", buyer_sku_code: "HSR60", price: 10000 },
] }];

describe("Digiflazz preflight (tanpa jaringan/transaksi)", () => {
  it("membuat secret privat, tidak menimpa file existing atau mengikuti symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "digiflazz-"));
    dirs.push(dir);
    const path = join(dir, "credentials");
    initCredentials(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readCredentials(path).DIGIFLAZZ_WEBHOOK_SECRET).toMatch(/^[a-f0-9]{64}$/);
    const original = readFileSync(path, "utf8");
    expect(() => initCredentials(path)).toThrow();
    expect(readFileSync(path, "utf8")).toBe(original);
    symlinkSync(path, join(dir, "link"));
    expect(() => readCredentials(join(dir, "link"))).toThrow();
    chmodSync(path, 0o644);
    expect(() => readCredentials(path)).toThrow();
    writeFileSync(path, "x".repeat(8193), { mode: 0o600 });
    chmodSync(path, 0o600);
    expect(() => readCredentials(path)).toThrow();
  });

  it("hanya mengizinkan saldo dan katalog, signature sesuai kontrak dan mode eksplisit", () => {
    for (const production of [false, true]) {
      const key = production ? "prod-key" : "dev-key";
      const requests = requestsFor(credentials, production);
      expect(requests.map(row => row.endpoint)).toEqual(["cek-saldo", "price-list"]);
      expect(requests.map(row => row.body.cmd)).toEqual(["deposit", "prepaid"]);
      expect(requests.map(row => row.body.sign)).toEqual(["depo", "pricelist"].map(suffix => createHash("md5").update("fixture" + key + suffix).digest("hex")));
      expect(JSON.stringify(requests)).not.toContain(key);
    }
    expect(() => requestsFor({ ...credentials, DIGIFLAZZ_DEVELOPMENT_KEY: "" })).toThrow();
    expect(() => requestsFor({ ...credentials, DIGIFLAZZ_USERNAME: "bad\ninput" })).toThrow();
    expect(() => requestsFor(null)).toThrow();
  });

  it("menampilkan hanya game terpilih tanpa menyimpulkan stok atau region", () => {
    const report = summarize(responses);
    expect(report.deposit).toBe(0);
    expect(report.configured_products).toBe(4);
    expect(report.games.map(row => row.sku)).toEqual(["FF70", "ML85", "HSR60"]);
    expect(report.games[0].seller_active).toBe(false);
    expect(report.games[0].seller).toBe("Fixture Seller");
    expect(report.games[0].description).toBe("Indonesia");
    expect(summarize([{ data: { deposit: 0 } }, { data: [] }]).games).toEqual([]);
    for (const bad of [[], [{ data: { deposit: "0" } }, { data: [] }], [{ data: { deposit: -1 } }, { data: [] }], [{ data: { deposit: 0 } }, { data: { message: "secret upstream error" } }]]) {
      expect(() => summarize(bad)).toThrow();
    }
  });

  it("memakai SSH fixed-host, stdin tanpa key, timeout dan tanpa retry saat gagal", () => {
    vi.stubEnv("AXVARA_VPS_SSH_TARGET", "ec2-user@203.0.113.10");
    vi.stubEnv("AXVARA_VPS_SSH_KEY", "~/.ssh/fixture-proxy.pem");
    const run = vi.fn().mockReturnValue({ pid: 0, output: [], stderr: "", signal: null, status: 0, stdout: JSON.stringify(responses) });
    expect(runCheck(credentials, false, run).game_products).toBe(3);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("ssh", [
      "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=yes",
      "-i", expect.stringMatching(/\/\.ssh\/[^/]+\.pem$/), expect.stringMatching(/^[\w-]+@(?:\d{1,3}\.){3}\d{1,3}$/),
      expect.any(String),
    ], expect.objectContaining({ timeout: 40000 }));
    const call = JSON.stringify(run.mock.calls[0]);
    expect(call).not.toContain("dev-key");
    expect(call).not.toContain("prod-key");
    expect(call).not.toContain("/transaction");
    run.mockReturnValue({ pid: 0, output: [], stderr: "upstream-secret", signal: null, status: 1, stdout: "upstream-secret" });
    expect(() => runCheck(credentials, false, run)).toThrow(/Cek gagal/);
    run.mockReturnValue({ pid: 0, output: [], stderr: "", signal: null, status: 0, stdout: "upstream-secret" });
    expect(() => runCheck(credentials, false, run)).toThrow(/Respons saldo/);
    run.mockReturnValue({ pid: 0, output: [], stderr: "OpenSSH warning\nDigiflazz HTTP 429 pada price-list; tidak ada retry atau pembelian.\n", signal: null, status: 1, stdout: "" });
    expect(() => runCheck(credentials, false, run)).toThrow("Digiflazz HTTP 429 pada price-list; tidak ada retry atau pembelian.");
  });

  it("tidak membatasi 50 SKU dan tidak menganggap brand saja sebagai kategori Games", () => {
    const catalog = Array.from({ length: 75 }, (_, index) => ({ category: "Games", brand: `Game ${index}`, buyer_sku_code: `SKU${index}` }));
    const report = summarize([{ data: { deposit: 0 } }, { data: [...catalog, { category: "Voucher", brand: "MOBILE LEGENDS" }, { brand: "FREE FIRE" }] }]);
    expect(report.game_products).toBe(75);
    expect(report.games).toHaveLength(75);
    expect(report.games.at(-1)?.sku).toBe("SKU74");
  });

  it("menjalankan program remote dengan dua request HTTPS baca-saja (fetch fixture)", () => {
    const source = `const responses = ${JSON.stringify(responses)};
      globalThis.fetch = async (url, options) => {
        const index = url === "https://api.digiflazz.com/v1/cek-saldo" ? 0 : url === "https://api.digiflazz.com/v1/price-list" ? 1 : -1;
        if (index < 0 || options.redirect !== "error" || options.method !== "POST") throw new Error();
        return new Response(JSON.stringify(responses[index]));
      };
      (${remoteReadOnly.toString()})()`;
    const result = spawnSync(process.execPath, ["-e", source], { input: JSON.stringify(requestsFor(credentials)), encoding: "utf8", timeout: 5000 });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(responses);
  });

  it("menolak endpoint tulis, respons rusak/besar, dan HTTP gagal tanpa membocorkan body", () => {
    const cases = [
      { input: '[{"endpoint":"transaction"},{"endpoint":"price-list"}]', response: 'new Response("unexpected")' },
      { input: JSON.stringify(requestsFor(credentials)), response: 'new Response("upstream-secret", {status: 403})' },
      { input: JSON.stringify(requestsFor(credentials)), response: 'new Response("upstream-secret")' },
      { input: JSON.stringify(requestsFor(credentials)), response: 'new Response("x".repeat(1024 * 1024 + 1))' },
    ];
    for (const fixture of cases) {
      const source = `globalThis.fetch = async () => ${fixture.response}; (${remoteReadOnly.toString()})()`;
      const result = spawnSync(process.execPath, ["-e", source], { input: fixture.input, encoding: "utf8", timeout: 5000 });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("upstream-secret");
      expect(result.stderr).toBe(fixture.response.includes("status: 403") ? "Digiflazz HTTP 403 pada cek-saldo; tidak ada retry atau pembelian.\n" : "");
    }
  });
});
