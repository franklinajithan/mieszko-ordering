import "server-only";
import { normalizeProductCode } from "@/parsers/product-file-parser";
import {
  parseSupplierCodeFileBuffer,
  supplierCodeCellLabel,
  supplierCodeCompareKey,
  type SupplierCodeFileParseResult,
} from "@/parsers/supplier-code-file-parser";
import { unavailableSupplierCode } from "@/lib/supplier-code-unavailable";
import { productRepository, storeRepository, supplierRepository } from "@/repositories";
import {
  expandSupplierCodeAssignments,
  findInFileSupplierCodeConflicts,
  type SupplierCodeAssignment,
  type SupplierCodeConflict,
  type SupplierKey,
} from "@/services/supplier-code-import-prepare";
import { assertStoreFileErpMatch } from "@/services/import-parse.service";
import type { ErpType, ImportResult } from "@/types";

const SUPPLIER_KEYS: SupplierKey[] = ["MM", "SP", "WAB"];

export type SupplierCodePreviewResult = {
  headers: string[];
  sampleRows: Array<Record<string, string>>;
  erpType: ErpType;
  storeCodeColumn: string;
  mmColumn: string | null;
  spColumn: string | null;
  wabColumn: string | null;
  totalRows: number;
  assignmentCount: number;
  matchedStoreCodes: number;
  unmatchedStoreCodes: number;
  conflictCount: number;
  conflicts: SupplierCodeConflict[];
  unmatchedCodes: string[];
};

export type SupplierCodeImportResult = ImportResult & {
  created: number;
  updated: number;
  unchanged: number;
  markedUnavailable: number;
  conflicts: SupplierCodeConflict[];
  unmatchedCodes: string[];
};

function catalogCodeKey(code: string): string {
  return normalizeProductCode(code).toLowerCase();
}

async function loadSupplierIdMap(): Promise<Map<SupplierKey, number>> {
  const map = new Map<SupplierKey, number>();
  for (const key of SUPPLIER_KEYS) {
    const supplier = await supplierRepository.getByCode(key);
    if (!supplier) {
      throw new Error(`Supplier ${key} is not configured. Seed suppliers first.`);
    }
    map.set(key, supplier.id);
  }
  return map;
}

function detectFileErpFromParse(
  parsed: SupplierCodeFileParseResult,
): ErpType {
  return parsed.erpType;
}

function assignmentConflictKey(assignment: {
  supplierKey: string;
  supplierCode: string | null;
  storeProductCode: string;
  rowNumber: number;
  kind: string;
}): string {
  const code =
    assignment.kind === "unavailable"
      ? "__unavailable__"
      : supplierCodeCompareKey(assignment.supplierCode ?? "");
  return `${assignment.supplierKey}|${code}|${assignment.storeProductCode.toLowerCase()}|${assignment.rowNumber}`;
}

