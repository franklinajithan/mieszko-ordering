import { AppShell } from "@/components/layout/app-shell";
import { ProductDetailForms } from "@/components/products/product-detail-forms";
import { productRepository, supplierRepository } from "@/repositories";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [barcodes, supplierProducts, suppliers] = await Promise.all([
    productRepository.getBarcodes(id),
    productRepository.getSupplierProducts(id),
    supplierRepository.list(),
  ]);

  return (
    <AppShell title="Product mappings">
      <ProductDetailForms
        productId={id}
        barcodes={barcodes}
        supplierProducts={supplierProducts}
        suppliers={suppliers}
      />
    </AppShell>
  );
}
