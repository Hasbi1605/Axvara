// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WhatsAppPromoBot } from "@/components/admin/WhatsAppPromoBot";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Call = [string, RequestInit | undefined];
function setup(options: { connected?: boolean; enabled?: boolean; botNumber?: string | null; savedGroups?: { id: string; subject: string }[] } = {}) {
  const botNumber = options.botNumber === undefined ? "628123456789" : options.botNumber;
  const gateway = { configured: Boolean(botNumber), connected: options.connected ?? true, blocked: false, botNumber, botRevision: botNumber ? "initial" : null };
  const config = botNumber ? { enabled: options.enabled ?? false, botNumber, botRevision: "initial", groups: options.savedGroups ?? [] } : null;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/store-settings") return { ok: true, json: async () => ({ settings: { whatsappGroupUrl: "https://chat.whatsapp.com/current" } }) };
    if (init?.method === "POST") return { ok: true, json: async () => ({ ok: true, config }) };
    return { ok: true, json: async () => ({ gateway, config, ...(url.includes("?groups=1") ? { groups: [{ id: "123@g.us", subject: "Writable", size: 10, canSend: true }, { id: "456@g.us", subject: "Readonly", size: 10, canSend: false }] } : {}) }) };
  });
  vi.stubGlobal("fetch", fetcher);
  render(<WhatsAppPromoBot />);
  const posts = () => (fetcher.mock.calls as unknown as Call[]).filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)));
  return { posts };
}

it("shows connection status, saved groups and the current join footer like the AXVARA'S card", async () => {
  setup({ enabled: true, savedGroups: [{ id: "123@g.us", subject: "Writable" }] });
  await screen.findByText("Bot tersambung · Promo aktif");
  expect(screen.getByText("Writable")).toBeTruthy();
  expect(screen.getByText("Baris terakhir pesan: Join Grup WA: https://chat.whatsapp.com/current")).toBeTruthy();
  expect((screen.getByText("Hubungkan nomor bot") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Nonaktifkan promo")).toBeTruthy();
  expect(screen.queryByLabelText("Nomor WhatsApp bot baru")).toBeNull();
});

it("edits groups, sends explicit ids, keeps unwritable groups disabled and re-enables an active bot", async () => {
  const { posts } = setup({ enabled: true, savedGroups: [] });
  await screen.findByText("Bot tersambung · Promo aktif");
  fireEvent.click(screen.getByText("Edit grup"));
  await screen.findByLabelText("Writable");
  expect((screen.getByLabelText("Readonly") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Writable"));
  expect(screen.getByText("1/20 dipilih")).toBeTruthy();
  fireEvent.click(screen.getByText("Simpan grup"));
  await waitFor(() => expect(posts().map(p => p.action)).toEqual(["save_groups", "enable"]));
  expect(posts()[0]).toEqual({ action: "save_groups", botNumber: "628123456789", botRevision: "initial", groupIds: ["123@g.us"] });
});

it("keeps the number save button disabled until a different valid number is entered", async () => {
  setup();
  await screen.findByText("Bot tersambung · Promo belum aktif");
  fireEvent.click(screen.getByText("Ganti nomor bot"));
  const input = screen.getByLabelText("Nomor WhatsApp bot baru");
  const save = () => screen.getByText("Simpan nomor") as HTMLButtonElement;
  expect(save().disabled).toBe(true);
  fireEvent.change(input, { target: { value: "628123456789" } });
  expect(save().disabled).toBe(true);
  fireEvent.change(input, { target: { value: "08987654321" } });
  expect(save().disabled).toBe(false);
});

it("asks for a number when none is configured and blocks enabling without a connection", async () => {
  setup({ botNumber: null, connected: false });
  await screen.findByText("Nomor bot belum diatur · Promo belum aktif");
  expect(screen.getByLabelText("Nomor WhatsApp bot promo")).toBeTruthy();
  expect((screen.getByText("Aktifkan promo") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText("Edit grup") as HTMLButtonElement).disabled).toBe(true);
});