async function classifyAssignments(input: {
  storeId: number;
  assignments: SupplierCodeAssignment[];
  inFileConflicts: SupplierCodeConflict[];
}): Promise<{
  toApply: Array<SupplierCodeAssignment & { productId: number; supplierId: number }>;
  conflicts: SupplierCodeConflict[];
  unmatchedCodes: string[];
  matchedStoreCodes: number;
}> {
  const supplierIds = await loadSupplierIdMap();
  const storeCodes = [
    ...new Set(input.assignments.map((a) => a.storeProductCode)),
  ];
  const lowerCodes = storeCodes.map((c) => catalogCodeKey(c));

  const storeProducts = await productRepository.findStoreProductsByLowercaseCodes(
    input.storeId,
    lowerCodes,
  );
  const productByStoreCode = new Map<
    string,
    { id: number; productId: number; code: string }
  >();
  for (const sp of storeProducts) {
    productByStoreCode.set(catalogCodeKey(sp.storeProductCode), {
      id: sp.id,
      productId: sp.productId,
      code: sp.storeProductCode,
    });
  }

  const conflicts = [...input.inFileConflicts];
  const conflictAssignmentKeys = new Set(
    input.inFileConflicts.map((c) =>
      assignmentConflictKey({
        supplierKey: c.supplierKey,
        supplierCode: c.supplierCode,
        storeProductCode: c.storeProductCode,
        rowNumber: c.rowNumber,
        kind: "code",
      }),
    ),
  );

  const unmatchedCodes: string[] = [];
  const seenUnmatched = new Set<string>();
  const matchedStoreCodeSet = new Set<string>();
  const toApply: Array<
    SupplierCodeAssignment & { productId: number; supplierId: number }
  > = [];

  // Preload existing real supplier codes for conflict checks (skip unavailable)
  const codesBySupplier = new Map<SupplierKey, string[]>();
  for (const key of SUPPLIER_KEYS) {
    codesBySupplier.set(
      key,
      input.assignments
        .filter((a) => a.supplierKey === key && a.kind === "code" && a.supplierCode)
        .map((a) => a.supplierCode!),
    );
  }
  const existingBySupplierCode = new Map<string, { productId: number }>();
  for (const key of SUPPLIER_KEYS) {
    const supplierId = supplierIds.get(key)!;
    const codes = [...new Set(codesBySupplier.get(key) ?? [])];
    const existing = await productRepository.findSupplierProductsByCodes(
      supplierId,
      codes,
    );
    for (const row of existing) {
      existingBySupplierCode.set(
        `${key}|${supplierCodeCompareKey(row.supplierCode)}`,
        { productId: row.productId },
      );
    }
  }

  for (const assignment of input.assignments) {
    if (conflictAssignmentKeys.has(assignmentConflictKey(assignment))) {
      continue;
    }

    const storeProduct = productByStoreCode.get(
      catalogCodeKey(assignment.storeProductCode),
    );
    if (!storeProduct) {
      if (!seenUnmatched.has(catalogCodeKey(assignment.storeProductCode))) {
        seenUnmatched.add(catalogCodeKey(assignment.storeProductCode));
        unmatchedCodes.push(assignment.storeProductCode);
      }
      continue;
    }
    matchedStoreCodeSet.add(catalogCodeKey(assignment.storeProductCode));

    if (assignment.kind === "code" && assignment.supplierCode) {
      const existing = existingBySupplierCode.get(
        `${assignment.supplierKey}|${supplierCodeCompareKey(assignment.supplierCode)}`,
      );
      if (existing && existing.productId !== storeProduct.productId) {
        conflicts.push({
          storeProductCode: assignment.storeProductCode,
          supplierKey: assignment.supplierKey,
          supplierCode: assignment.supplierCode,
          rowNumber: assignment.rowNumber,
          reason: `This ${assignment.supplierKey} code is already linked to another product`,
        });
        continue;
      }
    }

    toApply.push({
      ...assignment,
      productId: storeProduct.productId,
      supplierId: supplierIds.get(assignment.supplierKey)!,
    });
  }

  return {
    toApply,
    conflicts,
    unmatchedCodes,
    matchedStoreCodes: matchedStoreCodeSet.size,
  };
}

