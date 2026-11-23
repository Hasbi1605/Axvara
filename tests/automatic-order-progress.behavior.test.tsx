// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AutomaticOrderProgress } from "@/components/storefront/AutomaticOrderProgress";
import type { AutomaticProgressItem } from "@/lib/warung-rebahan/progress";
afterEach(cleanup);
const item: AutomaticProgressItem = {label:"Scribd — 30 Hari",stage:"queued",queuePosition:3,total:1,ready:0,updatedAt:null};

it("shows actual queue state without inventing a single-account percentage or exposing supplier branding", () => {
  render(<AutomaticOrderProgress items={[item]} />);
  expect(screen.getByText("Menunggu giliran")).toBeTruthy();
  expect(screen.getByText("Urutan antrean: 3")).toBeTruthy();
  expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
  expect(document.body.textContent).not.toMatch(/Jaspay|Warung|12 jam|\d+%/i);
});
it("uses real counts for multiple accounts and reserves 100% for confirmed readiness", () => {
  const {rerender}=render(<AutomaticOrderProgress items={[{...item,stage:"running",total:5,ready:2}]} />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
  expect(screen.getByText("2 dari 5 siap")).toBeTruthy();
  rerender(<AutomaticOrderProgress items={[{...item,stage:"running",total:5,ready:5}]} />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("99");
  expect(screen.queryByText("100%")).toBeNull();
  rerender(<AutomaticOrderProgress items={[{...item,stage:"ready",total:5,ready:5}]} />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  expect(screen.getByText("Produk siap")).toBeTruthy();
});
it("stops the loading animation on partial/error and explains follow-up without asking for a repurchase", () => {
  render(<AutomaticOrderProgress items={[{...item,stage:"needs_check",ready:1,total:2}]} />);
  expect(screen.getByText("Produk sedang diperiksa")).toBeTruthy();
  expect(screen.getByText(/tidak perlu memesan ulang/)).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(document.querySelector('.animate-spin')).toBeNull();
});
it("supports English and reduced motion while preserving text feedback", () => {
  render(<AutomaticOrderProgress items={[{...item,stage:"running"}]} locale="en" />);
  expect(screen.getByText("Creating your product")).toBeTruthy();
  expect(screen.getByRole("progressbar").firstElementChild?.className).toContain("motion-safe:animate-");
});
it("explains made-by-order ETA and admin escalation while the product is still being created", () => {
  const {rerender}=render(<AutomaticOrderProgress items={[{...item,stage:"running"}]} />);
  expect(document.body.textContent).toContain("sedang dibuat otomatis oleh bot. Estimasi 15 menit–1 jam");
  expect(document.body.textContent).toContain("di email begitu siap");
  expect(screen.getByRole("link",{name:"Hubungi admin"}).getAttribute("href")).toBe("/wa");
  rerender(<AutomaticOrderProgress items={[{...item,stage:"ready"}]} />);
  expect(document.body.textContent).not.toContain("Estimasi 15 menit");
  rerender(<AutomaticOrderProgress items={[{...item,stage:"needs_check"}]} />);
  expect(screen.queryByRole("link",{name:"Hubungi admin"})).toBeNull();
  rerender(<AutomaticOrderProgress items={[{...item,stage:"queued"}]} locale="en" />);
  expect(screen.getByRole("link",{name:"Contact admin"})).toBeTruthy();
});
it("uses the short automatic-processing profile (Diproses otomatis, 1–5 min, admin after 15 min) without exposing supplier names", () => {
  const { rerender } = render(<AutomaticOrderProgress items={[{...item,label:"Google AI Pro 3 Bulan — Link Redeem",estimateProfile:"short",queuePosition:2}]} />);
  expect(screen.getByText("Urutan antrean: 2")).toBeTruthy();
  expect(document.body.textContent).toContain("Diproses otomatis");
  expect(document.body.textContent).not.toContain("Made by order");
  expect(document.body.textContent).toContain("Estimasi 1–5 menit");
  expect(document.body.textContent).toContain("Lebih dari 15 menit belum selesai?");
  expect(document.body.textContent).not.toContain("15 menit–1 jam");
  rerender(<AutomaticOrderProgress items={[{...item,label:"Google AI Pro 3 Bulan — Link Redeem",estimateProfile:"short",queuePosition:2}]} locale="en" />);
  expect(document.body.textContent).toContain("Processed automatically");
  expect(document.body.textContent).not.toContain("Made by order");
});

it("renders live step progress (capped below 100%) and whitelabel failure guidance with admin link", () => {
  const { rerender } = render(
    <AutomaticOrderProgress
      items={[{ ...item, label: "Google AI Pro 3 Bulan — Aktivasi Langsung 3 Bulan", stage: "running", estimateProfile: "short", step: { current: 4, total: 8 } }]}
    />,
  );
  expect(screen.getByText("Membuat produkmu")).toBeTruthy();
  expect(screen.getByText("Langkah 4 dari 8")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");

  // Even at final step (8/8), never show 100% until stage === "ready".
  rerender(
    <AutomaticOrderProgress
      items={[{ ...item, label: "Google AI Pro 3 Bulan — Aktivasi Langsung 3 Bulan", stage: "running", estimateProfile: "short", step: { current: 8, total: 8 } }]}
      locale="en"
    />,
  );
  expect(screen.getByText("Step 8 of 8")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("95");
  expect(screen.queryByText("100%")).toBeNull();

  // Failure guidance surfaces safe localized message + contact admin CTA.
  rerender(
    <AutomaticOrderProgress
      items={[{
        ...item,
        label: "Google AI Pro 3 Bulan — Aktivasi Langsung 3 Bulan",
        stage: "needs_check",
        estimateProfile: "short",
        attentionNote: {
          id: "Password Gmail yang dikirim salah. Dana pesanan ini dikembalikan penuh.",
          en: "The Gmail password submitted is incorrect. This order will be refunded in full.",
        },
      }]}
    />,
  );
  expect(screen.getByText(/Password Gmail yang dikirim salah/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Hubungi admin" }).getAttribute("href")).toBe("/wa");
});
