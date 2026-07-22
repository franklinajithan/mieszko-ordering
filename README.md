# Mieszko Ordering

Dairy ordering and supplier price comparison MVP built with Next.js App Router, PostgreSQL, Drizzle ORM, and TypeScript.

## Stack

- Next.js 16 (App Router)
- PostgreSQL + Drizzle ORM
- Zod validation
- ExcelJS / Papa Parse for imports
- Tailwind CSS
- Vitest for calculation engine tests

## Quick start (UI only — no database)

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root:

```
USE_MOCK_DATA=true
```

3. Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app runs in **demo mode** with sample stores, products, suppliers, and a pre-built order at `/orders/mock-order-demo-001`. A yellow banner confirms demo mode is active.

## PostgreSQL (optional, later)

When you are ready to persist data, set `DATABASE_URL` in `.env` and remove or set `USE_MOCK_DATA=false`:

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm test` | Run unit tests |
| `npm run db:push` | Push Drizzle schema to database |
| `npm run db:seed` | Seed MM, SP, WAB suppliers |

## Architecture

```
src/
  app/           Route handlers and server actions
  components/    UI only — no business logic
  db/            Drizzle schema and connection
  repositories/  Database access
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
5. **New order** — `/orders/new` (4-step wizard)
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
