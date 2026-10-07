import { describe, expect, it } from "vitest";
import {
  parseFutureOrderGrid,
  parseOrderQty,
} from "@/parsers/future-deliveries/future-order-file-parser";

describe("future order file parser", () => {
  it("parses European ordered quantities", () => {
    expect(parseOrderQty("60,00")).toBe(60);
    expect(parseOrderQty("11,71")).toBe(11.71);
    expect(parseOrderQty("2.056")).toBe(2.056);
  });

  it("reads Index and Ordered number and skips repeated headers", () => {
    const rows = parseFutureOrderGrid([
      ["No.", "Product name", "UoM", "Index", "Quantity in basic multipack", "Ordered number"],
      ["1", "MLEKO", "szt", "15973", "12,00", "60,00"],
      ["2", "MLEKO 3.2", "szt", "15969", "12,00", "120,00"],
      ["No.", "Product name", "UoM", "Index", "Quantity in basic multipack", "Ordered number"],
      ["1", "OGORKI", "szt", "15528", "15,00", "15,00"],
      ["2", "DROŻDŻE", "szt", "KAT26443", "10,00", "20,00"],
      ["3", "ZERO", "szt", "999", "1,00", "0,00"],
    ]);

    expect(rows).toEqual([
      { supplierCode: "15973", quantity: "60", rowNumber: 2 },
      { supplierCode: "15969", quantity: "120", rowNumber: 3 },
      { supplierCode: "15528", quantity: "15", rowNumber: 5 },
      { supplierCode: "KAT26443", quantity: "20", rowNumber: 6 },
    ]);
  });

  it("reads invoice INDEKS and ILOSC after the metadata row", () => {
    const rows = parseFutureOrderGrid([
      ["KOD FIRMY: 1", "NR FAK.: 2609-SP/02/00588"],
      ["INDEKS", "IL_OPK_ZB", "ILOSC", "CENA_N", "NAZWA"],
      ["22", "6", "6", "1.41", "KONSERWA"],
      ["138", "22", "22", "0.35", "ZUPA"],
      ["999", "1", "0", "1.00", "ZERO"],
    ]);

    expect(rows).toEqual([
      { supplierCode: "22", quantity: "6", rowNumber: 3 },
      { supplierCode: "138", quantity: "22", rowNumber: 4 },
    ]);
  });
});
