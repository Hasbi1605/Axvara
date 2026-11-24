import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { deriveAivaultBulkTiers, scaleAivaultBulkMarkup } from "@/lib/aivault/bulk";
import { aivaultSellPrice } from "@/lib/aivault/families";
import { formatRupiah } from "@/lib/utils";
import { TUNVN_BUFF_MARKUP_PERCENT } from "@/lib/tunvn/pricing";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, NativeSelect, Tabs, TabsContent, TabsList, TabsTrigger } from "../ui";
import { VariantStatusBadge } from "../SupplierTabs";
import { SupplierPriceHeader, SupplierPriceRow, StatusBadges, costWithIdr } from "../SupplierPriceRow";
import { BulkMarkupToolbar } from "../BulkMarkupToolbar";
import { supplierMoney, type CatalogItem } from "../supplier-admin-data";
import { useSupplierPanelContext, type MarkupSubTab } from "./panel-context";

function aivaultBulkMarkupPreview(item: CatalogItem, nextMarkup: number) {
  const { bulk_markup_tiers: tiers, markup_percent: oldMarkup, cost, fx } = item;
  if (!tiers?.length || oldMarkup <= 0 || cost == null || fx == null) return;
  let price: number;
  try { price = aivaultSellPrice(cost, fx, nextMarkup); }
  catch { return; }
  const preview = deriveAivaultBulkTiers(cost, fx, price, scaleAivaultBulkMarkup(tiers, oldMarkup, nextMarkup));
  return preview.length
    ? `Grosir ikut disesuaikan: ${preview.map(t => `${t.min_qty}+ ${formatRupiah(t.unit_price)}`).join(" · ")}`
    : "Grosir ikut disesuaikan: tidak ada tier aktif pada markup ini.";
}

function DeliveryBadge({ wrClass }: { wrClass?: string | null }) {
  if (wrClass === "restock") return <Badge variant="secondary" title="Kirim otomatis">AUTO</Badge>;
  if (wrClass === "made_by_order") return <Badge variant="warning" title="MANUAL · diproses sesuai antrean">MANUAL</Badge>;
  return null;
}

function ProcessBadge({ process }: { process?: string | null }) {
  const p = String(process || "").toLowerCase();
  if (p === "auto") return <Badge variant="secondary" title="Lisensi langsung">AUTO</Badge>;
  if (p === "manual") return <Badge variant="warning" title="MANUAL · diproses admin SK">MANUAL</Badge>;
  if (p === "h2h" || p === "smm" || p === "vip") return <Badge variant="secondary" title={`${p.toUpperCase()} · belum didukung fase 1`}>{p.toUpperCase()}</Badge>;
  return process ? <Badge variant="secondary">{process}</Badge> : null;
}

