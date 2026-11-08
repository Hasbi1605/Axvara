import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callDigiflazz, checkBalance, digiflazzSign, fetchPrepaidPriceList, isDigiflazzConfigured, md5Hex, sendTransaction,
} from "@/lib/games/digiflazz";
import { FetchTimeoutError } from "@/lib/fetch-timeout";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const sentBody = (m: ReturnType<typeof vi.fn>) => JSON.parse(String((m.mock.calls[0] as unknown as [string, RequestInit])[1].body));

beforeEach(() => {
  vi.stubEnv("DIGIFLAZZ_USERNAME", "demouser");
  vi.stubEnv("DIGIFLAZZ_API_KEY", "dev-key-123");
  vi.stubEnv("DIGIFLAZZ_TESTING", "");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.test/");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "tok");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("md5 / sign", () => {
  it("matches node:crypto, including padding boundaries and unicode", () => {
    for (const s of ["", "a", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(1000), "dépôt ✓"]) {
      expect(md5Hex(s)).toBe(md5(s));
    }
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });
  it("digiflazzSign = md5(username+key+suffix)", () => {
    expect(digiflazzSign("username", "key", "depo")).toBe(md5("usernamekeydepo"));
  });
});

describe("configuration", () => {
  it("requires username, key, proxy url and token", () => {
    expect(isDigiflazzConfigured()).toBe(true);
    for (const name of ["DIGIFLAZZ_USERNAME", "DIGIFLAZZ_API_KEY", "WARUNG_REBAHAN_PROXY_URL", "WARUNG_REBAHAN_PROXY_TOKEN"]) {
      vi.stubEnv(name, "");
      expect(isDigiflazzConfigured()).toBe(false);
      vi.stubEnv(name, "x");
    }
  });
  it("returns config result without calling fetch when unconfigured", async () => {
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await callDigiflazz("cek-saldo", {})).toEqual({ kind: "config", reason: "proxy_not_configured" });
    expect(await checkBalance()).toMatchObject({ kind: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("callDigiflazz transport", () => {
  it("posts to /dgf/v1/<endpoint> with proxy token, manual redirect and a signal", async () => {
    const fetchMock = vi.fn(async () => reply(200, { data: { deposit: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await callDigiflazz("price-list", { a: 1 });
    expect(r).toEqual({ kind: "ok", status: 200, json: { data: { deposit: 1 } } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proxy.test/dgf/v1/price-list");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toMatchObject({ "x-proxy-token": "tok", "content-type": "application/json" });
    expect(init.body).toBe('{"a":1}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([[502], [504]])("maps proxy %i to ambiguous", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(status, { error: "x" })));
    expect(await callDigiflazz("transaction", {})).toEqual({ kind: "ambiguous", reason: `proxy_${status}` });
  });
  it("maps network error, timeout and unreadable JSON to ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fail"); }));
    expect(await callDigiflazz("transaction", {})).toMatchObject({ kind: "ambiguous" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new FetchTimeoutError(); }));
    expect(await callDigiflazz("transaction", {})).toMatchObject({ kind: "ambiguous" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, "<html>oops")));
    expect(await callDigiflazz("transaction", {})).toEqual({ kind: "ambiguous", reason: "unreadable_json" });
  });
  it.each([[401], [404]])("maps proxy %i to config", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(status, { error: "unauthorized" })));
    expect(await callDigiflazz("cek-saldo", {})).toEqual({ kind: "config", reason: `proxy_${status}` });
  });
  it("treats a redirect as config and other non-2xx as http_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(302, "")));
    expect(await callDigiflazz("cek-saldo", {})).toMatchObject({ kind: "config" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { data: { rc: "40" } })));
    expect(await callDigiflazz("cek-saldo", {})).toEqual({ kind: "http_error", status: 400, json: { data: { rc: "40" } } });
  });
});

