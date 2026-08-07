import type { BookStockFileParseProgress } from "@/parsers/glopos-stock-valuation-parser";
import type { BookStockFileParseResult } from "@/parsers/book-stock-file-parser";

export type WorkerParseMessage =
  | { type: "progress"; progress: BookStockFileParseProgress }
  | { type: "done"; result: BookStockFileParseResult }
  | { type: "error"; message: string };
