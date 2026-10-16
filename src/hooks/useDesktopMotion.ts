"use client";

import { useEffect, useState } from "react";

/** Shared eligibility for the decorative cursor and scroll rope. */
export function useDesktopMotion() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const pointer = window.matchMedia("(pointer: fine)");
    const hover = window.matchMedia("(hover: hover)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const queries = [desktop, pointer, hover, reduced];
    const update = () => setEnabled(desktop.matches && pointer.matches && hover.matches && !reduced.matches);

    update();
    queries.forEach((query) => query.addEventListener("change", update));
    return () => queries.forEach((query) => query.removeEventListener("change", update));
  }, []);

  return enabled;
}
