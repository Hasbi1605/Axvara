// Audit UX admin 2026-09-22 — jalan buntu operasional.
//
// Semua temuan di sini punya pola sama: SERVER sudah benar dan sudah tahu
// jawabannya, tetapi UI membuang informasinya atau tidak merender aksinya,
// sehingga admin tidak punya jalan keluar tanpa operasi database.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("UX admin — jalan buntu fulfillment", () => {
  it("tombol serah terima manual mencakup fulfillment_status 'failed'", () => {
    // `failed` ditulis saat order WR kehabisan attempt (warung-rebahan/order.ts)
    // dan saat delivery kredensial habis 5 percobaan (deliver.ts). API handover
    // menerimanya, jadi UI tidak boleh menyembunyikan tombolnya.
    const ui = read("src/components/admin/OrdersManager.tsx");
    const api = read("src/lib/fulfillment/delivery/handover.ts");
    expect(api).toContain('"failed"');
    const gates = ui.match(/const needsHandover = [\s\S]*?;/g) ?? [];
    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
      expect(gate).toContain("failed");
      expect(gate).toContain("manual_required");
    }
  });

  it("baris & detail pesanan merender status fulfillment, bukan hanya memakainya untuk logika", () => {
    const ui = read("src/components/admin/OrdersManager.tsx");
    expect(ui).toContain("function FulfillmentBadge");
    // Dua pemakaian: baris daftar dan modal detail.
    expect(ui.match(/<FulfillmentBadge/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("modal detail menyediakan tombol Tolak bukti dan serah terima manual", () => {
    const ui = read("src/components/admin/OrdersManager.tsx");
    const detail = ui.slice(ui.indexOf("function OrderDetail"), ui.indexOf("function ActionDialog"));
    // Sebelumnya Detail hanya punya approve/paid/cancel, sehingga alur wajar
    // "buka Detail untuk memeriksa dulu" justru mematikan aksinya.
    expect(detail).toContain('onAction("reject")');
    expect(detail).toContain('onAction("handover")');
  });

  it("alasan penolakan bukti ditampilkan, tidak hanya di-parse", () => {
    const ui = read("src/components/admin/OrdersManager.tsx");
    // Muncul di tipe + normalizeOrder + DUA lokasi render (baris & detail).
    expect(ui.match(/proofRejectionReason/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});

describe("UX admin — gerbang retry WR selaras dengan API", () => {
  it("daftar status retry di UI sama dengan RETRYABLE di route", () => {
    const route = read("src/app/api/admin/warung/orders/[id]/retry/route.ts");
    const ui = read("src/components/admin/WarungRebahanManager.tsx");
    const apiList = (route.match(/const RETRYABLE = \[([\s\S]*?)\]/)?.[1] ?? "")
      .match(/"([a-z_]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    const uiList = (ui.match(/const RETRYABLE_WR_STATUS = \[([\s\S]*?)\]/)?.[1] ?? "")
      .match(/"([a-z_]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    expect(apiList.length).toBeGreaterThan(0);
    expect(uiList.sort()).toEqual(apiList.sort());
    // blocked_balance WAJIB ada: itu status order yang tertahan di produksi.
    expect(uiList).toContain("blocked_balance");
  });

  it("tombol retry hanya muncul bila kuota percobaan masih ada", () => {
    const ui = read("src/components/admin/WarungRebahanManager.tsx");
    // `failed` hanya ditulis ketika attempt >= max_attempts, tepat kondisi yang
    // ditolak API dengan max_attempts_reached — tombolnya dulu dijamin gagal.
    expect(ui).toContain("function canRetryWrLink");
    expect(ui).toMatch(/attempt_count[\s\S]{0,80}max_attempts/);
    expect(ui).toContain("Percobaan habis");
  });

  it("semua status link WR punya label dan bisa difilter", () => {
    const order = read("src/lib/warung-rebahan/order.ts");
    const ui = read("src/components/admin/WarungRebahanManager.tsx");
    const api = read("src/app/api/admin/warung/orders/route.ts");
    const statuses = (order.match(/WR_LINK_STATUSES = \[([\s\S]*?)\] as const/)?.[1] ?? "")
      .match(/"([a-z_]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    expect(statuses.length).toBeGreaterThan(5);
    const labels = ui.slice(ui.indexOf("WR_STATUS_LABEL"), ui.indexOf("RETRYABLE_WR_STATUS"));
    const allowed = api.match(/const allowed = \[([\s\S]*?)\]/)?.[1] ?? "";
    for (const status of statuses) {
      expect(labels, `status ${status} tanpa label`).toContain(`${status}:`);
      expect(allowed, `status ${status} tak bisa difilter`).toContain(`"${status}"`);
    }
  });
});