export async function parseSupplierCodeImportFile(input: {
  buffer: Buffer;
  fileName: string;
  storeId?: number;
}): Promise<SupplierCodePreviewResult> {
  const parsed = await parseSupplierCodeFileBuffer(input.buffer, input.fileName);
  const fileErp = detectFileErpFromParse(parsed);

  await assertStoreFileErpMatch({
    storeId: input.storeId,
    headers: parsed.headers,
    fileName: input.fileName,
    detectFileErpType: () => fileErp,
  });

  const assignments = expandSupplierCodeAssignments(parsed.rows);
  const { clean, conflicts: inFileConflicts } =
    findInFileSupplierCodeConflicts(assignments);

  let matchedStoreCodes = 0;
  let unmatchedStoreCodes = 0;
  let unmatchedCodes: string[] = [];
  let conflicts = inFileConflicts;

  if (input.storeId) {
    const classified = await classifyAssignments({
      storeId: input.storeId,
      assignments: clean,
      inFileConflicts,
    });
    matchedStoreCodes = classified.matchedStoreCodes;
    unmatchedCodes = classified.unmatchedCodes;
    unmatchedStoreCodes = classified.unmatchedCodes.length;
    conflicts = classified.conflicts;
  }

  const sampleRows = parsed.rows.slice(0, 10).map((row) => ({
    [parsed.storeCodeColumn]: row.storeProductCode,
    ...(parsed.mmColumn
      ? { [parsed.mmColumn]: supplierCodeCellLabel(row.mm) }
      : {}),
    ...(parsed.spColumn
      ? { [parsed.spColumn]: supplierCodeCellLabel(row.sp) }
      : {}),
    ...(parsed.wabColumn
      ? { [parsed.wabColumn]: supplierCodeCellLabel(row.wab) }
      : {}),
  }));

  return {
    headers: parsed.headers,
    sampleRows,
    erpType: fileErp,
    storeCodeColumn: parsed.storeCodeColumn,
    mmColumn: parsed.mmColumn,
    spColumn: parsed.spColumn,
    wabColumn: parsed.wabColumn,
    totalRows: parsed.rows.length,
    assignmentCount: assignments.length,
    matchedStoreCodes,
    unmatchedStoreCodes,
    conflictCount: conflicts.length,
    conflicts: conflicts.slice(0, 200),
    unmatchedCodes: unmatchedCodes.slice(0, 100),
  };
}

/**
 * Import one chunk of already-cleaned assignments (in-file conflicts removed
 * client-side). Classifies against the DB and upserts clean mappings.
 */
export async function importSupplierCodeAssignmentsChunk(input: {
  storeId: number;
  erpType: ErpType;
  fileName?: string;
  assignments: SupplierCodeAssignment[];
}): Promise<SupplierCodeImportResult> {
  const store = await storeRepository.getById(input.storeId);
  if (!store) throw new Error("Store not found");

  await assertStoreFileErpMatch({
    storeId: input.storeId,
    headers: [],
    fileName: input.fileName ?? "",
    detectFileErpType: () => input.erpType,
  });

  const classified = await classifyAssignments({
    storeId: input.storeId,
    assignments: input.assignments,
    inFileConflicts: [],
  });

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let markedUnavailable = 0;
  const errors: ImportResult["errors"] = [];

  for (const row of classified.toApply) {
    try {
      if (row.kind === "unavailable") {
        const result = await productRepository.upsertSupplierProduct({
          productId: row.productId,
          supplierId: row.supplierId,
          supplierCode: unavailableSupplierCode(row.productId),
          isActive: false,
        });
        if (result.action === "created") created += 1;
        else if (result.action === "updated") updated += 1;
        else unchanged += 1;
        markedUnavailable += 1;
        continue;
      }

      const result = await productRepository.upsertSupplierProduct({
        productId: row.productId,
        supplierId: row.supplierId,
        supplierCode: row.supplierCode!,
        isActive: true,
      });
      if (result.action === "created") created += 1;
      else if (result.action === "updated") updated += 1;
      else unchanged += 1;
    } catch (err) {
      errors.push({
        rowNumber: row.rowNumber,
        reference: row.storeProductCode,
        message:
          err instanceof Error
            ? err.message
            : row.kind === "unavailable"
              ? `Failed to mark ${row.supplierKey} unavailable`
              : `Failed to save ${row.supplierKey} code ${row.supplierCode}`,
      });
    }
  }

  const matchedRows = created + updated + unchanged;
  return {
    totalRows: input.assignments.length,
    matchedRows,
    unmatchedRows: classified.unmatchedCodes.length,
    invalidRows: classified.conflicts.length + errors.length,
    duplicateRows: 0,
    errors: errors.slice(0, 50),
    created,
    updated,
    unchanged,
    markedUnavailable,
    conflicts: classified.conflicts.slice(0, 200),
    unmatchedCodes: classified.unmatchedCodes.slice(0, 100),
  };
}
