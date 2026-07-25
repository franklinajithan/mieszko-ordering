import { notFound } from "next/navigation";
import { ProductDetailPageView } from "@/components/products/product-detail-page";
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
    <ProductDetailPageView
      product={product}
      backHref={backHref}
      departments={departments}
      barcodes={barcodes}
      supplierProducts={supplierProducts}
      suppliers={suppliers}
    />
  );
}
