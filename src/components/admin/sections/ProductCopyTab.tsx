"use client";
// Tab "Deskripsi & S&K" di editor produk: deskripsi ID/EN + S&K umum produk +
// tabel ringkas S&K per varian dengan drawer CopyEditorSheet (berlaku untuk
// semua supplier termasuk Manual).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Button, Input, Label, Textarea, Tooltip, TooltipContent, TooltipTrigger } from "@/components/admin/ui";
import type { Locale } from "@/lib/i18n/locale";
import {
  composeDescription,
  splitDescription,
  summarizeDescriptionCopy,
  variantCopyTitle,
} from "@/lib/product-copy/editor-model";
import type { FormVariant, ProductForm } from "../product-types";
import type { VariantCopyState } from "./VariantCopyEditor";
import { LanguageToggle } from "./copy/LanguageToggle";
import { CopyVariantTable } from "./copy/CopyVariantTable";
import { CopyEditorSheet, type OtherVariantOption } from "./copy/CopyEditorSheet";
import { hasVariantEnglishCopy } from "./copy/status";

export { variantCopyTitle };

type DrawerTarget =
  | { mode: "product" }
  | { mode: "variant"; variantId: number; title: string };

export function ProductCopyTab({
  productId,
  form,
  onSetForm,
  formVariants,
  hasMultiVariants,
  loadingVariants,
  variantCopy,
}: {
  productId?: number | string;
  form: ProductForm;
  onSetForm: (form: ProductForm) => void;
  formVariants: FormVariant[];
  hasMultiVariants: boolean;
  loadingVariants: boolean;
  variantCopy: VariantCopyState;
}) {
  const id = useId();
  const nameEnId = `${id}-name-en`;
  const descriptionId = `${id}-description`;
  const [lang, setLang] = useState<Locale>("id");
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const wrManaged = Boolean(form.wrManaged);
  const hasDescOverride = Boolean(form.adminDescriptionOverride?.trim());
  const effectiveIdDescription = wrManaged
    ? hasDescOverride
      ? (form.adminDescriptionOverride ?? "")
      : (form.description ?? "")
    : (form.description ?? "");
  const activeRawDescription = lang === "en" ? (form.descriptionEn ?? "") : effectiveIdDescription;

  const idSplit = useMemo(() => splitDescription(effectiveIdDescription), [effectiveIdDescription]);
  const enSplit = useMemo(() => splitDescription(form.descriptionEn), [form.descriptionEn]);
  const activeSplit = lang === "en" ? enSplit : idSplit;

  const [bodyDraft, setBodyDraft] = useState(activeSplit.body);
  const syncKey = `${lang}:${wrManaged ? (hasDescOverride ? "override" : "raw") : "direct"}`;
  const lastSyncKeyRef = useRef(syncKey);

  useEffect(() => {
    const keyChanged = lastSyncKeyRef.current !== syncKey;
    lastSyncKeyRef.current = syncKey;
    if (keyChanged || activeSplit.body !== bodyDraft.trim()) {
      setBodyDraft(activeSplit.body);
    }
  }, [syncKey, activeSplit.body, bodyDraft]);

  const handleBodyChange = (nextBody: string) => {
    setBodyDraft(nextBody);
    if (lang === "en") {
      const nextEn = composeDescription({ ...enSplit, body: nextBody }, "en");
      onSetForm({ ...form, descriptionEn: nextEn });
      return;
    }
    const nextId = composeDescription({ ...idSplit, body: nextBody }, "id");
    if (wrManaged) {
      onSetForm({ ...form, adminDescriptionOverride: nextId });
    } else {
      onSetForm({ ...form, description: nextId });
    }
  };

  const missingEnCount = useMemo(() => {
    const descMissing = !(form.descriptionEn ?? "").trim() ? 1 : 0;
    const variantMissing = formVariants.filter(
      (variant) =>
        typeof variant.id === "number" &&
        Number(variant.is_active ?? 1) !== 0 &&
        !hasVariantEnglishCopy(variantCopy.entries.get(variant.id)),
    ).length;
    return descMissing + variantMissing;
  }, [form.descriptionEn, formVariants, variantCopy.entries]);

  const productCopySummary = useMemo(
    () => summarizeDescriptionCopy(activeSplit),
    [activeSplit],
  );

  const productHasEn = useMemo(() => {
    const termsCount =
      enSplit.paket.length + enSplit.proses.length + enSplit.aturan.length + enSplit.garansi.length;
    return termsCount > 0 || enSplit.activation.length > 0;
  }, [enSplit]);

  const otherVariants = useMemo<OtherVariantOption[]>(() => {
    if (drawer?.mode !== "variant") return [];
    return formVariants
      .filter((v): v is FormVariant & { id: number } => typeof v.id === "number" && v.id !== drawer.variantId)
      .map((v) => {
        const baseTitle = variantCopyTitle(v);
        return {
          id: v.id,
          title: hasMultiVariants ? baseTitle : form.name?.trim() || baseTitle,
          inactive: Number(v.is_active ?? 1) === 0,
        };
      });
  }, [drawer, formVariants, hasMultiVariants, form.name]);

  const { report: reportVariantState } = variantCopy;

  const handleDrawerStateChange = useCallback(
    (dirty: boolean, saving: boolean) => {
      if (drawer?.mode === "variant") {
        reportVariantState(drawer.variantId, dirty, saving);
      } else {
        reportVariantState(0, dirty, saving);
      }
    },
    [drawer, reportVariantState],
  );

  const closeDrawer = useCallback(() => {
    if (drawer?.mode === "variant") {
      reportVariantState(drawer.variantId, false, false);
    } else {
      reportVariantState(0, false, false);
    }
    setDrawer(null);
  }, [drawer, reportVariantState]);

  const openProductDrawer = (trigger: HTMLElement | null) => {
    returnFocusRef.current = trigger;
    setDrawer({ mode: "product" });
  };

  const openVariantDrawer = (variant: FormVariant, title: string, trigger: HTMLElement | null) => {
    if (typeof variant.id !== "number") return;
    returnFocusRef.current = trigger;
    setDrawer({ mode: "variant", variantId: variant.id, title });
  };

  const activeVariantId = drawer?.mode === "variant" ? drawer.variantId : undefined;
  const activeEntry = activeVariantId ? variantCopy.entries.get(activeVariantId) : undefined;

  return (
    <div className="mt-4 space-y-6">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 border-b border-admin-border bg-admin-card/95 px-1 py-2.5 backdrop-blur-sm">
        <span className="text-xs font-semibold text-admin-muted">Bahasa</span>
        <LanguageToggle
          value={lang}
          onChange={setLang}
          missingEnCount={missingEnCount}
          ariaLabel="Bahasa editor deskripsi dan S&K"
        />
      </div>

      <section aria-labelledby={`${id}-description-title`} className="space-y-4">
        <h4 id={`${id}-description-title`} className="text-sm font-semibold text-admin-fg">
          Deskripsi produk
        </h4>

        {lang === "en" && (
          <div className="space-y-1.5">
            <Label htmlFor={nameEnId}>Nama (EN)</Label>
            <Input
              id={nameEnId}
              value={form.nameEn ?? ""}
              onChange={(e) => onSetForm({ ...form, nameEn: e.target.value })}
              maxLength={120}
              placeholder="Opsional — kosongkan untuk terjemahan token otomatis"
              title="Kosongkan untuk memakai terjemahan token otomatis (durasi/tier) dari nama Indonesia"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label htmlFor={descriptionId}>
              {lang === "en" ? "Teks deskripsi (English)" : "Teks deskripsi"}
            </Label>
            <span className="text-xs text-admin-muted">
              paragraf pembuka, lalu &quot;- &quot; per keunggulan
            </span>
          </div>
          <Textarea
            id={descriptionId}
            value={bodyDraft}
            onChange={(e) => handleBodyChange(e.target.value)}
            rows={6}
            maxLength={2000}
            aria-describedby={`${descriptionId}-status`}
            placeholder={
              lang === "en"
                ? "Opening paragraph...\n\n- Key benefit 1\n- Key benefit 2"
                : "Paragraf pembuka produk...\n\n- Keunggulan 1\n- Keunggulan 2"
            }
            className="min-h-32 resize-y font-sans text-sm leading-5"
          />
          <p id={`${descriptionId}-status`} className="sr-only">
            {activeRawDescription.length} karakter
          </p>
        </div>

        {lang === "id" && wrManaged && Boolean(form.description?.trim()) && (
          <details className="rounded-lg border border-admin-border bg-admin-subtle/40 px-3 py-2 text-xs text-admin-muted">
            <summary className="cursor-pointer py-1 font-medium text-admin-fg">
              Teks asli WR/SK (pembanding)
            </summary>
            <p className="mt-2 whitespace-pre-wrap break-words border-t border-admin-border pt-2 leading-5">
              {form.description}
            </p>
          </details>
        )}

        {lang === "en" && Boolean(effectiveIdDescription.trim()) && (
          <details className="rounded-lg border border-admin-border bg-admin-subtle/40 px-3 py-2 text-xs text-admin-muted">
            <summary className="cursor-pointer py-1 font-medium text-admin-fg">
              Teks Indonesia (pembanding)
            </summary>
            <p className="mt-2 whitespace-pre-wrap break-words border-t border-admin-border pt-2 leading-5">
              {effectiveIdDescription}
            </p>
          </details>
        )}

        {lang === "id" && wrManaged && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex cursor-help rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring">
                  <Badge variant={hasDescOverride ? "success" : "warning"}>
                    {hasDescOverride ? "Disunting admin" : "Ikut supplier"}
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {hasDescOverride
                  ? "Perubahan tersimpan sebagai deskripsi khusus saat Simpan Produk."
                  : "Mengikuti teks supplier; sunting di atas untuk membuat versi AXVARA."}
              </TooltipContent>
            </Tooltip>
            {hasDescOverride && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setBodyDraft(splitDescription(form.description).body);
                  onSetForm({ ...form, adminDescriptionOverride: "" });
                }}
              >
                Pakai teks asli
              </Button>
            )}
          </div>
        )}

        {lang === "en" && (
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex cursor-help rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring">
                  <Badge variant={form.descriptionEn?.trim() ? "success" : "secondary"}>
                    {form.descriptionEn?.trim() ? "Disunting admin" : "Kosong"}
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {form.descriptionEn?.trim()
                  ? "Dipakai storefront EN saat Simpan Produk."
                  : "Kosong — pembeli EN melihat versi Indonesia."}
              </TooltipContent>
            </Tooltip>
            {!form.descriptionEn?.trim() && (
              <span className="text-xs text-admin-muted">
                Pembeli EN melihat versi Indonesia.
              </span>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby={`${id}-terms-title`} className="space-y-3 border-t border-admin-border pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 id={`${id}-terms-title`} className="text-sm font-semibold text-admin-fg">
            S&amp;K &amp; cara aktivasi
          </h4>
          <span className="text-xs text-admin-muted">
            Per varian tersimpan langsung; semua varian lewat Terapkan lalu Simpan Produk.
          </span>
        </div>

        <CopyVariantTable
          variants={formVariants}
          hasMultiVariants={hasMultiVariants}
          productName={form.name}
          entries={variantCopy.entries}
          loading={variantCopy.loading}
          loadingVariants={loadingVariants}
          error={variantCopy.error}
          lang={lang}
          productCopySummary={productCopySummary}
          productHasEn={productHasEn}
          onEditProductCopy={openProductDrawer}
          onEditVariant={openVariantDrawer}
          onReload={variantCopy.reload}
        />
      </section>

      <CopyEditorSheet
        open={drawer !== null}
        mode={drawer?.mode ?? "variant"}
        productId={productId}
        productName={form.name}
        initialLang={lang}
        variantId={activeVariantId}
        variantTitle={drawer?.mode === "variant" ? drawer.title : undefined}
        entry={activeEntry}
        otherVariants={otherVariants}
        descriptionId={effectiveIdDescription}
        descriptionEn={form.descriptionEn}
        returnFocusTo={returnFocusRef}
        onClose={closeDrawer}
        onSavedVariant={variantCopy.update}
        onBulkSavedVariants={variantCopy.updateMany}
        onReload={variantCopy.reload}
        onApplyProductCopy={({ idDescription, enDescription }) => {
          const nextBody = lang === "en" ? splitDescription(enDescription).body : splitDescription(idDescription).body;
          setBodyDraft(nextBody);
          if (wrManaged) {
            onSetForm({
              ...form,
              adminDescriptionOverride: idDescription,
              descriptionEn: enDescription,
            });
          } else {
            onSetForm({
              ...form,
              description: idDescription,
              descriptionEn: enDescription,
            });
          }
        }}
        onStateChange={handleDrawerStateChange}
      />
    </div>
  );
}
