import { parseBookStockFileBuffer } from "@/parsers/book-stock-file-parser";
import type { WorkerParseMessage } from "@/lib/book-stock/worker-messages";

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  const { buffer, fileName } = event.data;

  void parseBookStockFileBuffer(buffer, fileName, {
    onProgress: (progress) => {
      const msg: WorkerParseMessage = { type: "progress", progress };
      self.postMessage(msg);
    },
  })
    .then((result) => {
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
