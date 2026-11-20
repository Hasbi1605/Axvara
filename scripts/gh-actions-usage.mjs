#!/usr/bin/env node
// Estimasi pemakaian menit GitHub Actions bulan berjalan untuk repo ini,
// dihitung dari durasi job (dibulatkan ke atas per job, seperti tagihan
// GitHub-hosted Linux 1x). Berjalan lokal lewat `gh` — tidak memakai menit
// Actions. Angka resmi tetap di GitHub Settings → Billing (butuh scope `user`:
// `gh auth refresh -h github.com -s user`, lalu `--official`).
//
// Pakai: node scripts/gh-actions-usage.mjs [--month 2026-11] [--limit 2000] [--official]
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const now = new Date();
const month = opt("month", `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
const limit = Number(opt("limit", "2000"));
const gh = (path, jq) => execFileSync("gh", ["api", path, "--paginate", ...(jq ? ["--jq", jq] : [])], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const repo = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" }).trim();

if (args.includes("--official")) {
  const owner = repo.split("/")[0];
  const [y, m] = month.split("-");
  try {
    console.log(gh(`/users/${owner}/settings/billing/usage/summary?year=${y}&month=${Number(m)}&product=actions`));
  } catch {
    console.error("Billing API gagal. Jalankan: gh auth refresh -h github.com -s user");
    process.exitCode = 1;
  }
  process.exit();
}

const [y, m] = month.split("-").map(Number);
const start = new Date(Date.UTC(y, m - 1, 1));
const end = new Date(Date.UTC(y, m, 1));
const runs = gh(
  `repos/${repo}/actions/runs?created=${start.toISOString().slice(0, 10)}..${new Date(end - 86400000).toISOString().slice(0, 10)}&per_page=100`,
  ".workflow_runs[] | [.id, .name] | @tsv",
).trim().split("\n").filter(Boolean).map((l) => l.split("\t"));

const perWorkflow = new Map();
let total = 0;
for (const [id, name] of runs) {
  const jobs = gh(`repos/${repo}/actions/runs/${id}/jobs?per_page=100`, ".jobs[] | [.started_at, .completed_at, (.labels|join(\",\"))] | @tsv")
    .trim().split("\n").filter(Boolean);
  for (const line of jobs) {
    const [s, c, labels] = line.split("\t");
    if (!s || !c || s === "null" || c === "null") continue;
    if (/self-hosted/.test(labels)) continue; // runner sendiri gratis
    const secs = (Date.parse(c) - Date.parse(s)) / 1000;
    const mins = secs > 0 ? Math.max(1, Math.ceil(secs / 60)) : 0;
    const mult = /macos/i.test(labels) ? 10 : /windows/i.test(labels) ? 2 : 1;
    total += mins * mult;
    const w = perWorkflow.get(name) ?? { runs: 0, minutes: 0 };
    w.minutes += mins * mult;
    perWorkflow.set(name, w);
  }
  const w = perWorkflow.get(name) ?? { runs: 0, minutes: 0 };
  w.runs += 1;
  perWorkflow.set(name, w);
}

const daysElapsed = Math.max(1, Math.min((Date.now() - start) / 86400000, (end - start) / 86400000));
const daysInMonth = (end - start) / 86400000;
const projected = Math.round((total / daysElapsed) * daysInMonth);
console.log(`Repo ${repo} · bulan ${month}`);
for (const [name, w] of perWorkflow) console.log(`  ${name}: ${w.runs} run, ~${w.minutes} menit`);
console.log(`Total ~${total} menit (estimasi) · batas ${limit} · sisa ~${Math.max(0, limit - total)}`);
console.log(`Proyeksi akhir bulan ~${projected} menit${projected > limit ? "  ⚠️ melebihi batas" : ""}`);
