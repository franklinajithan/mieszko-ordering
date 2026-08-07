import { parseGloposStockValuationReport } from "@/parsers/glopos-stock-valuation-parser";
import type { BookStockFileParseResult } from "@/parsers/book-stock-file-parser";
import type { WorkerParseMessage } from "@/lib/book-stock/worker-messages";

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  const { buffer, fileName } = event.data;

  void parseGloposStockValuationReport(buffer, fileName, {
    onProgress: (progress) => {
      const msg: WorkerParseMessage = { type: "progress", progress };
      self.postMessage(msg);
    },
  })
    .then((parsed) => {
      const result: BookStockFileParseResult = {
        headers: parsed.headers,
        rows: parsed.rows,
        referenceColumn: parsed.referenceColumn,
        quantityColumn: parsed.quantityColumn,
        bookStockDate: parsed.bookStockDate ?? undefined,
        duplicateRows: parsed.duplicateRows,
        gloposStockValuation: true,
      };
      const done: WorkerParseMessage = { type: "done", result };
      self.postMessage(done);
    })
    .catch((error: unknown) => {
      const msg: WorkerParseMessage = {
        type: "error",
        message: error instanceof Error ? error.message : "Parse failed",
      };
      self.postMessage(msg);
    });
};
