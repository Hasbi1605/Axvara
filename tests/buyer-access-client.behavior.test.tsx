// @vitest-environment jsdom
//
// tests/buyer-access-client.behavior.test.tsx — A11: helper akses pembeli sisi
// klien (src/lib/order-access-client.ts, read-only milik PM).
// - Normalisasi kode (spasi/dash/case, O→0, I/L→1) + format tampilan.
// - Penyimpanan HANYA sessionStorage per kode (tab-session); KONTEN akses
//   TIDAK PERNAH di localStorage/riwayat (history scrub: entri akses → wa
//   kosong; kontak legacy tetap tersimpan).
// - Fragment #access= dikonsumsi sekali lalu di-strip dari URL (tidak bocor
//   ke query/log/Referer); fallback sessionStorage bila tanpa fragment.
// - Header verifikasi memakai x-order-access-code (bukan query/body).
// - Transport kapabilitas GET /credentials memakai header
//   x-credential-token, TANPA token di query.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OrderAccessNotice } from "@/components/storefront/OrderAccessNotice";
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params, usePathname: () => "/lacak-pesanan", useRouter: () => ({ push: vi.fn() }) }));
import LacakPesananClient from "@/app/(shop)/lacak-pesanan/lacak-pesanan-client";
import {
  orderAccessHeaders,
  orderCheckoutPath,
  readOrderAccessCode,
  rememberOrderAccessCode,
} from "@/lib/order-access-client";
import { formatOrderAccessCode, normalizeOrderAccessCode } from "@/lib/order-access-format";

const CODE = "AXV-20261027-ABCD1234";
// 26 char Crockford-valid: digits + A-Z tanpa I/L/O.
const RAW = "71111-22222-33333-44444-555556";
const FORMATTED = "71111-22222-33333-44444-555556";

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/lacak-pesanan");
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe("normalisasi + format kode akses", () => {
  it("menerima lowercase/spasi/dash dan menolak nilai pendek", () => {
    expect(normalizeOrderAccessCode(" 71111 22222-33333 44444 555556 ")).toHaveLength(26);
    expect(formatOrderAccessCode(RAW.toLowerCase())).toBe(FORMATTED);
    expect(normalizeOrderAccessCode("ABC")).toBe("");
    expect(normalizeOrderAccessCode("")).toBe("");
  });

  it("huruf ambigu O/I/L dinormalisasi (O→0, I/L→1)", () => {
    const withAmbiguous = `7O111-22222-33333-44444-55555${"I"}`;
    const normalized = normalizeOrderAccessCode(withAmbiguous);
    expect(normalized).not.toContain("O");
    expect(normalized).toHaveLength(26);
    expect(formatOrderAccessCode(withAmbiguous)).toBe("70111-22222-33333-44444-555551");
  });

  it("menolak input non-kode walau panjang mirip (karakter di luar alfabet)", () => {
    expect(normalizeOrderAccessCode("U".repeat(26))).toBe("");
    expect(formatOrderAccessCode("!".repeat(26))).toBe("");
  });
});

describe("penyimpanan session-only per kode", () => {
  it("remember menyimpan dengan format tampilan; read mengembalikan format yang sama", () => {
    expect(rememberOrderAccessCode(CODE, RAW.toLowerCase().replace(/-/g, " "))).toBe(true);
    expect(sessionStorage.getItem(`axvara-order-access:${CODE}`)).toBe(FORMATTED);
    expect(readOrderAccessCode(CODE)).toBe(FORMATTED);
  });

  it("menolak nilai invalid tanpa menulis storage", () => {
    expect(rememberOrderAccessCode(CODE, "bukan-kode")).toBe(false);
    expect(sessionStorage.getItem(`axvara-order-access:${CODE}`)).toBeNull();
    expect(readOrderAccessCode(CODE)).toBe("");
  });

  it("kunci per kode: kode lain tidak ikut terbaca", () => {
    expect(rememberOrderAccessCode(CODE, RAW)).toBe(true);
    expect(readOrderAccessCode("AXV-20261027-XXXX0000")).toBe("");
  });

  it("kontak legacy (WA/email) TIDAK disimpan sebagai kode akses", () => {
    expect(rememberOrderAccessCode(CODE, "081234567890")).toBe(false);
    expect(rememberOrderAccessCode(CODE, "rani.putri@gmail.com")).toBe(false);
    expect(sessionStorage.getItem(`axvara-order-access:${CODE}`)).toBeNull();
  });
});

