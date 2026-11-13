// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PediaRefillClient } from "@/app/pedia/refill/refill-client";
import { pediaRefillState } from "@/lib/pedia/refill-policy";
import { refillLabel, PEDIA_TERMS } from "@/lib/pedia/terms";

vi.mock("@/components/ui/IosIcon", () => ({ IosIcon: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

const now = Date.parse("2026-11-01T00:00:00Z");
const item = (over: Record<string, unknown> = {}) => ({ status: "completed", refill_days: 30, created_at: "2026-10-20 00:00:00", supplier_order_id: "S1", refill_status: null, refill_supplier_id: null, refill_last_at: null, ...over });

describe("pediaRefillState", () => {
  it("chooses api/manual/none and explains why refill is blocked", () => {
    expect(pediaRefillState(item(), {}, true, now)).toMatchObject({ mode: "api", eligible: true, ends_at: "2026-11-19T00:00:00.000Z" });
    expect(pediaRefillState(item(), {}, false, now)).toMatchObject({ mode: "manual", eligible: true });
    expect(pediaRefillState(item({ refill_days: 0 }), {}, true, now)).toMatchObject({ mode: "none", reason: "no_refill" });
    expect(pediaRefillState(item({ status: "in_progress" }), {}, true, now).reason).toBe("not_completed");
    expect(pediaRefillState(item({ created_at: "2026-09-01 00:00:00" }), {}, true, now).reason).toBe("expired");
    expect(pediaRefillState(item({ refill_status: "submitted", refill_last_at: "2026-10-25 00:00:00" }), {}, true, now)).toMatchObject({ reason: "in_progress", status_label: "Refill sedang diproses" });
    expect(pediaRefillState(item({ refill_status: "completed", refill_last_at: "2026-10-31 12:00:00" }), {}, true, now)).toMatchObject({ reason: "cooldown", next_at: "2026-11-01T12:00:00.000Z" });
    expect(pediaRefillState(item({ supplier_order_id: null }), {}, true, now).reason).toBe("no_supplier_order");
    // Snapshot terms win over the current tier.
    expect(pediaRefillState(item({ refill_days: 0 }), { refill_days: 30 }, true, now).mode).toBe("api");
  });

  it("white-labels buyer text: no supplier names in terms, scrubber cleans legacy copy", async () => {
    const { whiteLabel, PEDIA_REFILL_STEPS, PEDIA_REFILL_RULES, DROP_MEANING } = await import("@/lib/pedia/terms");
    const { REFILL_REASON_TEXT, refillStatusLabel } = await import("@/lib/pedia/refill-policy");
    const all = [...PEDIA_TERMS.flatMap((t) => [t.term, t.meaning]), ...PEDIA_REFILL_STEPS.flat(), ...PEDIA_REFILL_RULES, ...Object.values(DROP_MEANING), ...Object.values(REFILL_REASON_TEXT),
      ...["requested", "submitted", "manual_requested", "completed", "rejected", "supplier_rejected", "canceled"].map((s) => refillStatusLabel(s)!)];
    for (const text of all) expect(text).not.toMatch(/supplier|indosmm/i);
    expect(whiteLabel("Estimasi supplier dapat berubah mengikuti antrean.")).toBe("Estimasi dapat berubah mengikuti antrean.");
    expect(whiteLabel("Followers global menurut supplier, akun HQ menurut supplier.")).toBe("Followers global, akun HQ.");
    expect(whiteLabel("No Drop (label supplier): belum drop.")).toBe("No Drop: belum drop.");
    expect(whiteLabel("Supplier menyebut lifetime, tetapi API refill belum tersedia.")).toBe("Info lifetime belum dapat diajukan otomatis.");
    expect(whiteLabel("Layanan IndoSMM lewat supplier")).not.toMatch(/supplier|indosmm/i);
    expect(whiteLabel(null)).toBeNull();
  });

  it("keeps SMM terms in English with short explanations", () => {
    expect(refillLabel(0)).toBe("No Refill");
    expect(refillLabel(30)).toBe("Refill 30 Days");
    expect(refillLabel(3650)).toBe("Refill Lifetime");
    expect(PEDIA_TERMS.map((t) => t.term)).toEqual(expect.arrayContaining(["HQ", "Real", "Pengajuan Refill", "Drop rate", "No Drop", "Less Drop", "High Drop", "No Refill"]));
    expect(PEDIA_TERMS.find((t) => t.term === "Drop rate")?.meaning).toContain("pengajuan Refill bukan pengukuran langsung");
  });
});

describe("Pedia refill page", () => {
  const order = (refill: Record<string, unknown>) => ({ ok: true, order: { code: "AXP-20261101-AB12CD34", product_name: "Followers Instagram", quantity: 1000, target: "https://instagram.com/x", status: "completed", refill } });
  it("looks up an order, submits refill once, and refreshes the status", async () => {
    const eligible = { mode: "api", days: 30, eligible: true, reason: null, ends_at: "2026-11-19T00:00:00.000Z", next_at: null, status: null, status_label: null, last_at: null };
    const after = { ...eligible, eligible: false, reason: "in_progress", status: "submitted", status_label: "Refill sedang diproses", last_at: "2026-11-01T00:00:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => order(eligible) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, message: "Refill diajukan. Biasanya mulai dalam 24 jam." }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => order(after) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PediaRefillClient />);
    fireEvent.change(screen.getByLabelText("Kode pesanan *"), { target: { value: "axp-20261101-ab12cd34" } });
    fireEvent.change(screen.getByLabelText("No. WA atau email checkout *"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Cek status refill" }));
    expect(await screen.findByText("Refill 30 Days")).toBeTruthy();
    expect(screen.getByText("Otomatis")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/supplier|indosmm/i);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "x-order-contact": "a@b.com" });
    fireEvent.click(screen.getByRole("button", { name: "Ajukan Refill" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Refill diajukan"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Ajukan Refill" })).toBeNull());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ contact: "a@b.com" });
    expect(screen.getByText(/Refill sebelumnya masih diproses/)).toBeTruthy();
  });

  it("explains No Refill orders and shows the refill rules and glossary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => order({ mode: "none", days: 0, eligible: false, reason: "no_refill", ends_at: null, next_at: null, status: null, status_label: null, last_at: null }) }));
    render(<PediaRefillClient />);
    fireEvent.change(screen.getByLabelText("Kode pesanan *"), { target: { value: "AXP-20261101-AB12CD34" } });
    fireEvent.change(screen.getByLabelText("No. WA atau email checkout *"), { target: { value: "081234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "Cek status refill" }));
    expect(await screen.findByText(/Layanan ini No Refill/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ajukan Refill" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Aturan refill" })).toBeTruthy();
    expect(screen.getByText("High Drop")).toBeTruthy();
  });
});
