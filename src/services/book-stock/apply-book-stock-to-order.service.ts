import type { ImportResult } from "@/types";
import {
  bookStockRepository,
  orderRepository,
  storeRepository,
} from "@/repositories";

export async function applyBookStockUploadToOrder(input: {
  orderId: number;
  /** ISO timestamp of the upload batch. If omitted, latest for the store is used. */
  importedAt?: string;
  /** Prefer latest upload for this business date when importedAt is omitted. */
  bookStockDate?: string;
}): Promise<ImportResult & { uploadId: number }> {
  const order = await orderRepository.getById(input.orderId);
  if (!order) throw new Error("Order not found");

  let importedAt: Date | null = null;
  if (input.importedAt) {
    importedAt = new Date(input.importedAt);
    if (Number.isNaN(importedAt.getTime())) {
      throw new Error("Invalid importedAt timestamp");
    }
  } else if (input.bookStockDate) {
    importedAt = await bookStockRepository.getLatestImportedAtForDate(
      order.storeId,
      input.bookStockDate,
    );
  } else {
    importedAt = await bookStockRepository.getLatestImportedAt(order.storeId);
  }

  if (!importedAt) {
    throw new Error("No book stock uploaded for this store yet");
  }

  const storedItems = await bookStockRepository.listForStoreAndImportedAt(
    order.storeId,
    importedAt,
  );
  if (!storedItems.length) {
    throw new Error("Selected book stock upload has no matched products");
  }

  const bookStockDate = storedItems[0]?.bookStockDate ?? order.bookStockDate;

  await orderRepository.clearBookStockEvents(input.orderId);

  const upload = await orderRepository.createUpload({
    orderId: input.orderId,
    uploadType: "book_stock",
    fileName: `book-stock-${bookStockDate}-${importedAt.toISOString()}`,
    mappingType: "store_product_code",
    referenceColumn: "store_product_code",
    quantityColumn: "book_stock_qty",
    bookStockImportId: null,
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
      quantity: item.bookStockQty,
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

export async function applyBookStockForStores(input: {
  orderId: number;
  storeIds: number[];
  bookStockDate?: string;
}): Promise<ImportResult & { uploadId: number }> {
  if (!input.storeIds.length) {
    throw new Error("Select at least one store");
  }

  const order = await orderRepository.getById(input.orderId);
  if (!order) throw new Error("Order not found");

  await orderRepository.clearBookStockEvents(input.orderId);

  const combinedItems: Array<{
    storeProductId: number;
    bookStockQty: string;
    bookStockDate: string;
  }> = [];

  for (const storeId of input.storeIds) {
    let importedAt: Date | null = null;
    if (input.bookStockDate) {
      importedAt = await bookStockRepository.getLatestImportedAtForDate(
        storeId,
        input.bookStockDate,
      );
    } else {
      importedAt = await bookStockRepository.getLatestImportedAt(storeId);
    }

    if (!importedAt) {
      const store = await storeRepository.getById(storeId);
      throw new Error(
        `No book stock uploaded for ${store?.name ?? "store"} yet`,
      );
    }

    const storedItems = await bookStockRepository.listForStoreAndImportedAt(
      storeId,
      importedAt,
    );
    if (!storedItems.length) {
      const store = await storeRepository.getById(storeId);
      throw new Error(
        `Selected book stock upload has no matched products for ${store?.name ?? "store"}`,
      );
    }

    combinedItems.push(...storedItems);
  }

  const bookStockDate = combinedItems[0]?.bookStockDate ?? order.bookStockDate;
  const importedLabel = new Date().toISOString();

  const upload = await orderRepository.createUpload({
    orderId: input.orderId,
    uploadType: "book_stock",
    fileName: `book-stock-multi-${bookStockDate}-${importedLabel}`,
    mappingType: "store_product_code",
    referenceColumn: "store_product_code",
    quantityColumn: "book_stock_qty",
    bookStockImportId: null,
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
    combinedItems.map((item) => ({
      eventId: event.id,
      storeProductId: item.storeProductId,
      quantity: item.bookStockQty,
    })),
  );

  return {
    totalRows: combinedItems.length,
    matchedRows: combinedItems.length,
    unmatchedRows: 0,
    invalidRows: 0,
    errors: [],
    uploadId: upload.id,
  };
}

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
