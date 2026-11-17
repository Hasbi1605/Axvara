// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WhatsAppPromoBot } from "@/components/admin/WhatsAppPromoBot";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("selects writable groups, sends explicit ids, shows current footer and disables unwritable groups", async () => {
  const gateway = { configured: true, connected: true, blocked: false, botNumber: "628123456789", botRevision: "initial" };
  const config = { ...gateway, enabled: false, groups: [] };
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/store-settings" ? { settings: { whatsappGroupUrl: "https://chat.whatsapp.com/current" } } : { gateway, config, ...(url.includes("?groups=1") ? { groups: [{ id: "123@g.us", subject: "Writable", canSend: true }, { id: "456@g.us", subject: "Readonly", canSend: false }] } : {}) } }));
  vi.stubGlobal("fetch", fetcher); render(<WhatsAppPromoBot />);
  await waitFor(() => expect((screen.getByText("Muat grup") as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText("Join Grup WA: https://chat.whatsapp.com/current")).toBeTruthy();
  fireEvent.click(screen.getByText("Muat grup"));
  await screen.findByLabelText("Writable"); expect((screen.getByLabelText("Readonly") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Writable")); expect(screen.getByText("1/20 dipilih")).toBeTruthy();
  fireEvent.click(screen.getByText("Simpan grup"));
  await waitFor(() => expect(fetcher.mock.calls.some(call => { const init = (call as unknown[])[1] as RequestInit; return init?.body && JSON.parse(String(init.body)).action === "save_groups"; })).toBe(true));
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(JSON.parse(String(calls.find(([, init]) => init?.body && JSON.parse(String(init.body)).action === "save_groups")![1].body))).toEqual({ action: "save_groups", botNumber: gateway.botNumber, botRevision: "initial", groupIds: ["123@g.us"] });
});
