import { useState, type ReactNode } from "react";
import { render as renderReact, type RenderOptions } from "@testing-library/react";
import { AdminPortalContext } from "@/components/admin/ui/portal";
import { TooltipProvider } from "@/components/admin/ui/tooltip";

// Unit fixtures supply the same themed portal boundary as the route layout.
function AdminFixture({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return <div ref={setHost} className="admin-theme" data-admin-theme="light"><AdminPortalContext.Provider value={host}><TooltipProvider>{children}</TooltipProvider></AdminPortalContext.Provider></div>;
}
export function render(ui: ReactNode, options?: RenderOptions) { return renderReact(ui, { wrapper: AdminFixture, ...options }); }
