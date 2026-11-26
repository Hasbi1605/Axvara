// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./setup/admin-render";
import BotAutomationManager from "@/components/admin/BotAutomationManager";
import { BroadcastManager } from "@/components/admin/BroadcastManager";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Admin UI — Telegram Channel Force-Join & Broadcast", () => {
  it("loads channel settings from bot health, saves toggle changes, and verifies bot admin status", async () => {
    const postCalls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/bot/health") {
        return Response.json({
          bot_configured: true,
          bot_enabled: true,
          whatsapp_configured: true,
          whatsapp_enabled: true,
          telegram_channel: {
            channelUsername: "axvaratech",
            channelTitle: "Axvara Official",
            forceSubEnabled: false,
            channelPromoEnabled: true,
            dmPromoEnabled: true,
            cacheTtlSeconds: 21600,
          },
          fulfillment_action: { orders: [], total: 0, whatsapp_outbox_failed_7d: 0 },
        });
      }
      if (url === "/api/admin/telegram/channel" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        postCalls.push({ url, body });
        if (body.action === "save") {
          return Response.json({
            ok: true,
            dmPromoEnabled: body.dmPromoEnabled,
            config: {
              channelUsername: body.channelUsername,
              channelTitle: body.channelTitle,
              forceSubEnabled: body.forceSubEnabled,
              channelPromoEnabled: body.channelPromoEnabled,
              cacheTtlSeconds: body.cacheTtlSeconds,
            },
          });
        }
        return Response.json({
          ok: true,
          channelUsername: "axvaratech",
          botUsername: "@Axvara_bot",
          isAdmin: true,
          canPostMessages: true,
          status: "administrator",
        });
      }
      return Response.json({ ok: true });
    }));

    const user = userEvent.setup();
    render(<ToastProvider><BotAutomationManager /></ToastProvider>);

    expect(await screen.findByText("Channel Resmi Telegram & Wajib Join")).toBeTruthy();
    expect(screen.getByText("Wajib join nonaktif")).toBeTruthy();

    await user.click(screen.getByRole("switch", { name: "Wajib join channel (Smart Force-Join)" }));
    await user.click(screen.getByRole("switch", { name: "Auto-promo pagi & sore ke DM Bot" }));
    await user.click(screen.getByRole("button", { name: /Simpan pengaturan channel/i }));

    await waitFor(() => {
      expect(postCalls[0]).toMatchObject({
        url: "/api/admin/telegram/channel",
        body: {
          action: "save",
          channelUsername: "axvaratech",
          forceSubEnabled: true,
          channelPromoEnabled: true,
          dmPromoEnabled: false,
        },
      });
    });
    expect(screen.getByText("Wajib join aktif")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Cek status admin bot/i }));
    expect(await screen.findByText(/@Axvara_bot aktif sebagai Administrator di @axvaratech/)).toBeTruthy();
  });

  it("allows selecting Channel Telegram destination in BroadcastManager and shows channel details in review", async () => {
    const template = {
      id: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      archived: 0,
      name: "Info Restock",
      title: "Restock ChatGPT Plus",
      body: "Stok baru sudah ready!",
      cta_label: "Order Bot",
      cta_url: "https://t.me/Axvara_bot?start=beli",
    };
    const sentPayloads: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return Response.json({ templates: [template], campaigns: [] });
      const body = JSON.parse(String(init.body));
      sentPayloads.push(body);
      if (body.action === "review") {
        return Response.json({
          snapshot: { ...template, tgChannel: { destination: "@axvaratech", title: "Axvara Official" } },
          counts: { telegram_channel: 1 },
        });
      }
      return Response.json({ id: body.id });
    }));

    const user = userEvent.setup();
    render(<BroadcastManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Kirim Info Restock" }));
    await user.click(screen.getByRole("checkbox", { name: "Channel Telegram" }));
    fireEvent.click(screen.getByRole("button", { name: "Tinjau siaran" }));

    expect(await screen.findByText("Channel Telegram: 1 channel")).toBeTruthy();
    expect(screen.getByText("Channel Axvara Official (@axvaratech)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Kirim siaran sekarang/i }));
    await waitFor(() => {
      expect(sentPayloads.some((p) => p.action === "send" && Array.isArray(p.channels) && p.channels.includes("telegram_channel"))).toBe(true);
    });
  });
});
