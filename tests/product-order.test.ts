import { describe, expect, it } from "vitest";
import { groupProductsByCategory, sortProductsForDisplay } from "@/lib/product-order";

const categories = [
  { id: 1, slug: "a", name: "A", sort_order: 20 },
  { id: 2, slug: "b", name: "B", sort_order: 10 },
  { id: 3, slug: "empty", name: "Empty", sort_order: 0 },
];
const products = [
  { id: 1, categorySlug: "a", stock: 0, sortOrder: 1 },
  { id: 2, categorySlug: "b", stock: 0, sortOrder: 1 },
  { id: 3, categorySlug: "a", stock: -1, sortOrder: 2 },
  { id: 4, categorySlug: "b", stock: 5, sortOrder: 2 },
  { id: 5, categorySlug: "a", stock: 1, isActive: false, sortOrder: 0 },
  { id: 6, categorySlug: "missing", stock: 5, sortOrder: 0 },
  { id: 7, categorySlug: "a", stock: 10, sortOrder: 3 },
];

describe("category-first canonical display order", () => {
  it("omits empty categories, sorts status inside each group, unknown last, does not mutate", () => {
    const original = products.slice();
    const groups = groupProductsByCategory(products, categories);
    expect(groups.map(group => group.category?.slug ?? null)).toEqual(["b", "a", null]);
    expect(groups.map(group => group.products.map(product => product.id))).toEqual([[4, 2], [3, 7, 1, 5], [6]]);
    expect(products).toEqual(original);
    expect(sortProductsForDisplay(products).map(product => product.id)).toEqual([6, 3, 4, 7, 1, 2, 5]);
  });

  it("breaks category ties by name then id; snake_case category IDs also work", () => {
    const cats = [{ id: 2, slug: "b", name: "A", sort_order: 0 }, { id: 1, slug: "a", name: "A", sort_order: 0 }, { id: 3, slug: "c", name: "B", sort_order: 0 }];
    expect(groupProductsByCategory([{ id: 1, category_id: 2 }, { id: 2, category_id: 3 }, { id: 3, category_id: 1 }, { id: 4 }], cats).map(group => group.category?.id)).toEqual([1, 2, 3, undefined]);
  });
});
