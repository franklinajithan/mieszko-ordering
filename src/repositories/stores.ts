import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stores } from "@/db/schema";

export const storeRepository = {
  async list() {
    return db.select().from(stores).orderBy(stores.name);
  },

  async getById(id: number) {
    const [row] = await db.select().from(stores).where(eq(stores.id, id));
    return row ?? null;
  },

  async create(data: typeof stores.$inferInsert) {
    const [row] = await db.insert(stores).values(data).returning();
    return row;
  },


  async update(id: number, data: Partial<typeof stores.$inferInsert>) {
    const [row] = await db
      .update(stores)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(stores.id, id))
      .returning();
    return row;
  },
};
