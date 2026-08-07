import fs from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const path =
    "C:/Users/Ajithan/Downloads/0650_E12 6RH_Price Override & RTC Sales History_20260806_175842.xlsx";
  const buffer = fs.readFileSync(path);
  const { parseRtcImportFile } = await import("../src/services/rtc-import.service");
  const { storeRepository } = await import("../src/repositories/stores");

  const stores = await storeRepository.list();
  const eastham = stores.find((s) => /eastham/i.test(s.name));
  console.log(
    "stores sample",
    stores.slice(0, 3).map((s) => ({ id: s.id, name: s.name, erp: s.erpType })),
  );
  console.log("eastham", eastham ? { id: eastham.id, erp: eastham.erpType } : null);

  try {
    const noStore = await parseRtcImportFile({
      buffer,
      fileName: "0650_E12 6RH_Price Override & RTC Sales History_20260806_175842.xlsx",
    });
    console.log("parse no store ok", noStore.headers, "rows", noStore.rows.length);
  } catch (e) {
    console.error("parse no store FAIL", e);
  }

  if (eastham) {
    try {
      const withStore = await parseRtcImportFile({
        buffer,
        fileName: "0650_E12 6RH_Price Override & RTC Sales History_20260806_175842.xlsx",
        storeId: eastham.id,
      });
      console.log(
        "parse with store ok",
        "matched",
        withStore.matchedCount,
        "unmatched",
        withStore.unmatchedCount,
      );
    } catch (e) {
      console.error("parse with store FAIL", e);
    }
  }
}

void main();
