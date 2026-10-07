// src/app/pedia/lacak/page.tsx — Lacak Pedia (PD-13).
// Kode + WA/email (lookup existing diperluas M5) + daftar perangkat axp-orders.
"use client";

import { useEffect, useState } from "react";

export default function PediaTrackPage() {
  const [code, setCode] = useState("");
  const [contact, setContact] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("axp-orders");
      if (raw) setSaved(JSON.parse(raw));
    } catch { /* abaikan */ }
    const q = new URLSearchParams(window.location.search).get("code");
    if (q) setCode(q);
  }, []);

  const lookup = async () => {
    setResult(null);
    const res = await fetch("/api/orders/lookup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, contact }),
    });
    const d = await res.json();
    if (!res.ok) { setResult(d.error ?? "Tidak ditemukan"); return; }
    location.assign(`/pedia/pesanan/${code.trim().toUpperCase()}`);
  };

  return (
    <div className="mx-auto max-w-xl pt-8">
      <h1 className="font-display text-[22px] font-bold text-white">Lacak pesanan</h1>
      <div className="mt-4 space-y-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Kode AXP-…" className="h-12 w-full rounded-[14px] border border-white/10 bg-white/5 px-4 font-mono text-white placeholder:text-white/30" aria-label="Kode pesanan" />
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="No. WA atau email checkout" className="h-12 w-full rounded-[14px] border border-white/10 bg-white/5 px-4 text-white placeholder:text-white/30" aria-label="Kontak" />
        <button onClick={lookup} className="h-12 w-full rounded-[14px] bg-[#00E5FF] text-sm font-bold text-[#070a1e]">Lacak</button>
        {result && <p role="alert" className="text-sm text-amber-200">{result}</p>}
      </div>
      {saved.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-white/70">Pesanan di perangkat ini</h2>
          <div className="mt-2 space-y-2">
            {saved.map((s) => (
              <a key={s.code} href={`/pedia/pesanan/${s.code}`} className="ax-glass-card block rounded-2xl p-3 text-sm text-white">
                <span className="font-mono font-bold">{s.code}</span>
                <span className="ml-2 text-white/60">{s.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
