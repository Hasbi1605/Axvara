"use client";

// Panel pengambilan detail akun digital (Warung Rebahan) di halaman pesanan.
// Kredensial TIDAK dibuka hanya dengan kode order: pembeli memverifikasi
// kepemilikan lewat kontak checkout penuh (email/WA) + PIN 6 karakter dari
// email pembelian (koreksi owner 27 Okt 2026). PIN hanya React state, tidak
// pernah disimpan di storage/URL, tidak pernah ditampilkan plaintext.
// Setelah verifikasi hanya capability token yang disimpan (GET polling).

import { useEffect, useRef, useState } from "react";
import { formatWibDateTime } from "@/lib/utils";
import { CredentialText, ActivationBody, MobileCollapsible, TermsBody } from "@/components/storefront/ProductCopy";
import { WarrantyClaimAccordion } from "@/components/storefront/WarrantyClaim";
import type { VariantCopy } from "@/lib/product-copy/format";
import { orderAccessHeaders, readOrderContact } from "@/lib/order-access-client";
import { normalizeOrderAccessCode } from "@/lib/order-access-format";

// `label` hanya ada untuk isi produk non-WR (nama baris pesanan).
// `terms` = S&K + cara aktivasi ter-resolusi (resolver PDP yang sama),
// dirender sebagai blok terpisah DI BAWAH kredensial — bukan dicampur ke
// teks kredensial, agar isi akun tetap bersih untuk disalin (2026-10-13).
type Credential = { label?: string; details: string; completed_at: string | null; terms?: VariantCopy | null };

/** Diisi checkout; bertahan selama tab itu terbuka (sessionStorage), jadi muat ulang tetap membuka otomatis. */
export const checkoutContactKey = (code: string) => `axvara-checkout-contact:${code}`;

const WA_RE = /^(\+62|62|0)8\d{8,13}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isContactValue(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.length > 254) return false;
  return value.includes("@") ? EMAIL_RE.test(value) : WA_RE.test(value.replace(/[\s-]/g, ""));
}

function normalizePin(raw: string): string {
  const normalized = normalizeOrderAccessCode(raw.trim());
  return [6, 26].includes(normalized.length) ? normalized : "";
}

