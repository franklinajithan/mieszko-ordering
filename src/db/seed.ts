import "dotenv/config";
import { db } from "./index";
import { suppliers } from "./schema";

async function seed() {
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
