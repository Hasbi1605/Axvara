// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReportExportActions } from "@/components/admin/ReportExportActions";
import { emptySelectedReport } from "@/lib/dashboard-report";
const builders = vi.hoisted(() => ({ pdf: vi.fn(), xlsx: vi.fn() }));
vi.mock("@/lib/reports/export", () => ({ createReportPdf: builders.pdf, createReportXlsx: builders.xlsx, reportFilename: (r: { from: string }, f: string) => `${r.from}.${f}` }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("downloads the supplied selected response without another report request and disables unavailable export", async () => {
  const report = emptySelectedReport("week");
  const create = vi.fn(() => "blob:report"); Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const clicked: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
  builders.pdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  const view = render(<ReportExportActions report={report} disabled />);
  expect((screen.getByRole("button", { name: "Unduh PDF" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ReportExportActions report={report} disabled={false} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Unduh PDF" })); });
  expect(builders.pdf).toHaveBeenCalledWith(report); expect(fetch).not.toHaveBeenCalled();
  expect(clicked).toEqual([`${report.from}.pdf`]); expect(create).toHaveBeenCalledTimes(1);
});

it("failed generation is visible and allows retry", async () => {
  builders.xlsx.mockRejectedValue(new Error("zip unavailable"));
  render(<ReportExportActions report={emptySelectedReport("week")} disabled={false} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Unduh Excel (.xlsx)" })); });
  expect(screen.getByRole("alert").textContent).toContain("gagal dibuat");
  expect((screen.getByRole("button", { name: "Unduh Excel (.xlsx)" }) as HTMLButtonElement).disabled).toBe(false);
});
