// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NeedPicker } from "@/components/pedia/NeedPicker";
import { ServicePicker } from "@/components/pedia/ServicePicker";
import { PlatformPageClient } from "@/app/pedia/p/[platform]/platform-client";
import { groupPediaMetrics, pediaVariantNames, shortPediaName } from "@/lib/pedia/display-name";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

vi.mock("@/components/pedia/usePediaPrices", () => ({ usePediaPrices: () => null }));
const metrics = ["followers", "likes", "views", "comments", "shares"];
function fixture(count = 60, kinds = metrics): PediaCatalogProduct[] {
  return Array.from({ length: count }, (_, i) => ({
    slug: `pedia-${i}`, platform: "instagram", metric: kinds[i % kinds.length], target_kind: "profile",
    name: `Instagram ${kinds[i % kinds.length]} [Max: Unlimited] [All Type Link] HQ ⚠ ★`,
    packages: [100], step: 1, min_price: 3000, is_featured: 0, tagline: null, image: null,
    checklist: [{ id: "public", label: "Akun publik" }],
    tiers: [{ id: i + 1, tier: "standar", label_note: null, eta_start: null, eta_finish: null, public_name: `Instagram ${kinds[i % kinds.length]} [Max: Unlimited] HQ ⚠ ★`, refill_days: 0, prices: { "100": 3000 }, min_qty: 1, max_qty: 10000 }],
  }));
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("catalog navigation at supplier scale", () => {
  it("does not rank one product's live quantity price against another's stored package price", () => {
    const products = fixture(2, ["followers"]);
    products[1].tiers[0].prices["100"] = 4000;
    render(<ServicePicker product={products[0]} products={products} tierId={1} qty={100} prices={{ 1: 9000 }} onSelect={vi.fn()} expanded />);
    expect(screen.getAllByRole<HTMLInputElement>("radio").map(radio => radio.value)).toEqual(["1", "2"]);
    expect(screen.getByText(/estimasi/i)).toBeTruthy();
  });
  it("cleans live names, decoration, chip labels and duplicates without empty output", () => {
    expect(shortPediaName("Instagram Video Views [Max: Unlimited] [All Type Link] ⚠ ⚠ ★🔥", "instagram")).toBe("Video Views");
    expect(shortPediaName("Instagram Followers [Tidak Bergaransi] ⚠ ⚠ ⚠", "instagram")).toBe("Followers");
    expect(shortPediaName("Instagram Instagram Followers Followers [Indonesia] Real HQ · No Refill · Instant Start", "instagram")).toBe("Followers Indonesia Real HQ");
    expect(shortPediaName("Instagram Komentar Custom [No Refill]", "instagram", "en")).toBe("Custom Comments");
    expect(shortPediaName("⚠")).toBeTruthy();
    expect(shortPediaName("")).toBe("Varian");
  });
  it("disambiguates collisions with a short unique qualifier, then neutral ordinals", () => {
    const products = fixture(11).filter((p) => p.metric === "followers");
    products[0].tiers[0].quality = "real";
    const names = pediaVariantNames(products, "en");
    expect(names.get(1)).toBe("followers HQ · real");
    expect(names.get(6)).toBe("followers HQ · Variant 2");
    expect(new Set(names.values()).size).toBe(3);
  });
  it("renders 620 products as distinct metric pills in first-appearance order; same metric is a no-op", () => {
    const manyMetrics = [...metrics, "subscribers", "members", "plays", "saves", "reactions", "connections", "visits", "listeners", "claps", "downloads", "forks", "traffic", "reposts", "quotes"];
    const products = fixture(620, manyMetrics), onChange = vi.fn();
    expect([...groupPediaMetrics(products).keys()]).toEqual(manyMetrics);
    const { rerender } = render(<NeedPicker products={products} slug="pedia-19" platform="Instagram" locked={false} onChange={onChange} />);
    const nav = screen.getByRole("navigation"), pills = within(nav).getAllByRole("button");
    expect(pills).toHaveLength(manyMetrics.length);
    expect(nav.textContent).not.toMatch(/[\[⚠]/);
    fireEvent.click(pills[0]); expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(pills[2]); expect(onChange).toHaveBeenLastCalledWith("pedia-2");
    rerender(<NeedPicker products={products} slug="pedia-19" platform="Instagram" locked onChange={onChange} />);
    expect(within(nav).getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
  it("limits rows to eight plus the selected variant and supports keyboard show-all", async () => {
    const products = fixture().filter((p) => p.metric === "followers"), onSelect = vi.fn();
    render(<ServicePicker product={products[10]} products={products} tierId={51} qty={100} onSelect={onSelect} expanded />);
    expect(screen.getAllByRole("radio")).toHaveLength(9);
    expect((screen.getByDisplayValue("51") as HTMLInputElement).checked).toBe(true);
    const toggle = screen.getByRole("button", { name: "Tampilkan semua (12)" });
    toggle.focus(); await userEvent.setup().keyboard("{Enter}");
    expect(screen.getAllByRole("radio")).toHaveLength(12);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan lebih sedikit" }));
    expect(screen.getAllByRole("radio")).toHaveLength(9);
    fireEvent.click(screen.getByDisplayValue("6"));
    expect(onSelect).toHaveBeenCalledWith(6, "pedia-5");
  });
  it("switches the real product+tier while retaining quantity, target, checks and contact", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const fetch = vi.fn(async () => new Response(JSON.stringify({ quote_token: "fixture", total: 4000, payable: 4000 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const products = fixture(11);
    render(<PlatformPageClient platform="instagram" name="Instagram" products={products} initialTarget="https://instagram.com/customer" ordersEnabled />);
    fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "100" } });
    fireEvent.click(screen.getByDisplayValue("1"));
    fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: isi target" })[0]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Akun publik" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: kontak" })[0]);
    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "081234567890" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Langkah 1: Layanan" }));
    fireEvent.click(screen.getByDisplayValue("6"));
    expect((screen.getByDisplayValue("6") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Jumlah yang dipesan") as HTMLInputElement).value).toBe("100");
    fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: isi target" })[0]);
    expect((screen.getByLabelText("Link profil Instagram") as HTMLInputElement).value).toBe("https://instagram.com/customer");
    expect((screen.getByRole("checkbox", { name: "Akun publik" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: kontak" })[0]);
    expect((screen.getByLabelText("Nomor WhatsApp") as HTMLInputElement).value).toBe("081234567890");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("buyer@example.com");
    fireEvent.click(screen.getByRole("checkbox", { name: /Saya setuju/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Lanjut ke pembayaran" })[0]);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/pedia/quote");
    expect(JSON.parse(String(options.body))).toEqual({ product_slug: "pedia-5", tier_id: 6, quantity: 100, target: "https://instagram.com/customer" });
  });
});
