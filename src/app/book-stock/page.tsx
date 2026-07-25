import { BookStockPageView } from "@/components/imports/book-stock-page";
import { storeRepository } from "@/repositories";

export default async function BookStockPage() {
  const stores = await storeRepository.list();
  return <BookStockPageView stores={stores} />;
}
