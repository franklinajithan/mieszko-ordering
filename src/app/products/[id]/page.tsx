import { AppShell } from "@/components/layout/app-shell";
import { ProductDetailForms } from "@/components/products/product-detail-forms";
import { productRepository, supplierRepository } from "@/repositories";
import { notFound } from "next/navigation";
import { parseRouteId } from "@/utils/parse-route-id";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = parseRouteId(idParam);
  if (id === null) notFound();

  const [barcodes, supplierProducts, suppliers] = await Promise.all([
    productRepository.getBarcodes(id),
    productRepository.getSupplierProducts(id),
    supplierRepository.list(),
  ]);

  return (
    <AppShell title="Product Mappings" description="Barcodes and supplier-specific product codes.">
      <ProductDetailForms
        productId={id}
        barcodes={barcodes}
        supplierProducts={supplierProducts}
        suppliers={suppliers}
      />
    </AppShell>
  );
}
