// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { render } from "./setup/admin-render";
import { ProductsSection } from "@/components/admin/sections/ProductsSection";
import { ProductEditorModal } from "@/components/admin/ProductEditorModal";
import { ToastProvider } from "@/components/ui/Toast";
import type { Prod, ProductForm } from "@/components/admin/product-types";

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAdmin: vi.fn(async () => (auth.admin ? { email: "admin@example.test" } : null)),
}));

describe("Admin merged-group badges, linked variant editor, and storefront soldout hiding", () => {
  let fx: ReturnType<typeof createD1Fixture>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
    auth.admin = true;
    fx = createD1Fixture();
    fx.sql.exec(`
      INSERT OR IGNORE INTO categories(id, slug, name, sort_order) VALUES (1, 'ai', 'AI & Chatbot', 1);
      INSERT INTO products(id, name, slug, price, stock, is_active, category_id, source, storebat_family)
      VALUES
        (60, 'Google AI / Gemini', 'google-ai-pro-antigravity', 18000, 10, 1, 1, 'manual', NULL),
        (407, 'Google AI / Gemini', 'gemini-sb', 29100, 55, 1, 1, 'manual', 'product:137'),
        (51968, 'Google AI / Gemini', 'gemini-plus-sb', 16000, 71, 1, 1, 'manual', 'product:117');
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, is_active, fulfillment_mode)
      VALUES
        (1022449, 60, 'GOOGLE-AI-PRO-ANTIGRAVITY-INVITE-12M', 'Google AI Pro Invite - 12 Bulan', 18000, 10, 1, 'manual'),
        (3277, 60, 'GOOGLE-AI-PRO-ANTIGRAVITY-PLUS-6M', 'Google AI Plus - 6 Bulan', 17000, 0, 1, 'manual'),
        (990001, 60, 'QA-SOLD-OUT-LOW', 'Paket habis murah', 9000, 0, 1, 'manual'),
        (990002, 60, 'QA-SOLD-OUT-HIGH', 'Paket habis mahal', 90000, 0, 1, 'manual'),
        (100490, 407, 'SB-137', 'CDK Google AI Pro 12 Bulan', 29100, 55, 1, 'manual'),
        (999186, 51968, 'SB-117', 'Gemini Plus 6 Bulan', 16000, 71, 1, 'manual');
      UPDATE product_variants SET compare_price = 75000 WHERE id = 990001;
      INSERT INTO product_groups(id, name, winner_product_id, mode) VALUES (34, 'Google AI / Gemini', 60, 'merge_variants');
      INSERT INTO product_group_members(group_id, product_id, position) VALUES (34, 60, 1), (34, 407, 2), (34, 51968, 3);
      INSERT INTO product_group_slots(id, group_id, name, winner_variant_id, sort_order) VALUES (1, 34, 'Gemini Plus 6 Bulan', 999186, 1);
      INSERT INTO product_group_slot_members(slot_id, variant_id, position) VALUES (1, 3277, 1), (1, 999186, 2);
    `);
  });

  afterEach(() => {
    cleanup();
    fx.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("GET /api/products returns mergedSuppliers & store summary for admin only, and public active=1 counts only purchasable variants when available", async () => {
    const { GET } = await import("@/app/api/products/route");
    const adminRes = await GET(new NextRequest("http://localhost/api/products"));
    expect(adminRes.status).toBe(200);
    const adminData = await adminRes.json();
    const winner = adminData.products.find((p: { id: string }) => p.id === "60");
    expect(winner).toMatchObject({
      supplier: "Manual",
      mergedSuppliers: ["Manual", "StoreBat"],
      mergedGroupId: 34,
      mergedGroupName: "Google AI / Gemini",
      mergedMinPrice: 16000,
      mergedStock: 136,
      mergedVariantCount: 3,
    });

    // Public catalog hides admin-only merged fields and counts 3 purchasable variants
    const pubRes = await GET(new NextRequest("http://localhost/api/products?active=1"));
    expect(pubRes.status).toBe(200);
    const pubData = await pubRes.json();
    const pubCard = pubData.products.find((p: { id: string }) => p.id === "60");
    expect(pubCard).toMatchObject({ price: 16000, maxPrice: 29100, stock: 136, variantCount: 3 });
    expect(pubCard.comparePrice).toBeUndefined(); // the sold-out one has a discount, the buyable one doesn't
    expect(pubCard.mergedSuppliers).toBeUndefined();
    expect(pubCard.supplier).toBeUndefined();

    const { listActiveProducts } = await import("@/lib/catalog");
    expect((await listActiveProducts()).find((p) => p.slug === "google-ai-pro-antigravity")).toMatchObject({
      minPrice: 16000, maxPrice: 29100, variantCount: 3,
    });
  });

  it("GET /api/products/[id] returns mergedGroup.members with supplier badges and slot statuses", async () => {
    const { GET } = await import("@/app/api/products/[id]/route");
    const res = await GET(new NextRequest("http://localhost/api/products/60"), {
      params: Promise.resolve({ id: "60" }),
    });
    expect(res.status).toBe(200);
    const { product } = await res.json();
    expect(product.mergedGroup).toMatchObject({
      groupId: 34,
      groupName: "Google AI / Gemini",
      isWinner: true,
    });
    expect(product.mergedGroup.members).toHaveLength(2);
    expect(product.mergedGroup.members[0]).toMatchObject({
      productId: 407,
      supplier: "StoreBat",
      variants: [{ id: 100490, label: "CDK Google AI Pro 12 Bulan", price: 29100, stock: 55, isBuyable: true, slotStatus: null }],
    });
    expect(product.mergedGroup.members[1]).toMatchObject({
      productId: 51968,
      supplier: "StoreBat",
      variants: [{ id: 999186, label: "Gemini Plus 6 Bulan", price: 16000, stock: 71, isBuyable: true, slotName: "Gemini Plus 6 Bulan", slotStatus: "winner" }],
    });
  });

  it("ProductsSection renders multi-supplier badges + store price/stock summary, and ProductEditorModal offers linked edit & group shortcuts", async () => {
    const prod: Prod = {
      id: "60",
      slug: "google-ai-pro-antigravity",
      name: "Google AI / Gemini",
      description: "",
      price: 18000,
      stock: 10,
      soldCount: 1122,
      groupSoldCount: 3532,
      isActive: true,
      categorySlug: "ai",
      categoryName: "AI & Chatbot",
      image: "",
      images: [],
      supplier: "Manual",
      mergedSuppliers: ["Manual", "StoreBat"],
      mergedGroupId: 34,
      mergedGroupName: "Google AI / Gemini",
      mergedMinPrice: 16000,
      mergedStock: 136,
      mergedVariantCount: 3,
      liveStatus: "live",
    };

    const { unmount } = render(
      <ProductsSection
        error={null}
        onRetry={vi.fn()}
        prods={[prod]}
        cats={[{ id: 1, slug: "ai", name: "AI & Chatbot" }]}
        paged={[prod]}
        filtered={[prod]}
        q=""
        safePage={1}
        totalPages={1}
        perPage={20}
        loadingList={false}
        toggling={null}
        activeProducts={1}
        lowStock={0}
        soldProducts={1122}
        liveProducts={1}
        hiddenProducts={0}
        offProducts={0}
        liveTab="live"
        onLiveTabChange={vi.fn()}
        perPageAdmin={20}
        onPerPageChange={vi.fn()}
        onQueryChange={vi.fn()}
        onPageChange={vi.fn()}
        onlyLowStock={false}
        supplierFilter="all"
        onSupplierFilterChange={vi.fn()}
        onClearLowStock={vi.fn()}
        onNew={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleActive={vi.fn()}
        reordering={null}
        onMove={vi.fn()}
        onJump={vi.fn()}
        onSoldCount={vi.fn()}
      />,
    );

    const table = screen.getByRole("region", { name: "Daftar produk" });
    expect(within(table).getByText("Manual")).toBeTruthy();
    expect(within(table).getByText("StoreBat")).toBeTruthy();
    expect(within(table).getByText("Gabung")).toBeTruthy();
    expect(within(table).getByText(/Toko: mulai Rp 16\.000/)).toBeTruthy();
    expect(within(table).getByText(/Toko: 136/)).toBeTruthy();
    unmount();

    const onEditLinked = vi.fn();
    const onOpenGroups = vi.fn();
    const form: ProductForm = {
      ...prod,
      mergedGroup: {
        groupId: 34,
        groupName: "Google AI / Gemini",
        isWinner: true,
        members: [
          {
            productId: 407,
            productName: "Google AI / Gemini",
            productSlug: "gemini-sb",
            supplier: "StoreBat",
            variants: [{ id: 100490, label: "CDK Google AI Pro 12 Bulan", price: 29100, stock: 55, isBuyable: true, slotName: null, slotStatus: null }],
          },
        ],
      },
    };

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ variants: [] }) })));
    render(
      <ToastProvider>
        <ProductEditorModal
          editing
          editingId="60"
          saving={false}
          uploading={false}
          loadingVariants={false}
          hasMultiVariants
          formError={null}
          form={form}
          formImages={[]}
          formVariants={[{ id: 1022449, sku: "GOOGLE-AI-PRO-ANTIGRAVITY-INVITE-12M", label: "Google AI Pro Invite - 12 Bulan", price: 18000, stock: 10, is_active: 1 }]}
          cats={[{ id: 1, slug: "ai", name: "AI & Chatbot" }]}
          onRequestClose={vi.fn()}
          onSetForm={vi.fn()}
          onSetFormImages={vi.fn()}
          onSetHasMultiVariants={vi.fn()}
          onSetFormVariants={vi.fn()}
          onUpload={vi.fn()}
          onSave={vi.fn()}
          onEditLinkedProduct={onEditLinked}
          onOpenProductGroups={onOpenGroups}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Varian (1)" }));
    const panel = await screen.findByTestId("merged-group-variants-panel");
    expect(within(panel).getByText("CDK Google AI Pro 12 Bulan")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Edit produk ini" }));
    expect(onEditLinked).toHaveBeenCalledWith(407);
    fireEvent.click(within(panel).getByRole("button", { name: "Atur Grup & Slot" }));
    expect(onOpenGroups).toHaveBeenCalledOnce();
  });
});
