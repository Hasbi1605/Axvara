// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./setup/admin-render";
import { CategoryManager } from "@/components/admin/CategoryManager";
import { ArticlesManager } from "@/components/admin/ArticlesManager";
import { BannerManager } from "@/components/admin/BannerManager";
import { PaymentMethodsManager } from "@/components/admin/PaymentMethodsManager";
import { SystemTabs } from "@/components/admin/SystemTabs";
import type { AdminSection } from "@/components/admin/AdminShell";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/components/admin/ArticleEditor", () => ({ ArticleEditor: () => null }));
vi.mock("@/components/admin/ImageDropzone", () => ({ ImageDropzone: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  ["Kategori", CategoryManager, "Belum ada kategori."],
  ["Artikel", ArticlesManager, "Total artikel"],
  ["Banner", BannerManager, "Total banner"],
] as const)("places the shared %s header before cards and content", async (title, Manager, content) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ categories: [], articles: [], banners: [] })));
  render(<Manager />);
  const heading = screen.getByRole("heading", { name: title, level: 2 });
  const header = heading.closest<HTMLElement>('[data-slot="page-header"]')!;
  expect(header.parentElement!.firstElementChild).toBe(header);
  const body = await screen.findByText(content);
  expect(header.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  if (title === "Kategori" || title === "Artikel") {
    expect(within(header).queryByRole("button")).toBeNull();
    const toolbar = screen.getByRole("group", { name: title === "Kategori" ? "Aksi kategori" : "Aksi artikel" });
    expect(header.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (title === "Artikel") expect(body.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(within(toolbar).getByRole("button", { name: title === "Kategori" ? "Kategori Baru" : "Artikel Baru" }));
    expect(await screen.findByRole("dialog", { name: title === "Kategori" ? "Kategori Baru" : "Artikel Baru" })).toBeTruthy();
  }
});

it("keeps one settings header above tabs while keyboard navigation changes the panel", async () => {
  function Fixture() {
    const [section, setSection] = useState<AdminSection>("settings");
    return <SystemTabs section={section} onSection={setSection}><p>Panel {section}</p></SystemTabs>;
  }
  render(<Fixture />);
  const heading = screen.getByRole("heading", { name: "Pengaturan Toko", level: 2 });
  const tabs = screen.getByRole("tablist", { name: "Bagian sistem" });
  expect(heading.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  screen.getByRole("tab", { name: "Identitas Toko" }).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Integrasi Agent" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").textContent).toBe("Panel agent");
  expect(screen.getByRole("heading", { name: "Pengaturan Toko" })).toBe(heading);
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tabpanel").textContent).toBe("Panel subscribers");
  expect(screen.getAllByRole("heading", { name: "Pengaturan Toko" })).toHaveLength(1);
});

it("shows the payment header while methods are still loading", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<PaymentMethodsManager />);
  const heading = screen.getByRole("heading", { name: "Pembayaran", level: 2 });
  expect(heading.compareDocumentPosition(screen.getByRole("status")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
