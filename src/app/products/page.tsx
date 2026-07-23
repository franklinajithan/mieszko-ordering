import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductForms } from "@/components/products/product-forms";
import {
  ProductImportProvider,
  ProductImportStatusBar,
} from "@/components/products/product-import-context";
import { ProductPagination } from "@/components/products/product-pagination";
import { Badge } from "@/components/ui/badge";
import { productRepository, storeRepository, departmentRepository } from "@/repositories";

export const maxDuration = 300;

const PAGE_SIZE = 100;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    storeId?: string;
    department?: string;
    active?: string;
    search?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const stores = await storeRepository.list();
  const departments = await departmentRepository.listActiveNames();

  const storeId = params.storeId ? Number(params.storeId) : undefined;
  const validStoreId =
    storeId && Number.isInteger(storeId) && storeId > 0 ? storeId : undefined;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const search = params.search?.trim() || undefined;
  const listFilters = validStoreId
    ? {
        storeId: validStoreId,
        department: params.department,
        isActive:
          params.active === "false"
            ? false
            : params.active === "all"
              ? undefined
              : true,
        search,
      }
    : null;

  const [products, total] = validStoreId
    ? await Promise.all([
        productRepository.list({
          ...listFilters!,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
        productRepository.count(listFilters!),
      ])
    : [[], 0];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  return (
    <ProductImportProvider>
      <AppShell
        title="Products"
        description="Manage master products, store codes, barcodes, and supplier mappings."
      >
        <div className="space-y-6">
          <ProductImportStatusBar />
          <ProductFilters stores={stores} departments={departments} />
          <ProductForms stores={stores} departments={departments} />
          {!validStoreId ? (
            <div className="rounded-xl border bg-white p-8 text-center text-sm text-zinc-600">
              Select a store above to browse products. With large catalogs, products are loaded
              per store in pages of {PAGE_SIZE}.
            </div>
          ) : (
            <>
              <ProductPagination
                page={safePage}
                pageSize={PAGE_SIZE}
                total={total}
                searchParams={{
                  storeId: String(validStoreId),
                  department: params.department,
                  active: params.active,
                  search: params.search,
                }}
              />
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
                    {products.length ? (
                      products.map(({ product, storeProduct, store }) => (
                        <tr key={storeProduct.id}>
                          <td className="px-4 py-3 font-medium">
                            {storeProduct.storeProductCode}
                          </td>
                          <td className="px-4 py-3">{product.name}</td>
                          <td className="px-4 py-3">{product.department}</td>
                          <td className="px-4 py-3">{store.name}</td>
                          <td className="px-4 py-3">
                            <Badge status={product.isActive ? "active" : "inactive"}>
                              {product.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/products/${product.id}?storeId=${store.id}`}
                              className="text-zinc-700 underline"
                            >
                              Manage
                            </Link>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                          No products match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <ProductPagination
                page={safePage}
                pageSize={PAGE_SIZE}
                total={total}
                searchParams={{
                  storeId: String(validStoreId),
                  department: params.department,
                  active: params.active,
                  search: params.search,
                }}
              />
            </>
          )}
        </div>
      </AppShell>
    </ProductImportProvider>
  );
}
