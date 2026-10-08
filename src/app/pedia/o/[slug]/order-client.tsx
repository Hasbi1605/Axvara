// src/app/pedia/o/[slug]/order-client.tsx — Order 5 langkah + sticky bar.
// 1 Target · 2 Jumlah · 3 Kualitas · 4 Cek · 5 Kontak. Total realtime client
// (rumus sama dengan server — AC-04), quote server memvalidasi ulang.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { detectPediaLink } from "@/lib/pedia/link";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const TIER_BADGE: Record<string, string> = { hemat: "Termurah", standar: "Paling dipilih", premium: "Akun Indonesia aktif" };

export function OrderClient({ product, initialTarget, ordersEnabled }: { product: PediaCatalogProduct; initialTarget: string; ordersEnabled: boolean }) {
  const [target, setTarget] = useState(initialTarget);
  const [qty, setQty] = useState(() => product.packages[1] ?? product.packages[0] ?? 100);
  const [customQty, setCustomQty] = useState(false);
  const [tierId, setTierId] = useState(() => {
    const std = product.tiers.find((t) => t.tier === "standar");
    return (std ?? product.tiers[0])?.id ?? 0;
  });
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [wa, setWa] = useState("");
  const [email, setEmail] = useState("");
  const [credit, setCredit] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ quote_token: string; payable: number } | null>(null);
  const firstMissing = useRef<string | null>(null);

  const tier = product.tiers.find((t) => t.id === tierId) ?? product.tiers[0]!;
  const detected = useMemo(() => detectPediaLink(target), [target]);
  const unitTotal = useMemo(() => {
    const price = tier?.prices[String(qty)];
    if (price) return price;
    // Jumlah bebas: estimasi client via rasio (server yang memutuskan).
    const known = Object.entries(tier?.prices ?? {}).map(([k, v]) => [Number(k), Number(v)] as const).filter(([k]) => k > 0);
    if (!known.length) return 0;
    const [, refPrice] = known.reduce((a, b) => (Math.abs(a[0] - qty) <= Math.abs(b[0] - qty) ? a : b));
    const [, refQty] = known.reduce((a, b) => (Math.abs(a[0] - qty) <= Math.abs(b[0] - qty) ? a : b));
    void refPrice;
    return Math.round((refPrice / refQty) * qty);
  }, [tier, qty]);

  // Ganti tingkat dengan max lebih kecil → jumlah turun otomatis + toast (DESIGN §6.3).
  useEffect(() => {
    const maxPkg = Math.max(...product.packages);
    if (qty > maxPkg) setQty(maxPkg);
  }, [tierId, product.packages, qty]);

  const checklist = product.checklist ?? [];
  const checksDone = checklist.every((c) => checks[c.id]);

  const pay = async () => {
    setError(null);
    // Checklist belum lengkap → scroll + fokus item pertama (AC-05).
    const missing = checklist.find((c) => !checks[c.id]);
    if (missing) {
      setError("Centang dulu poin ini supaya pesanan bisa diproses.");
      document.getElementById(`check-${missing.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById(`check-${missing.id}`)?.focus();
      return;
    }
    if (!agree) {
      setError("Centang persetujuan Ketentuan Pedia dulu.");
      document.getElementById("pedia-agree")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("pedia-agree")?.focus();
      return;
    }
    setBusy("Membuat pesanan…");
    try {
      // 1. Quote server (pakai slug — id numerik milik server).
      const qr = await fetch("/api/pedia/quote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_slug: product.slug, tier_id: tier.id, quantity: qty, target, credit_code: credit || undefined }),
      });
      const qd = await qr.json();
      if (!qr.ok) throw new Error(qd.message ?? qd.error ?? "Quote gagal");
      setBusy("Menyiapkan QRIS…");
      // 2. Buat order.
      const or = await fetch("/api/pedia/orders", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ customer_wa: wa, customer_email: email, quote_token: qd.quote_token }),
      });
      const od = await or.json();
      if (!or.ok) throw new Error(od.message ?? od.error ?? "Order gagal");
      setQuote({ quote_token: qd.quote_token, payable: od.payable });
      // Simpan ke localStorage axp-orders (lacak perangkat).
      try {
        const raw = localStorage.getItem("axp-orders");
        const list = raw ? JSON.parse(raw) : [];
        list.unshift({ code: od.code, name: product.name });
        localStorage.setItem("axp-orders", JSON.stringify(list.slice(0, 20)));
      } catch { /* abaikan */ }
      location.assign(`/pedia/pesanan/${od.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal. Coba lagi.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="px-1 pt-5 sm:px-0 sm:pt-6 lg:grid lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-7">
        <a href="/pedia" className="text-sm text-white/55 hover:text-white">← {product.name}</a>
        <h1 className="mt-1 font-display text-[20px] font-bold leading-tight text-white sm:text-[32px]">{product.name}</h1>
        {product.tagline && <p className="text-sm text-white/55">{product.tagline}</p>}

        {/* 1 Target */}
        <section aria-label="Langkah 1 target" className="mt-5 sm:mt-6">
          <StepTitle n={1} title="Target" done={!!detected} />
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="instagram.com/namakamu"
            inputMode="url"
            className="pedia-field mt-2 h-13 min-h-[52px] w-full rounded-[14px] border border-white/10 bg-white/5 px-4 text-[16px] text-white placeholder:text-white/30 focus:border-[var(--px-violet)] focus:outline-none"
          />
          {detected?.displayUser && <p className="mt-1 text-[13px] text-emerald-300">{detected.displayUser} · Profil {product.platform} ✓</p>}
        </section>

        {/* 2 Jumlah */}
        <section aria-label="Langkah 2 jumlah" className="mt-5 sm:mt-6">
          <StepTitle n={2} title="Jumlah" done={qty > 0} />
          <div role="radiogroup" aria-label="Pilih jumlah" className="mt-2 flex flex-wrap gap-2">
            {product.packages.map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={qty === p && !customQty}
                onClick={() => { setQty(p); setCustomQty(false); }}
                className={`h-11 min-w-[72px] rounded-[14px] px-3 text-sm font-bold ${qty === p && !customQty ? "bg-[var(--px-violet-soft)] text-white ring-1 ring-[var(--px-violet)]" : "bg-white/5 text-white/65"}`}
              >
                {p.toLocaleString("id-ID")}
              </button>
            ))}
            <button
              role="radio" aria-checked={customQty}
              onClick={() => setCustomQty(true)}
              className={`h-11 rounded-[14px] px-3 text-sm font-bold ${customQty ? "bg-[var(--px-violet-soft)] text-white ring-1 ring-[var(--px-violet)]" : "bg-white/5 text-white/65"}`}
            >
              Lainnya
            </button>
          </div>
          {customQty && (
            <input
              type="number" value={qty} min={1}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="pedia-field mt-2 h-12 min-h-[48px] w-40 rounded-[14px] border border-white/10 bg-white/5 px-4 text-[16px] text-white"
              aria-label="Jumlah bebas"
            />
          )}
          <p className="mt-1 text-[13px] text-white/55" style={{ fontVariantNumeric: "tabular-nums" }}>
            Rp{unitTotal.toLocaleString("id-ID")}
          </p>
        </section>

        {/* 3 Kualitas */}
        {product.tiers.length > 1 && (
          <section aria-label="Langkah 3 kualitas" className="mt-5 sm:mt-6">
            <StepTitle n={3} title="Kualitas" done={!!tier} />
            <div role="radiogroup" aria-label="Pilih kualitas" className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {product.tiers.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={t.id === tierId}
                  aria-label={`${t.tier}, Rp${(t.prices[String(qty)] ?? 0).toLocaleString("id-ID")}, ${t.label_note ?? ""}, garansi ${t.refill_days} hari`}
                  onClick={() => setTierId(t.id)}
                  className={`w-[148px] shrink-0 rounded-[20px] border p-3 text-left ${t.id === tierId ? "pedia-tier-selected" : "border-white/10 bg-white/[0.03]"}`}
                >
                  <span className="text-xs font-bold capitalize text-white">{t.tier}</span>
                  {TIER_BADGE[t.tier] && <span className="ml-1 rounded-full bg-[var(--px-violet-soft)] px-1.5 py-px text-[10px] font-bold text-white">{TIER_BADGE[t.tier]}</span>}
                  <span className="mt-1 block font-display text-lg font-bold text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
                    Rp{(t.prices[String(qty)] ?? 0).toLocaleString("id-ID")}
                  </span>
                  <span className="mt-1 block text-[12px] text-white/60">{t.label_note ?? ""}</span>
                  <span className="block text-[12px] text-white/60">
                    {t.refill_days > 0 ? `Garansi ${t.refill_days} hari` : "Tanpa garansi"} · {t.eta_start ?? ""}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 4 Cek */}
        {checklist.length > 0 && (
          <section aria-label="Langkah 4 cek" className="mt-5 sm:mt-6">
            <StepTitle n={4} title="Cek sebelum bayar" done={checksDone} />
            <div className="mt-2 space-y-2">
              {checklist.map((c) => (
                <label key={c.id} className="flex items-start gap-3 rounded-[14px] border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
                  <input
                    id={`check-${c.id}`}
                    type="checkbox"
                    checked={!!checks[c.id]}
                    onChange={(e) => setChecks({ ...checks, [c.id]: e.target.checked })}
                    className="mt-0.5 h-[22px] w-[22px] accent-[#8B5CF6]"
                  />
                  <span>
                    {c.label}
                    {c.help && <span className="block text-[12.5px] text-white/50">{c.help}</span>}
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* 5 Kontak */}
        <section aria-label="Langkah 5 kontak" className="mt-5 sm:mt-6">
          <StepTitle n={5} title="Kontak" done={!!(wa && email)} />
          <div className="mt-2 space-y-2">
            <input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="No. WhatsApp 08…" inputMode="tel" className="pedia-field h-12 min-h-[48px] w-full rounded-[14px] border border-white/10 bg-white/5 px-4 text-[16px] text-white placeholder:text-white/30" aria-label="Nomor WhatsApp" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email nama@email.com" inputMode="email" className="pedia-field h-12 min-h-[48px] w-full rounded-[14px] border border-white/10 bg-white/5 px-4 text-[16px] text-white placeholder:text-white/30" aria-label="Email" />
            <p className="text-[12.5px] text-white/50">Status & bukti pesanan dikirim ke email.</p>
            <details className="rounded-[14px] border border-white/10 p-3">
              <summary className="cursor-pointer text-sm text-white/70">Punya kode kredit?</summary>
              <input value={credit} onChange={(e) => setCredit(e.target.value.toUpperCase())} placeholder="PDK-XXXX-XXXX" className="pedia-field mt-2 h-12 min-h-[48px] w-full rounded-[14px] border border-white/10 bg-white/5 px-4 font-mono text-[16px] text-white placeholder:text-white/30" aria-label="Kode kredit" />
            </details>
            <label className="flex items-start gap-3 text-sm text-white/80">
              <input id="pedia-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-[22px] w-[22px] accent-[#8B5CF6]" />
              <span>Saya setuju <a href="/pedia/ketentuan" className="underline">Ketentuan Pedia</a></span>
            </label>
          </div>
        </section>

        <div className="h-[84px]" aria-hidden="true" />
      </div>

      {/* Ringkasan desktop */}
      <aside className="hidden lg:col-span-5 lg:block">
        <div className="ax-glass-card sticky top-20 rounded-[20px] p-5">
          <OrderSummaryBody product={product} tierName={tier?.tier ?? ""} qty={qty} total={unitTotal} />
          <PayButton ordersEnabled={ordersEnabled} total={unitTotal} busy={busy} onPay={pay} />
        </div>
      </aside>

      {/* Sticky bar mobile */}
      <div className="ax-glass-strong fixed inset-x-0 bottom-0 z-40 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex h-[68px] items-center justify-between px-4">
          <div>
            <p className="text-[11px] text-white/55">Total</p>
            <p className="font-display text-[20px] font-bold text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
              Rp{unitTotal.toLocaleString("id-ID")}
            </p>
          </div>
          <PayButton ordersEnabled={ordersEnabled} total={unitTotal} busy={busy} onPay={pay} />
        </div>
      </div>

      {error && (
        <div role="alert" className="fixed left-1/2 top-20 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 rounded-2xl border border-amber-400/40 bg-[#1a1408]/95 p-4 text-sm text-amber-200">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline" aria-label="Tutup pesan">Tutup</button>
        </div>
      )}
    </div>
  );
}

function StepTitle({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
      <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] ${done ? "bg-[var(--px-violet)] text-white" : "bg-white/10 text-white/60"}`}>
        {done ? "✓" : n}
      </span>
      {title}
    </h2>
  );
}

function OrderSummaryBody({ product, tierName, qty, total }: { product: PediaCatalogProduct; tierName: string; qty: number; total: number }) {
  return (
    <div className="space-y-1.5 text-sm">
      <p className="font-bold text-white">{product.name}</p>
      <p className="text-white/60">Jumlah: {qty.toLocaleString("id-ID")}</p>
      <p className="text-white/60">Kualitas: <span className="capitalize">{tierName}</span></p>
      <p className="border-t border-white/10 pt-2 font-display text-[22px] font-bold text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
        Rp{total.toLocaleString("id-ID")}
      </p>
    </div>
  );
}

function PayButton({ ordersEnabled, total, busy, onPay }: { ordersEnabled: boolean; total: number; busy: string; onPay: () => void }) {
  if (!ordersEnabled) {
    return (
      <button disabled className="h-12 rounded-[14px] bg-white/10 px-6 text-sm font-bold text-white/50" title="Pedia belum dibuka untuk order">
        Segera dibuka
      </button>
    );
  }
  return (
    <button
      onClick={onPay}
      disabled={!!busy}
      className="h-12 min-h-[48px] rounded-[14px] bg-[#00E5FF] px-6 text-sm font-bold text-[#070a1e] transition active:scale-[0.98] disabled:opacity-60"
    >
      {busy || `Bayar QRIS · Rp${total.toLocaleString("id-ID")}`}
    </button>
  );
}
