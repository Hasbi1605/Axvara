"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring focus-visible:ring-offset-2 focus-visible:ring-offset-admin-bg disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", {
  variants: {
    variant: {
      default: "bg-admin-primary text-admin-inverse hover:bg-admin-primary/90",
      secondary: "bg-admin-subtle text-admin-fg hover:bg-admin-subtle/80",
      outline: "border border-admin-input bg-admin-card hover:bg-admin-subtle hover:text-admin-fg",
      ghost: "hover:bg-admin-subtle hover:text-admin-fg",
      destructive: "bg-admin-danger text-admin-inverse hover:bg-admin-danger/90",
      link: "text-admin-accent underline-offset-4 hover:underline",
    },
    size: { default: "h-9 px-4 py-2", sm: "h-9 rounded-md px-3", lg: "h-11 rounded-md px-8", icon: "size-9" },
  }, defaultVariants: { variant: "default", size: "default" },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type = "button", ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});
Button.displayName = "Button";
