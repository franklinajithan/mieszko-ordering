import type { ImportResult } from "@/types";
import {
  bookStockRepository,
  orderRepository,
} from "@/repositories/postgres";

export async function applyBookStockImportToOrder(input: {
  orderId: number;
  importId: number;
}): Promise<ImportResult & { uploadId: number }> {
  const order = await orderRepository.getById(input.orderId);
  if (!order) throw new Error("Order not found");

  const bookStockImport = await bookStockRepository.getImportById(input.importId);
  if (!bookStockImport) throw new Error("Book stock import not found");

  if (bookStockImport.storeId !== order.storeId) {
    throw new Error("Book stock import belongs to a different store");
  }

  const storedItems = await bookStockRepository.getItems(input.importId);
  if (!storedItems.length) {
    throw new Error("Book stock import has no matched products");
  }

  await orderRepository.clearBookStockEvents(input.orderId);

  const upload = await orderRepository.createUpload({
    orderId: input.orderId,
    uploadType: "book_stock",
    fileName: bookStockImport.fileName ?? `book-stock-import-${bookStockImport.id}`,
    mappingType: "store_product_code",
    referenceColumn: bookStockImport.referenceColumn,
    quantityColumn: bookStockImport.quantityColumn,
    bookStockImportId: bookStockImport.id,
    supplierId: null,
    deliveryDate: null,
  });

  const event = await orderRepository.createStockEvent({
    orderId: input.orderId,
    uploadId: upload.id,
    eventType: "book_stock",
    eventDate: order.bookStockDate,
    sortOrder: Date.now(),
  });

  await orderRepository.createStockEventItems(
    storedItems.map((item) => ({
      eventId: event.id,
      storeProductId: item.storeProductId,
      quantity: item.quantity,
    })),
  );

  return {
    totalRows: storedItems.length,
    matchedRows: storedItems.length,
    unmatchedRows: 0,
    invalidRows: 0,
    errors: [],
    uploadId: upload.id,
  };
}

export type BookStockImportSummary = {
  importId: number;
  fileName: string | null;
  bookStockDate: string;
  importedAt: Date;
  itemCount: number;
};

export type LatestBookStockSummary = BookStockImportSummary;

export async function listBookStockImportsForStore(
  storeId: number,
): Promise<BookStockImportSummary[]> {
  const imports = await bookStockRepository.listForStore(storeId);
  const summaries: BookStockImportSummary[] = [];

  for (const bookStockImport of imports) {
    const itemCount = await bookStockRepository.countItems(bookStockImport.id);
    if (itemCount === 0) continue;
    summaries.push({
      importId: bookStockImport.id,
      fileName: bookStockImport.fileName,
      bookStockDate: bookStockImport.bookStockDate,
      importedAt: bookStockImport.importedAt,
      itemCount,
    });
  }

  return summaries;
}

export async function getLatestBookStockSummary(
  storeId: number,
): Promise<LatestBookStockSummary | null> {
  const imports = await listBookStockImportsForStore(storeId);
  return imports[0] ?? null;
}
