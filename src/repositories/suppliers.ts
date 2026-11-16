import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";

export const supplierRepository = {
  async list() {
    return db.select().from(suppliers).orderBy(suppliers.priceTiePriority);
  },

  async getById(id: number) {
    const [row] = await this.getByIds([id]);
    return row ?? null;
  },

  async getByIds(ids: number[]) {
    if (!ids.length) return [];
    const rows = await db
      .select()
      .from(suppliers)
      .where(inArray(suppliers.id, ids))
      .orderBy(suppliers.priceTiePriority);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row) => row != null);
  },

  async getActive() {
    return db
      .select()
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(suppliers.priceTiePriority);
  },

  async getByCode(code: string) {
    const [row] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.code, code));
    return row ?? null;
  },

  async create(data: typeof suppliers.$inferInsert) {
    const [row] = await db.insert(suppliers).values(data).returning();
    return row;
  },

  async update(id: number, data: Partial<typeof suppliers.$inferInsert>) {
    const [row] = await db
      .update(suppliers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(suppliers.id, id))
      .returning();
    return row;
  },
};
