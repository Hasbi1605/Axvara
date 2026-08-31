import { cn } from "@/lib/utils";
import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "glass" | "ghost";
  size?: "sm" | "md" | "lg";
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" && "h-9 px-4 text-sm",
        size === "md" && "h-11 px-6 text-sm",
        size === "lg" && "h-[52px] px-8 text-[15px] rounded-2xl",
        variant === "primary" &&
          "bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8] shadow-[0_0_24px_rgba(0,229,255,0.35)] hover:shadow-[0_0_32px_rgba(0,229,255,0.45)]",
        variant === "glass" &&
          "ax-glass text-white hover:bg-white/10 border-white/15",
        variant === "ghost" &&
          "text-white/70 hover:text-white hover:bg-white/10",
        className
      )}
      {...props}
    />
  );
}
