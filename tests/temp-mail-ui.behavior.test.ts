// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync("temp-mail/public/index.html", "utf8");
const appJs = readFileSync("temp-mail/public/app.js", "utf8");

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> };
interface Deferred {
  promise: Promise<FetchResult>;
  resolve: (v: FetchResult) => void;
  reject: (e: unknown) => void;
}
function deferred(): Deferred {
  let resolve: Deferred["resolve"] = () => {};
  let reject: Deferred["reject"] = () => {};
  const promise = new Promise<FetchResult>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const jsonRes = (data: unknown, status = 200): FetchResult =>
  ({ ok: status >= 200 && status < 300, status, json: async () => data });
const flush = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
type FetchHandler = (url: string) => Promise<FetchResult>;
const msgRow = (id: number, subject: string) => ({ id, subject, sender: "x@y.co", received_at: Date.now(), preview: "p" });

describe("temp-mail UI behavior (deferred fetches, rapid switching)", () => {
  const bootCalls: Deferred[] = [];
  let fetchHandler: FetchHandler;
  const defaultHandler: FetchHandler = (url) => {
    if (url.includes("/api/address/random") || url.includes("/api/address/open")) { const d = deferred(); bootCalls.push(d); return d.promise; }
    if (url.includes("/messages/")) return Promise.resolve(jsonRes({ message: { id: 1, subject: "S", sender: "a@b.co", body_text: "isi", received_at: Date.now() } }));
    if (url.includes("/messages")) return Promise.resolve(jsonRes({ address: "x@isturaiky.page", messages: [] }));
    return Promise.resolve(jsonRes({}, 404));
  };
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, "");
    bootCalls.length = 0; fetchHandler = defaultHandler;
    vi.stubGlobal("fetch", (url: string) => fetchHandler(String(url)));
    new Function(appJs)();
  });
  const addressValue = () => (document.getElementById("address") as HTMLInputElement).value;
  const openCustom = (value: string) => {
    (document.getElementById("custom") as HTMLInputElement).value = value;
    document.getElementById("open-form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  };

  it("random button: captured element re-enabled after deferred resolve (no currentTarget crash), stale nav ignored", async () => {
    const btn = document.getElementById("random") as HTMLButtonElement;
    btn.click();
    expect(btn.disabled).toBe(true);
    expect(bootCalls.length).toBeGreaterThanOrEqual(1);
    // Boot + click both pending: resolve the OLDER (boot) last — it must not win.
    const [bootD, clickD] = bootCalls;
    clickD.resolve(jsonRes({ address: "menang@isturaiky.page" }));
    await flush();
    expect(addressValue()).toBe("menang@isturaiky.page");
    expect(btn.disabled).toBe(false); // finally ran on the captured button
    bootD.resolve(jsonRes({ address: "kalah@isturaiky.page" }));
    await flush();
    expect(addressValue()).toBe("menang@isturaiky.page");
  });

  it("rapid inbox switching: slow stale LIST response never overwrites the new inbox", async () => {
    const [bootD] = bootCalls;
    bootD.resolve(jsonRes({ address: "satu@isturaiky.page" }));
    await flush();
    const slowList = deferred();
    fetchHandler = (url) => {
      if (url.includes("/api/address/open")) return Promise.resolve(jsonRes({ address: "dua@isturaiky.page" }));
      if (url.includes("satu") && url.includes("/messages")) return slowList.promise;
      if (url.includes("dua") && url.includes("/messages")) return Promise.resolve(jsonRes({ address: "dua@isturaiky.page", messages: [msgRow(9, "PesanDua")] }));
      return Promise.resolve(jsonRes({}, 404));
    };
    openCustom("dua");
    await flush();
    expect(addressValue()).toBe("dua@isturaiky.page");
    expect(document.getElementById("list")!.textContent).toContain("PesanDua");
    // Stale slow response for the old inbox arrives now — must be discarded.
    slowList.resolve(jsonRes({ address: "satu@isturaiky.page", messages: [msgRow(1, "PesanSatuLama")] }));
    await flush();
    expect(document.getElementById("list")!.textContent).not.toContain("PesanSatuLama");
    expect(document.getElementById("list")!.textContent).toContain("PesanDua");
  });

  it("stale DETAIL response never overwrites the newly opened inbox detail", async () => {
    const [bootD] = bootCalls;
    bootD.resolve(jsonRes({ address: "satu@isturaiky.page" }));
    await flush();
    const slowDetail = deferred();
    fetchHandler = (url) => {
      if (url.includes("/api/address/open")) return Promise.resolve(jsonRes({ address: "dua@isturaiky.page" }));
      if (url.includes("satu") && url.includes("/messages/")) return slowDetail.promise;
      if (url.includes("satu") && url.includes("/messages")) return Promise.resolve(jsonRes({ address: "satu@isturaiky.page", messages: [msgRow(1, "PesanSatu")] }));
      if (url.includes("dua") && url.includes("/messages")) return Promise.resolve(jsonRes({ address: "dua@isturaiky.page", messages: [msgRow(9, "PesanDua")] }));
      return Promise.resolve(jsonRes({}, 404));
    };
    // Initial list for "satu" re-renders with a clickable message.
    (document.getElementById("refresh") as HTMLButtonElement).click();
    await flush();
    const firstBtn = document.querySelector<HTMLButtonElement>("#list button");
    expect(firstBtn?.textContent).toContain("PesanSatu");
    firstBtn!.click(); // detail request now in flight (slow)
    await flush();
    expect(document.getElementById("detail")!.textContent).toContain("Memuat");
    // User switches inbox before the detail resolves.
    openCustom("dua");
    await flush();
    expect(addressValue()).toBe("dua@isturaiky.page");
    expect(document.getElementById("detail")!.textContent).toContain("Pilih pesan");
    // Stale detail for the OLD inbox finally resolves — must not overwrite.
    slowDetail.resolve(jsonRes({ message: { id: 1, subject: "DetailSatuLama", sender: "x@y.co", body_text: "isi lama", received_at: Date.now() } }));
    await flush();
    expect(document.getElementById("detail")!.textContent).not.toContain("DetailSatuLama");
    expect(document.getElementById("detail")!.textContent).toContain("Pilih pesan");
  });

  it("saved-boot superseded by manual custom nav (boot-helper regression model)", async () => {
    // Model of the production boot contract in app.js (the parent-fixed guard:
    // after `await navigate(open saved)` returns null/throws, boot compares
    // navSeq against its captured bootSeq and returns instead of spawning
    // /api/address/random). Replicated 1:1 here so the regression is runnable
    // without re-driving the already-completed page boot IIFE.
    let modelNavSeq = 0;
    const modelControllers = new Set<AbortController>();
    const pending = new Map<string, Deferred>();
    const modelFetch = (path: string): Promise<FetchResult> => {
      const d = deferred(); pending.set(path + ":" + modelNavSeq, d); return d.promise;
    };
    const modelNavigate = async (path: string): Promise<{ address: string } | null> => {
      const seq = ++modelNavSeq;
      for (const c of modelControllers) c.abort();
      const ctrl = new AbortController(); modelControllers.add(ctrl);
      void ctrl;
      try {
        const res = await modelFetch(path);
        const data = (await res.json()) as { address?: string; error?: string };
        if (!res.ok) throw new Error(data.error || "request_failed");
        if (seq !== modelNavSeq) return null; // superseded
        return { address: data.address! };
      } catch (e) {
        if (seq !== modelNavSeq || (e instanceof Error && e.name === "AbortError")) return null;
        throw e;
      } finally { modelControllers.delete(ctrl); }
    };
    let randomSpawned = false; let currentModel = "";
    const boot = (async () => {
      const bootSeq = modelNavSeq + 1;
      try { const r = await modelNavigate("/api/address/open"); if (r) { currentModel = r.address; return; } } catch { /* fallthrough guard below */ }
      if (modelNavSeq !== bootSeq) return; // superseded by manual nav: NO random
      randomSpawned = true;
      const r = await modelNavigate("/api/address/random");
      if (r) currentModel = r.address;
    })();
    // Saved-address open is pending; user navigates manually and wins.
    const manual = modelNavigate("/api/address/open-manual");
    pending.get("/api/address/open-manual:2")!.resolve(jsonRes({ address: "manual@isturaiky.page" }));
    expect((await manual)?.address).toBe("manual@isturaiky.page");
    // Now the stale saved boot FAILS with 400 invalid_address.
    pending.get("/api/address/open:1")!.resolve(jsonRes({ error: "invalid_address" }, 400));
    await boot;
    expect(randomSpawned).toBe(false); // guard held: no random spawn over manual nav
    expect(currentModel).toBe(""); // boot never set an address after being superseded
  });

  it("no overlapping list requests while one is in flight (refresh spam)", async () => {
    const [bootD] = bootCalls;
    bootD.resolve(jsonRes({ address: "tiga@isturaiky.page" }));
    await flush();
    let listCalls = 0; const gate = deferred();
    fetchHandler = (url) => {
      if (url.includes("/messages")) { listCalls++; return gate.promise; }
      return Promise.resolve(jsonRes({}, 404));
    };
    const refresh = document.getElementById("refresh") as HTMLButtonElement;
    refresh.click(); refresh.click(); refresh.click();
    await flush();
    expect(listCalls).toBe(1);
    gate.resolve(jsonRes({ address: "tiga@isturaiky.page", messages: [] }));
    await flush();
  });
});
