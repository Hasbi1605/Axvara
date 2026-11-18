"use client";

// Panel pengambilan detail akun digital (Warung Rebahan) di halaman pesanan.
// Kredensial TIDAK dibuka hanya dengan kode order: pembeli memverifikasi
// kepemilikan lewat proof checkout asli atau kontak penuh + PIN.
// PIN tampil sesudah paid hanya dengan proof kuat; tidak disimpan di storage/URL.
// Setelah verifikasi hanya capability token yang disimpan (GET polling).

import { useEffect, useRef, useState } from "react";
import { formatWibDateTime } from "@/lib/utils";
import { CredentialText, ActivationBody, MobileCollapsible, TermsBody } from "@/components/storefront/ProductCopy";
import { WarrantyClaimAccordion } from "@/components/storefront/WarrantyClaim";
import type { VariantCopy } from "@/lib/product-copy/format";
import { forgetCheckoutCredentialGrant, orderAccessHeaders, readCheckoutCredentialGrant, readOrderContact } from "@/lib/order-access-client";
import { normalizeOrderAccessCode } from "@/lib/order-access-format";
import type { Locale } from "@/lib/i18n/locale";
import { orderCopy } from "@/lib/i18n/order-copy";
import { BuyerOrderPin } from "./BuyerOrderPin";
import { OrderAccessNotice } from "./OrderAccessNotice";

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

