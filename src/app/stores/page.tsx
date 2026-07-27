import { StoresPageView } from "@/components/stores/stores-page";
import { listStores, listSuppliers } from "@/lib/api";

export default async function StoresPage() {
  const [storesResult, suppliersResult] = await Promise.all([
    listStores(),
    listSuppliers(),
  ]);

  if (!storesResult.success) {
    throw new Error(storesResult.error);
  }
  if (!suppliersResult.success) {
    throw new Error(suppliersResult.error);
  }

  return (
    <StoresPageView
      stores={storesResult.data}
      suppliers={suppliersResult.data}
    />
  );
}
