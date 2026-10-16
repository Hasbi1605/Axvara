// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PediaTrackPage from "@/app/pedia/lacak/page";
import { SITE } from "@/lib/site";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigation.push }) }));
const CODE = "AXP-20261016-AB12CD34";
const CONTACT = "customer@example.com";
const fetchMock = vi.fn();
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function fill(code = CODE, contact = CONTACT) {
  fireEvent.change(screen.getByLabelText("Kode pesanan *"), { target: { value: code } });
  fireEvent.change(screen.getByLabelText("No. WA atau email checkout *"), { target: { value: contact } });
}
function submit() { fireEvent.submit(screen.getByRole("form", { name: "Formulir lacak pesanan" })); }
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/pedia/lacak");
  navigation.push.mockClear(); fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Pedia tracking", () => {
  it("prefills a canonical query code without looking up or trusting a contact in the URL", () => {
    window.history.replaceState({}, "", "/pedia/lacak?code=axp-20261016-ab12cd34&contact=customer@example.com");
    render(<PediaTrackPage />);
    expect((screen.getByLabelText("Kode pesanan *") as HTMLInputElement).value).toBe(CODE);
    expect((screen.getByLabelText("No. WA atau email checkout *") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Lacak Pesanan" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cek status pesananmu");
    expect(screen.getByRole("link", { name: "WA Admin" }).getAttribute("href")).toContain(SITE.webUrl + "/wa?");
    expect(screen.getByRole("region", { name: "Bantuan lacak pesanan" }).querySelectorAll("details")).toHaveLength(4);
  });

  it("rejects a Market code and invalid contact before network requests", () => {
    render(<PediaTrackPage />);
    fill("AXV-20261016-AB12CD34", "invalid"); submit();
    expect(screen.getByLabelText("Kode pesanan *").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("No. WA atau email checkout *").getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
    fill(CODE, "0812 3456-7890");
    expect((screen.getByRole("button", { name: "Lacak Pesanan" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits one normalized lookup, saves only success, and opens the Pedia status page", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    render(<PediaTrackPage />);
    fill(" axp-20261016-ab12cd34 ", " customer@example.com "); submit(); submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: CODE, contact: CONTACT });
    expect((screen.getByLabelText("Kode pesanan *") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Sedang memeriksa");
    expect(localStorage.getItem("axp-track-recent")).toBeNull();
    await act(async () => { resolve(response({ order: { code: CODE } })); });
    expect(navigation.push).toHaveBeenCalledWith("/pedia/pesanan/" + CODE);
    expect(JSON.parse(localStorage.getItem("axp-track-recent")!)).toEqual([{ code: CODE, contact: CONTACT }]);
  });

  it("shows a lookup error, does not save it, and permits a retry", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "Kode atau kontak tidak cocok." }, 404));
    render(<PediaTrackPage />); fill(); submit();
    expect((await screen.findByRole("alert")).textContent).toBe("Kode atau kontak tidak cocok.");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(localStorage.getItem("axp-track-recent")).toBeNull();
    fetchMock.mockResolvedValueOnce(response({ order: { code: CODE } }));
    submit();
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/pedia/pesanan/" + CODE));
  });

  it("recovers from network failure and malformed success without navigating", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<PediaTrackPage />); fill(); submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Periksa internet");
    fetchMock.mockResolvedValueOnce(response({ order: { code: "AXP-20261016-XXXXXXXX" } }));
    submit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Data pesanan belum dapat dimuat"));
    expect(navigation.push).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Lacak Pesanan" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("filters invalid history and masks contacts, with removable recent entries", () => {
    localStorage.setItem("axp-track-recent", JSON.stringify([null, { code: "../../admin", contact: CONTACT }, { code: CODE, contact: CONTACT }, { code: CODE, contact: "other@example.com" }, { code: "AXP-20261016-ZZ12CD34", contact: {} }]));
    render(<PediaTrackPage />);
    const recent = screen.getByRole("region", { name: "Terakhir dilacak" });
    expect(within(recent).getByText("Email c***@example.com")).toBeTruthy();
    expect(recent.textContent).not.toContain(CONTACT);
    expect(recent.textContent).not.toContain("../../admin");
    expect(within(recent).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(within(recent).getByRole("button", { name: "Hapus riwayat " + CODE }));
    expect(screen.queryByRole("region", { name: "Terakhir dilacak" })).toBeNull();
    expect(localStorage.getItem("axp-track-recent")).toBe("[]");
  });

  it("uses recent contact for a verified lookup and caps deduplicated history at five", async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ code: "AXP-20261016-0000000" + i, contact: "081234567890" }));
    localStorage.setItem("axp-track-recent", JSON.stringify(entries));
    render(<PediaTrackPage />);
    const recent = screen.getByRole("region", { name: "Terakhir dilacak" });
    expect(within(recent).getAllByRole("button")).toHaveLength(10);
    fetchMock.mockResolvedValueOnce(response({ order: { code: entries[1].code } }));
    fireEvent.click(within(recent).getByRole("button", { name: /AXP-20261016-00000001 WA/ }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(entries[1]);
    const stored = JSON.parse(localStorage.getItem("axp-track-recent")!);
    expect(stored).toHaveLength(5);
    expect(stored[0]).toEqual(entries[1]);
  });

  it("keeps device orders collapsed, sanitizes links, and can hide an entry", () => {
    localStorage.setItem("axp-orders", JSON.stringify([{ code: CODE.toLowerCase(), name: "Followers Instagram" }, { code: CODE, name: "Duplicate" }, { code: "javascript:alert(1)", name: "Unsafe" }, { code: "AXP-20261016-ZZ12CD34", name: {} }]));
    render(<PediaTrackPage />);
    const summary = screen.getByText("Pesanan di perangkat ini");
    const details = summary.closest("details")!;
    expect(details.hasAttribute("open")).toBe(false);
    fireEvent.click(summary);
    const region = screen.getByRole("region", { name: "Pesanan di perangkat ini" });
    expect(within(region).getAllByRole("link")).toHaveLength(1);
    expect(within(region).getByRole("link").getAttribute("href")).toBe("/pedia/pesanan/" + CODE);
    fireEvent.click(within(region).getByRole("button", { name: "Sembunyikan " + CODE + " dari perangkat ini" }));
    expect(localStorage.getItem("axp-orders")).toBe("[]");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles malformed and unavailable browser storage without blocking lookup", async () => {
    localStorage.setItem("axp-orders", '{"not":"an array"}');
    localStorage.setItem("axp-track-recent", "bad json");
    render(<PediaTrackPage />);
    expect(screen.queryByRole("region", { name: "Terakhir dilacak" })).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    fetchMock.mockResolvedValueOnce(response({ order: { code: CODE } }));
    fill(); submit();
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/pedia/pesanan/" + CODE));
  });

  it("aborts an in-flight request when leaving the tracking page", async () => {
    let signal!: AbortSignal;
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const view = render(<PediaTrackPage />); fill(); submit();
    await act(async () => { view.unmount(); });
    expect(signal.aborted).toBe(true);
    expect(navigation.push).not.toHaveBeenCalled();
    expect(localStorage.getItem("axp-track-recent")).toBeNull();
  });
});
