import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { departmentMappings, departments, products } from "@/db/schema";
import { departmentRepository } from "./departments";

function normalizeImportedDepartment(name: string) {
  return name.trim();
}

function mappingKey(name: string) {
  return normalizeImportedDepartment(name).toLowerCase();
}

export const departmentMappingRepository = {
  async list() {
    return db
      .select({
        id: departmentMappings.id,
        importedDepartment: departmentMappings.importedDepartment,
        orderDepartmentId: departmentMappings.orderDepartmentId,
        orderDepartmentName: departments.name,
      })
      .from(departmentMappings)
      .innerJoin(
        departments,
        eq(departments.id, departmentMappings.orderDepartmentId),
      )
      .orderBy(departmentMappings.importedDepartment);
  },

  async listImportedDepartmentStats() {
    const importedRows = await db
      .select({
        importedDepartment: products.department,
        productCount: sql<number>`count(*)::int`,
      })
      .from(products)
      .groupBy(products.department)
      .orderBy(products.department);

    const mappings = await departmentMappingRepository.list();
    const mappingByKey = new Map(
      mappings.map((row) => [mappingKey(row.importedDepartment), row]),
    );

    return importedRows.map((row) => {
      const mapping = mappingByKey.get(mappingKey(row.importedDepartment));
      return {
        importedDepartment: row.importedDepartment,
        productCount: row.productCount,
        orderDepartmentId: mapping?.orderDepartmentId ?? null,
        orderDepartmentName: mapping?.orderDepartmentName ?? null,
      };
    });
  },

  async getMapForImport() {
    const rows = await departmentMappingRepository.list();
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(mappingKey(row.importedDepartment), row.orderDepartmentId);
    }
    return map;
  },

  async resolveOrderDepartmentIds(importedNames: string[]) {
    const unique = [
      ...new Set(
        importedNames.map((name) => normalizeImportedDepartment(name)).filter(Boolean),
      ),
    ];
    const mappingMap = await departmentMappingRepository.getMapForImport();
    const resolved = new Map<string, number | null>();

    for (const name of unique) {
      const mapped = mappingMap.get(mappingKey(name));
      if (mapped != null) {
        resolved.set(name, mapped);
        continue;
      }

      const existing = await departmentRepository.getByName(name);
      resolved.set(name, existing?.isActive ? existing.id : null);
    }

    return resolved;
  },

  async upsert(importedDepartment: string, orderDepartmentId: number) {
    const trimmed = normalizeImportedDepartment(importedDepartment);
    const [row] = await db
      .insert(departmentMappings)
      .values({
        importedDepartment: trimmed,
        orderDepartmentId,
      })
      .onConflictDoUpdate({
        target: departmentMappings.importedDepartment,
        set: {
          orderDepartmentId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  async deleteById(id: number) {
    const [row] = await db
      .delete(departmentMappings)
      .where(eq(departmentMappings.id, id))
      .returning();
    return row ?? null;
  },

  async applyMappingToProducts(
    importedDepartment: string,
    orderDepartmentId: number,
  ) {
    const trimmed = normalizeImportedDepartment(importedDepartment);
    const result = await db
      .update(products)
      .set({
        orderDepartment: orderDepartmentId,
        updatedAt: new Date(),
      })
      .where(
        sql`lower(trim(${products.department})) = lower(${trimmed})`,
      )
      .returning({ id: products.id });
    return result.length;
  },

  async applyToProducts() {
    const mappings = await departmentMappingRepository.list();
    let updated = 0;

    for (const mapping of mappings) {
      updated += await departmentMappingRepository.applyMappingToProducts(
        mapping.importedDepartment,
        mapping.orderDepartmentId,
      );
    }

    return { updated, mappings: mappings.length };
  },
};