describe("helpers", () => {
  it("checkBalance signs with 'depo' and parses deposit", async () => {
    const fetchMock = vi.fn(async () => reply(200, { data: { deposit: "125000" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkBalance()).toEqual({ kind: "balance", deposit: 125000 });
    const body = sentBody(fetchMock);
    expect(body).toEqual({ cmd: "deposit", username: "demouser", sign: md5("demouserdev-key-123depo") });
    expect(JSON.stringify(body)).not.toContain("dev-key-123");
  });

  it("fetchPrepaidPriceList signs with 'pricelist', tolerates string numbers and skips invalid rows", async () => {
    const fetchMock = vi.fn(async () => reply(200, { data: [
      { buyer_sku_code: "ml86", product_name: "ML 86", category: "Games", brand: "MOBILE LEGENDS", type: "Umum", price: "19500", buyer_product_status: true, seller_product_status: "true", unlimited_stock: true, stock: "0", multi: false, start_cut_off: "23:45", end_cut_off: "00:15", desc: "d" },
      { product_name: "no code", price: 1 },
      { buyer_sku_code: "bad", price: "abc" },
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchPrepaidPriceList();
    expect(r).toMatchObject({ kind: "ok", invalid: 2 });
    if (r.kind !== "ok") throw new Error("unreachable");
    expect(r.items).toEqual([expect.objectContaining({ buyer_sku_code: "ml86", price: 19500, seller_product_status: true, unlimited_stock: true, stock: 0, start_cut_off: "23:45" })]);
    expect(sentBody(fetchMock)).toEqual({ cmd: "prepaid", username: "demouser", sign: md5("demouserdev-key-123pricelist") });
  });

  it("price-list with non-array data becomes api_error (rate limit)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { data: { rc: "83", message: "Rate limit" } })));
    expect(await fetchPrepaidPriceList()).toEqual({ kind: "api_error", rc: "83", message: "Rate limit" });
  });

  describe("sendTransaction", () => {
    const input = { buyer_sku_code: "ml86", customer_no: "12345(1234)", ref_id: "AXV-1-1", max_price: 20000 };
    const txBody = (status: string) => ({ data: { ref_id: "AXV-1-1", status, rc: "00", message: "ok", sn: "SN1", price: 19500, buyer_sku_code: "ml86" } });

    it("signs with ref_id, includes max_price, omits testing unless enabled", async () => {
      const m = vi.fn(async () => reply(200, txBody("Sukses")));
      vi.stubGlobal("fetch", m);
      const r = await sendTransaction(input);
      expect(r).toEqual({ kind: "ok", tx: { ref_id: "AXV-1-1", status: "Sukses", rc: "00", message: "ok", sn: "SN1", price: 19500, buyer_sku_code: "ml86" } });
      expect(sentBody(m)).toEqual({ username: "demouser", ...input, sign: md5("demouserdev-key-123AXV-1-1") });
    });
    it("adds testing:true when DIGIFLAZZ_TESTING=true", async () => {
      vi.stubEnv("DIGIFLAZZ_TESTING", "true");
      const m = vi.fn(async () => reply(200, txBody("Pending")));
      vi.stubGlobal("fetch", m);
      expect(await sendTransaction(input)).toMatchObject({ kind: "ok", tx: { status: "Pending" } });
      expect(sentBody(m).testing).toBe(true);
    });
    it("parses Gagal on a 4xx response as a final answer", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => reply(400, txBody("Gagal"))));
      expect(await sendTransaction(input)).toMatchObject({ kind: "ok", tx: { status: "Gagal" } });
    });
    it("unknown status or unreadable data is ambiguous; transport failures pass through", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => reply(200, txBody("Weird"))));
      expect(await sendTransaction(input)).toEqual({ kind: "ambiguous", reason: "unknown_status" });
      vi.stubGlobal("fetch", vi.fn(async () => reply(200, { data: "nope" })));
      expect(await sendTransaction(input)).toMatchObject({ kind: "ambiguous" });
      vi.stubGlobal("fetch", vi.fn(async () => reply(500, { message: "boom" })));
      expect(await sendTransaction(input)).toEqual({ kind: "ambiguous", reason: "http_500" });
      vi.stubGlobal("fetch", vi.fn(async () => reply(504, {})));
      expect(await sendTransaction(input)).toMatchObject({ kind: "ambiguous" });
      vi.stubGlobal("fetch", vi.fn(async () => reply(401, {})));
      expect(await sendTransaction(input)).toMatchObject({ kind: "config" });
      vi.stubGlobal("fetch", vi.fn(async () => reply(403, { data: { rc: "x" } })));
      expect(await sendTransaction(input)).toMatchObject({ kind: "http_error", status: 403 });
    });
  });
});
