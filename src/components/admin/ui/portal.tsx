"use client";

import { createContext, useContext } from "react";

// All overlays share the themed root, outside transformed/scrolling modal bodies.
export const AdminPortalContext = createContext<HTMLElement | null>(null);
export const useAdminPortal = () => useContext(AdminPortalContext);
