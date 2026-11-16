import { BookStockPageView } from "@/components/book-stock/book-stock-page";
import { listStores } from "@/lib/api/stores";
import { listSuppliers } from "@/lib/api/suppliers";

export default async function BookStockPage() {
  const [stores, suppliers] = await Promise.all([listStores(), listSuppliers()]);
  if (!stores.success) throw new Error(stores.error);
  if (!suppliers.success) throw new Error(suppliers.error);
  return <BookStockPageView stores={stores.data} suppliers={suppliers.data} />;
}
