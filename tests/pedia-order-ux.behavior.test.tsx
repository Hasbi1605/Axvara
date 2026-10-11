// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OrderClient } from "@/app/pedia/o/[slug]/order-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const product: PediaCatalogProduct = {
  slug: "followers-instagram", name: "Followers Instagram", platform: "instagram", metric: "followers", target_kind: "profile",
  tagline: "HYPE", packages: [100, 250, 500], step: 10, is_featured: 1, min_price: 2000,
  checklist: [{ id: "public", label: "Akun publik", help: "Jangan ubah username selama proses." }],
  tiers: [
    { id: 1, tier: "hemat", label_note: "Campuran", refill_days: 0, eta_start: "5 menit", eta_finish: "1 hari", prices: { "100": 2000 }, min_qty: 100, max_qty: 100 },
    { id: 2, tier: "standar", label_note: "Global", refill_days: 30, eta_start: "10 menit", eta_finish: "2 hari", prices: { "100": 3000, "250": 7000, "500": 12000 }, min_qty: 100, max_qty: 1000 },
  ],
};
const reply = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => reply({ quote_token: "signed-token", total: 7300, payable: 7300 }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(enabled = true, target = "https://instagram.com/customer") {
  return render(<OrderClient product={product} initialTarget={target} ordersEnabled={enabled} />);
}
function complete() {
  fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "081234567890" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Saya setuju/ }));
}
async function getQuote() {
  fireEvent.click(screen.getByRole("button", { name: "Periksa harga" }));
  await screen.findByText(/Harga terkonfirmasi:/);
}

describe("Pedia order UX", () => {
  it("groups the form into three sections with native radios and no hype or blanket guarantee", () => {
    mount();
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"))).toEqual(["pedia-package-heading", "pedia-target-heading", "pedia-contact-heading"]);
    expect(screen.getByRole("heading", { name: "1. Paket & jumlah" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2. Tujuan & persyaratan" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "3. Kontak & konfirmasi" })).toBeTruthy();
    expect(screen.getAllByRole("radio").every((r) => r.tagName === "INPUT")).toBe(true);
    expect(document.body.textContent).not.toMatch(/HYPE|Paling dipilih|Garansi/i);
    expect(document.body.textContent).toContain("Refill 30 hari, sesuai ketentuan");
    expect(document.body.textContent).toContain("Jumlah bebas belum tersedia");
    expect(screen.getAllByRole("button", { name: "Lanjut ke pembayaran" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("announces unavailable orders before the title, keeps package preview, omits all contact collection", () => {
    mount(false);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Pemesanan belum tersedia");
    expect(notice.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText("Nomor WhatsApp")).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Kode kredit")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "500" }));
    expect((screen.getByRole("radio", { name: "500" }) as HTMLInputElement).checked).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adjusts quantity to an available package on tier change and reports it", () => {
    mount();
    expect((screen.getByRole("radio", { name: "250" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /^hemat/i }));
    expect((screen.getByRole("radio", { name: "100" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "250" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Jumlah disesuaikan ke 100");
    expect(document.body.textContent).not.toContain("Rp0");
  });

  it.each(["https://tiktok.com/@buyer", "https://instagram.com/p/ABC", "not-a-link"])("rejects wrong platform/kind or unrecognized target %s before quote", (target) => {
    mount(true, target); complete();
    fireEvent.click(screen.getByRole("button", { name: "Periksa harga" }));
    expect(screen.getByRole("alert").textContent).toContain("link profil Instagram");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("pedia-target");
    expect(document.body.textContent).not.toContain("Format link sesuai:");
  });

  it("requires valid contact and requirements before quote with visible labels and inline errors", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "invalid" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bad-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Periksa harga" }));
    expect(screen.getAllByRole("alert")).toHaveLength(4);
    expect(screen.getByLabelText("Nomor WhatsApp").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses server price and credit, never submits an order while checking price", async () => {
    mount(); complete();
    fetchMock.mockResolvedValue(reply({ quote_token: "signed", total: 7300, payable: 6300 }));
    await getQuote();
    expect(screen.getByRole("status").textContent).toContain("Rp6.300");
    expect(document.body.textContent).toContain("Kredit digunakan");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pedia/quote");
  });

  it("ignores an obsolete delayed quote and prevents payment after quantity changes", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount(); complete();
    fireEvent.click(screen.getByRole("button", { name: "Periksa harga" }));
    expect(screen.getAllByRole("button", { name: "Lanjut ke pembayaran" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "500" }));
    await act(async () => { resolve(reply({ quote_token: "old", total: 1, payable: 1 })); });
    expect(screen.queryByText(/Harga terkonfirmasi:/)).toBeNull();
    expect(screen.queryByText("Rp1")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Lanjut ke pembayaran" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["Link profil Instagram", "Email", "Nomor WhatsApp", "Kode kredit"])("invalidates a ready quote when %s changes", async (label) => {
    mount(); complete(); await getQuote();
    fireEvent.change(screen.getByLabelText(label), { target: { value: label === "Email" ? "other@example.com" : "changed" } });
    expect(screen.queryByText(/Harga terkonfirmasi:/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Lanjut ke pembayaran" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("shows quote errors inline without an order request and allows retry", async () => {
    mount(); complete();
    fetchMock.mockResolvedValueOnce(reply({ message: "Layanan sedang tidak tersedia." }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Periksa harga" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Layanan sedang tidak tersedia");
    await getQuote();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates the confirmed quote on tier or requirements changes", async () => {
    mount(); complete(); await getQuote();
    fireEvent.click(screen.getByRole("radio", { name: /^hemat/i }));
    expect(screen.queryByText(/Harga terkonfirmasi:/)).toBeNull();
    await getQuote();
    fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
    expect(screen.queryByText(/Harga terkonfirmasi:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Periksa harga" }));
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /Akun publik/ }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires a fresh quote after a definitive order rejection", async () => {
    mount(); complete(); await getQuote();
    fetchMock.mockResolvedValueOnce(reply({ message: "Harga berubah. Periksa ulang." }, 409));
    fireEvent.click(screen.getAllByRole("button", { name: "Lanjut ke pembayaran" })[0]);
    expect((await screen.findByRole("alert")).textContent).toContain("Harga berubah");
    expect(screen.queryByText(/Harga terkonfirmasi:/)).toBeNull();
    expect((screen.getByLabelText("Email").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
    expect(screen.getAllByRole("button", { name: "Lanjut ke pembayaran" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("rejects malformed quote prices", async () => {
    mount(); complete(); fetchMock.mockResolvedValue(reply({ quote_token: "bad", total: 0, payable: -1 }));
    fireEvent.click(screen.getByRole("button", { name: "Periksa harga" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Respons harga tidak valid");
  });

  it("locks order inputs and blocks duplicate clicks, then retries an uncertain response with the same token", async () => {
    mount(); complete(); await getQuote();
    let reject!: (reason: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    const buttons = screen.getAllByRole("button", { name: "Lanjut ke pembayaran" });
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText("Email").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    await act(async () => { reject(new Error("network lost")); });
    expect((await screen.findByRole("alert")).textContent).toContain("data yang sama");
    fetchMock.mockResolvedValueOnce(reply({ error: "Unavailable" }, 503));
    fireEvent.click(screen.getAllByRole("button", { name: "Lanjut ke pembayaran" })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/pedia/orders");
  });

  it("does not submit an expired quote", async () => {
    mount(); complete(); await getQuote();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30 * 60_000);
    fireEvent.click(screen.getAllByRole("button", { name: "Lanjut ke pembayaran" })[0]);
    expect(screen.getByRole("alert").textContent).toContain("kedaluwarsa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
