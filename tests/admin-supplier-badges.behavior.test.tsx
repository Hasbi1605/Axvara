// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProductsSection } from "@/components/admin/sections/ProductsSection";
import { SupplierBadge, SUPPLIER_STYLES } from "@/components/admin/supplier-style";
import type { Prod } from "@/components/admin/product-types";

afterEach(cleanup);

const suppliers = Object.keys(SUPPLIER_STYLES) as Array<keyof typeof SUPPLIER_STYLES>;
const list: Prod[] = suppliers.map((supplier, i) => ({
  id: String(i + 1), slug: `product-${i}`, name: "Spotify Premium", description: "",
  supplier, liveStatus: i === 0 ? "live" : i === 1 ? "hidden_soldout" : "off",
  price: 10000, categorySlug: "premium", image: "", images: [], soldCount: 0,
  stock: i === 1 ? 0 : -1, isActive: i < 2, copyReview: i === 2 ? 1 : 0,
}));

function renderProducts() {
  const onSupplierFilterChange = vi.fn();
  const onPageChange = vi.fn();
  const result = render(<ProductsSection prods={list} paged={list} filtered={list} q=""
    safePage={1} totalPages={1} perPage={20} perPageAdmin={20} loadingList={false}
    toggling={null} reordering={null} activeProducts={2} lowStock={0} soldProducts={0}
    liveProducts={1} hiddenProducts={1} offProducts={3} liveTab="all" supplierFilter="all"
    onSupplierFilterChange={onSupplierFilterChange} onPageChange={onPageChange}
    onQueryChange={vi.fn()} onPerPageChange={vi.fn()} onLiveTabChange={vi.fn()}
    onlyLowStock={false} onClearLowStock={vi.fn()} onNew={vi.fn()} onEdit={vi.fn()}
    onDelete={vi.fn()} onToggleActive={vi.fn()} onMove={vi.fn()} onJump={vi.fn()} onSoldCount={vi.fn()} />);
  return { ...result, onSupplierFilterChange, onPageChange };
}

describe("admin supplier identity", () => {
  it("names all origins in the legend and both responsive product layouts, before their status", () => {
    const { container } = renderProducts();
    const legend = screen.getByRole("group", { name: "Legenda asal supplier" });
    for (const supplier of suppliers) {
      const name = `Supplier: ${SUPPLIER_STYLES[supplier].fullName}`;
      expect(within(legend).getByLabelText(name).textContent).toBe(SUPPLIER_STYLES[supplier].label);
      const badges = screen.getAllByLabelText(name);
      expect(badges).toHaveLength(3);
      badges.slice(1).forEach(badge => {
        expect(badge.title).toContain(" · slug /product-");
        expect(badge.querySelector('[aria-hidden="true"]')).toBeTruthy();
        expect(badge.parentElement?.firstElementChild).toBe(badge);
        expect(badge.nextElementSibling?.textContent).toBe(supplier === "WR" ? "Live" : supplier === "SK" ? "Stok habis" : "Nonaktif");
      });
    }
    expect(container.querySelectorAll(".admin-supplier-badge")).toHaveLength(suppliers.length * 3);
    expect(screen.getAllByText("S&K perlu ditinjau · 1 varian")).toHaveLength(2);
  });

  it("preserves every supplier filter value and resets pagination", () => {
    const { onSupplierFilterChange, onPageChange } = renderProducts();
    const filter = screen.getByRole("combobox", { name: "Filter asal supplier" });
    expect(filter.getAttribute("aria-describedby")).toBe("supplier-legend");
    expect(within(filter).getAllByRole("option").map(option => (option as HTMLOptionElement).value)).toEqual(["all", ...suppliers]);
    [...suppliers, "all"].forEach((supplier, i) => {
      fireEvent.change(filter, { target: { value: supplier } });
      expect(onSupplierFilterChange).toHaveBeenNthCalledWith(i + 1, supplier);
      expect(onPageChange.mock.calls[i][0](8)).toBe(1);
    });
  });

  it("identifies an unspecified supplier as Manual Axvara", () => {
    render(<SupplierBadge />);
    const badge = screen.getByLabelText("Supplier: Manual Axvara");
    expect(badge.textContent).toBe("Manual");
    expect(badge.title).toBe("Supplier: Manual Axvara");
  });
});
