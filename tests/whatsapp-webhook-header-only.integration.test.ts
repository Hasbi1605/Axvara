import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as webhook } from "@/app/api/whatsapp/webhook/route";
import { POST as groupEvents } from "@/app/api/whatsapp/group-events/route";

const TOKEN = "fixture-shared-webhook-token";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("WHATSAPP_WEBHOOK_TOKEN", TOKEN);
  vi.stubEnv("WHATSAPP_ENABLED", "1");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No gateway calls in this fixture"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const payload = JSON.stringify({ sender: "120363000000000001@g.us", member: "628000000001", message: "garansi", name: "A", inboxid: "inbox-1" });

describe("AU-B1-2 — WhatsApp webhook secret is header-only in production", () => {
  it("accepts the canonical x-webhook-token header", async () => {
    const res = await webhook(new NextRequest("https://axvara.test/api/whatsapp/webhook", {
      method: "POST", headers: { "content-type": "application/json", "x-webhook-token": TOKEN }, body: payload,
    }));
    // Reaches business logic (not 401). Group allowlist is unset → not_allowed, still authenticated.
    expect(res.status).not.toBe(401);
  });

  it("rejects a query-string token with 401 (no fallback)", async () => {
    const res = await webhook(new NextRequest(`https://axvara.test/api/whatsapp/webhook?token=${TOKEN}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: payload,
    }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("rejects a body-supplied secret with 401 (no fallback)", async () => {
    const res = await webhook(new NextRequest("https://axvara.test/api/whatsapp/webhook", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...JSON.parse(payload), secret: TOKEN }),
    }));
    expect(res.status).toBe(401);
  });

  it("group-events also rejects a query-string token and accepts the header", async () => {
    const body = JSON.stringify({ event: "member_join", groupId: "120363000000000001@g.us", botNumber: "628000000001", botRevision: "r1", members: [{ id: "628000000002@s.whatsapp.net", name: "B" }] });
    const viaQuery = await groupEvents(new NextRequest(`https://axvara.test/api/whatsapp/group-events?secret=${TOKEN}`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }));
    expect(viaQuery.status).toBe(401);
    const viaHeader = await groupEvents(new NextRequest("https://axvara.test/api/whatsapp/group-events", {
      method: "POST", headers: { "content-type": "application/json", "x-webhook-token": TOKEN }, body,
    }));
    expect(viaHeader.status).not.toBe(401);
  });

  it("a wrong header still fails with 401", async () => {
    const res = await webhook(new NextRequest("https://axvara.test/api/whatsapp/webhook", {
      method: "POST", headers: { "content-type": "application/json", "x-webhook-token": "wrong" }, body: payload,
    }));
    expect(res.status).toBe(401);
  });
});
