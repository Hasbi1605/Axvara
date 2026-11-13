"use client";
import { ChevronDown } from "lucide-react";
import { IosIcon, type IosIconName } from "./AdminIcon";
import type { AdminSection } from "./AdminShell";
import { Button, Badge, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Tooltip, TooltipTrigger, TooltipContent } from "./ui";
export type SupplierSectionId = "warung" | "sekalipay" | "tunvn" | "pairs" | "links";
export const SUPPLIER_ITEMS: { id: SupplierSectionId; label: string; icon: IosIconName }[] = [
  { id: "warung", label: "Warung Rebahan", icon: "shopping-bag" }, { id: "sekalipay", label: "Sekalipay", icon: "wallet" }, { id: "tunvn", label: "TUNVN", icon: "send" }, { id: "pairs", label: "WR vs SK", icon: "discount" }, { id: "links", label: "Link Supplier", icon: "link" },
];
export function SupplierDropdown({ section, collapsed, onSection, badges = {} }: { section: AdminSection; collapsed: boolean; onSection: (section: AdminSection) => void; badges?: Partial<Record<AdminSection, number>> }) {
  const activeItem = SUPPLIER_ITEMS.find(item => item.id === section);
  const total = SUPPLIER_ITEMS.reduce((sum, item) => sum + (badges[item.id] ?? 0), 0);
  return <Tooltip><DropdownMenu>
    <TooltipTrigger asChild><DropdownMenuTrigger asChild>
      <Button variant="ghost" aria-label="Supplier" className={`h-auto min-h-10 w-full justify-start gap-3 px-3 ${activeItem ? "bg-admin-subtle text-admin-fg" : "text-admin-muted"}`}>
        <IosIcon name="box" size={16} />
        <span className={`min-w-0 flex-1 text-left ${collapsed ? "lg:hidden" : ""}`}>Supplier{activeItem && <span className="block truncate text-xs text-admin-muted">{activeItem.label}</span>}</span>
        {total > 0 && <Badge variant="warning" className={collapsed ? "lg:hidden" : ""}>{total > 99 ? "99+" : total}</Badge>}
        <ChevronDown className={collapsed ? "lg:hidden" : ""} />
      </Button>
    </DropdownMenuTrigger></TooltipTrigger>
    <DropdownMenuContent side={collapsed ? "right" : "bottom"} align="start" aria-label="Panel supplier" className="w-56">
      {SUPPLIER_ITEMS.map(item => <DropdownMenuItem key={item.id} aria-current={section === item.id ? "page" : undefined} onSelect={() => onSection(item.id)}><IosIcon name={item.icon} size={16} /><span className="flex-1">{item.label}</span>{(badges[item.id] ?? 0) > 0 && <Badge variant="warning">{badges[item.id]}</Badge>}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>{collapsed && <TooltipContent side="right">Supplier</TooltipContent>}</Tooltip>;
}
