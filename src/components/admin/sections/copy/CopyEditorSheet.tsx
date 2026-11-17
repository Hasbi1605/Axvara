"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, X } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Textarea,
} from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { ActivationBody, TermsBody } from "@/components/storefront/ProductCopy";
import type { Locale } from "@/lib/i18n/locale";
import {
  VARIANT_COPY_MAX_CHARS,
  mergeProductCopy,
  parseAdminVariantCopy,
  parseProductDescription,
  type VariantCopyEntry,
} from "@/lib/product-copy/format";
import {
  composeAdminCopy,
  composeDescription,
  splitAdminCopy,
  splitDescription,
  type AdminCopyModel,
} from "@/lib/product-copy/editor-model";
import { cn } from "@/lib/utils";
import { COPY_SNIPPETS, insertLineAtCursor, type SnippetSectionKind } from "./snippets";
import { LanguageToggle } from "./LanguageToggle";
import { badgeVariantProp, statusBadgeClassName, variantCopyStatus } from "./status";

type SectionStrings = {
  paket: string;
  proses: string;
  aturan: string;
  garansi: string;
  activation: string;
  notes: string;
};

type DualDrafts = {
  id: SectionStrings;
  en: SectionStrings;
};

const EMPTY_STRINGS: SectionStrings = {
  paket: "",
  proses: "",
  aturan: "",
  garansi: "",
  activation: "",
  notes: "",
};

function modelToStrings(model: Pick<AdminCopyModel, keyof SectionStrings>): SectionStrings {
  return {
    paket: model.paket.join("\n"),
    proses: model.proses.join("\n"),
    aturan: model.aturan.join("\n"),
    garansi: model.garansi.join("\n"),
    activation: model.activation.join("\n"),
    notes: model.notes.join("\n"),
  };
}

function stringsToModel(s: SectionStrings): AdminCopyModel {
  const split = (raw: string) => raw.split(/\r?\n/);
  return {
    paket: split(s.paket),
    proses: split(s.proses),
    aturan: split(s.aturan),
    garansi: split(s.garansi),
    activation: split(s.activation),
    notes: split(s.notes),
  };
}

function equalStrings(a: SectionStrings, b: SectionStrings): boolean {
  return (
    a.paket === b.paket &&
    a.proses === b.proses &&
    a.aturan === b.aturan &&
    a.garansi === b.garansi &&
    a.activation === b.activation &&
    a.notes === b.notes
  );
}

function isEmptyStrings(s: SectionStrings): boolean {
  return (
    !s.paket.trim() &&
    !s.proses.trim() &&
    !s.aturan.trim() &&
    !s.garansi.trim() &&
    !s.activation.trim() &&
    !s.notes.trim()
  );
}

const BULK_COPY_MAX_VARIANTS = 20;

export type OtherVariantOption = {
  id: number;
  title: string;
  inactive?: boolean;
};

