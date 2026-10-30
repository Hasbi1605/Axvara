// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePediaPrices } from "@/components/pedia/usePediaPrices";
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it("debounces typing and ignores a stale response even if transport ignores abort",async()=>{
 vi.useFakeTimers();const pending: ((r:unknown)=>void)[]=[];
 const fetcher=vi.fn((_input: string, _init?: RequestInit)=>{void _input;void _init;return new Promise((resolve)=>pending.push(resolve));});vi.stubGlobal("fetch",fetcher);
 const h=renderHook(({qty})=>usePediaPrices("followers",qty,true),{initialProps:{qty:100}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(299);});expect(fetcher).not.toHaveBeenCalled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
 const signal=fetcher.mock.calls[0][1]?.signal as AbortSignal;
 h.rerender({qty:200});expect(signal.aborted).toBe(true);expect(h.result.current).toBeNull();
 await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
 await act(async()=>{pending[1]({ok:true,json:async()=>({product_slug:"followers",quantity:200,prices:[{tier_id:1,total:4000}]})});});expect(h.result.current?.prices[1]).toBe(4000);
 await act(async()=>{pending[0]({ok:true,json:async()=>({product_slug:"followers",quantity:100,prices:[{tier_id:1,total:2000}]})});});expect(h.result.current?.prices[1]).toBe(4000);
});
it("never requests a price in preview or for an invalid quantity",async()=>{
 vi.useFakeTimers();const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 const h=renderHook(({qty,enabled})=>usePediaPrices("followers",qty,enabled),{initialProps:{qty:100,enabled:false}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(500);});h.rerender({qty:1.5,enabled:true});await act(async()=>{await vi.advanceTimersByTimeAsync(500);});expect(fetcher).not.toHaveBeenCalled();
});
it("retries a failed price for the same quantity without overlapping requests", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ product_slug: "followers", quantity: 101, prices: [{ tier_id: 1, total: 2200 }] }));
  vi.stubGlobal("fetch", fetcher);
  const h = renderHook(() => usePediaPrices("followers", 101, true));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(h.result.current?.failed).toBe(true);
  act(() => { h.result.current!.retry(); });
  expect(h.result.current).toBeNull();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[0][0]);
  expect(h.result.current?.prices[1]).toBe(2200);
  expect(h.result.current?.failed).toBeUndefined();
});
