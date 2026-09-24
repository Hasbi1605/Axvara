"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startNavigation, useNavigation } from "@/stores/navigation";

/**
 * `router.push` dengan status pending untuk tombol CTA (Checkout, Beli
 * Sekarang). Tombol tetap berputar + nonaktif sampai rute tujuan tampil, jadi
 * klik di jaringan lambat tidak terlihat diabaikan dan tidak diulang.
 */
export function usePendingNavigation() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const navActive = useNavigation((s) => s.active && s.href === target);

  const navigate = useCallback((href: string, options?: { overlay?: boolean }) => {
    setTarget(href);
    startNavigation(href, options);
    startTransition(() => router.push(href));
  }, [router]);

  return { navigate, pending: target !== null && (isPending || navActive), target };
}