export function CopyEditorSheet({
  open,
  mode,
  productId,
  productName,
  initialLang,
  variantId,
  variantTitle,
  entry,
  otherVariants,
  descriptionId,
  descriptionEn,
  returnFocusTo,
  onClose,
  onSavedVariant,
  onBulkSavedVariants,
  onReload,
  onApplyProductCopy,
  onStateChange,
}: {
  open: boolean;
  mode: "variant" | "product";
  productId?: number | string;
  productName?: string | null;
  initialLang: Locale;
  variantId?: number;
  variantTitle?: string;
  entry?: VariantCopyEntry;
  otherVariants: OtherVariantOption[];
  descriptionId?: string | null;
  descriptionEn?: string | null;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onSavedVariant: (entry: VariantCopyEntry) => void;
  onBulkSavedVariants: (entries: VariantCopyEntry[]) => void;
  onReload?: () => void;
  onApplyProductCopy: (next: { idDescription: string; enDescription: string }) => void;
  onStateChange?: (dirty: boolean, saving: boolean) => void;
}) {
  const ids = useId();
  const toast = useToast();
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);
  const prosesRef = useRef<HTMLTextAreaElement>(null);
  const aturanRef = useRef<HTMLTextAreaElement>(null);
  const garansiRef = useRef<HTMLTextAreaElement>(null);
  const preserveDraftRef = useRef(false);
  const wasOpenRef = useRef(false);
  const targetKeyRef = useRef<string>("");

  const [lang, setLang] = useState<Locale>(initialLang);
  const [drafts, setDrafts] = useState<DualDrafts>({ id: EMPTY_STRINGS, en: EMPTY_STRINGS });
  const [baseline, setBaseline] = useState<DualDrafts>({ id: EMPTY_STRINGS, en: EMPTY_STRINGS });
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showNewText, setShowNewText] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const computedBaseline = useMemo<DualDrafts>(() => {
    if (mode === "product") {
      const idSplit = splitDescription(descriptionId);
      const enSplit = splitDescription(descriptionEn);
      return {
        id: modelToStrings({ ...idSplit, notes: [] }),
        en: modelToStrings({ ...enSplit, notes: [] }),
      };
    }
    const idTerms = entry ? (entry.hasOverride ? entry.adminTerms : entry.autoTerms) : "";
    const idActivation = entry ? (entry.hasOverride ? entry.adminActivation : entry.autoActivation) : "";
    const enTerms = entry?.adminTermsEn ?? "";
    const enActivation = entry?.adminActivationEn ?? "";
    return {
      id: modelToStrings(splitAdminCopy(idTerms, idActivation)),
      en: modelToStrings(splitAdminCopy(enTerms, enActivation)),
    };
  }, [mode, descriptionId, descriptionEn, entry]);

  const targetKey = mode === "product" ? "product" : `variant:${variantId ?? 0}`;

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      preserveDraftRef.current = false;
      return;
    }

    const justOpened = !wasOpenRef.current || targetKeyRef.current !== targetKey;
    wasOpenRef.current = true;
    targetKeyRef.current = targetKey;

    if (justOpened) {
      setLang(initialLang);
      setSaveError(null);
      setShowNewText(false);
      setConfirmDiscard(false);
      setBulkOpen(false);
      setSelectedIds([]);
      setBaseline(computedBaseline);
      setDrafts(computedBaseline);
      preserveDraftRef.current = false;
      return;
    }

    setBaseline(computedBaseline);
    if (!preserveDraftRef.current) {
      setDrafts(computedBaseline);
    } else {
      preserveDraftRef.current = false;
    }
  }, [open, targetKey, initialLang, computedBaseline]);

  const dirty =
    !equalStrings(drafts.id, baseline.id) || !equalStrings(drafts.en, baseline.en);
  const busy = saving || bulkSaving;

  useEffect(() => {
    onStateChange?.(open && dirty, busy);
  }, [open, dirty, busy, onStateChange]);

  const currentDraft = drafts[lang];
  const updateField = (field: keyof SectionStrings, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [lang]: { ...prev[lang], [field]: value },
    }));
  };

  const sectionRefs: Record<SnippetSectionKind, React.RefObject<HTMLTextAreaElement | null>> = {
    proses: prosesRef,
    aturan: aturanRef,
    garansi: garansiRef,
  };

  const handleInsertSnippet = (section: SnippetSectionKind, snippetText: string) => {
    const textarea = sectionRefs[section].current;
    const { value, caret } = insertLineAtCursor(textarea, currentDraft[section], snippetText);
    updateField(section, value);
    window.setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      }
    }, 0);
  };

  const requestClose = () => {
    if (!open || busy) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const handleDiscardConfirm = () => {
    setConfirmDiscard(false);
    preserveDraftRef.current = false;
    onClose();
  };

  const saveVariantPayload = async (
    payload: Record<string, unknown>,
    successMessage: string,
    closeAfter = true,
  ) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/variant-copy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        variant?: VariantCopyEntry;
        error?: string;
      };
      if (!res.ok || !data.variant) {
        throw new Error(data.error || `Gagal menyimpan (${res.status})`);
      }
      preserveDraftRef.current = false;
      onSavedVariant(data.variant);
      toast.success(successMessage);
      if (closeAfter) onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Gagal menyimpan S&K";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveVariant = () => {
    if (!variantId || !entry || busy || !dirty) return;
    const idComposed = composeAdminCopy(stringsToModel(drafts.id), "id");
    const enComposed = composeAdminCopy(stringsToModel(drafts.en), "en");
    if (
      idComposed.terms.length > VARIANT_COPY_MAX_CHARS ||
      idComposed.activation.length > VARIANT_COPY_MAX_CHARS ||
      enComposed.terms.length > VARIANT_COPY_MAX_CHARS ||
      enComposed.activation.length > VARIANT_COPY_MAX_CHARS
    ) {
      setSaveError(`Teks melebihi batas ${VARIANT_COPY_MAX_CHARS} karakter.`);
      return;
    }
    void saveVariantPayload(
      {
        variant_id: variantId,
        terms: idComposed.terms,
        activation: idComposed.activation,
        terms_en: enComposed.terms,
        activation_en: enComposed.activation,
        supplier_key: entry.supplierKey,
      },
      "S&K varian disimpan.",
    );
  };

  const hasAnyOverride = Boolean(
    entry && (entry.hasOverride || entry.adminTermsEn?.trim() || entry.adminActivationEn?.trim()),
  );

  const handleRevertToAuto = () => {
    if (!variantId || !entry || busy || !hasAnyOverride) return;
    void saveVariantPayload(
      {
        variant_id: variantId,
        terms: "",
        activation: "",
        terms_en: "",
        activation_en: "",
        supplier_key: entry.supplierKey,
      },
      "S&K varian kembali ke versi otomatis.",
    );
  };

  const handleAcknowledge = () => {
    if (!variantId || !entry || busy || dirty) return;
    if (entry.adminStale) {
      void saveVariantPayload(
        {
          variant_id: variantId,
          terms: entry.adminTerms,
          activation: entry.adminActivation,
          terms_en: entry.adminTermsEn ?? "",
          activation_en: entry.adminActivationEn ?? "",
          supplier_key: entry.supplierKey,
        },
        "Suntingan ditinjau dan dipakai lagi.",
        false,
      );
      return;
    }
    void saveVariantPayload(
      {
        variant_id: variantId,
        supplier_key: entry.supplierKey,
        action: "acknowledge",
      },
      "Ditandai sudah ditinjau. Teks tetap ikut update supplier.",
      false,
    );
  };

  const handleUnacknowledge = () => {
    if (!variantId || !entry || busy || dirty || !entry.reviewed) return;
    void saveVariantPayload(
      {
        variant_id: variantId,
        supplier_key: entry.supplierKey,
        action: "unacknowledge",
      },
      "Tanda tinjauan dibatalkan.",
      false,
    );
  };

  const handleBulkApply = async () => {
    const pid = Number(productId);
    if (!Number.isInteger(pid) || pid <= 0 || selectedIds.length === 0 || busy) return;
    const idComposed = composeAdminCopy(stringsToModel(drafts.id), "id");
    const enComposed = composeAdminCopy(stringsToModel(drafts.en), "en");
    if (
      idComposed.terms.length > VARIANT_COPY_MAX_CHARS ||
      idComposed.activation.length > VARIANT_COPY_MAX_CHARS ||
      enComposed.terms.length > VARIANT_COPY_MAX_CHARS ||
      enComposed.activation.length > VARIANT_COPY_MAX_CHARS
    ) {
      setSaveError(`Teks melebihi batas ${VARIANT_COPY_MAX_CHARS} karakter.`);
      return;
    }
    setBulkSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/variant-copy/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: pid,
          variant_ids: selectedIds,
          terms: idComposed.terms,
          activation: idComposed.activation,
          terms_en: enComposed.terms,
          activation_en: enComposed.activation,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        variants?: VariantCopyEntry[];
        error?: string;
      };
      if (!res.ok || !Array.isArray(data.variants)) {
        throw new Error(data.error || `Gagal menyalin ke varian lain (${res.status})`);
      }
      onBulkSavedVariants(data.variants);
      setBulkOpen(false);
      setSelectedIds([]);
      toast.success(`Diterapkan ke ${selectedIds.length} varian`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Gagal menyalin ke varian lain";
      setSaveError(message);
      toast.error(message);
    } finally {
      setBulkSaving(false);
    }
  };

  const handleApplyProduct = () => {
    if (!dirty) return;
    const idBody = splitDescription(descriptionId).body;
    const enBody = splitDescription(descriptionEn).body;
    const idModel = stringsToModel(drafts.id);
    const enModel = stringsToModel(drafts.en);
    const nextId = composeDescription({ body: idBody, ...idModel }, "id");
    const nextEn =
      !isEmptyStrings(drafts.en) || enBody
        ? composeDescription({ body: enBody, ...enModel }, "en")
        : "";
    onApplyProductCopy({ idDescription: nextId, enDescription: nextEn });
    onClose();
  };

  const preview = useMemo(() => {
    if (mode === "product") {
      const activeStrings = drafts[lang];
      const activeBody = splitDescription(lang === "en" ? descriptionEn : descriptionId).body;
      const composed = composeDescription({ body: activeBody, ...stringsToModel(activeStrings) }, lang);
      return {
        ...mergeProductCopy(null, parseProductDescription(composed)),
        fallingBackToId: false,
      };
    }

    const idComposed = composeAdminCopy(stringsToModel(drafts.id), "id");
    const idVariantCopy =
      parseAdminVariantCopy(idComposed.terms, idComposed.activation) ??
      parseAdminVariantCopy(entry?.autoTerms, entry?.autoActivation);

    if (lang === "en") {
      const enComposed = composeAdminCopy(stringsToModel(drafts.en), "en");
      const enVariantCopy = parseAdminVariantCopy(enComposed.terms, enComposed.activation);
      const enDescParsed = parseProductDescription(descriptionEn?.trim() ? descriptionEn : descriptionId);
      if (enVariantCopy) {
        return {
          ...mergeProductCopy(enVariantCopy, enDescParsed),
          fallingBackToId: false,
        };
      }
      return {
        ...mergeProductCopy(idVariantCopy, enDescParsed),
        fallingBackToId: true,
      };
    }

    return {
      ...mergeProductCopy(idVariantCopy, parseProductDescription(descriptionId)),
      fallingBackToId: false,
    };
  }, [mode, drafts, lang, descriptionId, descriptionEn, entry]);

  const statusInfo = mode === "variant" && entry ? variantCopyStatus(entry) : null;
  const showReviewBanner =
    mode === "variant" &&
    entry &&
    (entry.adminStale || entry.reviewKind === "changed" || (entry.reviewKind === "raw" && !entry.hasOverride));
  const enIsEmpty = isEmptyStrings(drafts.en);
  const selectableCap = Math.min(otherVariants.length, BULK_COPY_MAX_VARIANTS);
  const allSelectableChecked = selectableCap > 0 && selectedIds.length >= selectableCap;

  const headerTitle =
    mode === "product"
      ? "S&K · Berlaku untuk semua varian"
      : productName?.trim() && variantTitle && productName.trim() !== variantTitle
        ? `S&K · ${productName.trim()} — ${variantTitle}`
        : `S&K · ${variantTitle ?? "Varian"}`;

  const snippets = COPY_SNIPPETS[lang];

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <SheetContent
          side="right"
          showClose={false}
          className="flex h-dvh w-full max-w-none flex-col gap-0 p-0 sm:w-[min(960px,92vw)] sm:max-w-[min(960px,92vw)]"
          onEscapeKeyDown={(event) => {
            if (!open) return;
            if (busy || dirty) {
              event.preventDefault();
              if (!busy && dirty) setConfirmDiscard(true);
            }
          }}
          onPointerDownOutside={(event) => {
            if (!open) return;
            if (busy || dirty) {
              event.preventDefault();
              if (!busy && dirty) setConfirmDiscard(true);
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            firstFieldRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocusTo?.current?.isConnected) {
              event.preventDefault();
              returnFocusTo.current.focus();
            }
          }}
        >
          <div className="shrink-0 border-b border-admin-border px-4 py-3.5 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <SheetTitle className="truncate text-base font-semibold text-admin-fg">
                  {headerTitle}
                </SheetTitle>
                {statusInfo && (
                  <Badge
                    variant={badgeVariantProp(statusInfo.variant)}
                    className={cn("shrink-0", statusBadgeClassName(statusInfo.variant))}
                  >
                    {statusInfo.label}
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <LanguageToggle
                  value={lang}
                  onChange={setLang}
                  compact
                  ariaLabel="Bahasa editor S&K"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  onClick={requestClose}
                  aria-label="Tutup panel S&K"
                  className="size-9"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <SheetDescription className="sr-only">
              {mode === "product"
                ? "Sunting S&K dan cara aktivasi umum produk untuk semua varian."
                : "Sunting S&K dan cara aktivasi khusus varian ini dalam Bahasa Indonesia dan English."}
            </SheetDescription>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            {showReviewBanner && entry && (
              <div
                role={entry.adminStale || entry.reviewKind === "changed" ? "alert" : "status"}
                className={cn(
                  "mb-4 space-y-2.5 rounded-lg border px-3.5 py-3 text-xs leading-5",
                  entry.adminStale || entry.reviewKind === "changed"
                    ? "border-admin-danger/30 bg-admin-danger/10 text-admin-danger"
                    : "border-admin-warning/30 bg-admin-warning/10 text-admin-warning",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 font-medium">
                    {entry.adminStale
                      ? `${entry.supplier ?? "Supplier"} mengubah teks. Pembeli masih melihat suntinganmu.`
                      : entry.reviewKind === "changed"
                        ? `${entry.supplier ?? "Supplier"} mengubah teks sejak terakhir ditinjau.`
                        : `Pembeli melihat teks ${entry.supplier ?? "supplier"}. Tandai oke jika sudah sesuai, atau sunting di bawah.`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {(entry.adminStale || entry.reviewKind === "changed") && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowNewText((v) => !v)}
                        aria-expanded={showNewText}
                      >
                        Lihat teks baru
                      </Button>
                    )}
                    {!dirty && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={handleAcknowledge}
                      >
                        {entry.adminStale ? "Tandai sudah ditinjau" : "Teks supplier sudah oke"}
                      </Button>
                    )}
                  </div>
                </div>

                {showNewText && (
                  <div className="space-y-1.5 rounded-md border border-admin-border bg-admin-card p-3 text-admin-fg">
                    <p className="text-[11px] font-semibold text-admin-muted">
                      Versi otomatis terbaru (tidak tampil ke pembeli)
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-5 text-admin-fg">
                      {[entry.autoTerms, entry.autoActivation].filter(Boolean).join("\n\n") || "—"}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {saveError && (
              <div
                role="alert"
                className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-danger/30 bg-admin-danger/10 px-3.5 py-2.5 text-xs text-admin-danger"
              >
                <span>{saveError}</span>
                {mode === "variant" && onReload && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      preserveDraftRef.current = true;
                      onReload();
                    }}
                  >
                    Muat ulang sumber (pertahankan draft)
                  </Button>
                )}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
              <div className="min-w-0 space-y-3.5">
                {lang === "en" && enIsEmpty && (
                  <p className="rounded-lg border border-admin-border bg-admin-subtle px-3 py-2 text-xs text-admin-muted">
                    Kosong — pembeli EN melihat versi Indonesia/otomatis
                  </p>
                )}

                <p className="text-xs text-admin-muted">
                  Satu baris = satu poin/langkah. Kelompok langkah akhiri &quot;:&quot;.
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor={`${ids}-paket`}>Detail paket</Label>
                  <Textarea
                    ref={firstFieldRef}
                    id={`${ids}-paket`}
                    rows={3}
                    disabled={busy}
                    value={currentDraft.paket}
                    onChange={(e) => updateField("paket", e.target.value)}
                    placeholder={
                      lang === "en"
                        ? "Ready-to-use private account\nActive for 30 days"
                        : "Berupa akun siap pakai\nMasa aktif 30 hari"
                    }
                    className="min-h-20 font-sans text-sm leading-5"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor={`${ids}-proses`}>Proses &amp; pengiriman</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {snippets.proses.map((chip) => (
                        <Button
                          key={chip.label}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleInsertSnippet("proses", chip.text)}
                          className="h-7 px-2 text-xs font-medium text-admin-accent"
                        >
                          {chip.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Textarea
                    ref={prosesRef}
                    id={`${ids}-proses`}
                    rows={2}
                    disabled={busy}
                    value={currentDraft.proses}
                    onChange={(e) => updateField("proses", e.target.value)}
                    placeholder={
                      lang === "en"
                        ? "Sent automatically after payment is confirmed"
                        : "Dikirim otomatis setelah pembayaran terkonfirmasi"
                    }
                    className="min-h-16 font-sans text-sm leading-5"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor={`${ids}-aturan`}>Aturan pakai</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {snippets.aturan.map((chip) => (
                        <Button
                          key={chip.label}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleInsertSnippet("aturan", chip.text)}
                          className="h-7 px-2 text-xs font-medium text-admin-accent"
                        >
                          {chip.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Textarea
                    ref={aturanRef}
                    id={`${ids}-aturan`}
                    rows={3}
                    disabled={busy}
                    value={currentDraft.aturan}
                    onChange={(e) => updateField("aturan", e.target.value)}
                    placeholder={
                      lang === "en"
                        ? "Do not change the account password\nMaximum 1 device"
                        : "Dilarang mengganti password\nMaksimal 1 perangkat"
                    }
                    className="min-h-20 font-sans text-sm leading-5"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor={`${ids}-garansi`}>Garansi</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {snippets.garansi.map((chip) => (
                        <Button
                          key={chip.label}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleInsertSnippet("garansi", chip.text)}
                          className="h-7 px-2 text-xs font-medium text-admin-accent"
                        >
                          {chip.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Textarea
                    ref={garansiRef}
                    id={`${ids}-garansi`}
                    rows={2}
                    disabled={busy}
                    value={currentDraft.garansi}
                    onChange={(e) => updateField("garansi", e.target.value)}
                    placeholder={
                      lang === "en"
                        ? "Warranty applies throughout the active period"
                        : "Garansi penuh selama masa aktif"
                    }
                    className="min-h-16 font-sans text-sm leading-5"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`${ids}-activation`}>Cara aktivasi</Label>
                  <Textarea
                    id={`${ids}-activation`}
                    rows={4}
                    disabled={busy}
                    value={currentDraft.activation}
                    onChange={(e) => updateField("activation", e.target.value)}
                    placeholder={
                      lang === "en"
                        ? "Open the application\nLog in with the sent account"
                        : "Buka aplikasi\nLogin dengan akun yang dikirim"
                    }
                    className="min-h-24 font-sans text-sm leading-5"
                  />
                </div>

                {mode === "variant" && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${ids}-notes`}>Catatan (opsional)</Label>
                    <Textarea
                      id={`${ids}-notes`}
                      rows={2}
                      disabled={busy}
                      value={currentDraft.notes}
                      onChange={(e) => updateField("notes", e.target.value)}
                      placeholder={
                        lang === "en"
                          ? "Contact admin if OTP does not arrive"
                          : "Hubungi admin bila OTP tidak masuk"
                      }
                      className="min-h-16 font-sans text-sm leading-5"
                    />
                  </div>
                )}

                {mode === "variant" && (entry?.supplierTerms || entry?.supplierActivation) && (
                  <details className="rounded-lg border border-admin-border bg-admin-subtle/50 px-3 py-2 text-xs text-admin-muted">
                    <summary className="cursor-pointer py-1 font-medium text-admin-fg">
                      Teks asli {entry.supplier ?? "supplier"} (pembanding)
                    </summary>
                    <div className="mt-2 space-y-2 border-t border-admin-border pt-2">
                      {entry.supplierTerms && (
                        <p className="whitespace-pre-wrap break-words leading-5">{entry.supplierTerms}</p>
                      )}
                      {entry.supplierActivation && (
                        <div>
                          <p className="font-semibold text-admin-fg">
                            Cara aktivasi {entry.supplier ?? "supplier"}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words leading-5">
                            {entry.supplierActivation}
                          </p>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>

              <div className="min-w-0 space-y-2 lg:sticky lg:top-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-admin-fg">Pratinjau pembeli</span>
                  <Badge variant="secondary">{lang === "en" ? "English" : "Indonesia"}</Badge>
                </div>
                <div className="admin-preview space-y-4 text-xs leading-relaxed">
                  {preview.fallingBackToId && (
                    <p className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/70"> {/* admin-ui-allow: storefront preview */}
                      English kosong — menampilkan pratinjau versi Indonesia/otomatis.
                    </p>
                  )}
                  {!preview.sections.length && !preview.activation.length && !preview.notes.length ? (
                    <p className="text-white/60">Belum ada S&amp;K atau panduan untuk ditampilkan.</p> // admin-ui-allow: storefront preview
                  ) : (
                    <>
                      {preview.sections.length > 0 && (
                        <TermsBody sections={preview.sections} size="xs" locale={lang} />
                      )}
                      {(preview.activation.length > 0 || preview.notes.length > 0) && (
                        <div className="border-t border-white/10 pt-3"> {/* admin-ui-allow: storefront preview */}
                          <ActivationBody
                            groups={preview.activation}
                            notes={preview.notes}
                            size="xs"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-admin-border bg-admin-card px-4 py-3 sm:px-6">
            {mode === "product" ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-admin-muted">
                  Diterapkan ke form — klik Simpan Produk untuk menyimpan
                </p>
                <div className="ml-auto flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={requestClose}>
                    Batal
                  </Button>
                  <Button type="button" disabled={!dirty} onClick={handleApplyProduct}>
                    Terapkan
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={busy}
                        aria-label="Aksi lainnya"
                        className="size-9"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        disabled={!hasAnyOverride || busy}
                        onSelect={handleRevertToAuto}
                      >
                        Kembali ke versi otomatis
                      </DropdownMenuItem>
                      {entry?.reviewed && (
                        <DropdownMenuItem
                          disabled={dirty || busy}
                          onSelect={handleUnacknowledge}
                        >
                          Batalkan tanda ditinjau
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {otherVariants.length > 0 && (
                    <Popover open={bulkOpen} onOpenChange={setBulkOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          className="h-9 gap-1.5"
                        >
                          Salin ke varian lain
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 p-3">
                        <div className="space-y-3">
                          <p className="text-sm font-semibold text-admin-fg">
                            Salin ke varian lain
                          </p>

                          <label className="flex cursor-pointer items-center gap-2.5 border-b border-admin-border pb-2 text-xs font-medium text-admin-fg">
                            <Checkbox
                              checked={allSelectableChecked}
                              disabled={bulkSaving}
                              onCheckedChange={(checked) => {
                                setSelectedIds(
                                  checked === true
                                    ? otherVariants.slice(0, BULK_COPY_MAX_VARIANTS).map((v) => v.id)
                                    : [],
                                );
                              }}
                            />
                            <span>
                              {otherVariants.length > BULK_COPY_MAX_VARIANTS
                                ? `Pilih ${BULK_COPY_MAX_VARIANTS} pertama (dari ${otherVariants.length})`
                                : `Pilih semua (${otherVariants.length})`}
                            </span>
                          </label>

                          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                            {otherVariants.map((v) => {
                              const checked = selectedIds.includes(v.id);
                              const atCap = !checked && selectedIds.length >= BULK_COPY_MAX_VARIANTS;
                              return (
                                <label
                                  key={v.id}
                                  className={cn(
                                    "flex items-center gap-2.5 text-xs text-admin-fg",
                                    atCap ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                                  )}
                                >
                                  <Checkbox
                                    checked={checked}
                                    disabled={bulkSaving || atCap}
                                    onCheckedChange={(next) => {
                                      setSelectedIds((prev) => {
                                        if (next === true) {
                                          if (prev.includes(v.id) || prev.length >= BULK_COPY_MAX_VARIANTS) {
                                            return prev;
                                          }
                                          return [...prev, v.id];
                                        }
                                        return prev.filter((id) => id !== v.id);
                                      });
                                    }}
                                  />
                                  <span className="min-w-0 flex-1 truncate">
                                    {v.title}
                                    {v.inactive ? " (Nonaktif)" : ""}
                                  </span>
                                </label>
                              );
                            })}
                          </div>

                          {otherVariants.length > BULK_COPY_MAX_VARIANTS && (
                            <p className="text-[11px] text-admin-muted">
                              Maksimal {BULK_COPY_MAX_VARIANTS} varian sekali salin ({selectedIds.length}/{BULK_COPY_MAX_VARIANTS} dipilih).
                            </p>
                          )}

                          <div className="flex justify-end gap-2 border-t border-admin-border pt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={bulkSaving}
                              onClick={() => setBulkOpen(false)}
                            >
                              Batal
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={selectedIds.length === 0 || selectedIds.length > BULK_COPY_MAX_VARIANTS || bulkSaving}
                              onClick={() => void handleBulkApply()}
                            >
                              {bulkSaving && <Spinner size={13} />}
                              Terapkan ({selectedIds.length})
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                <div className="ml-auto flex flex-wrap items-center gap-2.5">
                  {dirty ? (
                    <span className="text-xs font-medium text-admin-warning">
                      Belum disimpan
                    </span>
                  ) : (
                    <span className="text-xs text-admin-muted">Tersimpan langsung</span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={requestClose}
                  >
                    Batal
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || !dirty}
                    onClick={handleSaveVariant}
                  >
                    {saving && <Spinner size={14} />}
                    Simpan
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={open && confirmDiscard}
        title="Buang perubahan teks?"
        description="Perubahan teks di panel ini belum disimpan."
        confirmLabel="Buang perubahan"
        cancelLabel="Lanjut mengedit"
        onClose={() => setConfirmDiscard(false)}
        onConfirm={handleDiscardConfirm}
      />
    </>
  );
}
