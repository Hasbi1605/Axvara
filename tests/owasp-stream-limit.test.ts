import { expect, it, vi } from "vitest";
import { readBoundedText } from "@/lib/bounded-body";
import worker from "../mcp-worker/src/index";

it("stops consuming an oversized chunked stream, counts Unicode bytes, and preserves signed raw text", async () => {
  let reads = 0;
  const cancel = vi.fn();
  const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(10_000)); }, cancel });
  const request = new Request("https://axvara.test/api/orders", { method: "POST", body, duplex: "half" } as RequestInit);
  await expect(readBoundedText(request, 32_000)).rejects.toMatchObject({ status: 413 });
  expect(reads).toBeLessThan(7);
  expect(cancel).toHaveBeenCalledOnce();
  await expect(readBoundedText(new Request("https://axvara.test", { method: "POST", body: "€".repeat(4) }), 10)).rejects.toMatchObject({ status: 413 });
  const raw = '{ "message": "é", "amount": 10000 }\n';
  expect(await readBoundedText(new Request("https://axvara.test", { method: "POST", body: raw }), 100)).toBe(raw);
});

it("MCP bounds streamed requests and rejects structured IDs before calling Pages", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not call Pages"));
  try {
    const oversized = await worker.fetch(new Request("https://mcp.test/mcp", { method: "POST", headers: { authorization: "Bearer fixture" }, body: " ".repeat(8 * 1024 * 1024 + 1) }), { AXVARA_API_ORIGIN: "https://axvara.test" });
    expect(oversized.status).toBe(413);
    const invalid = await worker.fetch(new Request("https://mcp.test/mcp", { method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify({ jsonrpc: "2.0", id: { private: "input" }, method: "tools/list" }) }), { AXVARA_API_ORIGIN: "https://axvara.test" });
    expect(await invalid.json()).toMatchObject({ id: null, error: { code: -32600 } });
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
