"use client";

import { useCallback, useRef, useState } from "react";
import { isValidOrderContact, orderAccessHeaders } from "@/lib/order-access-client";
import { orderPanelCopy, type PayLocale } from "@/lib/payment-ui";

/**
 * Persetujuan total akhir gateway lewat rute yang sudah ada
 * (`POST /api/orders/:code/payment-consent`, body `{contact, expected_final_total}`).
 * Satu implementasi untuk halaman pesanan dan hasil lacak: kontak checkout
 * (bukan PIN), tidak pernah di URL; klik ganda = satu POST; 409 = baca ulang dan
 * tampilkan total baru tanpa persetujuan otomatis.
 *
 * Persetujuan tetap wajib, tetapi satu klik: bila respons membawa pembayaran
 * `pending` dengan tautan https, tab yang SAMA langsung diarahkan ke provider
 * (tanpa langkah "lanjut bayar" kedua dan tanpa popup blocker). Tanpa tautan
 * (mis. VA saja) halaman hanya membaca ulang status.
 */
export function usePaymentConsent(options: {
  code: string;
  locale: PayLocale;
  /** Kontak yang diverifikasi untuk pesanan ini (input panel menang, lalu tersimpan); string kosong bila tak ada. */
  resolveContact: (input: string) => string;
  /** Dipanggil setelah 200 atau 409 untuk membaca ulang pesanan dari server. */
  refresh: () => Promise<unknown>;
  /** Dipanggil dengan kontak valid setelah persetujuan sukses (mis. simpan di memori tab). */
  onAccepted?: (contact: string) => void;
  /** Navigasi ke tautan provider; default tab yang sama. Dapat diganti di test. */
  navigate?: (url: string) => void;
}) {
  const { code, locale, resolveContact, refresh, onAccepted, navigate } = options;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);

  const approve = useCallback(async (expectedTotal: number, contactInput: string) => {
    if (!code || inFlight.current) return;
    const copy = orderPanelCopy(locale);
    const contact = resolveContact(contactInput).trim();
    if (!contact || !isValidOrderContact(contact)) { setError(copy.gateway.needContact); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setStale(false);
    let navigating = false;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(code)}/payment-consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orderAccessHeaders(code) },
        body: JSON.stringify({ contact, expected_final_total: expectedTotal }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setStale(true);
        await refresh();
        return;
      }
      if (!response.ok) throw new Error(body.error || "Persetujuan gagal.");
      onAccepted?.(contact);
      const payment = body?.payment as Record<string, unknown> | undefined;
      const rawLink = payment?.state === "pending"
        ? (payment.paymentLink ?? payment.checkoutUrl ?? payment.payment_link ?? payment.checkout_url)
        : null;
      const link = typeof rawLink === "string" && rawLink.startsWith("https://") ? rawLink : null;
      if (link) {
        // busy/inFlight sengaja tetap aktif: tombol tidak boleh diklik dua kali saat halaman berpindah.
        navigating = true;
        if (navigate) navigate(link);
        else if (typeof window !== "undefined") window.location.assign(link);
        return;
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Persetujuan gagal.");
    } finally {
      if (!navigating) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }, [code, locale, resolveContact, refresh, onAccepted, navigate]);

  return { busy, error, stale, approve };
}
