// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "./setup/admin-render";
import { AgentIntegration } from "@/components/admin/AgentIntegration";
import { NonWrFulfillmentPanel } from "@/components/admin/sections/ProductVariantRows";
import { WarungRebahanManager } from "@/components/admin/WarungRebahanManager";
import { RefundCalculator } from "@/components/refund/RefundCalculator";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin", useSearchParams: () => new URLSearchParams(), useRouter: () => ({}) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const code = "AXV-20261121-FX40DEMO";
const cases = [
  { kind: "token", ui: <AgentIntegration />, trigger: "Cabut token Fixture Agent", target: "Fixture Agent", label: "Cabut token", url: "/api/admin/agent-tokens/42", method: "DELETE", list: "/api/admin/agent-tokens", data: { tokens: [{ id: 42, name: "Fixture Agent", token_prefix: "demo", scopes: [], is_active: 1 }] }, after: { tokens: [] } },
  { kind: "inventory", ui: <NonWrFulfillmentPanel productId={1} variantId={2} mode="unique" />, trigger: "Hapus", target: "#42", label: "Hapus", url: "/api/admin/fulfillment", method: "DELETE", payload: { inventory_id: 42 }, list: "/api/admin/fulfillment?product_id=1&variant_id=2", data: { available: 1, inventory: [{ id: 42, secret: "FIXTURE-NOT-A-REAL-SECRET" }] }, after: { available: 0, inventory: [] } },
  { kind: "exclusion", ui: <WarungRebahanManager />, trigger: "Hapus exclusion %fixture%", target: "%fixture%", label: "Hapus", url: "/api/admin/warung/exclusions?id=42", method: "DELETE", list: "/api/admin/warung/exclusions", data: { exclusions: [{ id: 42, pattern: "%fixture%" }] }, after: { exclusions: [] } },
  { kind: "refund", ui: <RefundCalculator admin initialCode={code} />, trigger: "Cabut Link", target: code, label: "Cabut link", url: "/api/admin/refund", method: "POST", payload: { action: "revoke", code }, list: "/api/admin/refund", data: { estimate: { code, lines: [] }, activeShare: true }, after: { activeShare: false } },
] as const;

it.each(cases)("$kind: cancel/Escape are inert; confirm is single-flight and failure is retryable for the same target", async spec => {
  const user = userEvent.setup();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const mutations: { url: string; method?: string; body: unknown }[] = [];
  let finish!: () => void;
  let removed = false;
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method === "DELETE" || body?.action === "revoke") {
      mutations.push({ url, method: init?.method, body });
      if (mutations.length === 1) return new Promise<Response>(resolve => { finish = () => resolve(Response.json({ error: "fixture_failure" }, { status: 500 })); });
      if (mutations.length === 2) throw new Error("fixture_network_failure");
      removed = true;
      return Response.json(spec.kind === "refund" ? spec.after : { ok: true });
    }
    if (url === spec.list) { reads++; return Response.json(removed ? spec.after : spec.data); }
    return Response.json({ logs: [] });
  }));
  render(<ToastProvider>{spec.ui}</ToastProvider>);
  if (spec.kind === "exclusion") await user.click(screen.getByRole("tab", { name: /^Alat/ }));

  const open = async () => {
    await user.click(await screen.findByRole("button", { name: spec.trigger }));
    expect(mutations).toHaveLength(0);
    return screen.getByRole("alertdialog");
  };
  let dialog = await open();
  expect(dialog.textContent).toContain(spec.target);
  expect(dialog.textContent).not.toContain("FIXTURE-NOT-A-REAL-SECRET");
  await user.click(within(dialog).getByRole("button", { name: "Batal" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await open();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  dialog = await open();
  const confirm = () => within(dialog).getByRole("button", { name: spec.label });
  const button = confirm();
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  const request = { url: spec.url, method: spec.method, body: "payload" in spec ? spec.payload : undefined };
  expect(mutations).toEqual([request]);
  await act(async () => finish());
  await within(dialog).findByRole("alert");
  expect(dialog.textContent).toContain(spec.target);
  await user.click(confirm());
  await within(dialog).findByRole("alert");
  expect(mutations).toEqual([request, request]);
  await user.click(confirm());
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(mutations).toEqual([request, request, request]);
  expect(screen.queryByRole("button", { name: spec.trigger })).toBeNull();
  if (spec.kind !== "refund") expect(reads).toBe(2);
});
