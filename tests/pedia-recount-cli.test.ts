import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("CLI wires wrangler and proxy, defaults to dry-run and fails nonzero on outage", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedia-recount-"));
  try {
    mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(join(dir, "bin/npx"), `#!/usr/bin/env node
      const fs = require('fs');
      const sql = process.argv[process.argv.indexOf('--command') + 1];
      const state = JSON.parse(fs.readFileSync('state.json'));
      if (sql.startsWith('UPDATE')) { state.writes++; state.count = 8278; fs.writeFileSync('state.json', JSON.stringify(state)); }
      process.stdout.write(JSON.stringify([{success:true,results:sql.startsWith('SELECT') ? [{order_code:'AXP-T1',supplier:'indosmm',supplier_order_id:'123'}] : [],meta:{changes:1}}]));
    `);
    chmodSync(join(dir, "bin/npx"), 0o755);
    writeFileSync(join(dir, "preload.mjs"), `globalThis.fetch = async (url, opts) => {
      if (!url.endsWith('/indosmm/status') || JSON.parse(opts.body).order !== '123') throw Error('unexpected request');
      if (process.env.OUTAGE) throw Error('outage');
      return {ok:true,json:async()=>({status:'Completed',start_count:'8278'})};
    };`);
    writeFileSync(join(dir, "state.json"), JSON.stringify({ writes: 0, count: 0 }));
    const script = resolve("scripts/pedia-recount-start-count.mjs");
    const args = [script, "--database", "fixture", "--code", "AXP-T1", "--limit", "1"];
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, NODE_OPTIONS: `--import=${join(dir, "preload.mjs")}`, WARUNG_REBAHAN_PROXY_URL: "https://example.test", WARUNG_REBAHAN_PROXY_TOKEN: "fixture" };
    const run = (extra: string[], environment = env) => execFileSync(process.execPath, [...args, ...extra], { cwd: dir, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(JSON.parse(run([]))).toMatchObject({ mode: "dry-run", corrected: 1 });
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).writes).toBe(0);
    expect(JSON.parse(run(["--apply"]))).toMatchObject({ mode: "apply", corrected: 1 });
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).writes).toBe(1);
    expect(() => run([], { ...env, OUTAGE: "1" })).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
