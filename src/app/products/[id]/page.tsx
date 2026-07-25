import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ProductDetailForms } from "@/components/products/product-detail-forms";
import {
  departmentRepository,
  productRepository,
  supplierRepository,
} from "@/repositories";
import { parseRouteId } from "@/utils/parse-route-id";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ storeId?: string }>;
}) {
  const { id: idParam } = await params;
  const query = await searchParams;
  const id = parseRouteId(idParam);
  if (id === null) notFound();

  const product = await productRepository.getById(id);
  if (!product) notFound();

  const [barcodes, supplierProducts, suppliers, departments] = await Promise.all([
    productRepository.getBarcodes(id),
    productRepository.getSupplierProducts(id),
    supplierRepository.list(),
    departmentRepository.listActiveNames(),
  ]);

  const backHref = query.storeId
    ? `/products?storeId=${encodeURIComponent(query.storeId)}`
    : "/products";

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
        productId={id}
        product={product}
        departments={departments}
        barcodes={barcodes}
        supplierProducts={supplierProducts}
        suppliers={suppliers}
      />
    </AppShell>
  );
}
