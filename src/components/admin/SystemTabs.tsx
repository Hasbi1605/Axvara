"use client";
import type { AdminSection } from "./AdminShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { PageHeader } from "./ui/page-header";
export const SYSTEM_TABS: [AdminSection, string][] = [["settings", "Identitas Toko"], ["agent", "Integrasi Agent"], ["subscribers", "Subscriber Email"]];
export function SystemTabs({ section, onSection, children }: { section: AdminSection; onSection: (section: AdminSection) => void; children: React.ReactNode }) {
  return <section className="mt-4 space-y-6">
    <PageHeader title="Pengaturan Toko" description="Kelola identitas toko, integrasi agent, dan pelanggan email." />
    <Tabs value={section} onValueChange={value => onSection(value as AdminSection)}><TabsList aria-label="Bagian sistem">{SYSTEM_TABS.map(([id, label]) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}</TabsList>{SYSTEM_TABS.map(([id]) => <TabsContent className="mt-6 [&>*:first-child]:mt-0" key={id} value={id}>{section === id ? children : null}</TabsContent>)}</Tabs>
  </section>;
}
