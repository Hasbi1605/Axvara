"use client";

import { useEffect, useRef } from "react";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

export type CatalogRevisionScope = "market" | "pedia" | "games";

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_CHECK_GAP_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60 * 1_000;
const REVISION_TIMEOUT_MS = 10_000;

function normalizeRevision(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed !== "0" ? trimmed : null;
}

export function useCatalogRevisionWatcher(opts: {
  scope?: CatalogRevisionScope;
  initialRevision?: string | null;
  onChange: (revision: string) => Promise<void> | void;
  intervalMs?: number;
  enabled?: boolean;
}): void {
  const {
    scope = "market",
    initialRevision,
    onChange,
    intervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
  } = opts;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const baselineRef = useRef<string | null>(normalizeRevision(initialRevision));
  const lastCheckAtRef = useRef<number | null>(null);
  const prevScopeRef = useRef<CatalogRevisionScope>(scope);
  const prevInitialRevRef = useRef<string | null | undefined>(initialRevision);

  if (prevScopeRef.current !== scope) {
    prevScopeRef.current = scope;
    prevInitialRevRef.current = initialRevision;
    baselineRef.current = normalizeRevision(initialRevision);
    lastCheckAtRef.current = null;
  } else if (prevInitialRevRef.current !== initialRevision) {
    prevInitialRevRef.current = initialRevision;
    if (baselineRef.current === null) {
      baselineRef.current = normalizeRevision(initialRevision);
    }
  }

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let disposed = false;
    let timerId: number | null = null;
    let inFlight = false;
    let backoffMs = intervalMs;
    let activeAbort: AbortController | null = null;
    const maxDelay = Math.max(MAX_BACKOFF_MS, intervalMs);

    const clearTimer = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    const scheduleNext = () => {
      if (disposed || document.visibilityState !== "visible") return;
      clearTimer();
      const jitter = Math.round(backoffMs * Math.random() * 0.2);
      const delay = Math.min(maxDelay, backoffMs + jitter);
      timerId = window.setTimeout(() => {
        timerId = null;
        void runCheck();
      }, delay);
    };

    const runCheck = async () => {
      if (disposed || inFlight || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (lastCheckAtRef.current !== null && now - lastCheckAtRef.current < MIN_CHECK_GAP_MS) {
        if (timerId === null) scheduleNext();
        return;
      }

      clearTimer();
      inFlight = true;
      lastCheckAtRef.current = now;
      const controller = new AbortController();
      activeAbort = controller;

      try {
        const res = await fetchWithTimeout(
          `/api/catalog/revision?scope=${encodeURIComponent(scope)}`,
          { cache: "no-store", signal: controller.signal },
          REVISION_TIMEOUT_MS,
        );
        if (disposed) return;
        if (!res.ok) {
          backoffMs = Math.min(maxDelay, Math.max(intervalMs, backoffMs * 2));
          return;
        }
        const body = (await res.json()) as { revision?: unknown };
        if (disposed) return;

        backoffMs = intervalMs;
        const rev = normalizeRevision(typeof body?.revision === "string" ? body.revision : null);
        if (!rev) return;

        if (baselineRef.current === null) {
          baselineRef.current = rev;
          return;
        }
        if (rev !== baselineRef.current) {
          try {
            await onChangeRef.current(rev);
            if (!disposed) {
              baselineRef.current = rev;
            }
          } catch {
            // Retain old baseline so the next tick retries onChange.
          }
        }
      } catch {
        if (!disposed) {
          backoffMs = Math.min(maxDelay, Math.max(intervalMs, backoffMs * 2));
        }
      } finally {
        if (activeAbort === controller) activeAbort = null;
        inFlight = false;
        if (!disposed && document.visibilityState === "visible") {
          scheduleNext();
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void runCheck();
        if (!inFlight && timerId === null) scheduleNext();
      } else {
        clearTimer();
      }
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && document.visibilityState === "visible") {
        void runCheck();
      }
    };

    const onOnline = () => {
      if (document.visibilityState === "visible") {
        void runCheck();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);

    void runCheck();

    return () => {
      disposed = true;
      clearTimer();
      activeAbort?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }, [scope, intervalMs, enabled]);
}