describe("fragment #access=: konsumsi sekali + strip URL", () => {
  it("fragment valid dipakai, diingat ke session, lalu dihapus dari URL", () => {
    window.history.replaceState({}, "", `/pesanan/${CODE}#access=${encodeURIComponent(RAW)}`);
    expect(readOrderAccessCode(CODE)).toBe(FORMATTED);
    expect(sessionStorage.getItem(`axvara-order-access:${CODE}`)).toBe(FORMATTED);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe(`/pesanan/${CODE}`);
  });

  it("fragment invalid diabaikan tanpa mengubah session", () => {
    window.history.replaceState({}, "", `/pesanan/${CODE}#access=bukan-kode`);
    expect(readOrderAccessCode(CODE)).toBe("");
    expect(sessionStorage.getItem(`axvara-order-access:${CODE}`)).toBeNull();
  });

  it("tanpa fragment memakai session yang sudah tersimpan", () => {
    expect(rememberOrderAccessCode(CODE, RAW)).toBe(true);
    window.history.replaceState({}, "", `/pesanan/${CODE}`);
    expect(readOrderAccessCode(CODE)).toBe(FORMATTED);
  });
});

describe("header verifikasi + path checkout tanpa bocor query", () => {
  it("orderAccessHeaders memakai x-order-access-code dari session", () => {
    expect(rememberOrderAccessCode(CODE, RAW)).toBe(true);
    expect(orderAccessHeaders(CODE)).toEqual({ "x-order-access-code": FORMATTED });
  });

  it("orderAccessHeaders memakai nilai eksplisit bila diberikan", () => {
    expect(orderAccessHeaders(CODE, RAW)).toEqual({ "x-order-access-code": FORMATTED });
  });

  it("tanpa kode tersimpan: header kosong (bukan query/body)", () => {
    expect(orderAccessHeaders(CODE)).toEqual({});
  });

  it("orderCheckoutPath tidak menambah query bila session sudah ada", () => {
    expect(rememberOrderAccessCode(CODE, RAW)).toBe(true);
    const path = `/pedia/pesanan/${CODE}`;
    expect(orderCheckoutPath(path, CODE, RAW)).toBe(path);
    expect(orderCheckoutPath(path, CODE, RAW)).not.toContain("access=");
    expect(orderCheckoutPath(path, CODE, RAW)).not.toContain("?");
  });

  it("orderCheckoutPath memakai fragment fallback hanya bila session tak bisa ditulis", () => {
    const path = `/pedia/pesanan/${CODE}`;
    vi.stubGlobal("sessionStorage", { setItem: () => { throw new Error("storage blocked"); }, getItem: () => null, removeItem: () => {}, clear: () => {} });
    const out = orderCheckoutPath(path, CODE, RAW);
    expect(out).toBe(`${path}#access=${encodeURIComponent(FORMATTED)}`);
    window.history.replaceState({}, "", out);
    expect(readOrderAccessCode(CODE)).toBe(FORMATTED);
    expect(window.location.hash).toBe("");
  });
});

describe("salin terlihat + tidak bocor ke riwayat", () => {
  it("copies the visible code and explains how to copy manually when clipboard permission fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<OrderAccessNotice accessCode={FORMATTED} />);
    fireEvent.click(screen.getByRole("button", { name: "Salin kode akses" }));
    await screen.findByRole("button", { name: "Tersalin" });
    expect(writeText).toHaveBeenCalledWith(FORMATTED);
    writeText.mockRejectedValueOnce(new Error("permission denied"));
    fireEvent.click(screen.getByRole("button", { name: "Tersalin" }));
    expect((await screen.findByRole("alert")).textContent).toContain("salin manual");
  });

  it("tracking hydration scrubs access codes from persisted history and leaves legacy contacts usable", async () => {
    localStorage.setItem("axvara-track-recent", JSON.stringify([{ code: CODE, wa: RAW, savedAt: Date.now() }, { code: "AXV-20261027-ABCD1235", wa: "buyer@example.test", savedAt: Date.now() }]));
    render(<LacakPesananClient />);
    await waitFor(() => expect(localStorage.getItem("axvara-track-recent")).not.toContain(RAW));
    expect(localStorage.getItem("axvara-track-recent")).toContain("buyer@example.test");
  });

  it("successful tracking stores the code in session only and omits it from recent device history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ order: { code: CODE, items: [], status: "dibatalkan", subtotal: 0 } })));
    render(<LacakPesananClient />);
    fireEvent.change(screen.getByLabelText("Kode pesanan *"), { target: { value: CODE } });
    fireEvent.change(screen.getByLabelText("Kode akses pesanan *"), { target: { value: RAW } });
    fireEvent.submit(screen.getByRole("form", { name: "Formulir lacak pesanan" }));
    await waitFor(() => expect(sessionStorage.getItem(`axvara-order-access:${CODE}`)).toBe(FORMATTED));
    expect(localStorage.getItem("axvara-track-recent")).not.toContain(RAW);
    expect(window.location.href).not.toContain(RAW);
  });
});
