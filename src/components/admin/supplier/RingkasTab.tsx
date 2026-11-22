import { RefreshCw } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { Spinner } from "@/components/ui/Loading";
import { Badge, Button, Card, CardContent, Skeleton, StatCard, TabsContent } from "../ui";
import { SupplierSyncStatus, syncCompactValue } from "../SupplierSyncStatus";
import { supplierMoney, supplierTime } from "../supplier-admin-data";
import { useSupplierPanelContext } from "./panel-context";

export function RingkasTab() {
  const {
    isWrSk, saldoLoading, wrSkBalance, balance, logsLoading, wrSkCounts, logs, diffStatus,
    currency, catalog, active, mapped, items, allFamilies, syncMeta, name, configured, dispatchEnabled,
    syncEnabled, config, runWrSkSync, locked, syncDisabled, busy, lastErrorAt,
  } = useSupplierPanelContext();
  return <TabsContent value="ringkas" className="mt-4 space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4 [&>div]:p-3 sm:[&>div]:p-4 [&>div>div]:break-words [&>div>div]:text-lg sm:[&>div>div]:text-2xl">
      {isWrSk ? (
        <>
          <StatCard
            label="Saldo"
            value={saldoLoading ? <Skeleton className="h-7 w-28 max-w-full" /> : wrSkBalance != null ? formatRupiah(wrSkBalance) : "—"}
            hint={saldoLoading
              ? "Memuat kapasitas…"
              : wrSkBalance == null
                ? "Muat ulang untuk cek saldo."
                : <>
                    {balance?.capacity && <><span>~{balance.capacity.estimatedOrders} order</span> · {formatRupiah(balance.capacity.avgOrderCost)}/order</>}
                    {balance?.current?.isLow && <span className="block">Di bawah batas {formatRupiah(balance.current.threshold)}</span>}
                  </>}
            tone={balance?.current?.isLow ? "warning" : "secondary"}
          />
          <StatCard
            label="Varian aktif"
            value={logsLoading ? <Skeleton className="h-8 w-20" /> : (wrSkCounts ? wrSkCounts.active_variants : "—")}
            hint={wrSkCounts ? `${wrSkCounts.mapped_variants} dipetakan · ${wrSkCounts.total_variants} di katalog` : undefined}
          />
          <StatCard
            label="Keluarga produk"
            value={logsLoading ? <Skeleton className="h-8 w-20" /> : (wrSkCounts ? wrSkCounts.families : "—")}
          />
          <StatCard
            label="Sinkron terakhir"
            value={logsLoading ? <Skeleton className="h-7 w-28 max-w-full" /> : syncCompactValue(logs, diffStatus)}
            hint={logsLoading ? "Memuat status sinkron…" : undefined}
          />
        </>
      ) : (
        <>
          <StatCard label="Saldo" value={supplierMoney(currency, balance?.balance ?? balance?.balance_usdt, true)} hint={balance?.username ? `akun ${balance.username}` : undefined} />
          <StatCard label="Varian aktif" value={catalog ? active : "—"} hint={catalog ? `${mapped} dipetakan · ${items.length} di katalog` : undefined} />
          <StatCard label="Keluarga produk" value={catalog ? allFamilies.size : "—"} />
          <StatCard label="Sinkron terakhir" value={supplierTime(catalog?.last_sync_at) ?? (catalog ? "Belum pernah" : "—")} />
        </>
      )}
    </div>
    {(isWrSk ? syncMeta?.configured !== undefined : catalog != null) && (
      <div className="flex flex-wrap gap-2" aria-label={`Status ${name}`}>
        {!configured && <Badge variant="warning">Belum dikonfigurasi</Badge>}
        <Badge variant={dispatchEnabled ? "secondary" : "warning"}>Pengiriman otomatis {dispatchEnabled ? "aktif" : "nonaktif"}</Badge>
        <Badge variant={syncEnabled ? "secondary" : "warning"}>Sinkron otomatis {syncEnabled ? "aktif" : "nonaktif"}</Badge>
      </div>
    )}
    {isWrSk ? (
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0 space-y-1">
            <SupplierSyncStatus logs={logs} diff={diffStatus} excludedLabel={config.excludedLabel ?? "excluded"} loading={logsLoading} />
          </div>
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" onClick={() => void runWrSkSync()} disabled={locked || syncDisabled}>
            {busy === "sync" ? <Spinner size={13} /> : <RefreshCw />}
            {busy === "sync" ? "Menyinkronkan…" : "Sinkron sekarang"}
          </Button>
        </CardContent>
      </Card>
    ) : (
      catalog?.last_error && <p role="alert" className="break-words text-sm text-admin-danger">Sinkron gagal{lastErrorAt ? ` (${lastErrorAt})` : ""}. Coba sinkronkan kembali dari tab Alat.</p>
    )}
  </TabsContent>;
}
