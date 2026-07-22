import "dotenv/config";
import { getDb } from "./client";
import { suppliers } from "./schema";

async function seed() {
  const db = getDb();
  await db
    .insert(suppliers)
    .values([
      {
        name: "MM",
        code: "MM",
        priceTiePriority: 1,
        isActive: true,
      },
      {
        name: "SP",
        code: "SP",
        priceTiePriority: 2,
        isActive: true,
      },
      {
        name: "WAB",
        code: "WAB",
        priceTiePriority: 3,
        isActive: true,
      },
    ])
    .onConflictDoNothing({ target: suppliers.code });

  console.log("Seeded suppliers: MM, SP, WAB");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
