import { TabsContent } from "../ui";
import { SupplierOrderQueue } from "../SupplierOrderQueue";
import { useSupplierPanelContext } from "./panel-context";

export function AntreanTab() {
  const {
    supplier, links, config, orderLabels, locked, isWrSk, wrSkOrdersLoading, loading, orderQuery,
    setOrderQuery, orderStatus, setOrderStatus, setOrderPage, orderPage, orderTotal, orderPerPage,
    loadWrSkOrders, busyOrderAction, runWrSkOrderAction, receiptTrigger, mutateStandard,
  } = useSupplierPanelContext();
  return <TabsContent value="antrean" className="mt-4">
    <SupplierOrderQueue
      supplier={supplier}
      links={links}
      config={config}
      labels={orderLabels}
      locked={locked}
      loading={isWrSk ? wrSkOrdersLoading : loading}
      orderQuery={orderQuery}
      onOrderQueryChange={setOrderQuery}
      orderStatus={orderStatus}
      onOrderStatusChange={value => { setOrderStatus(value); setOrderPage(1); }}
      orderPage={orderPage}
      orderTotal={orderTotal}
      orderPerPage={orderPerPage}
      onPageChange={page => void loadWrSkOrders(page)}
      busyOrderAction={busyOrderAction}
      onAction={(link, action, trigger) => {
        if (isWrSk) {
          if (action === "retry" || action === "void") void runWrSkOrderAction(link, action);
          return;
        }
        if (action === "reveal") receiptTrigger.current = trigger;
        void mutateStandard(
          action === "reveal" ? "Receipt" : "Antrean",
          "orders",
          { id: link.id, action },
          action === "reconcile" ? "Status pesanan diperiksa." : "Pesanan diproses ulang.",
        );
      }}
    />
  </TabsContent>;
}
