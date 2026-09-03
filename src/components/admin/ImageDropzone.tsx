"use client";

import { useRef, useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";

type Props = {
  area: "products" | "articles/covers" | "banners" | "qris";
  value?: string;
  onUploaded: (url: string) => void;
  onRemove?: () => void;
};

const MAX_BYTES = 5 * 1024 * 1024;

function validateImage(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > MAX_BYTES) {
    throw new Error("Pilih PNG/JPG/WebP maksimal 5 MB");
  }
}

async function canvasToWebp(canvas: HTMLCanvasElement, file: File) {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Konversi WebP gagal"))),
      "image/webp",
      0.84,
    ),
  );
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp" });
}

export async function toWebp16x9(file: File) {
  validateImage(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser tidak mendukung konversi gambar");

    context.fillStyle = "#080C1E";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return await canvasToWebp(canvas, file);
  } finally {
    bitmap.close();
  }
}

export async function toWebpOriginalRatio(file: File) {
  validateImage(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    // Banner keeps its original shape. Only the longest edge is reduced so a
    // portrait poster, square promo, or landscape graphic remains fully visible.
    const maxEdge = 1920;
    const scale = Math.min(1, maxEdge / bitmap.width, maxEdge / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser tidak mendukung konversi gambar");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasToWebp(canvas, file);
  } finally {
    bitmap.close();
  }
}

export function ImageDropzone({ area, value, onUploaded, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const preserveRatio = area === "banners" || area === "qris";

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const result = preserveRatio ? await toWebpOriginalRatio(file) : await toWebp16x9(file);
      const formData = new FormData();
      formData.append("files", result);
      formData.append("area", area);
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Upload gagal");
      onUploaded(body.urls[0]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Upload gagal");
    } finally {
      setBusy(false);
      setDragActive(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        void upload(event.dataTransfer.files[0]);
      }}
      className={`rounded-xl border-2 border-dashed p-3 text-center transition ${
        dragActive ? "border-[#00E5FF]/60 bg-[#00E5FF]/5" : "border-white/15"
      }`}
      aria-busy={busy}
    >
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      {value ? (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Preview"
            className={
              preserveRatio
                ? "max-h-[320px] w-full rounded-lg bg-black/20 object-contain"
                : "aspect-video w-full rounded-lg object-cover"
            }
          />
          <div className="mt-2 flex justify-center gap-3">
            <button type="button" className="inline-flex items-center gap-1 text-xs text-[#00E5FF]" onClick={() => input.current?.click()}>
              <IosIcon name="edit" size={12} tint="#00E5FF" /> Ganti
            </button>
            <button type="button" className="inline-flex items-center gap-1 text-xs text-red-300" onClick={onRemove}>
              <IosIcon name="trash" size={12} tint="white" /> Hapus
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="min-h-36 w-full text-sm text-white/55 disabled:opacity-50">
          {busy ? (
            "Mengonversi & upload…"
          ) : (
            <span className="inline-flex flex-col items-center gap-1">
              <IosIcon name="upload" size={22} tint="white" />
              <span>Tarik gambar atau klik · PNG/JPG/WebP</span>
              <span className="text-[11px] text-white/35">
                {preserveRatio ? "Rasio asli dipertahankan · maks. 1920 px" : "Otomatis WebP 1600×900"}
              </span>
            </span>
          )}
        </button>
      )}
    </div>
  );
}