export function WrCredentialsPanel({ code, prefillContact = "", prefillPin = "", buyerPinRequired = true, credentialsReady = true, contactHint = "", deliveryProgress, adminView = false, locale = "id" }: { code: string; prefillContact?: string; prefillPin?: string; buyerPinRequired?: boolean; credentialsReady?: boolean; contactHint?: string; deliveryProgress?: {ready:number;total:number}; adminView?: boolean; locale?: Locale }) {
  const text = orderCopy(locale).credentials;
  const [contact, setContact] = useState(prefillContact);
  const [pin, setPin] = useState(prefillPin);
  const [loading, setLoading] = useState(false);
  const [automaticPending, setAutomaticPending] = useState(true);
  const [automaticError, setAutomaticError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [verifiedPin, setVerifiedPin] = useState("");
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
  // Checkout asli memakai proof privat tab; lookup memakai kontak+PIN bila
  // keduanya sudah ada. Legacy tetap menerima kontak saja. Verifikasi
  // TETAP di server via endpoint credentials; PIN tidak pernah disimpan.
  const triedPrefill = useRef(false);
  const loadedForReady = useRef(-1);
  useEffect(() => {
    let cancelled = false;
    if (!credentialsReady) return;
    setAutomaticError(false);
    if (adminView) {
      const controller = new AbortController();
      setLoading(true);
      void fetch(`/api/orders/${encodeURIComponent(code)}/credentials`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminView: true }), signal: controller.signal, cache: "no-store",
      }).then(async r => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) { setCreds(null); setError(r.status === 401 ? text.adminSessionExpired : text.loadFailed); return; }
        setError(null); setCreds(body.credentials ?? []);
      }).catch(() => { if (!cancelled) setError(text.networkReload); })
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
    const checkoutGrant = readCheckoutCredentialGrant(code);
    const verifyFromContact = () => {
      setAutomaticPending(false);
      if (triedPrefill.current) return;
      if (!checkoutGrant && !isContactValue(autoContact)) return;
      // Outside checkout, contact + PIN are still required.
      if (buyerPinRequired && !autoPin && !checkoutGrant) return;
      triedPrefill.current = true;
      setAutomaticPending(true);
      if (!contactEdited.current) setContact(autoContact);
      if (autoPin && !pinEdited.current) setPin(autoPin);
      void verifyWith(autoContact, buyerPinRequired ? autoPin : "", checkoutGrant);
    };
    const requestedReady = deliveryProgress?.ready ?? 0;
    const retryAccess = () => {
      if (checkoutGrant || (!buyerPinRequired && isContactValue(autoContact))) verifyFromContact();
      else { setAutomaticError(true); setAutomaticPending(false); }
    };
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(tokenKey); } catch { /* Optional tab storage. */ }
    if (!saved) {
      verifyFromContact();
      return;
    }
    if (loadedForReady.current >= requestedReady) return;
    setAutomaticPending(true);
    setLoading(true);
    void (async () => {
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(code)}/credentials`, { cache: "no-store", headers: { "x-credential-token": saved } });
        if (cancelled) return;
        if (r.ok) {
          const body = (await r.json()) as { credentials?: Credential[] };
          if (cancelled) return;
          if (body.credentials?.length) {
            setAutomaticPending(false);
            loadedForReady.current = requestedReady;
            setCreds(body.credentials);
            setToken(saved);
            return;
          }
          retryAccess(); return;
        } else if (r.status === 401 || r.status === 403) {
          // Hanya token yang ditolak server yang dibuang; 429/5xx sementara tidak.
          try { sessionStorage.removeItem(tokenKey); } catch { /* Storage opsional. */ }
        } else {
          retryAccess(); return;
        }
      } catch {
        if (!cancelled) retryAccess();
        return;
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) verifyFromContact();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, credentialsReady, deliveryProgress?.ready, token, adminView, buyerPinRequired, prefillContact, prefillPin, retry]);

  async function verifyWith(contactValue: string, pinValue: string, checkoutGrant = "") {
    const requestedReady = deliveryProgress?.ready ?? 0;
    const cleanContact = contactValue.trim();
    const cleanPin = normalizePin(pinValue);
    if (!checkoutGrant && !isContactValue(cleanContact)) {
      setError(text.needContact);
      return;
    }
    if (buyerPinRequired && !cleanPin && !checkoutGrant) {
      setError(text.needPin);
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
        headers: { "content-type": "application/json", ...orderAccessHeaders(code, cleanContact), ...(checkoutGrant ? { "x-checkout-credential-grant": checkoutGrant } : {}) },
        body: JSON.stringify(body),
      });
      const responseBody = (await r.json().catch(() => ({}))) as {
        credentials?: Credential[];
        capability_token?: string | null;
        error?: string;
      };
      if (!r.ok) {
        if (checkoutGrant && responseBody.error !== "verification_failed") setAutomaticError(true);
        if (checkoutGrant && responseBody.error === "verification_failed") forgetCheckoutCredentialGrant(code);
        setError(responseBody.error === "verification_failed" ? text.mismatch : responseBody.error === "not_ready" ? text.notReady : text.verifyFailed);
        return;
      }
      loadedForReady.current = requestedReady;
      setCreds(responseBody.credentials ?? []);
      if (buyerPinRequired && cleanPin && !checkoutGrant) setVerifiedPin(cleanPin);
      if (responseBody.capability_token) {
        try { sessionStorage.setItem(`wr-cred-token:${code}`, responseBody.capability_token); } catch { /* Credentials remain available in this response. */ }
        setToken(responseBody.capability_token);
      }
    } catch {
      setError(text.networkRetry);
      if (checkoutGrant) setAutomaticError(true);
    } finally {
      setLoading(false);
      setAutomaticPending(false);
    }
  }

  function renderPanel() {
  if (!credentialsReady) return null;
  if (creds?.length) {
    return (
      <section ref={accountRef} className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label={text.headingAria}>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{text.heading}</p>
        {deliveryProgress && <p className="mt-2 text-xs text-white/60" role="status">{text.ready(deliveryProgress.ready, deliveryProgress.total)}</p>}
        {error && <p className="mt-2 text-xs text-red-300" role="alert">{error}</p>}
        <div className="mt-3 space-y-3">
          {creds.map((c, i) => (
            <div key={i} className="space-y-3">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3">
                {c.label && <p className="mb-1.5 text-[11px] font-semibold text-emerald-200/80">{c.label}</p>}
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-emerald-100"><CredentialText text={c.details} /></pre>
                <button type="button" className="mt-2 min-h-9 whitespace-nowrap rounded-lg border border-emerald-400/20 px-3 text-xs text-emerald-200" onClick={() => {
                  void Promise.resolve().then(()=>navigator.clipboard.writeText(c.details)).then(()=>{setCopied(i);setError(null)}).catch(()=>setError(text.copyFailed));
                }}>{copied===i ? text.copied : text.copyAccount(i+1)}</button>
                {c.completed_at && <p className="mt-2 text-[11px] text-white/40">{text.received(formatWibDateTime(c.completed_at) ?? "—")}</p>}
              </div>
              {c.terms && !creds.slice(i+1).some(next=>JSON.stringify(next.terms)===JSON.stringify(c.terms)) && (c.terms.sections.length > 0 || c.terms.activation.length > 0 || c.terms.notes.length > 0) && (
                <>
                  {c.terms.sections.length > 0 && (
                    <MobileCollapsible title={text.terms}>
                      <TermsBody sections={c.terms.sections} size="xs" locale={locale} />
                    </MobileCollapsible>
                  )}
                  {(c.terms.activation.length > 0 || c.terms.notes.length > 0) && (
                    <MobileCollapsible title={text.activation}>
                      <ActivationBody groups={c.terms.activation} notes={c.terms.notes} size="xs" />
                    </MobileCollapsible>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <WarrantyClaimAccordion className="mt-3" locale={locale} code={code} contact={prefillContact} adminView={adminView} />
        <p className="mt-3 text-[11px] leading-5 text-white/40">{text.keep} {token ? text.remembered : text.doNotShare}</p>
      </section>
    );
  }

  if (adminView) return <section className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label={text.adminHeading}>
    <p role="status" className="text-sm text-white/65">{loading ? text.loadingAdmin : text.unavailable}</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </section>;

  if (automaticPending) return <p role="status" className="mt-4 text-xs text-white/65">{text.checking}</p>;
  if (automaticError) return <section className="mt-4 text-left text-xs text-white/65">
    <p role="alert">{text.networkRetry}</p>
    <button type="button" onClick={() => { triedPrefill.current = false; setRetry(n => n + 1); }} className="min-h-11 px-3 font-semibold text-[#00E5FF] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]">{orderCopy(locale).common.retry}</button>
  </section>;

  const pinRequired = buyerPinRequired;
  return (
    <section className="ax-glass-card mt-6 rounded-2xl p-4 text-left" aria-label={text.openTitle}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{text.heading}</p>
      <p className="mt-2 text-xs leading-5 text-white/65">{buyerPinRequired ? text.pinIntro : text.legacyIntro}</p>
      {contactHint && <p className="mt-1 text-[11px] text-white/40">{text.registered(contactHint)}</p>}
      <form
        className="mt-3 grid gap-2"
        onSubmit={(event) => { event.preventDefault(); void verifyWith(contact, pin); }}
      >
        <div>
          <label htmlFor={`wr-cred-contact-${code}`} className="mb-1 block text-xs font-medium text-white/60">{text.contactField}</label>
          <input
            id={`wr-cred-contact-${code}`}
            value={contact}
            onChange={(e) => { contactEdited.current = true; setContact(e.target.value); }}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={text.contactPlaceholder}
            aria-label={text.contactFieldShort}
            className="h-11 min-w-0 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/55 focus:border-[#00E5FF]/60 focus:outline-none"
          />
        </div>
        {pinRequired && <div>
          <label htmlFor={`wr-cred-pin-${code}`} className="mb-1 block text-xs font-medium text-white/60">{text.pinField(pinRequired)}</label>
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
            placeholder={text.pinPlaceholder}
            aria-label={text.pinAria}
            required={pinRequired}
            className="h-11 min-w-0 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/55 focus:border-[#00E5FF]/60 focus:outline-none"
          />
        </div>}
        <button
          type="submit"
          disabled={loading || !isContactValue(contact) || (pinRequired && !normalizePin(pin))}
          className="h-11 w-full shrink-0 rounded-xl bg-[#00E5FF] px-4 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8] disabled:opacity-50"
        >
          {loading ? text.checking : text.submit}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-amber-200">{error}</p>}
      <WarrantyClaimAccordion className="mt-3" locale={locale} code={code} contact={prefillContact} adminView={adminView} />
    </section>
  );
  }
  return <>
    {!adminView && buyerPinRequired && (verifiedPin ? <OrderAccessNotice accessCode={verifiedPin} locale={locale} /> : <BuyerOrderPin code={code} credentialToken={token} locale={locale} />)}
    {renderPanel()}
  </>;
}
