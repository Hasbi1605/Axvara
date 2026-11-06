// @vitest-environment jsdom
// Grup gateway di picker (VA / E-Wallet / Lainnya) di ATAS Crypto, selaras bahasa visual grup crypto: header (judul 14px + keterangan biaya termurah +
// ubin logo persegi putih bertumpuk), baris (ubin 40×26 | nama pendek | "Biaya Rp x"), nonaktif Min./Maks., pencarian >8 baris, monogram tanpa logo.
// FIXTURE kontrak quote (bukan katalog merchant nyata); semua angka dari "server", klien tidak berhitung.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentMethodPicker } from "@/components/storefront/PaymentMethodPicker";
import { parsePayOptions } from "@/lib/payment-ui";
import { gatewayShortName, methodMonogram } from "@/lib/payments/method-logos";

afterEach(cleanup);
const norm = (t: string | null | undefined) => String(t ?? "").replace(/\s/g, " ");
const qrisM = { id: "qris", kind: "qris", label: "QRIS", sublabel: null, available: true };
const cryptoM = { id: "nowpayments:usdtbsc", kind: "crypto", label: "USDT", sublabel: "BNB Smart Chain", group: "stable", available: true, currency: "USD", amount_text: "5.62", pay_currency: "usdtbsc", network: "bsc", base_cents: 553, surcharge_cents: 9, total_cents: 562, surcharge_bps: 150, usd: { cents: "553", rate_text: "18087.80" } };
const gw = (code: string, label: string, group: string | undefined, fee: number, min = 10_000) => ({
  id: `sekalipay_gateway:${code}`, kind: "gateway", label, sublabel: "x", available: true, currency: "IDR", group,
  gateway: { idr_subtotal: 89_000, estimated_fee: fee, estimated_total: 89_000 + fee }, limits: { min, max: 10_000_000 },
});
const gwOff = (code: string, label: string, group: string, extra: Record<string, unknown> = {}) => ({
  id: `sekalipay_gateway:${code}`, kind: "gateway", label, sublabel: "x", available: false, currency: "IDR", group,
  gateway: { idr_subtotal: 5_000 }, limits: { min: 10_000, max: 10_000_000 }, unavailable_reason: "below_min", shortfall: 5_000, ...extra,
});
const VA = [gw("BCA", "BCA Virtual Account", "va", 4000), gw("BRI", "BRI VA", "va", 3500), gw("MDR", "Mandiri VA", "va", 4500), gw("BNI", "BNI Virtual Account", "va", 4000), gw("PRM", "Permata VA", "va", 4250), gw("CIMB", "CIMB Niaga VA", "va", 4000)];
const EW = [gw("OVO", "OVO", "ewallet", 1650), gw("DANA", "DANA", "ewallet", 1200), gw("SHP", "ShopeePay", "ewallet", 2000)];
const OTHER = [gw("BT", "Bank Transfer Lainnya", "other", 4850)];

function Harness({ raw, locale = "id", onSelectSpy, initial = null, disabled = false }: { raw: unknown[]; locale?: "id" | "en"; onSelectSpy?: (id: string | null) => void; initial?: string | null; disabled?: boolean }) {
  const [sel, setSel] = useState<string | null>(initial);
  return <PaymentMethodPicker options={parsePayOptions(raw)} selectedId={sel} locale={locale} disabled={disabled} onSelect={(id) => { onSelectSpy?.(id); setSel(id); }} />;
}
const groupBtns = () => screen.getAllByRole("button").filter((b) => (b.getAttribute("aria-controls") ?? "").startsWith("pay-group-")) as HTMLButtonElement[];
const headerBtn = (re: RegExp) => groupBtns().find((b) => re.test(b.getAttribute("aria-label") ?? ""))!;
const radios = () => screen.getAllByRole("radio", { hidden: true }) as HTMLInputElement[];
const checked = () => radios().filter((r) => r.checked);
const row = (code: string) => (document.querySelector(`input[value="sekalipay_gateway:${code}"]`) as HTMLInputElement).closest("label")!;
const radioOf = (code: string) => document.querySelector(`input[value="sekalipay_gateway:${code}"]`) as HTMLInputElement;
const panel = (key: string) => document.getElementById(`pay-group-${key}`)!;
const search = () => screen.queryByRole("textbox") as HTMLInputElement | null;

