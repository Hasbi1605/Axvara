// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OrderClient } from "@/app/pedia/o/[slug]/order-client";
import { ServicePicker } from "@/components/pedia/ServicePicker";
import { renderToStaticMarkup } from "react-dom/server";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

vi.mock("@/components/pedia/usePediaPrices", () => ({ usePediaPrices: () => null }));

const product: PediaCatalogProduct = {
  slug: "followers-instagram", name: "Followers Instagram", platform: "instagram", metric: "followers", target_kind: "profile",
  tagline: "Followers untuk profil publik", packages: [100, 250, 500], step: 10, is_featured: 1, min_price: 2000,
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
  fireEvent.click(screen.getByRole("radio", { name: /Followers Indonesia Stabil/i }));
  fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "250" } });
}
function toTarget() { fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: isi target" })[0]); }
function next() {
  if (screen.queryAllByRole("button", { name: "Lanjut: isi target" }).length) toTarget();
  if (screen.queryAllByRole("button", { name: "Lanjut: kontak" }).length) fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: kontak" })[0]);
}
function back() { fireEvent.click(screen.getByRole("button", { name: "Ubah pesanan" })); }
function complete() {
  select(); toTarget();
  fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
  next();
  if (!screen.queryByLabelText("Nomor WhatsApp")) return;
  fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "081234567890" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Saya setuju/ }));
}
function proceed() { fireEvent.click(screen.getAllByRole("button", { name: /^(Lanjut ke pembayaran|Coba lanjutkan pembayaran|Lanjut: isi target|Lanjut: kontak)$/ })[0]); }
function consent() { fireEvent.click(screen.getAllByRole("button", { name: "Setujui & lanjut ke pembayaran" })[0]); }
async function getQuote() {
  proceed();
  await screen.findAllByText(/Total pembayaran/);
}

