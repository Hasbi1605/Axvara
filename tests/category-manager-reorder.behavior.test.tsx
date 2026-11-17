// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CategoryManager } from "@/components/admin/CategoryManager";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const categories = [{ id: 1, name: "Kategori A", slug: "a", sort_order: 10 }, { id: 2, name: "Kategori B", slug: "b", sort_order: 20 }, { id: 3, name: "Kategori C", slug: "c", sort_order: 30 }];

it("optimistic movement queues rapid clicks and rolls back only the failed move", async () => {
  const requests: { resolve: (response: Response) => void; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify({ categories }));
    return new Promise<Response>(resolve => requests.push({ resolve, body: JSON.parse(String(init.body)) }));
  }));
  render(<CategoryManager />);
  await screen.findByText("Kategori A");
  expect((screen.getByRole("button", { name: "Naikkan Kategori A" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Turunkan Kategori A" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  const names = () => [...document.querySelectorAll("p.text-sm.font-semibold")].map(node => node.textContent);
  expect(names()).toEqual(["Kategori B", "Kategori A", "Kategori C"]);
  fireEvent.click(screen.getByRole("button", { name: "Turunkan Kategori A" }));
  expect(requests).toHaveLength(1);
  await act(async () => requests[0].resolve(new Response(JSON.stringify({ categories: [categories[1], categories[0], categories[2]].map((category, index) => ({ ...category, sort_order: (index + 1) * 10 })) }))));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(names()).toEqual(["Kategori B", "Kategori C", "Kategori A"]);
  await act(async () => requests[1].resolve(new Response(JSON.stringify({ error: "Gagal fixture" }), { status: 500 })));
  await waitFor(() => expect(names()).toEqual(["Kategori B", "Kategori A", "Kategori C"]));
  expect(requests.map(request => request.body)).toEqual([{ categoryId: 1, direction: 1 }, { categoryId: 1, direction: 1 }]);
  expect(toast.error).toHaveBeenCalledWith("Gagal fixture");
});
