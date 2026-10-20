import ExcelJS from "exceljs";
import { InputError } from "@/utils/input-error";

export const columns = [
  ["Store", "store"],
  ["Store ID", "storeId"],
  ["Identifier Type", "kind"],
  ["CRM Identifier", "identifier"],
  ["Product Name", "productName"],
  ["Department", "department"],
  ["Action", "action"],
  ["Existing Product Code", "existingCode"],
  ["New Product Code", "newCode"],
  ["Barcode", "barcode"],
  ["Supplier Code", "supplierCode"],
  ["Affected Jobs", "jobs"],
  ["Report Dates", "dates"],
  ["Review Notes", "notes"],
  ["Validation Status", "validationStatus"],
] as const;
export type Correction = {
  rowNumber: number;
  storeId: number;
  kind: string;
  identifier: string;
  productName: string;
  department: string;
  action: string;
  existingCode: string;
  newCode: string;
  barcode: string;
  supplierCode: string;
  notes: string;
};
export type ReviewRow = Correction & {
  errors: string[];
  warnings: string[];
  targetId: number | null;
  identifierId: number | null;
};

export async function buildReviewWorkbook(items: Record<string, unknown>[]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Unmatched Products", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns.map(([header, key]) => ({
    header,
    key,
    width: key === "productName" || key === "notes" ? 40 : 24,
    style: { numFmt: "@" },
  }));
  sheet.autoFilter = "A1:O1";
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF14532D" },
  };
  for (const item of items) {
    const row = sheet.addRow({
      ...item,
      validationStatus: item.validationStatus ?? item.status ?? "PENDING",
    });
    row.getCell(7).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"MATCH_EXISTING,ADD_NEW"'],
    };
  }
  const guide = book.addWorksheet("Instructions");
  guide.getColumn(1).width = 120;
  [
    "Do not change Store ID, Identifier Type or CRM Identifier. All identifiers are text: keep leading zeros.",
    "MATCH_EXISTING: enter the exact Existing Product Code in this store. Matches are never guessed.",
    "ADD_NEW: enter New Product Code, Product Name and Department. For product-code identifiers, New Product Code must equal CRM Identifier.",
    "Barcode is optional; a Barcode identifier is automatically linked. Existing mappings cannot be reassigned here.",
    "Supplier Code is an audit reference only: supplier pricing/linking requires a supplier in Product Upload.",
    "Leave Action blank to keep a row pending. Preview validates the whole file; fix errors before approval.",
    "Upload Corrected Excel, inspect Preview Changes, enter your operator name and explicitly Approve Updates.",
    "Operator names are self-reported because this installation has no user login system.",
    "Approval revalidates current database records and applies all proposed changes in one transaction. Reuploads are safe.",
    "Eligible complete reports are queued once per mapping revision. Published totals change only after a complete successful import.",
  ].forEach((line) => guide.addRow([line]));
  return book.xlsx.writeBuffer();
}

export async function readCorrections(bytes: Buffer): Promise<Correction[]> {
  if (bytes.length > 15 * 1024 * 1024)
    throw new InputError("Workbook exceeds 15 MB.");
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw new InputError("Upload a valid .xlsx workbook.");
  }
  const sheet = book.getWorksheet("Unmatched Products");
  if (!sheet)
    throw new InputError(
      "Missing Unmatched Products worksheet. Download a fresh review file.",
    );
  if (sheet.rowCount > 100001)
    throw new InputError("Maximum 100,000 review rows per workbook.");
  const indexes = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, index) => {
    if (typeof cell.value === "string") indexes.set(cell.value.trim(), index);
  });
  for (const [header] of columns)
    if (!indexes.has(header))
      throw new InputError(
        `Missing column: ${header}. Download a fresh review file.`,
      );
  const rows: Correction[] = [];
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    if (!row.hasValues) continue;
    const values: Record<string, string> = {};
    for (const [header, key] of columns) {
      const value = row.getCell(indexes.get(header)!).value;
      if (value !== null && typeof value === "object")
        throw new InputError(
          `Row ${number}: formulas, links and rich text are not accepted. Paste plain values.`,
        );
      // Numeric identifiers may already have lost leading zeros. Never silently accept them.
      if (
        ["identifier", "existingCode", "newCode", "barcode"].includes(key) &&
        typeof value === "number"
      )
        throw new InputError(
          `Row ${number}: ${header} must be stored as text to preserve leading zeros.`,
        );
      values[key] = value === null ? "" : String(value).trim();
    }
    rows.push({
      rowNumber: number,
      storeId: Number(values.storeId),
      kind: values.kind,
      identifier: values.identifier,
      productName: values.productName,
      department: values.department,
      action: values.action,
      existingCode: values.existingCode,
      newCode: values.newCode,
      barcode: values.barcode,
      supplierCode: values.supplierCode,
      notes: values.notes,
    });
  }
  if (!rows.length) throw new InputError("Workbook has no review rows.");
  return rows;
}
