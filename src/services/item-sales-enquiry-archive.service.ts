import "server-only";

import { Readable } from "node:stream";
import JSZip from "jszip";
import { report6Filename, report6Stores, report6ZipFilename, type Report6Store } from "@/lib/item-sales-enquiry";
import { openReport6File, report6Headers } from "@/services/item-sales-enquiry.service";

const stores = Object.keys(report6Stores) as Report6Store[];

export async function listReport6Archive(date: string) {
  const available = await Promise.all(stores.map(async store => {
    const workbook = await openReport6File({ store, date });
    if (!workbook) return null;
    await workbook.file.close();
    return store;
  }));
  return { available: available.filter(store => store !== null) };
}

export async function report6ZipResponse(date: string) {
  const zip = new JSZip();
  const streams: Readable[] = [];
  try {
    for (const store of stores) {
      const workbook = await openReport6File({ store, date });
      if (!workbook) continue;
      const stream = workbook.file.createReadStream();
      streams.push(stream);
      zip.file(`${report6Stores[store]}/${report6Filename({ store, date })}`, stream, { createFolders: false });
    }
    if (!streams.length) {
      return new Response("No archived workbooks are available for this date.", { status: 404, headers: report6Headers });
    }

    // XLSX files are already compressed. Stream the original bytes from the open
    // files so an atomic replacement by the worker cannot change a ZIP in flight.
    const output = zip.generateNodeStream({ compression: "STORE", streamFiles: true }) as Readable;
    output.once("close", () => streams.forEach(stream => stream.destroy()));
    return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
      headers: {
        ...report6Headers,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${report6ZipFilename(date)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    streams.forEach(stream => stream.destroy());
    throw error;
  }
}
