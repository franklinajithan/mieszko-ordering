// Disposable in-memory PostgreSQL. Never reads DATABASE_URL or office credentials.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile } from 'node:fs/promises';
const db=await PGlite.create();
await db.exec(await readFile('schema.sql','utf8'));
for (const name of ['2026-10-15-data-import-runs.sql','2026-10-15-book-stock-staging.sql','2026-10-15-order-stock-options.sql','2026-10-16-supplier-orders-and-manual-quantities.sql','2026-10-16-integration-corrections.sql','2026-10-16-office-operations.sql','2026-10-16-crm-store-settings.sql','2026-10-20-unmatched-products.sql']) await db.exec(await readFile(`migrations/manual/${name}`,'utf8'));
await db.exec(await readFile('tests/fixtures/seven-stores.sql','utf8'));
const server=new PGLiteSocketServer({db,host:'127.0.0.1',port:55432,maxConnections:20});
await server.start();
console.log('DISPOSABLE_TEST_DATABASE_READY 127.0.0.1:55432');
async function close(){await server.stop();await db.close();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
