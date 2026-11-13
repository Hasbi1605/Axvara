"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminPortal } from "./portal";
export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuRadioGroup = Primitive.RadioGroup;
export const DropdownMenuSub = Primitive.Sub;
const contentStyles = "z-[60] min-w-[8rem] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-md border border-admin-border bg-admin-card p-1 text-admin-fg shadow-md animate-in fade-in-0 zoom-in-95";
const itemStyles = "relative flex min-h-9 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-admin-subtle focus:text-admin-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({ className, sideOffset = 4, ...props }, ref) => {
  const container = useAdminPortal();
  return container ? <Primitive.Portal container={container}><Primitive.Content ref={ref} sideOffset={sideOffset} className={cn(contentStyles, className)} {...props} /></Primitive.Portal> : null;
});
DropdownMenuContent.displayName = "DropdownMenuContent";
export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item> & { inset?: boolean }>(({ className, inset, ...props }, ref) => <Primitive.Item ref={ref} className={cn(itemStyles, inset && "pl-8", className)} {...props} />);
DropdownMenuItem.displayName = "DropdownMenuItem";
export const DropdownMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof Primitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof Primitive.CheckboxItem>>(({ className, children, ...props }, ref) => <Primitive.CheckboxItem ref={ref} className={cn(itemStyles, "pl-8", className)} {...props}><span className="absolute left-2 flex size-4 items-center justify-center"><Primitive.ItemIndicator><Check className="size-4" /></Primitive.ItemIndicator></span>{children}</Primitive.CheckboxItem>);
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";
export const DropdownMenuRadioItem = React.forwardRef<React.ElementRef<typeof Primitive.RadioItem>, React.ComponentPropsWithoutRef<typeof Primitive.RadioItem>>(({ className, children, ...props }, ref) => <Primitive.RadioItem ref={ref} className={cn(itemStyles, "pl-8", className)} {...props}><span className="absolute left-2 flex size-4 items-center justify-center"><Primitive.ItemIndicator><Circle className="size-2 fill-current" /></Primitive.ItemIndicator></span>{children}</Primitive.RadioItem>);
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";
export const DropdownMenuLabel = React.forwardRef<React.ElementRef<typeof Primitive.Label>, React.ComponentPropsWithoutRef<typeof Primitive.Label> & { inset?: boolean }>(({ className, inset, ...props }, ref) => <Primitive.Label ref={ref} className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)} {...props} />);
DropdownMenuLabel.displayName = "DropdownMenuLabel";
export const DropdownMenuSeparator = React.forwardRef<React.ElementRef<typeof Primitive.Separator>, React.ComponentPropsWithoutRef<typeof Primitive.Separator>>(({ className, ...props }, ref) => <Primitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-admin-border", className)} {...props} />);
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
export const DropdownMenuSubTrigger = React.forwardRef<React.ElementRef<typeof Primitive.SubTrigger>, React.ComponentPropsWithoutRef<typeof Primitive.SubTrigger> & { inset?: boolean }>(({ className, inset, children, ...props }, ref) => <Primitive.SubTrigger ref={ref} className={cn(itemStyles, inset && "pl-8", className)} {...props}>{children}<ChevronRight className="ml-auto size-4" /></Primitive.SubTrigger>);
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";
export const DropdownMenuSubContent = React.forwardRef<React.ElementRef<typeof Primitive.SubContent>, React.ComponentPropsWithoutRef<typeof Primitive.SubContent>>(({ className, ...props }, ref) => {
  const container = useAdminPortal();
  return container ? <Primitive.Portal container={container}><Primitive.SubContent ref={ref} className={cn(contentStyles, className)} {...props} /></Primitive.Portal> : null;
});
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";
export function DropdownMenuShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) { return <span className={cn("ml-auto text-xs tracking-widest text-admin-muted", className)} {...props} />; }
