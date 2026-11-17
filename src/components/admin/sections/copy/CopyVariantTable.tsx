"use client";

import { useMemo } from "react";
import { Check, Minus } from "lucide-react";
import {
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/admin/ui";
import type { FormVariant } from "@/components/admin/product-types";
import type { Locale } from "@/lib/i18n/locale";
import type { VariantCopyEntry } from "@/lib/product-copy/format";
import { variantCopyTitle } from "@/lib/product-copy/editor-model";
import { cn } from "@/lib/utils";
import {
  badgeVariantProp,
  hasVariantEnglishCopy,
  statusBadgeClassName,
  variantCopyStatus,
} from "./status";

export function CopyVariantTable({
  variants,
  hasMultiVariants,
  productName,
  entries,
  loading,
  loadingVariants,
  error,
  lang,
  productCopySummary,
  productHasEn,
  onEditProductCopy,
  onEditVariant,
  onReload,
}: {
  variants: FormVariant[];
  hasMultiVariants: boolean;
  productName?: string | null;
  entries: Map<number, VariantCopyEntry>;
  loading: boolean;
  loadingVariants: boolean;
  error: string | null;
  lang: Locale;
  productCopySummary: string;
  productHasEn: boolean;
  onEditProductCopy: (trigger: HTMLElement | null) => void;
  onEditVariant: (variant: FormVariant, title: string, trigger: HTMLElement | null) => void;
  onReload?: () => void;
}) {
  const sortedVariants = useMemo(() => {
    const active: { variant: FormVariant; index: number }[] = [];
    const inactive: { variant: FormVariant; index: number }[] = [];
    variants.forEach((variant, index) => {
      if (Number(variant.is_active ?? 1) === 0) inactive.push({ variant, index });
      else active.push({ variant, index });
    });
    return [...active, ...inactive];
  }, [variants]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-admin-border bg-admin-subtle/40 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-admin-fg">Berlaku untuk semua varian</span>
            {lang === "en" && (
              <Badge variant={productHasEn ? "success" : "secondary"} className="px-2 py-0 text-[11px]">
                {productHasEn ? "EN terisi" : "EN kosong"}
              </Badge>
            )}
          </div>
          <p className="text-xs text-admin-muted">
            {productCopySummary || "Belum diisi"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Edit S&K berlaku untuk semua varian"
          onClick={(e) => onEditProductCopy(e.currentTarget)}
        >
          Edit
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-danger/30 bg-admin-danger/10 px-3 py-2.5 text-xs text-admin-danger"
        >
          <span>{error}</span>
          {onReload && (
            <Button type="button" variant="outline" size="sm" onClick={onReload}>
              Coba lagi
            </Button>
          )}
        </div>
      )}

      {loadingVariants ? (
        <div className="space-y-2" aria-label="Memuat varian">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : variants.length === 0 ? (
        <p className="rounded-lg border border-admin-border bg-admin-subtle/40 px-4 py-3 text-xs text-admin-muted">
          Belum ada varian — tambah di tab Varian lalu Simpan Produk.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-admin-border bg-admin-card">
          <Table>
            <TableHeader className="hidden sm:table-header-group">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 px-4 first:pl-4">Varian</TableHead>
                <TableHead className="h-9 px-4">Status</TableHead>
                <TableHead className="h-9 w-16 px-3 text-center">EN</TableHead>
                <TableHead className="h-9 w-24 px-4 text-right last:pr-4">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedVariants.map(({ variant, index }) => {
                const variantId = typeof variant.id === "number" ? variant.id : undefined;
                const entry = variantId ? entries.get(variantId) : undefined;
                const inactive = Number(variant.is_active ?? 1) === 0;
                const baseTitle = variantCopyTitle(variant);
                const title = hasMultiVariants ? baseTitle : productName?.trim() || baseTitle;
                const statusInfo = entry ? variantCopyStatus(entry) : null;
                const hasEn = hasVariantEnglishCopy(entry);

                return (
                  <TableRow
                    key={variantId ?? `new-${index}`}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5 sm:table-row sm:p-0",
                      inactive && "bg-admin-subtle/30 text-admin-muted",
                    )}
                  >
                    <TableCell className="min-w-0 flex-1 basis-[calc(100%-5.5rem)] p-0 font-medium sm:basis-auto sm:px-4 sm:py-2.5 sm:first:pl-4">
                      <div className={cn("flex min-w-0 flex-wrap items-center gap-2", inactive && "opacity-70")}>
                        <span className="truncate text-sm text-admin-fg" title={title}>
                          {title}
                        </span>
                        {inactive && (
                          <Badge variant="secondary" className="px-2 py-0 text-[11px]">
                            Nonaktif
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="order-3 min-w-0 p-0 sm:order-none sm:px-4 sm:py-2.5">
                      {!variantId ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring rounded-md">
                              <Badge variant="secondary">Belum disimpan</Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Simpan produk terlebih dahulu agar varian ini bisa disunting S&amp;K-nya.
                          </TooltipContent>
                        </Tooltip>
                      ) : loading && !entry ? (
                        <Skeleton className="h-5 w-24" />
                      ) : statusInfo ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              tabIndex={0}
                              className="inline-flex cursor-help rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring"
                            >
                              <Badge
                                variant={badgeVariantProp(statusInfo.variant)}
                                className={cn("whitespace-nowrap", statusBadgeClassName(statusInfo.variant))}
                              >
                                {statusInfo.label}
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{statusInfo.tooltip}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Badge variant="secondary">Kosong</Badge>
                      )}
                    </TableCell>

                    <TableCell className="order-4 p-0 sm:order-none sm:px-3 sm:py-2.5 sm:text-center">
                      {variantId ? (
                        <span
                          aria-label={hasEn ? "Versi English tersedia" : "Versi English kosong"}
                          title={hasEn ? "Versi English tersedia" : "Versi English kosong"}
                          className="inline-flex items-center justify-center gap-1 text-xs"
                        >
                          <span className="text-admin-muted sm:hidden">EN</span>
                          {hasEn ? (
                            <Check aria-hidden className="size-4 text-admin-success" />
                          ) : (
                            <Minus aria-hidden className="size-4 text-admin-muted" />
                          )}
                        </span>
                      ) : (
                        <span aria-label="Versi English kosong" className="text-xs text-admin-muted">
                          <Minus aria-hidden className="inline size-4" />
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="order-2 shrink-0 p-0 text-right sm:order-none sm:px-4 sm:py-2.5 sm:last:pr-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!variantId || (loading && !entry)}
                        aria-label={`Edit S&K ${title}`}
                        onClick={(e) => onEditVariant(variant, title, e.currentTarget)}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
