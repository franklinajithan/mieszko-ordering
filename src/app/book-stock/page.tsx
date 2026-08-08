import { BookStockPageView } from "@/components/book-stock/book-stock-page";
import { listStores } from "@/lib/api/stores";

export default async function BookStockPage() {
  const stores = await listStores();
  if (!stores.success) throw new Error(stores.error);
  return <BookStockPageView stores={stores.data} />;
}
