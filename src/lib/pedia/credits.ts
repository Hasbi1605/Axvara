// src/lib/pedia/credits.ts — Kode Kredit Pedia (PEDIA-PRD §8, PD-24).
//
// Refund tanpa login: partial/cancel → kode `PDK-XXXX-XXXX`, berlaku 180
// hari, hanya untuk belanja Pedia. Kode mentah HANYA dikirim ke pembeli
// (email + halaman pesanan); yang disimpan = hash SHA-256 + hint 4 char.
// Penerbitan idempoten per (source_order_code, source_kind) via UNIQUE.
// Pemakaian atomik: UPDATE ... WHERE remaining >= pakai (cek changes).

const CREDIT_PREFIX = "PDK";
export const PEDIA_CREDIT_TTL_DAYS = 180;

function randomCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes).map((b) => b.toString(36)).join("").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const padded = (raw + "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".repeat(2)).slice(0, 8);
  return `${CREDIT_PREFIX}-${padded.slice(0, 4)}-${padded.slice(4, 8)}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type IssueCreditArgs = {
  email: string;
  amount: number;
  sourceOrderCode?: string | null;
  sourceKind: "partial" | "canceled" | "admin";
};

/** Terbitkan kredit. Idempoten untuk partial/canceled (UNIQUE per order). */
export async function issuePediaCredit(
  db: { execRun: (q: string, ...p: unknown[]) => Promise<unknown>; queryFirst: (q: string, ...p: unknown[]) => Promise<Record<string, unknown> | null> },
  args: IssueCreditArgs,
): Promise<{ code: string; id: number }> {
  const amount = Math.floor(Number(args.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid_amount");
  const code = randomCode();
  const hash = await sha256Hex(code);
  const hint = code.slice(-4);
  await db.execRun(
    `INSERT INTO pedia_credits
       (code_hash, code_hint, email, amount, remaining, source_order_code, source_kind, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+${PEDIA_CREDIT_TTL_DAYS} days'))
     ON CONFLICT(source_order_code, source_kind) DO NOTHING`,
    hash, hint, args.email.slice(0, 160), amount, amount,
    args.sourceOrderCode ?? null, args.sourceKind,
  );
  // Ambil baris pemenang (milik kita atau milik penerbitan sebelumnya).
  const row = await db.queryFirst(
    `SELECT id, code_hash FROM pedia_credits WHERE source_order_code IS ? AND source_kind=?`,
    args.sourceOrderCode ?? null, args.sourceKind,
  );
  if (!row) throw new Error("credit_issue_failed");
  const isOurs = String(row.code_hash) === hash;
  if (isOurs) {
    await db.execRun(
      `INSERT INTO pedia_credit_ledger (credit_id, order_code, delta) VALUES (?, ?, ?)`,
      Number(row.id), args.sourceOrderCode ?? null, amount,
    ).catch(() => null);
    return { code, id: Number(row.id) };
  }
  // Sudah pernah diterbitkan (poll diulang — PD-24 tepat sekali): kode mentah
  // lama tidak bisa direkonstruksi dari hash; kembalikan penanda agar caller
  // tidak mengirim email ganda.
  throw new Error("credit_already_issued");
}

/** Cek kode → sisa (tanpa membocorkan email). */
export async function checkPediaCredit(
  db: { queryFirst: (q: string, ...p: unknown[]) => Promise<Record<string, unknown> | null> },
  code: string,
): Promise<{ remaining: number } | null> {
  const clean = String(code || "").trim().toUpperCase();
  if (!/^PDK-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) return null;
  const hash = await sha256Hex(clean);
  const row = await db.queryFirst(
    `SELECT remaining, expires_at FROM pedia_credits
      WHERE code_hash=? AND datetime(expires_at) > datetime('now')`,
    hash,
  ).catch(() => null);
  if (!row) return null;
  return { remaining: Number(row.remaining) };
}

/** Pakai kredit secara atomik. Mengembalikan jumlah yang benar-benar dipakai. */
export async function consumePediaCredit(
  db: {
    execRun: (q: string, ...p: unknown[]) => Promise<{ changes?: number }>;
    queryFirst: (q: string, ...p: unknown[]) => Promise<Record<string, unknown> | null>;
  },
  code: string,
  orderCode: string,
  maxAmount: number,
): Promise<{ used: number; remaining: number }> {
  const check = await checkPediaCredit(db, code);
  if (!check || check.remaining <= 0) return { used: 0, remaining: 0 };
  const use = Math.min(check.remaining, Math.max(0, Math.floor(maxAmount)));
  if (use <= 0) return { used: 0, remaining: check.remaining };
  const hash = await sha256Hex(String(code).trim().toUpperCase());
  const credit = await db.queryFirst(`SELECT id FROM pedia_credits WHERE code_hash=?`, hash).catch(() => null);
  if (!credit) return { used: 0, remaining: 0 };
  // Atomic: hanya berhasil bila sisa mencukupi (dua request bersamaan → satu menang).
  const r = await db.execRun(
    `UPDATE pedia_credits SET remaining=remaining-? WHERE id=? AND remaining>=?`,
    use, Number(credit.id), use,
  ).catch(() => ({ changes: 0 }));
  if (Number(r?.changes || 0) !== 1) {
    const again = await checkPediaCredit(db, code);
    return { used: 0, remaining: again?.remaining ?? 0 };
  }
  await db.execRun(
    `INSERT INTO pedia_credit_ledger (credit_id, order_code, delta) VALUES (?, ?, ?)`,
    Number(credit.id), orderCode, -use,
  ).catch(() => null);
  return { used: use, remaining: check.remaining - use };
}
