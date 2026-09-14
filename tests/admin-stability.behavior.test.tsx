// @vitest-environment jsdom
//
// tests/admin-stability.behavior.test.tsx — Regresi keluhan "admin terus
// refetch/rerender" dan "login berhasil lalu keluar lagi".
//
// Tiga akar yang dikunci di sini:
//  1. ToastProvider dulu membuat nilai context BARU setiap satu toast muncul
//     atau hilang. Loader yang memakai `toast` sebagai dependency effect
//     (WarungRebahanManager: saldo + antrean) karenanya masuk rantai:
//     fetch gagal → toast → context baru → effect fetch ulang → toast lagi.
//  2. Login memanggil callback "muat data" SEKALIGUS menyalakan `authed`,
//     sementara effect pemilik juga memuat saat `authed` menyala → dobel.
//  3. checkAuth dulu memaksa logout untuk SETIAP respons non-ok. Karena
//     identitas toast ikut berubah (akar 1), checkAuth berjalan ulang saat
//     toast muncul; satu 5xx dari edge langsung menendang admin ke gerbang
//     login walau sesinya masih sah.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminPage from "@/app/admin/page";
import { WarungRebahanManager } from "@/components/admin/WarungRebahanManager";
import { useAdminAuth } from "@/components/admin/useAdminAuth";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("identitas toast stabil: loader gagal tidak memicu fetch berulang", () => {
  it("WarungRebahanManager dengan backend gagal berhenti setelah satu putaran", async () => {
    const counts: Record<string, number> = {};
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input).split("?")[0];
      counts[url] = (counts[url] ?? 0) + 1;
      // Batas pengaman: tanpa fix, loop terus berputar. Menggantung request
      // setelah ambang membuat test gagal lewat assertion, bukan OOM.
      if (counts[url] > 6) return new Promise(() => {});
      return { ok: false, status: 500, json: async () => ({ error: "backend down" }) };
    }));

    render(<ToastProvider><WarungRebahanManager /></ToastProvider>);
    await act(async () => {});
    // Toast lama hidup 3.8 detik; lewati jendela munculnya toast berikutnya.
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });

    expect(counts["/api/admin/warung/saldo"], "saldo tidak boleh difetch berulang").toBe(1);
    expect(counts["/api/admin/warung/orders"], "antrean tidak boleh difetch berulang").toBe(1);
  });
});

describe("login tidak memuat data dua kali", () => {
  it("login sukses memuat produk/kategori/overview TEPAT SEKALI", async () => {
    const counts: Record<string, number> = {};
    let authed = false;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      counts[url] = (counts[url] ?? 0) + 1;
      if (url === "/api/auth/me") {
        return authed
          ? { ok: true, status: 200, json: async () => ({ authed: true, email: "a@b.test" }) }
          : { ok: false, status: 401, json: async () => ({ authed: false }) };
      }
      if (url === "/api/auth/login") {
        if (init?.method === "POST") { authed = true; return { ok: true, status: 200, json: async () => ({ email: "a@b.test" }) }; }
        return { ok: true, status: 200, json: async () => ({ mode: "password" }) };
      }
      const body = url === "/api/products" ? { products: [] }
        : url.startsWith("/api/categories") ? { categories: [] } : {};
      return { ok: true, status: 200, json: async () => body };
    }));

    render(<ToastProvider><AdminPage /></ToastProvider>);
    await act(async () => {});

    fireEvent.change(screen.getByPlaceholderText(/admin@/i), { target: { value: "a@b.test" } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: "rahasia" } });
    fireEvent.click(screen.getByRole("button", { name: /masuk/i }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    await waitFor(() => expect(counts["/api/products"] ?? 0).toBeGreaterThan(0));
    for (const url of ["/api/products", "/api/categories?all=1", "/api/admin/overview"]) {
      expect(counts[url], `${url} dimuat ${counts[url]}x setelah login`).toBe(1);
    }
  });
});

describe("hanya 401 yang mengakhiri sesi admin", () => {
  // Toast dioper sebagai prop agar test dapat memicu SATU kali cek sesi ulang
  // (identitas berubah = effect checkAuth jalan lagi) — persis yang terjadi di
  // produksi sebelum context toast distabilkan.
  function AuthProbe({ toast }: { toast: { success: () => void; error: () => void } }) {
    const auth = useAdminAuth(toast);
    return <span data-testid="state">{auth.checkingAuth ? "checking" : auth.authed ? "authed" : "guest"}</span>;
  }

  it("502 dari /api/auth/me tidak mengeluarkan admin yang sesinya sah", async () => {
    let meCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      if (String(input) === "/api/auth/me") {
        meCalls += 1;
        return meCalls === 1
          ? { ok: true, status: 200, json: async () => ({ authed: true, email: "a@b.test" }) }
          : { ok: false, status: 502, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));

    const first = { success: () => {}, error: () => {} };
    const view = render(<ToastProvider><AuthProbe toast={first} /></ToastProvider>);
    await act(async () => {});
    expect(screen.getByTestId("state").textContent).toBe("authed");

    // Cek sesi ulang, kali ini backend membalas 502.
    const second = { success: () => {}, error: () => {} };
    view.rerender(<ToastProvider><AuthProbe toast={second} /></ToastProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(meCalls, "cek sesi kedua harus benar-benar terjadi").toBe(2);
    expect(screen.getByTestId("state").textContent, "502 bukan bukti sesi berakhir").toBe("authed");
  });

  it("401 tetap mengakhiri sesi", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      if (String(input) === "/api/auth/me") return { ok: false, status: 401, json: async () => ({ authed: false }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const toast = { success: () => {}, error: () => {} };
    render(<ToastProvider><AuthProbe toast={toast} /></ToastProvider>);
    await act(async () => {});
    expect(screen.getByTestId("state").textContent).toBe("guest");
  });
});
