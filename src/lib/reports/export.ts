import type { SelectedReport } from "@/lib/dashboard-report";
import type { CellObject } from "write-excel-file/universal";

type Table = { title: string; headers: string[]; rows: (string | number)[][] };
export const REPORT_NOTE = "Untung produk belum dikurangi MDR dan biaya operasional. Modal tanpa snapshot atau supplier belum selesai merupakan estimasi. Omzet termasuk kredit yang digunakan dan pembulatan invoice.";
export const reportFilename = (report: SelectedReport, format: "pdf" | "xlsx") => `AXVARA-laporan-${report.from}_${report.to}.${format}`;

/** Both downloadable documents use the exact immutable response shown on screen. */
export function reportTables(report: SelectedReport): Table[] {
  const financial = (r: { orders: number; revenue: number; cost: number; profit: number }) => [r.orders, r.revenue, r.cost, r.profit];
  const groups = (rows: Record<string, typeof report.suppliers.manual>, labels: Record<string, string>) => Object.entries(rows).map(([key, row]) => [labels[key] ?? key, ...financial(row)]);
  return [
    { title: "Ringkasan", headers: ["Keterangan", "Nilai"], rows: [
      ["Tanggal awal (WIB)", report.from], ["Tanggal akhir (WIB, inklusif)", report.to], ["Zona waktu", report.timezone],
      ["Dibuat (WIB)", new Date(report.generated_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false })],
      ["Pesanan lunas", report.orders], ["Omzet (Rp)", report.revenue], ["Modal (Rp)", report.cost], ["Untung produk (Rp)", report.profit],
      ["Margin (%)", report.revenue ? report.profit / report.revenue * 100 : 0],
      ["Pembayaran merchant (Rp)", report.merchant_paid ?? report.revenue], ["Kredit digunakan (Rp)", report.credit_used ?? 0],
      ["Pesanan dengan modal estimasi", report.estimated_orders], ["Catatan", REPORT_NOTE],
    ] },
    { title: "Harian", headers: ["Tanggal / jam WIB", "Pesanan", "Omzet (Rp)", "Modal (Rp)", "Untung (Rp)"], rows: report.series.map(r => [r.date, ...financial(r)]) },
    { title: "Supplier", headers: ["Asal produk", "Pesanan", "Omzet (Rp)", "Modal (Rp)", "Untung (Rp)"], rows: groups(report.suppliers, { wr: "Warung Rebahan", sk: "Sekalipay", manual: "Stok sendiri", pedia: "Pedia" }) },
    { title: "Channel", headers: ["Kanal", "Pesanan", "Omzet (Rp)", "Modal (Rp)", "Untung (Rp)"], rows: groups(report.channels, { web: "Web", telegram: "Telegram", whatsapp: "WhatsApp" }) },
    { title: "Top Produk", headers: ["Produk / varian", "Jumlah terjual", "Omzet (Rp)", "Modal (Rp)", "Untung (Rp)"], rows: report.top_products.map(r => [r.name, r.qty, r.revenue, r.cost, r.profit]) },
  ];
}

export async function createReportXlsx(report: SelectedReport): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/universal");
  const sheets = reportTables(report).map(table => ({
    sheet: table.title,
    columns: table.headers.map((_, index) => ({ width: index === 0 ? 46 : table.title === "Ringkasan" ? 80 : 21 })),
    data: [table.headers.map(value => ({ value, type: String, fontWeight: "bold", backgroundColor: "#080C1E", color: "#FFFFFF" } as CellObject)),
      ...table.rows.map(row => row.map(value => typeof value === "number" ? { value, type: Number, format: "#,##0.##" } : { value, type: String, wrap: true }))],
  }));
  return writeXlsxFile(sheets).toBlob();
}

export async function createReportPdf(report: SelectedReport): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`AXVARA | ${report.from} - ${report.to}`);
  pdf.setCreationDate(new Date(report.generated_at));
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(font.getCharacterSet());
  // Standard PDF fonts cover Indonesian/Latin text; decorative emoji must not
  // make a complete report fail. Excel preserves original Unicode labels.
  const text = (value: string | number) => [...String(value).normalize("NFKC")].filter(c => supported.has(c.codePointAt(0)!)).join("").replace(/[\r\n\t]+/g, " ");
  const width = 595.28, height = 841.89, left = 36, usable = width - left * 2;
  let page = pdf.addPage([width, height]), y = height - 110;
  const header = () => {
    page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: rgb(0.031, 0.047, 0.118) });
    page.drawText("AXVARA / LAPORAN PENJUALAN", { x: left, y: height - 32, size: 16, font: bold, color: rgb(0, 0.8, 0.9) });
    page.drawText(`${report.from} - ${report.to} | WIB`, { x: left, y: height - 55, size: 10, font, color: rgb(1, 1, 1) });
  };
  header();
  const nextPage = () => { page = pdf.addPage([width, height]); y = height - 110; header(); };
  const wrap = (value: string | number, max: number, size = 8) => {
    const lines: string[] = []; let current = "";
    for (const word of text(typeof value === "number" ? value.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : value).split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(next, size) > max) { lines.push(current); current = ""; }
      if (font.widthOfTextAtSize(word, size) <= max) { current = current ? `${current} ${word}` : word; continue; }
      for (const char of word) {
        if (current && font.widthOfTextAtSize(current + char, size) > max) { lines.push(current); current = ""; }
        current += char;
      }
    }
    lines.push(current); return lines;
  };
  for (const table of reportTables(report)) {
    if (y < 145) nextPage();
    const columnWidths = table.headers.length === 2 ? [175, usable - 175] : [usable - 300, 54, 82, 82, 82];
    const tableHeading = () => {
      page.drawText(table.title, { x: left, y, size: 12, font: bold }); y -= 22;
      let x = left;
      page.drawRectangle({ x: left, y: y - 8, width: usable, height: 26, color: rgb(0.91, 0.94, 0.97) });
      table.headers.forEach((title, i) => { page.drawText(text(title), { x: x + 5, y, size: 8, font: bold }); x += columnWidths[i]; }); y -= 22;
    };
    tableHeading();
    for (const row of table.rows.length ? table.rows : [["Belum ada transaksi", ...table.headers.slice(1).map(() => "")]]) {
      const lines = row.map((value, i) => wrap(value, columnWidths[i] - 10));
      const rowHeight = Math.max(...lines.map(c => c.length)) * 11 + 12;
      if (y - rowHeight < 38) { nextPage(); tableHeading(); }
      let x = left;
      lines.forEach((cell, i) => { cell.forEach((line, n) => page.drawText(line, { x: x + 5, y: y - n * 11, size: 8, font })); x += columnWidths[i]; });
      y -= rowHeight;
      page.drawLine({ start: { x: left, y: y + 8 }, end: { x: width - left, y: y + 8 }, color: rgb(0.87, 0.9, 0.92), thickness: 0.4 });
    }
    y -= 18;
  }
  for (const [i, p] of pdf.getPages().entries()) p.drawText(`AXVARA | ${i + 1}/${pdf.getPageCount()}`, { x: left, y: 20, font, size: 8, color: rgb(0.4, 0.4, 0.4) });
  return pdf.save();
}
