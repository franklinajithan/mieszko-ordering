import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admShopCatalogs } from "@/db/schema";

export async function getAdmCatalog(storeId: number) {
  const [catalog] = await db.select().from(admShopCatalogs).where(eq(admShopCatalogs.storeId, storeId));
  return catalog ?? null;
}
