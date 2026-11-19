// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useCatalogRevisionWatcher } from "@/hooks/useCatalogRevision";

function WatcherHarness(props: Parameters<typeof useCatalogRevisionWatcher>[0]) {
  useCatalogRevisionWatcher(props);
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

async function flushMicrotasks(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T00:00:00Z"));
  vi.spyOn(Math, "random").mockReturnValue(0);
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCatalogRevisionWatcher", () => {
  it("uses initialRevision as baseline, checks on mount with no-store, and triggers onChange only when revision changes", async () => {
    let rev = "rev-1";
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ scope: "market", revision: rev }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn(async () => {});

    render(<WatcherHarness scope="market" initialRevision="rev-1" onChange={onChange} intervalMs={30_000} />);
    await act(async () => { await flushMicrotasks(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/catalog/revision?scope=market");
    expect((fetchMock.mock.calls[0][1] as RequestInit).cache).toBe("no-store");
    expect(onChange).not.toHaveBeenCalled();

    // "0" is ignored and does not shift baseline
    rev = "0";
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();

    // Still rev-1 -> no onChange
    rev = "rev-1";
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();

    // Changed to rev-2 -> onChange called once
    rev = "rev-2";
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("rev-2");

    // Next tick still rev-2 -> baseline shifted, so no duplicate onChange
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("adopts first non-zero poll as baseline when initialRevision is null or '0'", async () => {
    let rev = "0";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ scope: "market", revision: rev }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();

    render(<WatcherHarness initialRevision={null} onChange={onChange} />);
    await act(async () => { await flushMicrotasks(); });
    expect(onChange).not.toHaveBeenCalled();

    // First non-zero poll sets baseline without onChange
    rev = "rev-10";
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(onChange).not.toHaveBeenCalled();

    // Subsequent change triggers onChange
    rev = "rev-11";
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("rev-11");
  });

  it("does not poll while hidden; checks when becoming visible, on pageshow(persisted), and on online", async () => {
    setVisibility("hidden");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ scope: "market", revision: "rev-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();

    render(<WatcherHarness initialRevision="rev-1" onChange={onChange} />);
    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await flushMicrotasks();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Tab becomes visible -> checks immediately
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Non-persisted pageshow -> ignored
    await act(async () => {
      vi.advanceTimersByTime(6_000);
      const evt = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(evt, "persisted", { value: false });
      window.dispatchEvent(evt);
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Persisted pageshow (bfcache) -> checks
    await act(async () => {
      const evt = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(evt, "persisted", { value: true });
      window.dispatchEvent(evt);
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Online event after min gap -> checks
    await act(async () => {
      vi.advanceTimersByTime(6_000);
      window.dispatchEvent(new Event("online"));
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not shift baseline if onChange rejects and retries on the next tick", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ scope: "market", revision: "rev-2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let fail = true;
    const onChange = vi.fn(async () => {
      if (fail) throw new Error("refetch failed");
    });

    render(<WatcherHarness initialRevision="rev-1" onChange={onChange} />);
    await act(async () => { await flushMicrotasks(); });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Next tick retries because baseline is still rev-1
    fail = false;
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(onChange).toHaveBeenCalledTimes(2);

    // Once succeeded, baseline shifts to rev-2 and next tick does not call onChange
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially (x2 up to 5 min) on HTTP/network errors and resets after recovery", async () => {
    let status = 500;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ scope: "market", revision: "rev-1" }), { status }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WatcherHarness initialRevision="rev-1" onChange={() => {}} intervalMs={30_000} />);
    await act(async () => { await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(1); // t=0 (err -> backoff 60s)

    await act(async () => { vi.advanceTimersByTime(59_000); await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(1_000); await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(2); // t=60s (err -> backoff 120s)

    await act(async () => { vi.advanceTimersByTime(119_000); await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => { vi.advanceTimersByTime(1_000); await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(3); // t=180s (err -> backoff 240s)

    await act(async () => { vi.advanceTimersByTime(240_000); await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(4); // t=420s (err -> capped at 300s)

    await act(async () => { vi.advanceTimersByTime(299_000); await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Recover at 300s -> resets interval back to 30s
    status = 200;
    await act(async () => { vi.advanceTimersByTime(1_000); await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await act(async () => { vi.advanceTimersByTime(30_000); await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("dedups in-flight checks, enforces 5s minimum gap, keeps timer stable when onChange identity changes, and cleans up on unmount", async () => {
    let resolveOnChange!: () => void;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ scope: "market", revision: "rev-2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const onChange1 = vi.fn(() => new Promise<void>((resolve) => { resolveOnChange = resolve; }));
    const { rerender, unmount } = render(
      <WatcherHarness initialRevision="rev-1" onChange={onChange1} intervalMs={30_000} />,
    );
    await act(async () => { await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onChange1).toHaveBeenCalledTimes(1);

    // While onChange is still running, advancing 10s and firing online/visibilitychange must NOT trigger another check
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Changing onChange callback identity does not reset timer or re-run mount check
    const onChange2 = vi.fn();
    rerender(<WatcherHarness initialRevision="rev-1" onChange={onChange2} intervalMs={30_000} />);
    await act(async () => { await flushMicrotasks(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Finish in-flight onChange -> schedules next check 30s later
    await act(async () => {
      resolveOnChange();
      await flushMicrotasks();
    });

    // Triggers within 5s of check start (wait: 10s already elapsed, let's test min gap on fresh check)
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Immediate trigger 2s later (< 5s min gap) is ignored
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      window.dispatchEvent(new Event("online"));
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Unmount cleans up all timers and listeners
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
