// @vitest-environment jsdom
//
// tests/admin-handover-dialog.behavior.test.tsx — Dialog "Kirim ke pembeli"
// di panel admin yang dirender sungguhan (2026-09-25). Dulu tombol "Serahkan
// manual" hanya meminta catatan audit; isi produk tidak pernah sampai ke
// pembeli lewat sistem.
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminPage from "@/app/admin/page";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/admin"); });

const CODE = "AXV-20260925-MBO00001";
const order = {
  code: CODE, customer_name: "Rani Putri", customer_wa: "628111222333", customer_email: "rani@contoh.test",
  payment_method: "qris", items: [{ product_id: 1, variant_id: 2, name: "Canva Pro — Invite Lifetime", price: 5000, qty: 1 }],
  subtotal: 5000, payment_amount: 5000, status: "lunas", payment_status: "paid",
  fulfillment_status: "manual_required", sales_channel: "web", created_at: "2026-09-25 10:00:00",
};

function stubAdminApi() {
  const posts: Record<string, unknown>[] = [];
  let delivered = false;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === `/api/admin/orders/${CODE}/handover` && method === "POST") {
      posts.push(JSON.parse(String(init?.body)));
      delivered = true;
      return { ok: true, status: 200, json: async () => ({ ok: true, complete: true, fulfillment_status: "delivered", buyer_notified: true }) };
    }
    if (url === `/api/admin/orders/${CODE}/handover`) {
      return { ok: true, status: 200, json: async () => ({
        ok: true, code: CODE,
        order: { code: CODE, sales_channel: "web", customer_email: "rani@contoh.test" },
        items: [{ item_index: 0, status: delivered ? "delivered" : "manual_required", label: "Canva Pro — Invite Lifetime",
          template_text: "Undangan Canva sudah dikirim ke rani@contoh.test. Buka email dari Canva lalu terima undangannya." }],
      }) };
    }
    const body = url === "/api/auth/me" ? { authed: true, email: "fixture@example.test" }
      : url.startsWith("/api/admin/orders") ? { orders: [order], total: 1 }
        : url === "/api/products" ? { products: [] }
          : url.startsWith("/api/categories") ? { categories: [] } : {};
    return { ok: true, status: 200, json: async () => body };
  }));
  return posts;
}

async function openDialog() {
  const posts = stubAdminApi();
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button").find((node) => (node.textContent ?? "").includes("Pesanan"))!);
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button").find((node) => (node.textContent ?? "").trim() === "Kirim ke pembeli")!);
  const dialog = await screen.findByRole("dialog", { name: "Kirim ke pembeli" });
  return { posts, dialog };
}

it("kolom detail terisi dari template varian dan tujuan email disebut", async () => {
  const { dialog } = await openDialog();
  const field = await waitFor(() => {
    const el = dialog.querySelector("textarea");
    if (!el) throw new Error("textarea belum tampil");
    return el as HTMLTextAreaElement;
  });
  expect(field.value).toBe("Undangan Canva sudah dikirim ke rani@contoh.test. Buka email dari Canva lalu terima undangannya.");
  expect(dialog.textContent).toContain("Detail untuk pembeli · Canva Pro — Invite Lifetime");
  expect(dialog.textContent).toContain("Dikirim ke email rani@contoh.test");
});

it("isi yang disunting admin terkirim sebagai buyer_message, catatan internal terpisah", async () => {
  const { posts, dialog } = await openDialog();
  const field = await waitFor(() => {
    const el = dialog.querySelector("textarea");
    if (!el) throw new Error("textarea belum tampil");
    return el as HTMLTextAreaElement;
  });
  fireEvent.change(field, { target: { value: "Undangan terkirim. Cek folder Spam bila belum masuk." } });
  fireEvent.change(dialog.querySelector("input")!, { target: { value: "diundang dari akun tim 2" } });
  const send = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Kirim ke pembeli")!;
  await act(async () => { fireEvent.click(send); });
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toEqual({ item_index: 0, note: "diundang dari akun tim 2", buyer_message: "Undangan terkirim. Cek folder Spam bila belum masuk." });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Kirim ke pembeli" })).toBeNull());
});
