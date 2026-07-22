import { AppShell, NavCard } from "@/components/layout/app-shell";

export default function HomePage() {
  return (
    <AppShell title="Replace Excel-based dairy ordering">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <NavCard
          href="/products"
          title="Products"
          description="Master products, store codes, barcodes, and supplier mappings."
        />
        <NavCard
          href="/daily-sales"
          title="Daily Sales"
          description="Import permanent daily sales history by store."
        />
        <NavCard
          href="/supplier-prices"
          title="Supplier Prices"
          description="Import supplier net-price files and preserve history."
        />
        <NavCard
          href="/orders/new"
          title="New Order"
          description="Prepare an order with stock uploads, forecasting, and price comparison."
        />
        <NavCard
          href="/orders"
          title="Order History"
          description="Review past orders and export completed results."
        />
        <NavCard
          href="/stores"
          title="Stores and Suppliers"
          description="Manage stores, suppliers, and tie-break priorities."
        />
      </div>
    </AppShell>
  );
}
