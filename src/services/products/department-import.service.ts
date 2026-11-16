import { departmentRepository } from "@/repositories";
import type { ImportResult, ParsedRow } from "@/types";

type ImportOptions = {
  nameColumn: string;
  codeColumn?: string;
};

function readName(row: ParsedRow, nameColumn: string) {
  return (
    row[nameColumn]?.trim() ||
    row["Department"]?.trim() ||
    row["Department Name"]?.trim() ||
    row["Name"]?.trim() ||
    row["name"]?.trim() ||
    ""
  );
}

function readCode(row: ParsedRow, codeColumn?: string) {
  if (codeColumn && row[codeColumn]?.trim()) {
    return row[codeColumn].trim();
  }
  return row["Code"]?.trim() || row["code"]?.trim() || undefined;
}

export async function importDepartmentRows(
  rows: ParsedRow[],
  options: ImportOptions,
): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  };

  const seenNames = new Set<string>();

  for (const row of rows) {
    const rowNumber = Number(row.__rowNumber ?? 0);
    const name = readName(row, options.nameColumn);
    const code = readCode(row, options.codeColumn);
    const normalizedName = name.toLowerCase();

    if (!name) {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference: null,
        message: "Missing department name",
      });
      continue;
    }

    if (seenNames.has(normalizedName)) {
      result.duplicateRows = (result.duplicateRows ?? 0) + 1;
      result.errors.push({
        rowNumber,
        reference: name,
        message: "Duplicate department in file",
      });
      continue;
    }
    seenNames.add(normalizedName);

    try {
      const existing = await departmentRepository.getByName(name);
      if (existing) {
        if (code && code !== (existing.code ?? "")) {
          await departmentRepository.update(existing.id, { code });
        }
        result.matchedRows += 1;
        continue;
      }

      await departmentRepository.create({
        name,
        code: code || null,
        isActive: true,
      });
      result.matchedRows += 1;
    } catch (error) {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference: name,
        message: error instanceof Error ? error.message : "Import failed",
      });
    }
  }

  return result;
}
