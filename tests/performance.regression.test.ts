import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Performance regression guards", () => {
  it("mengizinkan webpack eval hanya saat development agar hydration lokal berjalan", () => {
    vi.stubEnv("NODE_ENV", "development");
    const devResponse = middleware(new NextRequest("http://127.0.0.1:3000/"));
    expect(devResponse.headers.get("content-security-policy")).toContain("'unsafe-eval'");

    vi.stubEnv("NODE_ENV", "production");
    const prodResponse = middleware(new NextRequest("https://axvara.pages.dev/"));
    expect(prodResponse.headers.get("content-security-policy")).not.toContain("'unsafe-eval'");
  });

  it("tidak lagi mengizinkan koneksi runtime ke Iconify", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = middleware(new NextRequest("https://axvara.pages.dev/"));
    expect(response.headers.get("content-security-policy")).not.toContain("api.iconify.design");
  });
});
