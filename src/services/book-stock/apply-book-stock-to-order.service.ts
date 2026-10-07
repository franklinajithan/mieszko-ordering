import {
  bookStockRepository,
} from "@/repositories";

export type BookStockUploadSummary = {
  bookStockDate: string;
  importedAt: string;
  itemCount: number;
  totalBookStockQty: string;
};

export async function listBookStockImportsForStore(
  storeId: number,
): Promise<BookStockUploadSummary[]> {
  return bookStockRepository.listUploadSummariesForStore(storeId);
}

export async function getLatestBookStockSummary(
  storeId: number,
): Promise<BookStockUploadSummary | null> {
  const summaries = await listBookStockImportsForStore(storeId);
  return summaries[0] ?? null;
}
