// @vitest-environment jsdom
// Pemilih crypto (desain): satu baris per SIMBOL; simbol multi-jaringan diperluas menjadi pilihan jaringan EKSPLISIT (tanpa jaringan bawaan).
// Header tertutup (judul + total USD + chip logo bulat), akordeon exclusive, pencarian (>8 baris simbol), baris/jaringan di bawah minimum nonaktif.
// FIXTURE kontrak quote; semua angka dari "server", klien tidak berhitung.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentMethodPicker } from "@/components/storefront/PaymentMethodPicker";
import { parsePayOptions } from "@/lib/payment-ui";
import { CRYPTO_ASSETS } from "@/lib/payments/crypto-assets";

afterEach(cleanup);
// jsdom belum punya CSS.escape (dipakai user-event untuk navigasi panah antar radio).
if (!(globalThis as { CSS?: { escape?: unknown } }).CSS) (globalThis as { CSS?: unknown }).CSS = {};
if (!(globalThis as unknown as { CSS: { escape?: unknown } }).CSS.escape) (globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS.escape = (v: string) => v.replace(/([^\w-])/g, "\\$1");

const norm = (t: string | null | undefined) => String(t ?? "").replace(/\s/g, " ");
const qrisM = { id: "qris", kind: "qris", label: "QRIS", sublabel: null, available: true };
const gwM = { id: "sekalipay_gateway:BCA_VA", kind: "gateway", label: "BCA Virtual Account", sublabel: "x", available: true, group: "va", currency: "IDR", gateway: { idr_subtotal: 250_000, estimated_fee: 4000, estimated_total: 254_000 }, limits: { min: 10_000, max: null } };

const MIN_TEXT: Record<string, [string, number]> = { btc: ["3.10", 50_000], ton: ["2.25", 36_000], usdcsol: ["2.30", 37_000], fdusdbsc: ["2.60", 42_000], fdusderc20: ["2.40", 38_000] };
const coin = (ticker: string, below: Set<string>) => {
  const a = CRYPTO_ASSETS.find((x) => x.ticker === ticker)!;
  const common = { id: `nowpayments:${a.ticker}`, kind: "crypto", label: a.symbol, sublabel: a.networkLabel, group: a.group, currency: "USD", pay_currency: a.ticker, network: a.network, account_number: "" };
  if (below.has(ticker)) {
    const [text, idr] = MIN_TEXT[ticker];
    return { ...common, available: false, unavailable_reason: "below_min", min_total_cents: Math.round(Number(text) * 100), min_total_text: text, min_idr_subtotal: idr };
  }
  return { ...common, available: true, amount_text: "12.48", base_cents: 1230, surcharge_cents: 18, total_cents: 1248, surcharge_bps: 150, fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true, usd: { cents: "1230", rate_text: "18087.80" } };
};
const DEFAULT_BELOW = new Set(["btc", "ton", "usdcsol"]);
const allCoins = (below: Set<string> = DEFAULT_BELOW) => CRYPTO_ASSETS.map((a) => coin(a.ticker, below));

function Harness({ raw, locale = "id", onSelectSpy, initial = null }: { raw: unknown[]; locale?: "id" | "en"; onSelectSpy?: (id: string | null) => void; initial?: string | null }) {
  const [sel, setSel] = useState<string | null>(initial);
  return <PaymentMethodPicker options={parsePayOptions(raw)} selectedId={sel} locale={locale} onSelect={(id) => { onSelectSpy?.(id); setSel(id); }} />;
}
const headerBtn = (re: RegExp) => screen.getAllByRole("button").find((b) => (b.getAttribute("aria-controls") ?? "").startsWith("pay-group-") && re.test(b.getAttribute("aria-label") ?? ""))!;
const radios = () => screen.getAllByRole("radio", { hidden: true }) as HTMLInputElement[];
const coinRadios = () => radios().filter((r) => r.value.startsWith("nowpayments:"));
const checked = () => radios().filter((r) => r.checked);
const radioOf = (ticker: string) => document.querySelector(`input[value="nowpayments:${ticker}"]`) as HTMLInputElement | null;
const expandBtn = (symbol: string) => screen.getAllByRole("button", { hidden: true }).find((b) => b.getAttribute("aria-expanded") !== null && new RegExp(`^${symbol}\\b`).test(norm(b.textContent)) && !(b.getAttribute("aria-controls") ?? "").startsWith("pay-group-")) as HTMLButtonElement;
const blockedBtn = (symbol: string) => screen.getAllByRole("button", { hidden: true }).find((b) => new RegExp(`^${symbol}\\b`).test(norm(b.textContent)) && b.hasAttribute("disabled")) as HTMLButtonElement;
const symbolRows = () => Array.from(document.querySelectorAll("#pay-group-crypto [role=group] > div > *")).map((el) => norm((el.matches("label") ? el : el.querySelector(":scope > button"))!.textContent));
// Isi tertutup tetap terpasang (animasi) tetapi aria-hidden + inert: tak muncul di query aksesibel biasa.
const netGroup = (name: string) => screen.queryByRole("radiogroup", { name });
const visibleRadios = () => screen.queryAllByRole("radio") as HTMLInputElement[];
const visibleCoinRadios = () => visibleRadios().filter((r) => r.value.startsWith("nowpayments:"));
const search = () => screen.queryByRole("textbox", { hidden: true }) as HTMLInputElement | null;
const openGroup = () => fireEvent.click(headerBtn(/^Crypto/));

describe("crypto picker: header tertutup", () => {
  it("judul 'Crypto' bergaya sama dengan 'QRIS Dinamis' (14px semibold, huruf biasa) + keterangan total + 4 chip bulat + '+N' simbol tersisa", () => {
    render(<Harness raw={[qrisM, ...allCoins()]} />);
    const head = headerBtn(/^Crypto/);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(norm(head.textContent)).toBe("CryptoUS$12,48 · termasuk biaya layanan 1,5%+8"); // 12 simbol - 4 chip
    const title = Array.from(head.querySelectorAll("span")).find((el) => el.textContent === "Crypto")!;
    expect(title.className).toContain("text-[14px]");
    expect(title.className).toContain("font-semibold");
    expect(title.className).not.toMatch(/uppercase|tracking-/);
    const logos = Array.from(head.querySelectorAll("[data-coin-chips] img")).map((img) => img.getAttribute("src"));
    expect(logos).toEqual(["/payments/coins/btc.svg", "/payments/coins/eth.svg", "/payments/coins/usdtbsc.svg", "/payments/coins/usdc.svg"]);
    for (const span of head.querySelectorAll("[data-coin-chips] [data-coin-logo]")) expect(span.className).toContain("rounded-full");
    expect(head.querySelector("[data-coin-chips] .-space-x-1\\.5")).toBeTruthy();
  });

  it("EN: 'incl. 1.5% service fee'; tanpa koin tersedia tidak ada keterangan jumlah", () => {
    const { unmount } = render(<Harness raw={[qrisM, ...allCoins()]} locale="en" />);
    expect(norm(headerBtn(/^Crypto/).textContent)).toContain("US$12.48 · incl. 1.5% service fee");
    unmount();
    render(<Harness raw={[qrisM, coin("btc", DEFAULT_BELOW), coin("ton", DEFAULT_BELOW)]} />);
    expect(headerBtn(/^Crypto/).querySelector("[data-crypto-caption]")).toBeNull();
  });
});

describe("crypto picker: baris per simbol", () => {
  it("12 baris simbol (bukan 28): populer lalu stablecoin; simbol satu jaringan = radio langsung, multi-jaringan = tombol '9 jaringan'/'8 jaringan'/'2 jaringan'; tanpa jumlah USD per baris", () => {
    render(<Harness raw={[qrisM, ...allCoins()]} />);
    openGroup();
    expect(symbolRows()).toEqual([
      // Populer: simbol tersedia dulu (urutan kurasi), lalu yang semuanya di bawah minimum (teks alasan = sr-only)
      "ETH Ethereum", "BNB BNB Smart Chain", "TRX Tron", "LTC Litecoin",
      "BTC BitcoinMin. US$3,10≈ Rp 50.000Belanja minimal US$3,10 (± Rp 50.000) untuk koin ini",
      "TONMin. US$2,25≈ Rp 36.000Belanja minimal US$2,25 (± Rp 36.000) untuk koin ini",
      // Stablecoin
      "USDT 9 jaringan", "USDC 8 jaringan", "DAI Arbitrum One", "PYUSD Ethereum (ERC20)", "FDUSD 2 jaringan", "USDP Ethereum (ERC20)",
    ]);
    // tidak ada chip jaringan sebelum simbol dibuka
    expect(netGroup("Jaringan USDT")).toBeNull();
    expect(visibleCoinRadios().map((r) => r.value.replace("nowpayments:", ""))).toEqual(["eth", "bnbbsc", "trx", "ltc", "btc", "ton", "daiarb", "pyusd", "usdp"]); // chip jaringan tertutup tidak terlihat/terfokus
    expect(coinRadios().length).toBe(28); // tetap terpasang (animasi tutup) namun inert + aria-hidden
    expect(document.querySelector("#pay-net-USDT")!.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("#pay-net-USDT")!.hasAttribute("inert")).toBe(true);
    expect(expandBtn("USDT").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("#pay-group-crypto")!.textContent).not.toMatch(/US\$12\.48/);
    expect(checked()).toHaveLength(0);
  });

  it("simbol satu jaringan: klik memilih opsi itu langsung; baris terpilih = ring cyan + titik radio (tanpa garis kiri/wash)", () => {
    const spy = vi.fn();
    render(<Harness raw={[qrisM, ...allCoins()]} onSelectSpy={spy} />);
    openGroup();
    const eth = radioOf("eth")!;
    fireEvent.click(eth);
    expect(spy).toHaveBeenLastCalledWith("nowpayments:eth");
    const label = eth.closest("label")!;
    expect(label.className).toContain("ring-[#00E5FF]/50");
    expect(label.className).not.toMatch(/border-l|bg-\[#00E5FF\]/);
    expect(label.className).toContain("min-h-[48px]");
    expect(label.querySelector("[data-coin-logo] img")!.getAttribute("width")).toBe("24");
    expect(checked()).toEqual([eth]);
    expect(document.querySelector("fieldset")!.innerHTML).not.toMatch(/border-l-/);
  });

  it("simbol satu jaringan di bawah minimum: baris redup nonaktif dengan 'Min. US$x' + '≈ Rp', tak bisa dipilih lewat klik/keyboard", () => {
    const spy = vi.fn();
    render(<Harness raw={[qrisM, ...allCoins()]} onSelectSpy={spy} />);
    openGroup();
    const btc = radioOf("btc")!;
    const label = btc.closest("label")!;
    expect(btc.disabled).toBe(true);
    expect(label.getAttribute("aria-disabled")).toBe("true");
    expect(label.className).toMatch(/opacity-55/);
    expect(label.className).toContain("cursor-not-allowed");
    expect(norm(label.textContent)).toContain("Min. US$3,10");
    expect(norm(label.textContent)).toContain("≈ Rp 50.000");
    fireEvent.click(label); fireEvent.click(btc); fireEvent.keyDown(btc, { key: " " }); fireEvent.keyDown(btc, { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
    expect(btc.checked).toBe(false);
  });
});

describe("crypto picker: simbol multi-jaringan -> pilihan jaringan eksplisit", () => {
  it("membuka simbol menampilkan radiogroup 'Jaringan USDT' tepat di bawah barisnya dengan 9 chip berlabel jaringan; TIDAK ada jaringan bawaan dan tidak ada yang terpilih", () => {
    const spy = vi.fn();
    render(<Harness raw={[qrisM, ...allCoins()]} onSelectSpy={spy} />);
    openGroup();
    fireEvent.click(expandBtn("USDT"));
    expect(expandBtn("USDT").getAttribute("aria-expanded")).toBe("true");
    const group = netGroup("Jaringan USDT")!;
    const collapse = group.closest("[data-collapse]")!;
    expect(collapse.previousElementSibling).toBe(expandBtn("USDT")); // tepat di bawah baris simbol
    expect(collapse.getAttribute("data-collapse")).toBe("open");
    const labels = within(group).getAllByRole("radio", { hidden: true }).map((r) => norm(r.closest("label")!.textContent));
    expect(labels).toEqual(["BNB Smart Chain", "Tron (TRC20)", "Ethereum (ERC20)", "Polygon", "Arbitrum One", "Optimism", "TON", "Avalanche C-Chain", "Celo"]);
    expect(checked()).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled(); // membuka simbol tidak memilih apa pun
    expect(group.className).toContain("flex-wrap");
    for (const r of within(group).getAllByRole("radio", { hidden: true })) {
      expect(r.closest("label")!.className).toContain("min-h-[44px]");
      expect((r as HTMLInputElement).name).toBe("checkout-pay");
      expect(r.className).toContain("sr-only");
    }
  });

  it("memilih jaringan: terpilih = border cyan + titik radio; opsi yang dikirim = opsi jaringan itu; menutup simbol menghapus pilihan", () => {
    const spy = vi.fn();
    render(<Harness raw={[qrisM, ...allCoins()]} onSelectSpy={spy} />);
    openGroup();
    fireEvent.click(expandBtn("USDT"));
    fireEvent.click(radioOf("usdtbsc")!);
    expect(spy).toHaveBeenLastCalledWith("nowpayments:usdtbsc");
    const chip = radioOf("usdtbsc")!.closest("label")!;
    expect(chip.className).toContain("border-[#00E5FF]/50");
    expect(chip.className).not.toMatch(/border-l|bg-\[#00E5FF\]/);
    expect(radioOf("usdttrc20")!.closest("label")!.className).not.toContain("border-[#00E5FF]/50");
    expect(checked()).toEqual([radioOf("usdtbsc")]);
    fireEvent.click(expandBtn("USDT")); // tutup simbol yang memuat pilihan
    expect(spy).toHaveBeenLastCalledWith(null);
    expect(checked()).toHaveLength(0);
    expect(netGroup("Jaringan USDT")).toBeNull();
  });

  it("hanya satu simbol terbuka: membuka USDC menutup USDT dan menghapus jaringan USDT yang dipilih; memilih simbol satu jaringan menutup yang terbuka", () => {
    const spy = vi.fn();
    render(<Harness raw={[qrisM, ...allCoins()]} onSelectSpy={spy} />);
    openGroup();
    fireEvent.click(expandBtn("USDT"));
    fireEvent.click(radioOf("usdttrc20")!);
    fireEvent.click(expandBtn("USDC"));
    expect(spy).toHaveBeenLastCalledWith(null);
    expect(netGroup("Jaringan USDT")).toBeNull();
    expect(netGroup("Jaringan USDC")).toBeTruthy();
    expect(expandBtn("USDT").getAttribute("aria-expanded")).toBe("false");
    expect(checked()).toHaveLength(0);
    fireEvent.click(radioOf("eth")!);
    expect(netGroup("Jaringan USDC")).toBeNull();
    expect(checked()).toEqual([radioOf("eth")]);
    fireEvent.click(expandBtn("USDT")); // membuka simbol multi menghapus pilihan crypto sebelumnya (tanpa jaringan bawaan)
    expect(checked()).toHaveLength(0);
  });

  it("jaringan di bawah minimum = chip nonaktif dengan 'Min. US$x' (tooltip), tak bisa dipilih klik/keyboard; jaringan lain tetap bisa", () => {
    const spy = vi.fn();
    render(<Harness raw={[qrisM, ...allCoins()]} onSelectSpy={spy} />);
    openGroup();
    fireEvent.click(expandBtn("USDC"));
    const sol = radioOf("usdcsol")!;
    const chip = sol.closest("label")!;
    expect(sol.disabled).toBe(true);
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.className).toMatch(/opacity-55/);
    expect(norm(chip.textContent)).toContain("Solana");
    expect(norm(chip.textContent)).toContain("Min. US$2,30");
    expect(chip.getAttribute("title")).toContain("US$2,30");
    fireEvent.click(chip); fireEvent.click(sol); fireEvent.keyDown(sol, { key: " " });
    expect(spy).not.toHaveBeenCalled();
    expect(radioOf("usdcbsc")!.disabled).toBe(false);
  });

  it("simbol yang SEMUA jaringannya di bawah minimum = baris nonaktif dengan 'Min.' terendah (tanpa tombol buka)", () => {
    const below = new Set(["fdusdbsc", "fdusderc20"]);
    render(<Harness raw={[qrisM, ...allCoins(below)]} />);
    openGroup();
    const btn = blockedBtn("FDUSD");
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBeNull();
    expect(norm(btn.textContent)).toContain("Min. US$2,40"); // terendah dari 2.60 / 2.40
    fireEvent.click(btn);
    expect(netGroup("Jaringan FDUSD")).toBeNull();
    // disusun setelah simbol yang tersedia dalam subgrup stablecoin
    const stable = symbolRows().filter((row) => /^(USDT|USDC|DAI|PYUSD|FDUSD|USDP)\b/.test(row)).map((row) => row.split(" ")[0]);
    expect(stable).toEqual(["USDT", "USDC", "DAI", "PYUSD", "USDP", "FDUSD"]);
  });

  it("keyboard: tombol simbol dapat difokus + Enter/Spasi membuka; chip = radio native (Tab masuk, panah pindah, Spasi memilih); nonaktif tak bisa dipilih", async () => {
    const user = userEvent.setup();
    render(<Harness raw={[qrisM, ...allCoins()]} />);
    await user.click(headerBtn(/^Crypto/));
    const usdt = expandBtn("USDT");
    expect(usdt.tagName).toBe("BUTTON");
    expect((usdt as HTMLButtonElement).type).toBe("button");
    usdt.focus();
    await user.keyboard("{Enter}");
    expect(usdt.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Enter}"); // sama tombolnya: tutup
    expect(usdt.getAttribute("aria-expanded")).toBe("false");
    await user.keyboard(" ");
    expect(usdt.getAttribute("aria-expanded")).toBe("true");
    await user.tab();
    expect(document.activeElement).toBe(radioOf("usdtbsc")); // Tab masuk ke chip jaringan pertama (tanpa pilihan, tanpa jaringan bawaan)
    expect(checked()).toHaveLength(0);
    await user.keyboard(" "); // Spasi memilih jaringan yang difokus
    expect(radioOf("usdtbsc")!.checked).toBe(true);
    expect(checked()).toHaveLength(1);
    // Panah antar jaringan memakai perilaku radio native browser (grup name="checkout-pay"); jsdom/user-event tidak meniru urutan DOM tersembunyi.
    expect(new Set(coinRadios().map((r) => r.name))).toEqual(new Set(["checkout-pay"]));
  });
});

describe("crypto picker: pencarian", () => {
  const open = () => { render(<Harness raw={[qrisM, ...allCoins()]} />); openGroup(); };
  const type = (value: string) => fireEvent.change(search()!, { target: { value } });
  const visibleTickers = () => visibleCoinRadios().map((r) => r.value.replace("nowpayments:", ""));

  it("tampil bila > 8 BARIS SIMBOL (12 -> tampil; 28 opsi tapi hanya 4 simbol -> tidak); label aksesibel, lebar penuh, tinggi 44px", () => {
    open();
    const input = screen.getByLabelText("Cari koin atau jaringan", { selector: "input" }) as HTMLInputElement;
    expect(input.className).toContain("w-full");
    expect(input.className).toContain("h-11");
    cleanup();
    const few = ["usdtbsc", "usdttrc20", "usdterc20", "usdcbsc", "usdcsol", "usdc", "btc", "eth", "usdtmatic", "usdtarb"].map((t) => coin(t, new Set()));
    render(<Harness raw={[qrisM, ...few]} />);
    openGroup();
    expect(search()).toBeNull();
  });

  it("filter simbol/nama: 'bitcoin' -> hanya BTC; 'tether' -> USDT tertutup (semua jaringannya cocok)", () => {
    open();
    type("bitcoin");
    expect(symbolRows()).toHaveLength(1);
    expect(visibleTickers()).toEqual(["btc"]);
    type("tether");
    expect(symbolRows()).toEqual(["USDT 9 jaringan"]);
    expect(netGroup("Jaringan USDT")).toBeNull();
  });

  it("kecocokan JARINGAN: baris simbol langsung terbuka dengan chip yang cocok saja ('tron' -> TRX + USDT[Tron (TRC20)]; 'usdt bnb' -> USDT[BNB Smart Chain])", () => {
    open();
    type("TRON");
    expect(symbolRows().map((r) => r.split(" ")[0])).toEqual(["TRX", "USDT"]);
    expect(expandBtn("USDT").getAttribute("aria-expanded")).toBe("true");
    const labels = within(netGroup("Jaringan USDT")!).getAllByRole("radio", { hidden: true }).map((r) => norm(r.closest("label")!.textContent));
    expect(labels).toEqual(["Tron (TRC20)"]);
    expect(netGroup("Jaringan USDC")).toBeNull();
    type("usdt bnb");
    expect(symbolRows()).toHaveLength(1);
    expect(within(netGroup("Jaringan USDT")!).getAllByRole("radio", { hidden: true })).toHaveLength(1);
    type("polygon"); // juga USDC: dua simbol terbuka oleh pencarian
    expect(symbolRows().map((r) => r.split(" ")[0])).toEqual(["USDT", "USDC"]);
    expect(netGroup("Jaringan USDC")).toBeTruthy();
    fireEvent.click(expandBtn("USDT")); // pembeli masih bisa menutup baris yang dibuka pencarian
    expect(netGroup("Jaringan USDT")).toBeNull();
    expect(netGroup("Jaringan USDC")).toBeTruthy();
  });

  it("tidak ada hasil -> teks kosong; tombol hapus mengosongkan dan mengembalikan 12 baris; menutup grup mengosongkan pencarian", () => {
    open();
    type("zzzz");
    expect(symbolRows()).toHaveLength(0);
    expect(screen.getByText("Tidak ada koin yang cocok.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hapus pencarian" }));
    expect(search()!.value).toBe("");
    expect(symbolRows()).toHaveLength(12);
    expect(screen.queryByRole("button", { name: "Hapus pencarian" })).toBeNull();
    type("tron");
    openGroup();
    expect(search()!.value).toBe("");
  });
});

describe("crypto picker: akordeon grup exclusive + hapus pilihan saat ditutup (gateway tetap bekerja)", () => {
  it("membuka grup lain menutup crypto dan menghapus pilihan jaringan; menutup crypto menghapus pilihan; QRIS tidak tersentuh", () => {
    render(<Harness raw={[qrisM, gwM, ...allCoins()]} initial="qris" />);
    const crypto = () => headerBtn(/^Crypto/);
    const va = () => headerBtn(/^Virtual Account/);
    fireEvent.click(crypto());
    expect(va().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expandBtn("USDT"));
    fireEvent.click(radioOf("usdtbsc")!);
    expect(checked().map((r) => r.value)).toEqual(["nowpayments:usdtbsc"]);
    fireEvent.click(va());
    expect(crypto().getAttribute("aria-expanded")).toBe("false");
    expect(checked()).toHaveLength(0);
    expect(crypto().querySelector("[data-selected-summary]")).toBeNull();
    fireEvent.click(crypto());
    expect(netGroup("Jaringan USDT")).toBeNull(); // perluasan direset saat grup ditutup
    fireEvent.click(radioOf("eth")!);
    fireEvent.click(crypto());
    expect(checked()).toHaveLength(0);
  });

  it("pilihan dipulihkan pada jaringan simbol multi: grup terbuka, simbol itu diperluas dan jaringan ter-checked", () => {
    render(<Harness raw={[qrisM, ...allCoins()]} initial="nowpayments:usdtbsc" />);
    const head = headerBtn(/^Crypto/);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(expandBtn("USDT").getAttribute("aria-expanded")).toBe("true");
    expect(radioOf("usdtbsc")!.checked).toBe(true);
    expect(head.querySelector("[data-selected-summary]")).toBeNull();
  });
});

describe("crypto picker: animasi buka/tutup (grid 0fr -> 1fr + opacity)", () => {
  const closedProps = (el: Element) => ({ ariaHidden: el.getAttribute("aria-hidden"), inert: el.hasAttribute("inert"), state: el.getAttribute("data-collapse") });

  it("panel grup dan panel jaringan memakai transisi grid-rows + opacity 220ms ease-out dengan motion-reduce:transition-none", () => {
    render(<Harness raw={[qrisM, ...allCoins()]} />);
    openGroup();
    const panel = document.getElementById("pay-group-crypto")!;
    for (const el of [panel, document.getElementById("pay-net-USDT")!]) {
      expect(el.className).toContain("grid");
      expect(el.className).toContain("transition-[grid-template-rows,opacity,visibility]");
      expect(el.className).toContain("duration-[220ms]");
      expect(el.className).toContain("ease-out");
      expect(el.className).toContain("motion-reduce:transition-none");
      expect(el.firstElementChild!.className).toContain("min-h-0");
      expect(el.firstElementChild!.className).toContain("overflow-hidden");
    }
    expect(panel.className).toContain("grid-rows-[1fr]");
    expect(document.getElementById("pay-net-USDT")!.className).toContain("grid-rows-[0fr]");
    expect(headerBtn(/^Crypto/).querySelector("svg")!.getAttribute("class")).toContain("duration-[220ms]");
  });

  it("tertutup = tetap terpasang tetapi inert + aria-hidden + tak bisa difokus; terbuka = bebas atribut itu; buka-tutup bergantian (exclusive) menukar kedua panel", () => {
    render(<Harness raw={[qrisM, gwM, ...allCoins()]} initial="qris" />);
    const cryptoPanel = () => document.getElementById("pay-group-crypto")!;
    const vaPanel = () => document.getElementById("pay-group-va")!;
    expect(closedProps(cryptoPanel())).toEqual({ ariaHidden: "true", inert: true, state: "closed" });
    expect(cryptoPanel().querySelectorAll("input").length).toBeGreaterThan(0); // terpasang
    expect(screen.queryAllByRole("radio").some((r) => (r as HTMLInputElement).value.startsWith("nowpayments:"))).toBe(false); // tak terbaca/terfokus
    openGroup();
    expect(closedProps(cryptoPanel())).toEqual({ ariaHidden: null, inert: false, state: "open" });
    fireEvent.click(headerBtn(/^Virtual Account/)); // buka VA = tutup crypto pada saat yang sama
    expect(closedProps(cryptoPanel()).state).toBe("closed");
    expect(closedProps(vaPanel()).state).toBe("open");
    expect(cryptoPanel().querySelectorAll("input").length).toBeGreaterThan(0); // masih terpasang saat/ setelah animasi tutup
    fireEvent.click(headerBtn(/^Crypto/));
    fireEvent.click(expandBtn("USDT"));
    expect(closedProps(document.getElementById("pay-net-USDT")!).state).toBe("open");
    fireEvent.click(expandBtn("USDC")); // tukar: USDT menutup, USDC membuka
    expect(closedProps(document.getElementById("pay-net-USDT")!)).toEqual({ ariaHidden: "true", inert: true, state: "closed" });
    expect(closedProps(document.getElementById("pay-net-USDC")!).state).toBe("open");
    expect(expandBtn("USDT").getAttribute("aria-controls")).toBe("pay-net-USDT"); // ARIA tetap
    expect(expandBtn("USDT").getAttribute("aria-expanded")).toBe("false");
  });
});