describe("urutan grup", () => {
  it("QRIS -> Virtual Account -> E-Wallet -> Lainnya -> Crypto (Lainnya hanya bila ada isinya)", () => {
    render(<Harness raw={[qrisM, cryptoM, ...OTHER, ...EW, ...VA]} />);
    expect(groupBtns().map((b) => b.getAttribute("aria-label")!.split(",")[0])).toEqual(["Virtual Account", "E-Wallet", "Lainnya", "Crypto"]);
    const fieldset = document.querySelector("fieldset")!;
    const order = Array.from(fieldset.querySelectorAll("label, button[aria-controls^=pay-group-]")).filter((el) => el.matches("button") || (el.querySelector("input") as HTMLInputElement | null)?.value === "qris");
    expect(order[0].querySelector("input")!.value).toBe("qris");
    cleanup();
    render(<Harness raw={[qrisM, cryptoM, ...EW, ...VA]} />);
    expect(groupBtns().map((b) => b.getAttribute("aria-label")!.split(",")[0])).toEqual(["Virtual Account", "E-Wallet", "Crypto"]);
    cleanup();
    render(<Harness raw={[qrisM, ...OTHER]} locale="en" />);
    expect(groupBtns().map((b) => b.getAttribute("aria-label")!.split(",")[0])).toEqual(["Other"]);
  });

  it("tanpa catatan panjang di bawah picker (gatewayNote dihapus)", () => {
    render(<Harness raw={[qrisM, ...VA, cryptoM]} />);
    expect(norm(document.body.textContent)).not.toMatch(/Biaya & total estimasi|total akhir kamu setujui|Fees and totals are estimates/);
  });
});

describe("header tertutup", () => {
  it("judul 14px semibold (huruf biasa), keterangan 'Biaya mulai Rp 3.500' = termurah dari server, maksimal 4 ubin logo persegi putih bertumpuk + '+N'", () => {
    render(<Harness raw={[qrisM, ...VA, cryptoM]} />);
    const h = headerBtn(/^Virtual Account/);
    expect(h.getAttribute("aria-expanded")).toBe("false");
    expect(norm(h.textContent)).toBe("Virtual AccountBiaya mulai Rp 3.500+2");
    const title = Array.from(h.querySelectorAll("span")).find((el) => el.textContent === "Virtual Account")!;
    expect(title.className).toMatch(/text-\[14px\]/); expect(title.className).toContain("font-semibold"); expect(title.className).not.toMatch(/uppercase|tracking-/);
    const tiles = h.querySelectorAll("[data-bank-chips] [data-bank-tile]");
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) { expect(tile.className).toContain("rounded-md"); expect(tile.className).not.toContain("rounded-full"); expect(tile.className).toContain("ring-2"); }
    expect(h.querySelector("[data-bank-chips] .-space-x-2")).toBeTruthy();
    expect(Array.from(h.querySelectorAll("[data-bank-tile] img")).map((i) => i.getAttribute("src"))).toEqual(["/payments/bca.svg", "/payments/bri.svg", "/payments/mandiri.svg", "/payments/bni.svg"]);
    expect(h.getAttribute("aria-label")).toBe("Virtual Account, 6 metode, 6 tersedia");
  });

  it("EN: 'Fees from Rp 1,200'; gratis = 'No fees'; tanpa kanal tersedia = 'Belum tersedia untuk nominal ini' (kuning) / 'Not available for this amount yet'", () => {
    const { unmount } = render(<Harness raw={[qrisM, ...EW]} locale="en" />);
    expect(norm(headerBtn(/^E-Wallet/).textContent)).toContain("Fees from Rp 1,200");
    unmount();
    render(<Harness raw={[qrisM, gw("F", "OVO", "ewallet", 0)]} />);
    expect(norm(headerBtn(/^E-Wallet/).textContent)).toContain("Tanpa biaya");
    cleanup();
    render(<Harness raw={[qrisM, gwOff("O", "OVO", "ewallet")]} />);
    const h = headerBtn(/^E-Wallet/);
    expect(norm(h.textContent)).toContain("Belum tersedia untuk nominal ini");
    expect(h.querySelector("[data-group-caption]")!.className).toContain("text-[#FFD66B]");
    cleanup();
    render(<Harness raw={[qrisM, gwOff("O", "OVO", "ewallet")]} locale="en" />);
    expect(norm(headerBtn(/^E-Wallet/).textContent)).toContain("Not available for this amount yet");
  });
});

