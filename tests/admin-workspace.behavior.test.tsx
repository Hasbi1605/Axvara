// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AdminWorkspace, AdminThemeMenu, navigateWithDraftGuard, useAdminDraft } from "@/components/admin/AdminWorkspace";
import { Dialog } from "@/components/ui/Dialog";

let pathname = "/admin";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); pathname = "/admin"; });

function Editor({ proceed, busy = false }: { proceed: () => void; busy?: boolean }) {
  const [text, setText] = useState("");
  useAdminDraft(!!text || busy, busy);
  return <><label>Draft<input value={text} onChange={e => setText(e.target.value)} /></label><button onClick={() => navigateWithDraftGuard(proceed)}>Pindah</button></>;
}

it("preserves a dirty editor when navigation is cancelled, then proceeds once on discard", () => {
  const proceed = vi.fn();
  render(<AdminWorkspace><Editor proceed={proceed} /></AdminWorkspace>);
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Belum disimpan" } });
  fireEvent.click(screen.getByText("Pindah"));
  expect(proceed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Lanjut mengedit"));
  expect(screen.getByDisplayValue("Belum disimpan")).toBeTruthy();
  fireEvent.click(screen.getByText("Pindah"));
  fireEvent.click(screen.getByRole("button", { name: "Buang perubahan" }));
  expect(proceed).toHaveBeenCalledTimes(1);
});

it("blocks navigation during a write without offering destructive discard", () => {
  const proceed = vi.fn();
  render(<AdminWorkspace><Editor proceed={proceed} busy /></AdminWorkspace>);
  fireEvent.click(screen.getByText("Pindah"));
  expect(proceed).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
});

it("scopes theme menus and their portals to admin, persisting a validated choice", async () => {
  history.replaceState(null, "", "/admin");
  const { container } = render(<AdminWorkspace initialTheme="dark"><AdminThemeMenu /></AdminWorkspace>);
  await userEvent.click(screen.getByRole("button", { name: "Tema admin" }));
  expect(screen.getByRole("menu").closest(".admin-theme")).toBe(container.firstElementChild);
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Terang" }));
  expect(container.firstElementChild?.getAttribute("data-admin-theme")).toBe("light");
  expect(document.cookie).toContain("axvara-admin-theme=light");
  expect(document.documentElement.hasAttribute("data-admin-theme")).toBe(false);
});

it("Radix modal honours busy Escape and restores scroll/focus on unmount", async () => {
  const button = document.createElement("button"); document.body.append(button); button.focus();
  const close = vi.fn();
  const view = (busy: boolean) => <AdminWorkspace><Dialog title="Editor" onClose={close} busy={busy}><button>Tutup</button></Dialog></AdminWorkspace>;
  const { unmount, rerender } = render(view(true));
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  rerender(view(false));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  unmount(); expect(document.body.hasAttribute("data-scroll-locked")).toBe(false); await waitFor(() => expect(document.activeElement).toBe(button)); button.remove();
});

it("leaves the storefront checkout on /admin/payments/test outside the admin theme", () => {
  pathname = "/admin/payments/test";
  const { container } = render(<AdminWorkspace initialTheme="light"><p>Checkout</p></AdminWorkspace>);
  expect(screen.getByText("Checkout")).toBeTruthy();
  expect(container.querySelector(".admin-theme")).toBeNull();
  expect(screen.queryByLabelText("Tema admin")).toBeNull();
});
