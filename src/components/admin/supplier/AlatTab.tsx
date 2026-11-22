import { Plus, Trash2, Zap } from "lucide-react";
import { Spinner } from "@/components/ui/Loading";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TabsContent } from "../ui";
import { useSupplierPanelContext } from "./panel-context";

export function AlatTab() {
  const {
    supplier, locked, syncDisabled, isWrSk, runWrSkSync, mutateStandard, busy, configured, name,
    config, exclusions, setExclusionToDelete, newPattern, setNewPattern, addExclusion, sandboxProduct,
    setSandboxProduct, sandboxVariant, setSandboxVariant, runSandbox, sandboxResult,
  } = useSupplierPanelContext();
  return <TabsContent value="alat" className="mt-4 space-y-4">
    <Card>
      <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Sinkron katalog</CardTitle></CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <p className="text-sm leading-5 text-admin-muted">
          {supplier === "warung"
            ? "Perbarui katalog dan harga jual. Produk baru aktif otomatis."
            : supplier === "sekalipay"
              ? "Perbarui katalog Aplikasi Premium dan harga jual. Varian AUTO baru aktif otomatis."
              : "Perbarui katalog dan harga jual. Produk dan varian baru tetap nonaktif."}
        </p>
        <Button className="min-h-11 md:min-h-0" disabled={locked || syncDisabled}
          onClick={() => isWrSk ? void runWrSkSync() : void mutateStandard("Sinkron", "publish", {}, "Sinkron katalog selesai.")}>
          <Zap aria-hidden="true" />{(busy === "publish" || busy === "sync") ? "Menyinkronkan…" : "Sinkronkan katalog"}
        </Button>
        {syncDisabled && <p className="text-xs text-admin-muted">{configured ? "Sinkronisasi dinonaktifkan." : `${name} belum dikonfigurasi.`}</p>}
      </CardContent>
    </Card>

    {config.exclusions && (
      <Card className="overflow-hidden">
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Pengecualian katalog</CardTitle>
          <CardDescription className="mt-1 text-xs">Produk yang cocok dengan pola dilewati saat sinkronisasi.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {exclusions.length === 0 ? <p className="text-sm text-admin-muted">Belum ada pengecualian.</p> : (
            <div className="rounded-md border border-admin-border">
              <Table>
                <TableHeader><TableRow><TableHead>Pola</TableHead><TableHead>Alasan</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
                <TableBody>
                  {exclusions.map(rule => <TableRow key={rule.id}>
                    <TableCell className="font-mono text-xs text-admin-fg">{rule.pattern}</TableCell>
                    <TableCell className="text-xs text-admin-muted">{rule.reason ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button variant="ghost" size="icon" className="min-h-11 min-w-11 text-admin-danger md:min-h-0 md:min-w-0" disabled={locked}
                          title="Hapus exclusion" onClick={() => setExclusionToDelete(rule)} aria-label={`Hapus exclusion ${rule.pattern}`}><Trash2 /></Button>
                      </div>
                    </TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Input value={newPattern} onChange={e => setNewPattern(e.target.value)} placeholder={config.exclusionsPlaceholder}
              aria-label="Pola exclusion baru" className="min-w-0 flex-1" />
            <Button disabled={locked} onClick={() => void addExclusion()}><Plus /> Tambah</Button>
          </div>
        </CardContent>
      </Card>
    )}

    {config.sandbox && (
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Uji pesanan sandbox</CardTitle>
          <CardDescription className="mt-1 text-xs">Gunakan ID produk dan varian dari SK. Saldo tidak terpotong.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={sandboxProduct} onChange={e => setSandboxProduct(e.target.value)} placeholder="product_id" inputMode="numeric" aria-label="product_id sandbox" className="w-32" />
            <Input value={sandboxVariant} onChange={e => setSandboxVariant(e.target.value)} placeholder="variant_id" inputMode="numeric" aria-label="variant_id sandbox" className="w-32" />
            <Button className="min-h-11 md:min-h-0" onClick={() => void runSandbox()} disabled={locked}>
              {busy === "sandbox" ? <Spinner size={13} /> : null}
              {busy === "sandbox" ? "Mengirim…" : "Kirim sandbox"}
            </Button>
          </div>
          {sandboxResult && <p className="break-all font-mono text-xs text-admin-muted">{sandboxResult}</p>}
        </CardContent>
      </Card>
    )}
  </TabsContent>;
}
