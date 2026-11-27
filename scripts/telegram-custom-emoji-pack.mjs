#!/usr/bin/env node
// scripts/telegram-custom-emoji-pack.mjs — Bangun src/lib/telegram/custom-emoji-map.ts
// dari satu atau beberapa custom emoji pack Telegram.
//
// Pakai:
//   node scripts/telegram-custom-emoji-pack.mjs <pack> [pack ...] [--dry-run]
// <pack> = nama pack (bagian akhir https://t.me/addemoji/<nama>) atau link lengkapnya.
// Pack pertama menang bila beberapa pack punya emoji yang sama.
//
// Token dibaca dari env TELEGRAM_BOT_TOKEN; bila kosong, dicari baris
// TELEGRAM_BOT_TOKEN di .dev.vars lalu .env.local. Nilai token tidak pernah dicetak.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, "src/lib/telegram/custom-emoji-map.ts");
const VS16 = "️";

function readToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN.trim();
  for (const file of [".dev.vars", ".env.local"]) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    const line = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .find((l) => /^\s*TELEGRAM_BOT_TOKEN\s*=/.test(l));
    if (line) return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function packName(arg) {
  const m = /(?:t\.me\/addemoji\/|^)([A-Za-z0-9_]+)\/?$/.exec(arg.trim());
  if (!m) throw new Error(`Nama pack tidak valid: ${arg}`);
  return m[1];
}

async function getStickerSet(token, name) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getStickerSet?name=${encodeURIComponent(name)}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`getStickerSet ${name} gagal: ${json.description ?? res.status}`);
  if (json.result.sticker_type !== "custom_emoji") {
    throw new Error(`${name} bukan custom emoji pack (sticker_type=${json.result.sticker_type})`);
  }
  return json.result;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const packs = args.filter((a) => !a.startsWith("--")).map(packName);
  if (!packs.length) {
    console.error("Pakai: node scripts/telegram-custom-emoji-pack.mjs <pack> [pack ...] [--dry-run]");
    process.exit(1);
  }
  const token = readToken();
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN tidak ditemukan (env, .dev.vars, .env.local).");
    process.exit(1);
  }

  const map = new Map();
  for (const name of packs) {
    const set = await getStickerSet(token, name);
    let added = 0;
    for (const sticker of set.stickers) {
      const emoji = (sticker.emoji ?? "").split(VS16).join("");
      if (!emoji || !sticker.custom_emoji_id || map.has(emoji)) continue;
      map.set(emoji, { id: sticker.custom_emoji_id, pack: name });
      added += 1;
    }
    console.log(`${name}: ${set.stickers.length} emoji, ${added} dipakai`);
  }

  const lines = [...map.entries()]
    .map(([emoji, { id, pack }]) => `  ${JSON.stringify(emoji)}: ${JSON.stringify(id)}, // ${pack}`)
    .join("\n");
  const header = readFileSync(OUT, "utf8").split("export const CUSTOM_EMOJI_MAP")[0];
  const content = `${header}export const CUSTOM_EMOJI_MAP: Readonly<Record<string, string>> = {\n${lines}\n};\n`;

  if (dryRun) {
    console.log(content);
    return;
  }
  writeFileSync(OUT, content);
  console.log(`Ditulis ${map.size} emoji ke ${OUT}`);
}

main().catch((err) => {
  console.error(String(err?.message ?? err).replace(/bot[0-9]+:[A-Za-z0-9_-]+/g, "bot[REDACTED]"));
  process.exit(1);
});
