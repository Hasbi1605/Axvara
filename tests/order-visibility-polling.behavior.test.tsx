// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import OrderSuccessPage from "@/app/(shop)/pesanan/[code]/page";

const CODE = "AXV-VISIBILITY-FIXTURE";
vi.mock("next/navigation", () => ({ useParams: () => ({ code: "AXV-VISIBILITY-FIXTURE" }), usePathname: () => "/pesanan/AXV-VISIBILITY-FIXTURE", useRouter: () => ({ push: vi.fn() }) }));
let hidden = false;
let current: Record<string, unknown>;
let urls: string[];
const response = () => ({ ok: true, status: 200, json: async () => ({ order: current }) });
const visibility = async (value: boolean) => { await act(async () => { hidden = value; fireEvent(document, new Event("visibilitychange")); }); };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const reads = () => urls.filter(url => url.startsWith("/api/orders?")).length;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T15:00:00Z"));
  hidden = false; urls = [];
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  localStorage.clear();
  current = { code: CODE, customer_name: "Fixture", customer_wa: "62812****0000", items: [], subtotal: 10000,
    payment_method: "qris", status: "pending", expires_at: new Date(Date.now()+900000).toISOString(),
    qris: { payable_amount: 10001, unique_code: 1, image_url: "/fixture-qr.png", status: "pending", expires_at: new Date(Date.now()+900000).toISOString() } };
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => { urls.push(String(input)); return response(); }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

it("pauses payment polling while hidden, catches up on return and preserves manual wake", async () => {
  const view = render(<OrderSuccessPage />); await act(async () => {});
  expect(reads()).toBe(1);
  await advance(5000); expect(reads()).toBe(2);
  await visibility(true); await advance(60000); expect(reads()).toBe(2);
  await visibility(false); expect(reads()).toBe(3);
  await visibility(false); expect(reads()).toBe(3); // Duplicate visible event does not restart the interval.
  await advance(5000); expect(reads()).toBe(4);
  fireEvent.click(screen.getByRole("button", { name: "Cek Pembayaran" })); await act(async () => {});
  expect(urls.filter(url => url.includes("wake=1"))).toHaveLength(1);
  expect(urls.filter(url => url.startsWith("/api/orders?") && !url.includes("wake=1"))).toHaveLength(4);
  view.unmount(); await visibility(true); await visibility(false); await advance(60000);
  expect(reads()).toBe(5); expect(vi.getTimerCount()).toBe(0);
});

it("does not schedule background polls when initially hidden, and stops when terminal", async () => {
  hidden = true;
  render(<OrderSuccessPage />); await act(async () => {});
  await advance(60000); expect(reads()).toBe(1); // Initial fetch still loads the page.
  current = { ...current, status: "dibatalkan", qris: null };
  await visibility(false); expect(reads()).toBe(2);
  await advance(60000); await visibility(true); await visibility(false);
  expect(reads()).toBe(2);
});

it("retains the non-dynamic 30s interval after returning", async () => {
  current = { ...current, qris: null };
  render(<OrderSuccessPage />); await act(async () => {});
  await advance(29000); expect(reads()).toBe(1);
  await advance(1000); expect(reads()).toBe(2);
  await visibility(true); await advance(60000); expect(reads()).toBe(2);
  await visibility(false); expect(reads()).toBe(3);
  await advance(30000); expect(reads()).toBe(4);
});

it("hidden time does not consume the fast fulfillment attempts, and ready credentials stop polling", async () => {
  current = { ...current, status: "lunas", qris: null, supplier_owned: true, fulfillment_status: "processing", credentials_ready: false };
  render(<OrderSuccessPage />); await act(async () => {});
  await advance(2000); expect(reads()).toBe(2);
  await visibility(true); await advance(120000); expect(reads()).toBe(2);
  await visibility(false); expect(reads()).toBe(3);
  await visibility(false); expect(reads()).toBe(3);
  await advance(2000); expect(reads()).toBe(4);
  current = { ...current, credentials_ready: true, fulfillment_status: "delivered" };
  await advance(2000); expect(reads()).toBe(5);
  await visibility(true); await visibility(false); await advance(120000);
  expect(reads()).toBe(5);
});

it("continues polling after the first unique credentials arrive until all purchased units are ready",async()=>{
 current={...current,status:'lunas',qris:null,credentials_ready:true,instant_delivery:true,fulfillment_status:'queued',unique_units_progress:{ready:2,total:3}};
 render(<OrderSuccessPage/>);await act(async()=>{});expect(reads()).toBe(1);
 await advance(2000);expect(reads()).toBe(2);
 current={...current,fulfillment_status:'delivered',unique_units_progress:{ready:3,total:3}};
 await advance(2000);expect(reads()).toBe(3);await advance(60000);expect(reads()).toBe(3);
});

it("visibility changes do not reset the bounded handover retry budget", async () => {
  current = { ...current, status: "lunas", qris: null, queued_delivery: true, credentials_ready: false };
  render(<OrderSuccessPage />); await act(async () => {});
  await advance(20000); expect(reads()).toBe(2);
  await visibility(true); await advance(120000); expect(reads()).toBe(2);
  await visibility(false); expect(reads()).toBe(3);
  await advance(20000); expect(reads()).toBe(4);
  await visibility(true); await visibility(false); await advance(120000);
  expect(reads()).toBe(4); // Initial fetch + three attempts, including the resume check.
});

it("returning during an in-flight fulfillment poll neither overlaps requests nor doubles timers", async () => {
  current = { ...current, status: "lunas", qris: null, supplier_owned: true, fulfillment_status: "processing", credentials_ready: false };
  let finish: ((value: ReturnType<typeof response>) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    urls.push(String(input));
    if (reads() === 2) return new Promise(resolve => { finish = resolve; });
    return response();
  }));
  render(<OrderSuccessPage />); await act(async () => {});
  await advance(2000); expect(reads()).toBe(2);
  await visibility(true); await visibility(false); expect(reads()).toBe(2);
  await act(async () => { finish!(response()); });
  await advance(2000); expect(reads()).toBe(3);
  await advance(2000); expect(reads()).toBe(4);
});


it("returning during a manual payment check shares the request lock with automatic polling", async () => {
  let finish: ((value: ReturnType<typeof response>) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input); urls.push(url);
    if (url.includes("wake=1")) return new Promise(resolve => { finish = resolve; });
    return response();
  }));
  render(<OrderSuccessPage />); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Cek Pembayaran" })); await act(async () => {});
  expect(reads()).toBe(2);
  await visibility(true); await visibility(false); await advance(5000);
  expect(reads()).toBe(2);
  await act(async () => { finish!(response()); });
  await advance(5000); expect(reads()).toBe(3);
  expect(urls.filter(url => url.includes("wake=1"))).toHaveLength(1);
});
