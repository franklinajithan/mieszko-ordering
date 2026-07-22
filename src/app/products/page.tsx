import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductForms } from "@/components/products/product-forms";
import { Badge } from "@/components/ui/badge";
import { productRepository, storeRepository } from "@/repositories";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    storeId?: string;
    department?: string;
    active?: string;
  }>;
}) {
  const params = await searchParams;
  const stores = await storeRepository.list();
  const departments = await productRepository.getDepartments();
  const storeId = params.storeId ? Number(params.storeId) : undefined;
  const products = await productRepository.list({
    storeId: storeId && Number.isInteger(storeId) && storeId > 0 ? storeId : undefined,
    department: params.department,
    isActive: params.active === "false" ? false : params.active === "all" ? undefined : true,
  });

  return (
    <AppShell
      title="Products"
      description="Manage master products, store codes, barcodes, and supplier mappings."
    >
      <div className="space-y-6">
        <ProductFilters stores={stores} departments={departments} />
        <ProductForms stores={stores} />
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>
                <th className="px-4 py-3">Store code</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {products.map(({ product, storeProduct, store }) => (
                <tr key={storeProduct.id}>
                  <td className="px-4 py-3 font-medium">{storeProduct.storeProductCode}</td>
                  <td className="px-4 py-3">{product.name}</td>
                  <td className="px-4 py-3">{product.department}</td>
                  <td className="px-4 py-3">{store.name}</td>
                  <td className="px-4 py-3">
                    <Badge status={product.isActive ? "active" : "inactive"}>
                      {product.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/products/${product.id}`} className="text-zinc-700 underline">
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
