// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";

const conversion = vi.hoisted(() => ({ cover: vi.fn(), full: vi.fn() }));
vi.mock("@/components/admin/ImageDropzone", () => ({
  toWebp16x9: conversion.cover,
  toWebpOriginalRatio: conversion.full,
}));
import { useProductManager } from "@/components/admin/useProductManager";

const toast = { success: vi.fn(), error: vi.fn() };
const file = (name: string) => new File(["image"], name, { type: "image/png" });
const event = (...files: File[]) => ({ target: { files, value: "selected" } }) as unknown as ChangeEvent<HTMLInputElement>;

beforeEach(() => {
  vi.clearAllMocks();
  conversion.cover.mockImplementation(async (input: File) => new File(["cover"], input.name + ".webp", { type: "image/webp" }));
  conversion.full.mockImplementation(async (input: File) => new File(["full"], input.name + ".webp", { type: "image/webp" }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("upload sekaligus hanya crop foto pertama dan mempertahankan urutan screenshot", async () => {
  const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
    const data = init.body as FormData;
    expect(data.getAll("files").map((item) => (item as File).name)).toEqual(["cover.png.webp", "portrait.png.webp", "wide.png.webp"]);
    return { ok: true, json: async () => ({ urls: ["/cover", "/portrait", "/wide"] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useProductManager(toast, vi.fn()));
  const files = [file("cover.png"), file("portrait.png"), file("wide.png")];
  await act(async () => { await result.current.handleUpload(event(...files)); });
  expect(conversion.cover.mock.calls.map(([input]) => input)).toEqual([files[0]]);
  expect(conversion.full.mock.calls.map(([input]) => input)).toEqual(files.slice(1));
  expect(result.current.formImages).toEqual(["/cover", "/portrait", "/wide"]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("menambah foto setelah cover existing mempertahankan semua rasio asli", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ urls: ["/portrait", "/wide"] }) })));
  const { result } = renderHook(() => useProductManager(toast, vi.fn()));
  act(() => result.current.setFormImages(["/existing-cover"]));
  await act(async () => { await result.current.handleUpload(event(file("portrait.png"), file("wide.png"))); });
  expect(conversion.cover).not.toHaveBeenCalled();
  expect(conversion.full).toHaveBeenCalledTimes(2);
  expect(result.current.formImages).toEqual(["/existing-cover", "/portrait", "/wide"]);
});

it("konversi gagal mempertahankan galeri dan melepas status uploading untuk retry", async () => {
  conversion.full.mockRejectedValueOnce(new Error("Konversi WebP gagal"));
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useProductManager(toast, vi.fn()));
  act(() => result.current.setFormImages(["/existing-cover"]));
  const input = event(file("broken.png"));
  await act(async () => { await result.current.handleUpload(input); });
  expect(result.current.formImages).toEqual(["/existing-cover"]);
  expect(result.current.uploading).toBe(false);
  expect(input.target.value).toBe("");
  expect(toast.error).toHaveBeenCalledWith("Konversi WebP gagal");
  expect(fetchMock).not.toHaveBeenCalled();
});
