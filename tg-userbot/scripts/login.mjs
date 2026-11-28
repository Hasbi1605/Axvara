// scripts/login.mjs — login interaktif SATU KALI, dijalankan OWNER di Terminal sendiri.
// Menyimpan StringSession ke --out (default ~/.axvara-tg-userbot.session, mode 0600).
// Tidak pernah mencetak kode login, password 2FA, API hash maupun session.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import telegram from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const { TelegramClient } = telegram;

function parseOut() {
  const i = process.argv.indexOf("--out");
  const raw = i > -1 ? process.argv[i + 1] : undefined;
  if (i > -1 && !raw) throw new Error("--out membutuhkan path");
  return path.resolve((raw ?? path.join(os.homedir(), ".axvara-tg-userbot.session")).replace(/^~(?=$|\/)/, os.homedir()));
}

const clean = (v) => v.replace(/\x1b\[[0-9;]*[~A-Za-z]/g, "").replace(/[\x00-\x1f\x7f]/g, "").trim();

/** Satu baris terlihat: mode baris standar (echo TTY), aman untuk paste. */
function askVisible(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    process.stdout.write(question);
    rl.once("line", (line) => { rl.close(); resolve(clean(line)); });
  });
}

/** Satu baris tersembunyi: raw mode, ketikan/paste tidak ditampilkan. */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) return askVisible("").then(resolve);
    stdin.setRawMode(true);
    stdin.resume();
    let buf = "";
    const onData = (chunk) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\u0003") { stdin.setRawMode(false); process.stdout.write("\n"); process.exit(130); }
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(clean(buf));
        }
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function ask(question, { hidden = false, validate = (v) => v.length > 0, tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = hidden ? await askHidden(question) : await askVisible(question);
    if (validate(v)) return v;
    console.error("Input kosong/tidak valid, coba lagi.");
  }
  console.error("Terlalu banyak percobaan.");
  process.exit(1);
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const out = parseOut();
const apiIdArg = (argValue("--api-id") ?? "").replace(/\D/g, "");
const apiId = Number(apiIdArg || (await ask("API ID: ", { validate: (v) => /^\d{3,12}$/.test(v.replace(/\D/g, "")) })).replace(/\D/g, ""));
const apiHash = await ask("API hash: ", { hidden: true, validate: (v) => /^[0-9a-f]{32}$/i.test(v) });

const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3, useWSS: false });
client.setLogLevel("error");

try {
  await client.start({
    phoneNumber: () => ask("Nomor telepon (format internasional, mis. +628...): ", { validate: (v) => /^\+?\d{8,15}$/.test(v.replace(/[\s-]/g, "")) }),
    phoneCode: () => ask("Kode login dari Telegram: ", { validate: (v) => /^\d{4,8}$/.test(v.replace(/\D/g, "")) }),
    password: () => ask("Password 2FA: ", { hidden: true }),
    onError: (e) => console.error("Gagal:", String(e?.errorMessage ?? e?.name ?? "error")),
  });
  const me = await client.getMe();
  const session = client.session.save();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fd = fs.openSync(out, "w", 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, `${session}\n`);
  } finally {
    fs.closeSync(fd);
  }
  // API id/hash ikut disimpan (0600) agar operator bisa menyalinnya ke .env VPS tanpa melihat nilainya.
  const envOut = `${out}.env`;
  const efd = fs.openSync(envOut, "w", 0o600);
  try {
    fs.fchmodSync(efd, 0o600);
    fs.writeFileSync(efd, `TG_API_ID=${apiId}\nTG_API_HASH=${apiHash}\n`);
  } finally {
    fs.closeSync(efd);
  }
  console.log(`Session saved to ${out}`);
  console.log(`API credentials saved to ${envOut}`);
  console.log(`Logged in as ${me.firstName ?? "(tanpa nama)"}`);
} finally {
  await client.disconnect().catch(() => undefined);
}
process.exit(0);