describe("Pedia order UX", () => {
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
    expect(document.getElementById("pedia-target-help")?.textContent).toBe("Gunakan format link seperti contoh pada kolom. Masukkan link profil Instagram. Pastikan akun tidak privat.");
    expect(screen.getByText("Format link sesuai. Akun atau konten belum diverifikasi.")).toBeTruthy();
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
    expect(document.body.textContent).toContain("Rp28.000 /1.000");
    expect(document.body.textContent).not.toContain("Rp20.000 /1.000");
    expect(document.body.textContent).toContain("harga min. 100 · bukan pembanding antar layanan");
    expect(document.body.textContent).toContain("Acuan per 1.000 · total mengikuti jumlah");
    expect(document.body.textContent).not.toMatch(/HYPE|Paling dipilih|Rp0|Paket tidak tersedia/i);
    expect(document.body.textContent).not.toContain("Belum dipilih");
    expect(screen.getByText("Pesananmu dimulai di sini.")).toBeTruthy();
    // Jumlah bisa diisi SEBELUM layanan dipilih; contoh hanya angka valid produk.
    const qtyInput = screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement;
    expect(qtyInput.disabled).toBe(false);
    expect(qtyInput.getAttribute("placeholder")).toContain("Contoh:");
    expect(document.body.textContent).not.toContain("Isi jumlah dulu");
    expect(document.body.textContent).toContain("Pilih layanan untuk melihat batas jumlah per pesanan.");
    expect(screen.getByText("Refill 30 hari").className).toContain("text-[#00E5FF]");
    expect(screen.getByText("Tanpa refill", { selector: "span" }).className).toContain("text-white/60");
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
    expect(screen.getByRole("radio", { name: /Followers Indonesia Stabil/i }).closest("label")!.textContent).toContain("untuk 250");
    expect(screen.getByRole("radio", { name: /Followers Global Ekonomis/i }).closest("label")!.textContent).toContain("Jumlah tidak tersedia");
    fireEvent.click(screen.getByRole("radio", { name: /Followers Indonesia Stabil/i }));
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

    const incompatible = screen.getByRole("radio", { name: /Followers Global Ekonomis/i }) as HTMLInputElement;
    expect(incompatible.disabled).toBe(true);
    fireEvent.click(incompatible);
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("250");
    expect((screen.getByRole("radio", { name: /Followers Indonesia Stabil/i }) as HTMLInputElement).checked).toBe(true);
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
    fireEvent.click(screen.getByRole("radio", { name: /Followers Global Ekonomis/i }));
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
    expect((await screen.findByRole("alert")).textContent).toContain("data yang sama");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30 * 60_000);
    fetchMock.mockResolvedValueOnce(reply({ error: "Unavailable" }, status));
    proceed();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Unavailable"));
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
    expect((screen.getByLabelText("Email").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  });

  it("preserves same token when order JSON is malformed or success code is missing", async () => {
    mount(); complete(); await getQuote();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("truncated JSON"); } });
    consent(); await screen.findByRole("alert");
    fetchMock.mockResolvedValueOnce(reply({ code: "bad" }));
    proceed();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Respons pesanan belum lengkap"));
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
  it("shows three real offers first, exposes all alternatives with visible chip filters and result count", () => {
    render(<ServicePicker product={many} tierId={null} onSelect={vi.fn()} qty={null} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getAllByRole("radio")[0].getAttribute("value")).toBe("5");
    expect(screen.getByRole("status").textContent).toContain("7 dari 7 layanan");
    expect(screen.getByRole("button", { name: "Semua" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lihat semua 7 layanan" }));
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Indonesia" }));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(document.getElementById("pedia-tier")?.textContent).not.toMatch(/Layanan 1|Layanan 3|Layanan 5|Layanan 7/);
    fireEvent.click(screen.getByRole("button", { name: "Reset filter" }));
    expect(screen.getByRole("status").textContent).toContain("7 dari 7 layanan");
  });

  it("has one active category and switches between region and refill instead of intersecting them", () => {
    const onSelect = vi.fn();
    const tiers: PediaCatalogProduct["tiers"] = [product.tiers[0], product.tiers[1],
      { ...product.tiers[1], id: 3, public_name: "Global refill", region: "global" },
      { ...product.tiers[0], id: 4, public_name: "Indonesia tanpa refill", region: "indonesia" },
      { ...product.tiers[0], id: 5, public_name: "Campuran", region: "mixed" }];
    render(<ServicePicker product={{ ...product, tiers }} tierId={2} onSelect={onSelect} qty={100} expanded />);
    const categories = screen.getByRole("group", { name: "Kategori layanan" });
    const offers = () => screen.getAllByRole("radio").map((r) => r.getAttribute("value")).sort();
    for (const [label, ids] of [["Semua", ["1", "2", "3", "4", "5"]], ["Global", ["1", "3"]], ["Refill", ["2", "3"]], ["Indonesia", ["2", "4"]], ["Indonesia", ["2", "4"]], ["Semua", ["1", "2", "3", "4", "5"]]] as const) {
      fireEvent.click(within(categories).getByRole("button", { name: label }));
      expect(within(categories).getAllByRole("button", { pressed: true }).map((b) => b.textContent)).toEqual([label]);
      expect(offers()).toEqual(ids);
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect((screen.getByRole("radio", { name: /Indonesia Stabil/ }) as HTMLInputElement).checked).toBe(true);
    const count = screen.getByTestId("pedia-filter-count");
    expect(screen.getAllByRole("radio").at(-1)!.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("· harga untuk 100")).toBeTruthy();
    expect(within(categories).queryByRole("button", { name: "Tanpa refill" })).toBeNull();
  });

  it("resets the active category and advanced filters without changing the selected offer", () => {
    const onSelect = vi.fn();
    render(<ServicePicker product={product} tierId={2} onSelect={onSelect} qty={100} expanded />);
    fireEvent.click(screen.getByRole("button", { name: "Global" }));
    fireEvent.click(screen.getByText(/Lanjutan: jenis akun/));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter jenis akun" }), { target: { value: "ekonomis" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset filter" }));
    const categories = screen.getByRole("group", { name: "Kategori layanan" });
    expect(within(categories).getAllByRole("button", { pressed: true })[0].textContent).toBe("Semua");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect((screen.getByRole("combobox", { name: "Filter jenis akun" }) as HTMLSelectElement).value).toBe("");
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
    const limited = screen.getByRole("radio", { name: /Followers Global Ekonomis/ }).closest("label")!;
    const eligible = screen.getByRole("radio", { name: /Followers Indonesia Stabil/ }).closest("label")!;
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

  it("retains the current selection when comparison filters exclude it", () => {
    const { rerender } = render(<ServicePicker product={many} tierId={null} onSelect={vi.fn()} qty={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Global" }));
    rerender(<ServicePicker product={many} tierId={2} onSelect={vi.fn()} qty={100} />);
    expect(screen.getByRole("radio").getAttribute("value")).toBe("2");
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Ganti layanan" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ganti layanan" }));
    expect(screen.getByRole("status").textContent).toContain("4 dari 7 layanan");
    expect(screen.getByRole("button", { name: "Global" }).getAttribute("aria-pressed")).toBe("true");
  });
});
