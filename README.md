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
