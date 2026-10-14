import { expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { emptySelectedReport } from "@/lib/dashboard-report";
import { createReportPdf, createReportXlsx, reportFilename, reportTables } from "@/lib/reports/export";

function fixture() {
  const report = emptySelectedReport({ date_from: "2024-01-01", date_to: "2024-12-31" }, new Date("2026-10-15T01:00:00Z"));
  Object.assign(report, { orders: 1, revenue: 12345, cost: 4000, profit: 8345, merchant_paid: 7345, credit_used: 5000, estimated_orders: 1 });
  report.suppliers.manual = { orders: 1, revenue: 12345, cost: 4000, profit: 8345 };
  report.channels.web = { ...report.suppliers.manual };
  report.series[0] = { date: "2024-01-01", ...report.suppliers.manual };
  report.top_products = [{ name: '=HYPERLINK("https://example.test") 🚀 Produk — ü', qty: 1, revenue: 12345, cost: 4000, profit: 8345 }];
  return report;
}

it("XLSX is a real five-sheet numeric workbook, preserving Unicode as text instead of formula", async () => {
  const report = fixture();
  const blob = await createReportXlsx(report);
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const workbook = strFromU8(archive["xl/workbook.xml"]);
  for (const title of ["Ringkasan", "Harian", "Supplier", "Channel", "Top Produk"]) expect(workbook).toContain(title);
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  for (const value of [12345, 4000, 8345, 7345, 5000]) expect(sheet).toContain(`<v>${value}</v>`);
  const all = Object.values(archive).map(bytes => strFromU8(bytes)).join("\n");
  expect(all).toContain("🚀 Produk"); expect(all).toContain("Asia/Jakarta");
  expect(all).not.toMatch(/<f[ >]/);
  expect(reportTables(report)[1].rows).toHaveLength(366);
  expect(reportFilename(report, "xlsx")).toBe("AXVARA-laporan-2024-01-01_2024-12-31.xlsx");
});

it("PDF contains matching totals and a paginated full timeline, including zero days", async () => {
  const report = fixture();
  const bytes = await createReportPdf(report);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getTitle()).toContain("2024-01-01 - 2024-12-31");
  expect(pdf.getPageCount()).toBeGreaterThan(5);
  const text = [...pdf.context.enumerateIndirectObjects()].flatMap(([, value]) => value instanceof PDFRawStream
    ? [...Buffer.from(decodePDFRawStream(value).decode()).toString().matchAll(/<([a-f\d]+)>\s*Tj/gi)].map(m => Buffer.from(m[1], "hex").toString("latin1")) : []).join(" ");
  for (const value of ["12.345", "4.000", "8.345", "7.345", "5.000", "2024-12-31", "Kredit digunakan", "estimasi"]) expect(text).toContain(value);
});
