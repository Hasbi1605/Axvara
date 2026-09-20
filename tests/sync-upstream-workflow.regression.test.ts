// Workflow sync upstream -> fork (permintaan review PR #1, 2026-09-20).
// Guard ini menjaga properti yang, kalau hilang, konsekuensinya mahal:
// deploy ganda ke Cloudflare, atau history PR yang tertimpa force-push.
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Sumber file bisa di dua tempat: `.github/workflows/` bila sudah terpasang,
// atau `docs/workflows/` selama menunggu pemasangan manual. Kredensial GitHub
// App milik agent TIDAK punya izin `workflows`, sehingga push yang menyentuh
// `.github/workflows/*` ditolak GitHub — file disiapkan di docs/ agar tetap
// tertinjau dan teruji, lalu owner menyalinnya.
const installed = join(process.cwd(), ".github/workflows/sync-upstream.yml");
const staged = join(process.cwd(), "docs/workflows/sync-upstream.yml");
const path = existsSync(installed) ? installed : staged;

describe("workflow sync upstream", () => {
  it("tersedia (terpasang di .github/workflows atau menunggu di docs/workflows)", () => {
    expect(existsSync(path)).toBe(true);
  });

  const wf = existsSync(path) ? readFileSync(path, "utf8") : "";

  it("satu arah: menarik dari upstream, tidak pernah mendorong ke sana", () => {
    expect(wf).toContain("git fetch --no-tags upstream main");
    expect(wf).toContain("git push origin main");
    expect(wf).not.toContain("push upstream");
  });

  it("tidak memakai PAT/deploy key — GITHUB_TOKEN menahan ci.yml agar tidak deploy ganda", () => {
    // AGENTS.md: "satu push tidak memicu deploy ganda". Push ber-GITHUB_TOKEN
    // sengaja TIDAK memicu workflow lain (dok GitHub), sehingga ci.yml yang
    // men-deploy Pages/D1/MCP pada push ke main tidak ikut jalan saat sync.
    expect(wf).not.toMatch(/secrets\.(PAT|GH_PAT|PERSONAL|DEPLOY_KEY|TOKEN_)/);
    expect(wf).toContain("contents: write");
  });

  it("tidak pernah force-push atau reset keras", () => {
    expect(wf).not.toContain("--force");
    expect(wf).not.toContain("-f ");
    expect(wf).not.toContain("reset --hard");
  });

  it("konflik = gagal terang-terangan, bukan diam-diam menimpa", () => {
    expect(wf).toContain("git merge --abort");
    expect(wf).toContain("::error::");
    expect(wf).toContain("exit 1");
  });

  it("idempoten: berhenti lebih dulu bila upstream sudah termuat", () => {
    // Tanpa ini tiap jam bisa lahir merge commit kosong.
    expect(wf).toContain("git merge-base --is-ancestor upstream/main HEAD");
  });

  it("hanya berjalan di fork, bukan di upstream", () => {
    expect(wf).toContain("github.repository == 'marylynnsigala/Axvara'");
  });

  it("punya jalur manual dan anti-tumpang-tindih", () => {
    expect(wf).toContain("workflow_dispatch");
    expect(wf).toContain("concurrency:");
    expect(wf).toContain("cancel-in-progress: false");
  });

  it("hanya menyentuh branch main, bukan branch kerja lain", () => {
    expect(wf).toContain("ref: main");
    expect(wf).toContain("git push origin main");
    // Tidak ada push/checkout ke branch selain main.
    expect(wf).not.toMatch(/git push origin (?!main\b)/);
    expect(wf).not.toMatch(/git checkout (?!-q? ?main\b)[a-z]/);
  });
});
