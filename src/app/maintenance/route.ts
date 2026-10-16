import { maintenanceResponse } from "@/lib/maintenance-page";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Standalone preview/fallback: no layouts, hydration, API calls or D1 required.
export function GET() { return maintenanceResponse(); }
export function HEAD() { return maintenanceResponse(Date.now(), false, undefined, true); }
