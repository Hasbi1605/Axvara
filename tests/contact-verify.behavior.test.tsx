// @vitest-environment jsdom
//
// tests/contact-verify.behavior.test.tsx — UI verifikasi No. WA ATAU email
// (2026-09-25): panel Detail Akun Digital dan form Lacak Pesanan.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WrCredentialsPanel, checkoutContactKey } from "@/components/storefront/WrCredentialsPanel";

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  usePathname: () => "/lacak-pesanan",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import LacakPesananClient from "@/app/lacak-pesanan/lacak-pesanan-client";

const CODE = "AXV-20260925-CONTACT1";
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); nav.params = new URLSearchParams(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubCredentials(ok = true, capabilityToken: string | null = "a".repeat(64)) {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return ok
      ? { ok: true, status: 200, json: async () => ({ ok: true, credentials: [{ label: "Canva Pro — Invite 1 Bulan", details: "Link undangan: https://canva.com/join/ABC", completed_at: null }], capability_token: capabilityToken }) }
      : { ok: false, status: 403, json: async () => ({ error: "verification_failed" }) };
  }));
  return calls;
}

/** Token tersimpan dijawab `tokenStatus`; verifikasi kontak (POST) berhasil tanpa token baru. */
function stubTokenThenContact(tokenStatus: number) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (!init?.method) return { ok: false, status: tokenStatus, json: async () => ({ error: tokenStatus === 403 ? "invalid_token" : "rate_limited" }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, credentials: [{ details: "Link undangan: https://canva.com/join/ABC", completed_at: null }], capability_token: null }) };
  }));
  return calls;
}

describe("panel Detail Akun Digital", () => {
  it("kontak dari checkout di tab yang sama membuka otomatis dan TETAP tersimpan selama tab terbuka", async () => {
    sessionStorage.setItem(checkoutContactKey(CODE), "081234567890");
    const calls = stubCredentials();
    render(<WrCredentialsPanel code={CODE} />);
    await waitFor(() => expect(screen.getByText("Link undangan: https://canva.com/join/ABC")).toBeTruthy());
    expect(calls[0]).toEqual({ url: `/api/orders/${CODE}/credentials`, body: { contact: "081234567890" } });
    expect(sessionStorage.getItem(checkoutContactKey(CODE))).toBe("081234567890");
    expect(sessionStorage.getItem(`wr-cred-token:${CODE}`)).toBe("a".repeat(64));
  });

  // Laporan owner 2026-09-25: halaman dimuat ulang saat verifikasi otomatis
  // pertama belum dijawab → token tidak pernah tersimpan dan kontak sudah
  // dihapus → form kosong. Server juga tidak menerbitkan token kedua.
  it("muat ulang saat verifikasi pertama belum dijawab → tetap membuka otomatis, bukan form kosong", async () => {
    sessionStorage.setItem(checkoutContactKey(CODE), "081234567890");
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<WrCredentialsPanel code={CODE} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Memeriksa…" })).toBeTruthy());
    cleanup();
    const calls = stubCredentials(true, null);
    render(<WrCredentialsPanel code={CODE} />);
    await waitFor(() => expect(screen.getByText("Link undangan: https://canva.com/join/ABC")).toBeTruthy());
    expect(calls).toEqual([{ url: `/api/orders/${CODE}/credentials`, body: { contact: "081234567890" } }]);
    expect(sessionStorage.getItem(checkoutContactKey(CODE))).toBe("081234567890");
  });

  it("token ditolak server (403) → token dibuang lalu kontak checkout dipakai", async () => {
    sessionStorage.setItem(`wr-cred-token:${CODE}`, "b".repeat(64));
    sessionStorage.setItem(checkoutContactKey(CODE), "081234567890");
    const calls = stubTokenThenContact(403);
    render(<WrCredentialsPanel code={CODE} />);
    await waitFor(() => expect(screen.getByText("Link undangan: https://canva.com/join/ABC")).toBeTruthy());
    expect(calls).toEqual([`GET /api/orders/${CODE}/credentials?token=${"b".repeat(64)}`, `POST /api/orders/${CODE}/credentials`]);
    expect(sessionStorage.getItem(`wr-cred-token:${CODE}`)).toBeNull();
  });

  it("token gagal sementara (429) → token TIDAK dibuang, kontak checkout tetap dicoba", async () => {
    sessionStorage.setItem(`wr-cred-token:${CODE}`, "b".repeat(64));
    sessionStorage.setItem(checkoutContactKey(CODE), "081234567890");
    const calls = stubTokenThenContact(429);
    render(<WrCredentialsPanel code={CODE} />);
    await waitFor(() => expect(screen.getByText("Link undangan: https://canva.com/join/ABC")).toBeTruthy());
    expect(calls).toHaveLength(2);
    expect(sessionStorage.getItem(`wr-cred-token:${CODE}`)).toBe("b".repeat(64));
  });

  it("checkout menyimpan kontak dengan kunci yang sama, di sessionStorage (bukan localStorage)", () => {
    const checkout = fs.readFileSync("src/app/checkout/page.tsx", "utf8");
    expect(checkout).toContain("sessionStorage.setItem(checkoutContactKey(code), wa.trim())");
    expect(checkout).not.toMatch(/localStorage\.setItem\([^)]*checkoutContactKey/);
  });

  it("menerima email, menampilkan kontak terdaftar tersamar, dan pesan gagal yang menyebut keduanya", async () => {
    const calls = stubCredentials(false);
    render(<WrCredentialsPanel code={CODE} contactHint="62812****7890 · r***@gmail.com" />);
    expect(screen.getByText("Terdaftar: 62812****7890 · r***@gmail.com")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("No. WA atau email checkout"), { target: { value: " Rani@Gmail.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("No. WA atau email tidak cocok dengan data pesanan."));
    expect(calls[0].body).toEqual({ contact: "Rani@Gmail.com" });
  });
});

describe("form Lacak Pesanan", () => {
  it("email checkout diterima dan dikirim sebagai `contact`", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return { ok: false, status: 404, json: async () => ({ error: "Pesanan tidak ditemukan atau No. WA/email tidak cocok." }) };
    }));
    render(<LacakPesananClient />);
    fireEvent.change(screen.getByLabelText(/Kode pesanan/), { target: { value: CODE } });
    const contact = screen.getByLabelText(/No\. WA atau email checkout/) as HTMLInputElement;
    fireEvent.change(contact, { target: { value: "rani.putri@gmail.com" } });
    expect(contact.value).toBe("rani.putri@gmail.com");
    fireEvent.submit(contact.closest("form")!);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ code: CODE, contact: "rani.putri@gmail.com" });
  });

  it("isian yang bukan WA maupun email ditolak di form", () => {
    render(<LacakPesananClient />);
    const contact = screen.getByLabelText(/No\. WA atau email checkout/);
    fireEvent.change(contact, { target: { value: "rani@gmail" } });
    fireEvent.blur(contact);
    expect(screen.getByText("Isi No. WA (0812… / +62812…) atau email yang dipakai saat checkout.")).toBeTruthy();
  });

  it("tautan ?email= langsung melacak sekali", async () => {
    nav.params = new URLSearchParams({ code: CODE, email: "rani.putri@gmail.com" });
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return { ok: false, status: 404, json: async () => ({ error: "x" }) };
    }));
    render(<LacakPesananClient />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ code: CODE, contact: "rani.putri@gmail.com" });
  });
});
