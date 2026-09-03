"use client";

import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { toWebp16x9 } from "@/components/admin/ImageDropzone";

function legacyJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.type === "doc" ? parsed : null;
  } catch {
    return null;
  }
}

export function ArticleEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const initialJson = legacyJson(value);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, protocols: ["https"] },
        heading: { levels: [2, 3] },
      }),
      Image.configure({ allowBase64: false }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: initialJson ?? value,
    ...(initialJson ? {} : { contentType: "markdown" as const }),
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getMarkdown();
    if (current.trim() === value.trim()) return;
    const json = legacyJson(value);
    if (json) editor.commands.setContent(json);
    else editor.commands.setContent(value, { contentType: "markdown" });
  }, [editor, value]);

  async function uploadInline(file?: File) {
    if (!file || !editor) return;
    setUploading(true);
    try {
      const webp = await toWebp16x9(file);
      const form = new FormData();
      form.append("files", webp);
      form.append("area", "articles/content");
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Upload gambar gagal");
      editor.chain().focus().setImage({ src: body.urls[0], alt: file.name }).run();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Upload gambar gagal");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (!editor) return null;

  const action = (run: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    run();
  };
  const button = (label: string, run: () => void, active = false) => (
    <button
      type="button"
      onMouseDown={action(run)}
      className={`h-8 rounded px-2 text-xs ${active ? "bg-[#00E5FF] text-[#070a1e]" : "bg-white/10 text-white/80"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="flex flex-wrap gap-1 border-b border-white/10 p-2">
        {button("H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        {button("H3", () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
        {button("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {button("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {button("•", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {button("1.", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {button("❝", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {button("Link", () => {
          const href = window.prompt("URL https://");
          if (href?.startsWith("https://")) editor.chain().focus().setLink({ href }).run();
        }, editor.isActive("link"))}
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="h-8 rounded bg-white/10 px-2 text-xs text-white/80 disabled:opacity-50"
        >
          {uploading ? "Upload…" : "Gambar"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => void uploadInline(event.target.files?.[0])}
        />
        {button("↶", () => editor.chain().focus().undo().run())}
        {button("↷", () => editor.chain().focus().redo().run())}
      </div>
      <EditorContent
        editor={editor}
        className="min-h-[280px] p-3 text-sm text-white prose prose-invert max-w-none focus-within:outline-none [&_.ProseMirror]:min-h-[255px] [&_.ProseMirror]:outline-none [&_.ProseMirror_img]:my-4 [&_.ProseMirror_img]:rounded-xl"
      />
    </div>
  );
}
