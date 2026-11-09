"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { isValidOrderContact, rememberOrderContact } from "@/lib/order-access-client";
import { rememberPediaContact } from "@/lib/pedia/buyer-session";
import { gamesCopy } from "@/lib/games/copy";

export function GamesTrack() {
  const t = gamesCopy(useDisplayLocale()); const router = useRouter();
  const [code, setCode] = useState(""); const [contact, setContact] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    const clean = code.trim().toUpperCase();
    if (!/^AXG-\d{8}-[A-Z0-9]{8}$/.test(clean)) { setError(t.trackInvalid); return; }
    if (!isValidOrderContact(contact.trim())) { setError(t.trackContactInvalid); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/games/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: clean, contact: contact.trim() }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || t.statusError);
      rememberPediaContact(clean, contact.trim()); rememberOrderContact(clean, contact.trim()); router.push(`/games/pesanan/${clean}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.loadError); } finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-[680px] px-4 py-16"><p className="text-xs font-bold tracking-[.2em] text-[#FFB800]">AXVARA GAMES</p><h1 className="mt-3 font-display text-3xl font-bold">{t.trackTitle}</h1><p className="mt-3 text-sm leading-6 text-white/60">{t.trackDescription}</p><form onSubmit={submit} className="ax-glass mt-8 space-y-5 rounded-2xl border border-white/10 p-6"><label className="block text-sm">{t.trackCode}<input value={code} onChange={(event) => setCode(event.target.value)} autoCapitalize="characters" placeholder="AXG-YYYYMMDD-XXXXXXXX" className="mt-2 h-12 w-full rounded-xl border border-white/15 bg-white/5 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]" /></label><label className="block text-sm">{t.contactField}<input value={contact} onChange={(event) => setContact(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/15 bg-white/5 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]" /></label>{error && <p role="alert" className="text-sm text-red-300">{error}</p>}<button disabled={busy} className="min-h-12 rounded-xl bg-[#00E5FF] px-6 font-bold text-[#080C1E] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]">{t.trackButton}</button></form></div>;
}
