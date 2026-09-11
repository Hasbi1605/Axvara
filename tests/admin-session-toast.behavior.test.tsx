// @vitest-environment jsdom
//
// tests/admin-session-toast.behavior.test.tsx — Regresi bug laporan 2026-09-11:
// buka /admin saat sesi habis menumpuk BELASAN toast merah yang sama
// ("Sesi habis karena 2 jam tidak aktif...") sampai menutupi layar.
//
// Akar: setiap render ulang / remount / StrictMode memanggil checkAuth lagi,
// dan setiap panggilan 401 mendorong toast baru — tidak ada yang menandai
// bahwa sesi yang SAMA sudah diberitahukan.
//
// Kontrak: satu sesi yang berakhir memberitahu TEPAT SEKALI, berapa pun
// checkAuth dipanggil ulang; sesi baru (login sukses) membuka lagi guard.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import AdminPage from "@/app/admin/page";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubExpiredSession() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/auth/me") {
        return {
          ok: false,
          status: 401,
          json: async () => ({ authed: false, reason: "idle_timeout" }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

describe("admin session-ended toast — tepat sekali", () => {
  it("render ulang berkali-kali hanya menghasilkan SATU toast", async () => {
    stubExpiredSession();
    const view = render(
      <ToastProvider>
        <AdminPage />
      </ToastProvider>,
    );
    await act(async () => {});
    // Simulasi rentetan remount/render ulang seperti di laporan.
    for (let i = 0; i < 5; i++) {
      view.rerender(
        <ToastProvider>
          <AdminPage />
        </ToastProvider>,
      );
      await act(async () => {});
    }
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Masuk Panel Admin/ })).toBeTruthy();
    });
    const toasts = screen.getAllByText(/Sesi habis karena 2 jam tidak aktif/);
    expect(toasts).toHaveLength(1);
  });
});
