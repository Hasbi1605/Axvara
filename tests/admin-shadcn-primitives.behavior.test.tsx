// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { render } from "./setup/admin-render";
import { Dialog } from "@/components/ui/Dialog";
import { AdminShell } from "@/components/admin/AdminShell";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Switch, Checkbox, Tabs, TabsList, TabsTrigger } from "@/components/admin/ui";

afterEach(cleanup);

it("returns focus to the mobile navigation trigger after Sheet Escape", async () => {
  render(<ToastProvider><AdminShell section="summary" onSection={() => {}}>Summary</AdminShell></ToastProvider>);
  const trigger = screen.getByRole("button", { name: "Buka navigasi admin" });
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Menu admin" })).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("keeps a menu opened inside a modal in the themed root and restores nested focus", async () => {
  function Fixture() {
    const [open, setOpen] = useState(false);
    return <><Button onClick={() => setOpen(true)}>Editor</Button>{open && <Dialog title="Nested editor" onClose={() => setOpen(false)}><DropdownMenu><DropdownMenuTrigger asChild><Button>Aksi</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Pilih</DropdownMenuItem></DropdownMenuContent></DropdownMenu></Dialog>}</>;
  }
  render(<Fixture />);
  await userEvent.click(screen.getByRole("button", { name: "Editor" }));
  await userEvent.click(screen.getByRole("button", { name: "Aksi" }));
  expect(screen.getByRole("menu").closest('[role="dialog"]')).toBeNull();
  expect(screen.getByRole("menu").closest(".admin-theme")).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Aksi" })));
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Editor" })));
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
});

it("focuses cancel in alert dialogs and blocks Escape while a write is busy", async () => {
  const close = vi.fn(); const confirm = vi.fn();
  const view = (loading: boolean) => <ConfirmDialog open title="Delete?" description="Cannot undo" loading={loading} onClose={close} onConfirm={confirm} />;
  const { rerender } = render(view(false));
  expect(screen.getByRole("alertdialog", { name: "Delete?" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Batal" }));
  rerender(view(true));
  fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Hapus" }) as HTMLButtonElement).disabled).toBe(true);
});

it("supports keyboard-only switches, checkboxes and automatic tab navigation", async () => {
  const onSwitch = vi.fn(); const onCheck = vi.fn(); const onTab = vi.fn();
  render(<><Switch aria-label="Enabled" onCheckedChange={onSwitch} /><Checkbox aria-label="Selected" onCheckedChange={onCheck} /><Tabs defaultValue="one" onValueChange={onTab}><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList></Tabs></>);
  screen.getByRole("switch").focus(); await userEvent.keyboard(" "); expect(onSwitch).toHaveBeenCalledWith(true);
  screen.getByRole("checkbox").focus(); await userEvent.keyboard(" "); expect(onCheck).toHaveBeenCalledWith(true);
  screen.getByRole("tab", { name: "One" }).focus(); await userEvent.keyboard("{ArrowRight}"); expect(onTab).toHaveBeenCalledWith("two");
});
