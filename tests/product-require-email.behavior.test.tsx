// @vitest-environment jsdom
//
// tests/product-require-email.behavior.test.tsx — Regresi "centang Wajib email
// pembeli mati lagi setelah refresh" (2026-09-25).
//
// Penyebab: daftar produk admin tidak membawa require_email dan editor tidak
// membacanya dari detail produk, jadi centang selalu tampil mati. Simpan lalu
// menulis require_email=0, sehingga nilai yang sudah benar ikut terhapus.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useProductManager } from "@/components/admin/useProductManager";
import type { Prod } from "@/components/admin/product-types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Baris daftar produk seperti dari GET /api/products: TANPA requireEmail.
const listRow = {
  id: "1", slug: "canva-premium", name: "Canva Pro / Premium", description: "Deskripsi", price: 2000,
  categorySlug: "akun-premium", image: "", images: [], soldCount: 0, stock: -1, isActive: true,
} as unknown as Prod;

const variants = [
  { id: 1, sku: "CANVA-PREMIUM-1", label: "Invite 1 Bulan", price: 2000, stock: -1, is_active: 1, fulfillment_mode: "shared" },
  { id: 2, sku: "CANVA-PREMIUM-2", label: "Invite Lifetime", price: 5000, stock: -1, is_active: 1, fulfillment_mode: "manual" },
];

function stubApi(detail: { ok: boolean; requireEmail?: boolean }) {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === "/api/products/1" && method === "GET") {
      if (!detail.ok) return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
      return { ok: true, status: 200, json: async () => ({ product: { ...listRow, wrDescription: "Deskripsi", adminDescriptionOverride: null, wrManaged: false, requireEmail: detail.requireEmail, variants } }) };
    }
    if (url.startsWith("/api/admin/variants")) return { ok: true, status: 200, json: async () => ({ variants }) };
    if (url === "/api/products" && method === "GET") return { ok: true, status: 200, json: async () => ({ products: [listRow] }) };
    if (url.startsWith("/api/categories")) return { ok: true, status: 200, json: async () => ({ categories: [] }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }));
  return calls;
}

function renderManager() {
  return renderHook(() => useProductManager({ success: vi.fn(), error: vi.fn() }, vi.fn()));
}

describe("Wajib email pembeli: centang tersimpan dan termuat ulang", () => {
  it("editor membaca require_email dari detail produk, dan Simpan tidak menimpanya", async () => {
    const calls = stubApi({ ok: true, requireEmail: true });
    const { result } = renderManager();
    await act(async () => { await result.current.openEdit(listRow); });
    expect(result.current.form.requireEmail).toBe(true);
    // Membuka editor bukan perubahan: tidak ada peringatan "belum disimpan".
    expect(result.current.productDirty).toBe(false);

    // Admin hanya mengubah nama; centang email tidak disentuh.
    act(() => { result.current.setForm({ ...result.current.form, name: "Canva Pro" }); });
    await act(async () => { await result.current.save(); });
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe("/api/products/1");
    expect(put?.body?.requireEmail).toBe(true);
  });

  it("mematikan centang tetap terkirim sebagai false", async () => {
    const calls = stubApi({ ok: true, requireEmail: true });
    const { result } = renderManager();
    await act(async () => { await result.current.openEdit(listRow); });
    act(() => { result.current.setForm({ ...result.current.form, requireEmail: false }); });
    await act(async () => { await result.current.save(); });
    expect(calls.find((c) => c.method === "PUT")?.body?.requireEmail).toBe(false);
  });

  it("detail produk gagal dibaca: Simpan tidak mengirim requireEmail sama sekali", async () => {
    const calls = stubApi({ ok: false });
    const { result } = renderManager();
    await act(async () => { await result.current.openEdit(listRow); });
    expect(result.current.form.requireEmail).toBeUndefined();
    await act(async () => { await result.current.save(); });
    const put = calls.find((c) => c.method === "PUT");
    expect(put).toBeTruthy();
    expect(put?.body && "requireEmail" in put.body).toBe(false);
  });

  it("produk baru yang dicentang mengirim requireEmail true", async () => {
    const calls = stubApi({ ok: true });
    const { result } = renderManager();
    act(() => { result.current.openNew(); });
    act(() => { result.current.setForm({ ...result.current.form, name: "Produk Baru", slug: "produk-baru", requireEmail: true }); });
    await act(async () => { await result.current.save(); });
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/products");
    expect(post?.body?.requireEmail).toBe(true);
  });
});
