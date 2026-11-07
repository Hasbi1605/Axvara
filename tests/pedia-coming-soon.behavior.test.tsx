// @vitest-environment jsdom
// Halaman "segera hadir" Pedia (PEDIA_ENABLED!=true) mengikuti axv_locale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cookieState = vi.hoisted(() => ({ value: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ toString: () => cookieState.value }),
  headers: async () => new Map([["host", "localhost:3000"]]),
}));

import PediaHome from "@/app/pedia/page";

beforeEach(() => { cookieState.value = ""; vi.stubEnv("PEDIA_ENABLED", ""); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("Pedia coming soon", () => {
  it("default Indonesia", async () => {
    render(await PediaHome());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Axvara Pedia segera hadir");
    expect(document.body.textContent).toContain("Katalog layanan followers, likes, dan views belum tersedia.");
    expect(screen.getByRole("link", { name: "Kembali ke axvara.tech" }).getAttribute("href")).toContain("utm_source=pedia");
  });

  it("English saat cookie axv_locale=en", async () => {
    cookieState.value = "axv_locale=en";
    render(await PediaHome());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Axvara Pedia is coming soon");
    expect(document.body.textContent).toContain("The catalog of followers, likes, and views services is not available yet.");
    expect(screen.getByRole("link", { name: "Back to axvara.tech" })).toBeTruthy();
  });
});
