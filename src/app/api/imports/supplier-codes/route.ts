import { z } from "zod";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import { SUPPLIER_CODES_IMPORT_CHUNK_SIZE } from "@/lib/import-config";
import { importSupplierCodeAssignmentsChunk } from "@/services/supplier-codes/supplier-code-import.service";
import { storeRepository } from "@/repositories";

const assignmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("code"),
    storeProductCode: z.string().min(1),
    supplierKey: z.enum(["MM", "SP", "WAB"]),
    supplierCode: z.string().min(1),
    rowNumber: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("unavailable"),
    storeProductCode: z.string().min(1),
    supplierKey: z.enum(["MM", "SP", "WAB"]),
    supplierCode: z.null().optional(),
    rowNumber: z.number().int().positive(),
  }),
]);

const chunkSchema = z.object({
  storeId: z.number().int().positive(),
  erpType: z.enum(["msp", "glopos"]),
  fileName: z.string().min(1).optional(),
  assignments: z
    .array(assignmentSchema)
    .min(1)
    .max(SUPPLIER_CODES_IMPORT_CHUNK_SIZE),
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, chunkSchema);
  if (!parsed.ok) return parsed.response;

  const store = await storeRepository.getById(parsed.data.storeId);
  if (!store) return apiError("Store not found", 404);

  const assignments = parsed.data.assignments.map((assignment) =>
    assignment.kind === "unavailable"
      ? {
          ...assignment,
          supplierCode: null as string | null,
        }
      : assignment,
  );

  const data = await importSupplierCodeAssignmentsChunk({
    storeId: parsed.data.storeId,
    erpType: parsed.data.erpType,
    fileName: parsed.data.fileName,
    assignments,
  });
  return apiOk(data);
});