function FamilyCard({ title, description, archived, parentInactive, mode = "manual", selectable = false, children }: {
  title: string; description: ReactNode; archived?: boolean; parentInactive?: boolean;
  mode?: "manual" | "fixed"; selectable?: boolean; children: ReactNode;
}) {
  return <Card>
    <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 p-4 pb-2">
      <CardTitle className="min-w-0 break-words text-base">{title}</CardTitle>
      <StatusBadges archived={archived} parentInactive={parentInactive} />
      <CardDescription className="w-full break-words text-xs">{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-2 p-4 pt-0">
      <SupplierPriceHeader mode={mode} selectable={selectable} />
      {children}
    </CardContent>
  </Card>;
}

function SupplierDescription({ text }: { text: string }) {
  return <details className="text-xs">
    <summary className="min-h-11 cursor-pointer py-2 text-admin-muted hover:text-admin-fg md:min-h-0 md:py-0">Deskripsi supplier</summary>
    <p className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-admin-border bg-admin-subtle/60 p-2.5 leading-5 text-admin-muted">{text}</p>
  </details>;
}

export function MarkupTab() {
  const {
    query, setQuery, setMarkupPage, markupPerPage, setMarkupPerPage, markupTab, markupTabTouched,
    setMarkupTab, markupCounts, partialMarkupLoad, wrSkMarkupTotal, markupPagedIds, markupFiltered,
    bulkSelected, config, mode, locked, wrSkMarkupLoading, setBulkConfirm, setBulkSelected, applyBulkMarkup,
    setActionError, isWrSk, wrSkMarkups, name, items, catalog, buff, supplier, markupPaged, needle,
    pagedGroups, currency, setBulk, setBulkError, markupTotalPages, markupSafePage, busy, saveWrSkMarkup,
    mutateStandard,
  } = useSupplierPanelContext();

  function priceRow(row: {
    key: string; id: string; bulkId: string; path: string; title: string; selectLabel?: string;
    meta: ReactNode; badges?: ReactNode; details?: ReactNode;
    markupPreview?: (value: number) => string | undefined;
    active: boolean; canEdit: boolean; manual: number | null; fixed: number; price: number | null; markup: number;
    item?: CatalogItem;
  }) {
    return <SupplierPriceRow
      key={row.key}
      id={row.id}
      title={row.title}
      selectLabel={row.selectLabel ?? row.title}
      meta={row.meta}
      badges={row.badges}
      details={row.details}
      markupPreview={row.markupPreview}
      mode={mode}
      markup={row.markup}
      manual={row.manual}
      fixed={row.fixed}
      price={row.price}
      active={row.active}
      canEdit={row.canEdit}
      locked={locked}
      busy={busy === row.path}
      selectable
      selected={bulkSelected.has(row.bulkId)}
      onSelectChange={checked => setBulkSelected(prev => {
        const next = new Set(prev);
        if (checked) next.add(row.bulkId);
        else next.delete(row.bulkId);
        return next;
      })}
      onToggle={isWrSk ? undefined : () => void mutateStandard("Markup", row.path, { is_active: !row.active }, `${row.title} ${row.active ? "dinonaktifkan" : "diaktifkan"}.`, { patch: true })}
      onSave={async body => {
        if (isWrSk && row.item) await saveWrSkMarkup(row.item, body);
        else await mutateStandard("Markup", row.path, body, `Harga ${row.title} disimpan.`, { patch: true });
      }}
    />;
  }

  return <TabsContent value="markup" className="mt-4 space-y-4">
    <div className="flex items-center justify-between gap-2">
      <Input className="min-h-11 min-w-0 flex-1 sm:max-w-sm md:min-h-0" value={query} onChange={event => { setQuery(event.target.value); setMarkupPage(1); }} placeholder="Cari varian…" aria-label="Cari varian" />
      <NativeSelect value={markupPerPage} onChange={event => { setMarkupPerPage(Number(event.target.value) as 20 | 50 | 100); setMarkupPage(1); }} aria-label="Jumlah per halaman" className="min-h-11 w-[110px] shrink-0 md:min-h-0">
        <option value={20}>20 / hal</option>
        <option value={50}>50 / hal</option>
        <option value={100}>100 / hal</option>
      </NativeSelect>
    </div>

    <Tabs value={markupTab} onValueChange={value => { markupTabTouched.current = true; setMarkupTab(value as MarkupSubTab); setMarkupPage(1); }}>
      <TabsList aria-label="Status tampil varian">
        {([
          ["live", `Live (${markupCounts.live})`],
          ["hidden", `Disembunyikan otomatis (${markupCounts.hidden})`],
          ["off", `Nonaktif manual (${markupCounts.off})`],
          ["all", `Semua (${partialMarkupLoad ? `${markupCounts.total} / ${wrSkMarkupTotal}` : markupCounts.total})`],
        ] as const).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
      </TabsList>
    </Tabs>

    {partialMarkupLoad && (
      <p role="status" className="text-xs text-admin-warning">
        Menampilkan {wrSkMarkups.length} dari {wrSkMarkupTotal} varian. Gunakan pencarian untuk menyaring katalog lengkap.
      </p>
    )}

    {markupPagedIds.length > 0 && <BulkMarkupToolbar
      selectionOnly
      visibleIds={markupPagedIds}
      totalCount={markupFiltered.length}
      selected={bulkSelected}
      maxPercent={config.maxMarkup}
      allowDecimal={mode === "manual"}
      percentStep={config.percentStep}
      resetLabel={mode === "fixed" ? "reset Rp ke 0" : "reset harga manual ke rumus"}
      resetTitle={mode === "fixed" ? "Nolkan markup nominal." : "Hapus harga manual dari varian terpilih."}
      resetConfirmText={mode === "fixed" ? " + reset Rp ke 0" : " + reset harga manual ke rumus"}
      disabled={locked || wrSkMarkupLoading}
      confirmApply={message => new Promise<boolean>(resolve => setBulkConfirm({ message, resolve }))}
      onToggleOne={id => setBulkSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      })}
      onToggleAllVisible={checked => setBulkSelected(checked ? new Set(markupPagedIds) : new Set())}
      onClear={() => setBulkSelected(new Set())}
      onApply={applyBulkMarkup}
      onError={error => setActionError(error instanceof Error ? error.message : "Bulk markup gagal.")}
    />}

    {isWrSk && wrSkMarkupLoading && wrSkMarkups.length === 0 && (
      <p role="status" className="text-sm text-admin-muted">Memuat varian {name}…</p>
    )}
    {(isWrSk ? (!wrSkMarkupLoading && !items.length) : (catalog != null && !items.length && !buff?.variants.length)) && (
      <p className="text-sm text-admin-muted">{isWrSk ? `Belum ada varian ${supplier === "warung" ? "WR" : "SK"} tersinkron.` : "Sinkronkan katalog dari tab Alat untuk memulai."}</p>
    )}
    {(items.length > 0 || Boolean(buff?.variants.length)) && markupPaged.length === 0 && (
      <p className="text-sm text-admin-muted">{needle ? "Tidak ada varian yang cocok." : "Tidak ada varian pada tab ini."}</p>
    )}

    {pagedGroups.groups.map(group => <FamilyCard key={group.key} title={group.name}
      description={`${group.items.length} varian`}
      archived={group.archived} parentInactive={group.inactive} mode={mode} selectable>
      {group.items.map(item => {
        if (isWrSk) {
          const canEdit = item.product_archived !== 1;
          const stockText = item.stock === -1 ? "∞" : String(item.stock);
          const extraReason = (item.variantStatus === "hidden_loser" || (item.variantStatus === "live" && item.variantReason?.startsWith("Gabung di "))) && item.variantReason ? ` · ${item.variantReason}` : "";
          return priceRow({
            key: `${supplier}-${item.id}`,
            id: `${supplier}-${item.id}`,
            bulkId: item.bulkId,
            path: `markup/${item.id}`,
            title: item.label,
            selectLabel: item.name || item.label,
            meta: <>
              Modal {formatRupiah(Number(item.cost ?? 0))} · stok {stockText}
              {supplier === "sekalipay" && item.sk_min_order && Number(item.sk_min_order) > 1 ? ` · Min. ${item.sk_min_order}` : ""}
              {supplier === "sekalipay" && item.sk_status ? ` · ${item.sk_status}` : ""}
              {item.name && item.name !== item.label ? ` · ${item.name}` : ""}
              {extraReason}
            </>,
            badges: <>
              {supplier === "warung" ? <DeliveryBadge wrClass={item.wr_delivery_class} /> : <ProcessBadge process={item.sk_order_process} />}
              <VariantStatusBadge status={item.variantStatus} reason={item.variantReason} />
            </>,
            markup: Number(item.markup_percent),
            manual: null,
            fixed: item.fixed,
            price: item.sellPrice,
            active: item.variantActive,
            canEdit,
            item,
          });
        }
        const canEdit = item.variant_id != null && item.product_archived !== 1;
        const { cost, fx, label } = item;
        const price = item.variant_price ?? item.manual ?? (cost != null && cost > 0 && fx != null && fx > 0 ? Math.ceil(cost * fx * (1 + item.markup_percent / 100) / 100) * 100 : null);
        return priceRow({
          key: `${supplier}-${item.id}`,
          id: `${supplier}-${item.id}`,
          bulkId: item.bulkId,
          path: `products/${encodeURIComponent(String(item.id))}`,
          title: label,
          meta: <>{item.name && item.name !== label ? `${item.name} · ` : ""}Modal {costWithIdr(supplierMoney(currency, cost), cost, fx)}{item.delivery_type === "muse_buff" ? " per 1 miliar token" : ""} · stok {item.stock === -1 ? "∞" : item.stock}
            {config.bulk && !!item.bulk_tiers_preview?.length && <span className="mt-1 block">Grosir: {item.bulk_tiers_preview.map(t => `${t.min_qty}+ ${formatRupiah(t.unit_price)}`).join(" · ")}</span>}
            {(item.variantStatus === "hidden_loser" || (item.variantStatus === "live" && item.variantReason?.startsWith("Gabung di "))) && item.variantReason ? ` · ${item.variantReason}` : ""}
          </>,
          badges: <>
            <VariantStatusBadge status={item.variantStatus} reason={item.variantReason} />
            {item.variant_id == null && item.variantStatus !== "hidden_nocatalog" ? <Badge variant="warning">Belum dipetakan</Badge> : config.bulk && canEdit
              ? <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-0" disabled={locked} onClick={event => { setBulkError(""); setBulk({ item, trigger: event.currentTarget }); }}>Grosir</Button> : null}
          </>,
          details: config.disclosure && item.supplier_description?.trim() ? <SupplierDescription text={item.supplier_description} /> : undefined,
          markupPreview: config.bulk && item.bulk_markup_tiers?.length ? value => aivaultBulkMarkupPreview(item, value) : undefined,
          markup: Number(item.markup_percent),
          manual: item.manual,
          fixed: 0,
          price,
          active: item.variantActive,
          canEdit,
        });
      })}
    </FamilyCard>)}

    {config.buff && pagedGroups.buffRows.length > 0 && <FamilyCard title="Buff Token Muse" archived={buff?.muse_product?.archived === 1}
      parentInactive={buff?.muse_product?.is_active === 0} mode="manual" selectable description={buff?.probe
        ? <>Modal terverifikasi {supplierMoney("USDT", buff.probe.cost_per_b_usdt)}/1B · layanan <span className={buff.probe.fundable ? "text-admin-success" : "text-admin-warning"}>{buff.probe.fundable ? "bisa diproses" : "sementara tidak bisa"}</span></>
        : <span className="text-admin-warning">Probe tidak tersedia; harga memakai snapshot terakhir.</span>}>
      {pagedGroups.buffRows.map(({ variant, status, reason }) => priceRow({
        key: `buff-${variant.sku}`,
        id: `buff-${variant.sku}`,
        bulkId: variant.sku,
        path: `buff/${encodeURIComponent(variant.sku)}`,
        title: variant.label,
        meta: <>Per {variant.tunvn_buff_quantity_b} miliar token · modal {costWithIdr(supplierMoney("USDT", variant.tunvn_cost_usdt), variant.tunvn_cost_usdt, variant.tunvn_fx_idr_per_usdt)}{(status === "hidden_loser" || (status === "live" && reason?.startsWith("Gabung di "))) && reason ? ` · ${reason}` : ""}</>,
        badges: <VariantStatusBadge status={status} reason={reason} />,
        markup: Number(variant.tunvn_markup_percent ?? TUNVN_BUFF_MARKUP_PERCENT),
        manual: variant.tunvn_admin_price_idr,
        fixed: 0,
        price: variant.price,
        active: variant.is_active === 1,
        canEdit: buff?.muse_product?.archived !== 1,
      }))}
    </FamilyCard>}

    {markupFiltered.length > markupPerPage && (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-admin-border px-4 py-3">
        <p className="text-xs text-admin-muted">Hal {markupSafePage} dari {markupTotalPages} · {markupFiltered.length} varian</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" disabled={markupSafePage <= 1} onClick={() => setMarkupPage(p => Math.max(1, p - 1))}><ChevronLeft /> Sebelumnya</Button>
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" disabled={markupSafePage >= markupTotalPages} onClick={() => setMarkupPage(p => Math.min(markupTotalPages, p + 1))}>Berikutnya <ChevronRight /></Button>
        </div>
      </div>
    )}
  </TabsContent>;
}