describe("baris terbuka", () => {
  it("ubin logo 40×26 + nama pendek (akhiran Virtual Account/VA dibuang di grup VA, tidak di E-Wallet) + 'Biaya Rp x'; min-h 48px; tanpa sublabel server", () => {
    render(<Harness raw={[qrisM, ...VA, ...EW, ...OTHER, cryptoM]} />);
    fireEvent.click(headerBtn(/^Virtual Account/));
    expect(norm(row("BCA").textContent)).toBe("BCABiaya Rp 4.000");
    expect(norm(row("BRI").textContent)).toBe("BRIBiaya Rp 3.500");
    expect(norm(row("CIMB").textContent)).toBe("CIMB NiagaBiaya Rp 4.000");
    expect(norm(row("OVO").textContent)).toBe("OVOBiaya Rp 1.650"); // grup E-Wallet: nama apa adanya
    for (const code of ["BCA", "BRI", "MDR", "OVO", "BT"]) {
      const r = row(code);
      for (const cls of ["grid-cols-[40px_minmax(0,1fr)_auto]", "min-h-[48px]", "rounded-xl"]) expect(r.className, `${code} ${cls}`).toContain(cls);
      const tile = r.querySelector("[data-bank-tile]")!;
      expect(tile.className).toContain("h-[26px]"); expect(tile.className).toContain("w-10"); expect(tile.className).toContain("rounded-md");
      expect(r.querySelector("input")!.className).toContain("sr-only"); // radio native
    }
    expect(row("BCA").querySelector("[data-bank-tile]")!.className).toContain("bg-white");
    expect(norm(panel("va").textContent)).not.toContain("Virtual Account"); // tidak mengulang judul grup di tiap baris
    expect(norm(document.body.textContent)).not.toContain("Estimasi biaya pembayaran"); // sublabel server tidak dirender
    expect(panel("va").querySelector("[data-bank-tile]")).toBeTruthy();
  });

  it("memilih: ring cyan + titik radio (tanpa garis kiri/wash); onSelect = ID quote; satu radio terpilih", () => {
    const spy = vi.fn();
    render(<Harness raw={[qrisM, ...VA, cryptoM]} onSelectSpy={spy} initial="qris" />);
    fireEvent.click(headerBtn(/^Virtual Account/));
    fireEvent.click(radioOf("BRI"));
    expect(spy).toHaveBeenLastCalledWith("sekalipay_gateway:BRI");
    expect(row("BRI").className).toContain("ring-[#00E5FF]/50");
    expect(row("BRI").className).not.toMatch(/border-l|bg-\[#00E5FF\]/);
    expect(row("BRI").querySelector("span[aria-hidden].rounded-full.border-2")!.className).toContain("bg-[#00E5FF]");
    expect(checked().map((r) => r.value)).toEqual(["sekalipay_gateway:BRI"]);
  });

  it("di bawah minimum / di atas maksimum: redup, tak bisa dipilih lewat klik/keyboard, 'Min. Rp 10.000' / 'Maks. Rp …' di kanan, alasan server sr-only", () => {
    const spy = vi.fn();
    const over = gwOff("OVER", "Mandiri VA", "va", { unavailable_reason: "above_max", shortfall: undefined, limits: { min: 100, max: 249_999 } });
    render(<Harness raw={[qrisM, gw("OK", "BCA VA", "va", 4000), gwOff("LOW", "BRI VA", "va"), over]} onSelectSpy={spy} />);
    fireEvent.click(headerBtn(/^Virtual Account/));
    const low = radioOf("LOW");
    expect(low.disabled).toBe(true);
    const lowRow = row("LOW");
    expect(lowRow.getAttribute("aria-disabled")).toBe("true");
    expect(lowRow.className).toContain("opacity-55"); expect(lowRow.className).toContain("cursor-not-allowed");
    expect(norm(lowRow.textContent)).toBe("BRIMin. Rp 10.000Tambah Rp 5.000 untuk metode ini");
    expect(document.getElementById(low.getAttribute("aria-describedby")!)!.className).toContain("sr-only");
    expect(norm(row("OVER").textContent)).toContain("Maks. Rp 249.999");
    expect(norm(document.getElementById(radioOf("OVER").getAttribute("aria-describedby")!)!.textContent)).toBe("Melebihi maks. Rp 249.999");
    fireEvent.click(lowRow); fireEvent.click(low); fireEvent.keyDown(low, { key: " " }); fireEvent.keyDown(low, { key: "Enter" });
    fireEvent.click(radioOf("OVER"));
    expect(spy).not.toHaveBeenCalled();
    expect(checked()).toHaveLength(0);
    // tersedia dulu, lalu nonaktif
    expect(Array.from(panel("va").querySelectorAll("input")).map((i) => i.value.replace("sekalipay_gateway:", ""))).toEqual(["OK", "LOW", "OVER"]);
  });

  it("tanpa logo terverifikasi = monogram netral dari nama (bukan logo merek lain): 'DANA' -> DA, 'ShopeePay' -> SH, 'Channel Rahasia' -> CR; tanpa <img>", () => {
    render(<Harness raw={[qrisM, ...EW, gw("BCA_VA", "Channel Rahasia", "other", 3000)]} />);
    fireEvent.click(headerBtn(/^E-Wallet/));
    fireEvent.click(headerBtn(/^Lainnya/));
    const mono = (code: string) => row(code).querySelector("[data-bank-tile][data-monogram]") as HTMLElement;
    expect(mono("DANA").textContent).toBe("DA");
    expect(mono("SHP").textContent).toBe("SH");
    expect(mono("BCA_VA").textContent).toBe("CR"); // ID memuat BCA tetapi label tidak dikenal
    for (const code of ["DANA", "SHP", "BCA_VA"]) { expect(mono(code).querySelector("img")).toBeNull(); expect(mono(code).className).toContain("bg-[#252E52]"); }
    expect(row("OVO").querySelector('[data-bank-tile] img[src="/payments/ovo.svg"]')).toBeTruthy(); // logo terverifikasi tetap dipakai
    expect(row("OVO").querySelector("[data-monogram]")).toBeNull();
  });

  it("helper nama pendek + monogram", () => {
    expect(gatewayShortName("BCA Virtual Account", "va")).toBe("BCA");
    expect(gatewayShortName("Mandiri VA", "va")).toBe("Mandiri");
    expect(gatewayShortName("Virtual Account", "va")).toBe("Virtual Account"); // tidak dikosongkan
    expect(gatewayShortName("Gopay VA", "ewallet")).toBe("Gopay VA");
    expect(methodMonogram("DANA")).toBe("DA");
    expect(methodMonogram("Bank Transfer Lainnya")).toBe("BT");
    expect(methodMonogram("  ")).toBe("•");
  });
});

describe("pencarian grup gateway (hanya bila > 8 baris)", () => {
  const many = Array.from({ length: 9 }, (_, i) => gw(`B${i}`, ["BNI VA", "Mandiri VA", "Permata VA", "BRI VA", "BCA VA", "CIMB VA", "Danamon VA", "BSI VA", "SeaBank VA"][i], "va", 4000));
  it("8 baris: tanpa pencarian; 9 baris: ada, berlabel aksesibel, 44px; filter nama; kosong -> teks; hapus; ditutup = dikosongkan", () => {
    render(<Harness raw={[qrisM, ...many.slice(0, 8)]} />);
    fireEvent.click(headerBtn(/^Virtual Account/));
    expect(search()).toBeNull();
    cleanup();
    render(<Harness raw={[qrisM, ...many]} />);
    fireEvent.click(headerBtn(/^Virtual Account/));
    const input = screen.getByLabelText("Cari metode pembayaran", { selector: "input" }) as HTMLInputElement;
    expect(input.className).toContain("h-11"); expect(input.className).toContain("w-full");
    const visible = () => Array.from(panel("va").querySelectorAll("input[type=radio]")).map((i) => (i as HTMLInputElement).value.replace("sekalipay_gateway:", ""));
    expect(visible()).toHaveLength(9);
    fireEvent.change(input, { target: { value: "ba" } });
    expect(visible()).toEqual(["B8"]); // "ba" hanya cocok dengan SeaBank
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(visible()).toHaveLength(0);
    expect(screen.getByText("Tidak ada metode yang cocok.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hapus pencarian" }));
    expect(input.value).toBe("");
    expect(visible()).toHaveLength(9);
    fireEvent.change(input, { target: { value: "bri" } });
    expect(visible()).toEqual(["B3"]);
    fireEvent.click(headerBtn(/^Virtual Account/)); // tutup grup
    expect(search()).toBeNull(); // panel tertutup inert/aria-hidden
    expect((document.getElementById("pay-va-search") as HTMLInputElement).value).toBe("");
  });
});

describe("akordeon: exclusive-open, hapus pilihan saat ditutup, gerak 220ms", () => {
  it("keyboard: Enter membuka grup, Tab memilih kanal tersedia, Spasi memilih; panel tertutup tetap inert", async () => {
    const user = userEvent.setup();
    render(<Harness raw={[qrisM, ...VA, gwOff("LOW", "Bank fixture VA", "va"), ...EW, cryptoM]} />);
    const header = headerBtn(/^Virtual Account/);
    header.focus();
    await user.keyboard("{Enter}");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    await user.tab();
    expect(document.activeElement).toBe(radioOf("BCA"));
    await user.keyboard(" ");
    expect(checked().map((r) => r.value)).toEqual(["sekalipay_gateway:BCA"]);
    expect(radioOf("LOW").disabled).toBe(true);
    header.focus();
    await user.keyboard(" ");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(panel("va").hasAttribute("inert")).toBe(true);
    expect(checked()).toHaveLength(0);
    expect(document.activeElement).toBe(header);
  });

  it("membuka grup lain menutup gateway dan menghapus pilihannya; menutup menghapus pilihan; QRIS tidak tersentuh; panel tertutup tetap terpasang tetapi inert + aria-hidden", () => {
    const spy = vi.fn();
    render(<Harness raw={[qrisM, ...VA, ...EW, cryptoM]} initial="qris" onSelectSpy={spy} />);
    expect(panel("va").getAttribute("aria-hidden")).toBe("true");
    expect(panel("va").hasAttribute("inert")).toBe(true);
    expect(panel("va").querySelectorAll("input").length).toBe(6); // terpasang
    expect(panel("va").className).toContain("duration-[220ms]");
    fireEvent.click(headerBtn(/^Virtual Account/));
    expect(panel("va").getAttribute("data-collapse")).toBe("open");
    fireEvent.click(radioOf("BCA"));
    expect(checked().map((r) => r.value)).toEqual(["sekalipay_gateway:BCA"]);
    fireEvent.click(headerBtn(/^E-Wallet/)); // buka E-Wallet = tutup VA + hapus pilihan VA
    expect(panel("va").getAttribute("data-collapse")).toBe("closed");
    expect(panel("ewallet").getAttribute("data-collapse")).toBe("open");
    expect(spy).toHaveBeenLastCalledWith(null);
    expect(checked()).toHaveLength(0);
    fireEvent.click(radioOf("OVO"));
    fireEvent.click(headerBtn(/^E-Wallet/)); // tutup grup terpilih
    expect(checked()).toHaveLength(0);
    expect(spy).toHaveBeenLastCalledWith(null);
  });

  it("terkunci (disabled): header tidak bisa menutup, baris tak bisa dipilih; pilihan dipulihkan membuka grup", () => {
    const spy = vi.fn();
    render(<Harness raw={[qrisM, ...VA, cryptoM]} initial="sekalipay_gateway:BCA" disabled onSelectSpy={spy} />);
    expect(headerBtn(/^Virtual Account/).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(headerBtn(/^Virtual Account/));
    fireEvent.click(radioOf("BRI"));
    expect(spy).not.toHaveBeenCalled();
    expect(radioOf("BCA").checked).toBe(true);
  });
});