export function WrCredentialsPanel({ code, prefillContact = "", prefillPin = "", buyerPinRequired = true, contactHint = "", deliveryProgress, adminView = false }: { code: string; prefillContact?: string; prefillPin?: string; buyerPinRequired?: boolean; contactHint?: string; deliveryProgress?: {ready:number;total:number}; adminView?: boolean }) {
  const [contact, setContact] = useState(prefillContact);
  const [pin, setPin] = useState(prefillPin);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const accountRef = useRef<HTMLElement | null>(null);
  const scrolledForCode = useRef<string | null>(null);
  const hasCredentials = Boolean(creds?.length);
  const contactEdited = useRef(false);
  const pinEdited = useRef(false);

  // Prefill dari form utama (hasil lookup sukses) — React state saja, tidak
  // pernah dari server/storage/URL. Jangan menimpa ketikan pengguna.
  useEffect(() => {
    if (prefillContact && !contactEdited.current) setContact(prefillContact);
  }, [prefillContact]);
  useEffect(() => {
    if (prefillPin && !pinEdited.current) setPin(prefillPin);
  }, [prefillPin]);

  useEffect(() => {
    if (!hasCredentials || scrolledForCode.current === code) return;
    // Tunggu isi akun terpasang di DOM; polling/rerender tidak menarik
    // pembeli kembali saat sedang membaca panduan atau membuka accordion.
    const frame = requestAnimationFrame(() => {
      const account = accountRef.current;
      if (!account) return;
      const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // `auto` masih mengikuti html { scroll-behavior: smooth }.
      const top = Math.max(0, window.scrollY + account.getBoundingClientRect().top - 96);
      window.scrollTo({ top, behavior: reducedMotion ? "instant" : "smooth" });
      scrolledForCode.current = code;
    });
    return () => cancelAnimationFrame(frame);
  }, [code, hasCredentials]);

  // Akses ulang otomatis bila capability token tersimpan di perangkat ini.
  // Auto-verifikasi kontak+PIN hanya bila keduanya sudah ada (prefill dari
  // lookup sukses / checkout tab sama untuk legacy tanpa PIN). Verifikasi
  // TETAP di server via endpoint credentials; PIN tidak pernah disimpan.
  const triedPrefill = useRef(false);
  const loadedForReady = useRef(-1);
  useEffect(() => {
    let cancelled = false;
    if (adminView) {
      const controller = new AbortController();
      setLoading(true);
      void fetch(`/api/orders/${encodeURIComponent(code)}/credentials`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminView: true }), signal: controller.signal, cache: "no-store",
      }).then(async r => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) { setCreds(null); setError(r.status === 401 ? "Sesi admin berakhir. Masuk kembali ke panel admin." : "Gagal memuat detail akun."); return; }
        setError(null); setCreds(body.credentials ?? []);
      }).catch(() => { if (!cancelled) setError("Jaringan bermasalah. Coba muat ulang."); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; controller.abort(); };
    }
    const tokenKey = `wr-cred-token:${code}`;
    const savedCheckoutContact = (() => {
      try { return sessionStorage.getItem(checkoutContactKey(code)) || ""; } catch { return ""; }
    })();
    const savedStatusContact = readOrderContact(code);
    const autoContact = prefillContact.trim() || savedCheckoutContact.trim() || savedStatusContact.trim();
    const autoPin = normalizePin(prefillPin);
    const verifyFromContact = () => {
      if (triedPrefill.current) return;
      if (!isContactValue(autoContact)) return;
      // Order PIN6 butuh PIN; legacy tanpa PIN boleh kontak saja.
      if (buyerPinRequired && !autoPin) return;
      triedPrefill.current = true;
      if (!contactEdited.current) setContact(autoContact);
      if (autoPin && !pinEdited.current) setPin(autoPin);
      void verifyWith(autoContact, buyerPinRequired ? autoPin : "");
    };
    const requestedReady = deliveryProgress?.ready ?? 0;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(tokenKey); } catch { /* Optional tab storage. */ }
    if (!saved) {
      verifyFromContact();
      return;
    }
    if (loadedForReady.current >= requestedReady) return;
    setLoading(true);
    void (async () => {
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(code)}/credentials`, { cache: "no-store", headers: { "x-credential-token": saved } });
        if (cancelled) return;
        if (r.ok) {
          const body = (await r.json()) as { credentials?: Credential[] };
          if (cancelled) return;
          if (body.credentials?.length) {
            loadedForReady.current = requestedReady;
            setCreds(body.credentials);
            setToken(saved);
            return;
          }
        } else if (r.status === 401 || r.status === 403) {
          // Hanya token yang ditolak server yang dibuang; 429/5xx sementara tidak.
          try { sessionStorage.removeItem(tokenKey); } catch { /* Storage opsional. */ }
        }
      } catch {
        /* jaringan: lanjut ke kontak checkout */
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) verifyFromContact();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, deliveryProgress?.ready, token, adminView, buyerPinRequired]);

  async function verifyWith(contactValue: string, pinValue: string) {
    const requestedReady = deliveryProgress?.ready ?? 0;
    const cleanContact = contactValue.trim();
    const cleanPin = normalizePin(pinValue);
    if (!isContactValue(cleanContact)) {
      setError("Isi email atau No. WA checkout yang dipakai saat memesan.");
      return;
    }
    if (buyerPinRequired && !cleanPin) {
      setError("Isi PIN 6 karakter dari email pembelian.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // PIN hanya di body, tidak pernah jadi header/kontak/URL/storage.
      const body: Record<string, string> = { contact: cleanContact };
      if (cleanPin) body.access_code = cleanPin;
      const r = await fetch(`/api/orders/${encodeURIComponent(code)}/credentials`, {
        method: "POST",
        headers: { "content-type": "application/json", ...orderAccessHeaders(code, cleanContact) },
        body: JSON.stringify(body),
      });
      const responseBody = (await r.json().catch(() => ({}))) as {
        credentials?: Credential[];
        capability_token?: string | null;
        error?: string;
      };
      if (!r.ok) {
        setError(responseBody.error === "verification_failed" ? "Kontak atau PIN tidak cocok. Periksa email pembelian." : responseBody.error === "not_ready" ? "Detail akun belum tersedia — tunggu beberapa menit lalu muat ulang." : "Gagal memverifikasi. Coba lagi.");
        return;
      }
      loadedForReady.current = requestedReady;
      setCreds(responseBody.credentials ?? []);
      if (responseBody.capability_token) {
        try { sessionStorage.setItem(`wr-cred-token:${code}`, responseBody.capability_token); } catch { /* Credentials remain available in this response. */ }
        setToken(responseBody.capability_token);
      }
    } catch {
      setError("Jaringan bermasalah. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  if (creds?.length) {
    return (
      <section ref={accountRef} className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label="Detail akun digital">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Detail Akun Digital</p>
        {deliveryProgress && <p className="mt-2 text-xs text-white/60" role="status">{deliveryProgress.ready} dari {deliveryProgress.total} akun siap</p>}
        {error && <p className="mt-2 text-xs text-red-300" role="alert">{error}</p>}
        <div className="mt-3 space-y-3">
          {creds.map((c, i) => (
            <div key={i} className="space-y-3">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3">
                {c.label && <p className="mb-1.5 text-[11px] font-semibold text-emerald-200/80">{c.label}</p>}
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-emerald-100"><CredentialText text={c.details} /></pre>
                <button type="button" className="mt-2 min-h-9 whitespace-nowrap rounded-lg border border-emerald-400/20 px-3 text-xs text-emerald-200" onClick={() => {
                  void Promise.resolve().then(()=>navigator.clipboard.writeText(c.details)).then(()=>{setCopied(i);setError(null)}).catch(()=>setError("Gagal menyalin. Pilih teks akun untuk menyalinnya."));
                }}>{copied===i ? "Tersalin" : `Salin akun ${i+1}`}</button>
                {c.completed_at && <p className="mt-2 text-[11px] text-white/40">Diterima {formatWibDateTime(c.completed_at) ?? "—"}</p>}
              </div>
              {c.terms && !creds.slice(i+1).some(next=>JSON.stringify(next.terms)===JSON.stringify(c.terms)) && (c.terms.sections.length > 0 || c.terms.activation.length > 0 || c.terms.notes.length > 0) && (
                <>
                  {c.terms.sections.length > 0 && (
                    <MobileCollapsible title="Syarat & Ketentuan">
                      <TermsBody sections={c.terms.sections} size="xs" />
                    </MobileCollapsible>
                  )}
                  {(c.terms.activation.length > 0 || c.terms.notes.length > 0) && (
                    <MobileCollapsible title="Cara Penggunaan / Aktivasi">
                      <ActivationBody groups={c.terms.activation} notes={c.terms.notes} size="xs" />
                    </MobileCollapsible>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <WarrantyClaimAccordion className="mt-3" />
        <p className="mt-3 text-[11px] leading-5 text-white/40">Simpan detail ini. {token ? "Perangkat ini mengingat akses untuk kunjungan ulang." : "Jangan bagikan ke siapa pun."}</p>
      </section>
    );
  }

  if (adminView) return <section className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label="Detail akun admin">
    <p role="status" className="text-sm text-white/65">{loading ? "Memuat detail akun…" : "Detail akun belum tersedia."}</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </section>;

  const pinRequired = buyerPinRequired;
  return (
    <section className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label="Ambil detail akun">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Detail Akun Digital</p>
      <p className="mt-2 text-xs leading-5 text-white/65">{buyerPinRequired ? "Masukkan kontak checkout dan PIN dari email produk siap untuk membuka akun." : "Masukkan email atau No. WA yang dipakai saat checkout untuk membuka akun pesanan lama."}</p>
      {contactHint && <p className="mt-1 text-[11px] text-white/40">Terdaftar: {contactHint}</p>}
      <form
        className="mt-3 grid gap-2"
        onSubmit={(event) => { event.preventDefault(); void verifyWith(contact, pin); }}
      >
        <div>
          <label htmlFor={`wr-cred-contact-${code}`} className="mb-1 block text-xs font-medium text-white/60">Email atau No. WA checkout *</label>
          <input
            id={`wr-cred-contact-${code}`}
            value={contact}
            onChange={(e) => { contactEdited.current = true; setContact(e.target.value); }}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="nama@email.com atau 08…"
            aria-label="Email atau No. WA checkout"
            className="h-11 min-w-0 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/55 focus:border-[#00E5FF]/60 focus:outline-none"
          />
        </div>
        {pinRequired && <div>
          <label htmlFor={`wr-cred-pin-${code}`} className="mb-1 block text-xs font-medium text-white/60">PIN akses {pinRequired ? "*" : "(pesanan baru)"}</label>
          <input
            id={`wr-cred-pin-${code}`}
            value={pin}
            onChange={(e) => { pinEdited.current = true; setPin(e.target.value); }}
            type="password"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            placeholder="6 karakter dari email"
            aria-label="PIN akses"
            required={pinRequired}
            className="h-11 min-w-0 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/55 focus:border-[#00E5FF]/60 focus:outline-none"
          />
        </div>}
        <button
          type="submit"
          disabled={loading || !isContactValue(contact) || (pinRequired && !normalizePin(pin))}
          className="h-11 w-full shrink-0 rounded-xl bg-[#00E5FF] px-4 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8] disabled:opacity-50"
        >
          {loading ? "Memeriksa…" : "Tampilkan"}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-amber-200">{error}</p>}
      <WarrantyClaimAccordion className="mt-3" />
    </section>
  );
}
