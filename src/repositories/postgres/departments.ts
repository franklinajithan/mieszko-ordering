import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, products } from "@/db/schema";


function isMissingRelationError(error: unknown, relation = "departments") {
  const cause = error instanceof Error ? error.cause : null;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return false;
  if (cause.code !== "42P01") return false;
  const message = "message" in cause ? String(cause.message) : "";
  return message.includes(relation);
}

async function listLegacyDepartmentNames() {
  const legacy = await db
    .selectDistinct({ department: products.department })
    .from(products)
    .orderBy(products.department);
  return legacy.map((r) => r.department);
}

export const departmentRepository = {
  async list() {
    return db.select().from(departments).orderBy(departments.name);
  },

  async getById(id: string) {
    const [row] = await db
      .select()
      .from(departments)
      .where(eq(departments.id, id));
    return row ?? null;
  },

  async getByName(name: string) {
    const [row] = await db
      .select()
      .from(departments)
      .where(eq(departments.name, name));
    return row ?? null;
  },

  async create(data: typeof departments.$inferInsert) {
    const [row] = await db.insert(departments).values(data).returning();
    return row;
  },

  /** Create the department if missing; reactivate if it exists but is inactive. */
  async ensureByName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const existing = await departmentRepository.getByName(trimmed);
    if (existing) {
      if (!existing.isActive) {
        return departmentRepository.update(existing.id.toString(), { isActive: true });
      }
      return existing;
    }

    return departmentRepository.create({
      name: trimmed,
      isActive: true,
    });
  },

  async update(id: string, data: Partial<typeof departments.$inferInsert>) {
    const existing = await departmentRepository.getById(id);
    if (!existing) return null;

    const [row] = await db
      .update(departments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(departments.id, id))
      .returning();

    if (data.name && data.name !== existing.name) {
      await db
        .update(products)
        .set({ orderDepartment: data.name, updatedAt: new Date() })
        .where(eq(products.orderDepartment, existing.name));
    }

    return row;
  },

  async listActiveNames() {
    try {
      const rows = await db
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.isActive, true))
        .orderBy(departments.name);

      if (rows.length > 0) {
        return rows.map((r) => r.name);
      }
    } catch (error) {
      if (!isMissingRelationError(error)) throw error;
    }

    return listLegacyDepartmentNames();
  },
};
