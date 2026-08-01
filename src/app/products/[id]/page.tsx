import { notFound } from "next/navigation";
import { ProductDetailPageView } from "@/components/products/product-detail-page";
import { listDepartments } from "@/lib/api/departments";
import {
  getProduct,
  listProductBarcodes,
  listProductSupplierMappings,
} from "@/lib/api/products";
import { listSuppliers } from "@/lib/api/suppliers";
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

  const storeId =
    query.storeId && /^\d+$/.test(query.storeId)
      ? Number(query.storeId)
      : undefined;

  const productResult = await getProduct(id);
  if (!productResult.success) {
    if (productResult.error === "Product not found") notFound();
    throw new Error(productResult.error);
  }

  const [barcodesResult, supplierProductsResult, suppliersResult, departmentsResult] =
    await Promise.all([
      listProductBarcodes(id, storeId),
      listProductSupplierMappings(id),
      listSuppliers(),
      listDepartments(),
    ]);

  if (!barcodesResult.success) throw new Error(barcodesResult.error);
  if (!supplierProductsResult.success) throw new Error(supplierProductsResult.error);
  if (!suppliersResult.success) throw new Error(suppliersResult.error);
  if (!departmentsResult.success) throw new Error(departmentsResult.error);

  const departments = departmentsResult.data
    .filter((department) => department.isActive)
    .map((department) => ({ id: department.id, name: department.name }));

  const backHref = query.storeId
    ? `/products?storeId=${encodeURIComponent(query.storeId)}`
    : "/products";

  return (
    <ProductDetailPageView
      product={productResult.data}
      storeId={storeId}
      backHref={backHref}
      departments={departments}
      barcodes={barcodesResult.data}
      supplierProducts={supplierProductsResult.data}
      suppliers={suppliersResult.data}
    />
  );
}
