"use client";

import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { toWebp16x9 } from "@/components/admin/ImageDropzone";
import { useToast } from "@/components/ui/Toast";
import { Bold, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Loader2, Quote, Redo2, Undo2, type LucideIcon } from "lucide-react";
import { Button, Separator, Tooltip, TooltipContent, TooltipTrigger } from "./ui";

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
  const toast = useToast();
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
      toast.error(error instanceof Error ? error.message : "Upload gambar gagal");
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
  const button = (label: string, Icon: LucideIcon, run: () => void, active = false) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          onMouseDown={action(run)}
          className={`size-8 ${active ? "bg-admin-subtle text-admin-fg" : "text-admin-muted"}`}
        >
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="overflow-hidden rounded-md border border-admin-input">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-admin-border bg-admin-subtle/50 p-1.5" role="toolbar" aria-label="Format artikel">
        {button("Judul 2", Heading2, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        {button("Judul 3", Heading3, () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
        <Separator orientation="vertical" className="mx-1 h-5" />
        {button("Tebal", Bold, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {button("Miring", Italic, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {button("Daftar poin", List, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {button("Daftar bernomor", ListOrdered, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {button("Kutipan", Quote, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {button("Link", Link2, () => {
          const href = window.prompt("URL https://");
          if (href?.startsWith("https://")) editor.chain().focus().setLink({ href }).run();
        }, editor.isActive("link"))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="h-8 text-admin-muted"
        >
          {uploading ? <><Loader2 className="animate-spin" aria-hidden="true" /> Upload…</> : <><ImagePlus aria-hidden="true" /> Gambar</>}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => void uploadInline(event.target.files?.[0])}
        />
        <Separator orientation="vertical" className="mx-1 h-5" />
        {button("Urungkan", Undo2, () => editor.chain().focus().undo().run())}
        {button("Ulangi", Redo2, () => editor.chain().focus().redo().run())}
      </div>
      <EditorContent
        editor={editor}
        className="min-h-[280px] bg-admin-card p-3 text-sm leading-6 text-admin-fg focus-within:outline-none [&_.ProseMirror]:min-h-[255px] [&_.ProseMirror]:outline-none [&_.ProseMirror_a]:text-admin-accent [&_.ProseMirror_a]:underline [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-admin-muted [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_img]:my-4 [&_.ProseMirror_img]:rounded-md [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_p]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5"
      />
    </div>
  );
}
