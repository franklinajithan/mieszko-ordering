import { AppShell } from "@/components/layout/app-shell";
import { UnmatchedProducts } from "@/components/unmatched-products/unmatched-products";
export default function UnmatchedProductsPage() {
  return (
    <AppShell
      title="Unmatched Products"
      description="Correct CRM identifiers, review Excel changes and safely reprocess affected reports."
    >
      <UnmatchedProducts />
    </AppShell>
  );
}
