import type { SupplierCodeFileRow } from "@/parsers/supplier-codes/supplier-code-file-parser";
import { supplierCodeCompareKey } from "@/parsers/supplier-codes/supplier-code-file-parser";

export type SupplierKey = "MM" | "SP" | "WAB";

export type SupplierCodeAssignment = {
  storeProductCode: string;
  supplierKey: SupplierKey;
  kind: "code" | "unavailable";
  /** Real supplier code when kind is "code"; null when unavailable. */
  supplierCode: string | null;
  rowNumber: number;
};

export type SupplierCodeConflict = {
  storeProductCode: string;
  supplierKey: SupplierKey;
  supplierCode: string;
  rowNumber: number;
  reason: string;
  otherStoreCodes?: string[];
};

function pushCell(
  assignments: SupplierCodeAssignment[],
  row: SupplierCodeFileRow,
  supplierKey: SupplierKey,
  cell: SupplierCodeFileRow["mm"],
) {
  if (!cell) return;
  if (cell.kind === "unavailable") {
    assignments.push({
      storeProductCode: row.storeProductCode,
      supplierKey,
      kind: "unavailable",
      supplierCode: null,
      rowNumber: row.rowNumber,
    });
    return;
  }
  assignments.push({
    storeProductCode: row.storeProductCode,
    supplierKey,
    kind: "code",
    supplierCode: cell.value,
    rowNumber: row.rowNumber,
  });
}

/** Expand file rows into one assignment per non-blank supplier cell. */
export function expandSupplierCodeAssignments(
  rows: SupplierCodeFileRow[],
): SupplierCodeAssignment[] {
  const assignments: SupplierCodeAssignment[] = [];
  for (const row of rows) {
    pushCell(assignments, row, "MM", row.mm);
    pushCell(assignments, row, "SP", row.sp);
    pushCell(assignments, row, "WAB", row.wab);
  }
  return assignments;
}

/**
 * Same supplier + supplier code mapped to two+ different store product codes
 * in the upload is shown as a warning. The assignments remain valid: the
 * same supplier price may be shared by each mapped product.
 * Unavailable markers never conflict with each other.
 */
export function findInFileSupplierCodeConflicts(
  assignments: SupplierCodeAssignment[],
): {
  clean: SupplierCodeAssignment[];
  conflicts: SupplierCodeConflict[];
} {
  const bySupplierCode = new Map<string, SupplierCodeAssignment[]>();
  for (const assignment of assignments) {
    if (assignment.kind !== "code" || !assignment.supplierCode) continue;
    const key = `${assignment.supplierKey}|${supplierCodeCompareKey(assignment.supplierCode)}`;
    const list = bySupplierCode.get(key) ?? [];
    list.push(assignment);
    bySupplierCode.set(key, list);
  }

  const conflicts: SupplierCodeConflict[] = [];

  for (const [key, group] of bySupplierCode) {
    const uniqueStoreCodes = [
      ...new Set(group.map((a) => a.storeProductCode)),
    ];
    if (uniqueStoreCodes.length < 2) continue;
    for (const assignment of group) {
      conflicts.push({
        storeProductCode: assignment.storeProductCode,
        supplierKey: assignment.supplierKey,
        supplierCode: assignment.supplierCode!,
        rowNumber: assignment.rowNumber,
        reason: `Same ${assignment.supplierKey} code maps to multiple store products in this file`,
        otherStoreCodes: uniqueStoreCodes.filter(
          (code) => code !== assignment.storeProductCode,
        ),
      });
    }
  }

  return { clean: assignments, conflicts };
}
