"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Input, Label, NativeSelect } from "@/components/admin/ui";
import {
  CUSTOM_FIELD_TEMPLATES,
  slugifyCustomFieldKey,
  type CustomBuyerFieldDef,
  type CustomBuyerFieldsConfig,
  type CustomBuyerFieldType,
} from "@/lib/buyer-fields";

const FIELD_TYPE_LABELS: { value: CustomBuyerFieldType; label: string }[] = [
  { value: "text", label: "Teks singkat" },
  { value: "email", label: "Email" },
  { value: "password", label: "Password / rahasia" },
  { value: "textarea", label: "Catatan panjang" },
];

export function defaultCustomBuyerFieldsConfig(): CustomBuyerFieldsConfig {
  return {
    title: "Data Tambahan",
    note: "",
    fields: [{ key: "kolom_1", label: "", type: "text", placeholder: "", required: true }],
  };
}

function uniqueKeyFor(label: string, idx: number, fields: CustomBuyerFieldDef[]): string {
  const base = slugifyCustomFieldKey(label, idx + 1);
  const used = new Set(fields.filter((_, i) => i !== idx).map((f) => f.key));
  if (!used.has(base)) return base;
  for (let n = 2; n <= 20; n++) {
    const candidate = `${base.slice(0, 36)}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `kolom_${idx + 1}_${Date.now() % 1000}`;
}

export function CustomBuyerFieldsEditor({
  value,
  disabled,
  onChange,
}: {
  value: CustomBuyerFieldsConfig | null | undefined;
  disabled?: boolean;
  onChange: (next: CustomBuyerFieldsConfig) => void;
}) {
  const config: CustomBuyerFieldsConfig = value?.fields?.length
    ? value
    : defaultCustomBuyerFieldsConfig();

  const updateField = (idx: number, patch: Partial<CustomBuyerFieldDef>) => {
    const fields = config.fields.map((f, i) => {
      if (i !== idx) return f;
      const merged = { ...f, ...patch };
      if (patch.label !== undefined && (!f.key || /^kolom_\d+/.test(f.key) || f.key === slugifyCustomFieldKey(f.label, idx + 1))) {
        merged.key = uniqueKeyFor(patch.label, idx, config.fields);
      }
      return merged;
    });
    onChange({ ...config, fields });
  };

  const addField = () => {
    if (config.fields.length >= 6) return;
    const idx = config.fields.length;
    onChange({
      ...config,
      fields: [
        ...config.fields,
        { key: uniqueKeyFor("", idx, config.fields), label: "", type: "text", placeholder: "", required: true },
      ],
    });
  };

  const removeField = (idx: number) => {
    if (config.fields.length <= 1) return;
    onChange({ ...config, fields: config.fields.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-3 rounded-lg border border-admin-border bg-admin-subtle/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-admin-fg">Pengaturan kolom khusus checkout</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-admin-muted">Template:</span>
          {CUSTOM_FIELD_TEMPLATES.map((tpl) => (
            <Button
              key={tpl.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onChange({ ...tpl.config, fields: tpl.config.fields.map((f) => ({ ...f })) })}
              className="h-6 px-2 text-[11px] font-medium"
            >
              {tpl.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <Label className="block space-y-1 text-xs font-medium">
          Judul bagian
          <Input
            disabled={disabled}
            value={config.title ?? ""}
            onChange={(e) => onChange({ ...config, title: e.target.value })}
            placeholder="Contoh: Data Akun untuk Aktivasi"
            maxLength={80}
            className="h-8 text-xs"
          />
        </Label>
        <Label className="block space-y-1 text-xs font-medium">
          Catatan singkat (opsional)
          <Input
            disabled={disabled}
            value={config.note ?? ""}
            onChange={(e) => onChange({ ...config, note: e.target.value })}
            placeholder="1 baris arahan di bawah judul"
            maxLength={160}
            className="h-8 text-xs"
          />
        </Label>
      </div>

      <div className="space-y-2">
        {config.fields.map((field, idx) => (
          <div key={idx} className="grid gap-2 rounded-md border border-admin-border/80 bg-admin-card p-2.5 sm:grid-cols-[minmax(0,1.2fr)_140px_minmax(0,1fr)_auto] sm:items-end">
            <Label className="block space-y-1 text-[11px] font-medium">
              Label kolom *
              <Input
                disabled={disabled}
                value={field.label}
                onChange={(e) => updateField(idx, { label: e.target.value })}
                placeholder="Contoh: Email Gmail"
                maxLength={60}
                className="h-8 text-xs"
              />
            </Label>
            <Label className="block space-y-1 text-[11px] font-medium">
              Tipe input
              <NativeSelect
                disabled={disabled}
                value={field.type}
                onChange={(e) => updateField(idx, { type: e.target.value as CustomBuyerFieldType })}
                className="h-8 text-xs"
              >
                {FIELD_TYPE_LABELS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </NativeSelect>
            </Label>
            <Label className="block space-y-1 text-[11px] font-medium">
              Placeholder (opsional)
              <Input
                disabled={disabled}
                value={field.placeholder ?? ""}
                onChange={(e) => updateField(idx, { placeholder: e.target.value })}
                placeholder={field.type === "email" ? "nama@gmail.com" : "Isi contoh singkat"}
                maxLength={80}
                className="h-8 text-xs"
              />
            </Label>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-admin-muted">
                <Checkbox
                  disabled={disabled}
                  checked={field.required !== false}
                  onCheckedChange={(checked) => updateField(idx, { required: checked === true })}
                />
                Wajib
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || config.fields.length <= 1}
                onClick={() => removeField(idx)}
                aria-label={`Hapus kolom ${idx + 1}`}
                className="h-7 w-7 text-admin-muted hover:text-admin-danger"
              >
                <Trash2 size={13} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {config.fields.length < 6 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={addField}
          className="h-7 gap-1 text-xs"
        >
          <Plus size={12} /> Tambah kolom ({config.fields.length}/6)
        </Button>
      )}
    </div>
  );
}
