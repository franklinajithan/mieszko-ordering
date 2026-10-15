# Mieszko Ordering

Dairy ordering and supplier price comparison MVP built with Next.js App Router, PostgreSQL, Drizzle ORM, and TypeScript.

## Stack

- Next.js 16 (App Router)
- PostgreSQL + Drizzle ORM
- Zod validation
- ExcelJS / Papa Parse for imports
- Tailwind CSS
- Vitest for calculation engine tests

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Start PostgreSQL (Docker):

```bash
npm run db:up
```

3. Create a `.env` / `.env.local` file with your database URL:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mieszko
```

4. Apply schema and seed suppliers:

```bash
npm run db:push
npm run db:seed
```

5. Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Without `DATABASE_URL`, the app redirects to `/setup` with configuration instructions.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm test` | Run unit tests |
| `npm run db:up` | Start PostgreSQL via Docker Compose |
| `npm run db:push` | Push Drizzle schema to database |
| `npm run db:seed` | Seed MM, SP, WAB suppliers |

## Architecture

```
src/
  app/           Route handlers and API routes
  components/    UI only — no business logic
  db/            Drizzle schema and connection
  repositories/  Database access (postgres/)
  services/      Business logic (stock sim, pricing, imports)
  parsers/       CSV/XLSX parsing
  validators/    Zod schemas
  types/         Shared types
  utils/         Decimal helpers, cn()
```

Business logic lives in `services/` so it can later move to FastAPI without changing PostgreSQL.

## Main workflows

1. **Stores & suppliers** — `/stores`
2. **Products** — `/products` (codes, barcodes, supplier mappings, Excel import)
3. **Daily sales** — `/daily-sales`
4. **Supplier prices** — `/supplier-prices`
5. **Generate order** — `/order-sheet` (`/orders/new` redirects here)
6. **Order review & export** — `/orders/[id]`

## Testing

Unit tests cover:

- Highest-sales calculation
- Event-based stock simulation
- Supplier price CHECK rules (including WAB exclusion/inclusion)
- Tie-break priority
- Suggested order formula

```bash
npm test
```

## Development completion package (15 October 2026)

- Dashboard: separate seven-day Normal Sales, RTC and Wastage quantities, recent
  orders, audited import status, and manual Book Stock queueing.
- Saved orders: open `/orders/[id]` from the dashboard, review explanations,
  adjust quantities, save atomically, and export supplier worksheets.
- Ordering: UTC weekday forecasts deduplicate overlapping historical dates;
  separate enabled movement feeds inform stock depletion and coverage demand.
  Quotes use net **unit** prices; supplier worksheets show case conversions
  without silently rounding the user's units. Unpriced lines stay flagged.
- Book Stock: browser chunks stage until all rows arrive; automated imports and
  whole-file uploads commit atomically. Incomplete or unmatched stock files never
  replace the previous snapshot. Latest-store snapshots do not inherit omitted
  products from older uploads.
- Windows automation: see `docs/office-import-activation.md`. Actual CRM selectors,
  report layout normalization, credentials and Windows scheduling remain office
  activation work. Nothing is deployed or scheduled by the development package.

The authoritative schema is `src/db/schema.ts`; `schema.sql` is a generated
**fresh database** baseline. Existing office installations must review the manual
migrations rather than run the baseline or `db:push`.

Tests: `npm test` includes isolated embedded PostgreSQL persistence and order/export
integration tests. `python -m unittest discover -s automation/tests -v` checks worker
report validation. GitHub CI runs tests, lint and build, with no deployment or
migration steps. See `docs/development-report-2026-10-15.md` for the verified scope
and remaining office dependencies.


## Supplier orders and history

Open `/orders` to filter saved orders by store, dates and status. Reopen an order to
edit units, see immediate line/net totals, and generate one supplier order per
store and supplier. Each supplier order has a separate Excel download. The lowest
valid **unit price** wins regardless of case size; missing offers remain warnings
when another supplier has a valid price. Selected lines with no valid price block
supplier-order generation rather than being silently omitted.

Manual quantities are saved before exports and recalculation, and persist for the
same store product when suggestions change. Generated supplier drafts track the
source order revision and must be regenerated after subsequent edits. Apply the
prepared `2026-10-16-supplier-orders-and-manual-quantities.sql` migration only after
office review/approval. See `docs/functional-development-report.md` for the latest
verified changes and remaining integration dependencies.


## Isolated full-system verification

The system suite starts its own in-memory PostgreSQL engine and production Next
server. It uses seven-store fixtures, fake supplier data, generated Excel reports
and an offline CRM site. It never reads an office database URL. Ports 55432, 3100
and 3200 must be free; an existing server is rejected rather than reused.

```bash
npm ci
python -m pip install -r automation/requirements.txt
npx playwright install chromium
python -m playwright install chromium
npm test
python -m unittest discover -s automation/tests -v
npm run lint
npm run build
npm run test:system
```

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` only when providing an already installed
compatible Chromium to both the Node and Python browser tests. Otherwise each
Playwright installation uses its managed browser. The disposable PGlite socket
adapter supports application and psycopg integration; native PostgreSQL locking,
multiple database connections and Windows Task Scheduler still require office
acceptance testing. The injected SQL-error test uses a test-only simple-query
wrapper to avoid the embedded adapter's extended-query recovery limitation.

See `docs/integration-readiness-report.md` for results, fixes, changed files,
prepared migrations and remaining activation dependencies. No command above
installs a Windows scheduled task, sends orders or deploys the application.
