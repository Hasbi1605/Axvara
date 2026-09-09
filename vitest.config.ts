import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Default tetap `node`: 46 file test backend tidak butuh DOM dan jsdom
    // memperlambat start. File komponen memilih environment sendiri lewat
    // docblock `// @vitest-environment jsdom` di baris pertama.
    environment: "node",
    globals: true,
    // jsdom default berjalan di `about:blank` (origin opaque) sehingga
    // localStorage TIDAK tersedia — middleware persist Zustand langsung
    // melempar `Cannot read properties of undefined (reading 'setItem')`.
    // Origin nyata membuat storage aktif.
    environmentOptions: {
      jsdom: { url: "http://localhost:3000" },
    },
    // `.tsx` sebelumnya TIDAK termasuk, sehingga test komponen apa pun akan
    // diam-diam tidak pernah dijalankan.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup/jsdom-storage.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // tsconfig.json memakai `jsx: "preserve"` (wajib untuk Next), sehingga
  // transformer oxc bawaan Vitest 4 akan meneruskan JSX apa adanya dan
  // import-analysis gagal. Runtime `automatic` mentransform JSX tanpa
  // memerlukan `import React` di file test.
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
