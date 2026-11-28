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

/** Tanya satu baris; bila hidden=true karakter yang diketik tidak ditampilkan. */
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        // tampilkan hanya prompt; sembunyikan ketikan
        if (s.startsWith(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const out = parseOut();
const apiId = Number(await ask("API ID: "));
if (!Number.isInteger(apiId) || apiId <= 0) {
  console.error("API ID tidak valid.");
  process.exit(1);
}
const apiHash = await ask("API hash: ", { hidden: true });

const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3, useWSS: false });
client.setLogLevel("error");

try {
  await client.start({
    phoneNumber: () => ask("Nomor telepon (format internasional, mis. +628...): "),
    phoneCode: () => ask("Kode login dari Telegram: "),
    password: () => ask("Password 2FA (kosongkan bila tidak ada): ", { hidden: true }),
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
