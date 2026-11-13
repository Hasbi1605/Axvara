// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AdminWorkspace, navigateWithDraftGuard, useAdminDraft } from "@/components/admin/AdminWorkspace";
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

it("scopes the theme to admin and persists only the validated select value", () => {
  history.replaceState(null, "", "/admin");
  const { container } = render(<AdminWorkspace initialTheme="dark"><p>Admin</p></AdminWorkspace>);
  fireEvent.change(screen.getByLabelText("Tema admin"), { target: { value: "light" } });
  expect(container.firstElementChild?.getAttribute("data-admin-theme")).toBe("light");
  expect(document.cookie).toContain("axvara-admin-theme=light");
  expect(document.documentElement.hasAttribute("data-admin-theme")).toBe(false);
});

it("native modal honours busy cancel and restores scroll/focus on unmount", () => {
  const button = document.createElement("button"); document.body.append(button); button.focus();
  const close = vi.fn();
  const { unmount, rerender } = render(<Dialog title="Editor" onClose={close} busy><button>Tutup</button></Dialog>);
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  rerender(<Dialog title="Editor" onClose={close}><button>Tutup</button></Dialog>);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
  unmount(); expect(document.body.style.overflow).not.toBe("hidden"); expect(document.activeElement).toBe(button); button.remove();
});

it("leaves the storefront checkout on /admin/payments/test outside the admin theme", () => {
  pathname = "/admin/payments/test";
  const { container } = render(<AdminWorkspace initialTheme="light"><p>Checkout</p></AdminWorkspace>);
  expect(screen.getByText("Checkout")).toBeTruthy();
  expect(container.querySelector(".admin-theme")).toBeNull();
  expect(screen.queryByLabelText("Tema admin")).toBeNull();
});
