// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderClient } from "@/app/pedia/o/[slug]/order-client";
import { PlatformPageClient } from "@/app/pedia/p/[platform]/platform-client";
import { ServiceChips, ServicePicker } from "@/components/pedia/ServicePicker";
import { ServiceInfoCard } from "@/components/pedia/ServiceInfoCard";
import { renderToStaticMarkup } from "react-dom/server";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { usePediaPrices } from "@/components/pedia/usePediaPrices";

vi.mock("@/components/pedia/usePediaPrices", () => ({ usePediaPrices: vi.fn(() => null) }));

const product: PediaCatalogProduct = {
  slug: "followers-instagram", name: "Followers Instagram", platform: "instagram", metric: "followers", target_kind: "profile",
  tagline: "Followers untuk profil publik", packages: [100, 250, 500], step: 10, is_featured: 1, min_price: 2000, min_order_rp: 1000,
  image: "/r2/products/pedia-platform-instagram.webp",
  checklist: [{ id: "public", label: "Akun publik", help: "Jangan ubah username selama proses." }],
  tiers: [
    { id: 1, tier: "hemat", label_note: "Campuran", public_name: "Followers Global Ekonomis", region: "global", quality: "ekonomis", drop_risk: "sedang", refill_days: 0, eta_start: "5 menit", eta_finish: "1 hari", prices: { "100": 2000 }, price_per_1k: 20000, quick_quantities: [100], min_qty: 100, max_qty: 100 },
    { id: 2, tier: "standar", label_note: "Global", public_name: "Followers Indonesia Stabil", region: "indonesia", quality: "standar", drop_risk: "rendah", recommended: true, refill_days: 30, eta_start: "10 menit", eta_finish: "2 hari", prices: { "100": 3000, "250": 7000, "500": 12000 }, price_per_1k: 28000, quick_quantities: [100, 250, 500], min_qty: 100, max_qty: 1000 },
  ],
};
const reply = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(usePediaPrices).mockReturnValue(null);
  fetchMock = vi.fn(async () => reply({ quote_token: "signed-token", total: 7300, payable: 7300 }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(enabled = true, target = "https://instagram.com/customer") {
  return render(<OrderClient product={product} initialTarget={target} ordersEnabled={enabled} />);
}
function select() {
  fireEvent.click(screen.getByRole("radio", { name: /Indonesia Stabil/i }));
  fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "250" } });
}
function toTarget() { fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: isi target" })[0]); }
function next() {
  if (screen.queryAllByRole("button", { name: "Lanjut: isi target" }).length) toTarget();
  if (screen.queryAllByRole("button", { name: "Lanjut: kontak" }).length) fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: kontak" })[0]);
}
function back() { fireEvent.click(screen.getByRole("button", { name: "Langkah 1: Layanan" })); }
function complete() {
  select(); toTarget();
  fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
  next();
  if (!screen.queryByLabelText("Nomor WhatsApp")) return;
  fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "081234567890" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Saya setuju/ }));
}
function proceed() { fireEvent.click(screen.getAllByRole("button", { name: /^(Lanjut ke pembayaran|Coba lagi|Lanjut: isi target|Lanjut: kontak)$/ })[0]); }
function consent() { fireEvent.click(screen.getAllByRole("button", { name: "Setujui & lanjut ke pembayaran" })[0]); }
async function getQuote() {
  proceed();
  await screen.findAllByText(/Total pembayaran/);
}

