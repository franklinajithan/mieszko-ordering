import Link from "next/link";
import type { ComponentProps } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ProductDetailForms } from "@/components/products/product-detail-forms";

type DetailProps = ComponentProps<typeof ProductDetailForms>;

export function ProductDetailPageView({
  product,
  backHref,
  departments,
  barcodes,
  supplierProducts,
  suppliers,
}: {
  product: DetailProps["product"];
  backHref: string;
  departments: string[];
  barcodes: DetailProps["barcodes"];
  supplierProducts: DetailProps["supplierProducts"];
  suppliers: DetailProps["suppliers"];
}) {
  return (
    <AppShell
      title={product.name}
      description={`Imported: ${product.department}${
        product.orderDepartment
          ? ` · Order: ${product.orderDepartment}`
          : " · Order department unassigned"
      }`}
    >
      <div className="mb-4">
        <Link href={backHref} className="text-sm text-zinc-600 underline">
          ← Back to products
        </Link>
      </div>
      <ProductDetailForms
        productId={product.id}
        product={product}
        departments={departments}
        barcodes={barcodes}
        supplierProducts={supplierProducts}
        suppliers={suppliers}
      />
    </AppShell>
  );
}
