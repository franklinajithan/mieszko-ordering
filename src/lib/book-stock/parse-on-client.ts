import {
  parseBookStockFileBuffer,
  type BookStockFileParseOptions,
  type BookStockFileParseResult,
} from "@/parsers/book-stock-file-parser";
import type { BookStockFileParseProgress } from "@/parsers/glopos-stock-valuation-parser";
import type { WorkerParseMessage } from "@/lib/book-stock/worker-messages";

export type ClientBookStockParseOptions = BookStockFileParseOptions & {
  /** When aborted, in-flight worker parse is terminated. */
  signal?: AbortSignal;
};

function shouldUseWorker(fileName: string): boolean {
  return /stock\s*valuation/i.test(fileName);
}

async function waitForNextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function parseInWorker(
  buffer: ArrayBuffer,
  fileName: string,
  onProgress?: (progress: BookStockFileParseProgress) => void,
  signal?: AbortSignal,
): Promise<BookStockFileParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("@/workers/book-stock-file-parse.worker.ts", import.meta.url),
    );

    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Parse aborted", "AbortError"));
    };

    if (signal?.aborted) {
      worker.terminate();
      reject(new DOMException("Parse aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", onAbort);

    worker.onmessage = (event: MessageEvent<WorkerParseMessage>) => {
      const data = event.data;
      if (data.type === "progress") {
        onProgress?.(data.progress);
        return;
      }
      if (data.type === "done") {
        cleanup();
        resolve(data.result);
        return;
      }
      cleanup();
      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Worker parse failed"));
    };

    worker.postMessage({ buffer, fileName });
  });
}

/** Parse book-stock files off the main thread when possible (large GloPOS valuation exports). */
export async function parseBookStockFileOnClient(
  buffer: ArrayBuffer,
  fileName: string,
  options?: ClientBookStockParseOptions,
): Promise<BookStockFileParseResult> {
  await waitForNextFrame();

  if (typeof Worker !== "undefined" && shouldUseWorker(fileName)) {
    try {
      return await parseInWorker(buffer, fileName, options?.onProgress, options?.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
    }
  }

  return parseBookStockFileBuffer(buffer, fileName, options);
}