describe("Pedia order UX", () => {
  it("announces price failure and retries without resetting quantity or service", () => {
    const retry = vi.fn();
    vi.mocked(usePediaPrices).mockReturnValue({ key: "followers-instagram:250", prices: {}, failed: true, retry });
    mount(); select();
    const button = screen.getByRole("button", { name: "Coba muat harga lagi" });
    expect(button.closest('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("250");
    expect((screen.getByRole("radio", { name: /Indonesia Stabil/i }) as HTMLInputElement).checked).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("renders saved product copy as escaped text with preserved lines, including SSR", () => {
    const description = 'Followers untuk profil Instagram publik.\nRefill sesuai paket.\n<script>alert("test")</script>';
    const described = { ...product, description_md: description };
    const { container } = render(<OrderClient product={described} initialTarget="https://instagram.com/customer" ordersEnabled />);
    // 2026-10-12 (owner): tagline tidak dirender di detail — judul langsung
    // ke deskripsi kurasi admin.
    expect(screen.queryByText(product.tagline!)).toBeNull();
    const copy = screen.getByText(/Followers untuk profil Instagram publik\./);
    expect(copy.textContent).toBe(description);
    expect(copy.className).toContain("whitespace-pre-line");
    expect(container.querySelector("script")).toBeNull();
    const html = renderToStaticMarkup(<OrderClient product={described} initialTarget="" ordersEnabled={false} />);
    expect(html).not.toContain(product.tagline);
    expect(html).toContain('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;');
    expect(html).not.toContain("<script>");
    select(); toTarget();
    expect(document.getElementById("pedia-target-help")?.textContent).toBe("Contoh: instagram.com/username. Akun harus publik.");
    expect(screen.getByText("Format link sesuai")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Link profil Instagram/), { target: { value: "bukan link" } });
    expect(screen.getByText("Format link tidak sesuai")).toBeTruthy();
    expect(screen.queryByText("Format link sesuai")).toBeNull();
  });

  it("omits empty product copy and supports older fixtures without a description", () => {
    const { container } = render(<OrderClient product={{ ...product, tagline: "  ", description_md: "\n  " }} initialTarget="" ordersEnabled={false} />);
    expect(container.querySelector("h1")?.nextElementSibling?.tagName).toBe("OL");
    expect(document.body.textContent).not.toContain("Pilih paket dan jumlah, masukkan link tujuan");
  });
  it("starts without selected tier, quantity or total, with honest per-1k benchmarks", () => {
    mount();
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"))).toEqual(["pedia-stage-heading"]);
    expect(screen.getAllByRole("radio").every((r) => r.tagName === "INPUT" && !(r as HTMLInputElement).checked)).toBe(true);
    // Acuan per 1.000 yang jujur (bukan total minimum yang disamarkan setara).
    const benchmark = screen.getByRole("radio", { name: /Indonesia Stabil/ }).closest("label")!;
    expect(benchmark.textContent).toContain("Rp28.000");
    expect(benchmark.textContent).toContain("per 1.000");
    const minimum = screen.getByRole("radio", { name: /Global Ekonomis/ }).closest("label")!;
    expect(minimum.textContent).not.toContain("Rp20.000");
    expect(minimum.textContent).toContain("minimum 100");
    expect(document.body.textContent).not.toContain("Harga acuan ditampilkan per layanan");
    expect(document.body.textContent).not.toMatch(/HYPE|Paling dipilih|Rp0|Paket tidak tersedia/i);
    expect(document.body.textContent).not.toContain("Belum dipilih");
    expect(screen.getByText("Isi jumlah dan pilih layanan untuk melihat rincian pesananmu.")).toBeTruthy();
    // Jumlah bisa diisi SEBELUM layanan dipilih; contoh hanya angka valid produk.
    const qtyInput = screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement;
    expect(qtyInput.disabled).toBe(false);
    expect(qtyInput.getAttribute("placeholder")).toContain("Contoh:");
    expect(document.body.textContent).not.toContain("Isi jumlah dulu");
    expect(document.body.textContent).toContain("Pilih layanan untuk melihat batas jumlah per pesanan.");
    // 2026-11-01 (owner): istilah SMM dipertahankan.
    expect(screen.getByText("Refill 30 Days").className).toContain("text-[#00E5FF]");
    expect(screen.getByText("No Refill", { selector: "span" }).className).toContain("text-white/75");
    expect(screen.queryByRole("button", { name: "Periksa harga" })).toBeNull();
    proceed();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getAllByRole("radio")[0]);
  });

  it("restores the original needs heading without decoration and keeps honest selected-service bounds", () => {
    mount();
    const heading = screen.getByRole("heading", { name: "Apa yang ingin ditingkatkan?" });
    expect(heading.className).toContain("text-2xl");
    expect(heading.className).toContain("font-bold");
    expect(heading.querySelector("[aria-hidden]")).toBeNull();
    expect(document.body.textContent).not.toContain("Isi jumlah dulu");
    expect(document.body.textContent).not.toContain("Batas tiap layanan berbeda");
    select();
    expect(screen.getByText("Layanan terpilih menerima 100–1.000 per pesanan. Kelipatan 10.")).toBeTruthy();
  });

  it("compacts thousands in quantity presets while preserving exact numeric quantities", () => {
    const quantities = [100, 1000, 2000, 2500, 3000];
    const presetProduct = { ...product, tiers: [{ ...product.tiers[1], quick_quantities: quantities, max_qty: 5000 }] };
    render(<OrderClient product={presetProduct} initialTarget="" ordersEnabled />);
    const presets = within(document.getElementById("pedia-quantity")!);
    expect(presets.getAllByRole("button").map((button) => button.textContent)).toEqual(["100", "1k", "2k", "2.5k", "3k"]);
    for (const [index, label] of ["100", "1k", "2k", "2.5k", "3k"].entries()) {
      const button = presets.getByRole("button", { name: label });
      fireEvent.click(button);
      expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe(String(quantities[index]));
      expect(button.getAttribute("aria-pressed")).toBe("true");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts quantity before any tier is chosen and keeps it when a tier is picked", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "250" } });
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("250");
    // Harga dibandingkan pada jumlah yang sama; layanan tak cocok ditandai.
    expect(screen.getByRole("radio", { name: /Indonesia Stabil/i }).closest("label")!.textContent).toContain("untuk 250");
    expect(screen.getByRole("radio", { name: /Global Ekonomis/i }).closest("label")!.textContent).toContain("Jumlah tidak tersedia");
    fireEvent.click(screen.getByRole("radio", { name: /Indonesia Stabil/i }));
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("250");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps decimal quantity visible and rejects it instead of silently changing it", () => {
    mount(); select();
    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "1.5" } });
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("1.5");
    next();
    expect(screen.queryByLabelText("Nomor WhatsApp")).toBeNull();
    expect(screen.getAllByRole("alert").some(a => a.textContent?.includes("Isi jumlah"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps closed status near disabled CTA, package preview and no contact collection", () => {
    mount(false);
    expect(document.body.textContent).toContain("Pemesanan belum tersedia");
    expect(screen.queryByLabelText("Nomor WhatsApp")).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Kode kredit")).toBeNull();
    select();
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("250");
    const buttons = screen.getAllByRole("button", { name: "Lanjut: isi target" });
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    proceed();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("jumlah bebas divalidasi terhadap min–max layanan terpilih tanpa menghapus jumlah (bukan paket mati)", () => {
    mount(); select();

    const incompatible = screen.getByRole("radio", { name: /Global Ekonomis/i }) as HTMLInputElement;
    expect(incompatible.disabled).toBe(true);
    fireEvent.click(incompatible);
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("250");
    expect((screen.getByRole("radio", { name: /Indonesia Stabil/i }) as HTMLInputElement).checked).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    // A chosen service can become incompatible when the buyer edits quantity.

    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "1100" } });
    proceed();
    expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("Jumlah tetap 1.100"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses distinct semantic icons per metric (followers/likes/saves/shares/traffic/forks/quotes)", async () => {
    const { pediaMetricIcon } = await import("@/components/pedia/MetricIcon");
    const icons = {
      followers: pediaMetricIcon("followers"),
      likes: pediaMetricIcon("likes"),
      saves: pediaMetricIcon("saves"),
      shares: pediaMetricIcon("shares"),
      traffic: pediaMetricIcon("traffic"),
      forks: pediaMetricIcon("forks"),
      quotes: pediaMetricIcon("quotes"),
    };
    const names = Object.fromEntries(Object.entries(icons).map(([k, v]) => [k, (v as { displayName?: string; name?: string }).displayName ?? (v as { name?: string }).name]));
    // Semua metrik yang diminta harus berbeda satu sama lain.
    expect(new Set(Object.values(names)).size).toBe(7);
    expect(names.followers).toMatch(/UserPlus/i);
    expect(names.likes).toMatch(/Heart/i);
    expect(names.saves).toMatch(/Bookmark/i);
    expect(names.shares).toMatch(/Share2/i);
    expect(names.traffic).toMatch(/Globe/i);
    expect(names.forks).toMatch(/GitFork/i);
    expect(names.quotes).toMatch(/MessageSquareQuote/i);
  });

  it.each(["https://tiktok.com/@buyer", "https://instagram.com/p/ABC", "not-a-link"])("rejects wrong platform/kind or unrecognized target %s before quote", (target) => {
    mount(true, target); complete(); proceed();
    expect(screen.getByRole("alert").textContent).toContain("link profil Instagram");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("pedia-target");
    expect(document.body.textContent).not.toContain("Format link sesuai:");
  });

  it("requires valid contact and all requirements before quote", () => {
    mount(); select(); toTarget();
    fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ })); next();
    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "invalid" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bad-email" } });
    proceed();
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(screen.getByLabelText("Nomor WhatsApp").getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("quotes then creates the order in one action when price is unchanged", async () => {
    mount(); complete();
    fetchMock.mockResolvedValueOnce(reply({ quote_token: "same", total: 7000, payable: 7000 }));
    fetchMock.mockRejectedValueOnce(new Error("fixture stops navigation"));
    proceed();
    await screen.findByRole("alert");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/pedia/quote", "/api/pedia/orders"]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ customer_wa: "081234567890", customer_email: "buyer@example.com", quote_token: "same" });
    expect(screen.queryAllByRole("button", { name: /^Kembali ke langkah/ })).toHaveLength(0);
  });

  it("requires explicit changed-price consent before creating an order", async () => {
    mount(); complete();
    fetchMock.mockResolvedValueOnce(reply({ quote_token: "signed", total: 7300, payable: 7300 }));
    await getQuote();
    expect(screen.getAllByRole("status").some((s) => s.textContent?.includes("Harga berubah dari Rp7.000 menjadi Rp7.300"))).toBe(true);
    expect(document.body.textContent).toContain("Rp7.300");
    expect(document.body.textContent).not.toContain("Kredit digunakan");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new Error("fixture"));
    consent();
    await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checkout has no credit input and quotes the full amount", async () => {
    mount(); complete();
    expect(screen.queryByLabelText("Kode kredit")).toBeNull();
    await getQuote();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.credit_code).toBeUndefined();
  });

  it("ignores an obsolete delayed quote and prevents duplicate quote requests", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount(); complete();
    const buttons = screen.getAllByRole("button", { name: "Lanjut ke pembayaran" });
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    back();
    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "500" } });
    await act(async () => { resolve(reply({ quote_token: "old", total: 1, payable: 1 })); });
    expect(screen.queryByText(/Total pembayaran/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["Link profil Instagram", "Email", "Nomor WhatsApp"])("invalidates consent when %s changes", async (label) => {
    mount(); complete(); await getQuote();
    if (label === "Link profil Instagram") fireEvent.click(screen.getByRole("button", { name: "Langkah 2: Target" }));
    fireEvent.change(screen.getByLabelText(label), { target: { value: label === "Email" ? "other@example.com" : "changed" } });
    expect(screen.queryByText(/Total pembayaran/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Setujui & lanjut ke pembayaran" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows quote errors inline without creating an order and allows retry", async () => {
    mount(); complete();
    fetchMock.mockResolvedValueOnce(reply({ message: "Layanan sedang tidak tersedia." }, 409));
    proceed();
    expect((await screen.findByRole("alert")).textContent).toContain("Layanan sedang tidak tersedia");
    await getQuote();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates consent on tier, requirements or agreement changes", async () => {
    mount(); complete(); await getQuote(); back();

    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("radio", { name: /Global Ekonomis/i }));
    expect(screen.queryByText(/Total pembayaran/)).toBeNull();
    next(); await getQuote(); back(); toTarget();
    fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
    expect(screen.queryByText(/Total pembayaran/)).toBeNull();
    proceed();
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /Akun publik/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
    next(); await getQuote();
    fireEvent.click(screen.getByRole("checkbox", { name: /Saya setuju/ }));
    expect(screen.queryByText(/Total pembayaran/)).toBeNull();
  });

  it("requires a fresh quote after a definitive order rejection", async () => {
    mount(); complete(); await getQuote();
    fetchMock.mockResolvedValueOnce(reply({ message: "Harga berubah. Periksa ulang." }, 409));
    consent();
    expect((await screen.findByRole("alert")).textContent).toContain("Harga berubah");
    expect(screen.queryByText(/Total pembayaran/)).toBeNull();
    expect((screen.getByLabelText("Email").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
    await getQuote();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([{ quote_token: "bad", total: 0, payable: -1 }, { quote_token: "", total: 7000, payable: 7000 }])("rejects malformed quote %j", async (data) => {
    mount(); complete(); fetchMock.mockResolvedValue(reply(data)); proceed();
    expect((await screen.findByRole("alert")).textContent).toContain("Respons harga tidak valid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([503, 408, 429])("locks inputs and retries uncertain %s with the same token and contacts, even past expiry", async (status) => {
    mount(); complete(); await getQuote();
    let reject!: (reason: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    const buttons = screen.getAllByRole("button", { name: "Setujui & lanjut ke pembayaran" });
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText("Email").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: /^Langkah/ }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => { reject(new Error("network lost")); });
    expect((await screen.findByRole("alert")).textContent).toBe("Pesanan belum berhasil dibuat. Tekan Coba lagi; kamu tidak akan ditagih dua kali.");
    expect(screen.queryByText(/Data dikunci/)).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30 * 60_000);
    fetchMock.mockResolvedValueOnce(reply({ error: "Unavailable" }, status));
    proceed();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    // 5xx tetap ambigu → kalimat sederhana; 408/429 memakai alasan dari server.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(status >= 500 ? "Pesanan belum berhasil dibuat. Tekan Coba lagi; kamu tidak akan ditagih dua kali." : "Unavailable"));
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
    expect((screen.getByLabelText("Email").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  });

  it("preserves same token when order JSON is malformed or success code is missing", async () => {
    mount(); complete(); await getQuote();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("truncated JSON"); } });
    consent(); await screen.findByRole("alert");
    fetchMock.mockResolvedValueOnce(reply({ code: "bad" }));
    proceed();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("tidak akan ditagih dua kali"));
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
  });

  it("requotes expired consent and asks again before creating the order", async () => {
    mount(); complete(); await getQuote();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30 * 60_000);
    fetchMock.mockResolvedValueOnce(reply({ quote_token: "fresh", total: 7400, payable: 7400 }));
    consent();
    await screen.findAllByText(/Rp7.400/);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/pedia/quote", "/api/pedia/quote"]);
    expect(screen.getAllByRole("button", { name: "Setujui & lanjut ke pembayaran" })).toHaveLength(2);
  });
});

describe("Pedia configurator", () => {
  it("keeps service comparisons expanded and validates each step before proceeding", () => {
    mount(); select();
    const qty = document.getElementById("pedia-quantity")!;
    const tier = document.getElementById("pedia-tier")!;
    expect(qty.compareDocumentPosition(tier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByLabelText("Link profil Instagram")).toBeNull();
    expect((screen.getByRole("button", { name: "Langkah 3: Kontak" }) as HTMLButtonElement).disabled).toBe(true);
    toTarget();
    expect(screen.queryByLabelText("Jumlah yang dipesan")).toBeNull();
    expect(screen.getByLabelText("Link profil Instagram")).toBeTruthy();
    next();
    expect(screen.queryByLabelText("Nomor WhatsApp")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("persyaratan");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the chosen service, destination, requirements and contact when reviewing the order", () => {
    mount(); complete(); back();
    expect((screen.getByRole("radio", { name: /Indonesia Stabil/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("250");
    toTarget();
    expect((screen.getByLabelText("Link profil Instagram") as HTMLInputElement).value).toBe("https://instagram.com/customer");
    expect((screen.getByRole("checkbox", { name: /Akun publik/ }) as HTMLInputElement).checked).toBe(true);
    next();
    expect((screen.getByLabelText("Nomor WhatsApp") as HTMLInputElement).value).toBe("081234567890");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("buyer@example.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const many = { ...product, tiers: Array.from({ length: 7 }, (_, i) => ({ ...product.tiers[i % 2], id: i + 1, public_name: `Layanan ${i + 1}`, recommended: i === 4 })) };
  it("groups Refill before No Refill, cheapest first, with short names and inline info for the pick", () => {
    const tiers: PediaCatalogProduct["tiers"] = [
      { ...product.tiers[0], id: 11, public_name: "Followers Global Real · No Refill", price_per_1k: 12000, success_pct: 97 },
      { ...product.tiers[1], id: 12, public_name: "Followers Indonesia Real · Refill 30 Days · Less Drop", price_per_1k: 65000, drop_label: "less_drop" },
      { ...product.tiers[1], id: 13, public_name: "Followers Global Real · Refill 365 Days · No Drop", price_per_1k: 35000 },
      { ...product.tiers[0], id: 14, public_name: "Followers Indonesia Real · No Refill", price_per_1k: 57000, eta_start: null, avg_time: "1 jam 42 menit" },
    ];
    render(<ServicePicker product={{ ...product, tiers }} tierId={12} onSelect={vi.fn()} qty={null} expanded info={(t) => <p data-testid="inline-info">info {t.id}</p>} />);
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["11", "13", "12", "14"]); // owner 2026-11-03: Sorotan (Termurah 11, Refill terlama 13) lebih dulu
    const text = document.getElementById("pedia-tier")!.textContent!;
    expect(text.indexOf("Refill (bergaransi)")).toBeLessThan(text.indexOf("No Refill", text.indexOf("Refill (bergaransi)") + 20));
    // 2026-11-02: nama lengkap [Metrik] [Wilayah] [Kualitas]; refill/drop hanya chip.
    expect(screen.getAllByRole("radio", { name: /^Followers Indonesia Real(?! ·)/ })).toHaveLength(2);
    expect(screen.getAllByRole("radio", { name: /^Followers Global Real(?! ·)/ })).toHaveLength(2);
    expect(text).not.toContain("Followers Indonesia Real · Refill 30 Days");
    expect(text).not.toContain("· Less Drop");
    expect(screen.getByText("97% sukses").className).toContain("text-emerald-200");
    expect(text).not.toContain("Avg 1 jam 42 menit"); // owner 2026-11-03: Avg time bukan lagi chip kartu
    const info = screen.getByTestId("inline-info");
    expect(info.textContent).toBe("info 12");
    expect(info.parentElement?.previousElementSibling?.querySelector("input")?.getAttribute("value")).toBe("12");
  });

  it("keeps info chips neutral, uses a pin for Indonesia and hides Start without timing data (owner 2026-11-02)", () => {
    const tiers = [{ ...product.tiers[0], id: 31, region: "indonesia" as const, eta_start: null, speed_note: null, avg_time: null },
      { ...product.tiers[1], id: 32, region: "global" as const, eta_start: "0–2 jam" }];
    const { container } = render(<ServicePicker product={{ ...product, tiers }} tierId={null} onSelect={vi.fn()} qty={null} expanded />);
    expect(container.textContent).not.toContain("mengikuti antrean");
    const indo = screen.getByText("Indonesia", { selector: "span" });
    const glob = screen.getByText("Global", { selector: "span" });
    expect(indo.querySelector("svg")!.getAttribute("class")).toContain("lucide-map-pin");
    expect(glob.querySelector("svg")!.getAttribute("class")).toMatch(/lucide-(globe|earth)/);
    expect(indo.className).toContain("text-white/85");
    expect(screen.getByText("Start 0–2 jam", { selector: "span" }).className).toContain("text-white/85");
  });

  it("shows the real price for 10 comments instead of a per-1.000 price on comment services", () => {
    const comments = { ...product, metric: "comments", tiers: [{ ...product.tiers[0], id: 21, public_name: "Komentar Indonesia Real", price_per_1k: 315000, price_ref: { qty: 10, price: 3200 } }] };
    render(<ServicePicker product={comments} tierId={null} onSelect={vi.fn()} qty={null} expanded />);
    const row = screen.getByRole("radio").closest("label")!;
    expect(row.textContent).toContain("Rp3.200");
    expect(row.textContent).toContain("untuk 10 komentar");
    expect(row.textContent).not.toContain("Rp315.000");
  });

  it("shows three real offers first, exposes all alternatives with visible chip filters and result count", () => {
    render(<ServicePicker product={many} tierId={null} onSelect={vi.fn()} qty={null} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    // 2026-11-01: Refill (bergaransi) dulu, lalu termurah; bukan lagi rekomendasi dulu.
    expect(screen.getAllByRole("radio")[0].getAttribute("value")).toBe("1"); // owner 2026-11-03: Sorotan Termurah (id 1) lebih dulu, lalu Refill terlama (id 2)
    // Jumlah hasil menempel di judul "Pilih layanan" (owner 2026-11-03).
    expect(screen.getByRole("status").textContent).toBe("· 7 layanan");
    expect(screen.getByRole("status").parentElement?.textContent).toContain("Pilih layanan");
    expect(screen.getByRole("button", { name: "Semua" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lihat semua 7 layanan" }));
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Indonesia" }));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("status").textContent).toBe("· 3 dari 7 layanan");
    expect(document.getElementById("pedia-tier")?.textContent).not.toMatch(/Layanan 1|Layanan 3|Layanan 5|Layanan 7/);
    fireEvent.click(screen.getByRole("button", { name: "Reset filter" }));
    expect(screen.getByRole("status").textContent).toBe("· 7 layanan");
  });

  it("has one active category and switches between region and refill instead of intersecting them", () => {
    const onSelect = vi.fn();
    const tiers: PediaCatalogProduct["tiers"] = [product.tiers[0], product.tiers[1],
      { ...product.tiers[1], id: 3, public_name: "Global refill", region: "global" },
      { ...product.tiers[0], id: 4, public_name: "Indonesia tanpa refill", region: "indonesia" },
      { ...product.tiers[0], id: 5, public_name: "Campuran", region: "mixed" }];
    render(<ServicePicker product={{ ...product, tiers }} tierId={null} onSelect={onSelect} qty={100} expanded />);
    const categories = screen.getByRole("group", { name: "Kategori layanan" });
    const offers = () => screen.queryAllByRole("radio").map((r) => r.getAttribute("value")).sort();
    for (const [label, ids] of [["Semua", ["1", "2", "3", "4", "5"]], ["Global", ["1", "3"]], ["Refill", ["2", "3"]], ["No Refill", ["1", "4", "5"]], ["Indonesia", ["2", "4"]], ["Indonesia", ["2", "4"]], ["Semua", ["1", "2", "3", "4", "5"]]] as const) {
      fireEvent.click(within(categories).getByRole("button", { name: label }));
      expect(within(categories).getAllByRole("button", { pressed: true }).map((b) => b.textContent)).toEqual([label]);
      expect(offers()).toEqual(ids);
    }
    expect(onSelect).not.toHaveBeenCalled();
    // Jumlah hasil berada di atas daftar layanan (owner 2026-11-01).
    const count = screen.getByTestId("pedia-filter-count");
    expect(screen.getAllByRole("radio")[0].compareDocumentPosition(count) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getByText("· harga untuk 100")).toBeTruthy();
    expect(within(categories).queryByRole("button", { name: "Tanpa refill" })).toBeNull();
  });

  it("resets the active category and advanced filters without changing the selected offer", () => {
    const onSelect = vi.fn();
    render(<ServicePicker product={many} tierId={2} onSelect={onSelect} qty={100} expanded />);
    fireEvent.click(screen.getByRole("button", { name: "Global" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset filter" }));
    const categories = screen.getByRole("group", { name: "Kategori layanan" });
    expect(within(categories).getAllByRole("button", { pressed: true })[0].textContent).toBe("Semua");
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.queryByRole("combobox", { name: "Filter jenis akun" })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("puts compatible alternatives before recommended incompatible offers in the initial three", () => {
    const tiers = Array.from({ length: 4 }, (_, i) => ({ ...product.tiers[0], id: i + 10, public_name: `Pilihan ${i}`, min_qty: i === 3 ? 10 : 100, recommended: i < 3 }));
    render(<ServicePicker product={{ ...product, tiers }} tierId={null} onSelect={vi.fn()} qty={10} />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0].value).toBe("13");
    expect(radios[0].disabled).toBe(false);
    expect(radios.slice(1).every(r => r.disabled)).toBe(true);
  });

  it("compares exact prices at the same quantity and never substitutes an incompatible minimum price", () => {
    render(<ServicePicker product={product} tierId={null} onSelect={vi.fn()} qty={250} prices={{ 2: 7050 }} />);
    const limited = screen.getByRole("radio", { name: /Global Ekonomis/ }).closest("label")!;
    const eligible = screen.getByRole("radio", { name: /Indonesia Stabil/ }).closest("label")!;
    expect(limited.textContent).toContain("Jumlah tidak tersedia");
    expect(limited.textContent).not.toContain("Rp2.000");
    expect(eligible.textContent).toContain("Rp7.050");
    expect(eligible.textContent).toContain("untuk 250");
    expect(eligible.textContent).not.toContain("Rp3.000");
  });

  it("shows pending or unavailable prices instead of misleading minimum prices for a custom quantity", () => {
    const { container, rerender } = render(<ServicePicker product={product} tierId={2} onSelect={vi.fn()} qty={130} />);
    expect(container.textContent).toContain("Memeriksa harga…");
    expect(container.textContent).not.toContain("Rp3.000");
    rerender(<ServicePicker product={product} tierId={2} onSelect={vi.fn()} qty={130} pricesSettled />);
    expect(container.textContent).toContain("Harga belum tersedia");
    rerender(<ServicePicker product={product} tierId={2} onSelect={vi.fn()} qty={135} prices={{ 2: 5000 }} />);
    expect(container.textContent).toContain("Jumlah tidak tersedia");
    expect(container.textContent).toContain("kelipatan 10");
    expect(container.textContent).not.toContain("Rp5.000");
  });

  it("drops the selection when the chosen filter excludes it, keeps it when included", () => {
    const onClear = vi.fn();
    render(<ServicePicker product={many} tierId={2} onSelect={vi.fn()} onClear={onClear} qty={100} expanded />);
    fireEvent.click(screen.getByRole("button", { name: "Indonesia" }));
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Global" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).not.toContain("2");
    expect(screen.queryByText(/Pilihanmu tetap disimpan/)).toBeNull();
  });

  it("clears the chosen service in the order form when switching to an excluding filter", () => {
    render(<OrderClient product={many} initialTarget="" ordersEnabled />);
    fireEvent.click(screen.getAllByRole("radio").find((r) => r.getAttribute("value") === "2")!);
    expect((screen.getAllByRole("radio").find((r) => r.getAttribute("value") === "2") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Global" }));
    expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });

  it("exposes details without an accordion and places ordering controls before offers", () => {
    const described = { ...product, tiers: [{ ...product.tiers[1], description: "Keterangan terpilih", terms: "Syarat refill khusus", instructions: "Salin link profil lengkap." }] };
    const { container } = render(<OrderClient product={described} initialTarget="" ordersEnabled />);
    fireEvent.click(screen.getByRole("radio"));
    expect(screen.getByText("Keterangan terpilih").closest("details")).toBeNull();
    expect(screen.getByText("Syarat refill khusus").closest("details")).toBeNull();
    expect(screen.queryByText("Salin link profil lengkap.")).toBeNull();
    // Satu-satunya disclosure di langkah 1 adalah "Arti istilah" (2026-11-01).
    expect([...container.querySelectorAll("details")].map((d) => d.querySelector("summary")?.textContent)).toEqual(["Arti istilah"]);
    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "250" } });
    toTarget();
    expect(screen.getByText("Salin link profil lengkap.")).toBeTruthy();
  });

  it("custom comments: one per line, count must match quantity, sent with the quote", async () => {
    const custom = { ...product, tiers: [{ ...product.tiers[1], input_kind: "comments" as const, min_qty: 1, max_qty: 200, quantity_step: 1 }], step: 1 };
    render(<OrderClient product={custom} initialTarget="https://www.instagram.com/axvara/" ordersEnabled />);
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "2" } });
    toTarget();
    fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
    const box = screen.getByLabelText(/Isi komentar/);
    fireEvent.change(box, { target: { value: "Mantap\n" } });
    expect(document.getElementById("pedia-comments-help")?.textContent).toContain("1 dari 2 komentar");
    next();
    expect(screen.getByText("Jumlah komentar (1) harus sama dengan jumlah pesanan (2).")).toBeTruthy();
    expect(screen.queryByLabelText("Nomor WhatsApp")).toBeNull();
    fireEvent.change(box, { target: { value: "Mantap\nKeren" } });
    next();
    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "081234567890" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Saya setuju/ }));
    proceed();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ quantity: 2, comments: "Mantap\nKeren" });
  });

  it("explains refill requests without presenting them as a measured drop rate", () => {
    const info = { ...product, tiers: [{ ...product.tiers[1], refill_days: 30, refill_mode: "manual" as const, drop_label: "high_drop" as const, refill_pct: 12, success_pct: 97, speed_per_day: "10K/hari", avg_time: "19 menit", eta_start: "0–1 jam" }] };
    render(<OrderClient product={info} initialTarget="" ordersEnabled />);
    fireEvent.click(screen.getByRole("radio"));
    const card = screen.getByRole("region", { name: "Info layanan" });
    // owner 2026-11-03: Speed dihilangkan bila avg_time ada.
    expect(card.textContent).not.toContain("10K/hari");
    for (const text of ["0–1 jam", "19 menit per 1.000", "97% (7 hari)", "diproses admin", "High Drop", "Perkiraan drop tinggi", "Pengajuan Refill · 7 hari12%", "bukan persentase followers, likes, atau views yang hilang"]) expect(card.textContent).toContain(text); // owner 2026-11-03: stat cell + penjelasan di glosarium
    expect(card.textContent).not.toContain("Drop rate:");
    expect(screen.getAllByText("High Drop").some((el) => el.className.includes("text-red-200"))).toBe(true);
    expect(card.textContent).not.toMatch(/supplier|indosmm/i);
  });

  it("merges unique copy and conditions into the selected panel without losing product requirements", () => {
    const description = 'Followers global berlabel HQ.\n<script>alert("test")</script>';
    const described = { ...product, description_md: "Akun harus memiliki foto profil.", tiers: [{ ...product.tiers[1], quality: "hq" as const, description, terms: "No Refill: jumlah yang drop tidak diisi ulang.\nRefill khusus hanya untuk penurunan di atas 10%.\nJangan mengganti username.\nJangan mengganti username." }] };
    const { container } = render(<OrderClient product={described} initialTarget="" ordersEnabled />);
    expect(screen.getByRole("heading", { name: "Tentang layanan" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio"));
    const card = screen.getByRole("region", { name: "Info layanan" });
    expect(screen.queryByRole("heading", { name: /Detail layanan terpilih|Tentang layanan/ })).toBeNull();
    expect(screen.getAllByText((_, element) => element?.tagName === "P" && element.textContent === description)).toHaveLength(1);
    expect(within(card).getByText("Akun harus memiliki foto profil.")).toBeTruthy();
    // owner 2026-11-03: makna fitur (HQ, dst.) tidak lagi inline; hanya di dalam "Arti istilah".
    const hqMeaning = within(card).getByText(/High Quality, kategori kualitas layanan/, { selector: "dd" });
    expect(hqMeaning.closest("details")).toBe(within(card).getByText("Arti istilah").closest("details"));
    expect([...card.querySelectorAll("p")].some((p) => /High Quality/.test(p.textContent ?? ""))).toBe(false);
    expect(card.querySelector("script")).toBeNull();
    expect(within(card).getByText("Refill khusus hanya untuk penurunan di atas 10%.")).toBeTruthy();
    expect(within(card).getAllByText("Jangan mengganti username.")).toHaveLength(1);
    expect(card.textContent).not.toContain("No Refill: jumlah yang drop tidak diisi ulang.");
    const copy = within(card).getByText((_, element) => element?.tagName === "P" && element.textContent === description);
    const conditions = within(card).getByRole("heading", { name: "Syarat khusus" });
    const numbers = within(card).getAllByText("Start time", { selector: "dt" })[0];
    const heading = within(card).getByRole("heading", { name: "Info layanan" });
    // Angka layanan (Start time/Speed/Avg time) di atas judul Info layanan.
    expect(numbers.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(copy.compareDocumentPosition(conditions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const radio = screen.getByRole("radio");
    const linkedPanel = document.getElementById(radio.getAttribute("aria-describedby")!);
    expect(linkedPanel?.contains(card)).toBe(true);
    expect(container.querySelector("aside")?.textContent).not.toContain(description);
    const disclosure = within(card).getByText("Arti istilah").closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(disclosure.querySelector("summary")!);
    expect(within(disclosure).getByText("HQ")).toBeTruthy();
  });

  it("keeps buyer copy confident: risk appears once in the Drop line, not in HQ/Real/No Refill, and generated duplicates are dropped", () => {
    const generated = ["Jumlah per pesanan 10–1.000.", "Refill 30 Days: ajukan refill di halaman Refill Pedia selama masa refill sejak pesanan dibuat, 1× per 24 jam. Refill diproses admin, biasanya dalam 1×24 jam.", "Start time dan speed dapat berubah mengikuti antrean.", "Target harus publik.", "Jumlah per pesanan 10–5.000."].join("\n");
    render(<ServiceInfoCard t={{ ...product.tiers[1], quality: "hq", refill_days: 30, refill_mode: "manual", drop_label: "no_drop", min_qty: 10, max_qty: 1000, terms: generated }} />);
    const card = screen.getByRole("region", { name: "Info layanan" });
    expect(within(card).queryAllByText(/^Start time dan speed dapat berubah/)).toHaveLength(0);
    expect(card.textContent).toContain("Estimasi; start time dan speed dapat berubah mengikuti antrean.");
    expect(within(card).queryByText("Jumlah per pesanan 10–1.000.")).toBeNull();
    expect(within(card).getByText("Jumlah per pesanan 10–5.000.")).toBeTruthy();
    expect(within(card).getByText("Target harus publik.")).toBeTruthy();
    expect(card.textContent).not.toContain("ajukan refill di halaman Refill Pedia");
    expect(card.textContent).toContain("diproses admin, biasanya dalam 1×24 jam");
    expect(card.textContent).not.toMatch(/Bukan jaminan|tetap bisa terjadi|Anggap drop|Biasanya lebih murah|mengutamakan harga|lebih tinggi|lebih murah/);
    // Penafian hanya di baris Drop, tidak diulang di paragraf HQ.
    expect(within(card).getByText(/High Quality, kategori kualitas layanan/, { selector: "dd" }).textContent).not.toMatch(/bukan|jaminan|janji/);
    expect(within(card).getAllByText(/Perkiraan jumlah tetap stabil/, { selector: "dd" })[0].textContent).toMatch(/bukan janji/);
    expect(card.textContent).toContain("Perkiraan jumlah tetap stabil setelah pesanan selesai; bukan janji bebas drop.");
    render(<ServiceInfoCard t={{ ...product.tiers[0], quality: "real", drop_label: "unknown", refill_days: 0 }} />);
    const none = screen.getAllByRole("region", { name: "Info layanan" })[1];
    expect(none.textContent).toContain("Tanpa refill: jumlah yang drop tidak diisi ulang.");
    expect(none.textContent).toContain("Label drop belum tersedia; jumlah masih dapat berkurang setelah pengiriman.");
    expect(none.textContent).not.toMatch(/No Drop/);
  });

  it("drops only exact generic live duplicates and keeps real restrictions", () => {
    const lines = [
      "Jumlah dapat diisi sendiri dalam batas layanan.",
      "Estimasi mulai dan kecepatan dapat berubah mengikuti antrean.",
      "Estimasi dapat berubah mengikuti antrean.",
      "Refill 30 hari sejak pesanan dibuat, sesuai syarat layanan.",
      "Refill 60 hari sejak pesanan dibuat, sesuai syarat layanan.",
      "Refill 30 hari sejak pesanan selesai, sesuai syarat layanan.",
      "Jumlah dapat diisi sendiri dalam batas layanan, kelipatan 100.",
      "Kelipatan 100 per pesanan.",
      "Tanpa refill dan tanpa refund bila target diganti.",
      "Refill hanya bila penurunan di atas 10%.",
    ];
    render(<ServiceInfoCard t={{ ...product.tiers[1], refill_days: 30, terms: lines.join("\n") }} />);
    const card = screen.getByRole("region", { name: "Info layanan" });
    const items = within(card).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(lines.slice(4));
    render(<ServiceInfoCard t={{ ...product.tiers[0], refill_days: 0, terms: "Refill 30 hari sejak pesanan dibuat, sesuai syarat layanan." }} />);
    expect(within(screen.getAllByRole("region", { name: "Info layanan" })[1]).getByText("Refill 30 hari sejak pesanan dibuat, sesuai syarat layanan.")).toBeTruthy();
  });

  it("keeps conflicting generated refill sentences: mismatched N, Lifetime mismatch, mode mismatch; only exact current-tier sentence is dropped", () => {
    const exact30manual = "Refill 30 Days: ajukan refill di halaman Refill Pedia selama masa refill sejak pesanan dibuat, 1× per 24 jam. Refill diproses admin, biasanya dalam 1×24 jam.";
    const exact30auto = "Refill 30 Days: ajukan refill di halaman Refill Pedia selama masa refill sejak pesanan dibuat, 1× per 24 jam. Refill diproses otomatis.";
    const exactLife = "Refill Lifetime: ajukan refill di halaman Refill Pedia selama masa refill sejak pesanan dibuat, 1× per 24 jam. Refill diproses otomatis.";
    const otherN = "Refill 60 Days: ajukan refill di halaman Refill Pedia selama masa refill sejak pesanan dibuat, 1× per 24 jam. Refill diproses admin, biasanya dalam 1×24 jam.";
    // N + mode cocok → dibuang (sudah ada di paragraf Refill).
    render(<ServiceInfoCard t={{ ...product.tiers[1], refill_days: 30, refill_mode: "manual", terms: [exact30manual, "Target harus publik."].join("\n") }} />);
    let card = screen.getByRole("region", { name: "Info layanan" });
    expect(within(card).queryByText(exact30manual)).toBeNull();
    expect(within(card).getByText("Target harus publik.")).toBeTruthy();
    cleanup();
    // N tak cocok → TETAP TAMPIL (konflik durasi nyata).
    render(<ServiceInfoCard t={{ ...product.tiers[1], refill_days: 30, refill_mode: "manual", terms: [otherN, "Target harus publik."].join("\n") }} />);
    card = screen.getByRole("region", { name: "Info layanan" });
    expect(within(card).getByText(otherN)).toBeTruthy();
    cleanup();
    // Mode tak cocok (auto vs manual) → TETAP TAMPIL.
    render(<ServiceInfoCard t={{ ...product.tiers[1], refill_days: 30, refill_mode: "manual", terms: exact30auto }} />);
    expect(within(screen.getByRole("region", { name: "Info layanan" })).getByText(exact30auto)).toBeTruthy();
    cleanup();
    // Lifetime tak cocok untuk tier 30 hari → TETAP TAMPIL.
    render(<ServiceInfoCard t={{ ...product.tiers[1], refill_days: 30, refill_mode: "api", terms: exactLife }} />);
    expect(within(screen.getByRole("region", { name: "Info layanan" })).getByText(exactLife)).toBeTruthy();
    cleanup();
    // No Refill: kalimat lama generik tetap dibuang, syarat kustom tetap tampil.
    render(<ServiceInfoCard t={{ ...product.tiers[0], refill_days: 0, terms: "No Refill: jumlah yang drop tidak diisi ulang.\nRefill hanya bila penurunan di atas 10%." }} />);
    card = screen.getByRole("region", { name: "Info layanan" });
    expect(within(card).queryByText("No Refill: jumlah yang drop tidak diisi ulang.")).toBeNull();
    expect(within(card).getByText("Refill hanya bila penurunan di atas 10%.")).toBeTruthy();
  });

  it("omits exact generic product copy but keeps a custom description", () => {
    const copy = `${product.name}. Pilih layanan dan jumlah, gunakan link yang sesuai, lalu lanjutkan ke pembayaran QRIS.`;
    const { rerender } = render(<OrderClient product={{ ...product, description_md: copy }} initialTarget="" ordersEnabled />);
    expect(screen.queryByText(copy)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Tentang layanan" })).toBeNull();
    rerender(<OrderClient product={{ ...product, description_md: `${copy}\nTarget harus memiliki minimal 10 followers.` }} initialTarget="" ordersEnabled />);
    expect(screen.getByText(/Target harus memiliki minimal 10 followers/)).toBeTruthy();
  });

  it.each([null, undefined, NaN, -1, 101, 0, 1, 100])("never shows refill-request statistics for No Refill (%s)", (refill_pct) => {
    render(<ServiceInfoCard t={{ ...product.tiers[0], quality: "real", refill_pct }} />);
    const card = screen.getByRole("region", { name: "Info layanan" });
    expect(card.textContent).not.toContain("Pengajuan Refill");
    expect(card.textContent).not.toContain("Drop rate");
    expect(card.textContent).toContain("Akun Real (Real Accounts), bukan akun campuran.");
    expect(card.textContent).not.toMatch(/supplier|indosmm|providersmm|label Real|karakter akun|kelas Real|kelas HQ|lewat AXVARA|dari AXVARA/i);
  });

  it.each([null, undefined, NaN, -1, 101])("hides unavailable or invalid refill-request statistics (%s)", (refill_pct) => {
    render(<ServiceInfoCard t={{ ...product.tiers[1], refill_pct }} />);
    expect(screen.getByRole("region", { name: "Info layanan" }).textContent).not.toContain("Pengajuan Refill");
  });

  it("shows a known zero refill-request percentage without calling it a low drop rate", () => {
    render(<ServiceInfoCard t={{ ...product.tiers[1], refill_pct: 0 }} />);
    const card = screen.getByRole("region", { name: "Info layanan" });
    expect(card.textContent).toContain("Pengajuan Refill · 7 hari0%");
    expect(card.textContent).not.toContain("Rendah");
  });

  it("shows the same category bar on every multi-service catalog, disables empty ones, hides it for one service, and has no account-type dropdown (owner 2026-10-31)", () => {
    const uniform = { ...product, tiers: [{ ...product.tiers[1], region: "global" as const }, { ...product.tiers[1], id: 3, region: "global" as const }] };
    const { unmount } = render(<ServicePicker product={uniform} tierId={null} onSelect={vi.fn()} qty={100} expanded />);
    const categories = screen.getByRole("group", { name: "Kategori layanan" });
    expect(within(categories).getAllByRole("button").map((b) => b.textContent)).toEqual(["Semua", "Global", "Indonesia", "Refill", "No Refill"]);
    expect((within(categories).getByRole("button", { name: "No Refill" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(categories).getByRole("button", { name: "Indonesia" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(categories).getByRole("button", { name: "Global" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("combobox", { name: "Filter jenis akun" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Urutkan layanan" })).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    unmount();
    render(<ServicePicker product={{ ...product, tiers: [product.tiers[1]] }} tierId={null} onSelect={vi.fn()} qty={100} expanded />);
    expect(screen.queryByRole("group", { name: "Kategori layanan" })).toBeNull();
  });

  it("keeps independent drafts when switching needs, without leaking a profile target into posts", () => {
    const likes = { ...product, slug: "likes-instagram", name: "Likes Instagram", metric: "likes", target_kind: "post", tiers: [{ ...product.tiers[1], id: 3, public_name: "Likes Global" }] };
    render(<PlatformPageClient platform="instagram" name="Instagram" products={[product, likes]} initialTarget="https://instagram.com/customer" ordersEnabled />);
    select(); toTarget();
    fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
    fireEvent.click(screen.getByRole("button", { name: "Langkah 1: Layanan" }));
    const needs = () => screen.getByRole("navigation", { name: "Jenis layanan Instagram" });
    fireEvent.click(within(needs()).getByRole("button", { name: /^Likes\b/ }));
    expect(document.activeElement).toBe(within(needs()).getByRole("button", { name: /^Likes\b/ }));
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("radio").some((r) => (r as HTMLInputElement).checked)).toBe(false);
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "100" } });
    toTarget();
    const post = screen.getByLabelText("Link postingan Instagram") as HTMLInputElement;
    expect(post.value).toBe("");
    fireEvent.change(post, { target: { value: "https://instagram.com/p/ABC/" } });
    fireEvent.click(screen.getByRole("button", { name: "Langkah 1: Layanan" }));
    fireEvent.click(within(needs()).getByRole("button", { name: /^Followers\b/ }));
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("250");
    expect((screen.getByRole("radio", { name: /Indonesia Stabil/ }) as HTMLInputElement).checked).toBe(true);
    toTarget();
    expect((screen.getByLabelText("Link profil Instagram") as HTMLInputElement).value).toBe("https://instagram.com/customer");
    expect((screen.getByRole("checkbox", { name: /Akun publik/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Langkah 1: Layanan" }));
    fireEvent.click(within(needs()).getByRole("button", { name: /^Likes\b/ }));
    toTarget();
    expect((screen.getByLabelText("Link postingan Instagram") as HTMLInputElement).value).toBe("https://instagram.com/p/ABC/");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports keyboard selection and moves focus through the comparison without hiding alternatives", async () => {
    // jsdom omits CSS.escape; user-event only needs this already-safe radio name.
    vi.stubGlobal("CSS", { escape: (name: string) => { expect(name).toBe("pedia-tier"); return name; } });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<ServicePicker product={product} tierId={null} onSelect={onSelect} qty={100} expanded />);
    const radios = screen.getAllByRole("radio");
    radios[0].focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenLastCalledWith(2);
    rerender(<ServicePicker product={product} tierId={2} onSelect={onSelect} qty={100} expanded />);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getAllByRole("radio")[1]);
    expect(onSelect).toHaveBeenLastCalledWith(1);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("shows a back button only on steps 2-3, keeps entered data, and hides it once the order is locked", async () => {
    mount(); select();
    expect(screen.queryAllByRole("button", { name: /^Kembali ke langkah/ })).toHaveLength(0);
    toTarget();
    expect(screen.queryAllByRole("button", { name: "Kembali ke langkah Layanan" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
    next();
    expect(screen.queryAllByRole("button", { name: "Kembali ke langkah Target" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Kembali ke langkah Target" })[0]);
    expect((screen.getByLabelText(/Link profil Instagram/) as HTMLInputElement).value).toBe("https://instagram.com/customer");
    expect((screen.getByRole("checkbox", { name: /Akun publik/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Kembali ke langkah Layanan" })[0]);
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("250");
  });

  it("opens the order summary as a modal sheet from the mobile bar, traps focus, closes on Escape and returns focus (owner 2026-10-31)", () => {
    render(<OrderClient product={product} initialTarget="" ordersEnabled />);
    expect(screen.queryAllByRole("button", { name: /Lihat rincian pesanan/ })).toHaveLength(0);
    select();
    const opener = screen.getAllByRole("button", { name: /Lihat rincian pesanan/ }).at(-1)!;
    expect(opener.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Rincian pesanan" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText("Followers Indonesia Stabil")).toBeTruthy();
    expect(within(dialog).getByText("250")).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Tutup rincian" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the closed mobile bar as one tappable Rincian strip above a clean price + action row (owner 2026-10-31)", () => {
    render(<OrderClient product={product} initialTarget="" ordersEnabled />);
    const bar = document.querySelector(".pedia-mobile-action") as HTMLElement;
    expect(within(bar).queryByRole("button", { name: /Lihat rincian pesanan/ })).toBeNull();
    expect(bar.textContent).toContain("Total pesanan");
    select();
    const strip = within(bar).getByRole("button", { name: /Lihat rincian pesanan: 250, Followers Indonesia Stabil/ });
    expect(strip.getAttribute("aria-haspopup")).toBe("dialog");
    expect(strip.textContent).toContain("Rincian");
    expect(strip.textContent).toContain("250");
    expect(within(bar).getAllByRole("button", { name: /Lihat rincian pesanan/ })).toHaveLength(1);
    expect(bar.textContent).not.toContain("Total pesanan");
    expect(bar.textContent).toContain("Rp");
    expect(bar.querySelector("span[aria-hidden='true'].rounded-full")).toBeTruthy();
    fireEvent.click(strip);
    expect(screen.getByRole("dialog", { name: "Rincian pesanan" })).toBeTruthy();
    expect(strip.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the full pay label accessible while a short visual label is used under 340px", () => {
    mount();
    complete();
    const pay = screen.getAllByRole("button", { name: "Lanjut ke pembayaran" }).at(-1)!;
    expect(pay.querySelector("span[aria-hidden='true']")?.textContent).toBe("Lanjut bayar");
    expect(pay.textContent).toContain("Lanjut ke pembayaran");
  });

  it("closes the summary sheet when the step changes and keeps the desktop summary card in the document", () => {
    const { container } = render(<OrderClient product={product} initialTarget="" ordersEnabled />);
    select();
    expect(container.querySelector("aside")?.className).toContain("max-xl:hidden");
    fireEvent.click(screen.getAllByRole("button", { name: /Lihat rincian pesanan/ }).at(-1)!);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: isi target" })[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the selected service and quantity in the mobile bar without opening the sheet", () => {
    render(<OrderClient product={product} initialTarget="" ordersEnabled />);
    select();
    const bar = document.querySelector(".pedia-mobile-action") as HTMLElement;
    expect(bar.textContent).toContain("Indonesia Stabil · Refill 30 Days");
    expect(bar.textContent).toContain("250");
  });

  it("uses 16px phone inputs with the right keyboard hints so iOS does not zoom (owner 2026-10-31)", () => {
    render(<OrderClient product={product} initialTarget="" ordersEnabled />);
    select();
    const qty = screen.getByLabelText("Jumlah yang dipesan");
    expect(qty.className).toContain("text-base");
    expect(qty.getAttribute("inputmode")).toBe("numeric");
    toTarget();
    const link = screen.getByLabelText(/^Link profil Instagram/);
    expect(link.className).toContain("text-base");
    expect(link.getAttribute("inputmode")).toBe("url");
    expect(link.getAttribute("enterkeyhint")).toBe("next");
    fireEvent.change(link, { target: { value: "https://instagram.com/customer" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
    next();
    expect(screen.getByLabelText("Nomor WhatsApp").getAttribute("inputmode")).toBe("tel");
    expect(screen.getByLabelText("Nomor WhatsApp").className).toContain("text-base");
    expect(screen.getByLabelText("Email").getAttribute("inputmode")).toBe("email");
    expect(screen.getByLabelText("Email").getAttribute("autocomplete")).toBe("email");
  });

  // 2026-11-01 (owner): baris panduan yang hanya mengulang alur checkout tidak ditampilkan.
  it("drops guide lines that repeat the checkout flow and keeps service-specific ones", () => {
    const guided = { ...product, tiers: [{ ...product.tiers[1], instructions: "1. Buka target, salin link.\n2. Contoh format: https://x.y/z\n3. Pilih layanan dan jumlah, lalu tempel link target.\n4. Periksa ketentuan, isi WhatsApp serta email, dan lanjutkan ke QRIS.\n5. Setelah pembayaran terkonfirmasi, pantau proses di halaman pesanan.\n6. Matikan mode privat." }] };
    render(<OrderClient product={guided} initialTarget="" ordersEnabled />);
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "250" } });
    toTarget();
    for (const line of ["1. Buka target, salin link.", "2. Contoh format: https://x.y/z", "6. Matikan mode privat."]) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByText(/Pilih layanan dan jumlah|Periksa ketentuan, isi|Setelah pembayaran terkonfirmasi/)).toBeNull();
  });

  it("shows the key service terms first and folds the rest, with a short contact heading", () => {
    const termed = { ...product, tiers: [{ ...product.tiers[1], terms: "Jumlah per pesanan 10-1.000.\nJumlah dapat diisi sendiri.\nRefill 30 hari.\nJangan mengganti link.\nTunggu pesanan sebelumnya selesai.\nEstimasi dapat berubah." }] };
    render(<OrderClient product={termed} initialTarget="" ordersEnabled />);
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "250" } });
    toTarget();
    fireEvent.change(document.getElementById("pedia-target")!, { target: { value: "https://www.instagram.com/axvara/" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
    next();
    expect(screen.getByRole("heading", { level: 2, name: "Kontak untuk pesanan ini" })).toBeTruthy();
    const details = screen.getByText("Lihat semua ketentuan (6)").closest("details")!;
    expect(details.open).toBe(false);
    const top = [...document.querySelectorAll("ul")].find((u) => u.textContent?.includes("Refill 30 hari."))!;
    expect(top.closest("details")).toBeNull();
    expect(top.textContent).toContain("Jangan mengganti link.");
    expect(details.textContent).toContain("Jumlah per pesanan 10-1.000.");
    expect(details.textContent).toContain("Estimasi dapat berubah.");
    const pay = screen.getAllByRole("button", { name: "Lanjut ke pembayaran" })[0];
    expect(pay.querySelector("span[aria-hidden='true']")?.className).toContain("max-xl:inline");
  });
});

// Revisi UX order Pedia (owner 2026-11-03).
describe("Pedia order UX revision 2026-11-03", () => {
  type Tier = PediaCatalogProduct["tiers"][number];
  const base: Tier = { id: 1, tier: "standar", label_note: null, public_name: "Followers Global Real", region: "global", refill_days: 0, eta_start: null, eta_finish: null, prices: { "100": 3000 }, price_per_1k: 30000, min_qty: 10, max_qty: 1000, quantity_step: 10, quick_quantities: [100] };
  const mk = (over: Partial<Tier> & { id: number }): Tier => ({ ...base, ...over });
  const withTiers = (tiers: Tier[]): PediaCatalogProduct => ({ ...product, packages: [10, 100, 500], tiers });
  const presetLabels = () => within(document.getElementById("pedia-quantity")!).getAllByRole("button").map((b) => b.textContent);

  describe("1. quantity presets avoid the minimum payment", () => {
    it("before a tier is picked, keeps only quantities present in every accepting tier's quick_quantities, 5 smallest", () => {
      const p = withTiers([
        mk({ id: 1, quick_quantities: [10, 100, 250, 500, 1000, 2500], max_qty: 5000 }),
        mk({ id: 2, quick_quantities: [100, 250, 500, 1000, 2500], max_qty: 5000 }), // 10 would be floored here
        mk({ id: 3, quick_quantities: [250, 500, 1000, 2500, 5000], min_qty: 250, max_qty: 5000 }), // does not accept 100 -> 100 not required here
      ]);
      render(<OrderClient product={p} initialTarget="" ordersEnabled />);
      expect(presetLabels()).not.toContain("10");
      // 100 stays (tier 3 does not accept it, tiers 1-2 have it); 5 smallest remain.
      expect(presetLabels()).toEqual(["100", "250", "500", "1k", "2.5k"]);
    });
    it("drops a quantity when a tier that accepts it has it floored", () => {
      const p = withTiers([
        mk({ id: 1, quick_quantities: [100, 500] }),
        mk({ id: 2, quick_quantities: [500] }), // accepts 100 but floored there
      ]);
      render(<OrderClient product={p} initialTarget="" ordersEnabled />);
      expect(presetLabels()).toEqual(["500"]);
    });
    it("after a tier is picked, uses that tier's own quick_quantities", () => {
      const p = withTiers([mk({ id: 1, quick_quantities: [100, 500] }), mk({ id: 2, public_name: "Followers Indonesia Real", quick_quantities: [500] })]);
      render(<OrderClient product={p} initialTarget="" ordersEnabled />);
      fireEvent.click(screen.getByRole("radio", { name: /Global Real/ }));
      expect(presetLabels()).toEqual(["100", "500"]);
    });
    it("explains the floor under the quantity input only when the total is the minimum and real price is below it", () => {
      const p = withTiers([mk({ id: 1, prices: { "10": 1000, "100": 3000 }, price_per_1k: 26500, quick_quantities: [100] })]);
      render(<OrderClient product={p} initialTarget="" ordersEnabled />);
      fireEvent.click(screen.getByRole("radio"));
      const note = "Total di bawah Rp1.000 dibulatkan ke minimum pembayaran Rp1.000.";
      expect(screen.queryByText(note)).toBeNull();
      fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "10" } });
      expect(screen.getByText(note)).toBeTruthy();
      fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "100" } });
      expect(screen.queryByText(note)).toBeNull();
      fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "15" } }); // 15 is not a multiple of step 10
      expect(screen.queryByText(note)).toBeNull();
    });
    it("does not show the note when the real price equals the minimum or exceeds it", () => {
      const p = withTiers([mk({ id: 1, prices: { "100": 1000 }, price_per_1k: 10000 })]); // 100 x 10 = Rp1.000, not below
      render(<OrderClient product={p} initialTarget="" ordersEnabled />);
      fireEvent.click(screen.getByRole("radio"));
      fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "100" } });
      expect(document.body.textContent).not.toContain("dibulatkan ke minimum pembayaran");
    });
  });

  describe("2. Sorotan highlights", () => {
    const four = (): Tier[] => [
      mk({ id: 1, public_name: "Followers Global Real", refill_days: 0, price_per_1k: 10000, success_pct: 80 }),
      mk({ id: 2, public_name: "Followers Indonesia Real", region: "indonesia", refill_days: 30, price_per_1k: 30000, success_pct: 92 }),
      mk({ id: 3, public_name: "Followers Global HQ", refill_days: 365, price_per_1k: 40000, success_pct: 96 }),
      mk({ id: 4, public_name: "Followers Campuran", region: "mixed", refill_days: 30, price_per_1k: 20000, success_pct: null }),
    ];
    const render4 = (tiers: Tier[], qty: number | null = null, extra: Partial<React.ComponentProps<typeof ServicePicker>> = {}) =>
      render(<ServicePicker product={withTiers(tiers)} tierId={null} onSelect={vi.fn()} qty={qty} expanded {...extra} />);
    const badgeClass = "border-[#FFB800]/30";
    const badges = () => [...document.querySelectorAll("label span")].filter((n) => n.className.includes(badgeClass)).map((n) => n.textContent);

    it("shows Sorotan first with Termurah, Refill terlama, Sukses tertinggi, each tier once, rest grouped after", () => {
      render4(four());
      const text = document.getElementById("pedia-tier")!.textContent!;
      expect(text.indexOf("Sorotan")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("Sorotan")).toBeLessThan(text.indexOf("Followers Global Real"));
      expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["1", "3", "4", "2"]);
      expect(badges()).toEqual(["Termurah", "Refill terlama", "Sukses tertinggi"]);
      // Tier 3 carries two labels; no radio is duplicated.
      expect(screen.getAllByRole("radio")).toHaveLength(4);
      expect(document.querySelector("label span[class*='FFB800']")!.className).toContain("bg-[#FFB800]/10");
      expect(screen.getByTestId("pedia-filter-count").textContent).toBe("· 4 layanan");
      expect(text).toContain("Refill (bergaransi)");
      expect(text).not.toMatch(/Paling dipilih|HYPE|Rekomendasi/i);
    });
    it("one tier can hold several labels and the remaining list excludes highlighted tiers", () => {
      const tiers = four();
      tiers[2] = { ...tiers[2], price_per_1k: 5000 }; // 3 is cheapest, longest refill and highest success
      render4(tiers);
      expect(badges()).toEqual(["Termurah", "Refill terlama", "Sukses tertinggi"]);
      expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["3", "4", "2", "1"]);
    });
    it("needs >= 4 tiers; fewer shows no Sorotan", () => {
      render4(four().slice(0, 3));
      expect(document.getElementById("pedia-tier")!.textContent).not.toContain("Sorotan");
      expect(badges()).toEqual([]);
    });
    it("does not count tiers disabled by an invalid quantity", () => {
      const tiers = four(); tiers[0] = { ...tiers[0], min_qty: 500 };
      render4(tiers, 100);
      expect(document.getElementById("pedia-tier")!.textContent).not.toContain("Sorotan");
    });
    it("omits Refill terlama when all tiers share the same refill days, and Sukses tertinggi with <2 rates or max < 90", () => {
      const same = four().map((t) => ({ ...t, refill_days: 30 }));
      render4(same);
      expect(badges()).not.toContain("Refill terlama");
      cleanup();
      render4(four().map((t, i) => ({ ...t, success_pct: i === 0 ? 99 : null })));
      expect(badges()).not.toContain("Sukses tertinggi");
      cleanup();
      render4(four().map((t) => ({ ...t, success_pct: t.id === 1 ? 85 : t.id === 2 ? 89 : null })));
      expect(badges()).not.toContain("Sukses tertinggi");
    });
    it("ties pick the cheaper tier", () => {
      const tiers = [
        mk({ id: 1, refill_days: 30, price_per_1k: 30000, success_pct: 95 }),
        mk({ id: 2, refill_days: 30, price_per_1k: 20000, success_pct: 95 }),
        mk({ id: 3, refill_days: 0, price_per_1k: 40000 }),
        mk({ id: 4, refill_days: 7, price_per_1k: 50000 }),
      ];
      render4(tiers);
      const labels = (id: number) => [...document.querySelectorAll("label")].find((l) => l.querySelector(`input[value="${id}"]`))!.textContent;
      expect(labels(2)).toContain("Refill terlama");
      expect(labels(2)).toContain("Sukses tertinggi");
      expect(labels(1)).not.toContain("Refill terlama");
    });
    it("the collapsed list follows the new ordering and keeps the selected card's info panel", () => {
      const onSelect = vi.fn();
      render(<ServicePicker product={withTiers(four())} tierId={4} onSelect={onSelect} qty={null} expanded={false} info={(t) => <p data-testid="inline-info">info {t.id}</p>} />);
      // compact (picked) view first
      fireEvent.click(screen.getByRole("button", { name: "Ganti layanan" }));
      expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["1", "3", "4"]);
      cleanup();
      render(<ServicePicker product={withTiers(four())} tierId={null} onSelect={onSelect} qty={null} />);
      expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["1", "3", "4"]);
      expect(screen.getByRole("button", { name: "Lihat semua 4 layanan" })).toBeTruthy();
      cleanup();
      render(<ServicePicker product={withTiers(four())} tierId={3} onSelect={onSelect} qty={null} expanded info={(t) => <p data-testid="inline-info">info {t.id}</p>} />);
      expect(screen.getByTestId("inline-info").textContent).toBe("info 3");
    });
  });

  describe("3. time information does not contradict itself", () => {
    const named = (over: Partial<Tier>) => mk({ id: 1, ...over });
    it("chip: eta_start wins and hides Instant Start; Instant Start alone otherwise; speed_note; never Avg", () => {
      const { container, rerender } = render(<ServiceChips t={named({ public_name: "Followers Global Real · Instant Start", eta_start: "0-1 jam", avg_time: "8 jam" })} eta productName="x" />);
      expect(container.textContent).toContain("Start 0-1 jam");
      expect(container.textContent).not.toContain("Instant Start");
      rerender(<ServiceChips t={named({ public_name: "Followers Global Real · Instant Start", avg_time: "8 jam" })} eta productName="x" />);
      expect(container.textContent).toContain("Instant Start");
      expect(container.textContent).not.toMatch(/Start \d|Avg/);
      rerender(<ServiceChips t={named({ speed_note: "Mulai 5 menit", avg_time: "8 jam" })} eta productName="x" />);
      expect(container.textContent).toContain("Start 5 menit");
      expect(container.textContent).not.toContain("Avg");
      rerender(<ServiceChips t={named({ avg_time: "8 jam" })} eta productName="x" />);
      expect(container.textContent).not.toMatch(/Avg|Start/);
    });
    it("summary rail title omits chip parts such as Instant Start", () => {
      const p = withTiers([mk({ id: 1, public_name: "Followers Global Real · Refill 30 Days · Instant Start", refill_days: 30 })]);
      render(<OrderClient product={p} initialTarget="" ordersEnabled />);
      fireEvent.click(screen.getByRole("radio"));
      const title = [...document.querySelectorAll("aside p")].find((n) => n.className.includes("font-semibold leading-5"))!;
      expect(title.textContent).toBe("Followers Global Real");
    });
    it("info card omits the Speed row and glossary term when avg_time exists, keeps it otherwise", () => {
      const { container, rerender } = render(<ServiceInfoCard t={named({ speed_per_day: "100K/hari", avg_time: "8 jam 3 menit" })} productName="x" />);
      expect([...container.querySelectorAll("dt")].map((n) => n.textContent)).not.toContain("Speed");
      expect(container.textContent).not.toContain("100K/hari");
      rerender(<ServiceInfoCard t={named({ speed_per_day: "100K/hari" })} productName="x" />);
      expect([...container.querySelectorAll("dt")].map((n) => n.textContent)).toContain("Speed");
    });
  });

  it("6. info panel is a calm spec sheet: no cyan tint, refill/drop as dt/dd, feature meanings only in the glossary (owner 2026-11-03)", () => {
    const tier = { ...product.tiers[1], id: 1, public_name: "Followers Global HQ · Akun berpostingan · Instant Start", quality: "hq" as const, refill_days: 30, refill_mode: "api" as const, drop_label: "less_drop" as const, refill_pct: 12, speed_per_day: null, avg_time: "8 jam", description: "Deskripsi layanan.", terms: "Jangan ganti username." };
    render(<ServiceInfoCard t={tier} productName="x" />);
    const card = screen.getByRole("region", { name: "Info layanan" });
    expect(card.className).toContain("border-white/[0.08]");
    expect(card.className).not.toMatch(/00E5FF/);
    const refillDt = within(card).getAllByText("Refill 30 Days", { selector: "dt" })[0];
    expect(refillDt.className).toContain("font-medium text-white/90");
    expect(refillDt.className).not.toContain("00E5FF");
    expect(refillDt.nextElementSibling!.tagName).toBe("DD");
    expect(within(card).getAllByText("Less Drop", { selector: "dt" })[0].nextElementSibling!.tagName).toBe("DD");
    // Pengajuan Refill menjadi sel statistik, bukan kalimat.
    const stat = within(card).getByText("Pengajuan Refill · 7 hari", { selector: "dt" });
    expect(stat.nextElementSibling!.textContent).toBe("12%");
    expect(stat.closest("dl")!.className).toContain("sm:divide-x");
    const details = within(card).getByText("Arti istilah").closest("details")!;
    for (const term of ["HQ", "Akun berpostingan", "Instant Start"]) {
      expect(within(card).getAllByText(term, { selector: "dt" }).every((n) => details.contains(n))).toBe(true);
      expect([...card.querySelectorAll("p")].some((p) => p.textContent?.startsWith(`${term} —`))).toBe(false);
    }
    expect([...card.querySelectorAll("p")].some((p) => /Persentase pesanan layanan ini yang diajukan Refill/.test(p.textContent ?? ""))).toBe(false);
    expect(details.textContent).toMatch(/Persentase pesanan layanan ini yang diajukan Refill/);
    const li = within(card).getByText("Jangan ganti username.");
    expect(li.className).toContain("before:bg-white/30");
    expect(li.parentElement!.className).not.toContain("list-disc");
    expect(within(card).getByRole("heading", { name: "Info layanan" }).className).toContain("uppercase tracking-[0.08em] text-white/45");
    expect(within(card).getByRole("heading", { name: "Syarat khusus" }).className).toContain("uppercase");
    expect(details.className).toContain("border-white/[0.06]");
  });

  it("5. the empty summary rail keeps the sentence but drops the duplicate 3-step list", () => {
    mount();
    expect(screen.getByText("Isi jumlah dan pilih layanan untuk melihat rincian pesananmu.")).toBeTruthy();
    const rail = document.querySelector("aside")!;
    expect(rail.querySelector("ol")).toBeNull();
    expect(rail.textContent).not.toContain("Tempel link tujuan");
    expect(rail.textContent).not.toContain("Bayar QRIS dan pantau status");
    expect(screen.getByRole("list", { name: "Langkah pesanan" })).toBeTruthy();
  });
});
