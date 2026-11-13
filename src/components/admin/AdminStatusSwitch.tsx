"use client";
import { Switch } from "./ui/switch";
export function AdminStatusSwitch({ checked, label, disabled, busy, describedBy, onChange }: {
  checked: boolean; label: string; disabled?: boolean; busy?: boolean; describedBy?: string; onChange: () => void;
}) {
  return <Switch checked={checked} aria-label={label} aria-busy={busy} aria-describedby={describedBy} disabled={disabled || busy} onCheckedChange={onChange} title={checked ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"} />;
}
