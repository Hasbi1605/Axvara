"use client";

// Panel pengambilan detail akun digital (Warung Rebahan) di halaman pesanan.
// Kredensial TIDAK dibuka hanya dengan kode order: pembeli memverifikasi
// kepemilikan lewat No. WA atau email checkout (sekali), lalu menerima
// capability token untuk akses ulang (disimpan di sessionStorage perangkat ini
// saja).

import { useEffect, useRef, useState } from "react";
import { formatWibDateTime } from "@/lib/utils";

// `label` hanya ada untuk isi produk non-WR (nama baris pesanan).
type Credential = { label?: string; details: string; completed_at: string | null };

/** Diisi checkout di tab yang sama; dipakai sekali lalu dihapus. */
export const checkoutContactKey = (code: string) => `axvara-checkout-contact:${code}`;

export function WrCredentialsPanel({ code, prefillContact = "", contactHint = "" }: { code: string; prefillContact?: string; contactHint?: string }) {
  const [wa, setWa] = useState(prefillContact);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Akses ulang otomatis bila capability token tersimpan di perangkat ini.
  // prefillContact (hasil lacak yang kontaknya sudah diverifikasi server) atau
  // kontak dari checkout di tab yang sama ikut dicoba sekali otomatis —
  // verifikasi TETAP di server via endpoint credentials.
  const triedPrefill = useRef(false);
  useEffect(() => {
    const saved = sessionStorage.getItem(`wr-cred-token:${code}`);
    if (saved) {
      setLoading(true);
      fetch(`/api/orders/${encodeURIComponent(code)}/credentials?token=${encodeURIComponent(saved)}`)
        .then(async (r) => {
          if (!r.ok) {
            sessionStorage.removeItem(`wr-cred-token:${code}`);
            return;
          }
          const body = (await r.json()) as { credentials?: Credential[] };
          if (body.credentials?.length) {
            setCreds(body.credentials);
            setToken(saved);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }
    const fromCheckout = sessionStorage.getItem(checkoutContactKey(code)) || "";
    if (fromCheckout) sessionStorage.removeItem(checkoutContactKey(code));
    const initial = prefillContact.trim() || fromCheckout.trim();
    if (initial.length >= 6 && !triedPrefill.current) {
      triedPrefill.current = true;
      setWa(initial);
      void verifyWith(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function verifyWith(waValue: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(code)}/credentials`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact: waValue.trim() }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        credentials?: Credential[];
        capability_token?: string | null;
        error?: string;
      };
      if (!r.ok) {
        setError(body.error === "verification_failed" ? "No. WA atau email tidak cocok dengan data pesanan." : body.error === "not_ready" ? "Detail akun belum tersedia — tunggu beberapa menit lalu muat ulang." : "Gagal memverifikasi. Coba lagi.");
        return;
      }
      setCreds(body.credentials ?? []);
      if (body.capability_token) {
        sessionStorage.setItem(`wr-cred-token:${code}`, body.capability_token);
        setToken(body.capability_token);
      }
    } catch {
      setError("Jaringan bermasalah. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    await verifyWith(wa);
  }

  if (creds?.length) {
    return (
      <section className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label="Detail akun digital">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Detail Akun Digital</p>
        <div className="mt-3 space-y-3">
          {creds.map((c, i) => (
            <div key={i} className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3">
              {c.label && <p className="mb-1.5 text-[11px] font-semibold text-emerald-200/80">{c.label}</p>}
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-emerald-100">{c.details}</pre>
              {c.completed_at && <p className="mt-2 text-[11px] text-white/40">Diterima {formatWibDateTime(c.completed_at) ?? "—"}</p>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-white/40">Simpan detail ini. {token ? "Perangkat ini mengingat kode akses untuk kunjungan ulang." : "Jangan bagikan ke siapa pun."}</p>
      </section>
    );
  }

  return (
    <section className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label="Ambil detail akun">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Detail Akun Digital</p>
      <p className="mt-2 text-xs leading-5 text-white/55">Produk digital pesanan ini sudah siap. Masukkan No. WA atau email yang dipakai saat checkout untuk menampilkannya.</p>
      {contactHint && <p className="mt-1 text-[11px] text-white/40">Terdaftar: {contactHint}</p>}
      <div className="mt-3 flex gap-2">
        <input
          value={wa}
          onChange={(e) => setWa(e.target.value)}
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="08… atau nama@email.com"
          aria-label="No. WA atau email checkout"
          className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-[#00E5FF]/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={verify}
          disabled={loading || wa.trim().length < 6}
          className="h-11 shrink-0 rounded-xl bg-[#00E5FF] px-4 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8] disabled:opacity-50"
        >
          {loading ? "Memeriksa…" : "Tampilkan"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-amber-200">{error}</p>}
    </section>
  );
}
