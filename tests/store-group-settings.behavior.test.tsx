// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStoreSettings, publishStoreSettings } from "@/hooks/useStoreSettings";
import { DEFAULT_STORE_SETTINGS } from "@/lib/site";

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("updates all consumers on save and cross-tab changes without accepting stale in-flight responses",async()=>{
  let initial!:(value:Response)=>void;let latest!:(value:Response)=>void;
  const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{initial=resolve;}))
    .mockImplementationOnce(()=>new Promise<Response>(resolve=>{latest=resolve;}));
  vi.stubGlobal("fetch",fetcher);
  const first=renderHook(useStoreSettings);const second=renderHook(useStoreSettings);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const saved={...DEFAULT_STORE_SETTINGS,whatsappGroupUrl:"https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV"};
  act(()=>publishStoreSettings(saved));
  expect(first.result.current.whatsappGroupUrl).toBe(saved.whatsappGroupUrl);
  expect(second.result.current.whatsappGroupUrl).toBe(saved.whatsappGroupUrl);
  act(()=>window.dispatchEvent(new StorageEvent("storage",{key:"axvara:settings-updated",newValue:"another-tab"})));
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async()=>{initial(Response.json({settings:DEFAULT_STORE_SETTINGS}));});
  expect(first.result.current.whatsappGroupUrl).toBe(saved.whatsappGroupUrl);
  const third=renderHook(useStoreSettings);expect(fetcher).toHaveBeenCalledTimes(2);
  const changed={...saved,whatsappGroupUrl:"https://chat.whatsapp.com/ZYXWVUTSRQPONMLKJIHGFE"};
  await act(async()=>{latest(Response.json({settings:changed}));});
  await waitFor(()=>expect(first.result.current.whatsappGroupUrl).toBe(changed.whatsappGroupUrl));
  expect(second.result.current.whatsappGroupUrl).toBe(changed.whatsappGroupUrl);
  expect(third.result.current.whatsappGroupUrl).toBe(changed.whatsappGroupUrl);
  expect(fetcher.mock.calls.every(([,options])=>options.cache==="no-store")).toBe(true);
});
